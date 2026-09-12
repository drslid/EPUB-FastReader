// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createEbookzyHandler, ebookzyDownloadPath, ebookzyCoverPath } from "../server/ebookzy-source.js";
const ORIGIN = "https://ebookzy.com";
const SEARCH = "/api/sources/ebookzy/search?query=Shakespeare&page=1";
const BOOK = "/api/books/ebookzy/macbeth.epub";
const request = (path, options) => new Request(`https://relay.test${path}`, options);
const searchHtml = '<h1>Search results for: Shakespeare</h1><main id="content"><input name="s"><article>Macbeth</article></main>';
const detail = '<meta property="og:image" content="https://ebookzy.com/logo.png"><img src="/wp-content/uploads/2025/10/macbeth.png" class="attachment-full wp-post-image"><a href="/free-ebooks/epub3-macbeth.epub">EPUB3</a><a href="/free-ebooks/epub-macbeth.epub">EPUB</a>';
const png = Uint8Array.from([137,80,78,71,13,10,26,10]);
async function epub() { const zip = new JSZip(); zip.file("mimetype", "application/epub+zip"); zip.file("META-INF/container.xml", "<container/>"); return zip.generateAsync({ type: "uint8array" }); }
describe("Ebookzy relay", () => {
  it("searches public pages and caches only completed, bounded responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(searchHtml));
    const handler = createEbookzyHandler({ fetchImpl, cacheMaxBytes: searchHtml.length * 2, maxCachedSearches: 2 });
    expect((await handler(request(SEARCH))).status).toBe(200);
    expect((await handler(request(SEARCH))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${ORIGIN}/?s=Shakespeare`);
    await handler(request(SEARCH.replace("page=1", "page=2")));
    expect(fetchImpl.mock.calls[1][0]).toBe(`${ORIGIN}/page/2/?s=Shakespeare`);
    await handler(request(SEARCH.replace("Shakespeare", "Macbeth")));
    await handler(request(SEARCH));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("uses the advertised EPUB, preserves its bytes and sends no reader cookies", async () => {
    const bytes = await epub();
    const fetchImpl = vi.fn(async (url) => url.endsWith(".epub") ? new Response(bytes, { headers: { "Content-Type": "application/epub+zip" } }) : new Response(detail));
    const response = await createEbookzyHandler({ fetchImpl })(request(BOOK, { headers: { Cookie: "private=yes", Authorization: "secret" } }));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/macbeth/`, `${ORIGIN}/free-ebooks/epub-macbeth.epub`]);
    for (const [, options] of fetchImpl.mock.calls) { expect(options.credentials).toBe("omit"); expect(options.redirect).toBe("manual"); expect(options.headers.Cookie).toBeUndefined(); expect(options.headers.Authorization).toBeUndefined(); }
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["https://evil.test/book.epub", "//evil.test/book.epub", "/free-ebooks/book.epub?url=bad", "/free-ebooks/book.epub#x", "/private/book.epub", "https://u:p@ebookzy.com/free-ebooks/book.epub", "/free-ebooks/../../private.epub"])("does not request unapproved EPUB links: %s", (url) => {
    expect(() => ebookzyDownloadPath(`<a href="${url}">EPUB</a>`)).toThrow();
  });
  it("prefers EPUB over EPUB3 and excludes Amazon and PDF links", () => {
    expect(ebookzyDownloadPath(detail)).toBe("/free-ebooks/epub-macbeth.epub");
    expect(ebookzyDownloadPath('<a href="/free-ebooks/book.epub">EPUB3</a>')).toBe("/free-ebooks/book.epub");
    expect(() => ebookzyDownloadPath('<a href="https://amazon.test/book">Buy</a><a href="/free-ebooks/book.pdf">PDF</a>')).toThrow();
  });
  it.each(["/api/books/ebookzy/../../secret.epub", "/api/books/ebookzy/macbeth.epub?url=https://evil.test", "/api/books/ebookzy/Macbeth.epub", "/api/sources/ebookzy/search?query=", "/api/sources/ebookzy/search?query=a&query=b", "/api/sources/ebookzy/search?query=a&page=101", "/api/sources/ebookzy/search?query=a&cookie=x"])("rejects bad inputs before any upstream call: %s", async (path) => {
    const fetchImpl = vi.fn();
    const response = await createEbookzyHandler({ fetchImpl })(request(path));
    expect(response?.status || 404).toBeGreaterThanOrEqual(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("stops on redirects and explicit denials without alternate paths or retries", async () => {
    for (const status of [301, 302, 403, 401, 429]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status, headers: { Location: "https://evil.test", "Retry-After": "600" } }));
      const handler = createEbookzyHandler({ fetchImpl });
      expect((await handler(request(BOOK))).status).toBeGreaterThanOrEqual(400);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      if ([401,403,429].includes(status)) { expect((await handler(request(SEARCH))).status).toBe(503); expect(fetchImpl).toHaveBeenCalledTimes(1); }
    }
  });
  it("rejects HTML, invalid ZIPs, oversized EPUBs and oversized catalogues", async () => {
    for (const response of [new Response("<html>blocked</html>", { headers: { "Content-Type": "text/html" } }), new Response("bad zip", { headers: { "Content-Type": "application/epub+zip" } }), new Response("x", { headers: { "Content-Type": "application/epub+zip", "Content-Length": "31457281" } })]) {
      const fetchImpl = vi.fn(async (url) => url.endsWith(".epub") ? response : new Response(detail));
      expect((await createEbookzyHandler({ fetchImpl })(request(BOOK))).status).toBeGreaterThanOrEqual(400);
    }
    const response = await createEbookzyHandler({ maxCatalogBytes: 20, fetchImpl: async () => new Response(searchHtml) })(request(SEARCH));
    expect(response.status).toBe(413);
  });
  it("allows exactly the configured origin and preflights only public GET", async () => {
    const fetchImpl = vi.fn(async () => new Response(searchHtml));
    const handler = createEbookzyHandler({ fetchImpl, allowOrigin: "https://drslid.github.io" });
    const response = await handler(request(SEARCH, { headers: { Origin: "https://drslid.github.io" } }));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://drslid.github.io");
    expect((await handler(request(SEARCH, { headers: { Origin: "https://evil.test" } }))).status).toBe(403);
    expect((await handler(request(SEARCH, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "accept" } }))).status).toBe(204);
    expect((await handler(request(SEARCH, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "POST" } }))).status).toBe(403);
  });
  it("keeps simultaneous identical searches independent when one reader cancels", async () => {
    const pending = [];
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((resolve, reject) => { pending.push(resolve); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }));
    const handler = createEbookzyHandler({ fetchImpl });
    const controller = new AbortController();
    const first = handler(request(SEARCH, { signal: controller.signal })).catch(error => error.name);
    const second = handler(request(SEARCH));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect((await handler(request(SEARCH.replace("Shakespeare", "Hamlet")))).status).toBe(429);
    controller.abort();
    pending[1](new Response(searchHtml));
    expect(await first).toBe("AbortError");
    expect((await second).status).toBe(200);
  });
  it("times out an unresponsive source and frees its slot", async () => {
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(new Response(searchHtml));
    const handler = createEbookzyHandler({ fetchImpl, timeoutMs: 10 });
    expect((await handler(request(SEARCH))).status).toBe(504);
    expect((await handler(request(SEARCH))).status).toBe(200);
  });
  it("preserves the real cover rather than the site logo and rejects active images", async () => {
    expect(ebookzyCoverPath(detail)).toBe("/wp-content/uploads/2025/10/macbeth.png");
    expect(() => ebookzyCoverPath('<img class="wp-post-image" src="https://evil.test/image.png">')).toThrow();
    const fetchImpl = vi.fn(async (url) => url.endsWith(".png") ? new Response(png) : new Response(detail));
    const response = await createEbookzyHandler({ fetchImpl })(request("/api/sources/ebookzy/cover/macbeth.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    fetchImpl.mockImplementation(async url => url.endsWith(".png") ? new Response("<svg/>") : new Response(detail));
    expect((await createEbookzyHandler({ fetchImpl })(request("/api/sources/ebookzy/cover/macbeth.png"))).status).toBe(502);
  });
});
