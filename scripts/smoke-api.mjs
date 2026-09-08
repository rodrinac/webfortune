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
await request("/?category=not_a_real_category_8675309", 404);
await request("/?category=../etc/passwd", 400);
await request("/?category=a&category=b", 400);
await request("/missing", 404);
await request("/", 405, "POST");
console.log(`API smoke checks passed: ${base}`);
