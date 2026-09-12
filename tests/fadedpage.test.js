import { afterEach, describe, expect, it, vi } from "vitest";
import source, { parseFadedpageCatalog } from "../src/sources/fadedpage.js";

const row = (extra = {}) => ({ pid: "20260903", title: "Jane: A Story of Jamaica", lang: "en", cover: "books/20260903/cover.jpg", description: "A book to read.", authors: [{ realname: "de Lisser, Herbert G.", type: "author" }], ...extra });
const feed = (rows) => ({ rows, nrows: rows.length });
afterEach(() => vi.unstubAllGlobals());

describe("Faded Page catalogue", () => {
  it("keeps an edition identity, full title, attributed cover and Canada rights", () => {
    const { books } = parseFadedpageCatalog(feed([row()]));
    expect(books).toEqual([expect.objectContaining({
      id: "fadedpage-20260903", canonicalSourceId: "fadedpage:20260903", providerId: "fadedpage",
      title: "Jane: A Story of Jamaica", author: "de Lisser, Herbert G.", language: "en", downloadMode: "direct",
      cover: "https://www.fadedpage.com/books/20260903/cover.jpg", sourceUrl: "https://www.fadedpage.com/showbook.php?pid=20260903",
      rightsUrl: "https://www.fadedpage.com/copyright.php", canExportClassic: false, canExportFocus: false,
    })]);
    expect(books[0].rights).toContain("Canada");
  });
  it("filters duplicate editions, other languages, invalid identifiers and empty titles", () => {
    const result = parseFadedpageCatalog(feed([row(), row(), row({ pid: "20260904", lang: "fr" }), row({ pid: "../../secret" }), row({ pid: "20260905", title: "" })]));
    expect(result.books).toHaveLength(1);
    expect(result.countIsApproximate).toBe(true);
  });
  it("keeps metadata inert, prefers the credited pen name and rejects third-party cover URLs", () => {
    const { books: [book] } = parseFadedpageCatalog(feed([row({ title: "Jane &amp; Susan <script>bad()</script>", description: "<p>Hello <em>reader</em></p><iframe src='https://evil.test'></iframe>", cover: "https://evil.test/tracker.jpg", authors: [{ type: "illustrator", realname: "Someone Else" }, { type: "author", realname: "Real Name", pseudoname: "Pen Name" }] })]));
    expect(book).toMatchObject({ title: "Jane & Susan", description: "Hello reader", author: "Pen Name", cover: null });
  });
  it.each(["/books/20260904/cover.jpg", "/books/20260903/cover.svg", "https://user:pass@www.fadedpage.com/books/20260903/cover.jpg", "/books/20260903/cover.jpg?track=1"])("rejects unrelated/active covers: %s", (cover) => {
    expect(parseFadedpageCatalog(feed([row({ cover })])).books[0].cover).toBeNull();
  });
  it("paginates the bounded provider result set without inventing inaccessible next pages", () => {
    const rows = Array.from({ length: 30 }, (_, index) => row({ pid: String(20260000 + index), title: `Edition ${index}` }));
    expect(parseFadedpageCatalog({ rows, nrows: 200 }, { page: 1 })).toMatchObject({ count: 30, hasNext: true, countIsApproximate: true });
    const page = parseFadedpageCatalog({ rows, nrows: 200 }, { page: 2 });
    expect(page.books).toHaveLength(6);
    expect(page.hasNext).toBe(false);
  });
  it.each([null, {}, { rows: [], nrows: "1" }, { rows: [row()], nrows: 0 }])("rejects malformed catalogues", (value) => {
    expect(() => parseFadedpageCatalog(value)).toThrow();
  });
  it("makes no remote query for empty searches or unsupported languages", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await source.search({ query: "", language: "en" })).books).toEqual([]);
    expect((await source.search({ query: "Jane", language: "fr" })).books).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("only downloads from the relay constructed from a validated provider identifier", async () => {
    const fetch = vi.fn(async () => new Response("epub", { headers: { "Content-Type": "application/epub+zip" } }));
    vi.stubGlobal("fetch", fetch);
    await source.download({ id: "fadedpage-20260903", sourceUrl: "https://evil.test/" });
    expect(fetch).toHaveBeenCalledWith("/api/books/fadedpage/20260903.epub", expect.objectContaining({ credentials: "omit" }));
    await expect(source.download({ id: "fadedpage-../../secret" })).rejects.toMatchObject({ code: "INVALID_BOOK" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
