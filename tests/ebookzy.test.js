import { afterEach, describe, expect, it, vi } from "vitest";
import source, { parseEbookzySearch, downloadEbookzyCover } from "../src/sources/ebookzy.js";
const row = ({ slug = "macbeth", title = "Macbeth", image = "/wp-content/uploads/2025/10/macbeth.png", author = "William Shakespeare", href = `/${slug}/` } = {}) => `<article class="bloglo-article"><div class="entry-media"><img src="${image}"></div><h4 class="entry-title"><a href="${href}">${title}</a></h4><div class="cat-links"><a href="/author/william-shakespeare/">${author}</a></div></article>`;
const html = (body = row(), next = "") => `<h1 class="page-title">Search results for: Shakespeare</h1><main id="content">${body}</main><nav class="pagination">${next ? `<a class="next" href="${next}">Next</a>` : ""}</nav>`;
afterEach(() => vi.unstubAllGlobals());
describe("Ebookzy public catalogue", () => {
  it("keeps full title, author, source identity, cover and the original edition", () => {
    const book = parseEbookzySearch(html(row({ title: "Macbeth &amp; the Scottish play" }))).books[0];
    expect(book).toMatchObject({ id: "ebookzy-macbeth", title: "Macbeth & the Scottish play", author: "William Shakespeare", canonicalSourceId: "ebookzy:macbeth", language: "en", source: "Ebookzy", sourceUrl: "https://ebookzy.com/macbeth/", cover: "https://ebookzy.com/wp-content/uploads/2025/10/macbeth.png", downloadMode: "direct", canExportClassic: false });
  });
  it("uses only the next page actually advertised for the same search", () => {
    const result = parseEbookzySearch(html(row(), "/page/2/?s=Shakespeare"), { query: "Shakespeare" });
    expect(result).toMatchObject({ hasNext: true, countIsApproximate: true });
    for (const next of ["https://evil.test/page/2/?s=Shakespeare", "/page/3/?s=Shakespeare", "/page/2/?s=Other"]) expect(parseEbookzySearch(html(row(), next), { query: "Shakespeare" }).hasNext).toBe(false);
  });
  it("recognizes empty searches without showing unrelated recommendations", () => {
    expect(parseEbookzySearch(html('<section class="no-results">Nothing found</section>')).books).toEqual([]);
    expect(() => parseEbookzySearch("<html>Access denied</html>")).toThrow();
  });
  it("filters duplicate, unsafe and incomplete entries", () => {
    expect(parseEbookzySearch(html(row() + row() + row({ href: "https://evil.test/book/" }) + row({ href: "/macbeth/?track=1" }) + row({ author: "" }))).books).toHaveLength(1);
    expect(parseEbookzySearch(html(row({ image: "https://evil.test/cover.png" }))).books[0].cover).toBeNull();
    expect(parseEbookzySearch(html(row({ image: "/wp-content/uploads/2025/10/script.svg" }))).books[0].cover).toBeNull();
  });
  it("does not contact a source for empty, unsupported or invalid searches", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await source.search({ query: "", language: "en" })).books).toEqual([]);
    expect((await source.search({ query: "Macbeth", language: "fr" })).books).toEqual([]);
    await expect(source.search({ query: "Macbeth", page: 0 })).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("constructs relay routes from validated identifiers, never a result's supplied URL", async () => {
    const fetch = vi.fn(async () => new Response("epub")); vi.stubGlobal("fetch", fetch);
    await source.download({ id: "ebookzy-macbeth", sourceUrl: "https://evil.test/" });
    expect(fetch).toHaveBeenCalledWith("/api/books/ebookzy/macbeth.epub", expect.objectContaining({ credentials: "omit" }));
    for (const id of ["ebookzy-../../private", "ebookzy-x?url=bad", "other-macbeth"]) await expect(source.download({ id })).rejects.toMatchObject({ code: "INVALID_BOOK" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("validates a catalogue cover's binary signature before preserving it offline", async () => {
    const fetch = vi.fn(async () => new Response(Uint8Array.from([137,80,78,71,13,10,26,10]))); vi.stubGlobal("fetch", fetch);
    expect((await downloadEbookzyCover({ id: "ebookzy-macbeth" })).type).toBe("image/png");
    expect(fetch.mock.calls[0][0]).toBe("/api/sources/ebookzy/cover/macbeth.png");
    fetch.mockResolvedValueOnce(new Response("<html>blocked</html>"));
    await expect(downloadEbookzyCover({ id: "ebookzy-macbeth" })).rejects.toMatchObject({ code: "INVALID_COVER" });
  });
});
