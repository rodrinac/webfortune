import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const IMAGE = "https://webfortune.app/og.png";

function metaContent(html, attribute, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const tag = tags.find((candidate) =>
    new RegExp(`\\b${attribute}=(["'])${name}\\1`).test(candidate),
  );
  assert.ok(tag, `missing ${attribute}=${name}`);
  const content = tag.match(/\bcontent=(["'])([\s\S]*?)\1/);
  assert.ok(content, tag);
  return content[2];
}

test("the production build ships an absolute 1200x630 Open Graph image", () => {
  const outDir = join(root, "build/og-preview-dist");
  execFileSync(
    "npx",
    ["vite", "build", "--outDir", join("..", "build/og-preview-dist"), "--emptyOutDir"],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_API_URL: "https://api.webfortune.app",
      },
      stdio: "pipe",
    },
  );

  const html = readFileSync(join(outDir, "index.html"), "utf8");
  assert.equal(metaContent(html, "property", "og:image"), IMAGE);
  assert.equal(metaContent(html, "property", "og:image:secure_url"), IMAGE);
  assert.equal(metaContent(html, "property", "og:image:type"), "image/png");
  assert.equal(metaContent(html, "property", "og:image:width"), "1200");
  assert.equal(metaContent(html, "property", "og:image:height"), "630");
  assert.match(metaContent(html, "property", "og:image:alt"), /webfortune/);
  assert.equal(metaContent(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(metaContent(html, "name", "twitter:image"), IMAGE);
  assert.match(metaContent(html, "name", "twitter:image:alt"), /ASCII cow|webfortune/);
  assert.equal(
    (html.match(/property=(["'])og:image\1/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(html, /property=(["'])og:image\1\s+content=(["'])(?!https:\/\/)/);

  const image = readFileSync(join(outDir, "og.png"));
  const source = readFileSync(join(root, "web/public/og.png"));
  assert.deepEqual(image, source);
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.ok(image.length < 300 * 1024, `og.png is ${image.length} bytes`);
  assert.ok(image.length > 5 * 1024, "og.png is unexpectedly small");
});
