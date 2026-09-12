import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const locale = vi.hoisted(() => ({ read: "Lire" }));
vi.mock("../src/i18n.js", () => ({
  t: (message, values = {}) => {
    if (message === "Lire") return locale.read;
    return message.replace(/\{(\w+)\}/gu, (_, name) => values[name] ?? "");
  },
}));

let module;
let panel;
let host;
let onRead;
let google;
let controls;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules();
  locale.read = "Lire";
  delete window.google;
  delete window.__gcse;
  document.body.innerHTML = '<main><div id="host"></div></main>';
  host = document.getElementById("host");
  onRead = vi.fn();
  controls = new Map();
  google = {
    render: vi.fn(({ div, gname }) => {
      const container = document.getElementById(div);
      container.innerHTML = '<aside data-promotion>Promotion</aside><div data-organic></div><footer><a href="https://www.google.com/">Google</a><button data-page>2</button></footer>';
      const control = {
        container,
        execute: vi.fn((query) => window.__gcse.searchCallbacks.web.starting(gname, query)),
        clearAllResults: vi.fn(),
      };
      controls.set(gname, control);
    }),
    getElement: vi.fn((name) => controls.get(name)),
  };
  module = await import("../src/loyal-search-panel.js");
  panel = module.createLoyalSearchPanel({ onRead });
});

afterEach(() => {
  panel?.unmount();
  vi.useRealTimers();
  document.querySelectorAll("script[data-loyal-search-loader]").forEach((script) => script.remove());
  document.body.replaceChildren();
  delete window.google;
  delete window.__gcse;
});

async function finishLoading() {
  window.google = { search: { cse: { element: google } } };
  window.__gcse.initializationCallback();
  await flush();
}

const activeName = () => google.render.mock.calls.at(-1)?.[0].gname;
const active = () => controls.get(activeName());

function renderResults(query, entries) {
  const area = active().container.querySelector("[data-organic]");
  const results = entries.map(({ url, title = "Titre du livre" }) => {
    const result = document.createElement("article");
    result.className = "gsc-webResult gsc-result";
    const link = document.createElement("a");
    link.className = "gs-title";
    link.href = url;
    link.textContent = title;
    link.target = "_blank";
    link.rel = "noopener";
    const snippet = document.createElement("p");
    snippet.textContent = "Extrait fourni par Google";
    result.append(link, snippet);
    return result;
  });
  area.replaceChildren(...results);
  window.__gcse.searchCallbacks.web.rendered(activeName(), query, [], results);
  return results;
}

describe("Loyal Books result identities", () => {
  it.each([
    ["https://www.loyalbooks.com/book/emma-by-jane-austen", "emma-by-jane-austen"],
    ["http://www.loyalbooks.com/book/candide-by-voltaire", "candide-by-voltaire"],
    ["https://www.loyalbooks.com/book/Contes-Fran%C3%A7ais", "Contes-Français"],
    ["https://www.loyalbooks.com/book/L%27Art%20de%20Lire", "L'Art de Lire"],
  ])("allows the actual public book URL %s", (url, slug) => {
    expect(module.loyalbooksResultSlug(url)).toBe(slug);
  });

  it.each([
    "https://www.loyalbooks.com/book/emma/feed",
    "https://www.loyalbooks.com/book/emma/",
    "https://www.loyalbooks.com/book/emma?download=1",
    "https://www.loyalbooks.com/book/emma#chapter",
    "https://www.loyalbooks.com/language/English",
    "https://www.loyalbooks.com/author?author=Austen",
    "https://www.loyalbooks.com/book/%2Fetc",
    "https://www.loyalbooks.com/book/%252Fetc",
    "https://www.loyalbooks.com/book/%ZZ",
    "https://www.loyalbooks.com/book/%00hello",
    "https://www.loyalbooks.com/book/..",
    "https://www.loyalbooks.com/book/",
    "https://www.loyalbooks.com:8443/book/emma",
    "https://user@www.loyalbooks.com/book/emma",
    "https://www.loyalbooks.com.evil.example/book/emma",
    "https://evil.example/book/emma",
    "https://www.loyalbooks.com/book/a%3Cb",
    "javascript:alert(1)",
    "/book/emma",
    "https://www.loyalbooks.com/book/" + "a".repeat(201),
  ])("does not offer reading for %s", (url) => {
    expect(module.loyalbooksResultSlug(url)).toBeNull();
  });
});

