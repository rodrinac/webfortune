//! 1200×630 Catppuccin Mocha preview card. Crawlers require a real PNG, so this
//! rasterizes with the bundled JetBrains Mono and encodes RGB pixels directly.
//!
//! The host library target does not link the Worker runtime, which is the only
//! non-test caller. Dead-code checks still run for the wasm32 build.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use std::sync::OnceLock;

use fontdue::Font;

pub const CARD_WIDTH: u32 = 1200;
pub const CARD_HEIGHT: u32 = 630;
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

const WRAP_WIDTH: usize = 42;
const MAX_FORTUNE_LINES: usize = 8;
const MAX_COW_LINES: usize = 24;
const MAX_BLOCK_LINES: usize = 26;

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
    let frame = Rect {
        x: 48.0,
        y: 118.0,
        w: 1104.0,
        h: 460.0,
    };
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
    draw_speech(&mut canvas, frame, card.message, card.cow);
    draw_domain(&mut canvas, frame);
    encode_png(CARD_WIDTH, CARD_HEIGHT, &canvas.pixels)
}

fn draw_header(canvas: &mut Canvas, tagline: &str) {
    let font = font();
    let mark = "(oo)";
    let name = "webfortune";
    let mark_size = 32.0;
    let name_size = 40.0;
    let baseline = 78.0;
    let mut x = 56.0;
    x = draw_text(canvas, font, mark, x, baseline, mark_size, MAUVE).0 + 16.0;
    let (end, _) = draw_text(canvas, font, name, x, baseline, name_size, TEXT);
    fill_circle(canvas, end + 14.0, baseline - 8.0, 5.5, GOLD);

    let tag_size = 24.0;
    let width = measure(font, tagline, tag_size);
    draw_text(
        canvas,
        font,
        tagline,
        1144.0 - width,
        baseline,
        tag_size,
        SUBTEXT,
    );
}

fn draw_command(canvas: &mut Canvas, frame: Rect, command: &str) {
    let font = font();
    let size = 22.0;
    let baseline = frame.y + 3.0 + 70.0 + 36.0;
    let prompt = if has_ink(font, '❯', size) {
        "❯"
    } else {
        ">"
    };
    let cursor = if has_ink(font, '▍', size) {
        "▍"
    } else {
        "_"
    };
    let x = frame.x + 36.0;
    let (after_prompt, _) = draw_text(canvas, font, prompt, x, baseline, size, GREEN);
    let (after_command, _) = draw_text(
        canvas,
        font,
        &format!(" {command}"),
        after_prompt,
        baseline,
        size,
        SUBTEXT,
    );
    draw_text(
        canvas,
        font,
        &format!(" {cursor}"),
        after_command,
        baseline,
        size,
        GOLD,
    );
}

