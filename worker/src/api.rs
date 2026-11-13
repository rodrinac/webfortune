use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct Manifest {
    pub locales: Vec<Locale>,
    pub cows: Vec<String>,
}

#[derive(Deserialize)]
pub struct Locale {
    pub id: String,
    pub name: String,
    pub categories: Vec<String>,
    /// How many fortunes each database holds. Unfiltered selection weights
    /// databases by these counts.
    pub databases: BTreeMap<String, usize>,
    /// Indexes whose plain-text body is at most 160 bytes, in selection order.
    /// Asset generation writes them ascending. Missing keys match nothing.
    #[serde(default)]
    pub short: BTreeMap<String, Vec<u32>>,
    /// Indexes whose plain-text body is longer than 160 bytes, in selection order.
    #[serde(default)]
    pub long: BTreeMap<String, Vec<u32>>,
}

#[derive(Serialize)]
struct LocaleResponse<'a> {
    id: &'a str,
    name: &'a str,
}

#[derive(Debug, PartialEq)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: String,
}

/// What the asset-backed runtime must do to answer a request.
#[derive(Debug, PartialEq)]
pub enum Action {
    Reply(Reply),
    Cow(String),
    Fortune {
        locale: String,
        database: String,
        index: usize,
    },
    /// The same fortune as `Fortune`, rendered as one JSON object.
    FortuneJson {
        locale: String,
        database: String,
        index: usize,
    },
    /// The same fortune as `Fortune`, drawn as a cowsay bubble plus cow art.
    FortuneCowsay {
        locale: String,
        database: String,
        index: usize,
        cow: String,
    },
    /// Render a 1200×1200 PNG. `fortune` is absent for the branded default card.
    OgImage(OgImage),
}

#[derive(Debug, PartialEq)]
pub struct OgImage {
    pub locale: String,
    pub cow: String,
    pub fortune: Option<OgFortune>,
}

#[derive(Debug, PartialEq)]
pub struct OgFortune {
    pub database: String,
    pub index: usize,
}

/// Canonical Cache API key for a validated `/og.png` request.
///
/// Built from the resolved `OgImage` fields (not the raw query string), so
/// parameter order and omitted defaults that parse to the same image share one
/// entry. Unknown query parameters are rejected before this runs.
pub fn og_cache_key(image: &OgImage) -> String {
    let mut query = format!("locale={}&cow={}", image.locale, image.cow);
    if let Some(fortune) = &image.fortune {
        query.push_str(&format!(
            "&database={}&index={}",
            fortune.database, fortune.index
        ));
    }
    format!("https://og.cache.webfortune.invalid/og.png?{query}")
}

/// A permalink a crawler can preview. Absent when the query does not name a
/// fortune the page would actually show.
#[derive(Debug, PartialEq)]
pub struct ShareTarget {
    pub locale: String,
    pub cow: String,
    pub database: String,
    pub index: usize,
    pub fortune_id: String,
    pub page_query: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResponseFormat<'a> {
    Text,
    Json,
    /// `cow` is the installed cow name, or `default` when the parameter is omitted.
    Cowsay(&'a str),
}

/// `fortune -s` / `fortune -l`. The manifest lists the matching indexes; a
/// request never measures fortune text. Short is a plain-text body of at most
/// 160 UTF-8 bytes (fortune(6)'s default SLEN) and long is anything longer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FortuneLength {
    Short,
    Long,
}

struct FortuneQuery<'a> {
    locale: &'a str,
    category: &'a str,
    fortune: Option<&'a str>,
    /// Plain text unless this is `GET /` and `format` names a supported value.
    format: ResponseFormat<'a>,
    /// Unfiltered unless this is `GET /` and `length` is `short` or `long`.
    length: Option<FortuneLength>,
}

const TEXT: &str = "text/plain; charset=utf-8";
const JSON: &str = "application/json; charset=utf-8";

/// Release the Worker was compiled from. `scripts/version-bump.mjs` writes this
/// same value to `worker/Cargo.toml` and `package.json`. Deploy production waits
/// until `/health` reports it: the previous Worker also answers with status ok.
const RELEASE_VERSION: &str = env!("CARGO_PKG_VERSION");
const HEALTH_BODY: &str = concat!(
    "{\"status\":\"ok\",\"version\":\"",
    env!("CARGO_PKG_VERSION"),
    "\"}\n"
);

const fn is_release_version(version: &str) -> bool {
    let bytes = version.as_bytes();
    let mut index = 0;
    let mut dots = 0;
    let mut digits = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'0'..=b'9' => digits += 1,
            b'.' if digits > 0 => {
                dots += 1;
                digits = 0;
            }
            _ => return false,
        }
        index += 1;
    }
    dots == 2 && digits > 0
}

const _: () = assert!(is_release_version(RELEASE_VERSION));

fn health_ok() -> Reply {
    reply(200, JSON, HEALTH_BODY)
}

pub fn reply(status: u16, content_type: &str, body: impl Into<String>) -> Reply {
    Reply {
        status,
        headers: vec![
            ("content-type", content_type.to_string()),
            ("cache-control", "no-store".to_string()),
            ("x-content-type-options", "nosniff".to_string()),
        ],
        body: body.into(),
    }
}

pub fn text(status: u16, body: impl Into<String>) -> Reply {
    reply(status, TEXT, body)
}

fn json(body: &impl Serialize) -> Reply {
    match serde_json::to_string(body) {
        Ok(body) => reply(200, JSON, format!("{body}\n")),
        Err(_) => text(500, "Failed to serialize response.\n"),
    }
}

fn valid_resource_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.".contains(&character))
}

/// Stable, URL-safe id for one fortune. Database names may contain hyphens,
/// so the index is the trailing decimal segment.
pub fn fortune_id(database: &str, index: usize) -> String {
    format!("{database}-{index}")
}

pub fn with_fortune_id(mut reply: Reply, database: &str, index: usize) -> Reply {
    reply
        .headers
        .push(("x-fortune-id", fortune_id(database, index)));
    reply
}

#[derive(Serialize)]
struct FortuneJsonBody<'a> {
    id: &'a str,
    fortune: &'a str,
    locale: &'a str,
    category: &'a str,
}

/// Plain-text body for `GET /?format=cowsay`. The bubble matches `web/cowsay.js`
/// and the body ends with a newline. The `x-fortune-id` header is still set.
pub fn fortune_cowsay(database: &str, index: usize, fortune: &str, cow_art: &str) -> Reply {
    let mut body = crate::cowsay::render(fortune, crate::cowsay::WRAP_WIDTH, cow_art);
    if !body.ends_with('\n') {
        body.push('\n');
    }
    with_fortune_id(text(200, body), database, index)
}

/// JSON body for `GET /?format=json`. `category` is the database the fortune
/// was drawn from, the same name `?category=` accepts. The `x-fortune-id`
/// header is still set, and the fortune text matches the plain-text body.
pub fn fortune_json(locale: &str, database: &str, index: usize, fortune: &str) -> Reply {
    let id = fortune_id(database, index);
    let body = FortuneJsonBody {
        id: &id,
        fortune,
        locale,
        category: database,
    };
    with_fortune_id(json(&body), database, index)
}

fn canonical_index(index: &str) -> bool {
    let mut bytes = index.bytes();
    match (bytes.next(), index.len()) {
        (Some(b'0'), 1) => true,
        (Some(b'1'..=b'9'), _) => bytes.all(|byte| byte.is_ascii_digit()),
        _ => false,
    }
}

fn parse_fortune_id(id: &str) -> Option<(&str, usize)> {
    if !valid_resource_name(id) {
        return None;
    }
    let (database, index) = id.rsplit_once('-')?;
    if !valid_resource_name(database) || !canonical_index(index) {
        return None;
    }
    // u32 keeps the id meaning the same on the host test target and wasm32.
    let index: u32 = index.parse().ok()?;
    Some((database, index as usize))
}

fn parse_query<'a>(
    manifest: &Manifest,
    query: Option<&'a str>,
) -> Result<FortuneQuery<'a>, &'static str> {
    parse_query_with(manifest, query, false, false, false)
}

