# Illustrated / animated fortune

Status: proposal for discussion. This document specifies a feature. It does not implement it.

The owner records TikTok clips from webfortune. On 25 November 2026 a test clip animated the permalink for `de` / `kangaroo` / `murphy-38`:

<https://webfortune.app/?locale=de&cow=kangaroo&category=murphy&fortune=murphy-38>

The fortune text, verbatim from the installed Deutsch database, is:

```
Allradantrieb bedeutet, daß man mit seinem Wagen erst dort
steckenbleibt, wo kein Abschleppwagen mehr hinkommt.
```

That body is 113 UTF-8 bytes and 112 Unicode scalar values. The single extra byte is `ß` (U+00DF, UTF-8 `C3 9F`). The line break is in the database. `113 ≤ 160`, so the API classifies it as `length=short`.

The clip was made offline, outside the site:

- An image model (`generate_image` in Google Antigravity CLI, model `gemini-3.1-flash-image`, personal Google plan quota) drew 4 portrait keyframes. The run was about 13 calls: 6 returned HTTP 503 (capacity), none returned HTTP 429, and 4 keyframes were kept. The other responses were not kept; this spec does not invent a reason for them.
- Each kept file was a 768×1376 JPEG with no text drawn in the picture. Together they tell the fortune as a short story starring the cow's animal: a cartoon kangaroo in a mustard-yellow 4×4 drives into mud and sinks, while a tiny tow truck is stranded on the far side of a ravine.
- The same style bible and the same character and vehicle description were repeated in every prompt.
- A Python/PIL + ffmpeg script then rendered a silent 1080×1920, 30 fps, 10 s H.264 clip: Ken Burns pans and zooms, crossfades, a short shake when the jeep gets stuck, a Catppuccin Mocha terminal bar typing `fortune murphy | cowsay -f kangaroo`, the fortune typed into a caption bubble in IBM Plex Mono, and a credit line `webfortune.app / A little wisdom. A lot of moo.`
- Feedback on that clip: the caption was too small on a phone. Make it bigger.

The site feature in this spec is that spirit, wired to the fortune the page is already showing: a scene for the current fortune and cow, the terminal-style typing, a caption large enough to read on a phone, and a way to share or download a vertical clip or a still that stays tied to the permalink.

## 1. Summary, goals, and non-goals

### Goals

- A visitor can open a vertical scene for the fortune and cow already on screen.
- The fortune text and the attribution are drawn as text by our own code. Generated pictures never contain the fortune, letters, logos, or speech bubbles.
- The visitor can download a 1080×1920 still, and where the browser can encode one, a silent ~10 s, 30 fps vertical clip.
- Share hands the file to the system share sheet when the browser allows files, and always offers the permalink.
- The permalink reopens the same fortune, cow, and scene.
- Motion respects `prefers-reduced-motion`. The fortune stays available as text to assistive tech.
- Nothing in the page calls an image provider. Generation, if it happens at all, is an offline job on a quota the owner controls.
- Analytics, if sent, stay behind the existing consent gate and do not carry the fortune text or the fortune id.

### Non-goals

- Replacing the ASCII terminal, the Copy button, the Copy screenshot button, or `GET /og.png`.
- Encoding video inside the Cloudflare Worker.
- Calling an image API from the browser, or from a Worker request a visitor triggers.
- Putting the fortune string, or any letters, into a generated image.
- Illustrating every fortune and every cow in the first release.
- Adding sound, music, or a voice reading.
- Changing fortune selection, the Debian corpus, release versioning, or deployment.

### Recommendation

Ship the player, the permalink flag, the large caption, and the downloads first, with the ASCII cow as the picture. Add painted keyframes only after a person has reviewed them, and only for cows and fortunes on an allow-list. Keep the 25 November pipeline as the art tool, not as a request path.

## 2. User flow and UI

The page already groups actions in `.actions`: Copy, Share (hidden unless `navigator.share` exists), Copy screenshot, and Another fortune. The scene control sits in that row, after Share and before Copy screenshot, so the sharing tools stay together.

### Entry

- Label: the `scene` string in section 9. Icon: a lucide icon already bundled with the page (`clapperboard` is a good fit; the implementation picks one that exists in the installed `lucide` package).
- The button is enabled when a fortune is on screen, same rule as Copy and Copy screenshot (`disabled` when there is no fortune).
- It is shown even when `navigator.share` is missing. Download does not need the share sheet.
- Activating it opens a dialog and sets `scene=1` on the page URL (section 8).

### Player

The dialog is `role="dialog"` and `aria-modal="true"`, labelled by the scene title. Focus moves into the dialog. Escape and a Close button dismiss it and remove `scene=1` with `history.replaceState`, following the page's existing rule that mode changes update the current history entry in place.

Inside the dialog, top to bottom:

1. A 9:16 stage, `max-height` constrained so the dialog fits a phone without covering the Close button. The stage letterboxes if the viewport is wide. The encoded file is always 1080×1920; the on-screen stage is a scale-down of that layout.
2. The picture layer: painted keyframes when a reviewed manifest exists, otherwise the ASCII cow rendered with the same `cowsay()` the page already uses (width 44).
3. A terminal bar drawn with the Catppuccin Mocha colours already in `web/main.js` and `worker/src/card.rs` (`#1e1e2e`, `#181825`, `#1b1b2a`, `#313244`, `#a6e3a1`, `#a6adc8`, `#f9e2af`, and the traffic-light dots `#f38ba8` / `#f9e2af` / `#a6e3a1`). The command is the same string as `#command` (`commandText()`): for the sample permalink that is `fortune murphy | cowsay -f kangaroo`.
4. A caption bubble, real DOM text, not canvas text and not part of the JPEG. This is the large phone caption (section 6 and section 7).
5. The credit: `webfortune.app` plus the locale's existing headline (`A little wisdom.` / `A lot of moo.` and the de/es/pt equivalents).
6. Actions: Play/Pause (or "Show still" when reduced motion is on), Download clip, Download image, Share scene.

The fortune in `#fortune-text` stays in the page, still `aria-live="polite"`. The caption in the dialog repeats that same string as text, so a screen reader can read it inside the dialog too. The caption is the visible large type; it is not a second, rewritten fortune.

### Download and share

- Download image always works. It is a PNG of one composed 1080×1920 frame: picture, terminal bar, full caption, credit. It uses the same `canvas.toBlob(..., "image/png")` path as Copy screenshot. The file name is `webfortune-{fortuneId}-{cow}.png`.
- Download clip is enabled when the browser can encode a silent video (section 6). The file name uses the same stem with `.mp4` or `.webm`.
- Share scene calls `navigator.share` with a `File` when `navigator.canShare({ files })` accepts it, and otherwise shares the permalink the way the existing Share button does. The existing Share button keeps today's payload (`title`, `text` = fortune, `url` = permalink) so the tested URL share does not start failing on browsers that implement `navigator.share` and reject files. The scene dialog is where the file is attached. Both paths use `permalink()` so the URL includes `scene=1` while the dialog is open.

