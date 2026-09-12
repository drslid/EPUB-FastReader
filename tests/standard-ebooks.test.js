// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import source, { parseStandardEbooksSearch } from "../src/sources/standard-ebooks.js";

const ORIGIN = "https://standardebooks.org";
const SLUG = "jane-austen/pride-and-prejudice";
const DETAIL = `${ORIGIN}/ebooks/${SLUG}`;
const DOWNLOAD = `${DETAIL}/downloads/jane-austen_pride-and-prejudice.epub`;
const book = { id: "standardebooks-jane-austen_pride-and-prejudice" };
const xhtml = (body, head = "") => `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`;
const item = ({ slug = SLUG, title = "Pride and Prejudice", author = "Jane Austen", cover = "/images/covers/jane-austen_pride-and-prejudice/495dd49502f1fd5609a27a16f5af2f0a387accb4/cover@2x.jpg" } = {}) => `<li typeof="schema:Book" about="/ebooks/${slug}"><p><a href="/ebooks/${slug}"><span property="schema:name">${title}</span></a></p><p class="author"><span property="schema:name">${author}</span></p><img property="schema:image" src="${cover}" /></li>`;
const searchPage = (items = item(), next = false) => xhtml(`<main class="ebooks"><form role="search"></form>${items ? `<ol class="ebooks-list">${items}</ol>` : '<p class="no-results">No ebooks matched your filters.</p>'}${next ? '<nav class="pagination"><a href="/ebooks?page=2" rel="next">Next</a></nav>' : ""}</main>`);
const detailPage = (href = DOWNLOAD) => xhtml(`<main><a href="${href}">Compatible epub</a><a href="${DOWNLOAD.replace('.epub', '.kepub.epub')}">Kobo epub</a></main>`);
const response = (body, url) => {
  const result = new Response(body);
  Object.defineProperty(result, "url", { value: url });
  return result;
};
const epub = () => new Uint8Array([0x50, 0x4b, 3, 4, 5]);

beforeEach(() => {
  vi.stubGlobal("DOMParser", new JSDOM().window.DOMParser);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("Standard Ebooks public search", () => {
  it("keeps full titles, author, illustrated cover and edition identity", () => {
    const title = "A very long edition title ".repeat(18);
    const result = parseStandardEbooksSearch(searchPage(item({ title })));
    expect(result.books[0]).toMatchObject({
      ...book, title: title.trim(), author: "Jane Austen", language: "en",
      providerId: "standard-ebooks", canonicalSourceId: `standardebooks:${SLUG}`,
      source: "Standard Ebooks", sourceUrl: DETAIL, rightsUrl: DETAIL,
      downloadMode: "direct", downloadUrl: DOWNLOAD,
      cover: expect.stringMatching(/^https:\/\/standardebooks\.org\/images\/covers\//u),
    });
    expect(result).toMatchObject({ count: 1, countIsApproximate: false, hasNext: false });
  });

  it("uses the official public keyword search and pagination without account or OPDS", async () => {
    fetch.mockImplementation((url) => Promise.resolve(response(searchPage(item(), true), url)));
    const result = await source.search({ query: "austen & pride", page: 2, language: "en" });
    const [value, options] = fetch.mock.calls[0];
    const url = new URL(value);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/ebooks`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: "austen & pride", "per-page": "24", page: "2" });
    expect(options).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    expect(result).toMatchObject({ hasNext: true, countIsApproximate: true, count: 26 });
  });

  it("does not contact the English catalogue for French-only searches", async () => {
    expect(await source.search({ query: "Candide", language: "fr" })).toMatchObject({ books: [], count: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a genuine empty search but rejects a changed or blocked HTML page", () => {
    expect(parseStandardEbooksSearch(searchPage(""))).toMatchObject({ books: [], count: 0 });
    expect(() => parseStandardEbooksSearch(xhtml("<main>Access denied</main>"))).toThrow();
    expect(() => parseStandardEbooksSearch("<html><invalid>")).toThrow();
  });

  it("discards duplicates, malformed editions and foreign cover URLs", () => {
    const result = parseStandardEbooksSearch(searchPage(item() + item() + item({ slug: "../../honeypot" }) + item({ slug: "jane-austen/emma", cover: "https://tracker.invalid/image.jpg" })));
    expect(result.books).toHaveLength(2);
    expect(result.books[1].cover).toBeNull();
  });

  it("does not execute remote markup", () => {
    const result = parseStandardEbooksSearch(searchPage(item({ title: 'Pride<script>globalThis.compromised = true</script>' })));
    expect(globalThis.compromised).toBeUndefined();
    expect(result.books[0].title).not.toContain("<script>");
  });

  it("honours cancellation before requesting a source", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(source.search({ language: "en", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Standard Ebooks compatible EPUB download", () => {
  it("downloads the public EPUB by resolving the official detail page", async () => {
    fetch.mockResolvedValueOnce(response(detailPage(), DETAIL));
    fetch.mockResolvedValueOnce(response(epub(), DOWNLOAD));
    const blob = await source.download({ ...book, downloadUrl: "https://evil.invalid/private" });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(epub());
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([DETAIL, DOWNLOAD]);
  });

  it("follows the official donation-page meta refresh to the same EPUB exactly once", async () => {
    fetch.mockResolvedValueOnce(response(detailPage(), DETAIL));
    fetch.mockResolvedValueOnce(response(xhtml("<p>Your Download Has Started!</p>", `<meta http-equiv="refresh" content="0; url=${DOWNLOAD}?source=download" />`), DOWNLOAD));
    fetch.mockResolvedValueOnce(response(epub(), `${DOWNLOAD}?source=download`));
    const blob = await source.download(book);
    expect(blob.size).toBe(5);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([DETAIL, DOWNLOAD, `${DOWNLOAD}?source=download`]);
  });

  it("rejects foreign meta refresh targets without requesting them", async () => {
    fetch.mockResolvedValueOnce(response(detailPage(), DETAIL));
    fetch.mockResolvedValueOnce(response(xhtml("<p>Other</p>", '<meta http-equiv="refresh" content="0; url=https://evil.invalid/epub?source=download" />'), DOWNLOAD));
    await expect(source.download(book)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never imports a login page or a changed response as an EPUB", async () => {
    fetch.mockResolvedValueOnce(response(detailPage(), DETAIL));
    fetch.mockResolvedValueOnce(response(xhtml("<main>Please log in</main>"), DOWNLOAD));
    await expect(source.download(book)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects invalid IDs without fetching any caller-controlled URL", async () => {
    for (const id of ["standardebooks-../../honeypot", "standardebooks-jane-austen", "gutenberg-1342", "standardebooks-jane-austen_pride?source=other"]) {
      await expect(source.download({ id, downloadUrl: "https://evil.invalid" })).rejects.toMatchObject({ code: "INVALID_BOOK" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not download an EPUB link outside the selected edition", async () => {
    fetch.mockResolvedValueOnce(response(detailPage("https://evil.invalid/book.epub"), DETAIL));
    await expect(source.download(book)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops at an HTTP refusal without trying an alternate endpoint", async () => {
    fetch.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(source.download(book)).rejects.toMatchObject({ code: "HTTP" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
