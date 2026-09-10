const languages = new Set(["fr", "en", "es", "de", ""]);
const providers = new Set(["selection", "all", "gutenberg"]);
const views = new Set(["library", "discover", "search"]);

function normalizeRoute(view, values = {}) {
  if (!views.has(view)) view = "library";
  const defaults = {
    view,
    query: "",
    language: "fr",
    provider: view === "search" ? "all" : "selection",
    page: 1,
  };
  if (view === "library") return defaults;

  const page = String(values.page ?? "");
  return {
    view,
    query: view === "search" && typeof values.query === "string"
      ? values.query.trim().slice(0, 150)
      : "",
    language: languages.has(values.language) ? values.language : defaults.language,
    provider: providers.has(values.provider) ? values.provider : defaults.provider,
    page: /^\d+$/u.test(page) && Number(page) >= 1 && Number(page) <= 100000
      ? Number(page)
      : defaults.page,
  };
}

/** Read a shareable dashboard route without allowing unknown source filters. */
export function parseSearchRoute(hash = "") {
  if (typeof hash !== "string") return normalizeRoute("library");
  const route = hash.replace(/^#/u, "");
  const separator = route.indexOf("?");
  const view = separator < 0 ? route : route.slice(0, separator);
  const parameters = new URLSearchParams(separator < 0 ? "" : route.slice(separator + 1));
  return normalizeRoute(view, {
    query: parameters.get("q"),
    language: parameters.get("language"),
    provider: parameters.get("provider"),
    page: parameters.get("page"),
  });
}

/** Build a canonical route, preserving the explicit all-languages empty value. */
export function buildSearchRoute({ view = "search", query = "", language = "fr", provider = "all", page = 1 } = {}) {
  const normalized = normalizeRoute(view, { query, language, provider, page });
  if (normalized.view === "library") return "#library";
  const parameters = new URLSearchParams();
  if (normalized.view === "search") parameters.set("q", normalized.query);
  parameters.set("language", normalized.language);
  parameters.set("provider", normalized.provider);
  parameters.set("page", String(normalized.page));
  return `#${normalized.view}?${parameters}`;
}