Clipboard image copy can wait. Copy screenshot already covers a square terminal PNG. The scene still is a different aspect ratio and is a download.

### Empty and error states

- No reviewed art for this cow: the ASCII scene still plays. The dialog says so in the `sceneAscii` string. This is the normal state for most fortunes on day one, not an error.
- Fortune too long to caption at the minimum size (section 7): the button stays available, the dialog explains it with `sceneTooLong`, and neither a clip nor a still is offered. The terminal fortune on the page is unchanged.
- Encode or `toBlob` failure: the fortune and the caption stay. The dialog shows `sceneFailed`. Analytics record `failed` only after consent (section 12).

### Recommendation

One dialog, one new button, ASCII first. The existing Share button continues to share the link. The dialog shares the file when the platform accepts files.

## 3. Scene art sourcing

Four ways to get the picture, and a phased path through them.

Counts below come from the repo's own asset generator (`scripts/generate-worker-assets.mjs` `LOCALES` and `generate`) run against the pinned Debian packages in `scripts/debian-fortune-packages.json`:

| Package | Pin |
| --- | --- |
| `fortunes` | 1.99.1-7.3 |
| `fortunes-min` | 1.99.1-7.3 |
| `fortunes-de` | 0.35-1, via that package's postinst and its debconf default `fortunes-de/fortunes_to_install` |
| `fortunes-es` | 1.36 |
| `fortunes-br` | 20220821 |
| `cowsay` | 3.03+dfsg2-8 |

English is every indexed file in the fortune directory except the `de`, `es`, and `brasil` locale paths. Deutsch and Español are the databases inside those directories. Português is the single file `brasil` (no categories). The offensive Debian sets are not in the pin list. `generate-worker-assets.mjs` refuses rotated strfiles, which is how those sets are marked. Recount when the pins change.

| Locale | Databases | Fortunes | `short` (≤ 160 UTF-8 bytes) | `long` |
| --- | ---: | ---: | ---: | ---: |
| en | 43 | 15,217 | 11,065 | 4,152 |
| de | 33 | 17,252 | 12,544 | 4,708 |
| es | 25 | 10,787 | 9,827 | 960 |
| pt | 1 | 2,510 | 2,278 | 232 |
| **All** | **102** | **45,766** | **35,714** | **10,052** |

Deutsch `zitate` alone is 11,617 fortunes. Español `refranes.fortunes` is 4,995. `de` / `murphy` is 54 fortunes, 43 of them short. There are **47** cow files, listed in section 15's appendix, including `kangaroo`.

A "cow animal" is not the same thing as a cow file. `pony` and `pony-smaller` can share one pony design. `vader` and `hellokitty` are named characters, not animals we should redraw. The volume math below uses `C = 47` files and, where noted, an example `A = 16` generic creatures from the appendix. `A` is an example for arithmetic, not a decision.

### (a) Offline pre-generation per fortune id and cow animal

Produce K keyframes for each pair, store them as static files or in R2, and let the page only download the finished JPEGs.

Using the 25 November shape (`K = 4`) and every cow file:

- All fortunes: `45,766 × 47 = 2,151,002` scenes, `8,604,008` images.
- Short fortunes only: `35,714 × 47 = 1,678,558` scenes, `6,714,232` images.
- Short fortunes × example `A = 16`: `35,714 × 16 = 571,424` scenes, `2,285,696` images.
- The murphy pilot the clip already is: `43` short murphy fortunes × 1 kangaroo, or just the one id `murphy-38`.

Storage and call counts are in section 5. The quality of (a) is the quality of the test clip: the picture tells *this* fortune. The cost is that almost all of those pictures will never be watched, `zitate` dominates the bill, and every image still needs a person to look at it (section 4). Git and GitHub Pages are the wrong place for hundreds of gibibytes. R2 (or another object store) is the store if this phase is ever built. The Worker asset bundle that holds fortune JSON and cow text stays as it is.

### (b) On-demand generation through the Worker

The visitor opens a scene, the Worker calls an image API, the Workers Cache API stores the JPEGs, and a per-IP limiter slows abuse.

This matches none of the current request path. `GET /` is `cache-control: no-store` and returns text. `GET /og.png` rasterizes one 1200×1200 PNG with fontdue, caches it under `og_cache_key`, and spends `OG_RATE_LIMITER` only on a miss. That limiter is 5 requests per 10 seconds per IP. The general `RATE_LIMITER` is 50 per 10 seconds per IP. Neither budget is an image-model budget. The 25 November run used a personal quota and still saw 6 HTTP 503s on a single four-frame story.

A public on-demand path also sends visitor-chosen fortune text to a third party from our server, including fortunes the model should refuse, and it does it before any review. The page would have to wait through retries. CSP would grow a provider origin if the browser ever called it directly (section 11 forbids that).

### (c) A curated set of reusable scenes per cow or per category

One reviewed storyboard per allowed cow (about 16 designs, 64 JPEGs at four frames), or one per cow per category (47 × 102 is thousands of scenes and is no longer "curated"). The page overlays *this* fortune's text on the cow's scene. The picture does not depict the particular sentence. The kangaroo-in-the-mud story would be the kangaroo scene, reused for every kangaroo fortune, until a later phase draws unique stories.

This is small enough to ship as static files on GitHub Pages under `web/public/scenes/`, same origin as the UI, no new host, no R2, no Worker change.

### (d) No-art fallback

Animate the ASCII cow the page already draws, plus the terminal bar and the large caption. No image model, no new host, no review queue. Every short fortune works. The picture is the terminal people already came to see, composed for 9:16.

### Tradeoffs

| | What the viewer gets | Operational load | Fits the stack we have |
| --- | --- | --- | --- |
| (a) | The clip's storytelling, per fortune | Generation, storage, and review at corpus scale | Needs R2 or similar, which the Worker does not bind today |
| (b) | The same, generated at view time | Quota abuse, 503s, unreviewed images | Fights the rate limiters and the no-store text API |
| (c) | A consistent animal, text carries the joke | A handful of reviewed images | Static files on Pages, `img-src 'self'` |
| (d) | The terminal, large type, a real download | None beyond the front end | `web/cowsay.js`, `web/main.js`, existing fonts |

### Recommendation

Phase the feature in this order:

1. **(d) for everyone**, so the player, caption size, permalink, download, share, languages, and reduced motion exist without art.
2. **(c) for an allow-list of generic animals**, starting with `kangaroo` and the reviewed frames of the 25 November story (or a new set made with the same bible). One storyboard per cow, overlaid with the current fortune.
3. **(a) only for an allow-list of short fortune ids** the owner actually wants as unique stories, stored in R2, never generated from a page view. `murphy-38` is the template.
4. **Do not build (b).** If a hole in the library needs filling, fill it with the same offline tool that made the test clip.

