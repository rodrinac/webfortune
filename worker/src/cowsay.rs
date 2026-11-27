//! Speech and thought bubbles for `GET /?format=cowsay` and `format=cowthink`.
//!
//! Wrapping and the speech-bubble borders follow `web/cowsay.js`. Characters
//! other than tab and newline in the C0 control range are dropped, tabs expand
//! to four spaces, and words then wrap on Unicode scalar values. One speech
//! line uses `< >`. Several speech lines use `/ \`, `| |`, and `\ /`. A
//! thought bubble uses `(` and `)` on every line, including a single line.
//! Top and bottom borders stay the same.

/// Default wrap width of `web/cowsay.js` and of cowthink here.
pub const WRAP_WIDTH: usize = 44;

/// Placeholder for the `$thoughts` slot in generated cow assets.
///
/// `scripts/generate-worker-assets.mjs` writes this same character
/// (`THOUGHTS_SLOT`, U+E000) where a cow file interpolates `$thoughts`.
/// Cowsay fills it with `\`. Cowthink fills it with `o`. Backslashes that
/// belong to the figure itself are already resolved and are left alone.
pub const THOUGHTS_SLOT: char = '\u{E000}';

/// Replace [`THOUGHTS_SLOT`] in cow artwork. A figure with no slot is unchanged.
pub fn with_thoughts(artwork: &str, thoughts: &str) -> String {
    artwork.replace(THOUGHTS_SLOT, thoughts)
}

/// Speech bubble plus cow artwork, without a trailing newline. `web/cowsay.js`
/// joins the same way; the HTTP body adds the final newline. The `$thoughts`
/// slot is drawn as `\`.
pub fn render(text: &str, width: usize, artwork: &str) -> String {
    draw(text, width, artwork, false)
}

/// Thought bubble plus cow artwork, without a trailing newline. Borders follow
/// cowthink(1): `(` and `)` on every line, with the same top and bottom rules
/// and wrap width as [`render`]. The `$thoughts` slot is drawn as `o`.
pub fn render_think(text: &str, width: usize, artwork: &str) -> String {
    draw(text, width, artwork, true)
}

fn draw(text: &str, width: usize, artwork: &str, thought: bool) -> String {
    let artwork = with_thoughts(artwork, if thought { "o" } else { "\\" });
    let lines = wrap_fortune(text, width);
    let size = lines.iter().map(|line| char_len(line)).max().unwrap_or(0);
    let mut out = Vec::with_capacity(lines.len() + 3);
    out.push(format!(" {}", "_".repeat(size + 2)));
    for (index, line) in lines.iter().enumerate() {
        let (left, right) = balloon_borders(thought, lines.len(), index);
        let pad = " ".repeat(size - char_len(line));
        out.push(format!("{left} {line}{pad} {right}"));
    }
    out.push(format!(" {}", "-".repeat(size + 2)));
    out.push(artwork);
    out.join("\n")
}

fn balloon_borders(thought: bool, lines: usize, index: usize) -> (char, char) {
    if thought {
        return ('(', ')');
    }
    if lines == 1 {
        ('<', '>')
    } else if index == 0 {
        ('/', '\\')
    } else if index + 1 == lines {
        ('\\', '/')
    } else {
        ('|', '|')
    }
}

pub fn wrap_fortune(text: &str, width: usize) -> Vec<String> {
    assert!(width >= 1, "width must be a positive integer");
    let cleaned: String = text
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '\u{0000}'..='\u{0008}' | '\u{000b}'..='\u{001f}' | '\u{007f}'
            )
        })
        .collect();
    let normalized = cleaned.replace('\t', "    ");
    normalized
        .trim()
        .split('\n')
        .flat_map(|paragraph| wrap_paragraph(paragraph, width))
        .collect()
}

