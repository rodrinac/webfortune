//! 1200×1200 Catppuccin Mocha preview card. Crawlers require a real PNG, so this
//! rasterizes with the bundled JetBrains Mono and encodes RGB pixels directly.
//!
//! The canvas is square, matching link previews that place a large image above
//! the title. The header row stays the same size; the terminal panel takes the
//! extra height.
//!
//! The host library target does not link the Worker runtime, which is the only
//! non-test caller. Dead-code checks still run for the wasm32 build.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use std::collections::HashMap;
use std::sync::OnceLock;

use fontdue::Font;

pub const CARD_WIDTH: u32 = 1200;
pub const CARD_HEIGHT: u32 = 1200;
pub const BRAND_MESSAGE: &str = "A little wisdom from a very wise cow.";
pub const BRAND_TAGLINE: &str = "wisdom, with a moo";

const DEFAULT_COW: &str = r#"        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||"#;

const BASE: Rgb = Rgb::new(0x1e, 0x1e, 0x2e);
const CRUST: Rgb = Rgb::new(0x11, 0x11, 0x1b);
const MANTLE: Rgb = Rgb::new(0x18, 0x18, 0x25);
const TITLE_BAR: Rgb = Rgb::new(0x1b, 0x1b, 0x2a);
const SURFACE: Rgb = Rgb::new(0x31, 0x32, 0x44);
const BORDER: Rgb = Rgb::new(0x66, 0x5f, 0x52);
const SUBTEXT: Rgb = Rgb::new(0xa6, 0xad, 0xc8);
const TEXT: Rgb = Rgb::new(0xcd, 0xd6, 0xf4);
const MAUVE: Rgb = Rgb::new(0xcb, 0xa6, 0xf7);
const GOLD: Rgb = Rgb::new(0xf9, 0xe2, 0xaf);
const GREEN: Rgb = Rgb::new(0xa6, 0xe3, 0xa1);
const PINK: Rgb = Rgb::new(0xf3, 0x8b, 0xa8);

const PREFERRED_WRAP: usize = 42;
const MIN_WRAP: usize = 12;
const MAX_WRAP: usize = 96;
/// Readable floor. Taller cows shrink toward this, then reflow and truncate.
/// The square terminal lets a 22-row cow such as daemon sit well above this.
const MIN_FONT_SIZE: f32 = 11.0;
/// Cap so a one-line fortune cannot dwarf the wordmark.
const MAX_FONT_SIZE: f32 = 56.0;
const MESSAGE_CHAR_CAP: usize = 800;
const COW_LINE_CAP: usize = 64;
const COMMAND_SIZE: f32 = 22.0;
const FIT_PAD: f32 = 1.0;
const COMMAND_GAP: f32 = 6.0;
const DOMAIN_GAP: f32 = 6.0;
/// Header text inset. The wordmark and tagline stay on this row; the square
/// canvas does not scale them.
const HEADER_INSET_X: f32 = 56.0;
const HEADER_BASELINE: f32 = 78.0;
/// Terminal frame. Width matches the old landscape card. Height consumes
/// everything between the header and the same bottom margin, so the panel
/// grows from 460px to fill the square.
const TERMINAL_X: f32 = 48.0;
const TERMINAL_TOP: f32 = 118.0;
const TERMINAL_BOTTOM_MARGIN: f32 = 52.0;

pub struct Card<'a> {
    pub message: &'a str,
    pub cow: &'a str,
    pub command: &'a str,
    pub tagline: &'a str,
}

// The committed `web/public/og.png` and the unit tests call this. The Worker
// paints fortunes through `render_fortune_card`, so the wasm library does not.
#[cfg_attr(not(test), allow(dead_code))]
pub fn render_brand_card() -> Vec<u8> {
    render_card(&Card {
        message: BRAND_MESSAGE,
        cow: DEFAULT_COW,
        command: "fortune | cowsay",
        tagline: BRAND_TAGLINE,
    })
}

pub fn render_fortune_card(message: &str, cow: &str, cow_name: &str) -> Vec<u8> {
    let command = if cow_name == "default" {
        "fortune | cowsay".to_string()
    } else {
        format!("fortune | cowsay -f {cow_name}")
    };
    render_card(&Card {
        message,
        cow,
        command: &command,
        tagline: BRAND_TAGLINE,
    })
}

pub fn render_card(card: &Card<'_>) -> Vec<u8> {
    let mut canvas = Canvas::new(CARD_WIDTH, CARD_HEIGHT, BASE);
    let frame = terminal_frame();
    paint_round_rect(
        &mut canvas,
        Rect {
            x: frame.x + 8.0,
            y: frame.y + 14.0,
            w: frame.w,
            h: frame.h,
        },
        22.0,
        CRUST,
        CRUST,
        0.0,
        0.0,
    );
    paint_terminal(&mut canvas, frame);
    draw_header(&mut canvas, card.tagline);
    draw_command(&mut canvas, frame, card.command);
    draw_speech(&mut canvas, frame, card.message, card.cow, card.command);
    draw_domain(&mut canvas, frame);
    encode_png(CARD_WIDTH, CARD_HEIGHT, &canvas.pixels)
}

fn draw_header(canvas: &mut Canvas, tagline: &str) {
    let font = font();
    let mark = "(oo)";
    let name = "webfortune";
    let mark_size = 32.0;
    let name_size = 40.0;
    let baseline = HEADER_BASELINE;
    let mut x = HEADER_INSET_X;
    x = draw_text(canvas, font, mark, x, baseline, mark_size, MAUVE).0 + 16.0;
    let (end, _) = draw_text(canvas, font, name, x, baseline, name_size, TEXT);
    fill_circle(canvas, end + 14.0, baseline - 8.0, 5.5, GOLD);

    let tag_size = 24.0;
    let width = measure(font, tagline, tag_size);
    draw_text(
        canvas,
        font,
        tagline,
        CARD_WIDTH as f32 - HEADER_INSET_X - width,
        baseline,
        tag_size,
        SUBTEXT,
    );
}

fn draw_command(canvas: &mut Canvas, frame: Rect, command: &str) {
    let font = font();
    let glyphs = command_glyphs();
    let baseline = command_baseline(frame);
    let x = frame.x + 36.0;
    let (after_prompt, _) = draw_text(
        canvas,
        font,
        glyphs.prompt,
        x,
        baseline,
        COMMAND_SIZE,
        GREEN,
    );
    let (after_command, _) = draw_text(
        canvas,
        font,
        &format!(" {command}"),
        after_prompt,
        baseline,
        COMMAND_SIZE,
        SUBTEXT,
    );
    draw_text(
        canvas,
        font,
        &format!(" {}", glyphs.cursor),
        after_command,
        baseline,
        COMMAND_SIZE,
        GOLD,
    );
}

