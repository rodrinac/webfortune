// Shareable page settings. Locale, cow, category, and length are accepted only
// when they match the API's resource-name rule and an allow-list the caller
// already loaded. Length is only `short` or `long`. Daily is only the exact
// value `true`. A fortune id uses that same rule and a `<database>-<index>`
// shape. Nothing returned here is safe to treat as HTML; callers must keep
// using text APIs.

const RESOURCE_NAME = /^[a-zA-Z0-9_.-]+$/;

export function isResourceName(value) {
  return typeof value === "string" && RESOURCE_NAME.test(value);
}

function searchParams(search) {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query);
}

// One decoded value, or undefined when the param is missing, repeated,
// empty, or not an allowed resource name. Repeats are rejected the same way
// the API rejects a duplicated locale or category.
export function allowedParam(search, name, allowed) {
  const values = searchParams(search).getAll(name);
  if (values.length !== 1) return undefined;
  const value = values[0];
  if (!isResourceName(value)) return undefined;
  return allowed.includes(value) ? value : undefined;
}

// `<database>-<index>`, split on the last hyphen so database names may contain
// hyphens. The index is a canonical decimal that fits in u32. Both parts use
// the resource-name rule, which also makes the whole id URL-safe.
const MAX_FORTUNE_INDEX = 4294967295;

export function isFortuneId(value) {
  if (!isResourceName(value)) return false;
  const split = value.lastIndexOf("-");
  if (split <= 0) return false;
  const database = value.slice(0, split);
  const index = value.slice(split + 1);
  if (!isResourceName(database) || !/^(?:0|[1-9]\d{0,9})$/.test(index))
    return false;
  return Number(index) <= MAX_FORTUNE_INDEX;
}

export function fortuneParam(search) {
  const values = searchParams(search).getAll("fortune");
  if (values.length !== 1) return undefined;
  return isFortuneId(values[0]) ? values[0] : undefined;
}

// The API accepts only `daily=true`. Anything else, including a repeat, is
// ignored so a bad link still opens as a normal fortune.
export function dailyParam(search) {
  const values = searchParams(search).getAll("daily");
  return values.length === 1 && values[0] === "true";
}

// Settings the page can restore from a history entry or the initial URL.
// Each value is allow-listed the same way as the first load. Nothing here is
// safe to treat as HTML; callers must keep using text APIs and select values.
export function readPageSettings(
  search,
  { locales, cows, categories, defaultLocale, defaultCow = "default" },
) {
  const locale = allowedParam(search, "locale", locales) || defaultLocale;
  const cow = allowedParam(search, "cow", cows) || defaultCow;
  const category = allowedParam(search, "category", categories) || "";
  const length = allowedParam(search, "length", ["short", "long"]) || "";
  const daily = dailyParam(search);
  const fortune = daily ? "" : fortuneParam(search) || "";
  return { locale, cow, category, length, daily, fortune };
}

// Query string for the settings that differ from the defaults. Param order
// matches the share link: locale, cow, category, length, daily, then the exact
// fortune. `Any` is the empty length and stays off the URL. Daily replaces the
// fortune id, because the API rejects the two together.
export function settingsQuery({
  locale,
  cow,
  category,
  length,
  fortune,
  daily = false,
  defaultLocale,
  defaultCow = "default",
}) {
  const params = new URLSearchParams();
  if (isResourceName(locale) && locale !== defaultLocale)
    params.set("locale", locale);
  if (isResourceName(cow) && cow !== defaultCow) params.set("cow", cow);
  if (isResourceName(category)) params.set("category", category);
  if (length === "short" || length === "long") params.set("length", length);
  if (daily === true) params.set("daily", "true");
  else if (isFortuneId(fortune)) params.set("fortune", fortune);
  const query = params.toString();
  return query ? `?${query}` : "";
}
