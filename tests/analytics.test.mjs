import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  CONSENT_KEY,
  applyAnalyticsChoice,
  clearAnalyticsCookies,
  eventParams,
  googleTagBootstrap,
  googleTagSnippet,
  installGoogleAnalytics,
  measurementId,
  readConsent,
  track,
  writeConsent,
} from "../web/analytics.js";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    dump: () => Object.fromEntries(values),
  };
}

function cookieJar(names) {
  let entries = names.map((name) => ({ name, value: "1" }));
  return {
    writes: [],
    get cookie() {
      return entries.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    },
    set cookie(value) {
      this.writes.push(value);
      const name = value.split("=")[0].trim();
      entries = entries.filter((entry) => entry.name !== name);
    },
  };
}

function browser(cookies = []) {
  const scripts = [];
  const jar = cookieJar(cookies);
  const view = {};
  const doc = {
    head: { appendChild: (node) => scripts.push(node) },
    createElement: () => ({}),
    get cookie() {
      return jar.cookie;
    },
    set cookie(value) {
      jar.cookie = value;
    },
  };
  return { env: { window: view, document: doc, storage: storage() }, scripts, jar, view };
}

test("accepts a GA4 measurement id and ignores an empty one", () => {
  assert.equal(measurementId(""), "");
  assert.equal(measurementId("  G-AB12CD34  "), "G-AB12CD34");
  for (const value of ["G-", "g-AB12", "UA-123", "G-ab12", "G-AB12 CD", "<script>"]) {
    assert.throws(() => measurementId(value), /G-XXXXXXXX/);
  }
});

test("stores only granted or denied consent", () => {
  const jar = storage();
  writeConsent("granted", jar);
  assert.equal(readConsent(jar), "granted");
  writeConsent("denied", jar);
  assert.equal(jar.dump()[CONSENT_KEY], "denied");
  assert.equal(readConsent(storage({ [CONSENT_KEY]: "maybe" })), "");
  assert.equal(readConsent({ getItem: () => { throw new Error("blocked"); } }), "");
  assert.throws(() => writeConsent("yes", jar), /granted or denied/);
});

test("drops fortune text and oversized values from event parameters", () => {
  assert.deepEqual(
    eventParams({
      locale: "pt",
      category: "everything",
      cow: "tux",
      fortune: "A secret fortune",
      text: "also secret",
      email: "a@b.c",
      reason: "button",
      blank: "",
      long: "x".repeat(101),
      "Bad-Key": "no",
      nested: { cow: "tux" },
    }),
    { locale: "pt", category: "everything", cow: "tux", reason: "button" },
  );
});

