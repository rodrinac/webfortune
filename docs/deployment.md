# Cloudflare Worker + GitHub Pages deployment

## Architecture

`webfortune.app` on GitHub Pages → Cloudflare Worker at `api.webfortune.app`.

The static UI renders the returned text as cowsay-style ASCII art in the browser. The Worker serves pre-generated fortune and cow assets (built by `npm run generate:assets`) with CORS for `https://webfortune.app` and the legacy `https://rodrinac.github.io` origin, plus per-IP rate limiting. There is no database, container registry, or always-running server.

## GitHub settings

Enable GitHub Pages with **GitHub Actions** as the source. The `github-pages` environment should allow the `main` branch and tags matching `v*.*.*`. A policy that allows only `main` rejects the release tag before Pages is published. Workers Builds authenticates with the API token created when the Git repository is connected. GitHub Actions does not deploy the Worker.

Verify `webfortune.app` in the owner's GitHub Pages account settings and keep its `_github-pages-challenge-rodrinac` TXT record. Configure the repository Pages custom domain as `webfortune.app`. At the registrar, point the apex to GitHub Pages using its four documented A records and point `www` directly to `rodrinac.github.io` with a CNAME. Do not use wildcard records. Enable HTTPS after GitHub finishes provisioning the certificate.

`api.webfortune.app` is attached as a Worker custom domain via `worker/wrangler.jsonc` (`custom_domain: true`). DNS for that hostname is managed in Cloudflare.

Workers Builds deploys the Worker for the release commit on `main`. It cannot trigger on git tags. Set the production build include path to `package.json` and leave the exclude list empty. The version bump always edits that file, and the build checks out the whole commit, so that one path is enough. A push that does not change `package.json` does not deploy.

Leave the build command empty, set the deploy command to `npm run worker:deploy`, and leave the root directory as `/`. That script generates fortune assets, compiles the Wasm bundle, and runs `wrangler deploy`. Workers Builds does not run the custom build command in `worker/wrangler.jsonc`, and its image has no Rust or fortune data, so the script installs them when `nix develop` has not already put them on `PATH`. Cow figures are read from the Debian `.cow` files directly, so the build does not need Perl.

The release workflow tags that same commit as `vX.Y.Z`. The tag push checks the tag name against `package.json`, checks that the commit is on `main`, smoke-tests `https://api.webfortune.app`, and publishes GitHub Pages with `VITE_API_URL=https://api.webfortune.app`. It does not deploy the Worker. Workers Builds may still be finishing that commit's Worker when the smoke test runs; the test checks the live API. Manual Pages redeploys use **Deploy production (manual)**, which checks out the selected branch tip only and does not deploy the Worker. Retry a Worker build from Workers Builds, or run `npm run worker:deploy` locally, to publish the Worker without a new tag.

Pages builds also read the repository variable `VITE_GA_MEASUREMENT_ID` (Settings → Secrets and variables → Actions → Variables, not an environment variable). Set it to the measurement ID (`G-…`) shown in the GA4 data stream for `webfortune.app`, then rerun the Pages deployment. When the variable is empty, the site ships with no Google tag and no consent banner, and GA4 reports that the tag was not detected. When it is set, the tag is in the page head on first load, with analytics storage denied until the visitor chooses Allow. Decline keeps storage denied, and Analytics in the footer reopens the choice. Visits send a page view. Fortunes send `fortune_shown` with `reason` (`initial`, `button`, `keyboard`, `category`, or `language`), `locale`, `category`, and `cow`. Copy, screenshot, cow changes, and outbound clicks send `copy_fortune`, `copy_screenshot`, `change_cow`, and `click`. Fortune text and fortune ids stay off the events. In GA4 Admin, register `locale`, `category`, `cow`, `reason`, and `result` as event-scoped custom dimensions so those breakdowns appear in reports.

## Verification and recovery

After a successful deployment, open `https://webfortune.app/`. Choose a category, request another fortune, and copy the cow. The pipeline smoke-checks `/health`, random/category fortunes, fortune permalinks (`x-fortune-id` and `?fortune=`), query validation, unknown routes, method rejection, and CORS headers.

To retry a failed Pages deployment, rerun the failed tag workflow. For an ad-hoc Pages redeploy of the current branch tip, run **Deploy production (manual)**. Retry a failed Worker build from Workers Builds. If Pages failed after the Worker was updated, the previous UI stays published and remains compatible with the API. Revert a bad application commit with a new commit on main. The version bump tags the release, Workers Builds publishes the Worker for that commit, and the tag publishes Pages.

For failures inspect the workflow logs and Cloudflare Workers observability for `webfortune`. Rate limiting can return 429 during bursts; normal smoke tests intentionally do not expect a deterministic burst cutoff.

## Per-fortune link previews

Every page already advertises `https://webfortune.app/og.png`, a 1200×1200 branded card. That static preview works with no Cloudflare change. Crawlers do not run the page's JavaScript, and GitHub Pages serves one `index.html` for every query string, so a permalink such as `/?locale=pt&cow=daemon&fortune=brasil-1730` cannot describe that fortune until something in front of Pages rewrites the HTML.

The Worker can do that rewrite, and it can paint the fortune at `GET /og.png`. Neither requires a DNS or workflow change. The rewrite stays off because `worker/wrangler.jsonc` does not route `webfortune.app` at the Worker. `wrangler deploy` replaces routes from that file, so a route added only in the dashboard disappears on the next deploy.

To enable per-fortune previews:

1. Leave DNS and the GitHub Pages custom domain as they are. `webfortune.app` is already proxied by Cloudflare in front of Pages.
2. Uncomment both site routes in `worker/wrangler.jsonc` (`webfortune.app/*` and `www.webfortune.app/*`). The `/*` is required: Cloudflare only matches a query string when the pattern ends in a wildcard, and permalinks are `/?fortune=...`.
3. Deploy the Worker by merging to `main` and letting the release tag land (Workers Builds), or run `npm run worker:deploy`.
4. Open a permalink in the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or [opengraph.xyz](https://www.opengraph.xyz/). The title and description should contain the fortune text, and the image should be the cow saying it. The image URL is `https://api.webfortune.app/og.png` with `locale`, `fortune`, and, when it is not `default`, `cow`. Rewritten HTML responses include `x-webfortune-preview: fortune`. The homepage, and any URL whose fortune id does not resolve, keeps the static card.

Enabling the routes sends every request for the site, including scripts and stylesheets, through the Worker and then to GitHub Pages. Ordinary responses are passed through. A GET or HEAD whose query names a real fortune is rewritten when the origin response is HTML. That origin fetch drops `Range`, `If-Range`, `If-None-Match`, and `If-Modified-Since`, then answers with the full rewritten document (status 200). HEAD keeps those headers, including `Content-Length`, and omits the body. That path does not use the API rate limiter. `/og.png` on `api.webfortune.app` does, like the other API routes, and answers `Range` with the full image.

References: [Cloudflare Workers](https://developers.cloudflare.com/workers/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
