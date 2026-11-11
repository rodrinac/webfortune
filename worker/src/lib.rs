pub mod api;
mod card;
mod cowsay;
mod preview;
mod security;

#[cfg(target_arch = "wasm32")]
mod runtime {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    use worker::{
        event, js_sys, web_sys, Context, Env, Error, Fetch, Fetcher, Request, Response,
        ResponseBody, Result,
    };

    use crate::api::{self, Action, Manifest, OgImage, Reply};
    use crate::{card, preview, security};

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

    async fn fortune_reply(
        assets: &Fetcher,
        locale: &str,
        name: &str,
        index: usize,
        json: bool,
    ) -> Reply {
        match database(assets, locale, name)
            .await
            .and_then(|fortunes| fortunes.get(index).cloned())
        {
            Some(fortune) if json => api::fortune_json(locale, name, index, &fortune),
            Some(fortune) => api::with_fortune_id(api::text(200, fortune), name, index),
            None => api::text(503, "Failed to load fortune.\n"),
        }
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
            } => fortune_reply(assets, &locale, &name, index, false).await,
            Action::FortuneJson {
                locale,
                database: name,
                index,
            } => fortune_reply(assets, &locale, &name, index, true).await,
            Action::FortuneCowsay {
                locale,
                database: name,
                index,
                cow,
            } => {
                // Same asset path as `/cows/{name}` and `render_og`.
                let Some(art) = asset(assets, &format!("cows/{cow}.txt")).await else {
                    return api::text(503, "Failed to load cows.\n");
                };
                match database(assets, &locale, &name)
                    .await
                    .and_then(|fortunes| fortunes.get(index).cloned())
                {
                    Some(fortune) => api::fortune_cowsay(&name, index, &fortune, &art),
                    None => api::text(503, "Failed to load fortune.\n"),
                }
            }
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
        // webfortune.app rewrites permalink HTML. Every other site request is
        // fetched from the origin unchanged.
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
        // Generated images ignore Range and stay a full 200. A byte slice of
        // the PNG would be a different response than the one GET advertises.
        maybe_head(response, method == "HEAD")
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
        maybe_head(response, method == "HEAD")
    }

    /// HEAD keeps the GET status and headers, including content-length when the
    /// body length is known, and sends no body.
    fn maybe_head(response: Response, omit_body: bool) -> Result<Response> {
        if !omit_body {
            return Ok(response);
        }
        let status = response.status_code();
        if !(200..=599).contains(&status) {
            return Ok(response);
        }
        let known_len = match response.body() {
            ResponseBody::Body(bytes) => Some(bytes.len()),
            ResponseBody::Empty => Some(0),
            ResponseBody::Stream(_) => None,
        };
        let (builder, _) = response.into_parts();
        let builder = if let Some(len) = known_len {
            builder.with_header("content-length", &len.to_string())?
        } else {
            builder
        };
        Ok(builder.empty())
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
        let Some(plan) = preview::permalink_plan(request.method().as_ref(), query.as_deref())
        else {
            // Non-permalink requests keep the origin body, status, and cache
            // headers. HTML also gets the security headers; other assets do not.
            let mut response = Fetch::Request(request).send().await?;
            apply_html_security_headers(&mut response)?;
            return Ok(response);
        };

        // Fetch the full document. The client may have sent HEAD or Range;
        // Pages would answer those with no body or a 206 of the static tags.
        let upstream = origin_document(&request, &plan)?;
        let mut origin = Fetch::Request(upstream).send().await?;
        let content_type = origin.headers().get("content-type")?.unwrap_or_default();
        if origin.status_code() != 200 || !security::is_html_content_type(&content_type) {
            apply_html_security_headers(&mut origin)?;
            return maybe_head(origin, plan.omit_body);
        }
        let html = origin.text().await?;
        let assets = env.assets("ASSETS")?;
        let Some(manifest) = manifest(&assets).await else {
            return html_response(html, plan.omit_body);
        };
        let Some(target) = api::share_target(&manifest, query.as_deref()) else {
            return html_response(html, plan.omit_body);
        };
        let Some(fortune) = database(&assets, &target.locale, &target.database)
            .await
            .and_then(|fortunes| fortunes.get(target.index).cloned())
        else {
            return html_response(html, plan.omit_body);
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
            .set("x-webfortune-preview", "fortune")?;
        apply_html_security_headers(&mut response)?;
        // Range is ignored: the rewritten document is the full 200 representation.
        maybe_head(response, plan.omit_body)
    }

    /// A GET derived from the incoming request, with preview headers removed,
    /// so the subrequest still goes to the origin.
    fn origin_document(request: &Request, plan: &preview::PermalinkPlan) -> Result<Request> {
        let init = web_sys::RequestInit::new();
        init.set_method(plan.upstream_method);
        let edge = web_sys::Request::new_with_request_and_init(request.inner(), &init)
            .map_err(Error::from)?;
        for name in plan.strip_headers {
            edge.headers().delete(name).map_err(Error::from)?;
        }
        Ok(edge.into())
    }

    fn html_response(html: String, omit_body: bool) -> Result<Response> {
        let mut response = Response::from_html(html)?;
        response
            .headers_mut()
            .set("cache-control", "private, no-store")?;
        apply_html_security_headers(&mut response)?;
        maybe_head(response, omit_body)
    }

    /// Adds the Pages security headers when the response is HTML.
    ///
    /// A response from `fetch` keeps the edge `Headers` object, whose guard is
    /// immutable. Copying into a new header list makes the additions possible
    /// and leaves every origin header, including cache-control, in place.
    /// Non-HTML responses are returned untouched.
    fn apply_html_security_headers(response: &mut Response) -> Result<()> {
        let content_type = response.headers().get("content-type")?.unwrap_or_default();
        if !security::is_html_content_type(&content_type) {
            return Ok(());
        }
        let headers = response.headers().clone();
        for (name, value) in security::html_security_headers() {
            headers.set(&name, &value)?;
        }
        *response.headers_mut() = headers;
        Ok(())
    }
}