fn draw_speech(canvas: &mut Canvas, frame: Rect, message: &str, cow: &str, command: &str) {
    let block = layout_speech(message, cow, speech_content(frame, command));
    for row in &block.rows {
        let baseline = row.top + row.above;
        for (column, character) in row.text.chars().enumerate() {
            draw_cell(
                canvas,
                character,
                block.origin_x + column as f32 * block.advance,
                baseline,
                block.size,
                MAUVE,
            );
        }
    }
}

fn draw_domain(canvas: &mut Canvas, frame: Rect) {
    let font = font();
    let label = "webfortune.app";
    let size = 18.0;
    let width = measure(font, label, size);
    let x = frame.x + (frame.w - width) / 2.0;
    let baseline = frame.y + frame.h + 6.0;
    canvas.fill_rect(x - 16.0, domain_top(frame), width + 32.0, 26.0, BASE);
    draw_text(canvas, font, label, x, baseline, size, SUBTEXT);
}

fn paint_terminal(canvas: &mut Canvas, frame: Rect) {
    let radius = 22.0;
    let border = 3.0;
    let title_h = 70.0;
    paint_round_rect(canvas, frame, radius, MANTLE, BORDER, border, title_h);
    let dots_y = frame.y + border + title_h / 2.0;
    let mut dot_x = frame.x + 36.0;
    for color in [PINK, GOLD, GREEN] {
        fill_circle(canvas, dot_x, dots_y, 8.0, color);
        dot_x += 26.0;
    }
}

fn paint_round_rect(
    canvas: &mut Canvas,
    frame: Rect,
    radius: f32,
    fill: Rgb,
    border_color: Rgb,
    border: f32,
    title_h: f32,
) {
    let x0 = (frame.x - 2.0).floor() as i32;
    let y0 = (frame.y - 2.0).floor() as i32;
    let x1 = (frame.x + frame.w + 2.0).ceil() as i32;
    let y1 = (frame.y + frame.h + 2.0).ceil() as i32;
    let inner = Rect {
        x: frame.x + border,
        y: frame.y + border,
        w: (frame.w - border * 2.0).max(0.0),
        h: (frame.h - border * 2.0).max(0.0),
    };
    let inner_radius = (radius - border).max(0.0);
    let title_bottom = frame.y + border + title_h;
    for y in y0..y1 {
        for x in x0..x1 {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let outer = coverage(sd_round_rect(px, py, frame, radius));
            if outer <= 0.0 {
                continue;
            }
            let inside = if border <= 0.0 {
                1.0
            } else {
                coverage(sd_round_rect(px, py, inner, inner_radius))
            };
            let body = if title_h > 0.0 && py < title_bottom {
                TITLE_BAR
            } else {
                fill
            };
            let mut color = mix(border_color, body, inside);
            if title_h > 0.0 && (py - title_bottom).abs() < 1.0 && inside > 0.4 {
                color = SURFACE;
            }
            canvas.blend(x, y, color, (outer * 255.0).round() as u8);
        }
    }
}

struct LineBox {
    advance: f32,
    line_height: f32,
}

fn terminal_frame() -> Rect {
    Rect {
        x: TERMINAL_X,
        y: TERMINAL_TOP,
        w: CARD_WIDTH as f32 - TERMINAL_X * 2.0,
        h: CARD_HEIGHT as f32 - TERMINAL_TOP - TERMINAL_BOTTOM_MARGIN,
    }
}

fn command_baseline(frame: Rect) -> f32 {
    frame.y + 3.0 + 70.0 + 36.0
}

fn domain_top(frame: Rect) -> f32 {
    frame.y + frame.h - 12.0
}

struct CommandGlyphs {
    prompt: &'static str,
    cursor: &'static str,
}

fn command_glyphs() -> CommandGlyphs {
    let font = font();
    CommandGlyphs {
        prompt: if has_ink(font, '❯', COMMAND_SIZE) {
            "❯"
        } else {
            ">"
        },
        cursor: if has_ink(font, '▍', COMMAND_SIZE) {
            "▍"
        } else {
            "_"
        },
    }
}

/// Area inside the terminal, below the command ink and above the domain pill.
fn speech_content(frame: Rect, command: &str) -> Rect {
    let glyphs = command_glyphs();
    let sample = format!("{} {command} {}", glyphs.prompt, glyphs.cursor);
    let below = text_below(font(), &sample, COMMAND_SIZE);
    let top = (command_baseline(frame) + below + COMMAND_GAP).ceil();
    let bottom = (domain_top(frame) - DOMAIN_GAP).floor();
    Rect {
        x: frame.x + 36.0,
        y: top,
        w: frame.w - 72.0,
        h: (bottom - top).max(0.0),
    }
}

fn text_below(font: &Font, text: &str, size: f32) -> f32 {
    let mut below = 0.0_f32;
    for character in text.chars() {
        if character == ' ' {
            continue;
        }
        let (glyph, bitmap) = font.rasterize(character, size);
        if glyph.width == 0 || bitmap.is_empty() {
            continue;
        }
        below = below.max((-glyph.ymin).max(0) as f32);
    }
    below
}

struct SpeechBlock {
    rows: Vec<PlacedRow>,
    size: f32,
    origin_x: f32,
    advance: f32,
    /// Kept for the fit tests; drawing uses `rows` directly.
    #[cfg_attr(not(test), allow(dead_code))]
    content: Rect,
}

struct PlacedRow {
    text: String,
    top: f32,
    above: f32,
    #[cfg_attr(not(test), allow(dead_code))]
    below: f32,
    /// Ink edges relative to `origin_x` (left may be negative).
    #[cfg_attr(not(test), allow(dead_code))]
    ink_left: f32,
    #[cfg_attr(not(test), allow(dead_code))]
    ink_right: f32,
}

#[derive(Clone, Copy)]
struct GlyphInk {
    above: f32,
    below: f32,
    xmin: f32,
    right: f32,
}

struct MeasuredRow {
    above: f32,
    below: f32,
    ink_left: f32,
    ink_right: f32,
}

struct Measured {
    rows: Vec<MeasuredRow>,
    advance: f32,
    min_left: f32,
    max_right: f32,
    height: f32,
}

struct Composed {
    lines: Vec<String>,
    fortune_lines: usize,
    cow_lines: usize,
}

