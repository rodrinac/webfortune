# Repository Guidelines for AI Agents

This document provides instructions and guidelines for AI agents working on `webfortune`.

## Commit Message Conventions & Automated Version Bumping

This repository uses Conventional Commits to automatically determine semantic version bumps via `.github/workflows/version-bump.yml` and `scripts/version-bump.mjs`.

### Commit Message Syntax

All commits pushed to `main` (or included in pull requests that merge to `main`) MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

### Version Bump Triggers

The automated version bump script (`scripts/version-bump.mjs`) inspects commits merged since the last release tag (`vX.Y.Z`) and classifies the required version increment as follows (highest priority wins):

1. **Major Bump (`X.0.0`)**:
   - Triggered by `!` after the commit type/scope (e.g., `feat!: drop legacy endpoint` or `fix(api)!: breaking contract change`).
   - Or triggered by `BREAKING CHANGE:` at the start of a paragraph in the commit body/footer.

2. **Minor Bump (`0.X.0`)**:
   - Triggered by commits starting with `feat:` or `feat(scope):`.

3. **Patch Bump (`0.0.X`)**:
   - Triggered by commits starting with `fix:`, `fix(scope):`, or any other conventional commit type (`chore:`, `refactor:`, `docs:`, `test:`, `style:`, `perf:`, `ci:`).

4. **Skipped Bump**:
   - Commits containing `[skip version-bump]` in their message (such as automated bump commits) or non-conventional commit messages with no release-worthy changes will be skipped.

### Pipeline Flow

1. **Push to `main`**: Triggers `.github/workflows/version-bump.yml`.
2. **Version Bump PR**: If release-worthy commits are found, a pull request is automatically opened from branch `chore/version-bump` updating `package.json`, `package-lock.json`, `worker/Cargo.toml`, and `worker/Cargo.lock`.
3. **Release**: Merging the `chore/version-bump` PR triggers `.github/workflows/release.yml`, creating tag `vX.Y.Z` and a GitHub Release.
4. **Deployment**: Successful release completion triggers `.github/workflows/deploy.yml` to deploy the Cloudflare Worker and GitHub Pages site.

## Project Structure & Commands

- **API**: Cloudflare Worker (`worker/`) built with Rust/wasm via `worker-build` and Wrangler.
  - Test: `cd worker && cargo test --locked`
  - Lint: `cd worker && cargo clippy --locked --all-targets -- -D warnings`
  - Format: `cd worker && cargo fmt --check`
  - Deploy: `npm run generate:assets && npm run worker:deploy`
- **Frontend**: Vite (`web/`) with Vanilla JS & CSS.
  - Test: `npm test`
  - E2E Test: `npm run test:e2e`
  - Build: `VITE_API_URL=https://api.webfortune.app npm run build`
- **Local stack**: Nix flake provides Rust/wasm tooling and fortune/cow data.
  - Enter: `nix develop` (or `direnv allow`)
  - Worker + UI: `npm run worker:dev` then `npm run dev` (Vite proxies `/api` to `:8787`)
