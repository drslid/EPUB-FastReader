// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLoyalbooksListing, updateLoyalbooks } from "../scripts/update-loyalbooks.mjs";

const card = (slug = "candide", title = "Candide", author = "Voltaire") => `<td class="layout2-blue"><a href="/book/${slug}"><img src="/image/layout2/Candide.jpg"></a><br><a href="/book/${slug}"><b>${title}</b></a><br>${author}</td>`;
const listing = ({ name = "French", page = 1, pages = 1, total = 1, rows = card() } = {}) => `<h1>${name}: ${total} free ebooks</h1><p>Page ${page} of ${pages}</p><table><tr>${rows}</tr></table>`;
const html = (value) => new Response(value, { headers: { "Content-Type": "text/html" } });
let dir;
let output;
let checkpoint;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "loyalbooks-index-")); output = join(dir, "catalogue.json"); checkpoint = join(dir, "checkpoint.json"); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const options = () => ({ output, checkpoint, languages: ["fr"], log: vi.fn() });

describe("Loyal Books public EPUB catalogue collector", () => {
  it("parses illustrated and text-only editions, Unicode paths and full titles", () => {
    const long = "Un titre français complet ".repeat(20).trim();
    const rows = card("premier", long) + '<td class="layout3"><div><a href="/book/Contes-Fran%C3%A7ais">Contes Français</a> By: Prosper Mérimée</div></td>';
    const result = parseLoyalbooksListing(listing({ total: 2, rows }), "fr");
    expect(result.books).toHaveLength(2);
    expect(result.books[0]).toMatchObject({ title: long, author: "Voltaire", cover: "https://www.loyalbooks.com/image/layout2/Candide.jpg" });
    expect(result.books[1]).toMatchObject({ slug: "Contes-Français", author: "Prosper Mérimée", cover: null, language: "fr" });
  });
  it("rejects audio catalogues, unrelated languages, login pages and missing result cards", () => {
    for (const document of [listing().replace("free ebooks", "free audio books"), listing({ name: "English" }), "<h1>Login</h1>", listing({ rows: "" })]) expect(() => parseLoyalbooksListing(document, "fr")).toThrow();
  });
  it("collects only metadata, omits page=1, enforces 60 seconds and publishes exact coverage", async () => {
    let clock = 1_000;
    const times = [];
    const wait = vi.fn(async (ms) => { clock += ms; });
    const fetchImpl = vi.fn(async (url) => {
      times.push(clock);
      const page = Number(new URL(url).searchParams.get("page") || 1);
      return html(listing({ page, pages: 3, total: 300, rows: card(`page-${page}`) }));
    });
    const result = await updateLoyalbooks({ ...options(), pagesPerLanguage: 2, fetchImpl, now: () => clock, wait });
    expect(times).toEqual([1000, 61000]);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://www.loyalbooks.com/language/French?type=ebook&results=100");
    expect(fetchImpl.mock.calls[1][0]).toMatch(/&page=2$/u);
    expect(result).toMatchObject({ coverage: "selection", languages: { fr: { indexed: 2, total: 300, pages: 2, complete: false } }, excludedLanguages: ["en", "es", "it", "de", "pt"] });
    expect(fetchImpl.mock.calls.every(([url]) => !/download|search/u.test(url))).toBe(true);
  });
  it("resumes completed pages without another request and preserves the delay after failure", async () => {
    let clock = 1000;
    const wait = vi.fn(async (ms) => { clock += ms; });
    const fetchImpl = vi.fn(async () => html(listing({ pages: 2, total: 2 })));
    await updateLoyalbooks({ ...options(), fetchImpl, now: () => clock, wait });
    const original = await readFile(output, "utf8");
    fetchImpl.mockResolvedValueOnce(new Response("Denied", { status: 429 }));
    await expect(updateLoyalbooks({ ...options(), pagesPerLanguage: 2, fetchImpl, now: () => clock, wait })).rejects.toThrow("HTTP 429");
    expect(await readFile(output, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(checkpoint, "utf8")).nextAllowedAt).toBe(121000);
    fetchImpl.mockResolvedValueOnce(html(listing({ page: 2, pages: 2, total: 2, rows: card("second") })));
    await updateLoyalbooks({ ...options(), pagesPerLanguage: 2, fetchImpl, now: () => clock, wait });
    expect(fetchImpl).toHaveBeenCalledTimes(3); expect(clock).toBe(121000);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([60000, 60000]);
  });
  it("refreshes explicitly without resetting nextAllowedAt, and keeps the previous snapshot on error", async () => {
    let clock = 1000;
    const wait = vi.fn(async (ms) => { clock += ms; });
    await updateLoyalbooks({ ...options(), fetchImpl: async () => html(listing()), now: () => clock, wait });
    const original = await readFile(output, "utf8");
    await expect(updateLoyalbooks({ ...options(), refresh: true, fetchImpl: async () => new Response("Denied", { status: 403 }), now: () => clock, wait })).rejects.toThrow("HTTP 403");
    expect(wait).toHaveBeenCalledWith(60000, undefined, { signal: undefined });
    expect(await readFile(output, "utf8")).toBe(original);
    const state = JSON.parse(await readFile(checkpoint, "utf8"));
    expect(state).toMatchObject({ nextAllowedAt: 121000, refreshing: true, pages: {} });
    const result = await updateLoyalbooks({ ...options(), refresh: true, fetchImpl: async () => html(listing({ rows: card("new-edition") })), now: () => clock, wait });
    expect(result.books[0].slug).toBe("new-edition"); expect(clock).toBe(121000);
  });
  it("prevents concurrent collectors from racing around the crawl delay", async () => {
    await writeFile(`${checkpoint}.lock`, "another collector\n");
    const fetchImpl = vi.fn();
    await expect(updateLoyalbooks({ ...options(), fetchImpl })).rejects.toMatchObject({ code: "EEXIST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses a snapshot larger than the client's 2 MiB limit and preserves the previous publication", async () => {
    await writeFile(output, "previous working snapshot");
    let clock = 1000;
    const fetchImpl = vi.fn(async (url) => {
      const page = Number(new URL(url).searchParams.get("page") || 1);
      return html(listing({ page, pages: 12, total: 1200, rows: Array.from({ length: 100 }, (_, i) => card(`edition-${page}-${i}`, "A".repeat(1900))).join("") }));
    });
    await expect(updateLoyalbooks({ ...options(), pagesPerLanguage: 12, fetchImpl, now: () => clock, wait: async (ms) => { clock += ms; } })).rejects.toThrow("2 MiB");
    expect(await readFile(output, "utf8")).toBe("previous working snapshot");
    expect(Object.keys(JSON.parse(await readFile(checkpoint, "utf8")).pages)).toHaveLength(12);
  });
});