fn layout_speech(message: &str, cow: &str, content: Rect) -> SpeechBlock {
    let font = font();
    let mut cache = GlyphCache::default();
    let message = cap_message(message);
    let cow = normalize_cow(cow);
    let alphabet = speech_alphabet(&message, &cow);
    let lines = arrange(&message, &cow, content, &alphabet, font, &mut cache);
    let size = choose_size(font, &lines, content, &alphabet, &mut cache).unwrap_or(MIN_FONT_SIZE);
    position(lines, size, content, font, &alphabet, &mut cache)
}

/// The fitter sees at most `MESSAGE_CHAR_CAP` characters. A longer fortune
/// keeps that many and ends with an ellipsis, so the taller square panel
/// does not reveal a mid-word cut.
fn cap_message(message: &str) -> String {
    let total = message.chars().count();
    let mut capped: String = message.chars().take(MESSAGE_CHAR_CAP).collect();
    if total > MESSAGE_CHAR_CAP {
        mark_fortune_ellipsis(&mut capped);
    }
    capped
}

fn speech_alphabet(message: &str, cow: &[String]) -> String {
    let mut alphabet = String::from(" _-/\\|<>().,'`^…");
    alphabet.push_str(message);
    for line in cow {
        alphabet.push_str(line);
    }
    alphabet
}

fn arrange(
    message: &str,
    cow: &[String],
    content: Rect,
    alphabet: &str,
    font: &Font,
    cache: &mut GlyphCache,
) -> Vec<String> {
    let max_cols = max_columns(font, content);
    let preferred = compose(
        message,
        cow,
        PREFERRED_WRAP,
        usize::MAX,
        usize::MAX,
        max_cols,
    );
    if fits(
        font,
        &preferred.lines,
        MIN_FONT_SIZE,
        content,
        alphabet,
        cache,
    ) {
        return preferred.lines;
    }

    let mut fit = Fit {
        font,
        cache,
        content,
        alphabet,
        max_cols,
    };
    if let Some(lines) = best_wrap(message, cow, usize::MAX, usize::MAX, &mut fit) {
        return lines;
    }

    let fortune_cap = wrap_fortune(message, MIN_WRAP).len().max(1);
    if let Some(lines) = best_truncation(
        message,
        cow,
        1..=fortune_cap,
        cow.len().max(1)..=cow.len().max(1),
        &mut fit,
    ) {
        return lines;
    }
    best_truncation(message, cow, 1..=1, 1..=cow.len().max(1), &mut fit).unwrap_or(preferred.lines)
}

struct Fit<'a> {
    font: &'a Font,
    cache: &'a mut GlyphCache,
    content: Rect,
    alphabet: &'a str,
    max_cols: usize,
}

fn best_wrap(
    message: &str,
    cow: &[String],
    max_fortune: usize,
    max_cow: usize,
    fit: &mut Fit<'_>,
) -> Option<Vec<String>> {
    let mut best: Option<(f32, usize, Vec<String>)> = None;
    for wrap in MIN_WRAP..=MAX_WRAP {
        let composed = compose(message, cow, wrap, max_fortune, max_cow, fit.max_cols);
        if !fits(
            fit.font,
            &composed.lines,
            MIN_FONT_SIZE,
            fit.content,
            fit.alphabet,
            fit.cache,
        ) {
            continue;
        }
        let estimated = estimate_size(
            fit.font,
            &composed.lines,
            fit.content,
            fit.alphabet,
            fit.cache,
        );
        let distance = wrap.abs_diff(PREFERRED_WRAP);
        let replace = match &best {
            None => true,
            Some((score, previous, _)) => {
                estimated > *score + 0.25
                    || ((estimated - *score).abs() <= 0.25 && distance < *previous)
            }
        };
        if replace {
            best = Some((estimated, distance, composed.lines));
        }
    }
    best.map(|(_, _, lines)| lines)
}

fn best_truncation(
    message: &str,
    cow: &[String],
    fortune_keeps: impl Iterator<Item = usize> + Clone,
    cow_keeps: impl Iterator<Item = usize> + Clone,
    fit: &mut Fit<'_>,
) -> Option<Vec<String>> {
    let mut best: Option<(usize, usize, f32, usize, Vec<String>)> = None;
    for fortune_keep in fortune_keeps {
        for cow_keep in cow_keeps.clone() {
            for wrap in MIN_WRAP..=MAX_WRAP {
                let composed = compose(message, cow, wrap, fortune_keep, cow_keep, fit.max_cols);
                if !fits(
                    fit.font,
                    &composed.lines,
                    MIN_FONT_SIZE,
                    fit.content,
                    fit.alphabet,
                    fit.cache,
                ) {
                    continue;
                }
                let estimated = estimate_size(
                    fit.font,
                    &composed.lines,
                    fit.content,
                    fit.alphabet,
                    fit.cache,
                );
                let distance = wrap.abs_diff(PREFERRED_WRAP);
                let replace = match &best {
                    None => true,
                    Some((fortunes, cows, score, previous, _)) => {
                        composed.fortune_lines > *fortunes
                            || (composed.fortune_lines == *fortunes && composed.cow_lines > *cows)
                            || (composed.fortune_lines == *fortunes
                                && composed.cow_lines == *cows
                                && (estimated > *score + 0.25
                                    || ((estimated - *score).abs() <= 0.25
                                        && distance < *previous)))
                    }
                };
                if replace {
                    best = Some((
                        composed.fortune_lines,
                        composed.cow_lines,
                        estimated,
                        distance,
                        composed.lines,
                    ));
                }
            }
        }
    }
    best.map(|(_, _, _, _, lines)| lines)
}

