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
2. **Version Bump PR**: If release-worthy commits are found, a pull request is automatically opened from branch `chore/version-bump` updating `Cargo.toml`, `package.json`, and `package-lock.json`.
3. **Release**: Merging the `chore/version-bump` PR triggers `.github/workflows/release.yml`, creating tag `vX.Y.Z` and a GitHub Release.
4. **Deployment**: Successful release completion triggers `.github/workflows/deploy.yml` to deploy the application to AWS.

## Project Structure & Commands

- **Backend**: Rust (`src/main.rs`) using Tokio & Hyper.
  - Test: `cargo test`
  - Lint: `cargo clippy --all-targets -- -D warnings`
  - Format: `cargo fmt --check`
- **Frontend**: Vite (`web/`) with Vanilla JS & CSS.
  - Test: `npm test`
  - E2E Test: `npm run test:e2e`
  - Build: `npm run build`
- **Infrastructure**: Terraform (`infra/`) deploying to AWS ECR, Lambda, API Gateway, CloudFront, and S3.
  - Validate: `terraform -chdir=infra validate`
