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
}

#[derive(Debug, PartialEq)]
struct FortuneQuery<'a> {
    locale: &'a str,
    category: &'a str,
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

fn parse_query<'a>(
    manifest: &Manifest,
    query: Option<&'a str>,
) -> Result<FortuneQuery<'a>, &'static str> {
    let Some(query) = query else {
        return Ok(FortuneQuery {
            locale: "en",
            category: "",
        });
    };

    let mut locale = None;
    let mut category = None;
    for parameter in query.split('&') {
        let Some((name, value)) = parameter.split_once('=') else {
            return Err("Malformed query string.\n");
        };
        match name {
            "locale" if locale.replace(value).is_none() => {}
            "category" if category.replace(value).is_none() => {}
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

    Ok(FortuneQuery { locale, category })
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

fn fortune(manifest: &Manifest, query: Option<&str>, random: f64) -> Action {
    let query = match parse_query(manifest, query) {
        Ok(query) => query,
        Err(error) => return Action::Reply(text(400, error)),
    };
    let locale = find_locale(manifest, query.locale).expect("validated locale");
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
}
