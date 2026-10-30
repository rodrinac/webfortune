pub mod api;

#[cfg(target_arch = "wasm32")]
mod runtime {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    use worker::{event, js_sys, Context, Env, Fetcher, Request, Response, Result};

    use crate::api::{self, Action, Manifest, Reply};

    // Assets are immutable per deployment, so each isolate parses them once.
    thread_local! {
        static MANIFEST: RefCell<Option<Rc<Manifest>>> = const { RefCell::new(None) };
        static DATABASES: RefCell<HashMap<String, Rc<Vec<String>>>> = RefCell::new(HashMap::new());
    }

    async fn asset(assets: &Fetcher, path: &str) -> Option<String> {
        let mut response = assets
            .fetch(format!("https://assets.invalid/{path}"), None)
            .await
            .ok()?;
        if response.status_code() != 200 {
            return None;
        }
        response.text().await.ok()
    }

    async fn manifest(assets: &Fetcher) -> Option<Rc<Manifest>> {
        if let Some(manifest) = MANIFEST.with_borrow(Clone::clone) {
            return Some(manifest);
        }
        let manifest: Rc<Manifest> =
            Rc::new(serde_json::from_str(&asset(assets, "manifest.json").await?).ok()?);
        MANIFEST.set(Some(manifest.clone()));
        Some(manifest)
    }

    async fn database(assets: &Fetcher, locale: &str, name: &str) -> Option<Rc<Vec<String>>> {
        let key = format!("fortunes/{locale}/{name}.json");
        if let Some(fortunes) = DATABASES.with_borrow(|databases| databases.get(&key).cloned()) {
            return Some(fortunes);
        }
        let fortunes: Rc<Vec<String>> =
            Rc::new(serde_json::from_str(&asset(assets, &key).await?).ok()?);
        DATABASES.with_borrow_mut(|databases| databases.insert(key, fortunes.clone()));
        Some(fortunes)
    }

    async fn resolve(assets: &Fetcher, action: Action) -> Reply {
        match action {
            Action::Reply(reply) => reply,
            Action::Cow(name) => match asset(assets, &format!("cows/{name}.txt")).await {
                Some(art) => api::text(200, art),
                None => api::text(503, "Failed to load cows.\n"),
            },
            Action::Fortune {
                locale,
                database: name,
                index,
            } => match database(assets, &locale, &name)
                .await
                .and_then(|fortunes| fortunes.get(index).cloned())
            {
                Some(fortune) => api::text(200, fortune),
                None => api::text(503, "Failed to load fortune.\n"),
            },
        }
    }

    // Fail closed: missing identity or limiter errors must not bypass the quota.
    async fn within_rate_limit(env: &Env, request: &Request) -> bool {
        let Ok(limiter) = env.rate_limiter("RATE_LIMITER") else {
            return false;
        };
        let Some(client) = request
            .headers()
            .get("cf-connecting-ip")
            .ok()
            .flatten()
            .filter(|ip| !ip.is_empty())
        else {
            return false;
        };
        limiter
            .limit(client)
            .await
            .map_or(false, |outcome| outcome.success)
    }

    #[event(fetch)]
    async fn fetch(request: Request, env: Env, _context: Context) -> Result<Response> {
        let url = request.url()?;
        let method = request.method().to_string();
        let assets = env.assets("ASSETS")?;

        let mut reply = if method != "OPTIONS" && !within_rate_limit(&env, &request).await {
            api::text(429, "Too many requests.\n")
        } else {
            match manifest(&assets).await {
                Some(manifest) => {
                    let action = api::handle(
                        &method,
                        url.path(),
                        url.query(),
                        &manifest,
                        js_sys::Math::random(),
                    );
                    resolve(&assets, action).await
                }
                None => api::text(503, "Fortune service unavailable.\n"),
            }
        };

        let allowed_origins = env
            .var("CORS_ALLOWED_ORIGINS")
            .map(|origins| origins.to_string())
            .unwrap_or_default();
        let origin = request.headers().get("origin")?;
        api::apply_cors(&mut reply, &method, origin.as_deref(), &allowed_origins);

        let mut response = if reply.body.is_empty() {
            Response::empty()?
        } else {
            Response::ok(reply.body)?
        }
        .with_status(reply.status);
        for (name, value) in reply.headers {
            response.headers_mut().set(name, &value)?;
        }
        Ok(response)
    }
}
