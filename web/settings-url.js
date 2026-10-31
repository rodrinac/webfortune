// Shareable page settings. Locale, cow, and category are accepted only when
// they match the API's resource-name rule and an allow-list the caller already
// loaded. A fortune id uses that same rule and a `<database>-<index>` shape.
// Nothing returned here is safe to treat as HTML; callers must keep using text APIs.

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

// Query string for the settings that differ from the defaults. Param order
// matches the share link: locale, cow, category, then the exact fortune.
export function settingsQuery({
  locale,
  cow,
  category,
  fortune,
  defaultLocale,
  defaultCow = "default",
}) {
  const params = new URLSearchParams();
  if (isResourceName(locale) && locale !== defaultLocale)
    params.set("locale", locale);
  if (isResourceName(cow) && cow !== defaultCow) params.set("cow", cow);
  if (isResourceName(category)) params.set("category", category);
  if (isFortuneId(fortune)) params.set("fortune", fortune);
  const query = params.toString();
  return query ? `?${query}` : "";
}
