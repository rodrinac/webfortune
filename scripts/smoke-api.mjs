import assert from "node:assert/strict";
const base = (process.env.API_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const origin = process.env.CORS_ORIGIN;

function assertPng(bytes, label) {
  assert.equal(
    Buffer.from(bytes.subarray(0, 8)).toString("hex"),
    "89504e470d0a1a0a",
    `${label} signature`,
  );
  assert.equal(bytes.readUInt32BE(16), 1200, `${label} width`);
  assert.equal(bytes.readUInt32BE(20), 1200, `${label} height`);
  assert.ok(bytes.length < 300 * 1024, `${label} is ${bytes.length} bytes`);
  assert.ok(bytes.length > 1024, `${label} is unexpectedly small`);
}

async function png(path) {
  const response = await request(path);
  assert.match(
    response.headers.get("content-type") || "",
    /^image\/png\b/,
    path,
  );
  assert.match(response.headers.get("cache-control") || "", /max-age=/, path);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertPng(bytes, path);
  const advertised = response.headers.get("content-length");
  if (advertised !== null) assert.equal(Number(advertised), bytes.length, path);
  return bytes.length;
}

// RFC 9110 makes Content-Length optional on HEAD. The Cloudflare edge omits
// it for Node fetch over some protocols even when curl -I shows it. When the
// header is present on a deterministic route, it must match the GET length.
function assertContentLengthIfPresent(response, expected, label) {
  const advertised = response.headers.get("content-length");
  if (advertised === null) return;
  assert.match(advertised, /^(?:0|[1-9]\d*)$/, `${label} content-length`);
  if (expected === null || expected === undefined) {
    assert.ok(Number(advertised) > 0, `${label} content-length`);
    return;
  }
  assert.equal(advertised, String(expected), `${label} content-length`);
}

function assertFortuneId(id, label) {
  assert.equal(typeof id, "string", `${label} x-fortune-id`);
  const split = id.lastIndexOf("-");
  assert.ok(split > 0, `${label} id separator`);
  const database = id.slice(0, split);
  const index = id.slice(split + 1);
  assert.match(database, /^[A-Za-z0-9_.-]+$/, `${label} database`);
  assert.match(index, /^(?:0|[1-9][0-9]*)$/, `${label} index`);
  assert.ok(Number(index) <= 4294967295, `${label} index range`);
  return database;
}

// worker/wrangler.jsonc allows 50 requests per 10 seconds per IP on the shared
// limiter. /og.png cache misses also spend a tighter 5 / 10 s OG budget; hits
// do not. CI curls /health once before this script. The manual deploy workflow
// curls it twice in that window. The tag workflow adds one fetch when /health
// reports the release version. Those callers add at most two probes. Stay under
// the remainder so those probes cannot turn a later check into a 429.
const SMOKE_REQUEST_BUDGET = 46;
let requests = 0;

async function request(path, status = 200, method = "GET", headers = {}) {
  requests += 1;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...headers },
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  if (origin)
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      origin,
      `CORS on ${path}`,
    );
  if (method === "HEAD") {
    const body = await response.arrayBuffer();
    assert.equal(body.byteLength, 0, `${method} ${path} has a body`);
  }
  return response;
}
const health = await request("/health");
assert.equal((await health.json()).status, "ok");
const healthType = health.headers.get("content-type");
const healthLength = health.headers.get("content-length");
const healthCache = health.headers.get("cache-control");
const locales = await (await request("/locales")).json();
assert.deepEqual(
  locales.map(({ id }) => id),
  ["en", "de", "es", "pt"],
);
assert.equal(locales.find(({ id }) => id === "es")?.name, "Español");
assert.equal(locales.find(({ id }) => id === "pt")?.name, "Português");
const categories = await (await request("/categories")).json();
assert.ok(Array.isArray(categories) && categories.length > 0);
const cows = await (await request("/cows")).json();
assert.ok(Array.isArray(cows) && cows.includes("default"));
assert.match(await (await request("/cows/default")).text(), /\(oo\)/);
const tuxArt = await (await request("/cows/tux")).text();
assert.ok(tuxArt.trim(), "tux artwork is empty");
const randomResponse = await request("/");
assert.match(
  randomResponse.headers.get("content-type") || "",
  /^text\/plain\b/,
  "default fortune content-type",
);
const randomId = randomResponse.headers.get("x-fortune-id");
const randomDatabase = assertFortuneId(randomId, "random");
const randomRaw = await randomResponse.text();
const randomText = randomRaw.trim();
assert.ok(randomText, "random fortune is empty");
if (origin) {
  assert.match(
    randomResponse.headers.get("access-control-expose-headers") || "",
    /\bx-fortune-id\b/i,
    "CORS exposes x-fortune-id",
  );
}
const pinnedResponse = await request(
  `/?fortune=${encodeURIComponent(randomId)}`,
);
assert.equal(pinnedResponse.headers.get("x-fortune-id"), randomId);
assert.equal((await pinnedResponse.text()).trim(), randomText);

