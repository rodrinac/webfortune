import assert from "node:assert/strict";
const base = (process.env.API_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const origin = process.env.CORS_ORIGIN;
async function request(path, status = 200, method = "GET") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: origin ? { Origin: origin } : {},
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  if (origin)
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      origin,
      `CORS on ${path}`,
    );
  return response;
}
assert.equal((await (await request("/health")).json()).status, "ok");
const locales = await (await request("/locales")).json();
assert.deepEqual(
  locales.map(({ id }) => id),
  ["en", "de", "es", "pt"],
);
assert.equal(locales.find(({ id }) => id === "es")?.name, "Español");
assert.equal(locales.find(({ id }) => id === "pt")?.name, "Português");
const categories = await (await request("/categories")).json();
assert.ok(Array.isArray(categories) && categories.length > 0);
assert.ok((await (await request("/")).text()).trim());
assert.ok(
  (
    await (
      await request(`/?category=${encodeURIComponent(categories[0])}`)
    ).text()
  ).trim(),
);
for (const locale of ["de", "es"]) {
  let localizedFortunes = "";
  // The installed package decides which categories are enabled, so exercise
  // the locale itself several times instead of relying on an optional file.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await request(`/?locale=${locale}`);
    assert.match(response.headers.get("content-type") || "", /charset=utf-8/i);
    const localizedFortune = await response.text();
    assert.ok(localizedFortune.trim(), `${locale} fortune is empty`);
    assert.doesNotMatch(localizedFortune, /\uFFFD/, `${locale} is not valid UTF-8`);
    localizedFortunes += localizedFortune;
  }
  assert.match(localizedFortunes, /[^\x00-\x7F]/, `${locale} accents are missing`);
}
const portugueseFortune = await (await request("/?locale=pt")).text();
assert.ok(portugueseFortune.trim(), "pt fortune is empty");
assert.doesNotMatch(portugueseFortune, /\uFFFD/, "pt is not valid UTF-8");
await request("/?category=not_a_real_category_8675309", 404);
await request("/?category=../etc/passwd", 400);
await request("/?category=a&category=b", 400);
await request("/missing", 404);
await request("/", 405, "POST");
console.log(`API smoke checks passed: ${base}`);
