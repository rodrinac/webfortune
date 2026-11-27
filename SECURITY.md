# Security Policy

## Supported versions

Only the latest `vX.Y.Z` release deployed to [webfortune.app](https://webfortune.app/) and `https://api.webfortune.app` is supported with security updates.

| Version | Supported |
| --- | --- |
| Latest `vX.Y.Z` release | Yes |
| Older releases and unmerged branches | No |

## Scope

The following components are in scope:

- **Cloudflare Worker API** at `https://api.webfortune.app` (`worker/src/`, `worker/`)
- **Web UI** at `https://webfortune.app` (`web/`)
- **GitHub Actions workflows and build/release scripts** (`.github/workflows/`, `scripts/`)

Out of scope:

- Vulnerabilities in third-party hosting infrastructure operated by GitHub Pages or Cloudflare outside this repository's configuration
- Denial-of-service testing or automated rate-limit probing against live endpoints

## Reporting a vulnerability

Please do **not** open a public GitHub issue, discussion, or pull request for suspected security vulnerabilities until a fix has been released.

Report vulnerabilities privately using GitHub private vulnerability reporting:

- **[Report a vulnerability](https://github.com/rodrinac/webfortune/security/advisories/new)**

When reporting, please include:

- The affected component (`api.webfortune.app`, `webfortune.app`, or `.github/workflows/`)
- Clear reproduction steps or a proof of concept
- The security impact of the issue

Machine-readable disclosure metadata is published at [`https://webfortune.app/.well-known/security.txt`](https://webfortune.app/.well-known/security.txt) (RFC 9116).

## What to expect

- **Acknowledgement:** within 72 hours of receiving your report.
- **Triage and fix timeline:** confirmed vulnerabilities are triaged within 7 days, with a fix release (`vX.Y.Z`) targeted within 30 days depending on severity.
- **Coordinated disclosure:** please keep the vulnerability private until the fix is deployed to production. Credit will be included in the security advisory or release notes unless you prefer to remain anonymous.
