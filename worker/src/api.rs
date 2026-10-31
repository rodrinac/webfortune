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
    pub databases: BTreeMap<String, usize>,
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
    /// Render a 1200×630 PNG. `fortune` is absent for the branded default card.
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

#[derive(Debug, PartialEq)]
struct FortuneQuery<'a> {
    locale: &'a str,
    category: &'a str,
    fortune: Option<&'a str>,
}

const TEXT: &str = "text/plain; charset=utf-8";
const JSON: &str = "application/json; charset=utf-8";

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
    parse_query_with(manifest, query, false)
}

fn parse_query_with<'a>(
    manifest: &Manifest,
    query: Option<&'a str>,
    allow_fortune: bool,
) -> Result<FortuneQuery<'a>, &'static str> {
    let Some(query) = query else {
        return Ok(FortuneQuery {
            locale: "en",
            category: "",
            fortune: None,
        });
    };

    let mut locale = None;
    let mut category = None;
    let mut fortune = None;
    for parameter in query.split('&') {
        let Some((name, value)) = parameter.split_once('=') else {
            return Err("Malformed query string.\n");
        };
        match name {
            "locale" if locale.replace(value).is_none() => {}
            "category" if category.replace(value).is_none() => {}
            "fortune" if allow_fortune && fortune.replace(value).is_none() => {}
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

    Ok(FortuneQuery {
        locale,
        category,
        fortune,
    })
}

fn find_locale<'a>(manifest: &'a Manifest, id: &str) -> Option<&'a Locale> {
    manifest.locales.iter().find(|locale| locale.id == id)
}

/// Picks a fortune the way fortune-mod does: databases are weighted by how
/// many fortunes they hold, so every fortune is equally likely.
fn pick<'a>(
    databases: impl Iterator<Item = (&'a str, usize)> + Clone,
    random: f64,
) -> Option<(&'a str, usize)> {
    let total: usize = databases.clone().map(|(_, count)| count).sum();
    let mut target = ((random * total as f64) as usize).min(total.checked_sub(1)?);
    for (database, count) in databases {
        if target < count {
            return Some((database, target));
        }
        target -= count;
    }
    None
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

fn fortune(manifest: &Manifest, query: Option<&str>, random: f64) -> Action {
    let query = match parse_query_with(manifest, query, true) {
        Ok(query) => query,
        Err(error) => return Action::Reply(text(400, error)),
    };
    let locale = find_locale(manifest, query.locale).expect("validated locale");
    if let Some(id) = query.fortune {
        return pinned_fortune(locale, query.category, id);
    }
    let picked = if query.category.is_empty() {
        pick(
            locale
                .databases
                .iter()
                .map(|(name, count)| (name.as_str(), *count)),
            random,
        )
    } else if locale.categories.iter().any(|name| name == query.category) {
        locale
            .databases
            .get_key_value(query.category)
            .and_then(|(name, count)| pick(std::iter::once((name.as_str(), *count)), random))
    } else {
        return Action::Reply(text(404, "Fortune category not found.\n"));
    };

    match picked {
        Some((database, index)) => Action::Fortune {
            locale: locale.id.clone(),
            database: database.to_string(),
            index,
        },
        None => Action::Reply(text(503, "Fortune service unavailable.\n")),
    }
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
    if method != "GET" {
        return Action::Reply(Reply {
            status: 405,
            headers: vec![
                ("allow", "GET".to_string()),
                ("content-type", TEXT.to_string()),
            ],
            body: "Method not allowed.\n".to_string(),
        });
    }

    let reply = match path {
        "/health" if !manifest.locales.is_empty() && !manifest.cows.is_empty() => {
            reply(200, JSON, "{\"status\":\"ok\"}\n")
        }
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
            Action::Cow(_) | Action::OgImage(_) => {
                return Err(text(500, "Failed to load fortune.\n"))
            }
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
        assert_eq!(reply_of(get("/health", None)).status, 200);
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
    fn only_get_and_preflight_are_allowed() {
        let reply = reply_of(handle("POST", "/", None, &manifest(), 0.0));
        assert_eq!(reply.status, 405);
        assert!(reply.headers.contains(&("allow", "GET".to_string())));
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
        assert_eq!(reply_of(get("/og.png", Some("category=nope"))).status, 404);
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
}