describe("Google search panel", () => {
  it("is inert until explicitly mounted with a nonempty query, and uses the documented results-only component", async () => {
    panel.update({ query: "Emma" });
    expect(document.querySelector("script[data-loyal-search-loader]")).toBeNull();
    panel.mount(host, { query: "" });
    expect(host.textContent).toContain("Saisissez un titre");
    expect(document.querySelector("script[data-loyal-search-loader]")).toBeNull();
    panel.update({ query: "Emma" });
    const script = document.querySelector("script[data-loyal-search-loader]");
    expect(script.src).toBe("https://cse.google.com/cse.js?cx=71dbe754842244413");
    expect(panel.getState().status).toBe("loading");
    await finishLoading();
    expect(google.render).toHaveBeenCalledWith(expect.objectContaining({
      tag: "searchresults-only",
      attributes: { autoSearchOnLoad: false, enableHistory: false },
    }));
    expect(active().execute).toHaveBeenCalledExactlyOnceWith("Emma");
    expect(module.LOYAL_SEARCH_CAPABILITIES).toEqual({ supportsLanguageFilter: false, managesPagination: true });
  });

  it("preserves results, original links, promotion, and pagination while adding reading only to valid book results", async () => {
    panel.mount(host, { query: "Candide" });
    await finishLoading();
    const promotion = host.querySelector("[data-promotion]");
    const footer = host.querySelector("footer");
    const results = renderResults("Candide", [
      { url: "https://www.loyalbooks.com/book/candide-by-voltaire-2", title: "Candide (French)" },
      { url: "http://www.loyalbooks.com/book/candide-by-voltaire", title: "Candide (English)" },
      { url: "https://www.loyalbooks.com/book/candide-by-voltaire/feed" },
      { url: "https://www.loyalbooks.com/language/French" },
      { url: "https://elsewhere.example/book/candide" },
    ]);
    const links = results.map((result) => result.querySelector("a"));
    expect(host.querySelectorAll(".gsc-result")).toHaveLength(5);
    expect(host.querySelectorAll("button[data-loyalbook-read]")).toHaveLength(2);
    expect(host.querySelector("[data-promotion]")).toBe(promotion);
    expect(host.querySelector("footer")).toBe(footer);
    expect(links[1].getAttribute("href")).toBe("http://www.loyalbooks.com/book/candide-by-voltaire");
    expect(links.every((link) => link.target === "_blank" && link.rel === "noopener")).toBe(true);
    expect(results.every((result) => result.querySelector("p").textContent === "Extrait fourni par Google")).toBe(true);
    const event = new MouseEvent("click", { cancelable: true, bubbles: true });
    links[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onRead).not.toHaveBeenCalled();
    host.querySelector("button[data-loyalbook-read]").click();
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ slug: "candide-by-voltaire-2" });
    window.__gcse.searchCallbacks.web.rendered(activeName(), "Candide", [], results);
    expect(host.querySelectorAll("button[data-loyalbook-read]")).toHaveLength(2);
    expect(panel.getState().status).toBe("ready");
  });

  it("keeps Google DOM stable across repeated mount and busy changes without repeating a search", async () => {
    panel.mount(host, { query: "Emma" });
    await finishLoading();
    const [result] = renderResults("Emma", [{ url: "https://www.loyalbooks.com/book/emma" }]);
    const button = result.querySelector("button");
    const footer = host.querySelector("footer");
    panel.mount(host, { query: "Emma", busy: true });
    expect(host.querySelector(".gsc-result")).toBe(result);
    expect(host.querySelector("footer")).toBe(footer);
    expect(button.disabled).toBe(true);
    button.click();
    expect(onRead).not.toHaveBeenCalled();
    panel.update({ busy: false });
    button.click();
    expect(onRead).toHaveBeenCalledOnce();
    expect(google.render).toHaveBeenCalledOnce();
    expect(active().execute).toHaveBeenCalledOnce();
  });

  it("executes only the latest query when loading finishes and clears an empty query without searching", async () => {
    panel.mount(host, { query: "Candide" });
    panel.update({ query: "Emma" });
    await finishLoading();
    expect(active().execute).toHaveBeenCalledExactlyOnceWith("Emma");
    panel.update({ query: " " });
    expect(active().execute).toHaveBeenCalledOnce();
    expect(active().clearAllResults).toHaveBeenCalledOnce();
    expect(panel.getState().status).toBe("idle");
    panel.update({ query: "Jane Austen" });
    expect(active().execute).toHaveBeenLastCalledWith("Jane Austen");
  });

  it("ignores late results and read actions after leaving the source", async () => {
    const stateUpdates = vi.fn();
    panel = module.createLoyalSearchPanel({ onRead, onState: stateUpdates });
    panel.mount(host, { query: "Emma" });
    await finishLoading();
    const [result] = renderResults("Emma", [{ url: "https://www.loyalbooks.com/book/emma" }]);
    const name = activeName();
    const callbacks = window.__gcse.searchCallbacks.web;
    const execute = active().execute;
    panel.unmount();
    const updates = stateUpdates.mock.calls.length;
    callbacks.rendered(name, "Emma", [], [result]);
    callbacks.starting(name, "Emma");
    result.querySelector("button").click();
    panel.update({ query: "Candide" });
    await flush();
    expect(onRead).not.toHaveBeenCalled();
    expect(stateUpdates).toHaveBeenCalledTimes(updates);
    expect(execute).toHaveBeenCalledOnce();
    expect(host.children).toHaveLength(0);
  });

  it("does not launch a search when navigation cancels an unfinished load", async () => {
    panel.mount(host, { query: "Emma" });
    panel.unmount();
    await finishLoading();
    expect(google.render).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
    panel.mount(host, { query: "Candide" });
    await flush();
    expect(active().execute).toHaveBeenCalledExactlyOnceWith("Candide");
    expect(document.querySelectorAll("script[data-loyal-search-loader]")).toHaveLength(1);
  });

  it("isolates a new visit from a late callback for the same query on the old visit", async () => {
    panel.mount(host, { query: "Emma" });
    await finishLoading();
    const name = activeName();
    const oldContainer = active().container;
    panel.unmount();
    panel.mount(host, { query: "Emma" });
    await flush();
    expect(activeName()).not.toBe(name);
    window.__gcse.searchCallbacks.web.rendered(name, "Emma", [], [oldContainer]);
    expect(panel.getState().status).toBe("searching");
    expect(host.querySelector("button[data-loyalbook-read]")).toBeNull();
  });

  it("shows a load failure and retries only after a reader action", async () => {
    panel.mount(host, { query: "Emma" });
    document.querySelector("script[data-loyal-search-loader]").dispatchEvent(new Event("error"));
    await flush();
    expect(panel.getState().status).toBe("error");
    expect(host.querySelector('[role="alert"]').textContent).toContain("indisponible");
    expect(host.querySelector(".loyal-search-source").href).toBe("https://www.loyalbooks.com/search?q=Emma");
    expect(document.querySelector("script[data-loyal-search-loader]")).toBeNull();
    expect(google.render).not.toHaveBeenCalled();
    panel.update({ busy: true });
    panel.mount(host, { query: "Emma", busy: false });
    expect(document.querySelector("script[data-loyal-search-loader]")).toBeNull();
    host.querySelector(".loyal-search-retry").click();
    expect(document.querySelector("script[data-loyal-search-loader]")).not.toBeNull();
    await finishLoading();
    expect(active().execute).toHaveBeenCalledExactlyOnceWith("Emma");
  });

  it("bounds loading time and search waiting without hiding already rendered Google content", async () => {
    vi.useFakeTimers();
    panel.mount(host, { query: "Emma" });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(panel.getState().status).toBe("error");
    host.querySelector(".loyal-search-retry").click();
    await finishLoading();
    const promotion = host.querySelector("[data-promotion]");
    await vi.advanceTimersByTimeAsync(25_001);
    expect(panel.getState().status).toBe("error");
    expect(host.querySelector("[data-promotion]")).toBe(promotion);
    expect(active().execute).toHaveBeenCalledOnce();
    renderResults("Emma", []);
    expect(panel.getState().status).toBe("ready");
  });

  it("translates its own action labels without touching Google text or repeating the query", async () => {
    panel.mount(host, { query: "Emma" });
    await finishLoading();
    const [result] = renderResults("Emma", [{ url: "https://www.loyalbooks.com/book/emma", title: "Emma — Google title" }]);
    const link = result.querySelector("a");
    locale.read = "Read";
    window.dispatchEvent(new Event("languagechange"));
    expect(result.querySelector("button").textContent).toBe("Read");
    expect(result.querySelector("a")).toBe(link);
    expect(link.textContent).toBe("Emma — Google title");
    expect(active().execute).toHaveBeenCalledOnce();
  });
});
