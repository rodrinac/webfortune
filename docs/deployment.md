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

The pipeline pins each deployment to its triggering commit. Pages builds with `VITE_API_URL=https://api.webfortune.app` from the successful Worker job.

## Verification and recovery

After a successful deployment, open `https://webfortune.app/`. Choose a category, request another fortune, and copy the cow. The pipeline smoke-checks `/health`, random/category fortunes, query validation, unknown routes, method rejection, and CORS headers.

To retry a failed deployment, rerun the failed workflow. If the Worker was already updated but Pages failed, the previous UI stays published and remains compatible with the API. Revert a bad application commit with a new commit on main; the normal workflow rebuilds and deploys it.

For failures inspect the workflow logs and Cloudflare Workers observability for `webfortune`. Rate limiting can return 429 during bursts; normal smoke tests intentionally do not expect a deterministic burst cutoff.

References: [Cloudflare Workers](https://developers.cloudflare.com/workers/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
