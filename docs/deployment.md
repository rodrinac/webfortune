# Cloudflare Worker + GitHub Pages deployment

## Architecture

`webfortune.app` on GitHub Pages → Cloudflare Worker at `api.webfortune.app`.

The static UI renders the returned text as cowsay-style ASCII art in the browser. The Worker serves pre-generated fortune and cow assets (built by `npm run generate:assets`) with CORS for `https://webfortune.app` and the legacy `https://rodrinac.github.io` origin, plus per-IP rate limiting. There is no database, container registry, or always-running server.

## GitHub settings

Create the `production` environment with deployment branches restricted to `main`. Configure:

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Wrangler deploy |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account targeting |

Enable GitHub Pages with **GitHub Actions** as the source. The `github-pages` environment should allow only `main`.

Verify `webfortune.app` in the owner's GitHub Pages account settings and keep its `_github-pages-challenge-rodrinac` TXT record. Configure the repository Pages custom domain as `webfortune.app`. At the registrar, point the apex to GitHub Pages using its four documented A records and point `www` directly to `rodrinac.github.io` with a CNAME. Do not use wildcard records. Enable HTTPS after GitHub finishes provisioning the certificate.

`api.webfortune.app` is attached as a Worker custom domain via `worker/wrangler.jsonc` (`custom_domain: true`). DNS for that hostname is managed in Cloudflare.

The Release-triggered Deploy workflow pins Worker and Pages to the verified release commit. Pages builds with `VITE_API_URL=https://api.webfortune.app` from the successful Worker job. Manual redeploys use the separate **Deploy production (manual)** workflow, which checks out the selected branch tip only (never a `workflow_run` SHA).

## Verification and recovery

After a successful deployment, open `https://webfortune.app/`. Choose a category, request another fortune, and copy the cow. The pipeline smoke-checks `/health`, random/category fortunes, fortune permalinks (`x-fortune-id` and `?fortune=`), query validation, unknown routes, method rejection, and CORS headers.

To retry a failed Release-triggered deployment, rerun the failed workflow. For an ad-hoc redeploy of the current branch tip, run **Deploy production (manual)**. If the Worker was already updated but Pages failed, the previous UI stays published and remains compatible with the API. Revert a bad application commit with a new commit on main; the normal workflow rebuilds and deploys it.

For failures inspect the workflow logs and Cloudflare Workers observability for `webfortune`. Rate limiting can return 429 during bursts; normal smoke tests intentionally do not expect a deterministic burst cutoff.

## Per-fortune link previews

Every page already advertises `https://webfortune.app/og.png`, a 1200×630 branded card. That static preview works with no Cloudflare change. Crawlers do not run the page's JavaScript, and GitHub Pages serves one `index.html` for every query string, so a permalink such as `/?locale=pt&cow=daemon&fortune=brasil-1730` cannot describe that fortune until something in front of Pages rewrites the HTML.

The Worker can do that rewrite, and it can paint the fortune at `GET /og.png`. Neither requires a DNS or workflow change. The rewrite stays off because `worker/wrangler.jsonc` does not route `webfortune.app` at the Worker. `wrangler deploy` replaces routes from that file, so a route added only in the dashboard disappears on the next deploy.

To enable per-fortune previews:

1. Leave DNS and the GitHub Pages custom domain as they are. `webfortune.app` is already proxied by Cloudflare in front of Pages.
2. Uncomment both site routes in `worker/wrangler.jsonc` (`webfortune.app/*` and `www.webfortune.app/*`). The `/*` is required: Cloudflare only matches a query string when the pattern ends in a wildcard, and permalinks are `/?fortune=...`.
3. Deploy the Worker with the normal release deploy or the manual deploy workflow.
4. Open a permalink in the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or [opengraph.xyz](https://www.opengraph.xyz/). The title and description should contain the fortune text, and the image should be the cow saying it. The image URL is `https://api.webfortune.app/og.png` with `locale`, `fortune`, and, when it is not `default`, `cow`. Rewritten HTML responses include `x-webfortune-preview: fortune`. The homepage, and any URL whose fortune id does not resolve, keeps the static card.

Enabling the routes sends every request for the site, including scripts and stylesheets, through the Worker and then to GitHub Pages. Ordinary responses are passed through. A GET or HEAD whose query names a real fortune is rewritten when the origin response is HTML. That origin fetch drops `Range`, `If-Range`, `If-None-Match`, and `If-Modified-Since`, then answers with the full rewritten document (status 200). HEAD keeps those headers, including `Content-Length`, and omits the body. That path does not use the API rate limiter. `/og.png` on `api.webfortune.app` does, like the other API routes, and answers `Range` with the full image.

References: [Cloudflare Workers](https://developers.cloudflare.com/workers/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