fn choose_size(
    font: &Font,
    lines: &[String],
    content: Rect,
    alphabet: &str,
    cache: &mut GlyphCache,
) -> Option<f32> {
    if lines.is_empty() || !fits(font, lines, MIN_FONT_SIZE, content, alphabet, cache) {
        return None;
    }
    if fits(font, lines, MAX_FONT_SIZE, content, alphabet, cache) {
        return Some(MAX_FONT_SIZE);
    }
    let mut lo = MIN_FONT_SIZE;
    let mut hi = MAX_FONT_SIZE;
    for _ in 0..16 {
        let mid = (lo + hi) * 0.5;
        if fits(font, lines, mid, content, alphabet, cache) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let mut size = lo;
    while size > MIN_FONT_SIZE && !fits(font, lines, size, content, alphabet, cache) {
        size = (size - 0.25).max(MIN_FONT_SIZE);
    }
    Some(size)
}

fn estimate_size(
    font: &Font,
    lines: &[String],
    content: Rect,
    alphabet: &str,
    cache: &mut GlyphCache,
) -> f32 {
    let measured = measure_block(font, lines, MIN_FONT_SIZE, alphabet, cache);
    let usable_w = (content.w - 2.0 * FIT_PAD).max(1.0);
    let usable_h = (content.h - 2.0 * FIT_PAD).max(1.0);
    let width = (measured.max_right - measured.min_left).max(1.0);
    let height = measured.height.max(1.0);
    let by_width = MIN_FONT_SIZE * usable_w / width;
    let by_height = MIN_FONT_SIZE * usable_h / height;
    by_width.min(by_height).clamp(MIN_FONT_SIZE, MAX_FONT_SIZE)
}

fn fits(
    font: &Font,
    lines: &[String],
    size: f32,
    content: Rect,
    alphabet: &str,
    cache: &mut GlyphCache,
) -> bool {
    if lines.is_empty() {
        return false;
    }
    let measured = measure_block(font, lines, size, alphabet, cache);
    let width = measured.max_right - measured.min_left;
    width <= content.w - 2.0 * FIT_PAD && measured.height <= content.h - 2.0 * FIT_PAD
}

fn position(
    lines: Vec<String>,
    size: f32,
    content: Rect,
    font: &Font,
    alphabet: &str,
    cache: &mut GlyphCache,
) -> SpeechBlock {
    let measured = measure_block(font, &lines, size, alphabet, cache);
    let inner_w = (content.w - 2.0 * FIT_PAD).max(0.0);
    let inner_h = (content.h - 2.0 * FIT_PAD).max(0.0);
    let block_w = (measured.max_right - measured.min_left).max(0.0);
    let slack_x = (inner_w - block_w).max(0.0);
    let slack_y = (inner_h - measured.height).max(0.0);
    let origin_x = content.x + FIT_PAD - measured.min_left + slack_x / 2.0;
    let mut top = content.y + FIT_PAD + slack_y / 2.0;
    let gap = line_gap(size);
    let last_index = lines.len().saturating_sub(1);
    let mut rows = Vec::with_capacity(lines.len());
    for (index, (text, row)) in lines.into_iter().zip(measured.rows).enumerate() {
        rows.push(PlacedRow {
            text,
            top,
            above: row.above,
            below: row.below,
            ink_left: row.ink_left,
            ink_right: row.ink_right,
        });
        top += row.above + row.below;
        if index != last_index {
            top += gap;
        }
    }
    SpeechBlock {
        rows,
        size,
        origin_x,
        advance: measured.advance,
        content,
    }
}

fn line_metrics(font: &Font, size: f32) -> LineBox {
    let metrics = font.horizontal_line_metrics(size);
    let advance = font.metrics('M', size).advance_width;
    match metrics {
        Some(metrics) => LineBox {
            advance: if advance > 0.0 { advance } else { size * 0.6 },
            line_height: metrics.new_line_size.max(size),
        },
        None => LineBox {
            advance: if advance > 0.0 { advance } else { size * 0.6 },
            line_height: size * 1.35,
        },
    }
}

fn draw_cell(canvas: &mut Canvas, character: char, x: f32, baseline: f32, size: f32, color: Rgb) {
    if character == ' ' || character == '\t' {
        return;
    }
    let (glyph, bitmap) = font().rasterize(character, size);
    if glyph.width == 0 || bitmap.is_empty() {
        return;
    }
    let origin_x = x + glyph.xmin as f32;
    let origin_y = baseline - glyph.height as f32 - glyph.ymin as f32;
    blit(canvas, &bitmap, glyph.width, origin_x, origin_y, color);
}

fn draw_text(
    canvas: &mut Canvas,
    font: &Font,
    text: &str,
    x: f32,
    baseline: f32,
    size: f32,
    color: Rgb,
) -> (f32, f32) {
    let metrics = line_metrics(font, size);
    let mut cursor = x;
    for character in text.chars() {
        let glyph = font.metrics(character, size);
        if character != ' ' {
            let (glyph, bitmap) = font.rasterize(character, size);
            let origin_x = cursor + glyph.xmin as f32;
            let origin_y = baseline - glyph.height as f32 - glyph.ymin as f32;
            blit(canvas, &bitmap, glyph.width, origin_x, origin_y, color);
        }
        cursor += if glyph.advance_width > 0.0 {
            glyph.advance_width
        } else {
            metrics.advance
        };
    }
    (cursor, metrics.line_height)
}

fn measure(font: &Font, text: &str, size: f32) -> f32 {
    text.chars()
        .map(|character| {
            let advance = font.metrics(character, size).advance_width;
            if advance > 0.0 {
                advance
            } else {
                size * 0.6
            }
        })
        .sum()
}

fn has_ink(font: &Font, character: char, size: f32) -> bool {
    let (glyph, bitmap) = font.rasterize(character, size);
    glyph.width > 0 && bitmap.iter().any(|coverage| *coverage > 8)
}

fn blit(canvas: &mut Canvas, bitmap: &[u8], width: usize, x: f32, y: f32, color: Rgb) {
    if width == 0 {
        return;
    }
    let height = bitmap.len() / width;
    for row in 0..height {
        for column in 0..width {
            let coverage = bitmap[row * width + column];
            if coverage == 0 {
                continue;
            }
            canvas.blend(
                (x + column as f32).floor() as i32,
                (y + row as f32).floor() as i32,
                color,
                coverage,
            );
        }
    }
}

fn fill_circle(canvas: &mut Canvas, cx: f32, cy: f32, radius: f32, color: Rgb) {
    let x0 = (cx - radius - 1.0).floor() as i32;
    let y0 = (cy - radius - 1.0).floor() as i32;
    let x1 = (cx + radius + 1.0).ceil() as i32;
    let y1 = (cy + radius + 1.0).ceil() as i32;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let distance =
                ((x as f32 + 0.5 - cx).hypot(y as f32 + 0.5 - cy) - radius).clamp(-1.0, 1.0);
            let cover = (0.5 - distance * 0.5).clamp(0.0, 1.0);
            if cover > 0.0 {
                canvas.blend(x, y, color, (cover * 255.0).round() as u8);
            }
        }
    }
}

#[derive(Default)]
struct GlyphCache {
    entries: HashMap<(u32, char), Option<GlyphInk>>,
}

