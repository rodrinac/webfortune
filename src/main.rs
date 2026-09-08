use std::collections::HashSet;
use std::env;
use std::net::{IpAddr, SocketAddr};
use std::process::Output;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::process::Command;

use hyper::header::{ACCESS_CONTROL_ALLOW_ORIGIN, ALLOW, CACHE_CONTROL, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;

#[derive(Serialize)]
#[serde(transparent)]
struct CategoriesResponse {
    data: HashSet<String>,
}

fn response(status: StatusCode, content_type: &'static str, body: String) -> Response<String> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, content_type)
        .header(CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .body(body)
        .expect("a static HTTP response is valid")
}

async fn run_fortune(args: Vec<String>) -> Result<Output, String> {
    tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("fortune")
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Failed to load fortune.".to_string())?
    .map_err(|_| "Failed to load fortune.".to_string())
}

async fn get_fortune_files() -> Result<HashSet<String>, String> {
    let output = run_fortune(vec!["-f".to_string()]).await?;
    if !output.status.success() {
        return Err("Failed to load fortune categories.".to_string());
    }

    String::from_utf8(output.stderr)
        .map_err(|_| "Failed to parse fortune categories.".to_string())
        .map(|categories| {
            categories
                .lines()
                .skip(1)
                .filter_map(|line| line.split_whitespace().last().map(str::to_owned))
                .collect()
        })
}

async fn get_fortune(category: &str) -> Result<String, String> {
    let args = if category.is_empty() {
        Vec::new()
    } else {
        vec!["--".to_string(), category.to_string()]
    };
    let output = run_fortune(args).await?;
    if !output.status.success() {
        return Err("Fortune category not found.".to_string());
    }

    String::from_utf8(output.stdout).map_err(|_| "Failed to parse fortune.".to_string())
}

fn parse_category(query: Option<&str>) -> Result<String, &'static str> {
    let Some(query) = query else {
        return Ok(String::new());
    };

    let mut category = None;
    for parameter in query.split('&') {
        let Some((name, value)) = parameter.split_once('=') else {
            return Err("Malformed query string.\n");
        };
        if name != "category" || category.replace(value).is_some() {
            return Err("Only one category parameter is supported.\n");
        }
    }

    let category = category.unwrap_or_default();
    if !category.is_empty()
        && !category.bytes().all(|character| {
            character.is_ascii_alphanumeric() || character == b'-' || character == b'_'
        })
    {
        return Err("Invalid category.\n");
    }

    Ok(category.to_string())
}

async fn route_request<B>(req: Request<B>) -> Result<Response<String>, hyper::http::Error> {
    if req.method() != Method::GET {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(ALLOW, "GET")
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body("Method not allowed.\n".to_string());
    }

    if req.uri().path() == "/health" {
        return Ok(match get_fortune_files().await {
            Ok(categories) if !categories.is_empty() => response(
                StatusCode::OK,
                "application/json; charset=utf-8",
                "{\"status\":\"ok\"}\n".to_string(),
            ),
            _ => response(
                StatusCode::SERVICE_UNAVAILABLE,
                "text/plain; charset=utf-8",
                "Fortune service unavailable.\n".to_string(),
            ),
        });
    }

    if req.uri().path() == "/categories" {
        return match get_fortune_files().await {
            Ok(data) => match serde_json::to_string(&CategoriesResponse { data }) {
                Ok(body) => Ok(response(
                    StatusCode::OK,
                    "application/json; charset=utf-8",
                    format!("{body}\n"),
                )),
                Err(_) => Ok(response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "text/plain; charset=utf-8",
                    "Failed to serialize fortune categories.\n".to_string(),
                )),
            },
            Err(error) => Ok(response(
                StatusCode::SERVICE_UNAVAILABLE,
                "text/plain; charset=utf-8",
                format!("{error}\n"),
            )),
        };
    }

    if req.uri().path() != "/" {
        return Ok(response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            "Not found.\n".to_string(),
        ));
    }

    let category = match parse_category(req.uri().query()) {
        Ok(category) => category,
        Err(error) => {
            return Ok(response(
                StatusCode::BAD_REQUEST,
                "text/plain; charset=utf-8",
                error.to_string(),
            ));
        }
    };

    // Only pass installed category names to the executable, never arbitrary paths/options.
    match get_fortune_files().await {
        Ok(categories) if !category.is_empty() && !categories.contains(&category) => {
            return Ok(response(
                StatusCode::NOT_FOUND,
                "text/plain; charset=utf-8",
                "Fortune category not found.\n".to_string(),
            ));
        }
        Err(_) => {
            return Ok(response(
                StatusCode::SERVICE_UNAVAILABLE,
                "text/plain; charset=utf-8",
                "Fortune service unavailable.\n".to_string(),
            ))
        }
        _ => {}
    }

    match get_fortune(&category).await {
        Ok(text) => Ok(response(StatusCode::OK, "text/plain; charset=utf-8", text)),
        Err(error) => Ok(response(
            StatusCode::SERVICE_UNAVAILABLE,
            "text/plain; charset=utf-8",
            format!("{error}\n"),
        )),
    }
}