const category = categories[0];
const categorizedResponse = await request(
  `/?category=${encodeURIComponent(category)}`,
);
const categoryId = categorizedResponse.headers.get("x-fortune-id");
assertFortuneId(categoryId, "category");
assert.equal(categoryId.slice(0, category.length + 1), `${category}-`);
const categorizedRaw = await categorizedResponse.text();
const categorizedText = categorizedRaw.trim();
assert.ok(categorizedText, "category fortune is empty");
const categorizedPinned = await request(
  `/?category=${encodeURIComponent(category)}&fortune=${encodeURIComponent(categoryId)}`,
);
assert.equal((await categorizedPinned.text()).trim(), categorizedText);
assert.match(
  categorizedPinned.headers.get("content-type") || "",
  /^text\/plain\b/,
  "pinned fortune content-type",
);
const jsonResponse = await request(
  `/?format=json&locale=en&category=${encodeURIComponent(category)}&fortune=${encodeURIComponent(categoryId)}`,
);
assert.match(
  jsonResponse.headers.get("content-type") || "",
  /^application\/json\b/,
  "json fortune content-type",
);
assert.equal(jsonResponse.headers.get("x-fortune-id"), categoryId);
const jsonFortune = await jsonResponse.json();
assert.equal(jsonFortune.id, categoryId);
assert.equal(jsonFortune.fortune, categorizedRaw);
assert.equal(jsonFortune.locale, "en");
assert.equal(jsonFortune.category, category);
assert.deepEqual(Object.keys(jsonFortune), [
  "id",
  "fortune",
  "locale",
  "category",
]);
const cowsayResponse = await request(
  `/?format=cowsay&cow=tux&locale=en&category=${encodeURIComponent(category)}&fortune=${encodeURIComponent(categoryId)}`,
);
assert.equal(
  cowsayResponse.headers.get("content-type"),
  "text/plain; charset=utf-8",
  "cowsay content-type",
);
assert.match(
  cowsayResponse.headers.get("cache-control") || "",
  /no-store/,
  "cowsay cache-control",
);
assert.equal(cowsayResponse.headers.get("x-fortune-id"), categoryId);
const cowsayBody = await cowsayResponse.text();
assert.ok(cowsayBody.endsWith("\n"), "cowsay ends with a newline");
const tux = tuxArt.endsWith("\n") ? tuxArt.slice(0, -1) : tuxArt;
assert.ok(
  cowsayBody.endsWith(`${tux}\n`),
  "cowsay ends with the tux artwork",
);
assert.match(cowsayBody.split("\n")[0], /^ _+$/, "cowsay top border");
assert.match(
  cowsayBody,
  /^(?:< .+ >|\/ .+ \\)$/m,
  "cowsay speech border",
);
// Same cleanup and wrap as web/cowsay.js: controls drop, tabs become spaces,
// and a word longer than the width is split. Each piece stays in order.
const bubble = cowsayBody.slice(0, cowsayBody.length - (tux.length + 1));
const normalized = categorizedText
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  .replace(/\t/g, "    ")
  .trim();
let cursor = 0;
for (const word of normalized.split(/\s+/)) {
  let rest = word;
  while (rest) {
    const chars = Array.from(rest);
    const chunk = chars.slice(0, 44).join("");
    const at = bubble.indexOf(chunk, cursor);
    assert.ok(at !== -1, `cowsay missing ${JSON.stringify(chunk)}`);
    cursor = at + chunk.length;
    rest = chars.slice(44).join("");
  }
}