impl GlyphCache {
    fn ink(&mut self, font: &Font, character: char, size: f32) -> Option<GlyphInk> {
        if character == ' ' || character == '\t' {
            return None;
        }
        let key = (size.to_bits(), character);
        if let Some(cached) = self.entries.get(&key) {
            return *cached;
        }
        let (glyph, bitmap) = font.rasterize(character, size);
        let ink = if glyph.width == 0 || bitmap.is_empty() {
            None
        } else {
            let top = glyph.height as i32 + glyph.ymin;
            Some(GlyphInk {
                above: top.max(0) as f32,
                below: (-glyph.ymin).max(0) as f32,
                xmin: glyph.xmin as f32,
                right: glyph.xmin as f32 + glyph.width as f32,
            })
        };
        self.entries.insert(key, ink);
        ink
    }
}

fn line_gap(size: f32) -> f32 {
    (size * 0.08).max(1.0)
}

fn max_columns(font: &Font, content: Rect) -> usize {
    let advance = font.metrics('M', MIN_FONT_SIZE).advance_width.max(1.0);
    let usable = (content.w - 2.0 * FIT_PAD).max(advance);
    ((usable / advance).floor() as usize).max(1)
}

fn line_box(font: &Font, size: f32, alphabet: &str, cache: &mut GlyphCache) -> (f32, f32) {
    let mut above = 0.0_f32;
    let mut below = 0.0_f32;
    for character in alphabet.chars() {
        if let Some(glyph) = cache.ink(font, character, size) {
            above = above.max(glyph.above);
            below = below.max(glyph.below);
        }
    }
    if above == 0.0 && below == 0.0 {
        below = size * 0.60;
    }
    (above, below)
}

fn measure_block(
    font: &Font,
    lines: &[String],
    size: f32,
    alphabet: &str,
    cache: &mut GlyphCache,
) -> Measured {
    let advance = font.metrics('M', size).advance_width.max(1.0);
    let mut rows = Vec::with_capacity(lines.len());
    let mut min_left = 0.0_f32;
    let mut max_right = 0.0_f32;
    for line in lines {
        let mut above = 0.0_f32;
        let mut below = 0.0_f32;
        let mut ink_left = 0.0_f32;
        let mut ink_right = 0.0_f32;
        for (column, character) in line.chars().enumerate() {
            let x = column as f32 * advance;
            ink_right = ink_right.max(x + advance);
            if let Some(glyph) = cache.ink(font, character, size) {
                above = above.max(glyph.above);
                below = below.max(glyph.below);
                ink_left = ink_left.min(x + glyph.xmin);
                ink_right = ink_right.max(x + glyph.right);
            }
        }
        min_left = min_left.min(ink_left);
        max_right = max_right.max(ink_right);
        rows.push(MeasuredRow {
            above,
            below,
            ink_left,
            ink_right,
        });
    }
    // One line box for every row so the cow keeps a monospace rhythm. The
    // box comes from the whole message and cow, not from whichever rows
    // survived truncation — dropping a descender must not shrink the leading.
    let (max_above, max_below) = line_box(font, size, alphabet, cache);
    for row in &mut rows {
        row.above = max_above;
        row.below = max_below;
    }
    let height = if rows.is_empty() {
        0.0
    } else {
        rows.len() as f32 * (max_above + max_below) + (rows.len() - 1) as f32 * line_gap(size)
    };
    Measured {
        rows,
        advance,
        min_left,
        max_right,
        height,
    }
}

fn normalize_cow(cow: &str) -> Vec<String> {
    let normalized = cow.replace("\r\n", "\n").replace('\r', "");
    let source = if normalized.trim().is_empty() {
        DEFAULT_COW
    } else {
        normalized.trim_matches('\n')
    };
    let mut lines: Vec<String> = source.split('\n').map(str::to_string).collect();
    if lines.len() > COW_LINE_CAP {
        lines.truncate(COW_LINE_CAP - 1);
        lines.push("…".to_string());
    }
    lines
}

fn clip_cols(line: &str, max_cols: usize) -> String {
    if max_cols == 0 || char_len(line) <= max_cols {
        return line.to_string();
    }
    let mut clipped: String = line.chars().take(max_cols - 1).collect();
    clipped.push('…');
    clipped
}

fn mark_fortune_ellipsis(line: &mut String) {
    let mut chars: Vec<char> = line.chars().collect();
    if chars.len() <= 1 {
        *line = "…".to_string();
        return;
    }
    chars.pop();
    chars.push('…');
    *line = chars.into_iter().collect();
}

fn compose(
    message: &str,
    cow: &[String],
    wrap: usize,
    max_fortune_lines: usize,
    max_cow_lines: usize,
    max_cols: usize,
) -> Composed {
    let wrap = wrap.max(1);
    let mut wrapped = wrap_fortune(message, wrap);
    if wrapped.iter().all(|line| line.trim().is_empty()) {
        wrapped = wrap_fortune(BRAND_MESSAGE, wrap);
    }
    if wrapped.is_empty() {
        wrapped.push(BRAND_MESSAGE.to_string());
    }
    let fortune_total = wrapped.len();
    let keep = wrapped.len().min(max_fortune_lines.max(1));
    let fortune_truncated = fortune_total > keep;
    let mut body: Vec<String> = wrapped.into_iter().take(keep).collect();
    if fortune_truncated {
        if let Some(last) = body.last_mut() {
            mark_fortune_ellipsis(last);
        }
    }
    let text_cols = max_cols.saturating_sub(4).max(1);
    for line in &mut body {
        *line = clip_cols(line, text_cols);
    }
    let mut cows: Vec<String> = cow.iter().take(max_cow_lines.max(1)).cloned().collect();
    if cows.is_empty() {
        cows = normalize_cow("");
    }
    let cow_truncated = cow.len() > cows.len();
    if cow_truncated {
        if let Some(last) = cows.last_mut() {
            *last = "…".to_string();
        }
    }
    for line in &mut cows {
        *line = clip_cols(line, max_cols.max(1));
    }
    let fortune_lines = body.len();
    let cow_lines = cows.len();
    let mut lines = bubble(&body);
    for line in &mut lines {
        *line = clip_cols(line, max_cols.max(1));
    }
    lines.extend(cows);
    Composed {
        lines,
        fortune_lines,
        cow_lines,
    }
}

#[cfg(test)]
fn speech(message: &str, cow: &str) -> String {
    layout_speech(
        message,
        cow,
        speech_content(terminal_frame(), "fortune | cowsay"),
    )
    .rows
    .into_iter()
    .map(|row| row.text)
    .collect::<Vec<_>>()
    .join("\n")
}