async fn handle_request<B>(
    req: Request<B>,
    cors: Option<String>,
) -> Result<Response<String>, hyper::http::Error> {
    let mut result = route_request(req).await?;
    if let Some(origin) = cors {
        result.headers_mut().insert(
            ACCESS_CONTROL_ALLOW_ORIGIN,
            origin.parse().expect("validated CORS origin"),
        );
    }
    Ok(result)
}

fn get_host_and_port() -> (IpAddr, u16) {
    let host = env::var("MY_APP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("MY_APP_PORT").unwrap_or_else(|_| "8080".to_string());

    (
        host.parse::<IpAddr>().unwrap(),
        port.parse::<u16>().unwrap(),
    )
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (host, port) = get_host_and_port();
    let addr = SocketAddr::from((host, port));

    let listener = TcpListener::bind(addr).await?;
    // API Gateway manages production CORS. This setting supports local web development.
    let cors = env::var("CORS_ALLOW_ORIGIN").ok();
    if let Some(origin) = &cors {
        let uri: hyper::Uri = origin.parse()?;
        if !matches!(uri.scheme_str(), Some("http" | "https"))
            || uri.authority().is_none()
            || uri
                .path_and_query()
                .is_some_and(|path| path.as_str() != "/")
            || origin.contains('*')
        {
            return Err("CORS_ALLOW_ORIGIN must be one exact HTTP(S) origin".into());
        }
    }

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let cors = cors.clone();

        tokio::task::spawn(async move {
            if let Err(err) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle_request(req, cors.clone())))
                .await
            {
                println!("Error serving connection: {:?}", err);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{handle_request, parse_category};
    use hyper::{Request, StatusCode};

    #[tokio::test]
    async fn routes_and_errors_preserve_cors() {
        for (method, path, status) in [
            ("POST", "/", StatusCode::METHOD_NOT_ALLOWED),
            ("GET", "/missing", StatusCode::NOT_FOUND),
            ("GET", "/?category=../secret", StatusCode::BAD_REQUEST),
        ] {
            let request = Request::builder()
                .method(method)
                .uri(path)
                .body(())
                .unwrap();
            let response = handle_request(request, Some("http://localhost:5173".into()))
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            assert_eq!(
                response.headers()["access-control-allow-origin"],
                "http://localhost:5173"
            );
        }
    }

    #[test]
    fn parses_an_optional_category() {
        assert_eq!(parse_category(None), Ok(String::new()));
        assert_eq!(
            parse_category(Some("category=ascii-art")),
            Ok("ascii-art".to_string())
        );
    }

    #[test]
    fn rejects_ambiguous_or_malformed_queries() {
        assert!(parse_category(Some("foo=bar")).is_err());
        assert!(parse_category(Some("category=computers&category=linuxcookie")).is_err());
        assert!(parse_category(Some("category=computers&foo=bar")).is_err());
        assert!(parse_category(Some("category=not%20valid")).is_err());
    }
}