fn draw_speech(canvas: &mut Canvas, frame: Rect, message: &str, cow: &str) {
    let font = font();
    let lines: Vec<String> = speech(message, cow)
        .split('\n')
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        return;
    }
    let content = Rect {
        x: frame.x + 36.0,
        y: frame.y + 3.0 + 70.0 + 52.0,
        w: frame.w - 72.0,
        h: frame.h - 3.0 - 70.0 - 52.0 - 58.0,
    };
    let cols = lines
        .iter()
        .map(|line| char_len(line))
        .max()
        .unwrap_or(1)
        .max(1);
    let rows = lines.len().max(1);
    let size = fit_size(font, cols, rows, content.w, content.h).clamp(11.0, 34.0);
    let metrics = line_metrics(font, size);
    let advance = metrics.advance.max(1.0);
    let block_w = cols as f32 * advance;
    let block_h = rows as f32 * metrics.line_height;
    let origin_x = content.x + (content.w - block_w) / 2.0;
    let origin_y = content.y + (content.h - block_h) / 2.0;
    for (row, line) in lines.iter().enumerate() {
        for (column, character) in line.chars().enumerate() {
            draw_cell(
                canvas,
                character,
                origin_x + column as f32 * advance,
                origin_y + row as f32 * metrics.line_height,
                size,
                &metrics,
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
    canvas.fill_rect(x - 16.0, frame.y + frame.h - 12.0, width + 32.0, 26.0, BASE);
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
    ascent: f32,
    advance: f32,
    line_height: f32,
}

fn fit_size(font: &Font, cols: usize, rows: usize, max_w: f32, max_h: f32) -> f32 {
    let probe = line_metrics(font, 20.0);
    let width_at = |size: f32| cols as f32 * probe.advance * (size / 20.0);
    let height_at = |size: f32| rows as f32 * probe.line_height * (size / 20.0);
    let by_width = if cols == 0 {
        34.0
    } else {
        20.0 * max_w / width_at(20.0)
    };
    let by_height = if rows == 0 {
        34.0
    } else {
        20.0 * max_h / height_at(20.0)
    };
    by_width.min(by_height)
}

fn line_metrics(font: &Font, size: f32) -> LineBox {
    let metrics = font.horizontal_line_metrics(size);
    let advance = font.metrics('M', size).advance_width;
    match metrics {
        Some(metrics) => LineBox {
            ascent: metrics.ascent,
            advance: if advance > 0.0 { advance } else { size * 0.6 },
            line_height: metrics.new_line_size.max(size),
        },
        None => LineBox {
            ascent: size * 0.8,
            advance: if advance > 0.0 { advance } else { size * 0.6 },
            line_height: size * 1.35,
        },
    }
}

fn draw_cell(
    canvas: &mut Canvas,
    character: char,
    x: f32,
    y: f32,
    size: f32,
    metrics: &LineBox,
    color: Rgb,
) {
    if character == ' ' || character == '\t' {
        return;
    }
    let (glyph, bitmap) = font().rasterize(character, size);
    if glyph.width == 0 || bitmap.is_empty() {
        return;
    }
    let origin_x = x + glyph.xmin as f32;
    let origin_y = y + metrics.ascent - glyph.height as f32 - glyph.ymin as f32;
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

fn speech(message: &str, cow: &str) -> String {
    let clipped: String = message.chars().take(800).collect();
    let mut wrapped = wrap_fortune(&clipped, WRAP_WIDTH);
    if wrapped.iter().all(|line| line.trim().is_empty()) {
        wrapped = wrap_fortune(BRAND_MESSAGE, WRAP_WIDTH);
    }
    let cow_lines = cow_lines(cow);
    let mut keep = wrapped.len().clamp(1, MAX_FORTUNE_LINES);
    while keep + cow_lines.len() > MAX_BLOCK_LINES && keep > 1 {
        keep -= 1;
    }
    let truncated = wrapped.len() > keep;
    let mut body: Vec<String> = wrapped.into_iter().take(keep).collect();
    if truncated {
        if let Some(last) = body.last_mut() {
            *last = "…".to_string();
        }
    }
    let mut lines = bubble(&body);
    lines.extend(cow_lines);
    lines.join("\n")
}

fn cow_lines(cow: &str) -> Vec<String> {
    let normalized = cow.replace("\r\n", "\n").replace('\r', "");
    let source = if normalized.trim().is_empty() {
        DEFAULT_COW
    } else {
        normalized.trim_matches('\n')
    };
    let mut lines: Vec<String> = source.split('\n').map(str::to_string).collect();
    if lines.len() > MAX_COW_LINES {
        lines.truncate(MAX_COW_LINES - 1);
        lines.push("…".to_string());
    }
    lines
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
    encoder.set_compression(png::Compression::Fast);
    encoder.set_filter(png::Filter::Sub);
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
    fn brand_card_is_a_small_1200_by_630_png() {
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
        assert_eq!(png_size(&second), (1200, 630));
        assert!(second.len() < 300 * 1024);
        let huge = "wisdom ".repeat(400);
        let clipped = render_fortune_card(&huge, "", "default");
        assert_eq!(png_size(&clipped), (1200, 630));
        assert!(clipped.len() < 300 * 1024);
        assert!(speech(&huge, DEFAULT_COW).contains('…'));
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