test("puts the Google tag in external scripts with storage denied until allow", () => {
  const snippet = googleTagSnippet("G-AB12CD34");
  assert.equal(
    snippet,
    `<script src="./gtag-bootstrap.js"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34"></script>`,
  );
  assert.equal(snippet.includes("function gtag"), false);
  const bootstrap = googleTagBootstrap("G-AB12CD34");
  assert.match(bootstrap, /function gtag\(\)\{dataLayer\.push\(arguments\);\}/);
  assert.match(bootstrap, /webfortune-analytics/);
  assert.match(bootstrap, /analytics_storage":"denied"/);
  assert.match(bootstrap, /analytics_storage":"granted"/);
  assert.equal(bootstrap.includes("?fortune"), false);
  assert.equal(googleTagSnippet(""), "");
  assert.equal(googleTagBootstrap(""), "");
  assert.throws(() => googleTagSnippet("UA-123"), /G-XXXXXXXX/);
  assert.throws(() => googleTagBootstrap("UA-123"), /G-XXXXXXXX/);
});

test("loads the Google tag on startup and only once", () => {
  const { env, scripts, view } = browser();
  assert.equal(installGoogleAnalytics("", env), false);
  assert.equal(scripts.length, 0);
  assert.equal(installGoogleAnalytics("G-AB12CD34", env), true);
  assert.equal(installGoogleAnalytics("G-AB12CD34", env), true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.equal(
    scripts[0].src,
    "https://www.googletagmanager.com/gtag/js?id=G-AB12CD34",
  );
  const commands = [...view.dataLayer].map((args) => args[0]);
  assert.deepEqual(commands, ["js", "consent", "config"]);
  assert.equal(view.dataLayer[1][2].analytics_storage, "denied");
  assert.equal(view.dataLayer[1][2].ad_storage, "denied");
  assert.equal(view.dataLayer[1][2].ad_user_data, "denied");
  assert.equal(view.dataLayer[1][2].ad_personalization, "denied");
  assert.equal(view.dataLayer[2][1], "G-AB12CD34");
});

test("does not add a second tag when the page already configured it", () => {
  const { env, scripts, view } = browser();
  view.dataLayer = [];
  view.gtag = function gtag() {
    view.dataLayer.push(arguments);
  };
  view.gtag("config", "G-AB12CD34", {});
  assert.equal(installGoogleAnalytics("G-AB12CD34", env), true);
  assert.equal(scripts.length, 0);
  applyAnalyticsChoice("granted", "G-AB12CD34", env);
  const update = [...view.dataLayer].find((args) => args[1] === "update");
  assert.equal(update[2].analytics_storage, "granted");
  assert.equal(scripts.length, 0);
});

test("keeps fortune ids out of the URL sent to Google", () => {
  const { env, view } = browser();
  env.document.location = {
    origin: "https://webfortune.app",
    pathname: "/",
    search: "?locale=pt&fortune=wisdom-1",
  };
  installGoogleAnalytics("G-AB12CD34", env);
  assert.equal(view.dataLayer[2][2].page_location, "https://webfortune.app/");
  writeConsent("granted", env.storage);
  track("fortune_shown", { locale: "pt", fortune: "The secret line." }, env);
  const event = [...view.dataLayer].find((args) => args[0] === "event");
  assert.equal(event[2].page_location, "https://webfortune.app/");
  assert.equal(event[2].locale, "pt");
  assert.equal(event[2].fortune, undefined);
});

test("sends events only after analytics consent", () => {
  const { env, view } = browser();
  assert.equal(track("fortune_shown", { locale: "en" }, env), false);
  writeConsent("denied", env.storage);
  view.gtag = () => {};
  assert.equal(track("fortune_shown", { locale: "en" }, env), false);
  writeConsent("granted", env.storage);
  const seen = [];
  view.gtag = (kind, name, params) => seen.push([kind, name, params]);
  assert.equal(
    track("fortune_shown", { locale: "en", fortune: "secret words" }, env),
    true,
  );
  assert.deepEqual(seen, [
    ["event", "fortune_shown", { locale: "en" }],
  ]);
  assert.equal(track("Fortune Shown", {}, env), false);
});

test("withdrawing consent updates Google and clears analytics cookies", () => {
  const { env, view, jar } = browser(["_ga", "_ga_AB12", "theme"]);
  applyAnalyticsChoice("granted", "G-AB12CD34", env);
  applyAnalyticsChoice("denied", "G-AB12CD34", env);
  assert.equal(readConsent(env.storage), "denied");
  const update = [...view.dataLayer].find((args) => args[1] === "update");
  assert.equal(update[2].analytics_storage, "denied");
  assert.deepEqual(jar.writes.map((value) => value.split("=")[0]), ["_ga", "_ga_AB12"]);
  assert.equal(jar.cookie, "theme=1");
  applyAnalyticsChoice("granted", "G-AB12CD34", env);
  const restored = [...view.dataLayer].filter((args) => args[1] === "update").at(-1);
  assert.equal(restored[2].analytics_storage, "granted");
  assert.equal(restored[2].ad_storage, "denied");
});

test("clears only Google Analytics cookies", () => {
  const jar = cookieJar(["_ga", "session", "_ga_XYZ"]);
  clearAnalyticsCookies(jar);
  assert.equal(jar.cookie, "session=1");
});

test("production config accepts a missing or valid measurement id", () => {
  const run = (id) =>
    spawnSync(process.execPath, ["scripts/check-config.mjs"], {
      env: {
        ...process.env,
        VITE_API_URL: "https://api.webfortune.app",
        VITE_GA_MEASUREMENT_ID: id,
      },
      encoding: "utf8",
    });
  assert.equal(run("").status, 0);
  assert.equal(run("G-AB12CD34").status, 0);
  const invalid = run("UA-123456");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /G-XXXXXXXX/);
});