fn wrap_paragraph(paragraph: &str, width: usize) -> Vec<String> {
    let paragraph = paragraph.trim();
    if paragraph.is_empty() {
        return vec![String::new()];
    }
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in paragraph.split_whitespace() {
        if !line.is_empty() && char_len(&line) + 1 + char_len(word) > width {
            lines.push(std::mem::take(&mut line));
        }
        let mut chars: Vec<char> = word.chars().collect();
        while chars.len() > width {
            lines.push(chars.drain(..width).collect());
        }
        let word: String = chars.into_iter().collect();
        if line.is_empty() {
            line = word;
        } else {
            line.push(' ');
            line.push_str(&word);
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

fn char_len(text: &str) -> usize {
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_and_multiline_bubbles_match_the_web_ui() {
        let moo = render("Moo.", WRAP_WIDTH, "COW");
        assert!(moo.contains("< Moo. >"));
        assert!(moo.ends_with("\nCOW"));
        assert!(!moo.ends_with("\n\nCOW"));

        let wrapped = render("A little wisdom for a little cow.", 15, "ART");
        assert_eq!(
            wrapped.lines().collect::<Vec<_>>(),
            [
                " _________________",
                "/ A little wisdom \\",
                "| for a little    |",
                "\\ cow.            /",
                " -----------------",
                "ART",
            ]
        );
        let lines: Vec<&str> = wrapped.lines().collect();
        assert_eq!(lines[1].chars().count(), lines[2].chars().count());
        assert_eq!(lines[2].chars().count(), lines[3].chars().count());
    }

    #[test]
    fn wraps_long_words_and_keeps_paragraph_breaks() {
        assert_eq!(
            wrap_fortune("abcdefghijkl\n\nmoo", 5),
            ["abcde", "fghij", "kl", "", "moo"]
        );
        assert_eq!(
            render("abcdefghijkl\n\nmoo", 5, "  \\")
                .lines()
                .collect::<Vec<_>>(),
            [
                " _______",
                "/ abcde \\",
                "| fghij |",
                "| kl    |",
                "|       |",
                "\\ moo   /",
                " -------",
                "  \\",
            ]
        );
        for line in wrap_fortune("a 😀😀😀😀😀😀 text", 5) {
            assert!(char_len(&line) <= 5, "{line}");
        }
        assert_eq!(
            wrap_fortune("a 😀😀😀😀😀😀 text", 5),
            ["a", "😀😀😀😀😀", "😀", "text"]
        );
    }

    #[test]
    fn long_sentences_use_the_web_wrap_width() {
        assert_eq!(
            render(
                "The quick brown fox jumps over the lazy dog again and again.",
                WRAP_WIDTH,
                "COW"
            )
            .lines()
            .collect::<Vec<_>>(),
            [
                " _____________________________________________",
                "/ The quick brown fox jumps over the lazy dog \\",
                "\\ again and again.                            /",
                " ---------------------------------------------",
                "COW",
            ]
        );
    }

    #[test]
    fn preserves_accented_text_and_does_not_escape_markup() {
        let localized = "À vaca é sábia; amanhã dirá: î, ó, ü, ñ.";
        assert!(render(localized, WRAP_WIDTH, "COW").contains(localized));

        let markup = render("<script>alert(1)</script>\u{7}", WRAP_WIDTH, "X");
        assert!(markup.contains("< <script>alert(1)</script> >"));
        assert!(!markup.contains("&lt;"));
        assert!(!markup.contains('\u{7}'));
    }

    #[test]
    fn tabs_collapse_like_the_web_ui_and_empty_text_still_has_a_bubble() {
        assert_eq!(
            render("a\tb\n\nc", WRAP_WIDTH, "COW")
                .lines()
                .take(4)
                .collect::<Vec<_>>(),
            [" _____", "/ a b \\", "|     |", "\\ c   /"]
        );
        assert_eq!(
            render("", WRAP_WIDTH, "COW").lines().collect::<Vec<_>>(),
            [" __", "<  >", " --", "COW"]
        );
        assert_eq!(
            render("  \n  ", WRAP_WIDTH, "COW")
                .lines()
                .collect::<Vec<_>>(),
            [" __", "<  >", " --", "COW"]
        );
    }

    #[test]
    fn selected_artwork_is_appended_unchanged() {
        let dragon = "  \\\n   \\ dragon";
        let rendered = render("Roar.", WRAP_WIDTH, dragon);
        assert!(rendered.ends_with(dragon));
        assert!(rendered.contains("< Roar. >"));
        assert!(!rendered.contains("(oo)"));
    }

    #[test]
    fn thought_bubbles_use_parentheses_on_every_line() {
        let moo = render_think("Moo.", WRAP_WIDTH, "COW");
        assert_eq!(
            moo.lines().collect::<Vec<_>>(),
            [" ______", "( Moo. )", " ------", "COW"]
        );
        assert!(!moo.contains('<'));
        assert!(!moo.contains('>'));

        let wrapped = render_think("A little wisdom for a little cow.", 15, "ART");
        assert_eq!(
            wrapped.lines().collect::<Vec<_>>(),
            [
                " _________________",
                "( A little wisdom )",
                "( for a little    )",
                "( cow.            )",
                " -----------------",
                "ART",
            ]
        );
        let lines: Vec<&str> = wrapped.lines().collect();
        assert_eq!(lines[1].chars().count(), lines[2].chars().count());
        assert_eq!(lines[2].chars().count(), lines[3].chars().count());

        assert_eq!(
            render_think(
                "The quick brown fox jumps over the lazy dog again and again.",
                WRAP_WIDTH,
                "COW"
            )
            .lines()
            .collect::<Vec<_>>(),
            [
                " _____________________________________________",
                "( The quick brown fox jumps over the lazy dog )",
                "( again and again.                            )",
                " ---------------------------------------------",
                "COW",
            ]
        );
        assert_eq!(
            render_think("", WRAP_WIDTH, "COW")
                .lines()
                .collect::<Vec<_>>(),
            [" __", "(  )", " --", "COW"]
        );
    }

    #[test]
    fn thoughts_slot_is_a_backslash_for_cowsay_and_o_for_cowthink() {
        let slotted =
            format!("        {THOUGHTS_SLOT}   ^__^\n         {THOUGHTS_SLOT}  (oo)\\_______");
        let spoken = render("Hi", WRAP_WIDTH, &slotted);
        assert!(spoken.contains("< Hi >"));
        assert!(spoken.contains("        \\   ^__^"));
        assert!(spoken.contains("         \\  (oo)\\_______"));
        assert!(!spoken.contains(THOUGHTS_SLOT));

        let thought = render_think("Hi", WRAP_WIDTH, &slotted);
        assert!(thought.contains("( Hi )"));
        assert!(thought.contains("        o   ^__^"));
        assert!(thought.contains("         o  (oo)\\_______"));
        assert!(!thought.contains(THOUGHTS_SLOT));
        assert!(!thought.contains('<'));

        // A figure that already has `\` is what cowsay stored before the slot.
        // Speech rendering of the slot matches that figure exactly.
        let baked = "        \\   ^__^\n         \\  (oo)\\_______";
        assert_eq!(
            render("Hi", WRAP_WIDTH, &slotted),
            render("Hi", WRAP_WIDTH, baked)
        );

        // Body backslashes stay backslashes. Only the `$thoughts` slot moves.
        // suse.cow glues the slot to `____`; bunny.cow has literal tails.
        let suse = format!("  {THOUGHTS_SLOT}\n   {THOUGHTS_SLOT}____");
        assert!(render("Hi", WRAP_WIDTH, &suse).ends_with("  \\\n   \\____"));
        assert!(render_think("Hi", WRAP_WIDTH, &suse).ends_with("  o\n   o____"));
        let bunny = format!("  {THOUGHTS_SLOT}\n   {THOUGHTS_SLOT}   \\\n        \\ /\\");
        assert!(render("Hi", WRAP_WIDTH, &bunny).ends_with("  \\\n   \\   \\\n        \\ /\\"));
        assert!(render_think("Hi", WRAP_WIDTH, &bunny).ends_with("  o\n   o   \\\n        \\ /\\"));
    }
}