## 4. Generation pipeline and prompt rules

This section applies to phases (c) and (a). Phase (d) has no prompts.

### Style bible

Every prompt starts with the same block, and the block is the only place style is described:

- Warm painterly cartoon, storybook illustration.
- Rich saturated colours, soft cinematic light, slight film grain.
- Portrait 9:16. The test clip's files were 768×1376. A true 9:16 frame at the export size is 1080×1920. Ask for the largest 9:16 the model will return. Keep a frame when its aspect ratio is within 2% of 9:16 (768×1376 qualifies: `768/1376 ≈ 0.558`, `9/16 = 0.5625`). Reject anything else so the client does not crop the character to fit.
- Absolutely no text, letters, numerals, watermarks, logos, signatures, or speech bubbles.
- No captions burned into the painting. The site draws text itself.

### Character consistency

Each allowed cow has one character card: a fixed description of the creature, and of any vehicle or prop that repeats. The kangaroo card from the test clip is the model: the same cartoon kangaroo, the same mustard-yellow 4×4, the same tiny tow truck, repeated word for word in every frame prompt. Only the action beat changes (driving, entering the mud, sinking, tow truck stranded across the ravine).

The card lives in the repo next to the review notes. The public manifest the page fetches does not need the prompt text.

Cow files that share a creature share a card (`pony` and `pony-smaller`). Cow files that depict a named character or a logo stay off the allow-list until the owner says otherwise (appendix). The ASCII fallback covers them.

### Fortune text stays out of the image

The prompt describes the action in the owner's words. It does not include the fortune string. For `murphy-38` the prompt describes a kangaroo, a yellow 4×4, mud, and a distant tow truck. It does not include "Allradantrieb bedeutet…". That sentence is rendered later as DOM and canvas text (section 7).

Frames that come back with any writing are rejected, even if the writing is nonsense. Review is visual. An OCR pass can be added later as a helper; it is not a substitute for a person on the first sets.

### Safety and the corpus

The Worker does not ship Debian's offensive fortune packages. The packages it does ship still include databases whose jokes are sexual, ethnic, political, or otherwise a bad idea to illustrate. Examples an allow-list should leave out unless the owner explicitly adds them: `ethnic` (161), `drugs` (208), `men-women` (582), and the cow file `cock`. `zippy`, `unfug`, `witze`, and `politics` need a look before any of them are illustrated. `ascii-art` and `asciiart` are pictures made of characters; a "no text in the image" rule fights them. `zitate`, `literature`, `songs-poems`, `gedichte`, `people`, `famosos`, and `letzteworte` often name real people or quote long works; they are a poor fit for a cartoon animal story.

Image models also refuse some prompts and sometimes comply with a prompt we should not have sent. The page never sends a fortune to a model. The batch job sends a human-written beat sheet, and only for ids on the allow-list.

### Human review

A scene is publishable when a person has checked:

- No text, letters, logos, or speech bubbles in any frame.
- The creature and vehicle match the character card across the four frames.
- The beats are the story that was asked for, and they do not add a target the fortune did not have.
- The images are ones the owner is willing to put on a TikTok account.

Rejected frames are regenerated offline. The public site only sees the accepted set. The manifest records the style revision, the cow, the fortune id when the scene is fortune-specific, the pixel size, and a content hash of each JPEG. It does not record the viewer's IP or the raw fortune.

### Recommendation

Treat generation as a reviewed publishing step, like adding a screenshot under `docs/screenshots/`. The style bible and the character card are fixed text. The fortune is not an image prompt. The allow-list is opt-in per cow and, for unique stories, per fortune id.

## 5. Cost, quota, caching, and storage

Prices are not stated here. Multiply the call and byte formulas by the provider's current price sheet when someone is about to spend money. The figures below are counts from the repo, the observed 25 November run, and planning assumptions that are marked as assumptions.

### Assumptions (not measurements of the test files, and not prices)

| Symbol | Value | What it is |
| --- | --- | --- |
| `K` | 4 | Keyframes kept for the test clip |
| `calls_per_kept` | `13 / 4 = 3.25` | Observed calls per kept frame on that one run, including 6 HTTP 503s and 0 HTTP 429s. A later run can land higher or lower |
| `J` | 200 KiB | **Planning assumption** for one 768×1376 painterly JPEG. The test files were not in the repo and were not measured for this spec |

### Formulas

```
images = N × K
provider_calls ≈ N × K × calls_per_kept
storage_bytes ≈ N × K × J
```

`N` is the number of scenes. Provider calls are zero for phase (d). Storage for phase (d) is zero image bytes.

| Scene set | `N` | Images (`K = 4`) | Storage at `J = 200 KiB` | Calls at `3.25` per kept frame |
| --- | ---: | ---: | ---: | ---: |
| One pilot, `murphy-38` × kangaroo | 1 | 4 | 800 KiB | 13 (the observed run) |
| Curated generic cows, example `A = 16` | 16 | 64 | 12.5 MiB | 208 |
| All short murphy × kangaroo | 43 | 172 | 33.6 MiB | 559 |
| All short × example `A = 16` | 571,424 | 2,285,696 | 436.0 GiB | 7,428,512 |
| All short × all 47 cow files | 1,678,558 | 6,714,232 | 1,280.6 GiB | 21,821,254 |
| All fortunes × all 47 cow files | 2,151,002 | 8,604,008 | 1,641.1 GiB (1.603 TiB) | 27,963,026 |

GiB here is `bytes / 1024³`, rounded to one decimal. The last two rows are why (a) at full coverage is not the first milestone. The first two rows fit in the Pages site. The personal Google plan that served the test clip is not a production quota; 503s on 13 calls are a capacity signal, and a zero 429 count on that run says nothing about a batch of millions.

### Rate limiting

Today, in `worker/wrangler.jsonc`:

- `RATE_LIMITER` (namespace `1001`): 50 requests per 10 seconds per client IP, on API requests, HEAD included.
- `OG_RATE_LIMITER` (namespace `1002`): 5 requests per 10 seconds per client IP, and only when `/og.png` is a cache miss. Hits skip that limiter.

Phase (d) and phase (c) on Pages add no Worker route, so they add no limiter. A later R2 or Worker scene manifest, if it only returns JSON, can sit on `RATE_LIMITER` with the rest of the cheap API. Any future server-side image work uses a separate limiter, checked only on cache miss, on the same pattern as `OG_RATE_LIMITER`. This spec does not pick the numeric limit for a limiter that phase 1 and 2 do not need. It does say the image-model call is not attached to either existing limiter, because those limiters are per visitor IP and the quota is the owner's.

### Caching keys

`og_cache_key` in `worker/src/api.rs` builds a synthetic URL from validated fields, not from the raw query string:

```
https://og.cache.webfortune.invalid/og.png?locale={locale}&cow={cow}&database={database}&index={index}
```