fn parse_query_with<'a>(
    manifest: &Manifest,
    query: Option<&'a str>,
    allow_fortune: bool,
    allow_format: bool,
    allow_length: bool,
) -> Result<FortuneQuery<'a>, &'static str> {
    let Some(query) = query else {
        return Ok(FortuneQuery {
            locale: "en",
            category: "",
            fortune: None,
            format: ResponseFormat::Text,
            length: None,
        });
    };

    // `cow` is part of the fortune query only for a single `format=cowsay`.
    // Every other request still rejects it while scanning parameters, so the
    // error stays the unsupported-parameter response.
    let allow_cow = allow_format && cowsay_format(query);
    let mut locale = None;
    let mut category = None;
    let mut fortune = None;
    let mut response_format = None;
    let mut cow = None;
    let mut length = None;
    for parameter in query.split('&') {
        let Some((name, value)) = parameter.split_once('=') else {
            return Err("Malformed query string.\n");
        };
        match name {
            "locale" if locale.replace(value).is_none() => {}
            "category" if category.replace(value).is_none() => {}
            "fortune" if allow_fortune && fortune.replace(value).is_none() => {}
            "format" if allow_format && response_format.replace(value).is_none() => {}
            "cow" if allow_cow && cow.replace(value).is_none() => {}
            "length" if allow_length && length.replace(value).is_none() => {}
            _ => return Err("Only one locale and category parameter are supported.\n"),
        }
    }

    let locale = locale.unwrap_or("en");
    if find_locale(manifest, locale).is_none() {
        return Err("Unsupported locale.\n");
    }

    let category = category.unwrap_or_default();
    if !category.is_empty() && !valid_resource_name(category) {
        return Err("Invalid category.\n");
    }

    if let Some(id) = fortune {
        if parse_fortune_id(id).is_none() {
            return Err("Invalid fortune.\n");
        }
    }

    let format = match response_format {
        None => ResponseFormat::Text,
        Some("json") => ResponseFormat::Json,
        Some("cowsay") => {
            let name = cow.unwrap_or("default");
            if !valid_resource_name(name) {
                return Err("Invalid cow.\n");
            }
            ResponseFormat::Cowsay(name)
        }
        Some(_) => return Err("Invalid format.\n"),
    };

    let length = match length {
        None => None,
        Some("short") => Some(FortuneLength::Short),
        Some("long") => Some(FortuneLength::Long),
        Some(_) => return Err("Invalid length.\n"),
    };
    // A pinned id names one fortune, so a length filter has nothing to choose.
    if length.is_some() && fortune.is_some() {
        return Err("Length cannot be combined with fortune.\n");
    }

    Ok(FortuneQuery {
        locale,
        category,
        fortune,
        format,
        length,
    })
}

/// True when the query has one `format=cowsay` parameter and no second `format`.
fn cowsay_format(query: &str) -> bool {
    let mut format = None;
    for parameter in query.split('&') {
        let Some((name, value)) = parameter.split_once('=') else {
            continue;
        };
        if name == "format" && format.replace(value).is_some() {
            return false;
        }
    }
    format == Some("cowsay")
}

fn find_locale<'a>(manifest: &'a Manifest, id: &str) -> Option<&'a Locale> {
    manifest.locales.iter().find(|locale| locale.id == id)
}

/// Maps `random` onto `0..total`. A value of `1.0` still lands on the last slot.
fn weighted_slot(total: usize, random: f64) -> Option<usize> {
    let last = total.checked_sub(1)?;
    Some(((random * total as f64) as usize).min(last))
}

/// Picks a fortune the way fortune-mod does: databases are weighted by how
/// many fortunes they hold, so every fortune is equally likely.
fn pick<'a>(
    databases: impl Iterator<Item = (&'a str, usize)> + Clone,
    random: f64,
) -> Option<(&'a str, usize)> {
    let total: usize = databases.clone().map(|(_, count)| count).sum();
    let mut target = weighted_slot(total, random)?;
    for (database, count) in databases {
        if target < count {
            return Some((database, target));
        }
        target -= count;
    }
    None
}

fn indices_of<'a>(locale: &'a Locale, name: &str, length: FortuneLength) -> &'a [u32] {
    let lists = match length {
        FortuneLength::Short => &locale.short,
        FortuneLength::Long => &locale.long,
    };
    lists.get(name).map(Vec::as_slice).unwrap_or(&[])
}

/// Same weighting as `pick`, over the precomputed indexes of one length.
/// List order is the walk order; each listed fortune is equally likely.
fn pick_indices<'a>(choices: &[(&'a str, &'a [u32])], random: f64) -> Option<(&'a str, usize)> {
    let total: usize = choices.iter().map(|(_, indices)| indices.len()).sum();
    let mut target = weighted_slot(total, random)?;
    for &(database, indices) in choices {
        if target < indices.len() {
            return Some((database, indices[target] as usize));
        }
        target -= indices.len();
    }
    None
}

fn select<'a>(
    locale: &'a Locale,
    category: &str,
    length: Option<FortuneLength>,
    random: f64,
) -> Option<(&'a str, usize)> {
    match length {
        None if category.is_empty() => pick(
            locale
                .databases
                .iter()
                .map(|(name, count)| (name.as_str(), *count)),
            random,
        ),
        None => locale
            .databases
            .get_key_value(category)
            .and_then(|(name, count)| pick(std::iter::once((name.as_str(), *count)), random)),
        Some(length) if category.is_empty() => {
            let choices: Vec<_> = locale
                .databases
                .keys()
                .map(|name| (name.as_str(), indices_of(locale, name, length)))
                .collect();
            pick_indices(&choices, random)
        }
        Some(length) => locale
            .databases
            .get_key_value(category)
            .and_then(|(name, _count)| {
                let choices = [(name.as_str(), indices_of(locale, name, length))];
                pick_indices(&choices, random)
            }),
    }
}

fn pinned_fortune(locale: &Locale, category: &str, id: &str) -> Action {
    let (database, index) = parse_fortune_id(id).expect("validated fortune id");
    if !category.is_empty() && !locale.categories.iter().any(|name| name == category) {
        return Action::Reply(text(404, "Fortune category not found.\n"));
    }
    match locale.databases.get(database) {
        Some(&count) if index < count && (category.is_empty() || category == database) => {
            Action::Fortune {
                locale: locale.id.clone(),
                database: database.to_string(),
                index,
            }
        }
        _ => Action::Reply(text(404, "Fortune not found.\n")),
    }
}

fn apply_format(action: Action, format: ResponseFormat<'_>) -> Action {
    match (format, action) {
        (ResponseFormat::Text, action) => action,
        (
            ResponseFormat::Json,
            Action::Fortune {
                locale,
                database,
                index,
            },
        ) => Action::FortuneJson {
            locale,
            database,
            index,
        },
        (
            ResponseFormat::Cowsay(cow),
            Action::Fortune {
                locale,
                database,
                index,
            },
        ) => Action::FortuneCowsay {
            locale,
            database,
            index,
            cow: cow.to_string(),
        },
        (_, action) => action,
    }
}

fn fortune(manifest: &Manifest, query: Option<&str>, random: f64) -> Action {
    let query = match parse_query_with(manifest, query, true, true, true) {
        Ok(query) => query,
        Err(error) => return Action::Reply(text(400, error)),
    };
    if let ResponseFormat::Cowsay(cow) = query.format {
        if !manifest.cows.iter().any(|name| name == cow) {
            return Action::Reply(text(404, "Cow not found.\n"));
        }
    }
    let locale = find_locale(manifest, query.locale).expect("validated locale");
    let action = if let Some(id) = query.fortune {
        pinned_fortune(locale, query.category, id)
    } else if !query.category.is_empty()
        && !locale.categories.iter().any(|name| name == query.category)
    {
        return Action::Reply(text(404, "Fortune category not found.\n"));
    } else {
        match select(locale, query.category, query.length, random) {
            Some((database, index)) => Action::Fortune {
                locale: locale.id.clone(),
                database: database.to_string(),
                index,
            },
            // An empty length list is a successful read of the manifest that
            // simply contains no match. A locale with no databases at all still
            // reports the service unavailable when length is omitted.
            None if query.length.is_some() => {
                Action::Reply(text(404, "No fortune of that length.\n"))
            }
            None => Action::Reply(text(503, "Fortune service unavailable.\n")),
        }
    };
    apply_format(action, query.format)
}