fn wrap_fortune(text: &str, width: usize) -> Vec<String> {
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
    let normalized = normalized.trim();
    let mut lines = Vec::new();
    if normalized.is_empty() {
        return lines;
    }
    for paragraph in normalized.split('\n') {
        if paragraph.trim().is_empty() {
            lines.push(String::new());
            continue;
        }
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
    }
    lines
}

fn bubble(lines: &[String]) -> Vec<String> {
    let size = lines.iter().map(|line| char_len(line)).max().unwrap_or(0);
    let mut out = Vec::with_capacity(lines.len() + 2);
    out.push(format!(" {}", "_".repeat(size + 2)));
    for (index, line) in lines.iter().enumerate() {
        let (left, right) = if lines.len() == 1 {
            ('<', '>')
        } else if index == 0 {
            ('/', '\\')
        } else if index + 1 == lines.len() {
            ('\\', '/')
        } else {
            ('|', '|')
        };
        let pad = " ".repeat(size - char_len(line));
        out.push(format!("{left} {line}{pad} {right}"));
    }
    out.push(format!(" {}", "-".repeat(size + 2)));
    out
}

fn char_len(text: &str) -> usize {
    text.chars().count()
}

fn font() -> &'static Font {
    static FONT: OnceLock<Font> = OnceLock::new();
    FONT.get_or_init(|| {
        Font::from_bytes(
            include_bytes!("../fonts/JetBrainsMono-Regular.ttf") as &[u8],
            fontdue::FontSettings::default(),
        )
        .expect("embedded JetBrains Mono")
    })
}

#[derive(Clone, Copy)]
struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

impl Rgb {
    const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }
}

#[derive(Clone, Copy)]
struct Rect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

struct Canvas {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

impl Canvas {
    fn new(width: u32, height: u32, color: Rgb) -> Self {
        let mut pixels = vec![0; width as usize * height as usize * 3];
        for pixel in pixels.as_chunks_mut::<3>().0 {
            pixel[0] = color.r;
            pixel[1] = color.g;
            pixel[2] = color.b;
        }
        Self {
            width,
            height,
            pixels,
        }
    }

    fn blend(&mut self, x: i32, y: i32, color: Rgb, coverage: u8) {
        if coverage == 0 || x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return;
        }
        let index = ((y as u32 * self.width + x as u32) * 3) as usize;
        if coverage == 255 {
            self.pixels[index] = color.r;
            self.pixels[index + 1] = color.g;
            self.pixels[index + 2] = color.b;
            return;
        }
        let cover = coverage as u16;
        let keep = 255 - cover;
        for (offset, channel) in [color.r, color.g, color.b].into_iter().enumerate() {
            let mixed =
                (channel as u16 * cover + self.pixels[index + offset] as u16 * keep + 127) / 255;
            self.pixels[index + offset] = mixed as u8;
        }
    }

    fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Rgb) {
        let x0 = x.floor() as i32;
        let y0 = y.floor() as i32;
        let x1 = (x + w).ceil() as i32;
        let y1 = (y + h).ceil() as i32;
        for py in y0..y1 {
            for px in x0..x1 {
                self.blend(px, py, color, 255);
            }
        }
    }
}

fn mix(from: Rgb, to: Rgb, t: f32) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    let channel =
        |start: u8, end: u8| (start as f32 + (end as f32 - start as f32) * t).round() as u8;
    Rgb::new(
        channel(from.r, to.r),
        channel(from.g, to.g),
        channel(from.b, to.b),
    )
}

fn sd_round_rect(px: f32, py: f32, rect: Rect, radius: f32) -> f32 {
    let half_w = rect.w * 0.5;
    let half_h = rect.h * 0.5;
    let radius = radius.min(half_w).min(half_h);
    let qx = (px - (rect.x + half_w)).abs() - (half_w - radius);
    let qy = (py - (rect.y + half_h)).abs() - (half_h - radius);
    let outside = qx.max(0.0).hypot(qy.max(0.0));
    let inside = qx.max(qy).min(0.0);
    outside + inside - radius
}

fn coverage(distance: f32) -> f32 {
    (0.5 - distance).clamp(0.0, 1.0)
}

