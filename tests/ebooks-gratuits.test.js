import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob } from "node:buffer";
import source, { parseEbooksGratuitsFeed } from "../src/sources/ebooks-gratuits.js";
import { configuredSourceRelay, sourceRelayUrl } from "../src/sources/relay-config.js";

const origin = "https://www.ebooksgratuits.com";
const entry = ({ id = "637", title = "Candide", format = "epub", author = "Voltaire", language = "fr", acquisition = `${origin}/newsendbook.php?id=${id}&amp;format=${format}` } = {}) => `<entry><id>${origin}/details.php?book=${id}</id><title>${title}</title><author><name>${author}</name></author><dcterms:language>${language}</dcterms:language><content type="text"><![CDATA[Édition Bibliothèque numérique romande.<br/>2015]]></content><link type="application/${format === "epub" ? "epub+zip" : "pdf"}" rel="http://opds-spec.org/acquisition" href="${acquisition}"/></entry>`;
const feed = (entries = entry(), extra = "") => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>1</opensearch:totalResults>${entries}${extra}</feed>`;
beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); vi.stubGlobal("Blob", Blob); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Ebooks libres et gratuits OPDS", () => {
  it("conserve l’identité de l’édition, l’auteur, les droits et le texte complet du titre", () => {
    const title = "Un titre français très long ".repeat(20).trim();
    const result = parseEbooksGratuitsFeed(feed(entry({ title })));
    expect(result).toMatchObject({ count: 1, countIsApproximate: false, hasNext: false });
    expect(result.books[0]).toMatchObject({ id: "ebooks-gratuits-637", canonicalSourceId: "ebooks-gratuits:637", title, author: "Voltaire", language: "fr", source: "Ebooks libres et gratuits", cover: null, canExportClassic: false, canExportFocus: false, sourceUrl: `${origin}/details.php?book=637`, rightsUrl: `${origin}/droitaut.php`, description: "Édition Bibliothèque numérique romande. 2015" });
  });
  it("élimine PDF, doublons, langues incompatibles et liens d’acquisition étrangers", () => {
    const records = entry() + entry() + entry({ id: "638", format: "pdf" }) + entry({ id: "639", language: "en" }) + entry({ id: "640", acquisition: "https://evil.test/book.epub" }) + entry({ id: "641", acquisition: `${origin}/newsendbook.php?id=999&amp;format=epub` });
    const result = parseEbooksGratuitsFeed(feed(records));
    expect(result.books.map((book) => book.id)).toEqual(["ebooks-gratuits-637"]);
    expect(result.countIsApproximate).toBe(true);
  });
  it.each(["<html>maintenance</html>", "<feed>", "<!DOCTYPE feed><feed xmlns='http://www.w3.org/2005/Atom'/>", '<feed xmlns="https://evil.test"/>'])("refuse une réponse invalide : %s", (xml) => {
    expect(() => parseEbooksGratuitsFeed(xml)).toThrow();
  });
  it("suit une pagination validée sans confondre page OPDS zéro et page de l’application", () => {
    const next = `<link rel="next" href="${origin}/opds/feed.php?mode=search&amp;query=les&amp;page=1"/>`;
    expect(parseEbooksGratuitsFeed(feed(entry(), next), { query: "les", page: 1 }).hasNext).toBe(true);
    expect(parseEbooksGratuitsFeed(feed(entry(), next), { query: "autre", page: 1 }).hasNext).toBe(false);
    expect(parseEbooksGratuitsFeed(feed(entry(), next), { query: "les", page: 2 }).hasNext).toBe(false);
  });
});

describe("recherche et téléchargement ELG", () => {
  it("cherche le titre via le relais, avec la langue française et un délai adapté", async () => {
    vi.stubEnv("VITE_SOURCE_RELAY_URL", "https://relay.test/reader");
    fetch.mockResolvedValue(new Response(feed()));
    expect((await source.search({ query: "Candide", language: "fr", page: 1 })).books).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe("https://relay.test/reader/api/sources/ebooks-gratuits/search?query=Candide&page=1");
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });
  it("ne contacte pas la source sans titre, avec une autre langue ou sans relais sur Pages", async () => {
    expect((await source.search({ query: "", language: "fr" })).books).toEqual([]);
    expect((await source.search({ query: "Candide", language: "en" })).books).toEqual([]);
    vi.stubEnv("MODE", "pages");
    vi.stubEnv("VITE_SOURCE_RELAY_URL", ""); vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "");
    await expect(source.search({ query: "Candide" })).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("télécharge uniquement l’identifiant canonique et refuse une redirection injectée", async () => {
    const book = { id: "ebooks-gratuits-637", downloadUrl: "https://evil.test/payload" };
    fetch.mockResolvedValue(new Response("epub"));
    await source.download(book);
    expect(fetch.mock.calls[0][0]).toBe("/api/books/ebooks-gratuits/637.epub");
    const response = new Response("payload");
    Object.defineProperty(response, "url", { value: "https://evil.test/book.epub" });
    fetch.mockResolvedValue(response);
    await expect(source.download(book)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(source.download({ id: "ebooks-gratuits-../637" })).rejects.toMatchObject({ code: "INVALID_BOOK" });
  });
  it("arrête une recherche lente à 65 secondes et respecte l’annulation immédiate", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })));
    const result = expect(source.search({ query: "Candide" })).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(65_000); await result;
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController(); controller.abort();
    await expect(source.search({ query: "Candide", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("adresse du service de sources", () => {
  it("donne priorité au service général et garde l’ancien réglage Gutenberg", () => {
    expect(configuredSourceRelay({ VITE_SOURCE_RELAY_URL: "https://sources.test/a/", VITE_GUTENBERG_RELAY_URL: "https://old.test" })).toBe("https://sources.test/a");
    expect(configuredSourceRelay({ VITE_GUTENBERG_RELAY_URL: "https://old.test" })).toBe("https://old.test");
    expect(sourceRelayUrl("api/books/ebooks-gratuits/637.epub", { BASE_URL: "/EPUB-FastReader/" })).toBe("/EPUB-FastReader/api/books/ebooks-gratuits/637.epub");
  });
  it.each(["http://host.test", "https://a:b@host.test", "https://host.test/a/../b", "https://host.test?url=evil", "https://host.test/a%2fb", "https://host.test/#x"])("refuse une adresse de relais ambiguë : %s", (url) => {
    expect(configuredSourceRelay({ VITE_SOURCE_RELAY_URL: url })).toBe("");
  });
  it.each(["//evil.test/payload", "api/books/ebooks-gratuits/../private", "api/books/ebooks-gratuits/637.epub#x"])("refuse un chemin injecté : %s", (path) => expect(() => sourceRelayUrl(path)).toThrow());
});
