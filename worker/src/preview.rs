//! Open Graph copy, permalink URLs, and the HTML tag rewrite used when a
//! crawler fetches a fortune permalink through the optional site route.
//!
//! The host library target does not link the Worker runtime, which is the only
//! non-test caller. Dead-code checks still run for the wasm32 build.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

pub const SITE_ORIGIN: &str = "https://webfortune.app";
pub const IMAGE_ORIGIN: &str = "https://api.webfortune.app";

#[derive(Debug, PartialEq, Eq)]
pub struct ShareMeta {
    pub title: String,
    pub description: String,
    pub page_url: String,
    pub image_url: String,
    pub image_alt: String,
}

pub fn is_pages_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("webfortune.app") || host.eq_ignore_ascii_case("www.webfortune.app")
}

pub fn query_mentions_fortune(query: &str) -> bool {
    query.split('&').any(|parameter| {
        parameter
            .strip_prefix("fortune=")
            .is_some_and(|value| !value.is_empty())
    })
}

/// Dropped on the origin fetch for a permalink. `Range` and `If-Range` make
/// GitHub Pages answer 206 with a slice of the static page. `If-None-Match`
/// and `If-Modified-Since` make it answer 304 for that same HTML. Either
/// status skips the meta rewrite, so the fetch always asks for the full document.
pub const ORIGIN_HEADERS_TO_STRIP: &[&str] =
    &["range", "if-range", "if-none-match", "if-modified-since"];

/// How to load a permalink. `None` means the request is not a preview and
/// should be forwarded to the origin unchanged, including `Range`.
#[derive(Debug, PartialEq, Eq)]
pub struct PermalinkPlan {
    /// Always GET, so a client HEAD still receives a document to rewrite.
    pub upstream_method: &'static str,
    /// Client HEAD: same headers as the rewritten GET, with no body.
    pub omit_body: bool,
    pub strip_headers: &'static [&'static str],
}

pub fn permalink_plan(method: &str, query: Option<&str>) -> Option<PermalinkPlan> {
    let head = method == "HEAD";
    if method != "GET" && !head {
        return None;
    }
    if !query.is_some_and(query_mentions_fortune) {
        return None;
    }
    Some(PermalinkPlan {
        upstream_method: "GET",
        omit_body: head,
        strip_headers: ORIGIN_HEADERS_TO_STRIP,
    })
}

pub fn page_url(query: &str) -> String {
    if query.is_empty() {
        format!("{SITE_ORIGIN}/")
    } else {
        format!("{SITE_ORIGIN}/?{query}")
    }
}

pub fn image_url(locale: &str, cow: &str, fortune_id: &str) -> String {
    let mut url = format!(
        "{IMAGE_ORIGIN}/og.png?locale={}&fortune={}",
        encode(locale),
        encode(fortune_id),
    );
    if cow != "default" {
        url.push_str("&cow=");
        url.push_str(&encode(cow));
    }
    url
}

/// Title, description, and image alt for one fortune. Both the title and the
/// description contain the fortune text, which is what link-preview cards show.
pub fn share_copy(fortune: &str) -> (String, String, String) {
    let flat = flatten(fortune);
    let flat = if flat.is_empty() {
        "A little wisdom from a very wise cow.".to_string()
    } else {
        flat
    };
    let hook = truncate(&flat, 80);
    let title = format!("webfortune — {hook}");
    let description = if flat.chars().count() <= 80 {
        format!("{flat} A little wisdom from a very wise cow.")
    } else {
        truncate(&flat, 220)
    };
    let alt = format!("An ASCII cow saying: {hook}");
    (title, description, alt)
}

pub fn share_meta(
    fortune: &str,
    page_query: &str,
    locale: &str,
    cow: &str,
    fortune_id: &str,
) -> ShareMeta {
    let (title, description, image_alt) = share_copy(fortune);
    ShareMeta {
        title,
        description,
        page_url: page_url(page_query),
        image_url: image_url(locale, cow, fortune_id),
        image_alt,
    }
}

/// Rewrites the social tags crawlers read. The visible page is left alone.
pub fn rewrite_share_html(html: &str, meta: &ShareMeta) -> String {
    let replacements = [
        ("meta-description", meta.description.as_str()),
        ("og-title", meta.title.as_str()),
        ("og-description", meta.description.as_str()),
        ("og-url", meta.page_url.as_str()),
        ("og-image", meta.image_url.as_str()),
        ("og-image-secure-url", meta.image_url.as_str()),
        ("og-image-alt", meta.image_alt.as_str()),
        ("twitter-title", meta.title.as_str()),
        ("twitter-description", meta.description.as_str()),
        ("twitter-image", meta.image_url.as_str()),
        ("twitter-image-alt", meta.image_alt.as_str()),
    ];
    replacements
        .into_iter()
        .fold(html.to_string(), |html, (id, value)| {
            replace_meta(&html, id, value)
        })
}

