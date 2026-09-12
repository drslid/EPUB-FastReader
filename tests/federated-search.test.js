// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => Object.fromEntries(["selection", "gutenberg", "standard-ebooks", "ebooks-gratuits"].map((id) => [id, {
  manifest: { id, name: id, capabilities: { search: true, download: true, bundled: id === "selection" } },
  search: vi.fn(), download: vi.fn(),
}])));
vi.mock("../src/sources/selection.js", () => ({ default: adapters.selection }));
vi.mock("../src/sources/gutenberg.js", () => ({ default: adapters.gutenberg }));
vi.mock("../src/sources/standard-ebooks.js", () => ({ default: adapters["standard-ebooks"] }));
vi.mock("../src/sources/ebooks-gratuits.js", () => ({ default: adapters["ebooks-gratuits"] }));
import { searchBooks, providers } from "../src/catalog.js";
import { buildSearchRoute, parseSearchRoute } from "../src/search-route.js";

const local = { id: "selection-horla", providerId: "selection", canonicalSourceId: "gutenberg:10775", title: "Le Horla" };
const gutenberg = { id: "gutenberg-11", providerId: "gutenberg", canonicalSourceId: "gutenberg:11", title: "Alice" };
const standard = { id: "standardebooks-mary-shelley_frankenstein", providerId: "standard-ebooks", title: "Frankenstein" };
const gratuit = { id: "ebooks-gratuits-23", providerId: "ebooks-gratuits", title: "Candide" };
const result = (books, extra = {}) => ({ books, count: books.length, hasNext: false, countIsApproximate: false, ...extra });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  adapters.selection.search.mockResolvedValue(result([local]));
  adapters.gutenberg.search.mockImplementation(async ({ preferredBooks, page }) => result([...(page === 1 ? preferredBooks : []), gutenberg], { snapshotDate: "2026-09-12" }));
  adapters["standard-ebooks"].search.mockResolvedValue(result([standard]));
  adapters["ebooks-gratuits"].search.mockResolvedValue(result([gratuit]));
});
afterEach(() => vi.restoreAllMocks());