fn encode_png(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
    let mut buffer = Vec::new();
    let mut encoder = png::Encoder::new(&mut buffer, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    // Fast compression blows past the 300KB preview budget once the speech
    // block is large enough to fill the terminal.
    encoder.set_compression(png::Compression::Balanced);
    encoder.set_filter(png::Filter::Adaptive);
    let mut writer = encoder.write_header().expect("png header");
    writer.write_image_data(pixels).expect("png pixels");
    writer.finish().expect("png finish");
    buffer
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_size(bytes: &[u8]) -> (u32, u32) {
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"), "png signature");
        (
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
        )
    }

    #[test]
    fn speech_matches_the_browser_cowsay() {
        let wisdom = speech("A little wisdom from a very wise cow.", DEFAULT_COW);
        assert!(wisdom.starts_with(" _______________________________________"));
        assert!(wisdom.contains("< A little wisdom from a very wise cow. >"));
        assert!(wisdom.contains(r"\  (oo)\_______"));

        let hi = speech("Hi", DEFAULT_COW);
        assert!(hi.starts_with(" ____"));
        assert!(hi.contains("< Hi >"));

        let wrapped = bubble(&wrap_fortune("one two three four five", 8));
        let wrapped = wrapped.join("\n");
        assert!(wrapped.contains("/ one two \\"));
        assert!(wrapped.contains("| three   |"));
        assert!(wrapped.contains("\\ five    /"));

        let accented = speech("linha com ção e coração", DEFAULT_COW);
        assert!(accented.contains("linha com ção e"));
        assert!(accented.contains("coração"));
    }

    #[test]
    fn brand_card_is_a_small_1200_by_1200_png() {
        let png = render_brand_card();
        assert_eq!(png_size(&png), (CARD_WIDTH, CARD_HEIGHT));
        assert!(png.len() < 300 * 1024, "preview is {} bytes", png.len());
        assert!(png.len() > 5 * 1024, "preview is unexpectedly tiny");
        assert!(count_near(&png, MAUVE, 18) > 200, "the cow should be mauve");
        assert!(count_near(&png, BASE, 6) > 10_000, "the page background");
        assert!(count_near(&png, PINK, 12) > 20, "the close dot");
    }

    #[test]
    fn fortune_cards_change_with_the_text_and_stay_small() {
        let first = render_fortune_card("The early cow gets the grass.", DEFAULT_COW, "default");
        let second = render_fortune_card(
            "Não deixes para amanhã o que podes fazer hoje, querida vaca.",
            "   \\\n    \\ tux",
            "tux",
        );
        assert_ne!(first, second);
        assert_eq!(png_size(&second), (CARD_WIDTH, CARD_HEIGHT));
        assert!(second.len() < 300 * 1024);
        let huge = "wisdom ".repeat(400);
        let clipped = render_fortune_card(&huge, "", "default");
        assert_eq!(png_size(&clipped), (CARD_WIDTH, CARD_HEIGHT));
        assert!(clipped.len() < 300 * 1024);
        let stacked = "moo\n".repeat(160);
        assert!(
            speech(&stacked, DEFAULT_COW).contains('…'),
            "a fortune with more rows than the panel is truncated"
        );
    }

    #[test]
    fn speech_block_fills_the_terminal_without_overflow() {
        let default_cow = installed_cow("default");
        let daemon_cow = installed_cow("daemon");
        let stegosaurus_cow = installed_cow("stegosaurus");
        let long_sentence = "The cow that mooed at midnight still had more to say about grass, rain, and the long road home. ";
        let long_message = long_sentence.repeat(12);
        let cases = [
            ("default", BRAND_MESSAGE, default_cow.as_str()),
            ("daemon", BRAND_MESSAGE, daemon_cow.as_str()),
            ("stegosaurus", BRAND_MESSAGE, stegosaurus_cow.as_str()),
            ("long", long_message.as_str(), default_cow.as_str()),
        ];
        let content = speech_content(terminal_frame(), "fortune | cowsay");
        assert!(
            content.h > 700.0,
            "the square terminal should leave a tall speech box, got {}",
            content.h
        );
        let mut sizes = std::collections::HashMap::new();
        for (name, message, cow) in cases {
            let command = if name == "default" || name == "long" {
                "fortune | cowsay".to_string()
            } else {
                format!("fortune | cowsay -f {name}")
            };
            let block = layout_speech(message, cow, speech_content(terminal_frame(), &command));
            assert_block_inside(&block, name);
            let png =
                render_fortune_card(message, cow, if name == "long" { "default" } else { name });
            assert_eq!(png_size(&png), (CARD_WIDTH, CARD_HEIGHT));
            assert!(png.len() < 300 * 1024, "{name} png is {} bytes", png.len());
            assert_mauve_inside(&png, block.content, name);
            if name == "daemon" || name == "stegosaurus" || name == "default" {
                assert!(
                    block
                        .rows
                        .iter()
                        .any(|row| row.text.contains("very wise cow")),
                    "{name} dropped the fortune: {:?}",
                    block.rows.iter().map(|row| &row.text).collect::<Vec<_>>()
                );
                assert!(
                    !block.rows.iter().any(|row| row.text == "…"),
                    "{name} should fit without truncating the cow"
                );
            }
            if name == "long" {
                assert!(
                    block.rows.iter().any(|row| row.text.contains('…')),
                    "a fortune past the character cap should ellipsize"
                );
            }
            sizes.insert(name, block.size);
        }
        let default_size = sizes["default"];
        let former = former_default_font_size();
        // Stegosaurus is wide, so the shared terminal width keeps it smaller.
        // Daemon is tall; on the 460px landscape panel it was the smallest,
        // and the square panel lets it outgrow that wide cow.
        assert!(
            default_size > sizes["daemon"] && sizes["daemon"] > sizes["stegosaurus"],
            "square panel type: default {default_size}, daemon {}, stegosaurus {}",
            sizes["daemon"],
            sizes["stegosaurus"]
        );
        assert!(
            default_size > former + 4.0,
            "default cow font {default_size} should be clearly larger than the previous {former}"
        );
        // The 1200×630 card used a 460px-tall terminal. Tall cows were the
        // ones stuck near the floor; the square panel should lift daemon
        // more than the shorter default cow.
        let landscape = Rect {
            x: 48.0,
            y: 118.0,
            w: 1104.0,
            h: 460.0,
        };
        let landscape_default = layout_speech(
            BRAND_MESSAGE,
            &default_cow,
            speech_content(landscape, "fortune | cowsay"),
        )
        .size;
        let landscape_daemon = layout_speech(
            BRAND_MESSAGE,
            &daemon_cow,
            speech_content(landscape, "fortune | cowsay -f daemon"),
        )
        .size;
        let landscape_stego = layout_speech(
            BRAND_MESSAGE,
            &stegosaurus_cow,
            speech_content(landscape, "fortune | cowsay -f stegosaurus"),
        )
        .size;
        let daemon_gain = sizes["daemon"] / landscape_daemon;
        let default_gain = default_size / landscape_default;
        let stego_gain = sizes["stegosaurus"] / landscape_stego;
        assert!(
            daemon_gain > default_gain && daemon_gain > stego_gain,
            "daemon should gain the most from the taller panel: daemon {daemon_gain} ({landscape_daemon} -> {}), default {default_gain} ({landscape_default} -> {default_size}), stegosaurus {stego_gain} ({landscape_stego} -> {})",
            sizes["daemon"],
            sizes["stegosaurus"]
        );
        assert!(
            sizes["daemon"] > 20.0,
            "daemon should clear the old ~11px floor on the square panel, got {}",
            sizes["daemon"]
        );

        let stacked = "moo\n".repeat(120);
        let block = layout_speech(
            &stacked,
            DEFAULT_COW,
            speech_content(terminal_frame(), "fortune | cowsay"),
        );
        assert_block_inside(&block, "stacked fortune");
        assert!(
            block.rows.iter().any(|row| row.text.contains('…')),
            "stacked fortune should ellipsize"
        );
        assert!(block.size + 0.01 >= MIN_FONT_SIZE);
    }

    #[test]
    #[ignore]
    fn write_layout_samples() {
        let dir = std::path::Path::new("/opt/cursor/artifacts");
        std::fs::create_dir_all(dir).expect("artifacts dir");
        let long = "The cow that mooed at midnight still had more to say about grass, rain, and the long road home. ".repeat(12);
        let default_cow = installed_cow("default");
        let daemon = installed_cow("daemon");
        let stegosaurus = installed_cow("stegosaurus");
        let samples = [
            ("og-brand.png", BRAND_MESSAGE, DEFAULT_COW, "default"),
            (
                "og-default.png",
                BRAND_MESSAGE,
                default_cow.as_str(),
                "default",
            ),
            ("og-daemon.png", BRAND_MESSAGE, daemon.as_str(), "daemon"),
            (
                "og-stegosaurus.png",
                BRAND_MESSAGE,
                stegosaurus.as_str(),
                "stegosaurus",
            ),
            (
                "og-long-fortune.png",
                long.as_str(),
                default_cow.as_str(),
                "default",
            ),
        ];
        for (name, message, cow, cow_name) in samples {
            let png = if name == "og-brand.png" {
                render_brand_card()
            } else {
                render_fortune_card(message, cow, cow_name)
            };
            std::fs::write(dir.join(name), png).expect("write sample");
        }
    }

    fn installed_cow(name: &str) -> String {
        let renderer = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/generate-worker-assets.mjs");
        let cowpath =
            std::env::var("COWPATH").unwrap_or_else(|_| "/usr/share/cowsay/cows".to_string());
        let dir = cowpath.split(':').next().unwrap_or(&cowpath);
        let renderer = renderer
            .display()
            .to_string()
            .replace('\\', "\\\\")
            .replace('\'', "\\'");
        let code = format!(
            "import {{ readFileSync }} from 'node:fs';\nimport {{ renderCow }} from '{renderer}';\nprocess.stdout.write(renderCow(readFileSync('{dir}/{name}.cow', 'utf8')));\n"
        );
        let output = std::process::Command::new("node")
            .arg("--input-type=module")
            .arg("--eval")
            .arg(code)
            .output()
            .unwrap_or_else(|error| panic!("node failed to render {name}: {error}"));
        assert!(
            output.status.success(),
            "render {name}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).expect("cow art is utf-8")
    }

    fn assert_block_inside(block: &SpeechBlock, name: &str) {
        assert!(!block.rows.is_empty(), "{name} rendered no rows");
        let right = block.content.x + block.content.w;
        let bottom = block.content.y + block.content.h;
        let domain = domain_top(terminal_frame());
        assert!(
            block.content.y + block.content.h <= domain,
            "{name} content overlaps the domain label"
        );
        for (index, row) in block.rows.iter().enumerate() {
            let row_bottom = row.top + row.above + row.below;
            assert!(
                row.top >= block.content.y - 0.05,
                "{name} row {index} top {} is above the content",
                row.top
            );
            assert!(
                row_bottom <= bottom + 0.05,
                "{name} row {index} bottom {row_bottom} leaves the content"
            );
            let left = block.origin_x + row.ink_left;
            let ink_right = block.origin_x + row.ink_right;
            assert!(
                left >= block.content.x - 0.05,
                "{name} row {index} ink left {left}"
            );
            assert!(
                ink_right <= right + 0.05,
                "{name} row {index} ink right {ink_right}"
            );
            let columns = char_len(&row.text);
            for column in 0..columns {
                let cell_left = block.origin_x + column as f32 * block.advance;
                let cell_right = cell_left + block.advance;
                assert!(
                    cell_left >= block.content.x - 0.05,
                    "{name} row {index} column {column} left {cell_left}"
                );
                assert!(
                    cell_right <= right + 0.05,
                    "{name} row {index} column {column} right {cell_right}"
                );
            }
        }
    }

    fn former_default_font_size() -> f32 {
        // The previous fitter used the font's full new_line_size, a 1032×277
        // content box, and clamped into 11..=34. The brand message plus the
        // default cow is 8 rows by 41 columns.
        let font = font();
        let probe = 20.0;
        let metrics = font.horizontal_line_metrics(probe).expect("line metrics");
        let advance = font.metrics('M', probe).advance_width;
        let by_width = probe * 1032.0 / (41.0 * advance);
        let by_height = probe * 277.0 / (8.0 * metrics.new_line_size.max(probe));
        by_width.min(by_height).clamp(11.0, 34.0)
    }

    fn assert_mauve_inside(png: &[u8], content: Rect, name: &str) {
        let decoder = png::Decoder::new(std::io::Cursor::new(png));
        let mut reader = decoder.read_info().expect("decode");
        let mut buffer = vec![0; reader.output_buffer_size().unwrap_or(0)];
        let info = reader.next_frame(&mut buffer).expect("frame");
        buffer.truncate(info.buffer_size());
        let width = info.width;
        for (index, pixel) in buffer.as_chunks::<3>().0.iter().enumerate() {
            if !near_mauve(*pixel) {
                continue;
            }
            let x = (index as u32 % width) as i32;
            let y = (index as u32 / width) as i32;
            if y < 100 {
                continue;
            }
            let inside = x >= content.x.floor() as i32 - 1
                && x <= (content.x + content.w).ceil() as i32
                && y >= content.y.floor() as i32 - 1
                && y <= (content.y + content.h).ceil() as i32;
            assert!(
                inside,
                "{name} mauve pixel at {x},{y} is outside the terminal text"
            );
        }
    }

    fn near_mauve(pixel: [u8; 3]) -> bool {
        (pixel[0] as i16 - MAUVE.r as i16).abs() <= 36
            && (pixel[1] as i16 - MAUVE.g as i16).abs() <= 36
            && (pixel[2] as i16 - MAUVE.b as i16).abs() <= 36
    }

    #[test]
    fn committed_preview_matches_the_renderer() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../web/public/og.png");
        let rendered = render_brand_card();
        if std::env::var_os("WRITE_OG").is_some() {
            std::fs::write(path, &rendered).expect("write og.png");
        }
        let committed = std::fs::read(path).unwrap_or_else(|_| {
            panic!("missing {path}; regenerate with WRITE_OG=1 cargo test -p webfortune-worker committed_preview -- --exact");
        });
        assert_eq!(
            rendered, committed,
            "web/public/og.png drifted from the card renderer; regenerate with WRITE_OG=1"
        );
    }

    fn count_near(png: &[u8], color: Rgb, tolerance: i16) -> usize {
        // The signature test already checked the header. Count raw RGB after a
        // decode would need the decoder; instead re-render is expensive. Scan
        // the compressed file only for the dimension tests. This helper decodes
        // via the same pixels by rendering again is wasteful, so compare using
        // a fresh render stored... The caller passed PNG bytes. Decode them.
        let decoder = png::Decoder::new(std::io::Cursor::new(png));
        let mut reader = decoder.read_info().expect("decode");
        let mut buffer = vec![0; reader.output_buffer_size().unwrap_or(0)];
        let info = reader.next_frame(&mut buffer).expect("frame");
        buffer.truncate(info.buffer_size());
        buffer
            .as_chunks::<3>()
            .0
            .iter()
            .filter(|pixel| {
                (pixel[0] as i16 - color.r as i16).abs() <= tolerance
                    && (pixel[1] as i16 - color.g as i16).abs() <= tolerance
                    && (pixel[2] as i16 - color.b as i16).abs() <= tolerance
            })
            .count()
    }
}
