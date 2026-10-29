import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedParam,
  isResourceName,
  settingsQuery,
} from "../web/settings-url.js";

const locales = ["en", "de", "es", "pt"];
const cows = ["default", "tux"];
const categories = ["love", "wisdom", "off.offensive"];

test("accepts the same resource names the API allows", () => {
  for (const name of [
    "pt",
    "tux",
    "love",
    "off.offensive",
    "a_b",
    "a-b",
    "Cows2",
    ".",
    "..",
  ])
    assert.equal(isResourceName(name), true);
  for (const name of [
    "",
    "../etc/passwd",
    "a/b",
    "a b",
    "<img src=x onerror=alert(1)>",
    "pt\u0000",
    "love<script>",
    "tux\n",
    null,
    undefined,
    12,
  ])
    assert.equal(isResourceName(name), false);
});

test("reads a single allowed param and ignores everything else", () => {
  const search = "?locale=pt&cow=tux&category=love";
  assert.equal(allowedParam(search, "locale", locales), "pt");
  assert.equal(allowedParam(search, "cow", cows), "tux");
  assert.equal(allowedParam(search, "category", categories), "love");
  assert.equal(allowedParam("", "locale", locales), undefined);
  assert.equal(allowedParam("?cow=default", "cow", cows), "default");
});

test("rejects unknown, malformed, duplicate, and HTML-like params", () => {
  assert.equal(allowedParam("?locale=fr", "locale", locales), undefined);
  assert.equal(allowedParam("?locale=PT", "locale", locales), undefined);
  assert.equal(allowedParam("?locale=", "locale", locales), undefined);
  assert.equal(allowedParam("?locale", "locale", locales), undefined);
  assert.equal(
    allowedParam("?locale=pt&locale=en", "locale", locales),
    undefined,
  );
  assert.equal(
    allowedParam("?locale=pt&locale=pt", "locale", locales),
    undefined,
  );
  assert.equal(allowedParam("?cow=moose", "cow", cows), undefined);
  assert.equal(allowedParam("?category=../etc", "category", categories), undefined);
  assert.equal(allowedParam("?category=..", "category", categories), undefined);
  assert.equal(
    allowedParam("?category=a%2Fb", "category", ["a/b", "love"]),
    undefined,
  );
  assert.equal(
    allowedParam("?cow=%3Cimg%20src%3Dx%3E", "cow", ["<img src=x>", "tux"]),
    undefined,
  );
  assert.equal(allowedParam("?cow=<img>", "cow", ["<img>", "tux"]), undefined);
  assert.equal(allowedParam("?category=love%00", "category", categories), undefined);
  // A sibling param stays readable when another one is malformed.
  assert.equal(
    allowedParam("?locale=zz&cow=tux&category=nope", "cow", cows),
    "tux",
  );
});

test("writes only non-default settings and keeps the plain URL clean", () => {
  assert.equal(
    settingsQuery({
      locale: "pt",
      cow: "tux",
      category: "love",
      defaultLocale: "en",
    }),
    "?locale=pt&cow=tux&category=love",
  );
  assert.equal(
    settingsQuery({
      locale: "en",
      cow: "default",
      category: "",
      defaultLocale: "en",
    }),
    "",
  );
  assert.equal(
    settingsQuery({
      locale: "pt",
      cow: "default",
      category: "love",
      defaultLocale: "pt",
    }),
    "?category=love",
  );
  assert.equal(
    settingsQuery({
      locale: "en",
      cow: "tux",
      category: "",
      defaultLocale: "de",
    }),
    "?locale=en&cow=tux",
  );
});

test("never places an unsafe value into the query string", () => {
  const query = settingsQuery({
    locale: "pt",
    cow: "../tux",
    category: "love<script>",
    defaultLocale: "en",
  });
  assert.equal(query, "?locale=pt");
  assert.equal(query.includes("<"), false);
  assert.equal(query.includes("/"), false);
  assert.equal(
    settingsQuery({
      locale: "<pt>",
      cow: "tux",
      category: "love",
      defaultLocale: "en",
    }),
    "?cow=tux&category=love",
  );
});
