pub mod api;
mod card;
mod preview;

#[cfg(target_arch = "wasm32")]
mod runtime {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    use worker::{event, js_sys, Context, Env, Fetch, Fetcher, Method, Request, Response, Result};

    use crate::api::{self, Action, Manifest, OgImage, Reply};
    use crate::{card, preview};

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
                Some(fortune) => api::with_fortune_id(api::text(200, fortune), &name, index),
                None => api::text(503, "Failed to load fortune.\n"),
            },
            // Preview images are rendered before resolve; this keeps the match
            // exhaustive if a caller forwards the action.
            Action::OgImage(_) => api::text(500, "Failed to render preview.\n"),
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
            .is_ok_and(|outcome| outcome.success)
    }

    #[event(fetch)]
    async fn fetch(request: Request, env: Env, _context: Context) -> Result<Response> {
        let url = request.url()?;
        // The site route is not configured. This branch runs only after
        // webfortune.app/* is pointed at the Worker; until then crawlers get
        // the static preview from GitHub Pages.
        if preview::is_pages_host(url.host_str().unwrap_or("")) {
            return proxy_site(request, url, &env).await;
        }

        let method = request.method().to_string();
        let assets = env.assets("ASSETS")?;

        let reply = if method != "OPTIONS" && !within_rate_limit(&env, &request).await {
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
                    match action {
                        Action::OgImage(image) => match render_og(&assets, &image).await {
                            Ok(png) => return png_response(png, &request, &env, &method),
                            Err(reply) => reply,
                        },
                        other => resolve(&assets, other).await,
                    }
                }
                None => api::text(503, "Fortune service unavailable.\n"),
            }
        };

        text_response(reply, &request, &env, &method)
    }

    async fn render_og(assets: &Fetcher, image: &OgImage) -> std::result::Result<Vec<u8>, Reply> {
        let Some(cow) = asset(assets, &format!("cows/{}.txt", image.cow)).await else {
            return Err(api::text(503, "Failed to load cows.\n"));
        };
        let message = if let Some(fortune) = &image.fortune {
            match database(assets, &image.locale, &fortune.database)
                .await
                .and_then(|fortunes| fortunes.get(fortune.index).cloned())
            {
                Some(text) => text,
                None => return Err(api::text(503, "Failed to load fortune.\n")),
            }
        } else {
            card::BRAND_MESSAGE.to_string()
        };
        Ok(card::render_fortune_card(&message, &cow, &image.cow))
    }

    fn png_response(png: Vec<u8>, request: &Request, env: &Env, method: &str) -> Result<Response> {
        let mut response = Response::from_bytes(png)?.with_status(200);
        response.headers_mut().set("content-type", "image/png")?;
        response
            .headers_mut()
            .set("cache-control", "public, max-age=86400")?;
        response
            .headers_mut()
            .set("x-content-type-options", "nosniff")?;
        apply_cors_headers(&mut response, request, env, method)?;
        Ok(response)
    }

    fn text_response(
        mut reply: Reply,
        request: &Request,
        env: &Env,
        method: &str,
    ) -> Result<Response> {
        let allowed_origins = env
            .var("CORS_ALLOWED_ORIGINS")
            .map(|origins| origins.to_string())
            .unwrap_or_default();
        let origin = request.headers().get("origin")?;
        api::apply_cors(&mut reply, method, origin.as_deref(), &allowed_origins);

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

    fn apply_cors_headers(
        response: &mut Response,
        request: &Request,
        env: &Env,
        method: &str,
    ) -> Result<()> {
        let allowed_origins = env
            .var("CORS_ALLOWED_ORIGINS")
            .map(|origins| origins.to_string())
            .unwrap_or_default();
        let origin = request.headers().get("origin")?;
        let mut reply = api::text(200, "");
        api::apply_cors(&mut reply, method, origin.as_deref(), &allowed_origins);
        for (name, value) in reply.headers {
            if name.starts_with("access-control") || name == "vary" {
                response.headers_mut().set(name, &value)?;
            }
        }
        Ok(())
    }

    async fn proxy_site(request: Request, url: worker::Url, env: &Env) -> Result<Response> {
        let query = url.query().map(str::to_owned);
        let wants_preview = matches!(request.method(), Method::Get)
            && query
                .as_deref()
                .is_some_and(preview::query_mentions_fortune);
        if !wants_preview {
            return Fetch::Request(request).send().await;
        }

        let mut origin = Fetch::Request(request).send().await?;
        if origin.status_code() != 200 {
            return Ok(origin);
        }
        let content_type = origin.headers().get("content-type")?.unwrap_or_default();
        if !content_type.to_ascii_lowercase().contains("text/html") {
            return Ok(origin);
        }
        let html = origin.text().await?;
        let assets = env.assets("ASSETS")?;
        let Some(manifest) = manifest(&assets).await else {
            return html_response(html);
        };
        let Some(target) = api::share_target(&manifest, query.as_deref()) else {
            return html_response(html);
        };
        let Some(fortune) = database(&assets, &target.locale, &target.database)
            .await
            .and_then(|fortunes| fortunes.get(target.index).cloned())
        else {
            return html_response(html);
        };
        let meta = preview::share_meta(
            &fortune,
            &target.page_query,
            &target.locale,
            &target.cow,
            &target.fortune_id,
        );
        let mut response = Response::from_html(preview::rewrite_share_html(&html, &meta))?;
        response
            .headers_mut()
            .set("cache-control", "private, no-store")?;
        response
            .headers_mut()
            .set("x-content-type-options", "nosniff")?;
        response
            .headers_mut()
            .set("x-webfortune-preview", "fortune")?;
        Ok(response)
    }

    fn html_response(html: String) -> Result<Response> {
        let mut response = Response::from_html(html)?;
        response
            .headers_mut()
            .set("cache-control", "private, no-store")?;
        Ok(response)
    }
}