describe("incremental federated search", () => {
  it("publishes local books, Gutenberg and Standard Ebooks while the French source is still loading", async () => {
    const slow = deferred();
    adapters["ebooks-gratuits"].search.mockReturnValue(slow.promise);
    const updates = [];
    let settled = false;
    const search = searchBooks({ query: "novel", language: "", onUpdate: (value) => updates.push(value) }).then((value) => { settled = true; return value; });
    await vi.waitFor(() => expect(updates).toHaveLength(3));
    expect(settled).toBe(false);
    expect(updates[0].books).toEqual([local]);
    expect(updates[0].pendingSources).toEqual(["gutenberg", "standard-ebooks", "ebooks-gratuits"]);
    expect(updates.at(-1).books).toEqual([local, gutenberg, standard]);
    expect(updates.at(-1).pendingSources).toEqual(["ebooks-gratuits"]);
    expect(updates.at(-1).sourceStatuses["standard-ebooks"].status).toBe("available");
    slow.resolve(result([gratuit]));
    const final = await search;
    expect(final.books).toEqual([local, gutenberg, standard, gratuit]);
    expect(final.pendingSources).toEqual([]);
    expect(final.count).toBe(4);
    expect(final).toEqual(updates.at(-1));
    expect(final.snapshotDate).toBe("2026-09-12");
  });

  it("launches remote providers concurrently, regardless of Gutenberg latency", async () => {
    const slow = deferred();
    adapters.gutenberg.search.mockReturnValue(slow.promise);
    const updates = [];
    const promise = searchBooks({ query: "book", language: "all", onUpdate: (value) => updates.push(value) });
    await vi.waitFor(() => expect(updates.at(-1).books).toEqual([local, standard, gratuit]));
    expect(updates.at(-1).pendingSources).toEqual(["gutenberg"]);
    slow.resolve(result([local, gutenberg]));
    expect((await promise).books).toEqual([local, gutenberg, standard, gratuit]);
  });

  it.each([["fr", "ebooks-gratuits", "standard-ebooks"], ["en", "standard-ebooks", "ebooks-gratuits"]])("respects the %s language filter before contacting remote catalogues", async (language, called, skipped) => {
    await searchBooks({ query: "book", language });
    expect(adapters[called].search).toHaveBeenCalledOnce();
    expect(adapters[skipped].search).not.toHaveBeenCalled();
  });

  it("keeps an empty global search local without triggering remote catalogue crawls", async () => {
    await searchBooks({ query: "  ", language: "" });
    expect(adapters["standard-ebooks"].search).not.toHaveBeenCalled();
    expect(adapters["ebooks-gratuits"].search).not.toHaveBeenCalled();
    expect(adapters.gutenberg.search).toHaveBeenCalledOnce();
  });

  it("keeps successful results when another provider times out", async () => {
    adapters["ebooks-gratuits"].search.mockRejectedValue(Object.assign(new Error("La source met trop de temps à répondre."), { code: "TIMEOUT" }));
    const result = await searchBooks({ query: "book", language: "" });
    expect(result.books).toEqual([local, gutenberg, standard]);
    expect(result.warnings).toEqual([{ providerId: "ebooks-gratuits", code: "TIMEOUT", message: "La source met trop de temps à répondre." }]);
    expect(result.sourceStatuses["ebooks-gratuits"]).toMatchObject({ status: "unavailable", code: "TIMEOUT", checkedAt: expect.any(Number) });
    expect(result.sourceStatuses.gutenberg.status).toBe("available");
  });

  it("keeps the bundled selection available if the Gutenberg index fails", async () => {
    adapters.gutenberg.search.mockRejectedValue(new Error("Missing index"));
    const final = await searchBooks({ query: "", language: "fr" });
    expect(final.books).toEqual([local]);
    expect(final.count).toBe(1);
    expect(final.warnings[0].providerId).toBe("gutenberg");
    expect(final.sourceStatuses.selection.status).toBe("available");
  });

  it("deduplicates canonical Gutenberg editions with the bundled one first", async () => {
    adapters.gutenberg.search.mockResolvedValue(result([local, { ...local, id: "gutenberg-10775", providerId: "gutenberg" }, gutenberg]));
    expect((await searchBooks()).books).toEqual([local, gutenberg]);
    expect(adapters.gutenberg.search.mock.calls[0][0].preferredBooks).toEqual([local]);
  });

  it("paginates each provider independently and never repeats the selection on page two", async () => {
    adapters["ebooks-gratuits"].search.mockResolvedValue(result([gratuit], { count: 100, hasNext: true, countIsApproximate: true }));
    const updates = [];
    const final = await searchBooks({ query: "book", language: "", page: 2, onUpdate: (value) => updates.push(value) });
    expect(updates[0].books).toEqual([]);
    expect(final.books).toEqual([gutenberg, standard, gratuit]);
    expect(final.hasNext).toBe(true);
    expect(final.countIsApproximate).toBe(true);
    expect(final.count).toBe(102);
    for (const id of ["gutenberg", "standard-ebooks", "ebooks-gratuits"]) expect(adapters[id].search.mock.calls[0][0].page).toBe(2);
  });

  it("aborts promptly and emits no stale update even if a provider ignores AbortSignal", async () => {
    const slow = deferred();
    adapters["ebooks-gratuits"].search.mockReturnValue(slow.promise);
    const updates = [];
    const controller = new AbortController();
    const promise = searchBooks({ query: "book", language: "fr", signal: controller.signal, onUpdate: (value) => updates.push(value) });
    await vi.waitFor(() => expect(updates).toHaveLength(2));
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    const previous = updates.length;
    slow.resolve(result([gratuit]));
    await Promise.resolve(); await Promise.resolve();
    expect(updates).toHaveLength(previous);
    expect(adapters["ebooks-gratuits"].search.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it("makes no source request when already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(searchBooks({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    for (const adapter of Object.values(adapters)) expect(adapter.search).not.toHaveBeenCalled();
  });

  it("does not mutate a previous snapshot's source status objects", async () => {
    const updates = [];
    await searchBooks({ query: "book", language: "en", onUpdate: (value) => updates.push(value) });
    expect(updates[0].sourceStatuses.gutenberg.status).toBe("pending");
    expect(updates.at(-1).sourceStatuses.gutenberg.status).toBe("available");
  });
});

describe("explicit source integration", () => {
  it.each(["standard-ebooks", "ebooks-gratuits"])("registers %s and preserves it in shareable search routes", (provider) => {
    expect(providers.find((entry) => entry.id === provider).searchable).toBe(true);
    const route = { view: "search", provider, language: "en", query: "Austen", page: 2 };
    expect(parseSearchRoute(buildSearchRoute(route))).toEqual(route);
  });

  it("publishes pending and available states for a single selected source", async () => {
    const updates = [];
    const result = await searchBooks({ provider: "standard-ebooks", query: "", language: "en", onUpdate: (value) => updates.push(value) });
    expect(updates).toHaveLength(2);
    expect(updates[0].pendingSources).toEqual(["standard-ebooks"]);
    expect(updates[1].sourceStatuses["standard-ebooks"].status).toBe("available");
    expect(updates[1]).toEqual(result);
    expect(adapters["standard-ebooks"].search).toHaveBeenCalledOnce();
  });

  it("publishes the failed source state before retaining its actionable error", async () => {
    adapters["ebooks-gratuits"].search.mockRejectedValue(Object.assign(new Error("Relay missing"), { code: "SOURCE_NOT_CONFIGURED" }));
    const updates = [];
    await expect(searchBooks({ provider: "ebooks-gratuits", query: "Candide", onUpdate: (value) => updates.push(value) })).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIGURED" });
    expect(updates.at(-1).sourceStatuses["ebooks-gratuits"]).toMatchObject({ status: "unavailable", code: "SOURCE_NOT_CONFIGURED" });
    expect(updates.at(-1).pendingSources).toEqual([]);
  });
});