pub fn handle(
    method: &str,
    path: &str,
    query: Option<&str>,
    manifest: &Manifest,
    random: f64,
) -> Action {
    if method == "OPTIONS" {
        return Action::Reply(Reply {
            status: 204,
            headers: Vec::new(),
            body: String::new(),
        });
    }
    // HEAD is routed like GET. The runtime drops the body and keeps the headers.
    if method != "GET" && method != "HEAD" {
        return Action::Reply(Reply {
            status: 405,
            headers: vec![
                ("allow", "GET, HEAD".to_string()),
                ("content-type", TEXT.to_string()),
            ],
            body: "Method not allowed.\n".to_string(),
        });
    }

    let reply = match path {
        "/health" if !manifest.locales.is_empty() && !manifest.cows.is_empty() => health_ok(),
        "/health" => text(503, "Fortune service unavailable.\n"),
        "/locales" => json(
            &manifest
                .locales
                .iter()
                .map(|locale| LocaleResponse {
                    id: &locale.id,
                    name: &locale.name,
                })
                .collect::<Vec<_>>(),
        ),
        "/cows" => json(&manifest.cows),
        "/categories" => match parse_query(manifest, query) {
            Ok(query) => json(
                &find_locale(manifest, query.locale)
                    .expect("validated locale")
                    .categories,
            ),
            Err(error) => text(400, error),
        },
        "/" => return fortune(manifest, query, random),
        "/og.png" => match og_image(manifest, query) {
            Ok(image) => return Action::OgImage(image),
            Err(reply) => reply,
        },
        _ => match path.strip_prefix("/cows/") {
            Some(name) if !valid_resource_name(name) => text(400, "Invalid cow.\n"),
            Some(name) if manifest.cows.iter().any(|cow| cow == name) => {
                return Action::Cow(name.to_string())
            }
            Some(_) => text(404, "Cow not found.\n"),
            None => text(404, "Not found.\n"),
        },
    };
    Action::Reply(reply)
}

struct OgQuery<'a> {
    locale: &'a str,
    category: &'a str,
    fortune: Option<&'a str>,
    cow: &'a str,
}

fn og_image(manifest: &Manifest, query: Option<&str>) -> Result<OgImage, Reply> {
    let query = parse_og_query(manifest, query)?;
    if !manifest.cows.iter().any(|cow| cow == query.cow) {
        return Err(text(404, "Cow not found.\n"));
    }
    let fortune = if let Some(id) = query.fortune {
        match pinned_fortune(
            find_locale(manifest, query.locale).expect("validated locale"),
            query.category,
            id,
        ) {
            Action::Fortune {
                database, index, ..
            } => Some(OgFortune { database, index }),
            Action::Reply(reply) => return Err(reply),
            Action::Cow(_)
            | Action::OgImage(_)
            | Action::FortuneJson { .. }
            | Action::FortuneCowsay { .. } => return Err(text(500, "Failed to load fortune.\n")),
        }
    } else if !query.category.is_empty() {
        let locale = find_locale(manifest, query.locale).expect("validated locale");
        if !locale.categories.iter().any(|name| name == query.category) {
            return Err(text(404, "Fortune category not found.\n"));
        }
        None
    } else {
        None
    };
    Ok(OgImage {
        locale: query.locale.to_string(),
        cow: query.cow.to_string(),
        fortune,
    })
}

fn parse_og_query<'a>(manifest: &Manifest, query: Option<&'a str>) -> Result<OgQuery<'a>, Reply> {
    let Some(query) = query else {
        return Ok(OgQuery {
            locale: "en",
            category: "",
            fortune: None,
            cow: "default",
        });
    };

    let mut locale = None;
    let mut category = None;
    let mut fortune = None;
    let mut cow = None;
    for parameter in query.split('&') {
        if parameter.is_empty() {
            return Err(text(400, "Malformed query string.\n"));
        }
        let Some((name, value)) = parameter.split_once('=') else {
            return Err(text(400, "Malformed query string.\n"));
        };
        let slot = match name {
            "locale" => &mut locale,
            "category" => &mut category,
            "fortune" => &mut fortune,
            "cow" => &mut cow,
            _ => return Err(text(400, OG_QUERY)),
        };
        if slot.replace(value).is_some() {
            return Err(text(400, OG_QUERY));
        }
    }

    let locale = locale.unwrap_or("en");
    if find_locale(manifest, locale).is_none() {
        return Err(text(400, "Unsupported locale.\n"));
    }
    let category = category.unwrap_or_default();
    if !category.is_empty() && !valid_resource_name(category) {
        return Err(text(400, "Invalid category.\n"));
    }
    if let Some(id) = fortune {
        if parse_fortune_id(id).is_none() {
            return Err(text(400, "Invalid fortune.\n"));
        }
    }
    let cow = cow.unwrap_or("default");
    if !valid_resource_name(cow) {
        return Err(text(400, "Invalid cow.\n"));
    }

    Ok(OgQuery {
        locale,
        category,
        fortune,
        cow,
    })
}

const OG_QUERY: &str = "Only one locale, category, cow, and fortune parameter are supported.\n";

/// Resolves the fortune a permalink would show. Locale may be omitted: English
/// is tried first, then the other installed locales, so an id that exists in
/// only one language still previews. The image URL this builds always names
/// the locale that actually holds the fortune.
pub fn share_target(manifest: &Manifest, query: Option<&str>) -> Option<ShareTarget> {
    let query = query?;
    let fortune = single(query, "fortune").filter(|id| parse_fortune_id(id).is_some())?;
    let locale_param = single(query, "locale").filter(|id| find_locale(manifest, id).is_some());
    let cow_param = single(query, "cow")
        .filter(|name| valid_resource_name(name) && manifest.cows.iter().any(|cow| cow == name));
    let category_param = single(query, "category").filter(|name| valid_resource_name(name));
    let cow = cow_param.unwrap_or("default");
    if !manifest.cows.iter().any(|name| name == cow) {
        return None;
    }

    let locales: Vec<&Locale> = if let Some(id) = locale_param {
        find_locale(manifest, id).into_iter().collect()
    } else {
        let mut locales: Vec<&Locale> = manifest.locales.iter().collect();
        locales.sort_by_key(|locale| locale.id != "en");
        locales
    };

    for locale in locales {
        let category = match category_param {
            Some(name) if locale.categories.iter().any(|category| category == name) => name,
            Some(_) if locale_param.is_some() => "",
            Some(_) => continue,
            None => "",
        };
        if let Action::Fortune {
            database, index, ..
        } = pinned_fortune(locale, category, fortune)
        {
            return Some(ShareTarget {
                locale: locale.id.clone(),
                cow: cow.to_string(),
                fortune_id: fortune_id(&database, index),
                page_query: page_query(
                    locale_param.is_some() || locale.id != "en",
                    &locale.id,
                    cow_param.is_some().then_some(cow),
                    (category_param.is_some() && category == category_param.unwrap_or_default())
                        .then_some(category),
                    fortune,
                ),
                database,
                index,
            });
        }
    }
    None
}

fn page_query(
    include_locale: bool,
    locale: &str,
    cow: Option<&str>,
    category: Option<&str>,
    fortune: &str,
) -> String {
    let mut query = String::new();
    let mut push = |name: &str, value: &str| {
        if !query.is_empty() {
            query.push('&');
        }
        query.push_str(name);
        query.push('=');
        query.push_str(value);
    };
    if include_locale {
        push("locale", locale);
    }
    if let Some(cow) = cow {
        push("cow", cow);
    }
    if let Some(category) = category.filter(|category| !category.is_empty()) {
        push("category", category);
    }
    push("fortune", fortune);
    query
}

