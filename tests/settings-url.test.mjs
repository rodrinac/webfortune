import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedParam,
  fortuneParam,
  isFortuneId,
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

test("reads one canonical fortune id and rejects the rest", () => {
  assert.equal(isFortuneId("art-0"), true);
  assert.equal(isFortuneId("off-color-12"), true);
  assert.equal(isFortuneId("off.offensive-2"), true);
  assert.equal(isFortuneId("a_b-3"), true);
  assert.equal(isFortuneId("art-4294967295"), true);
  for (const id of [
    "",
    "art",
    "art-",
    "-0",
    "art-01",
    "art-00",
    "art-4294967296",
    "art-999999999999",
    "../art-1",
    "art-1/2",
    "love<script>-1",
    "art-1\n",
    null,
    undefined,
    12,
  ])
    assert.equal(isFortuneId(id), false, String(id));

  assert.equal(fortuneParam("?fortune=off-color-12"), "off-color-12");
  assert.equal(
    fortuneParam("?locale=pt&cow=tux&category=love&fortune=love-4"),
    "love-4",
  );
  assert.equal(fortuneParam(""), undefined);
  assert.equal(fortuneParam("?fortune="), undefined);
  assert.equal(fortuneParam("?fortune=love-01"), undefined);
  assert.equal(fortuneParam("?fortune=love-4&fortune=love-5"), undefined);
  assert.equal(fortuneParam("?fortune=../etc-1"), undefined);
  assert.equal(
    fortuneParam("?fortune=nope&locale=pt&cow=tux"),
    undefined,
  );
  assert.equal(allowedParam("?fortune=nope&cow=tux", "cow", cows), "tux");
});

test("serializes the fortune id after the other settings", () => {
  assert.equal(
    settingsQuery({
      locale: "pt",
      cow: "tux",
      category: "love",
      fortune: "love-4",
      defaultLocale: "en",
    }),
    "?locale=pt&cow=tux&category=love&fortune=love-4",
  );
  assert.equal(
    settingsQuery({
      locale: "en",
      cow: "default",
      category: "",
      fortune: "general-0",
      defaultLocale: "en",
    }),
    "?fortune=general-0",
  );
  assert.equal(
    settingsQuery({
      locale: "pt",
      cow: "tux",
      category: "love",
      fortune: "love-01",
      defaultLocale: "en",
    }),
    "?locale=pt&cow=tux&category=love",
  );
  assert.equal(
    settingsQuery({
      locale: "en",
      cow: "default",
      category: "",
      fortune: "../etc-1",
      defaultLocale: "en",
    }),
    "",
  );
  assert.equal(
    settingsQuery({
      locale: "pt",
      cow: "default",
      category: "off-color",
      fortune: "off-color-1",
      defaultLocale: "pt",
    }),
    "?category=off-color&fortune=off-color-1",
  );
});
