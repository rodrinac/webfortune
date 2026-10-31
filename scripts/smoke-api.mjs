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
  assert.equal(bytes.readUInt32BE(20), 630, `${label} height`);
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

// worker/wrangler.jsonc allows 50 requests per 10 seconds per IP. CI curls
// /health once before this script, and the deploy workflows curl it twice,
// all inside that window. Stay under the remainder so those probes cannot
// turn a later check into a 429.
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
const randomResponse = await request("/");
const randomId = randomResponse.headers.get("x-fortune-id");
const randomDatabase = assertFortuneId(randomId, "random");
const randomText = (await randomResponse.text()).trim();
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
const categorizedText = (await categorizedResponse.text()).trim();
assert.ok(categorizedText, "category fortune is empty");
const categorizedPinned = await request(
  `/?category=${encodeURIComponent(category)}&fortune=${encodeURIComponent(categoryId)}`,
);
assert.equal((await categorizedPinned.text()).trim(), categorizedText);

await request("/?fortune=not-a-fortune", 400);
await request("/?fortune=../etc-1", 400);
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
await request("/?category=a&category=b", 400);
await request("/missing", 404);
const rejected = await request("/", 405, "POST");
assert.match(rejected.headers.get("allow") || "", /\bGET\b/);
assert.match(rejected.headers.get("allow") || "", /\bHEAD\b/);
assert.equal(await rejected.text(), "Method not allowed.\n");
const brandedLength = await png("/og.png");
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
if (healthLength !== null) {
  assert.equal(headHealth.headers.get("content-length"), healthLength);
}
const headFortune = await request("/", 200, "HEAD");
assert.match(headFortune.headers.get("content-type") || "", /text\/plain/);
assert.match(headFortune.headers.get("cache-control") || "", /no-store/);
assertFortuneId(headFortune.headers.get("x-fortune-id"), "HEAD /");
const headLength = headFortune.headers.get("content-length");
assert.ok(headLength !== null && Number(headLength) > 0, "HEAD / content-length");
const headImage = await request("/og.png", 200, "HEAD");
assert.match(headImage.headers.get("content-type") || "", /^image\/png\b/);
assert.match(headImage.headers.get("cache-control") || "", /max-age=/);
assert.equal(headImage.headers.get("content-length"), String(brandedLength));
const ranged = await request("/og.png", 200, "GET", { Range: "bytes=0-524287" });
assert.equal(ranged.headers.get("content-range"), null);
const rangedBytes = Buffer.from(await ranged.arrayBuffer());
assertPng(rangedBytes, "Range /og.png");
assert.equal(rangedBytes.length, brandedLength);
assert.ok(
  requests <= SMOKE_REQUEST_BUDGET,
  `smoke sent ${requests} requests; budget is ${SMOKE_REQUEST_BUDGET} so health probes fit in the 50/10s limit`,
);
console.log(`API smoke checks passed: ${base}`);