fn single<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    let mut found = None;
    let prefix = format!("{name}=");
    for parameter in query.split('&') {
        if let Some(value) = parameter.strip_prefix(&prefix) {
            if value.is_empty() || found.replace(value).is_some() {
                return None;
            }
        }
    }
    found
}

/// Mirrors the API Gateway CORS policy this Worker replaces.
pub fn apply_cors(reply: &mut Reply, method: &str, origin: Option<&str>, allowed_origins: &str) {
    let Some(origin) = origin.filter(|origin| {
        allowed_origins
            .split(',')
            .any(|allowed| allowed.trim() == *origin)
    }) else {
        return;
    };
    reply
        .headers
        .push(("access-control-allow-origin", origin.to_string()));
    reply.headers.push(("vary", "Origin".to_string()));
    reply
        .headers
        .push(("access-control-expose-headers", "x-fortune-id".to_string()));
    if method == "OPTIONS" {
        reply
            .headers
            .push(("access-control-allow-methods", "GET,OPTIONS".to_string()));
        reply
            .headers
            .push(("access-control-allow-headers", "content-type".to_string()));
        reply
            .headers
            .push(("access-control-max-age", "3600".to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        serde_json::from_str(
            r#"{
              "locales": [
                { "id": "en", "name": "English", "categories": ["art", "zippy"],
                  "databases": { "art": 2, "zippy": 3 } },
                { "id": "pt", "name": "Português", "categories": [],
                  "databases": { "brasil": 4 } }
              ],
              "cows": ["default", "tux"]
            }"#,
        )
        .unwrap()
    }

    fn reply_of(action: Action) -> Reply {
        match action {
            Action::Reply(reply) => reply,
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    fn get(path: &str, query: Option<&str>) -> Action {
        handle("GET", path, query, &manifest(), 0.0)
    }

    #[test]
    fn serves_locales_cows_and_categories_from_the_manifest() {
        assert_eq!(
            reply_of(get("/locales", None)).body,
            "[{\"id\":\"en\",\"name\":\"English\"},{\"id\":\"pt\",\"name\":\"Português\"}]\n"
        );
        assert_eq!(reply_of(get("/cows", None)).body, "[\"default\",\"tux\"]\n");
        assert_eq!(
            reply_of(get("/categories", None)).body,
            "[\"art\",\"zippy\"]\n"
        );
        assert_eq!(reply_of(get("/categories", Some("locale=pt"))).body, "[]\n");
    }

    #[test]
    fn health_reports_ok_and_the_release_version() {
        assert!(is_release_version(RELEASE_VERSION));
        assert!(!is_release_version("v1.5.0"));
        assert!(!is_release_version("1.5"));
        assert!(!is_release_version("1.5.0-beta"));
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(package["version"].as_str(), Some(RELEASE_VERSION));

        let reply = reply_of(get("/health", None));
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body, HEALTH_BODY);
        assert!(reply.headers.contains(&("content-type", JSON.to_string())));
        assert!(reply
            .headers
            .contains(&("cache-control", "no-store".to_string())));
    }

    #[test]
    fn health_without_fortune_data_stays_unavailable() {
        for manifest_json in [
            r#"{"locales":[],"cows":["default"]}"#,
            r#"{"locales":[{"id":"en","name":"English","categories":[],"databases":{}}],"cows":[]}"#,
        ] {
            let manifest: Manifest = serde_json::from_str(manifest_json).unwrap();
            let reply = reply_of(handle("GET", "/health", None, &manifest, 0.0));
            assert_eq!(reply.status, 503, "{manifest_json}");
            assert_eq!(reply.body, "Fortune service unavailable.\n");
        }
    }

    #[test]
    fn query_errors_match_the_previous_api() {
        for (query, error) in [
            ("", "Malformed query string.\n"),
            ("locale", "Malformed query string.\n"),
            (
                "locale=en&locale=en",
                "Only one locale and category parameter are supported.\n",
            ),
            (
                "cow=tux",
                "Only one locale and category parameter are supported.\n",
            ),
            ("locale=fr", "Unsupported locale.\n"),
            ("category=../etc", "Invalid category.\n"),
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!((reply.status, reply.body.as_str()), (400, error), "{query}");
        }
    }

    #[test]
    fn picks_fortunes_weighted_by_database_size() {
        let at = |random, query| handle("GET", "/", query, &manifest(), random);
        let fortune = |database: &str, index| Action::Fortune {
            locale: "en".to_string(),
            database: database.to_string(),
            index,
        };
        assert_eq!(at(0.0, None), fortune("art", 0));
        assert_eq!(at(0.39, None), fortune("art", 1));
        assert_eq!(at(0.4, None), fortune("zippy", 0));
        assert_eq!(at(0.999, None), fortune("zippy", 2));
        assert_eq!(at(0.999, Some("category=art")), fortune("art", 1));
        assert_eq!(
            at(0.5, Some("locale=pt")),
            Action::Fortune {
                locale: "pt".to_string(),
                database: "brasil".to_string(),
                index: 2,
            }
        );
    }

    #[test]
    fn omitting_the_fortune_id_keeps_the_previous_picker_and_errors() {
        assert_eq!(
            handle("GET", "/", Some("locale=en"), &manifest(), 0.4),
            Action::Fortune {
                locale: "en".to_string(),
                database: "zippy".to_string(),
                index: 0,
            }
        );
        assert_eq!(
            reply_of(get("/", Some("cow=tux"))).body,
            "Only one locale and category parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/categories", Some("fortune=art-0"))).body,
            "Only one locale and category parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/", Some("locale=fr&fortune=art-0"))).body,
            "Unsupported locale.\n"
        );
        assert_eq!(
            reply_of(get("/", Some("category=../etc&fortune=art-0"))).body,
            "Invalid category.\n"
        );
    }

    #[test]
    fn fortune_ids_round_trip_to_the_same_fortune() {
        assert_eq!(fortune_id("art", 0), "art-0");
        assert_eq!(fortune_id("off-color", 1), "off-color-1");
        assert_eq!(fortune_id("off.offensive", 12), "off.offensive-12");

        let pinned = |query| handle("GET", "/", Some(query), &manifest(), 0.99);
        assert_eq!(
            pinned("fortune=zippy-2"),
            Action::Fortune {
                locale: "en".to_string(),
                database: "zippy".to_string(),
                index: 2,
            }
        );
        assert_eq!(
            pinned("locale=pt&fortune=brasil-3"),
            Action::Fortune {
                locale: "pt".to_string(),
                database: "brasil".to_string(),
                index: 3,
            }
        );
        assert_eq!(
            pinned("category=art&fortune=art-1"),
            Action::Fortune {
                locale: "en".to_string(),
                database: "art".to_string(),
                index: 1,
            }
        );

        let reply = with_fortune_id(text(200, "Hello\n"), "zippy", 2);
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body, "Hello\n");
        assert!(reply
            .headers
            .contains(&("x-fortune-id", "zippy-2".to_string())));
        assert!(reply
            .headers
            .iter()
            .any(|(name, value)| *name == "content-type" && value.starts_with("text/plain")));
    }

    #[test]
    fn hyphenated_database_names_stay_unambiguous() {
        let manifest = serde_json::from_str(
            r#"{
              "locales": [{
                "id": "en", "name": "English", "categories": ["off-color"],
                "databases": { "off-color": 2, "off.offensive": 3 }
              }],
              "cows": ["default"]
            }"#,
        )
        .unwrap();
        let pinned = |query| handle("GET", "/", Some(query), &manifest, 0.0);
        assert_eq!(
            pinned("fortune=off-color-1"),
            Action::Fortune {
                locale: "en".to_string(),
                database: "off-color".to_string(),
                index: 1,
            }
        );
        assert_eq!(
            pinned("fortune=off.offensive-2"),
            Action::Fortune {
                locale: "en".to_string(),
                database: "off.offensive".to_string(),
                index: 2,
            }
        );
        assert_eq!(
            pinned("category=off-color&fortune=off-color-0"),
            Action::Fortune {
                locale: "en".to_string(),
                database: "off-color".to_string(),
                index: 0,
            }
        );
        let mismatch = reply_of(pinned("category=off-color&fortune=off.offensive-0"));
        assert_eq!(
            (mismatch.status, mismatch.body.as_str()),
            (404, "Fortune not found.\n")
        );
        let unknown = reply_of(pinned("fortune=off-0"));
        assert_eq!(
            (unknown.status, unknown.body.as_str()),
            (404, "Fortune not found.\n")
        );
    }

    #[test]
    fn invalid_or_missing_fortune_ids_are_rejected() {
        for query in [
            "fortune=",
            "fortune=art",
            "fortune=art-",
            "fortune=-0",
            "fortune=art-01",
            "fortune=art-00",
            "fortune=../art-1",
            "fortune=art-1/2",
            "fortune=art-1a",
            "fortune=not a fortune",
            "fortune=art-4294967296",
            "fortune=art-99999999999999999999",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (400, "Invalid fortune.\n"),
                "{query}"
            );
        }
        assert_eq!(
            reply_of(get("/", Some("fortune=art-0&fortune=zippy-1"))).body,
            "Only one locale and category parameter are supported.\n"
        );

        for (query, body) in [
            ("fortune=nope-0", "Fortune not found.\n"),
            ("fortune=art-2", "Fortune not found.\n"),
            ("fortune=art-99", "Fortune not found.\n"),
            ("locale=pt&fortune=art-0", "Fortune not found.\n"),
            ("locale=pt&fortune=brasil-4", "Fortune not found.\n"),
            ("category=art&fortune=zippy-0", "Fortune not found.\n"),
            (
                "category=nope&fortune=art-0",
                "Fortune category not found.\n",
            ),
            (
                "locale=pt&category=brasil&fortune=brasil-0",
                "Fortune category not found.\n",
            ),
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!((reply.status, reply.body.as_str()), (404, body), "{query}");
        }
    }

    #[test]
    fn unknown_resources_are_not_found() {
        for (path, query, body) in [
            ("/", Some("category=nope"), "Fortune category not found.\n"),
            (
                "/",
                Some("locale=pt&category=brasil"),
                "Fortune category not found.\n",
            ),
            ("/cows/moose", None, "Cow not found.\n"),
            ("/nope", None, "Not found.\n"),
        ] {
            let reply = reply_of(get(path, query));
            assert_eq!((reply.status, reply.body.as_str()), (404, body), "{path}");
        }
        assert_eq!(reply_of(get("/cows/..", None)).status, 404);
        assert_eq!(reply_of(get("/cows/a%20b", None)).body, "Invalid cow.\n");
        assert_eq!(get("/cows/tux", None), Action::Cow("tux".to_string()));
    }

    #[test]
    fn head_matches_get_and_other_methods_stay_rejected() {
        for (path, query) in [
            ("/", None),
            ("/", Some("fortune=zippy-2")),
            ("/", Some("format=json")),
            ("/", Some("category=art&fortune=art-1&format=json")),
            ("/", Some("format=cowsay")),
            ("/", Some("format=cowsay&cow=tux&fortune=art-1")),
            (
                "/",
                Some("locale=pt&category=art&format=cowsay&cow=default"),
            ),
            ("/", Some("length=short")),
            ("/", Some("length=long&category=art")),
            ("/", Some("length=nope")),
            ("/", Some("length=short&fortune=art-0")),
            ("/", Some("length=short&format=json")),
            ("/", Some("length=long&format=cowsay&cow=tux")),
            ("/", Some("format=cowsay&cow=moose")),
            ("/", Some("format=cowsay&cow=../etc")),
            ("/health", None),
            ("/locales", None),
            ("/og.png", None),
            ("/og.png", Some("cow=tux&fortune=art-1")),
            ("/cows/tux", None),
            ("/missing", None),
        ] {
            assert_eq!(
                handle("HEAD", path, query, &manifest(), 0.4),
                handle("GET", path, query, &manifest(), 0.4),
                "{path} {query:?}"
            );
        }

        for method in ["POST", "PUT", "DELETE", "PATCH"] {
            let reply = reply_of(handle(
                method,
                "/og.png",
                Some("fortune=art-0"),
                &manifest(),
                0.0,
            ));
            assert_eq!(reply.status, 405, "{method}");
            assert_eq!(reply.body, "Method not allowed.\n");
            assert!(reply.headers.contains(&("allow", "GET, HEAD".to_string())));
        }
        assert_eq!(
            reply_of(handle("OPTIONS", "/", None, &manifest(), 0.0)).status,
            204
        );
    }

    #[test]
    fn cors_only_echoes_allowed_origins() {
        let allowed = "https://webfortune.app,https://rodrinac.github.io";
        let mut reply = text(200, "ok");
        apply_cors(&mut reply, "GET", Some("https://evil.example"), allowed);
        assert!(!reply
            .headers
            .iter()
            .any(|(name, _)| name.starts_with("access-control")));

        apply_cors(
            &mut reply,
            "GET",
            Some("https://rodrinac.github.io"),
            allowed,
        );
        assert!(reply.headers.contains(&(
            "access-control-allow-origin",
            "https://rodrinac.github.io".to_string()
        )));
        assert!(reply
            .headers
            .contains(&("access-control-expose-headers", "x-fortune-id".to_string())));

        let mut preflight = text(204, "");
        apply_cors(
            &mut preflight,
            "OPTIONS",
            Some("https://webfortune.app"),
            allowed,
        );
        assert!(preflight
            .headers
            .contains(&("access-control-max-age", "3600".to_string())));
    }

    #[test]
    fn og_images_use_the_same_fortune_rules() {
        assert_eq!(
            get("/og.png", None),
            Action::OgImage(OgImage {
                locale: "en".to_string(),
                cow: "default".to_string(),
                fortune: None,
            })
        );
        assert_eq!(
            get("/og.png", Some("locale=pt&cow=tux&fortune=brasil-3")),
            Action::OgImage(OgImage {
                locale: "pt".to_string(),
                cow: "tux".to_string(),
                fortune: Some(OgFortune {
                    database: "brasil".to_string(),
                    index: 3,
                }),
            })
        );
        assert_eq!(
            reply_of(get("/og.png", Some("fortune=not-a-fortune"))).body,
            "Invalid fortune.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("cow=../etc"))).body,
            "Invalid cow.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("cow=moose"))).body,
            "Cow not found.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("locale=fr"))).body,
            "Unsupported locale.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("fortune=art-0&fortune=zippy-1"),)).body,
            "Only one locale, category, cow, and fortune parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("format=json"))).body,
            "Only one locale, category, cow, and fortune parameter are supported.\n"
        );
        assert_eq!(reply_of(get("/og.png", Some("category=nope"))).status, 404);
    }

    #[test]
    fn og_cache_keys_follow_validated_fields_not_query_order() {
        let branded = OgImage {
            locale: "en".to_string(),
            cow: "default".to_string(),
            fortune: None,
        };
        assert_eq!(
            og_cache_key(&branded),
            "https://og.cache.webfortune.invalid/og.png?locale=en&cow=default"
        );

        let pinned = match get("/og.png", Some("cow=tux&fortune=brasil-3&locale=pt")) {
            Action::OgImage(image) => image,
            other => panic!("expected og image, got {other:?}"),
        };
        let reordered = match get("/og.png", Some("locale=pt&cow=tux&fortune=brasil-3")) {
            Action::OgImage(image) => image,
            other => panic!("expected og image, got {other:?}"),
        };
        assert_eq!(pinned, reordered);
        assert_eq!(
            og_cache_key(&pinned),
            "https://og.cache.webfortune.invalid/og.png?locale=pt&cow=tux&database=brasil&index=3"
        );
        assert_eq!(og_cache_key(&pinned), og_cache_key(&reordered));

        // category alone does not change the branded card for a locale/cow.
        let with_category = match get("/og.png", Some("category=art&cow=tux")) {
            Action::OgImage(image) => image,
            other => panic!("expected og image, got {other:?}"),
        };
        let without_category = match get("/og.png", Some("cow=tux")) {
            Action::OgImage(image) => image,
            other => panic!("expected og image, got {other:?}"),
        };
        assert_eq!(with_category, without_category);
        assert_eq!(
            og_cache_key(&with_category),
            og_cache_key(&without_category)
        );
    }

    #[test]
    fn share_targets_follow_permalinks_and_skip_unknown_ids() {
        let pinned = share_target(&manifest(), Some("locale=pt&cow=tux&fortune=brasil-3"))
            .expect("permalink");
        assert_eq!(pinned.locale, "pt");
        assert_eq!(pinned.cow, "tux");
        assert_eq!(pinned.database, "brasil");
        assert_eq!(pinned.index, 3);
        assert_eq!(pinned.fortune_id, "brasil-3");
        assert_eq!(pinned.page_query, "locale=pt&cow=tux&fortune=brasil-3");

        let implied = share_target(&manifest(), Some("fortune=brasil-1")).expect("locale search");
        assert_eq!(implied.locale, "pt");
        assert_eq!(implied.page_query, "locale=pt&fortune=brasil-1");

        let english = share_target(&manifest(), Some("cow=tux&fortune=zippy-2")).expect("en");
        assert_eq!(english.locale, "en");
        assert_eq!(english.page_query, "cow=tux&fortune=zippy-2");

        assert_eq!(
            share_target(&manifest(), Some("category=art&fortune=art-1"))
                .expect("category")
                .page_query,
            "category=art&fortune=art-1"
        );
        assert!(share_target(&manifest(), Some("category=art&fortune=zippy-0")).is_none());
        assert!(share_target(&manifest(), Some("fortune=art-99")).is_none());
        assert!(share_target(&manifest(), Some("locale=pt")).is_none());
        assert!(share_target(&manifest(), Some("cow=moose&fortune=art-0")).is_some());
        assert_eq!(
            share_target(&manifest(), Some("cow=moose&fortune=art-0"))
                .expect("fallback cow")
                .cow,
            "default"
        );
    }

    fn as_plain_fortune(action: Action) -> Action {
        match action {
            Action::FortuneJson {
                locale,
                database,
                index,
            }
            | Action::FortuneCowsay {
                locale,
                database,
                index,
                ..
            } => Action::Fortune {
                locale,
                database,
                index,
            },
            other => other,
        }
    }

    #[test]
    fn json_format_selects_the_same_fortune_as_plain_text() {
        let cases = [
            (None, Some("format=json"), 0.0),
            (Some("locale=en"), Some("locale=en&format=json"), 0.4),
            (
                Some("category=art"),
                Some("category=art&format=json"),
                0.999,
            ),
            (
                Some("fortune=zippy-2"),
                Some("format=json&fortune=zippy-2"),
                0.2,
            ),
            (
                Some("locale=pt&fortune=brasil-3"),
                Some("locale=pt&fortune=brasil-3&format=json"),
                0.7,
            ),
            (
                Some("category=art&fortune=art-1"),
                Some("format=json&category=art&fortune=art-1"),
                0.1,
            ),
            (Some("locale=pt"), Some("format=json&locale=pt"), 0.5),
            (Some("category="), Some("category=&format=json"), 0.4),
        ];
        for (plain, formatted, random) in cases {
            let plain_action = handle("GET", "/", plain, &manifest(), random);
            let json_action = handle("GET", "/", formatted, &manifest(), random);
            assert!(
                matches!(plain_action, Action::Fortune { .. }),
                "plain {plain:?} stayed text: {plain_action:?}"
            );
            assert!(
                matches!(json_action, Action::FortuneJson { .. }),
                "json {formatted:?}: {json_action:?}"
            );
            assert_eq!(
                as_plain_fortune(json_action),
                plain_action,
                "{plain:?} vs {formatted:?}"
            );
        }
    }

    #[test]
    fn json_fortune_body_matches_the_plain_text_and_keeps_the_id_header() {
        let fortune = "Hello \"world\"\nOlá\n";
        let plain = with_fortune_id(text(200, fortune), "off-color", 1);
        let json_reply = fortune_json("en", "off-color", 1, fortune);

        assert_eq!(plain.status, 200);
        assert_eq!(plain.body, fortune);
        assert!(plain
            .headers
            .iter()
            .any(|(name, value)| { *name == "content-type" && value.starts_with("text/plain") }));
        assert!(plain
            .headers
            .contains(&("x-fortune-id", "off-color-1".to_string())));

        assert_eq!(json_reply.status, 200);
        assert!(json_reply
            .headers
            .contains(&("content-type", JSON.to_string())));
        assert!(json_reply
            .headers
            .contains(&("cache-control", "no-store".to_string())));
        assert!(json_reply
            .headers
            .contains(&("x-content-type-options", "nosniff".to_string())));
        assert!(json_reply
            .headers
            .contains(&("x-fortune-id", "off-color-1".to_string())));
        assert!(json_reply.body.ends_with('\n'));

        let body = json_reply.body.trim_end();
        let id_at = body.find("\"id\"").unwrap();
        let fortune_at = body.find("\"fortune\"").unwrap();
        let locale_at = body.find("\"locale\"").unwrap();
        let category_at = body.find("\"category\"").unwrap();
        assert!(id_at < fortune_at && fortune_at < locale_at && locale_at < category_at);
        let parsed: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.as_object().unwrap().len(), 4);
        assert_eq!(parsed["id"], "off-color-1");
        assert_eq!(parsed["fortune"], fortune);
        assert_eq!(parsed["locale"], "en");
        assert_eq!(parsed["category"], "off-color");
    }

    #[test]
    fn invalid_format_is_rejected_and_errors_stay_plain_text() {
        for query in [
            "format=",
            "format=text",
            "format=JSON",
            "format=plain",
            "format=json ",
            "format=cowsay ",
            "format=COWSAY",
            "format=xml",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (400, "Invalid format.\n"),
                "{query}"
            );
            assert!(reply.headers.iter().any(|(name, value)| {
                *name == "content-type" && value.starts_with("text/plain")
            }));
        }

        for (query, status, body) in [
            (
                "format=json&format=json",
                400,
                "Only one locale and category parameter are supported.\n",
            ),
            (
                "format=json&locale=en&locale=pt",
                400,
                "Only one locale and category parameter are supported.\n",
            ),
            ("format=json&locale=fr", 400, "Unsupported locale.\n"),
            ("format=json&fortune=art-99", 404, "Fortune not found.\n"),
            (
                "format=json&category=nope",
                404,
                "Fortune category not found.\n",
            ),
            ("format=text&category=../etc", 400, "Invalid category.\n"),
            (
                "format=json&category=art&fortune=zippy-0",
                404,
                "Fortune not found.\n",
            ),
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (status, body),
                "{query}"
            );
            assert!(
                reply.headers.iter().any(|(name, value)| {
                    *name == "content-type" && value.starts_with("text/plain")
                }),
                "{query}"
            );
        }

        assert_eq!(
            reply_of(get("/categories", Some("format=json"))).body,
            "Only one locale and category parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/categories", Some("format=cowsay"))).body,
            "Only one locale and category parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("format=cowsay&cow=tux"))).body,
            "Only one locale, category, cow, and fortune parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/categories", Some("locale=pt&format=json"))).body,
            "Only one locale and category parameter are supported.\n"
        );
    }

    #[test]
    fn cowsay_format_selects_the_same_fortune_as_plain_text() {
        let cases = [
            (None, "format=cowsay", "default", 0.0),
            (
                Some("locale=en"),
                "locale=en&format=cowsay&cow=default",
                "default",
                0.4,
            ),
            (
                Some("category=art"),
                "category=art&format=cowsay&cow=tux",
                "tux",
                0.999,
            ),
            (
                Some("fortune=zippy-2"),
                "cow=tux&format=cowsay&fortune=zippy-2",
                "tux",
                0.2,
            ),
            (
                Some("locale=pt&fortune=brasil-3"),
                "locale=pt&fortune=brasil-3&format=cowsay",
                "default",
                0.7,
            ),
            (
                Some("category=art&fortune=art-1"),
                "format=cowsay&cow=tux&category=art&fortune=art-1",
                "tux",
                0.1,
            ),
            (
                Some("locale=pt"),
                "format=cowsay&locale=pt&cow=tux",
                "tux",
                0.5,
            ),
            (Some("category="), "category=&format=cowsay", "default", 0.4),
        ];
        for (plain, formatted, cow, random) in cases {
            let plain_action = handle("GET", "/", plain, &manifest(), random);
            let cowsay_action = handle("GET", "/", Some(formatted), &manifest(), random);
            assert!(
                matches!(plain_action, Action::Fortune { .. }),
                "plain {plain:?} stayed text: {plain_action:?}"
            );
            match cowsay_action {
                Action::FortuneCowsay {
                    cow: chosen,
                    locale,
                    database,
                    index,
                } => {
                    assert_eq!(chosen, cow, "{formatted}");
                    assert_eq!(
                        Action::Fortune {
                            locale,
                            database,
                            index,
                        },
                        plain_action,
                        "{plain:?} vs {formatted}"
                    );
                }
                other => panic!("cowsay {formatted}: {other:?}"),
            }
            assert_eq!(
                handle("HEAD", "/", Some(formatted), &manifest(), random),
                handle("GET", "/", Some(formatted), &manifest(), random),
                "HEAD {formatted}"
            );
        }
    }

    #[test]
    fn cowsay_rejects_invalid_and_unknown_cows_and_ignores_cow_otherwise() {
        for query in [
            "format=cowsay&cow=../etc",
            "format=cowsay&cow=",
            "format=cowsay&cow=a%20b",
            "format=cowsay&cow=a/b",
            "format=cowsay&cow=has space",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (400, "Invalid cow.\n"),
                "{query}"
            );
            assert!(reply.headers.iter().any(|(name, value)| {
                *name == "content-type" && value.starts_with("text/plain")
            }));
        }

        for query in [
            "format=cowsay&cow=moose",
            "format=cowsay&cow=..",
            "cow=moose&format=cowsay",
            "format=cowsay&cow=moose&fortune=art-99",
            "format=cowsay&cow=moose&category=nope",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (404, "Cow not found.\n"),
                "{query}"
            );
            assert!(reply.headers.iter().any(|(name, value)| {
                *name == "content-type" && value.starts_with("text/plain")
            }));
        }

        for query in [
            "cow=tux",
            "format=json&cow=tux",
            "cow=../etc",
            "format=xml&cow=tux",
            "locale=fr&cow=tux",
            "cow=tux&locale",
            "format=cowsay&cow=tux&cow=default",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (
                    400,
                    "Only one locale and category parameter are supported.\n"
                ),
                "{query}"
            );
        }

        for (query, status, body) in [
            ("format=cowsay&locale=fr", 400, "Unsupported locale.\n"),
            ("format=cowsay&fortune=art-99", 404, "Fortune not found.\n"),
            (
                "format=cowsay&category=nope",
                404,
                "Fortune category not found.\n",
            ),
            ("format=cowsay&category=../etc", 400, "Invalid category.\n"),
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (status, body),
                "{query}"
            );
            assert!(
                reply.headers.iter().any(|(name, value)| {
                    *name == "content-type" && value.starts_with("text/plain")
                }),
                "{query}"
            );
        }
    }

    #[test]
    fn missing_default_cow_is_not_found_for_cowsay() {
        let manifest = serde_json::from_str(
            r#"{
              "locales": [{
                "id": "en", "name": "English", "categories": ["art"],
                "databases": { "art": 2 }
              }],
              "cows": ["tux"]
            }"#,
        )
        .unwrap();
        let missing = reply_of(handle("GET", "/", Some("format=cowsay"), &manifest, 0.0));
        assert_eq!(
            (missing.status, missing.body.as_str()),
            (404, "Cow not found.\n")
        );
        match handle(
            "GET",
            "/",
            Some("format=cowsay&cow=tux&fortune=art-1"),
            &manifest,
            0.9,
        ) {
            Action::FortuneCowsay {
                cow,
                database,
                index,
                ..
            } => {
                assert_eq!(cow, "tux");
                assert_eq!(database, "art");
                assert_eq!(index, 1);
            }
            other => panic!("expected tux, got {other:?}"),
        }
    }

    #[test]
    fn cowsay_body_wraps_multiline_fortunes_and_keeps_the_id_header() {
        let fortune = "line one\nline two is longer\nshort\n";
        let art = "   \\\n    \\ tux";
        let reply = fortune_cowsay("off-color", 1, fortune, art);
        assert_eq!(reply.status, 200);
        assert!(reply.headers.contains(&("content-type", TEXT.to_string())));
        assert!(reply
            .headers
            .contains(&("cache-control", "no-store".to_string())));
        assert!(reply
            .headers
            .contains(&("x-content-type-options", "nosniff".to_string())));
        assert!(reply
            .headers
            .contains(&("x-fortune-id", "off-color-1".to_string())));
        assert_eq!(
            reply.body,
            [
                " ____________________",
                "/ line one           \\",
                "| line two is longer |",
                "\\ short              /",
                " --------------------",
                "   \\",
                "    \\ tux",
                "",
            ]
            .join("\n")
        );
        assert!(reply.body.ends_with('\n'));
        assert!(!reply.body.contains("&lt;"));

        let long = "The quick brown fox jumps over the lazy dog again and again.\n";
        let wrapped = fortune_cowsay("art", 0, long, "COW");
        assert!(wrapped
            .headers
            .contains(&("x-fortune-id", "art-0".to_string())));
        assert_eq!(
            wrapped.body,
            [
                " _____________________________________________",
                "/ The quick brown fox jumps over the lazy dog \\",
                "\\ again and again.                            /",
                " ---------------------------------------------",
                "COW",
                "",
            ]
            .join("\n")
        );

        let markup = fortune_cowsay("art", 2, "<script>alert(\"1\")</script>\n", "X");
        assert!(markup.body.contains("<script>alert(\"1\")</script>"));
        assert!(!markup.body.contains("&lt;"));
        assert!(markup.body.ends_with("\nX\n"));
    }

    fn length_manifest() -> Manifest {
        serde_json::from_str(
            r#"{
              "locales": [
                {
                  "id": "en", "name": "English",
                  "categories": ["art", "poem", "zippy"],
                  "databases": { "art": 4, "poem": 2, "zippy": 3 },
                  "short": { "art": [0, 2], "poem": [], "zippy": [1] },
                  "long": { "art": [1, 3], "poem": [0, 1], "zippy": [0, 2] }
                },
                {
                  "id": "pt", "name": "Português", "categories": [],
                  "databases": { "brasil": 4 },
                  "short": { "brasil": [] },
                  "long": { "brasil": [3, 1, 0, 2] }
                }
              ],
              "cows": ["default", "tux"]
            }"#,
        )
        .unwrap()
    }

    fn length_at(query: &str, random: f64) -> Action {
        handle("GET", "/", Some(query), &length_manifest(), random)
    }

    fn picked(locale: &str, database: &str, index: usize) -> Action {
        Action::Fortune {
            locale: locale.to_string(),
            database: database.to_string(),
            index,
        }
    }

    #[test]
    fn omitting_length_keeps_count_weighted_selection() {
        // art index 3 is long-only, poem sits between art and zippy and is
        // entirely long. Unfiltered draws still walk database counts.
        assert_eq!(length_at("locale=en", 0.0), picked("en", "art", 0));
        assert_eq!(length_at("locale=en", 0.34), picked("en", "art", 3));
        assert_eq!(length_at("locale=en", 0.5), picked("en", "poem", 0));
        assert_eq!(length_at("locale=en", 0.6), picked("en", "poem", 1));
        assert_eq!(length_at("locale=en", 0.7), picked("en", "zippy", 0));
        assert_eq!(length_at("locale=en", 0.999), picked("en", "zippy", 2));
        assert_eq!(length_at("locale=pt", 0.0), picked("pt", "brasil", 0));
        assert_eq!(
            handle("GET", "/", None, &length_manifest(), 0.34),
            picked("en", "art", 3)
        );
    }

    #[test]
    fn length_selects_uniformly_over_matching_indexes() {
        // Short lists: art [0, 2], poem [], zippy [1]. poem is skipped.
        assert_eq!(length_at("length=short", 0.0), picked("en", "art", 0));
        assert_eq!(length_at("length=short", 0.2), picked("en", "art", 0));
        assert_eq!(length_at("length=short", 0.4), picked("en", "art", 2));
        assert_eq!(length_at("length=short", 0.8), picked("en", "zippy", 1));
        assert_eq!(length_at("length=short", 0.999), picked("en", "zippy", 1));

        // Long lists: art [1, 3], poem [0, 1], zippy [0, 2].
        assert_eq!(length_at("length=long", 0.0), picked("en", "art", 1));
        assert_eq!(length_at("length=long", 0.1), picked("en", "art", 1));
        assert_eq!(length_at("length=long", 0.2), picked("en", "art", 3));
        assert_eq!(length_at("length=long", 0.4), picked("en", "poem", 0));
        assert_eq!(length_at("length=long", 0.6), picked("en", "poem", 1));
        assert_eq!(length_at("length=long", 0.7), picked("en", "zippy", 0));
        assert_eq!(length_at("length=long", 0.9), picked("en", "zippy", 2));
        assert_eq!(length_at("length=long", 0.999), picked("en", "zippy", 2));

        // List order is the walk order, not the numeric order of the indexes.
        assert_eq!(
            length_at("locale=pt&length=long", 0.0),
            picked("pt", "brasil", 3)
        );
        assert_eq!(
            length_at("locale=pt&length=long", 0.3),
            picked("pt", "brasil", 1)
        );
        assert_eq!(
            length_at("locale=pt&length=long", 0.6),
            picked("pt", "brasil", 0)
        );
        assert_eq!(
            length_at("locale=pt&length=long", 0.9),
            picked("pt", "brasil", 2)
        );
    }

    #[test]
    fn length_combines_with_category_and_response_format() {
        let cases = [
            (
                "length=short&category=zippy",
                "category=zippy&length=short&format=json",
                "length=short&category=zippy&format=cowsay&cow=tux",
                "tux",
                0.0,
                picked("en", "zippy", 1),
            ),
            (
                "length=long&category=art",
                "format=json&length=long&category=art",
                "format=cowsay&cow=default&category=art&length=long",
                "default",
                0.999,
                picked("en", "art", 3),
            ),
            (
                "locale=pt&length=long",
                "locale=pt&length=long&format=json",
                "locale=pt&length=long&format=cowsay&cow=tux",
                "tux",
                0.0,
                picked("pt", "brasil", 3),
            ),
            (
                "length=short",
                "format=json&length=short",
                "length=short&format=cowsay",
                "default",
                0.4,
                picked("en", "art", 2),
            ),
            (
                "category=poem&length=long",
                "category=poem&length=long&format=json",
                "format=cowsay&cow=tux&length=long&category=poem",
                "tux",
                0.999,
                picked("en", "poem", 1),
            ),
        ];
        for (plain, json, cowsay, cow, random, expected) in cases {
            assert_eq!(length_at(plain, random), expected, "{plain}");
            assert_eq!(
                as_plain_fortune(length_at(json, random)),
                expected,
                "{json}"
            );
            assert!(
                matches!(length_at(json, random), Action::FortuneJson { .. }),
                "{json}"
            );
            match length_at(cowsay, random) {
                Action::FortuneCowsay {
                    cow: chosen,
                    locale,
                    database,
                    index,
                } => {
                    assert_eq!(chosen, cow, "{cowsay}");
                    assert_eq!(
                        Action::Fortune {
                            locale,
                            database,
                            index,
                        },
                        expected,
                        "{cowsay}"
                    );
                }
                other => panic!("cowsay {cowsay}: {other:?}"),
            }
            assert_eq!(
                handle("HEAD", "/", Some(plain), &length_manifest(), random),
                length_at(plain, random),
                "HEAD {plain}"
            );
        }
    }

    #[test]
    fn invalid_length_and_length_with_fortune_are_rejected() {
        for query in [
            "length=",
            "length=SHORT",
            "length=Long",
            "length=tiny",
            "length=0",
            "length=160",
            "length=short ",
            "length=long\n",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (400, "Invalid length.\n"),
                "{query}"
            );
            assert!(reply.headers.iter().any(|(name, value)| {
                *name == "content-type" && value.starts_with("text/plain")
            }));
        }

        for query in [
            "length=short&length=long",
            "length=short&length=short",
            "length=long&locale=en&length=short",
            "LENGTH=short",
            "length=short&cow=tux",
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (
                    400,
                    "Only one locale and category parameter are supported.\n"
                ),
                "{query}"
            );
        }

        for query in [
            "length=short&fortune=art-0",
            "fortune=zippy-2&length=long",
            "length=long&format=json&fortune=zippy-2",
            "format=cowsay&cow=tux&length=short&fortune=art-1",
            "length=short&fortune=art-99",
            "locale=pt&length=long&fortune=brasil-3",
            "category=art&length=short&fortune=art-0&format=json",
        ] {
            let reply = reply_of(length_at(query, 0.2));
            assert_eq!(
                (reply.status, reply.body.as_str()),
                (400, "Length cannot be combined with fortune.\n"),
                "{query}"
            );
            assert!(reply.headers.iter().any(|(name, value)| {
                *name == "content-type" && value.starts_with("text/plain")
            }));
        }

        // Syntax and other parameters are still reported first.
        for (query, body) in [
            ("length=short&fortune=art-01", "Invalid fortune.\n"),
            ("length=nope&fortune=art-0", "Invalid length.\n"),
            ("format=xml&length=short", "Invalid format.\n"),
            ("length=long&locale=fr", "Unsupported locale.\n"),
            ("length=short&category=../etc", "Invalid category.\n"),
            ("length=short&format=cowsay&cow=../etc", "Invalid cow.\n"),
        ] {
            let reply = reply_of(get("/", Some(query)));
            assert_eq!((reply.status, reply.body.as_str()), (400, body), "{query}");
        }

        assert_eq!(
            reply_of(get("/categories", Some("length=short"))).body,
            "Only one locale and category parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/categories", Some("locale=pt&length=long"))).body,
            "Only one locale and category parameter are supported.\n"
        );
        assert_eq!(
            reply_of(get("/og.png", Some("length=short"))).body,
            "Only one locale, category, cow, and fortune parameter are supported.\n"
        );
    }

    #[test]
    fn length_with_no_match_is_not_found() {
        for (query, body) in [
            ("length=short&category=poem", "No fortune of that length.\n"),
            ("locale=pt&length=short", "No fortune of that length.\n"),
            (
                "locale=pt&length=short&format=json",
                "No fortune of that length.\n",
            ),
            (
                "category=poem&length=short&format=cowsay&cow=tux",
                "No fortune of that length.\n",
            ),
            (
                "category=nope&length=short",
                "Fortune category not found.\n",
            ),
            (
                "locale=pt&category=brasil&length=long",
                "Fortune category not found.\n",
            ),
            ("length=short&format=cowsay&cow=moose", "Cow not found.\n"),
        ] {
            let reply = reply_of(length_at(query, 0.4));
            assert_eq!((reply.status, reply.body.as_str()), (404, body), "{query}");
            assert!(
                reply.headers.iter().any(|(name, value)| {
                    *name == "content-type" && value.starts_with("text/plain")
                }),
                "{query}"
            );
        }

        // The default fixture has fortunes and no length lists, so a filter
        // matches nothing while an unfiltered draw still succeeds.
        let missing = reply_of(get("/", Some("length=long")));
        assert_eq!(
            (missing.status, missing.body.as_str()),
            (404, "No fortune of that length.\n")
        );
        assert!(matches!(get("/", None), Action::Fortune { .. }));
    }
}
