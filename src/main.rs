use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::env;
use tokio::net::TcpListener;

use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::process::{Command, Output};

#[derive(Serialize)]
#[serde(transparent)]
struct CategoriesResponse {
    #[serde(flatten)]
    data: HashSet<String>,
}

fn get_fortune_files() -> Result<HashSet<String>, String> {
    Command::new("fortune")
        .args(["-f"])
        .output()
        .map_err(|_| "Failed to load fortune!".to_string())
        .and_then(|output: Output| {
            String::from_utf8(output.stderr).map_err(|_| "Failed to parse fortune!".to_string())
        })
        .map(|stdout| {
            stdout
                .lines()
                .enumerate()
                .filter_map(|(i, line)| {
                    if i > 0 {
                        line.split_whitespace().last().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect::<HashSet<String>>()
        })
}

fn get_fortune(category: String) -> Result<String, String> {
    Command::new("fortune")
        .args(["-a", category.as_str()])
        .output()
        .map_err(|_| "Failed to load fortune!".to_string())
        .and_then(|output: Output| {
            String::from_utf8(output.stdout).map_err(|_| "Failed to parse fortune!".to_string())
        })
}

static FORTUNE_FILES: Lazy<HashSet<String>> = Lazy::new(|| {
    get_fortune_files().unwrap_or_else(|err| {
        eprintln!("Error initializing FORTUNE_FILES: {err}");
        HashSet::new()
    })
});

async fn handle_request(req: Request<Incoming>) -> Result<Response<String>, hyper::http::Error> {
    let path = req.uri().path();

    if path == "/categories" {
        let response = CategoriesResponse {
            data: FORTUNE_FILES.clone(), // <- clone that HashSet
        };
        let body = serde_json::to_string(&response).unwrap_or_else(|_| "[]".to_string());

        return Ok(Response::new(body + "\n"));
    }

    // path == "/"
    let category = req
        .uri()
        .query()
        .and_then(|q| q.strip_prefix("category="))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let result = get_fortune(category);

    let fortune = match result {
        Ok(text) => Response::new(text),
        Err(err) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(err)
            .unwrap(),
    };

    Ok(fortune)
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

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);

        tokio::task::spawn(async move {
            if let Err(err) = http1::Builder::new()
                .serve_connection(io, service_fn(handle_request))
                .await
            {
                println!("Error serving connection: {:?}", err);
            }
        });
    }
}
