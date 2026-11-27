//! Security headers added to HTML from the Pages host and API / `/og.png` replies.
//!
//! `html-security-headers.txt` is the only copy of the HTML policy. The Vite
//! dev and preview servers read that same file, so the Playwright run
//! exercises the headers the Worker sends. API text, JSON, cowsay, cowthink, error,
//! 405, OPTIONS, and `/og.png` responses share [`API_SECURITY_HEADERS`], which
//! includes [`STRICT_TRANSPORT_SECURITY`].
//!
//! The host library target does not link the Worker runtime, which is the only
//! non-test caller. Dead-code checks still run for the wasm32 build.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use std::fmt;

/// One year, with subdomains. Keep the Cloudflare zone HSTS at least this
/// strong so dashboard and Worker policies do not conflict. Do not add
/// `preload` until every subdomain is HTTPS-only and hstspreload.org is a
/// deliberate follow-up.
pub const STRICT_TRANSPORT_SECURITY: &str = "max-age=31536000; includeSubDomains";

/// Deny-all security headers sent on API responses (text, JSON, cowsay, cowthink,
/// errors, 429, 405, OPTIONS 204, `/health`) and `/og.png`.
///
/// Do not add `cross-origin-resource-policy: same-origin` here: the web app
/// and link-preview crawlers fetch the API and `/og.png` cross-origin.
pub const API_SECURITY_HEADERS: &[(&str, &str)] = &[
    (
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    ),
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", "no-referrer"),
    ("x-frame-options", "DENY"),
    ("strict-transport-security", STRICT_TRANSPORT_SECURITY),
];

/// True when `value` is a long-lived HSTS policy (≥ one year, includeSubDomains).
#[cfg(test)]
fn is_long_lived_hsts(value: &str) -> bool {
    let mut max_age = None;
    let mut include_subdomains = false;
    for part in value.split(';').map(str::trim) {
        if let Some(age) = part.strip_prefix("max-age=") {
            max_age = age.parse::<u64>().ok();
        } else if part.eq_ignore_ascii_case("includesubdomains") {
            include_subdomains = true;
        }
    }
    max_age.is_some_and(|age| age >= 31_536_000) && include_subdomains
}

#[derive(Debug, PartialEq, Eq)]
pub struct HeaderParseError {
    line: usize,
    message: &'static str,
}

impl fmt::Display for HeaderParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "security header line {}: {}",
            self.line, self.message
        )
    }
}

pub fn html_security_headers() -> Vec<(String, String)> {
    parse_html_security_headers(include_str!("../html-security-headers.txt"))
        .expect("html-security-headers.txt")
}

pub fn parse_html_security_headers(
    source: &str,
) -> Result<Vec<(String, String)>, HeaderParseError> {
    let mut headers = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line_number = index + 1;
        let Some((name, value)) = line.split_once(':') else {
            return Err(HeaderParseError {
                line: line_number,
                message: "missing colon",
            });
        };
        let name = name.trim();
        let value = value.trim();
        if name.is_empty() || value.is_empty() {
            return Err(HeaderParseError {
                line: line_number,
                message: "empty name or value",
            });
        }
        headers.push((name.to_string(), value.to_string()));
    }
    Ok(headers)
}

