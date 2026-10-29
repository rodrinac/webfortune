// Shareable page settings. Values are accepted only when they match the same
// resource-name rule the API uses, and only when they are in an allow-list
// the caller already loaded. Nothing returned here is safe to treat as HTML;
// callers must keep using text APIs.

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

// Query string for the settings that differ from the defaults. Param order
// matches the share link: locale, cow, category.
export function settingsQuery({
  locale,
  cow,
  category,
  defaultLocale,
  defaultCow = "default",
}) {
  const params = new URLSearchParams();
  if (isResourceName(locale) && locale !== defaultLocale)
    params.set("locale", locale);
  if (isResourceName(cow) && cow !== defaultCow) params.set("cow", cow);
  if (isResourceName(category)) params.set("category", category);
  const query = params.toString();
  return query ? `?${query}` : "";
}