fn flatten(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut end = max_chars.saturating_sub(1);
    let prefix: String = text.chars().take(end).collect();
    if let Some(space) = prefix.rfind(' ') {
        if space > end / 2 {
            end = space;
        }
    }
    let mut shortened: String = text.chars().take(end).collect();
    shortened = shortened.trim_end().to_string();
    shortened.push('…');
    shortened
}

fn encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn escape_attr(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '"' => escaped.push_str("&quot;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn replace_meta(html: &str, id: &str, value: &str) -> String {
    let marker = format!("id=\"{id}\"");
    let Some(id_at) = html.find(&marker) else {
        return insert_meta(html, id, value);
    };
    let tag_start = html[..id_at].rfind('<').unwrap_or(0);
    let Some(tag_rel_end) = html[id_at..].find('>') else {
        return insert_meta(html, id, value);
    };
    let tag_end = id_at + tag_rel_end;
    let tag = &html[tag_start..=tag_end];
    let Some((value_start, value_end)) = attribute_value(tag, "content") else {
        return insert_meta(html, id, value);
    };
    let mut rewritten = String::with_capacity(html.len() + value.len());
    rewritten.push_str(&html[..tag_start + value_start]);
    rewritten.push_str(&escape_attr(value));
    rewritten.push_str(&html[tag_start + value_end..]);
    rewritten
}

fn attribute_value(tag: &str, name: &str) -> Option<(usize, usize)> {
    let key = format!("{name}=\"");
    let mut from = 0;
    while let Some(relative) = tag[from..].find(&key) {
        let at = from + relative;
        let boundary = at == 0 || tag.as_bytes()[at - 1].is_ascii_whitespace();
        if boundary {
            let value_start = at + key.len();
            let value_end = tag[value_start..].find('"')? + value_start;
            return Some((value_start, value_end));
        }
        from = at + key.len();
    }
    None
}

fn insert_meta(html: &str, id: &str, value: &str) -> String {
    let tag = format!("<meta id=\"{id}\" content=\"{}\" />\n", escape_attr(value));
    match html.find("</head>") {
        Some(at) => {
            let mut rewritten = String::with_capacity(html.len() + tag.len());
            rewritten.push_str(&html[..at]);
            rewritten.push_str(&tag);
            rewritten.push_str(&html[at..]);
            rewritten
        }
        None => format!("{html}{tag}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_meta() -> ShareMeta {
        share_meta(
            "Say \"hi\" <to> the cow & calf.",
            "locale=pt&cow=tux&fortune=brasil-3",
            "pt",
            "tux",
            "brasil-3",
        )
    }

    fn forwarded<'a>(headers: &'a [(&str, &str)], strip: &[&str]) -> Vec<(&'a str, &'a str)> {
        headers
            .iter()
            .copied()
            .filter(|(name, _)| {
                !strip
                    .iter()
                    .any(|dropped| name.eq_ignore_ascii_case(dropped))
            })
            .collect()
    }

    #[test]
    fn range_on_a_permalink_fetches_the_full_page() {
        let query = Some("locale=pt&fortune=brasil-2126");
        let plan = permalink_plan("GET", query).expect("permalink");
        assert_eq!(plan.upstream_method, "GET");
        assert!(!plan.omit_body);
        assert_eq!(
            plan.strip_headers,
            ["range", "if-range", "if-none-match", "if-modified-since",].as_slice()
        );

        let headers = [
            ("Range", "bytes=0-524287"),
            ("If-Range", "\"67abc\""),
            ("If-None-Match", "\"pages-etag\""),
            ("If-Modified-Since", "Wed, 21 Oct 2015 07:28:00 GMT"),
            ("User-Agent", "facebookexternalhit/1.1"),
            ("Accept", "text/html"),
        ];
        let upstream = forwarded(&headers, plan.strip_headers);
        assert_eq!(
            upstream,
            [
                ("User-Agent", "facebookexternalhit/1.1"),
                ("Accept", "text/html"),
            ]
        );

        let head = permalink_plan("HEAD", query).expect("head permalink");
        assert_eq!(head.upstream_method, "GET");
        assert!(head.omit_body);
        assert_eq!(head.strip_headers, plan.strip_headers);
        let head_upstream = forwarded(&headers, head.strip_headers);
        assert_eq!(head_upstream, upstream);

        assert!(permalink_plan("GET", Some("locale=pt")).is_none());
        assert!(permalink_plan("GET", None).is_none());
        assert!(permalink_plan("HEAD", Some("v=1")).is_none());
        assert!(permalink_plan("POST", query).is_none());
        assert!(permalink_plan("PUT", query).is_none());
    }

    #[test]
    fn pages_host_is_only_the_site() {
        assert!(is_pages_host("webfortune.app"));
        assert!(is_pages_host("WWW.Webfortune.App"));
        assert!(!is_pages_host("api.webfortune.app"));
        assert!(!is_pages_host("webfortune.app.evil"));
        assert!(!is_pages_host("localhost"));
        assert!(query_mentions_fortune("locale=pt&fortune=art-0"));
        assert!(!query_mentions_fortune("fortune="));
        assert!(!query_mentions_fortune("locale=pt"));
    }

    #[test]
    fn share_copy_keeps_the_fortune_in_the_title_and_description() {
        let (title, description, alt) = share_copy("  A wise cow\nwaits.  ");
        assert_eq!(title, "webfortune — A wise cow waits.");
        assert!(description.contains("A wise cow waits."));
        assert!(description.contains("very wise cow"));
        assert!(alt.contains("A wise cow waits."));

        let long = "word ".repeat(80);
        let (title, description, _) = share_copy(&long);
        assert!(title.chars().count() < 110);
        assert!(title.ends_with('…'));
        assert!(description.ends_with('…'));
        assert!(description.chars().count() <= 220);
        assert!(description.contains("word"));
    }

    #[test]
    fn image_and_page_urls_are_absolute() {
        assert_eq!(
            image_url("pt", "default", "brasil-3"),
            "https://api.webfortune.app/og.png?locale=pt&fortune=brasil-3"
        );
        assert_eq!(
            image_url("pt", "tux", "brasil-3"),
            "https://api.webfortune.app/og.png?locale=pt&fortune=brasil-3&cow=tux"
        );
        assert_eq!(
            page_url("locale=pt&fortune=brasil-3"),
            "https://webfortune.app/?locale=pt&fortune=brasil-3"
        );
        assert_eq!(page_url(""), "https://webfortune.app/");
    }

    #[test]
    fn rewrite_escapes_fortune_text_and_keeps_the_page() {
        let html = r#"<!doctype html>
<html><head>
<meta id="meta-description" name="description" content="old" />
<meta id="og-title" property="og:title" content="old" />
<meta
  id="og-description"
  property="og:description"
  content="old"
/>
<meta id="og-url" property="og:url" content="https://webfortune.app/" />
<meta id="og-image" property="og:image" content="https://webfortune.app/og.png" />
<meta id="og-image-secure-url" property="og:image:secure_url" content="https://webfortune.app/og.png" />
<meta id="og-image-alt" property="og:image:alt" content="old" />
<meta id="twitter-title" name="twitter:title" content="old" />
<meta id="twitter-description" name="twitter:description" content="old" />
<meta id="twitter-image" name="twitter:image" content="https://webfortune.app/og.png" />
<meta id="twitter-image-alt" name="twitter:image:alt" content="old" />
</head><body><script>keep "this"</script></body></html>"#;
        let rewritten = rewrite_share_html(html, &sample_meta());
        assert!(rewritten.contains("Say &quot;hi&quot; &lt;to&gt; the cow &amp; calf."));
        assert!(rewritten.contains(
            "https://api.webfortune.app/og.png?locale=pt&amp;fortune=brasil-3&amp;cow=tux"
        ));
        assert!(rewritten
            .contains("https://webfortune.app/?locale=pt&amp;cow=tux&amp;fortune=brasil-3"));
        assert!(rewritten.contains("<script>keep \"this\"</script>"));
        assert!(!rewritten.contains("content=\"old\""));
    }

    #[test]
    fn rewrite_inserts_a_missing_tag_and_matches_the_real_page() {
        let html = "<html><head></head><body>ok</body></html>";
        let rewritten = rewrite_share_html(html, &sample_meta());
        assert!(rewritten.contains("id=\"og-image\""));
        assert!(rewritten.contains("</head>"));
        assert!(rewritten.contains("<body>ok</body>"));

        let page = include_str!("../../web/index.html");
        for id in [
            "meta-description",
            "og-title",
            "og-description",
            "og-url",
            "og-image",
            "og-image-secure-url",
            "og-image-alt",
            "twitter-title",
            "twitter-description",
            "twitter-image",
            "twitter-image-alt",
        ] {
            assert!(page.contains(&format!("id=\"{id}\"")), "{id}");
        }
        let rewritten = rewrite_share_html(page, &sample_meta());
        assert!(rewritten.contains("Say &quot;hi&quot;"));
        assert!(rewritten.contains(
            "https://api.webfortune.app/og.png?locale=pt&amp;fortune=brasil-3&amp;cow=tux"
        ));
        assert!(rewritten.contains("og:image:width\" content=\"1200\""));
        assert!(rewritten.contains("summary_large_image"));
    }
}
