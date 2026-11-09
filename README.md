# webfortune

A little wisdom. A lot of moo. A Rust `fortune` API on Cloudflare Workers and a Catppuccin Mocha web UI on GitHub Pages.

Production: [webfortune.app](https://webfortune.app/)

## Screenshots

| English | Deutsch |
| --- | --- |
| ![English fortune](docs/screenshots/webfortune-en.png) | ![German fortune](docs/screenshots/webfortune-de.png) |
| Español | Português |
| ![Spanish fortune](docs/screenshots/webfortune-es.png) | ![Portuguese fortune](docs/screenshots/webfortune-pt.png) |

The browser renders fortunes in a responsive cowsay-style ASCII bubble, with cow and category selection, copy, keyboard shortcuts, and accessible loading/error states. Fortune text is always rendered as text, never HTML.

## Local development

Install [Nix](https://nixos.org/download/) with flakes (or use [`direnv`](https://direnv.net/) + `.envrc`), plus Node.js 24+. The Nix shell provides Rust/wasm tooling and the Debian fortune/cowsay data used to generate Worker assets.

```sh
nix develop
npm ci
npm run generate:assets
npm run worker:dev
# In another terminal; Vite proxies /api to wrangler on :8787.
npm run dev
```

Open the Vite URL. The UI defaults to `/api`, which Vite forwards to the local Worker. Production builds require `VITE_API_URL=https://api.webfortune.app`.

## API

| Request | Response |
| --- | --- |
| `GET /` | Random fortune as UTF-8 plain text. The response includes `x-fortune-id`, for example `computers-42`. |
| `GET /?fortune=computers-42` | That exact fortune. Invalid ids are 400; an unknown database or out-of-range index is 404. |
| `GET /?format=json` | The same fortune as one JSON object: `{"id":"computers-42","fortune":"...","locale":"en","category":"computers"}`. `Content-Type` is `application/json; charset=utf-8`, and `x-fortune-id` is still set. |
| `GET /og.png?locale=en&fortune=computers-42&cow=tux` | 1200×1200 PNG of that cow saying that fortune. Omit `fortune` for the branded card. |
| `GET /?category=computers` | Fortune from an installed category |
| `GET /categories` | JSON array of installed category names |
| `GET /cows` | JSON array of installed cow names |
| `GET /cows/{name}` | ASCII artwork for an installed cow |
| `GET /health` | `{"status":"ok","version":"<x.y.z>"}` when fortune data is available. `version` is the release the Worker was built from (`package.json`, no leading `v`). |

A fortune id is `<database>-<index>`. The index is a decimal with no leading zeros. Database names use the same resource-name rules as categories and may contain hyphens, so the id is split on the last hyphen. `locale` and `category` still work alongside `fortune`; when a category is set, the id's database must be that category.

`format=json` combines with `locale`, `category`, and `fortune` and selects the same fortune as the plain-text response. In the object, `fortune` is that plain-text body and `category` is the database it came from. Leave `format` off to keep the plain-text body. Any other `format` value is 400, and error responses stay plain text.

The page stores the served id in a `fortune` query parameter, next to `locale`, `cow`, and `category`. The copy button includes that URL, so opening it shows the same fortune. Refresh and Space request a new random fortune and replace the id. An invalid or unknown id falls back to a random fortune.

GET and HEAD are supported. The Worker handles browser OPTIONS and CORS, and exposes `x-fortune-id` to allowed origins. Invalid queries return 400, unknown routes and categories 404, and other methods 405 with `Allow: GET, HEAD`. HEAD has the same status and headers as GET, including `Content-Length`, and an empty body. Rate limiting is per client IP and counts HEAD the same way as GET.

## Deployment

See [the deployment runbook](docs/deployment.md). A new `vX.Y.Z` tag waits until `GET /health` reports that release, smoke-tests the public API, and publishes GitHub Pages. Workers Builds runs `npm run worker:deploy` for that release commit. A failed smoke test blocks the Pages deployment. Deployments are serialized.

For a standalone production UI build:

```sh
VITE_API_URL=https://api.webfortune.app npm run build
```

Builds fail without a public HTTPS API URL. Assets use relative paths so the site works at both `webfortune.app` and the GitHub Pages project path. `VITE_API_URL` is public configuration, not a secret.

`VITE_GA_MEASUREMENT_ID` is optional. Set it to the GA4 measurement ID (`G-…`) to include the Google tag and consent banner. The tag is on the page immediately, and analytics storage stays denied until a visitor allows it. Leave it unset for local development.

## Verification

```sh
nix develop
npm test
npx playwright install chromium
npm run test:e2e
npm run generate:assets
npm run worker:dev   # then, in another shell:
API_URL=http://127.0.0.1:8787 CORS_ORIGIN=https://webfortune.app npm run smoke
API_URL=https://api.webfortune.app CORS_ORIGIN=https://webfortune.app npm run smoke
```

Browser tests cover desktop/mobile layout, category selection, retry, preserving the previous fortune after a failure, and safe rendering of HTML-like text. CI builds the Worker (including a wrangler dry-run) and smoke-tests it locally.
