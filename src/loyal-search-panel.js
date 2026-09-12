import { t } from "./i18n.js";

// The public engine identifier is not an API key. All searches go through
// Google's documented Search Element; no internal endpoint or token is used.
const SCRIPT_URL = "https://cse.google.com/cse.js?cx=71dbe754842244413";
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.,'()!~-]{0,199}$/u;
const LOAD_TIMEOUT = 15_000;
const SEARCH_TIMEOUT = 25_000;
const instances = new Map();
let nextInstance = 0;
let loading;

export const LOYAL_SEARCH_CAPABILITIES = Object.freeze({
  supportsLanguageFilter: false,
  managesPagination: true,
});

/** A search result can offer reading only for one real, allowlisted book path.
 * Keep the original Google link untouched, including legacy HTTP links. */
export function loyalbooksResultSlug(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "www.loyalbooks.com" || url.port || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/book\/([^/]+)$/u.exec(url.pathname);
    const slug = match && decodeURIComponent(match[1]);
    return slug && SLUG.test(slug) ? slug : null;
  } catch { return null; }
}

const api = () => window.google?.search?.cse?.element;
const unavailable = () => t("La recherche Google sur Loyal Books est indisponible. Réessayez ou ouvrez le site source.");

function loadGoogle() {
  if (loading) return loading.promise;
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const current = { promise, script: null, timer: null };
  loading = current;
  const finish = (error) => {
    if (loading !== current) return;
    clearTimeout(current.timer);
    current.script?.removeEventListener("error", fail);
    if (error) {
      current.script?.remove();
      loading = undefined;
      reject(error);
    } else resolve(api());
  };
  const fail = () => finish(new Error(unavailable()));
  const previous = window.__gcse || {};
  const oldWeb = previous.searchCallbacks?.web || {};
  // These are the documented lifecycle callbacks. Callbacks from unrelated
  // components, if present, retain their previous behavior.
  window.__gcse = {
    ...previous,
    parsetags: "explicit",
    initializationCallback(...args) {
      if (typeof previous.initializationCallback === "function") previous.initializationCallback(...args);
      if (api()?.render) finish();
      else fail();
    },
    searchCallbacks: {
      ...previous.searchCallbacks,
      web: {
        ...oldWeb,
        starting(name, query) {
          const instance = instances.get(name);
          if (instance) { instance.starting(query); return query; }
          return typeof oldWeb.starting === "function" ? oldWeb.starting(name, query) : query;
        },
        rendered(name, query, promotions, results) {
          const instance = instances.get(name);
          if (instance) instance.rendered(query, results);
          else if (typeof oldWeb.rendered === "function") oldWeb.rendered(name, query, promotions, results);
        },
      },
    },
  };
  if (api()?.render) { finish(); return promise; }
  const script = document.createElement("script");
  script.async = true;
  script.src = SCRIPT_URL;
  script.dataset.loyalSearchLoader = "";
  script.addEventListener("error", fail, { once: true });
  current.script = script;
  current.timer = setTimeout(fail, LOAD_TIMEOUT);
  document.head.append(script);
  return promise;
}

/**
 * Create is inert. Mount only in the explicitly selected Loyal Books view.
 * Google owns the results, ads, attribution, source links, and pagination.
 * The app's one search field supplies queries through update().
 *
 * Repeated mount on the same container and busy updates preserve all Google
 * DOM. Reattaching to a replacement container is supported, but callers should
 * preserve the connected host: disconnecting ad iframes can reload them.
 * Unmount prevents new searches/actions and ignores pending callbacks. An
 * already-issued Google request cannot be aborted through this public API.
 */
