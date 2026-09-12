import { afterEach, describe, expect, it, vi } from "vitest";
import source, { parseAtramentaSearch } from "../src/sources/atramenta.js";

const row = ({ id = "15038", slug = "un-coeur-simple", title = "Un c&#339;ur simple", author = "Gustave Flaubert", downloadable = true, cover = `/images/work_covers/${id}big.jpg?1414745489` } = {}) => `<div class="lo_lecture_libre"><div class="lo_basic_info"><h4 class="lo_titre"><a href="/lire/${slug}/${id}">${title}</a></h4><p class="lo_auteur">Par <a>${author}</a></p><div class="lo_short_summary">Une œuvre <em>complète</em>. <a>lire la suite</a><script>bad()</script></div></div><p class="lo_cover"><img src="${cover}"></p>${downloadable ? `<li class="ro_free_ebook"><a href="/lire/${slug}/${id}#telecharger">Télécharger</a></li>` : ""}</div>`;
const page = (content = row()) => `<html><form action="/search/"></form><main id="main_content_wrapper"><div class="liste_oeuvres">${content}</div></main></html>`;
afterEach(() => vi.unstubAllGlobals());

describe("Atramenta free-reading catalogue", () => {
  it("keeps complete decoded titles, author, source, rights and a matching cover", () => {
    const result = parseAtramentaSearch(page());
    expect(result).toMatchObject({ count: 1, hasNext: false, countIsApproximate: true });
    expect(result.books[0]).toMatchObject({ id: "atramenta-15038-un-coeur-simple", canonicalSourceId: "atramenta:15038", providerId: "atramenta", downloadMode: "direct", language: "fr", title: "Un cœur simple", author: "Gustave Flaubert", description: "Une œuvre complète.", cover: "https://www.atramenta.net/images/work_covers/15038big.jpg?1414745489", sourceUrl: "https://www.atramenta.net/lire/un-coeur-simple/15038", rightsUrl: "https://www.atramenta.net/help/licences", canExportClassic: false });
  });
  it("excludes paid storefront entries, non-downloadable works and duplicate editions", () => {
    const html = page(row() + row() + row({ id: "12", downloadable: false })) + '<section class="iconified-books"><a href="/ebooks/paid-edition/5">Buy EPUB</a></section>';
    expect(parseAtramentaSearch(html).books).toHaveLength(1);
  });
  it.each(["https://evil.test/cover.jpg", "/images/work_covers/9big.jpg", "/images/work_covers/15038big.jpg?track=secret", "/images/work_covers/15038big.svg"])("does not admit unexpected image URLs: %s", (cover) => {
    expect(parseAtramentaSearch(page(row({ cover }))).books[0].cover).toBeNull();
  });
  it("does not turn external or malformed edition links into EPUB download requests", () => {
    expect(parseAtramentaSearch(page(row({ slug: "../../secret" }) + row({ id: "0" }) + row({ author: "" }))).books).toEqual([]);
    expect(parseAtramentaSearch(page().replaceAll('/lire/', 'https://evil.test/lire/')).books).toEqual([]);
  });
  it.each(["<html>Access denied</html>", "<!ENTITY malicious SYSTEM 'file:///etc/passwd'>", ""])("rejects non-catalogue documents", (html) => {
    expect(() => parseAtramentaSearch(html)).toThrow();
  });
  it("does not search an unsupported language, empty query or invented second page", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await source.search({ query: "" })).books).toEqual([]);
    expect((await source.search({ query: "Germinal", language: "en" })).books).toEqual([]);
    expect((await source.search({ query: "Germinal", page: 2 })).books).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("builds the relay address only from the validated edition identity", async () => {
    const fetch = vi.fn(async () => new Response("EPUB")); vi.stubGlobal("fetch", fetch);
    await source.download({ id: "atramenta-15038-un-coeur-simple", sourceUrl: "https://evil.test/private" });
    expect(fetch.mock.calls[0][0]).toBe("/api/books/atramenta/15038-un-coeur-simple.epub");
    await expect(source.download({ id: "atramenta-15038-../../secret" })).rejects.toMatchObject({ code: "INVALID_BOOK" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
