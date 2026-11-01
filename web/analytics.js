export const CONSENT_KEY = "webfortune-analytics";

const ID_PATTERN = /^G-[A-Z0-9]+$/;
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const BLOCKED_PARAMS = new Set([
  "fortune",
  "fortune_id",
  "text",
  "ip",
  "email",
  "client_id",
]);

const deniedConsent = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "denied",
  personalization_storage: "denied",
  security_storage: "granted",
};

const grantedConsent = {
  ...deniedConsent,
  analytics_storage: "granted",
};

function browserEnv() {
  return { window, document, storage: localStorage };
}

export function measurementId(
  value = import.meta.env?.VITE_GA_MEASUREMENT_ID,
) {
  const id = String(value ?? "").trim();
  if (!id) return "";
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      "VITE_GA_MEASUREMENT_ID must look like G-XXXXXXXX when it is set.",
    );
  }
  return id;
}

export function readConsent(storage) {
  try {
    const value = storage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "";
  } catch {
    return "";
  }
}

export function writeConsent(choice, storage) {
  if (choice !== "granted" && choice !== "denied") {
    throw new Error("Analytics consent must be granted or denied.");
  }
  storage.setItem(CONSENT_KEY, choice);
}

export function eventParams(params) {
  const clean = {};
  if (!params || typeof params !== "object") return clean;
  for (const [key, value] of Object.entries(params)) {
    if (BLOCKED_PARAMS.has(key) || !NAME_PATTERN.test(key)) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value);
    if (!text || text.length > 100) continue;
    clean[key] = text;
  }
  return clean;
}

function alreadyConfigured(view, measurement) {
  return (view.dataLayer || []).some(
    (args) => args && args[0] === "config" && args[1] === measurement,
  );
}

// External classic script for the document head. It runs before gtag.js, so
// consent is queued before the tag request. Storage stays denied until the
// visitor allows it. Keeping this out of an inline script lets script-src
// omit 'unsafe-inline'.
export function googleTagBootstrap(id) {
  const measurement = measurementId(id);
  if (!measurement) return "";
  return `window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag("js",new Date());
var webfortuneAnalytics="";
try{webfortuneAnalytics=localStorage.getItem(${JSON.stringify(CONSENT_KEY)})||"";}catch(e){}
gtag("consent","default",webfortuneAnalytics==="granted"?${JSON.stringify(grantedConsent)}:${JSON.stringify(deniedConsent)});
gtag("config",${JSON.stringify(measurement)},{page_location:location.origin+location.pathname});
`;
}

export function googleTagSnippet(id) {
  const measurement = measurementId(id);
  if (!measurement) return "";
  return `<script src="./gtag-bootstrap.js"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurement}"></script>`;
}

export function installGoogleAnalytics(id, env = browserEnv(), consent = "denied") {
  const measurement = measurementId(id);
  if (!measurement) return false;
  const view = env.window;
  const doc = env.document;
  if (view.__webfortuneGa === measurement || alreadyConfigured(view, measurement)) {
    view.__webfortuneGa = measurement;
    return true;
  }
  view.dataLayer = view.dataLayer || [];
  if (typeof view.gtag !== "function") {
    view.gtag = function gtag() {
      view.dataLayer.push(arguments);
    };
  }
  view.gtag("js", new Date());
  view.gtag("consent", "default", consent === "granted" ? grantedConsent : deniedConsent);
  // The address bar carries the fortune id. Keep that id out of Google.
  const loc = doc.location;
  const config = {};
  if (loc?.origin && loc.pathname) config.page_location = `${loc.origin}${loc.pathname}`;
  view.gtag("config", measurement, config);
  const script = doc.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurement)}`;
  doc.head.appendChild(script);
  view.__webfortuneGa = measurement;
  return true;
}

export function applyAnalyticsChoice(choice, id, env = browserEnv()) {
  writeConsent(choice, env.storage);
  if (choice === "granted") {
    const measurement = measurementId(id);
    const loaded =
      env.window.__webfortuneGa === measurement ||
      alreadyConfigured(env.window, measurement);
    installGoogleAnalytics(id, env, "granted");
    if (loaded) env.window.gtag("consent", "update", grantedConsent);
    return;
  }
  if (typeof env.window.gtag === "function") {
    env.window.gtag("consent", "update", deniedConsent);
  }
  clearAnalyticsCookies(env.document);
}

export function clearAnalyticsCookies(doc) {
  const current = String(doc.cookie || "");
  for (const part of current.split(";")) {
    const name = part.split("=")[0].trim();
    if (name === "_ga" || name.startsWith("_ga_")) {
      doc.cookie = `${name}=; Max-Age=0; path=/`;
    }
  }
}

export function track(name, params, env = browserEnv()) {
  if (!NAME_PATTERN.test(name)) return false;
  if (readConsent(env.storage) !== "granted") return false;
  if (typeof env.window.gtag !== "function") return false;
  const payload = eventParams(params);
  const loc = env.document.location;
  if (loc?.origin && loc.pathname) payload.page_location = `${loc.origin}${loc.pathname}`;
  env.window.gtag("event", name, payload);
  return true;
}
