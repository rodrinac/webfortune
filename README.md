# webfortune

A little wisdom. A lot of moo. A Rust `fortune` API on AWS and a Catppuccin Mocha web UI on GitHub Pages.

Production: [webfortune.app](https://webfortune.app/)

The browser renders fortunes in a responsive cowsay-style ASCII bubble, with category selection, copy, keyboard shortcuts, and accessible loading/error states. Fortune text is always rendered as text, never HTML.

## Local development

Install Rust, Node.js 24+, and `fortune` (`brew install fortune` on macOS; `sudo apt-get install fortune-mod fortunes-min` on Debian/Ubuntu, adding `/usr/games` to PATH).

```sh
cargo run
# In another terminal; Vite proxies /api to localhost:8080.
npm ci
npm run dev
```

Open the Vite URL. `MY_APP_HOST` and `MY_APP_PORT` configure the backend bind address (defaults: `127.0.0.1:8080`). `FORTUNE_DATA_DIR` sets the root for localized fortune databases and defaults to `/usr/share/games/fortunes`. Homebrew users can run the backend with `FORTUNE_DATA_DIR=/opt/homebrew/share/games/fortunes cargo run`. Optional `CORS_ALLOW_ORIGIN` accepts one exact origin for direct local browser access. Production CORS is configured on API Gateway.

```sh
docker build -t webfortune .
docker run --rm -p 8080:8080 webfortune
```

The container includes the executable and non-offensive `fortunes-min` data. No host-installed command is needed in AWS. The [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) lets the same HTTP server run locally and on Lambda.

## API

| Request | Response |
| --- | --- |
| `GET /` | Random fortune as UTF-8 plain text |
| `GET /?category=computers` | Fortune from an installed category |
| `GET /categories` | JSON array of installed category names |
| `GET /health` | `{"status":"ok"}` when fortune data is available |

Only GET is supported by the application. API Gateway handles browser OPTIONS requests. Invalid queries return 400, unknown routes/categories 404, other methods 405, and an unavailable fortune executable/data returns 503. Each command has a three-second timeout; only installed categories are passed as arguments.

## Deployment

See [the deployment runbook](docs/deployment.md) for bootstrap and recovery. This follows `../cinemaclub`: Terraform, short-lived GitHub OIDC credentials, remote S3 state with DynamoDB locking, and API Gateway in `eu-west-1`.

`Deploy production` runs on main pushes or manual dispatch. It verifies the code, builds an immutable Linux image in ECR, deploys Lambda and API Gateway, smoke-tests the public API/CORS, builds the UI with that API URL, and publishes GitHub Pages. Backend failure blocks the Pages deployment. Deployments are serialized.

For a standalone production UI build:

```sh
VITE_API_URL=https://YOUR_API_ID.execute-api.eu-west-1.amazonaws.com npm run build
```

Builds fail without a public HTTPS API URL. Assets use relative paths so the site works at both `webfortune.app` and the GitHub Pages project path. `VITE_API_URL` is public configuration, not a secret.

## Verification

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
npm test
npx playwright install chromium
npm run test:e2e
npm run smoke # needs the local backend
API_URL=https://YOUR_API_ID.execute-api.eu-west-1.amazonaws.com CORS_ORIGIN=https://webfortune.app npm run smoke
```

Browser tests cover desktop/mobile layout, category selection, retry, preserving the previous fortune after a failure, and safe rendering of HTML-like text. CI also validates both Terraform configurations.