Parameter order and omitted defaults that resolve to the same card share one entry. Successful PNGs are stored in the Workers Cache API with `cache-control: public, max-age=86400`. The cache can evict. Fortune text stays `cache-control: no-store`.

If a later phase proxies scene JPEGs through the Worker, copy that pattern:

```
https://scene.cache.webfortune.invalid/scene/v{style}/locale={locale}&cow={cow}&database={database}&index={index}&frame={n}
```

The style revision is part of the key so a new bible does not serve the previous painting. For a cow-level reusable scene the fortune id is absent and the key is `locale`-independent:

```
https://scene.cache.webfortune.invalid/scene/v{style}/cow={cow}&frame={n}
```

Build the key after validation (known cow, known frame index, allow-listed fortune id when present). Do not use the visitor's query string as a cache key. The Cache API is a cache. Pages or R2 is the source of truth.

### Storage layout

Cow-level scenes (phase c), same origin, safe to commit because the set is small and reviewed:

```
web/public/scenes/v1/cows/{cow}/frame-1.jpg
web/public/scenes/v1/cows/{cow}/frame-2.jpg
web/public/scenes/v1/cows/{cow}/frame-3.jpg
web/public/scenes/v1/cows/{cow}/frame-4.jpg
web/public/scenes/v1/cows/{cow}/manifest.json
```

Fortune-specific scenes (phase a), object storage, not the git repo and not the Worker asset bundle:

```
scenes/v1/{locale}/{database}-{index}/{cow}/frame-{n}.jpg
scenes/v1/{locale}/{database}-{index}/{cow}/manifest.json
```

`{database}-{index}` is the fortune id the API already uses (`murphy-38`, and for Español names that already contain dots, `leydemurphy.fortunes-3`). The object key carries the id, never the fortune text. `manifest.json` lists frame file names, pixel size, sha256, and style revision. Durations and the optional shake beat can live there too, so the client does not hard-code the mud-shake for cows that have no mud.

A public manifest URL is a relative path or a fixed first-party host. It is not taken from a query parameter.

### Recommendation

Budget phase (c) as dozens of images and a couple of hundred provider calls, on the owner's existing personal workflow, with a person reviewing every frame. Revisit (a) only with an allow-list whose `N × K × J` the owner has priced from a current rate card. Do not price the full corpus from this document; the full-corpus rows exist to show scale.

## 6. Clip rendering

### What the file is

- Picture size: 1080×1920 (exact 9:16).
- Length: 10.0 s. Frame rate: 30 fps. Frame count: 300.
- Silent. No audio track.
- One composed still PNG at the same size, with the caption already at full size (the frame a viewer sees if they never play the clip).
- The caption uses the floor in section 7. The test clip's caption was too small on a phone; the export must not shrink type to squeeze the painting.

Suggested timing, held constant so a fixture can be re-rendered:

| Time | Layer |
| --- | --- |
| 0.0–1.6 s | Terminal command types, one character at a time, then the block cursor rests |
| 0.0–10.0 s | Picture: four keyframes, Ken Burns pan and zoom, crossfade about 0.4 s. A shake only if this storyboard's manifest names a beat and a time. The ASCII fallback does not shake |
| After the command | The caption types only if the whole fortune finishes with at least 2.5 s of the complete text still on screen, at no more than 30 characters per second. Otherwise the full caption is visible as soon as the command finishes. The fortune is never cut short to fit the typing |
| Entire clip | Credit stays readable in the bottom safe area |

Safe area: 72 px inset on the left and right, and the credit plus caption sit above the bottom 240 px. Phone players and TikTok's own buttons cover the lower edge and the right edge. The painting is full-bleed behind the UI; the text does not depend on the painting for contrast. The bubble is Catppuccin Mocha `#1e1e2e` at high opacity, text `#cdd6f4`.

On a 390 CSS-pixel-wide phone showing the 1080-wide frame full bleed, 64 px in the file is about 23 CSS px (`64 × 390 / 1080`). That is the floor. When the wrapped line count allows it, use 72–80 px. Do not go below 64 px to fit a longer fortune.

### Client-side

The page already paints a PNG in a canvas (`Copy screenshot` in `web/main.js`) and waits for `document.fonts.ready` before drawing JetBrains Mono. The scene export is the same idea at a fixed 1080×1920, independent of `devicePixelRatio` (the screenshot path scales by DPR; the clip should not, or the file stops being 1080×1920).

Encode order, first success wins:

1. `VideoEncoder` (WebCodecs) with an H.264 codec string the browser reports from `VideoEncoder.isConfigSupported`, muxed to MP4 by a library vendored under `web/` (built with the rest of the Vite app, loaded from `'self'`). This is the TikTok-shaped file: `video/mp4`, silent, 1080×1920, 30 fps.
2. `MediaRecorder` when it can produce `video/mp4` (Safari's recorder often can, even when H.264 *encoding* via WebCodecs is missing).
3. `MediaRecorder` `video/webm` for browsers that only record WebM. Offer it as a download. Do not expect the iOS share sheet or TikTok to accept it.
4. PNG still only, with the clip button disabled and `sceneClipUnavailable` shown.

Check `navigator.canShare({ files: [file] })` before passing `files` to `navigator.share`. If that returns false, share the permalink and still offer the download. If `share` throws because of the file, call it again with the permalink only.

Browser reality to re-check at implementation time, because it moves:

- Chromium: WebCodecs H.264 encode is the dependable MP4 path. `MediaRecorder` there is usually WebM.
- Safari: `navigator.share` with a `video/mp4` or `image/png` file is the path that matches "post this to TikTok from the phone". WebM file share is a dead end on iOS. WebCodecs exists in current Safari; H.264 *encode* support is the part that must be feature-detected, not assumed.
- Firefox: WebM via `MediaRecorder`, share-with-files often absent. Download still works.

Draw frames one at a time. One uncompressed 1080×1920 frame is `1080 × 1920 × 4 = 8,294,400` bytes (about 8 MiB). Holding all 300 frames uncompressed would be about 2.4 GiB. The encoder should pull each frame and drop it.

The on-screen preview can be the same canvas, or DOM layers (picture, terminal, caption) that the export path then paints into the canvas. DOM caption in the dialog is what assistive tech and CSS font size use (section 10). The file gets the caption painted into the frame at export, from the same string.

### Server-side

The Worker renders `/og.png` as one fontdue PNG. It has no ffmpeg, and the miss path for that single image is already on a 5-per-10-seconds limiter. A 300-frame 1080×1920 encode is a different kind of job (CPU time, memory for the frame buffer, and a response body the request would have to hold or stream). Confirm Cloudflare's current CPU and memory limits when implementing; this spec's recommendation does not depend on a particular number. The Worker should not gain a video endpoint.

Pre-rendering clips offline and storing MP4s would move the cost to storage (`N` video files instead of `N × K` JPEGs) and would still be wrong for phase (d), where the caption is the current fortune over a shared picture. Compose on the client so one cow's JPEGs serve every fortune for that cow.

### Recommendation

Compose and encode in the browser. Prefer a vendored H.264-to-MP4 path, then Safari's MP4 `MediaRecorder`, then WebM as a download-only fallback, and always offer the PNG. Leave the Worker out of video.

## 7. Text integrity

Two surfaces, two rules.

**Caption and credit (what the phone needs to read).** The string is the fortune body from the API, the same bytes the page assigns to `fortune`. Draw it with `textContent` in the dialog and with `fillText` in the export canvas. Do not run it through HTML. Do not Unicode-normalize it (`ß` must not become `ss`, and normalization must not change which scalar values are drawn). Do not translate it. Accents in Español and Português (`á`, `ã`, `ç`, `ñ`, `é`, …) and German `äöüÄÖÜß` are part of the string.

JetBrains Mono is already self-hosted. The latin subset in `web/fonts.css` covers U+0000–00FF, which includes `ß` (U+00DF) and the Latin-1 accents. The latin-ext file covers the rest of the European range the fonts were subset for. The export waits on `document.fonts.load` for JetBrains Mono at the caption size before measuring or drawing, the way Copy screenshot already waits on `document.fonts.ready`. Missing glyphs fall back to "ineligible" rather than to a substitute character: if `document.fonts.check` fails for a scalar value in the fortune at that size, do not offer the clip.

IBM Plex Mono is what the test clip used. It is not in the repo. Adding it means a new font file, a license next to `web/fonts/JETBRAINS-MONO-LICENSE.txt`, and a `font-src` that stays `'self'` only if the file is vendored. The phone-size failure was the pixel size, and section 6 fixes that on the font the site already ships.

**Wrapping.** The caption wraps on Unicode whitespace. A newline already in the fortune is a hard break (`murphy-38` has one). Words are not split, hyphenated, or ellipsized. Tabs, if any fortune contains them, expand to four spaces, matching `cowsay.js`, so a tab does not become a missing box. Multiple spaces between words collapse to one space at a wrap point; that is the only whitespace change, and it does not change letters.

At the floor font size (64 px at 1080 width) and the safe-area column, if the line count does not fit in the caption region, the fortune is ineligible for a scene file. The dialog uses `sceneTooLong`. The page's ASCII fortune is unaffected.

**Eligibility.** A scene file is offered when all of these hold:

- The page has a pinned fortune id (`x-fortune-id` / the `fortune` query param). A daily fortune has no id on the URL; choosing Scene pins the id that was served and clears `daily=true`, so tomorrow's UTC rollover does not change the clip's permalink. The API rejects `daily` together with `fortune`, and rejects `length` together with `fortune`. The permalink after this pin matches `settingsQuery` in `web/settings-url.js`.
- The body is at most 160 UTF-8 bytes, the same rule as `length=short` (`SHORT_FORTUNE_LENGTH` in `scripts/generate-worker-assets.mjs`). Byte length, not character length: `murphy-38` is 112 scalars and 113 bytes because of `ß`.
- The wrap at 64 px fits the caption region.
- For a painted scene, a reviewed manifest exists. Otherwise the ASCII scene is the file, under the same text rules.

`length=long` fortunes (10,052 of them) are out of scope for the file until the owner asks. They remain on the page as text.

**Terminal command.** `commandText()` in `web/main.js` is the source of truth, so the clip and the page match. With length unset it is `fortune {category} | cowsay -f {cow}`, and the `-f` part is omitted for `default`. The sample permalink has no `length` param, so the bar types `fortune murphy | cowsay -f kangaroo`, the same command as the test clip. Português has no category, so the command is `fortune | cowsay` or `fortune | cowsay -f {cow}`.

**ASCII layer.** The picture of the cow uses `cowsay(fortune, 44, artwork)` from `web/cowsay.js`, the same wrap as `GET /?format=cowsay`. That wrap drops C0 controls other than tab and newline. That is acceptable for the ASCII drawing because it is what the page already shows. It is not the caption algorithm. The caption uses the rules above so `ß` and the words stay intact even when the bubble's line breaks differ from cowsay's.

### Recommendation

Caption the API string in JetBrains Mono at 64 px or larger, wrap on whitespace only, and refuse the file when that does not fit. Limit scene files to short, pinned fortunes. Keep IBM Plex Mono out unless the owner wants the clip's exact typeface enough to vendor another font.

## 8. Permalink and sharing

### `scene=1`

Page-only parameter. The only accepted value is `1`. A repeat, an empty value, or any other value is ignored, the same way `dailyParam` ignores anything other than a single `daily=true`.

`readPageSettings` and `settingsQuery` learn the flag. Order stays the current one, with the flag last:

```
?locale=de&cow=kangaroo&category=murphy&fortune=murphy-38&scene=1
```

`fortuneRequestPath` does not copy `location.search`. It builds `locale`, `category`, `fortune`, `length`, and `daily` itself. It must continue to omit `scene`. `GET /` rejects unknown parameters with 400 and the message `Only one locale and category parameter are supported.` `GET /og.png` rejects them with `Only one locale, category, cow, and fortune parameter are supported.`

Opening that URL loads the fortune as today, then opens the dialog. The first visit and an invalid id still fall back the way the page already does; a fallback that abandons the pinned id also drops `scene=1`, because there is no longer a scene for the id that was asked for.

`scene=1` together with `daily=true` is a request to pin. After the daily fortune loads, the page writes the served id, removes `daily`, and keeps `scene=1`.

### Open Graph

Crawlers do not run the page's JavaScript. GitHub Pages serves one `index.html` for every query string. Per-fortune tags exist only when the Worker rewrites HTML.

`worker/wrangler.jsonc` currently lists routes for `webfortune.app/*` and `www.webfortune.app/*` as well as `api.webfortune.app`. `docs/deployment.md` still describes the site routes as commented out. Implementers should confirm what production is actually routing before depending on the rewrite. The rewrite code itself (`worker/src/preview.rs`, `share_target` in `worker/src/api.rs`) keys off a `fortune` parameter and ignores unknown parameters via `single()`, so `scene=1` does not prevent a preview. `page_query` rebuilds `og:url` from locale, cow, category, and fortune, and today drops anything else.

Recommended preview behavior:

- Keep `og:image` as the 1200×1200 ASCII card from `GET /og.png`. That card is square, already cached, and already what chats show. A 1080×1920 still is a bad Open Graph image, and `og:video` is not reliable enough to be the plan.
- Preserve `scene=1` on the rewritten `og:url` when the incoming query had a single `scene=1`, so a chat that follows `og:url` still opens the dialog.
- Do not point `og:image` at a keyframe. Keyframes have no text, so the preview would be a painting with no fortune. The description already contains the fortune text (`share_copy`).

The static tags in `web/index.html` stay the branded card for the homepage and for any URL the rewriter does not claim.

### Share payload

Scene dialog, when `canShare` accepts the file:

```
title: "webfortune"
text:  "{fortune}\n\n{permalink}"
url:   "{permalink}"
files: [mp4 or png File]
```

Some mobile share sheets drop `url` when `files` is set. Repeating the permalink in `text` keeps the link next to the video. The fortune in `text` is the same string Copy already puts on the clipboard.

When files are refused, the payload matches today's Share button, with the permalink including `scene=1` if the dialog is still open.

### Recommendation

Add `scene=1` as a page-only flag, last in the query string, and never forward it to the API. Keep the square ASCII card as the Open Graph image. Attach the video or the still in the scene dialog's share action, and leave the main Share button on the text-and-link payload it has now.

## 9. i18n

Strings live in the `translations` object in `web/main.js`, next to `share` and `copyScreenshot`. Copy below is draft for the owner to correct. The fortune itself is never translated.

| Key | en | de | es | pt |
| --- | --- | --- | --- | --- |
| `scene` | Scene | Szene | Escena | Cena |
| `sceneClose` | Close scene | Szene schließen | Cerrar escena | Fechar cena |
| `scenePlay` | Play | Abspielen | Reproducir | Reproduzir |
| `scenePause` | Pause | Pause | Pausa | Pausar |
| `sceneStill` | Still image | Standbild | Imagen fija | Imagem estática |
| `sceneDownloadClip` | Download clip | Clip herunterladen | Descargar clip | Baixar clipe |
| `sceneDownloadStill` | Download image | Bild herunterladen | Descargar imagen | Baixar imagem |
| `sceneShare` | Share scene | Szene teilen | Compartir escena | Partilhar cena |
| `sceneAscii` | This scene uses the terminal cow. | Diese Szene zeigt die Terminal-Kuh. | Esta escena usa la vaca de la terminal. | Esta cena usa a vaca do terminal. |
| `sceneTooLong` | This fortune is too long for a large caption. Try a short one. | Dieser Spruch ist zu lang für eine große Unterschrift. Versuch einen kurzen. | Esta fortuna es demasiado larga para un pie grande. Prueba una corta. | Esta fortuna é longa demais para uma legenda grande. Tente uma curta. |
| `sceneClipUnavailable` | This browser can save the image. It cannot build the clip. | Dieser Browser kann das Bild speichern, den Clip aber nicht erzeugen. | Este navegador puede guardar la imagen, pero no crear el clip. | Este navegador pode salvar a imagem, mas não monta o clipe. |
| `sceneFailed` | The scene didn't render. The fortune is still here. | Die Szene konnte nicht erzeugt werden. Der Spruch bleibt. | La escena no se pudo crear. La fortuna sigue aquí. | A cena não foi renderizada. A fortuna continua aqui. |
| `sceneReduced` | Motion is off. Showing a still image. | Bewegung ist aus. Ein Standbild wird gezeigt. | El movimiento está desactivado. Se muestra una imagen fija. | O movimento está desligado. Mostrando uma imagem estática. |
| `sceneCreditSecond` | A lot of moo. | Eine Menge Muh. | Mucho muu. | Muito muu. |

`sceneCreditSecond` duplicates the existing `headlineSecond` + `moo` strings (`A lot of` + `moo.`, and the localized pairs). Implementation should reuse those strings rather than grow a second copy that can drift. The first half of the credit is the existing `headlineFirst` (`A little wisdom.` / `Ein wenig Weisheit.` / `Un poco de sabiduría.` / `Um pouco de sabedoria.`).

The terminal command is not translated. It is a shell command, same as `#command` today.

`ogLocale` values already in the page (`en_US`, `de_DE`, `es_ES`, `pt_BR`) stay as they are. Scene mode does not add locales.

### Recommendation

Add the keys above to all four locale objects in one change, reuse the existing headline strings for the credit, and get a native read on the German and Portuguese lines before they ship. The draft is intentionally boring and parallel.

## 10. Accessibility and reduced motion

The page already does two things the scene has to keep doing:

- `#fortune-text` is visually hidden and `aria-live="polite"`, and the fortune is assigned with `textContent`. The ASCII `<pre id="cow">` is `aria-hidden="true"`.
- `@media (prefers-reduced-motion: reduce)` in `web/style.css` sets `animation: none` and `transition: none` on everything. That does not stop `requestAnimationFrame` or a `<video>`. The player checks `window.matchMedia("(prefers-reduced-motion: reduce)")` in script and listens for changes.

When reduced motion is requested:

- Do not run Ken Burns, the shake, the typing animation, or autoplay.
- Show the composed still immediately, with the full caption and the full command.
- Set the dialog status to `sceneReduced`.
- Download image remains. Download clip remains available as an explicit action (the file can contain motion the page itself is not playing) and does not start by itself.

The dialog:

- `aria-modal="true"`, labelled by a visible heading.
- Close is a real button. Escape closes. Focus returns to the Scene button.
- The caption is DOM text associated with the picture (`aria-describedby` on the stage pointing at the caption). The picture's `alt` is the cow's situation in one short line from the manifest (`alt` in the manifest, written at review time, in the fortune's language or in English with a note). For the ASCII fallback the alt is the existing idea from the OG card, localized later if needed: the stage is described as the terminal cow, and the fortune is the caption, not repeated inside `alt`.
- The stage is not the only place the fortune exists. `#fortune-text` remains.
- Play/Pause is a button with a name that flips between `scenePlay` and `scenePause`. Reduced motion hides Play and shows `sceneStill`.
- Contrast of the caption is the Mocha bubble and `#cdd6f4` text, not the painting. A painted sky must not be the only thing behind the type.
- The 64 px floor is an accessibility requirement as well as a TikTok one. Do not offer a "small caption" mode.

### Recommendation

Reduced motion shows the still, script-enforced. The caption is real text in the dialog. The export paints that same text into the file. Alt text describes the picture; the fortune stays in the caption and in the live region.

## 11. Security, privacy, and CSP

### Current page policy

`worker/html-security-headers.txt` is the HTML policy. Vite preview sends it, and Playwright reads it. The relevant directives today:

```
default-src 'self'
script-src 'self' https://www.googletagmanager.com
connect-src 'self' https://api.webfortune.app https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com
img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com
style-src 'self'
font-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
```

There is no `media-src` and no `worker-src`. Both fall back to `default-src 'self'`. A `<video src="blob:…">` is therefore blocked. An `img` or canvas blob is already allowed (`img-src` includes `blob:`). API responses use a separate, tighter policy in `security::API_SECURITY_HEADERS` (`default-src 'none'`). That policy stays. Scene files are not API HTML.

`referrer-policy` is `strict-origin-when-cross-origin`. A cross-origin image URL that contains `murphy-38` would send that path to the other host. Same-origin scenes do not add a new referrer leak.

### What has to change, and when

Phase (d), canvas preview, PNG download, no `<video>` element (playback is canvas frames):

- No CSP change. Fonts, scripts, and pictures are `'self'`. The PNG blob is drawn to a canvas and downloaded via an object URL on an `<a download>`, which does not need `media-src`.

Phase (d) or later, if a `<video src="blob:…">` is how the preview plays:

- Add `media-src 'self' blob:`.
- Do not add the image provider. Do not add a CDN for the muxer.

Phase (c), JPEGs on Pages:

- `img-src 'self'` already covers `/scenes/v1/...`.
- No new `connect-src`.

Phase (a), JPEGs on a first-party host that is not the page origin (for example `https://assets.webfortune.app` in front of R2):

- Add that exact origin to `img-src`.
- Prefer a hostname we control over a public `r2.dev` URL.
- The page still does not call the image model.

A module worker used for encoding, served from the site:

- `worker-src 'self'` is worth setting explicitly so a blob worker is not required. Blob workers would need `worker-src blob:`, which is a wider hole. Prefer a same-origin worker file, or encode on the main thread in short slices if a worker is not worth it.

Analytics hosts stay as they are. They are already gated by consent in `web/analytics.js` (`readConsent` must be `"granted"` before `track` sends). Scene code must not add a new network call that fires before that choice. Loading same-origin JPEGs is fine before consent; they are the feature, not a tracker. Loading Google's image API is not fine before or after consent. Generation stays offline.

### Other constraints

- The scene parameter is not a URL. Manifest paths are relative and resolved against the page origin, or against one configured asset origin. A query value must not become a `fetch` URL.
- Fortune text is never interpolated into HTML. `textContent` and `fillText` only. This matches the README rule that fortune text is always rendered as text.
- No image-provider key in the client, in `VITE_*` variables, or in committed Wrangler vars. A batch job's key stays in the owner's environment.
- Scene requests do not send the fortune body to a third party. The client sends the fortune id only as part of a first-party path or query to our own host, the way the permalink already does.
- `eventParams` in `web/analytics.js` drops `fortune`, `fortune_id`, `text`, `ip`, `email`, and `client_id`. Scene events must not smuggle the id under another name. `page_location` is already `origin + pathname`, without the query string. Keep it that way. The permalink contains the fortune id, so it does not belong on an event either.
- CORS for the API stays limited to `https://webfortune.app` and `https://rodrinac.github.io`. Scene assets on Pages are same-origin and need no CORS. If the API ever serves scene JSON, it uses the existing CORS helper and exposes no new headers beyond `x-fortune-id`.

### Recommendation

Phase 1 ships with the current CSP, canvas playback, and same-origin (or no) images. Add `media-src 'self' blob:` only if a video element plays a blob. Add an asset host to `img-src` only when R2 exists. Never add the image provider to the page policy.

## 12. Analytics events

Consent rules are unchanged: `trackSiteEvent` returns immediately unless `localStorage` holds `webfortune-analytics=granted`. Decline sends nothing. The measurement id stays `VITE_GA_MEASUREMENT_ID`, and an empty id means no tag at all (`docs/deployment.md`).

New events, all optional and all stripped by the existing sanitizer if they misbehave (`NAME_PATTERN`, length ≤ 100, no blocked keys):

| Event | When | Params |
| --- | --- | --- |
| `scene_open` | Dialog opens | `result`: `ready`, `ascii`, `ineligible`, `reduced_motion` |
| `scene_play` | Visitor starts playback, or reduced motion shows the still | `result`: `played`, `still` |
| `scene_download` | Download finishes or fails | `format`: `png`, `mp4`, or `webm`; `result`: `downloaded` or `failed` |
| `scene_share` | Share scene settles | `format`: `mp4`, `webm`, `png`, or `url`; `result`: `shared`, `cancelled`, `failed`, or `files_unsupported` |

`trackSiteEvent` already attaches `locale`, `category`, and `cow`. Those are the context. Do not add the fortune id, the fortune text, the permalink, the prompt, or the style-bible text.

`result` is already a custom dimension in the deployment notes. `format` would need registering as an event-scoped custom dimension next to `locale`, `category`, `cow`, `reason`, and `result`, in the same GA4 admin step `docs/deployment.md` describes. Until that registration, the event still collects; the breakdown just does not show in standard reports.

`scene_share` with `format=url` is the fallback that shared the link. It is distinct from today's `share_fortune`, which remains the main Share button.

### Recommendation

Four events, the params above, no new identifiers. Register `format` when the feature ships, in the same place the other dimensions are registered.

## 13. Testing

### Unit tests

`web/settings-url.js` already has tests. Extend them:

- A single `scene=1` round-trips through `readPageSettings` and `settingsQuery`.
- `scene=true`, `scene=0`, `scene`, and a repeated `scene` are ignored.
- Query order is locale, cow, category, length, daily, fortune, scene.
- `scene` is not required for old links, and old links still parse.

New pure functions, tested without a browser:

- Byte length matches `fortuneBodyLength`: the `murphy-38` fixture is 113 bytes, contains `ß`, and is eligible on length.
- A string that is 160 bytes is eligible on length; 161 is not. Use a fixture, not the live database, so CI does not download Debian packages for this test.
- Caption wrap preserves every scalar value of the fixture, including `ß`, `ä`, `á`, `ã`, `ç`, and `ñ`. It does not insert hyphens. A newline in the fixture is a hard break.
- A long unspaced token that cannot fit the column at 64 px marks the fortune ineligible.
- `commandText()` for `{ category: "murphy", cow: "kangaroo", length: "" }` is `fortune murphy | cowsay -f kangaroo`.

If `share_target` is taught to keep `scene=1` on `og:url`, add a Rust test next to the existing permalink tests in `worker/src/api.rs`: a query with `scene=1` still resolves, the rebuilt page query includes `scene=1`, and `GET /` handling of `scene` is unchanged (still 400 if a client sends it to the API). That last test locks the "page must strip it" rule.

### Playwright

Follow `tests/browser/share.spec.js` and `tests/browser/csp.spec.js`:

- The Scene button is in the action row on desktop and at the mobile project width, with the four locale labels.
- Opening it sets `scene=1`. Escape removes it. Reload with `scene=1` and a mocked fortune id opens the dialog.
- The caption's `textContent` is the mocked fortune, including a `ß` fixture, and its computed font size at the export layout is at least the floor (assert the layout constant, not a screenshot of antialiasing).
- `prefers-reduced-motion: reduce` shows the still and does not start playback. The caption is already complete.
- Download image produces an `image/png` blob. A stubbed encoder produces a file and a download. Share scene calls `navigator.share` with a `files` entry when `canShare` is stubbed true, and without `files` when it is stubbed false.
- The fortune request URL does not contain `scene`, and no request goes to a host other than the app and the mocked API. The CSP test still forbids `unsafe-inline` and still has `font-src 'self'`.
- A fortune marked long shows `sceneTooLong` and does not enable download.

### Visual checks

- A fixture still, rendered in a unit test from a tiny in-repo PNG and the `murphy-38` string, is compared for caption presence (the string is drawn, the PNG hash of a small crop of the caption area is stable). Avoid snapshotting the whole frame if fonts differ by platform; run that test in CI where the vendored woff2 is what canvas loads, or assert glyph coverage another way if canvas text is unavailable under node.
- A manual check on a phone-sized viewport (390 px wide) before any art ships: the caption is readable at arm's length, the credit is not under the dialog buttons, and the ASCII cow is inside the 9:16 stage.
- When the kangaroo frames exist, a person compares them to the style bible and to each other before they are committed. That review is not a CI job.

The 25 November clip is the reference for tone. CI does not call an image model and does not run ffmpeg.

### Recommendation

Test the permalink flag, the verbatim caption, the byte-length gate, the share-file branch, and reduced motion in CI. Review paintings by eye. Do not add a network test that talks to an image API.

## 14. Phased rollout

Each milestone is shippable on its own and leaves the ASCII terminal working.

### M0 — This spec

Discussion on the PR. No behavior change.

### M1 — Player with the ASCII cow

- Scene button, dialog, `scene=1`, i18n, large caption, credit, terminal typing.
- PNG download at 1080×1920.
- MP4 when the browser can encode it, WebM as a download fallback, clip button hidden when neither works.
- Share scene with files when `canShare` agrees.
- Reduced motion, dialog accessibility, consent-gated events.
- CSP unchanged if playback is canvas-only.
- Tests from section 13 for the flag, the caption, and the dialog.
- No new hosts, no R2, no image provider, no Worker video route, no version-bump behavior beyond whatever the repo's normal release process does when a later implementation PR merges. This spec does not bump a version.

### M2 — Reviewed cow scenes

- Character cards and the style bible checked in as text.
- Allow-list of generic animals (appendix is the starting proposal).
- Four JPEGs and a manifest per allowed cow under `web/public/scenes/v1/cows/{cow}/`.
- `kangaroo` first, using the 25 November story or a fresh set made with the same rules.
- Page selects the manifest when the current cow has one, and uses M1's ASCII path otherwise.
- `img-src` stays `'self'`.

### M3 — Fortune-specific stories, still offline

- Allow-list of short ids. `murphy-38` is the first.
- Batch generation on the owner's quota, human review, objects in R2 or equivalent, cache key from section 5 if the Worker fronts them.
- `img-src` gains the asset host in the same change that introduces the host.
- Still no visitor-triggered generation.

### M4 — Not scheduled

On-demand generation (option b) is out of the plan. Revisit only if M3 is not enough and a written quota and review story exists. This spec's recommendation is to leave it unbuilt.

### Recommendation

Implement M1 before commissioning more paintings. M1 is the product the owner asked for (a scene of the current fortune and cow, terminal typing, a shareable vertical file, the permalink), with the art slot empty and honest about it. M2 is the kangaroo clip's look, reused. M3 is unique stories, bought one id at a time.

## 15. Open questions

1. **Who is it for at first?** A button for every visitor (recommended), or a flag the owner uses to record clips while the public page stays as it is?
2. **Which cows may be painted?** The appendix is a proposal that separates generic creatures from named characters (`hellokitty`, `vader`, `calvin`, `ren`, `stimpy`, `ghostbusters`, `suse`, `tux`, and others). Is that split right, and is a generic penguin acceptable for `tux`?
3. **Reusable cow scene, or a unique story per fortune?** Recommended order is reusable first (M2), unique only for ids the owner lists (M3). Is `murphy-38` the only unique story wanted for now?
4. **Who reviews, and on whose quota?** The assumption is the owner, with the same personal `gemini-3.1-flash-image` workflow as the test clip, before any file is committed or uploaded. Is anyone else allowed to approve a frame?
5. **Short fortunes only?** Recommended: scene files only when the body is ≤ 160 UTF-8 bytes and the caption fits at 64 px. Should any longer fortune be allowed if it still fits at 64 px?
6. **Daily fortune.** Recommended: opening a scene pins the served id and removes `daily=true`, so the clip's link does not change at 00:00 UTC. Is that the right call?
7. **Share button.** Recommended: the main Share button stays text and link; the dialog attaches the file. Should the main button attach the file too when a clip is ready?
8. **Open Graph.** Recommended: keep the 1200×1200 ASCII card, and preserve `scene=1` on the rewritten `og:url`. Should a vertical still ever become `og:image`?
9. **Typeface.** Recommended: JetBrains Mono, already vendored, sized at ≥ 64 px in the 1080-wide file. Is matching the test clip's IBM Plex Mono worth a new font?
10. **Caption floor.** Is 64 px at 1080×1920 (about 23 CSS px on a 390-wide phone) big enough, given the test clip was too small? 72–80 px is the preferred size when the line count allows.
11. **Sound.** Recommended: silent, no music bed, no voice. Confirm.
12. **Shake and Ken Burns.** Recommended: generic motion for every cow, and a shake only when that storyboard's manifest asks for one. The ASCII path does not shake.
13. **Asset host.** Recommended: GitHub Pages for M2's dozens of JPEGs; R2 only if M3's allow-list outgrows the repo. Is there an R2 bucket already intended for this, or should M3 wait until there is?
14. **Production routes.** `worker/wrangler.jsonc` lists `webfortune.app/*` and `www.webfortune.app/*`, while `docs/deployment.md` still says those routes are commented out. Which one matches production today? The answer changes whether `og:url` preservation is a Worker change or a no-op.
15. **Databases that stay text-only.** Please mark any that must never be illustrated. The spec suggests starting from `ethnic`, `drugs`, `men-women`, `cock`, the ASCII-art databases, and the large quotation databases, and illustrating nothing outside an explicit allow-list.

### Appendix: cow files shipped today

47 names from cowsay `3.03+dfsg2-8`, as `generate` emits them. The bucket is a proposal for question 2, not a legal opinion.

| Proposal | Cow files |
| --- | --- |
| Generic creature, one card each | `default` (cow; `cower` reuses it), `bud-frogs`, `bunny`, `dragon`, `duck`, `elephant` (`elephant-in-snake` reuses it only if the drawing stays an elephant), `fox`, `gnu`, `kangaroo`, `koala`, `moose`, `pony` (`pony-smaller` reuses it), `sheep`, `stegosaurus`, `turkey`, `turtle` |
| Hold until the owner decides | `apt`, `calvin`, `cheese`, `cock`, `daemon`, `dragon-and-cow`, `eyes`, `flaming-sheep`, `ghostbusters`, `hellokitty`, `kiss`, `kosh`, `luke-koala`, `mech-and-cow`, `milk`, `moofasa`, `ren`, `skeleton`, `snowman`, `stimpy`, `suse`, `three-eyes`, `tux`, `unipony`, `unipony-smaller`, `vader`, `vader-koala`, `www` |

The example `A = 16` in section 5 is the generic-creature row, counting shared files as one design.