await request("/?fortune=not-a-fortune", 400);
// A second invalid id and a duplicate category stay covered by the worker
// unit tests. Those smoke requests were traded for the cowsay check so this
// script stays inside the 46-request rate-limit budget.
await request("/?fortune=not_a_real_database_8675309-0", 404);
await request(`/?fortune=${encodeURIComponent(randomDatabase)}-4000000000`, 404);
for (const locale of ["de", "es"]) {
  let localizedFortunes = "";
  // The installed package decides which categories are enabled, so exercise
  // the locale itself several times instead of relying on an optional file.
  // Eight draws still sees a non-ASCII fortune in de and es (most of those
  // fortunes contain one) without spending the rate-limit budget.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await request(`/?locale=${locale}`);
    assert.match(response.headers.get("content-type") || "", /charset=utf-8/i);
    const localizedFortune = await response.text();
    assert.ok(localizedFortune.trim(), `${locale} fortune is empty`);
    assert.doesNotMatch(localizedFortune, /\uFFFD/, `${locale} is not valid UTF-8`);
    localizedFortunes += localizedFortune;
  }
  assert.match(localizedFortunes, /[^\x00-\x7F]/, `${locale} accents are missing`);
}
const portuguese = await request("/?locale=pt");
const portugueseId = portuguese.headers.get("x-fortune-id");
assertFortuneId(portugueseId, "portuguese");
const portugueseFortune = await portuguese.text();
assert.ok(portugueseFortune.trim(), "pt fortune is empty");
assert.doesNotMatch(portugueseFortune, /\uFFFD/, "pt is not valid UTF-8");
await request("/?category=not_a_real_category_8675309", 404);
await request("/?category=../etc/passwd", 400);
await request("/missing", 404);
const rejected = await request("/", 405, "POST");
assert.match(rejected.headers.get("allow") || "", /\bGET\b/);
assert.match(rejected.headers.get("allow") || "", /\bHEAD\b/);
assert.equal(await rejected.text(), "Method not allowed.\n");
const branded = await request("/og.png");
assert.match(branded.headers.get("content-type") || "", /^image\/png\b/);
assert.match(branded.headers.get("cache-control") || "", /max-age=/);
const brandedBytes = Buffer.from(await branded.arrayBuffer());
assertPng(brandedBytes, "/og.png");
const brandedLength = brandedBytes.length;
const brandedCache = branded.headers.get("x-og-cache");
if (brandedCache !== null) {
  assert.match(brandedCache, /^(?:hit|miss)$/, "/og.png x-og-cache");
}
await png(`/og.png?fortune=${encodeURIComponent(randomId)}`);
await png(
  `/og.png?locale=pt&fortune=${encodeURIComponent(portugueseId)}`,
);
await request("/og.png?fortune=not-a-fortune", 400);
await request("/og.png?cow=../etc", 400);
await request("/og.png?cow=not-a-real-cow", 404);
const headHealth = await request("/health", 200, "HEAD");
assert.equal(headHealth.headers.get("content-type"), healthType);
assert.match(headHealth.headers.get("content-type") || "", /application\/json/);
if (healthCache !== null) {
  assert.equal(headHealth.headers.get("cache-control"), healthCache);
}
assertContentLengthIfPresent(headHealth, healthLength, "HEAD /health");
const headFortune = await request("/", 200, "HEAD");
assert.match(headFortune.headers.get("content-type") || "", /text\/plain/);
assert.match(headFortune.headers.get("cache-control") || "", /no-store/);
assertFortuneId(headFortune.headers.get("x-fortune-id"), "HEAD /");
if (origin) {
  assert.match(
    headFortune.headers.get("access-control-expose-headers") || "",
    /\bx-fortune-id\b/i,
    "HEAD CORS exposes x-fortune-id",
  );
}
assertContentLengthIfPresent(headFortune, null, "HEAD /");
// Reordered defaults resolve to the same cache key as /og.png. When the Worker
// reports hit/miss, HEAD and Range must be hits so card::render_* is skipped.
const headImage = await request("/og.png?cow=default&locale=en", 200, "HEAD");
assert.match(headImage.headers.get("content-type") || "", /^image\/png\b/);
assert.match(headImage.headers.get("cache-control") || "", /max-age=/);
assertContentLengthIfPresent(headImage, brandedLength, "HEAD /og.png");
if (brandedCache !== null) {
  assert.equal(headImage.headers.get("x-og-cache"), "hit", "HEAD /og.png cache");
}
const ranged = await request("/og.png?locale=en&cow=default", 200, "GET", {
  Range: "bytes=0-524287",
});
assert.equal(ranged.headers.get("content-range"), null);
const rangedBytes = Buffer.from(await ranged.arrayBuffer());
assertPng(rangedBytes, "Range /og.png");
assert.equal(rangedBytes.length, brandedLength);
if (brandedCache !== null) {
  assert.equal(ranged.headers.get("x-og-cache"), "hit", "Range /og.png cache");
}
assert.ok(
  requests <= SMOKE_REQUEST_BUDGET,
  `smoke sent ${requests} requests; budget is ${SMOKE_REQUEST_BUDGET} so health probes fit in the 50/10s limit`,
);
console.log(`API smoke checks passed: ${base}`);