export function createLoyalSearchPanel({ onRead = () => {}, onQuery, onState } = {}) {
  let mounted = false;
  let generation = 0;
  let name = "";
  let query = "";
  let lastExecuted;
  let busy = false;
  let control;
  let booting = false;
  let searchTimer;
  let state = { status: "idle", error: "" };
  let root;
  let results;
  let notice;
  let retry;
  let sourceLink;

  function localize() {
    if (!root) return;
    root.setAttribute("aria-label", t("Recherche Google sur Loyal Books"));
    const labels = {
      idle: t("Saisissez un titre ou un auteur pour rechercher sur Loyal Books."),
      loading: t("Chargement de la recherche Google…"),
      searching: t("Recherche sur Loyal Books…"),
      ready: "",
      error: state.error || unavailable(),
    };
    notice.textContent = labels[state.status];
    notice.hidden = !notice.textContent;
    notice.setAttribute("role", state.status === "error" ? "alert" : "status");
    root.setAttribute("aria-busy", String(["loading", "searching"].includes(state.status)));
    retry.textContent = t("Réessayer");
    retry.hidden = state.status !== "error";
    sourceLink.textContent = t("Ouvrir Loyal Books");
    sourceLink.href = query ? `https://www.loyalbooks.com/search?q=${encodeURIComponent(query)}` : "https://www.loyalbooks.com/";
    sourceLink.hidden = state.status !== "error";
    for (const button of root.querySelectorAll("button[data-loyalbook-read]")) {
      button.textContent = t("Lire");
      button.setAttribute("aria-label", t("Lire {title}", { title: button.dataset.title || t("ce livre") }));
      button.disabled = busy;
    }
  }

  function setState(status, error = "") {
    const changed = state.status !== status || state.error !== error;
    state = { status, error };
    localize();
    if (changed && typeof onState === "function") {
      const version = generation;
      const snapshot = { ...state };
      // Never invoke a parent's render while Google is in its own render call.
      queueMicrotask(() => { if (mounted && generation === version) onState(snapshot); });
    }
  }

  function startTimer() {
    clearTimeout(searchTimer);
    const version = generation;
    searchTimer = setTimeout(() => {
      if (mounted && generation === version) setState("error", unavailable());
    }, SEARCH_TIMEOUT);
  }

  function starting(actualQuery) {
    if (!mounted || actualQuery !== query) return;
    setState("searching");
    startTimer();
    if (typeof onQuery === "function") {
      const version = generation;
      queueMicrotask(() => { if (mounted && generation === version && actualQuery === query) onQuery(actualQuery); });
    }
  }

  function rendered(actualQuery, resultElements) {
    if (!mounted || actualQuery !== query) return;
    clearTimeout(searchTimer);
    // Only add a sibling action inside each organic result. No result, link,
    // promotion, ad, count, or pagination element is removed or rewritten.
    for (const result of Array.isArray(resultElements) ? resultElements : []) {
      if (!(result instanceof Element) || !results.contains(result)) continue;
      if (result.querySelector("[data-loyalbook-read]")) continue;
      const link = result.querySelector("a.gs-title");
      const slug = loyalbooksResultSlug(link?.href);
      if (!slug) continue;
      const action = document.createElement("div");
      action.className = "loyal-search-read-action";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button ink loyal-search-read";
      button.dataset.loyalbookRead = slug;
      button.dataset.title = link.textContent?.trim().slice(0, 2000) || "";
      button.addEventListener("click", () => {
        if (mounted && !busy && button.isConnected) onRead({ slug });
      });
      action.append(button);
      result.append(action);
    }
    setState("ready");
  }

  function execute(force = false) {
    if (!mounted || !control) return;
    if (!query) {
      clearTimeout(searchTimer);
      if (lastExecuted) control.clearAllResults();
      lastExecuted = "";
      setState("idle");
      return;
    }
    if (!force && query === lastExecuted) return;
    lastExecuted = query;
    setState("searching");
    startTimer();
    try { control.execute(query); }
    catch { clearTimeout(searchTimer); setState("error", unavailable()); }
  }

  async function boot() {
    if (!mounted || booting || control || !query) return;
    booting = true;
    const version = generation;
    setState("loading");
    try {
      const google = await loadGoogle();
      if (!mounted || generation !== version) return;
      google.render({
        div: results.id,
        tag: "searchresults-only",
        gname: name,
        attributes: { autoSearchOnLoad: false, enableHistory: false },
      });
      control = google.getElement(name);
      if (!control?.execute || !control?.clearAllResults) throw new Error(unavailable());
      execute();
    } catch {
      if (mounted && generation === version) setState("error", unavailable());
    } finally {
      if (generation === version) booting = false;
    }
  }

  function update(values = {}) {
    const previousQuery = query;
    if (typeof values.query === "string") query = values.query.trim().slice(0, 150);
    if (typeof values.busy === "boolean") busy = values.busy;
    localize();
    if (!mounted) return;
    if (control) execute();
    else if (query) {
      if (state.status !== "error" || query !== previousQuery) void boot();
    }
    else setState("idle");
  }

  function mount(container, values = {}) {
    if (!(container instanceof Element)) throw new TypeError("Le panneau Loyal Books nécessite un conteneur.");
    if (!mounted) {
      mounted = true;
      generation++;
      // A new name isolates late callbacks from a previous visit, even when
      // the reader submits exactly the same query after returning.
      name = `fastreader-loyalbooks-${++nextInstance}`;
      root = document.createElement("section");
      root.className = "loyal-search-panel";
      notice = document.createElement("p");
      notice.className = "loyal-search-status";
      notice.setAttribute("aria-live", "polite");
      retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button secondary loyal-search-retry";
      retry.addEventListener("click", () => { if (control) execute(true); else void boot(); });
      sourceLink = document.createElement("a");
      sourceLink.className = "loyal-search-source";
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      results = document.createElement("div");
      results.id = name;
      results.className = "loyal-search-results";
      root.append(notice, retry, sourceLink, results);
      instances.set(name, { starting, rendered });
      window.addEventListener("languagechange", localize);
    }
    if (root.parentElement !== container) container.append(root);
    update(values);
    return controller;
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    generation++;
    clearTimeout(searchTimer);
    instances.delete(name);
    window.removeEventListener("languagechange", localize);
    // Let Google clear its own content before releasing the host.
    try { control?.clearAllResults(); } catch { /* The source may already have unloaded. */ }
    root?.remove();
    root = results = notice = retry = sourceLink = undefined;
    control = undefined;
    booting = false;
    lastExecuted = undefined;
    state = { status: "idle", error: "" };
  }

  const controller = Object.freeze({ mount, update, unmount, getState: () => ({ ...state }) });
  return controller;
}