/// `text/html` with an optional parameter list, such as `charset`.
pub fn is_html_content_type(content_type: &str) -> bool {
    content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("text/html")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> &'a str {
        headers
            .iter()
            .find(|(header_name, _)| header_name == name)
            .map(|(_, value)| value.as_str())
            .unwrap_or("")
    }

    fn directive<'a>(policy: &'a str, name: &str) -> &'a str {
        policy
            .split(';')
            .map(str::trim)
            .find(|part| part.split_whitespace().next() == Some(name))
            .unwrap_or("")
    }

    #[test]
    fn html_responses_get_an_enforcing_policy() {
        let headers = html_security_headers();
        let names: Vec<_> = headers.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            [
                "content-security-policy",
                "referrer-policy",
                "x-content-type-options",
                "permissions-policy",
                "x-frame-options",
                "strict-transport-security",
                "cross-origin-opener-policy",
                "cross-origin-resource-policy",
            ]
        );
        assert!(header(&headers, "content-security-policy-report-only").is_empty());

        let policy = header(&headers, "content-security-policy");
        assert!(policy.contains("frame-ancestors 'none'"));
        assert_eq!(directive(policy, "default-src"), "default-src 'self'");
        let script = directive(policy, "script-src");
        assert!(script.contains("'self'"));
        assert!(script.contains("https://www.googletagmanager.com"));
        assert!(!script.contains("'unsafe-inline'"));
        assert!(!script.contains("'unsafe-eval'"));
        let style = directive(policy, "style-src");
        assert_eq!(style, "style-src 'self'");
        assert!(!style.contains("'unsafe-inline'"));
        assert!(!style.contains("fonts.googleapis.com"));
        let font = directive(policy, "font-src");
        assert_eq!(font, "font-src 'self'");
        assert!(!font.contains("fonts.gstatic.com"));
        let connect = directive(policy, "connect-src");
        assert!(connect.contains("'self'"));
        assert!(connect.contains("https://api.webfortune.app"));
        assert!(connect.contains("https://*.google-analytics.com"));
        assert!(connect.contains("https://*.analytics.google.com"));
        assert!(connect.contains("https://www.googletagmanager.com"));
        let image = directive(policy, "img-src");
        assert!(image.contains("'self'"));
        assert!(image.contains("data:"));
        assert!(image.contains("blob:"));
        assert_eq!(directive(policy, "object-src"), "object-src 'none'");
        assert_eq!(directive(policy, "base-uri"), "base-uri 'self'");
        assert_eq!(directive(policy, "form-action"), "form-action 'self'");
        assert_eq!(
            directive(policy, "frame-ancestors"),
            "frame-ancestors 'none'"
        );

        assert_eq!(
            header(&headers, "referrer-policy"),
            "strict-origin-when-cross-origin"
        );
        assert_eq!(header(&headers, "x-content-type-options"), "nosniff");
        assert_eq!(
            header(&headers, "permissions-policy"),
            "camera=(), microphone=(), geolocation=(), payment=()"
        );
        assert_eq!(header(&headers, "x-frame-options"), "DENY");
        let hsts = header(&headers, "strict-transport-security");
        assert_eq!(hsts, STRICT_TRANSPORT_SECURITY);
        assert!(is_long_lived_hsts(hsts));
        assert_eq!(
            header(&headers, "cross-origin-opener-policy"),
            "same-origin"
        );
        assert_eq!(
            header(&headers, "cross-origin-resource-policy"),
            "same-origin"
        );
    }

    #[test]
    fn api_responses_get_a_deny_all_security_policy() {
        let headers: Vec<(String, String)> = API_SECURITY_HEADERS
            .iter()
            .map(|&(name, value)| (name.to_string(), value.to_string()))
            .collect();
        let names: Vec<_> = headers.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            [
                "content-security-policy",
                "x-content-type-options",
                "referrer-policy",
                "x-frame-options",
                "strict-transport-security",
            ]
        );
        assert!(header(&headers, "content-security-policy-report-only").is_empty());
        assert_ne!(
            header(&headers, "cross-origin-resource-policy"),
            "same-origin"
        );

        let policy = header(&headers, "content-security-policy");
        assert_eq!(
            policy,
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        );
        assert_eq!(directive(policy, "default-src"), "default-src 'none'");
        assert_eq!(
            directive(policy, "frame-ancestors"),
            "frame-ancestors 'none'"
        );
        assert_eq!(directive(policy, "base-uri"), "base-uri 'none'");
        assert_eq!(directive(policy, "form-action"), "form-action 'none'");

        assert_eq!(header(&headers, "x-content-type-options"), "nosniff");
        assert_eq!(header(&headers, "referrer-policy"), "no-referrer");
        assert_eq!(header(&headers, "x-frame-options"), "DENY");
        let hsts = header(&headers, "strict-transport-security");
        assert_eq!(hsts, STRICT_TRANSPORT_SECURITY);
        assert!(is_long_lived_hsts(hsts));
    }

    #[test]
    fn long_lived_hsts_requires_one_year_and_subdomains() {
        assert!(is_long_lived_hsts(STRICT_TRANSPORT_SECURITY));
        assert!(is_long_lived_hsts(
            "max-age=31536000; includeSubDomains; preload"
        ));
        assert!(!is_long_lived_hsts("max-age=2592000"));
        assert!(!is_long_lived_hsts("max-age=31536000"));
        assert!(!is_long_lived_hsts("max-age=2592000; includeSubDomains"));
        assert!(!is_long_lived_hsts(""));
    }

    #[test]
    fn parser_keeps_colons_in_header_values_and_skips_comments() {
        let headers = parse_html_security_headers(
            "\n# note\ncontent-security-policy: default-src 'self'; connect-src https://api.webfortune.app\n",
        )
        .expect("headers");
        assert_eq!(
            headers,
            vec![(
                "content-security-policy".to_string(),
                "default-src 'self'; connect-src https://api.webfortune.app".to_string(),
            )]
        );
        assert_eq!(
            parse_html_security_headers("not-a-header")
                .unwrap_err()
                .line,
            1
        );
        assert_eq!(parse_html_security_headers("empty:").unwrap_err().line, 1);
    }

    #[test]
    fn html_content_type_ignores_parameters_and_case() {
        assert!(is_html_content_type("text/html"));
        assert!(is_html_content_type("text/html; charset=utf-8"));
        assert!(is_html_content_type("Text/HTML; charset=UTF-8"));
        assert!(is_html_content_type(" text/html ; charset=utf-8"));
        assert!(!is_html_content_type("text/plain"));
        assert!(!is_html_content_type("text/css"));
        assert!(!is_html_content_type("application/javascript"));
        assert!(!is_html_content_type("image/png"));
        assert!(!is_html_content_type("application/octet-stream"));
        assert!(!is_html_content_type(""));
    }
}
