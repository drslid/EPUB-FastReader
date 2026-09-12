// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import source, { parseEpubbooksSearch, downloadEpubbooksCover } from "../src/sources/epubbooks.js";
import { createEpubbooksHandler, anonymousDownloadCookie } from "../server/epubbooks-source.js";

const ORIGIN = "https://www.epubbooks.com";
const TOKEN = "01234567-89ab-4cde-8fab-0123456789ab";
const BOOK = { id: "epubbooks-22-frankenstein", title: "Frankenstein" };
const emptySearch = '<form role="search"></form><h1>Top Search Results for "absent"</h1><h3>No results found.</h3>';
const entry = (path = "/book/22-frankenstein", title = "Frankenstein", author = "Mary Shelley", image = "/images/covers/shelley-frankenstein_thumb.jpg") => `<li class="media"><a class="media-left" href="${path}"><img src="${image}" /></a><div class="media-body"><h4 class="media-heading"><a href="${path}">${title}</a><span class="small">${author}</span></h4></div></li>`;
const searchHtml = (rows = entry()) => `<html><body><form role="search"></form><h1>Top Search Results for "frankenstein"</h1><ul class="media-list">${rows}</ul></body></html>`;
const detail = (image = "/images/covers/shelley-frankenstein.jpg") => `<img itemprop="image" src="${image}" /><li itemprop="offers"><button data-dlid="1346">Download</button><h4>Kindle</h4></li><li itemprop="offers"><button data-dlid="22">Download</button><h4>EPUB <span>264 KB</span></h4></li>`;
const jpg = new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0]);

async function epubBytes() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>');
  return zip.generateAsync({ type: "uint8array" });
}
function downstream(path, options = {}) { return new Request(`https://relay.example${path}`, { headers: { Origin: "https://drslid.github.io" }, ...options }); }
const bookPath = "/api/books/epubbooks/22-frankenstein.epub";
const coverPath = "/api/sources/epubbooks/cover/22-frankenstein.jpg";
const searchPath = "/api/sources/epubbooks/search?query=frankenstein&page=1";

beforeEach(() => { vi.stubGlobal("DOMParser", new JSDOM().window.DOMParser); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("epubBooks public catalogue", () => {
  it("extracts only book results with their authors, covers, source and stable edition identity", () => {
    const result = parseEpubbooksSearch(searchHtml(entry() + entry("/author/mary-shelley", "Mary Shelley", "1797–1851")));
    expect(result.books).toHaveLength(1);
    expect(result.books[0]).toMatchObject({ ...BOOK, providerId: "epubbooks", canonicalSourceId: "epubbooks:22", author: "Mary Shelley", cover: `${ORIGIN}/images/covers/shelley-frankenstein_thumb.jpg`, sourceUrl: `${ORIGIN}/book/22-frankenstein`, downloadMode: "direct", canExportFocus: false });
    expect(result).toMatchObject({ count: 1, countIsApproximate: true, hasNext: false });
  });
  it("never presents the provider's featured recommendations as matches for an empty search", () => {
    expect(parseEpubbooksSearch(`${emptySearch}<ul class="media-list">${entry()}</ul>`)).toMatchObject({ books: [], count: 0 });
  });
  it("rejects a blocked or changed page instead of fabricating results", () => {
    expect(() => parseEpubbooksSearch("<h1>Login required</h1>")).toThrow();
    expect(() => parseEpubbooksSearch(searchHtml(""))).toThrow();
  });
  it("keeps a long title complete and rejects foreign URLs and duplicate editions", () => {
    const long = "The long title ".repeat(35);
    const result = parseEpubbooksSearch(searchHtml(entry(undefined, long) + entry() + entry("https://evil.example/book/99-evil") + entry("/book/99-other", "Other", "Author", "https://tracker.example/cover.png")));
    expect(result.books).toHaveLength(2);
    expect(result.books[0].title).toBe(long.trim());
    expect(result.books[1].cover).toBeNull();
  });
  it("does not send empty queries, unsupported languages or fake subsequent pages", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const options of [{ query: "" }, { query: "book", language: "fr" }, { query: "book", language: "en", page: 2 }]) expect((await source.search(options)).books).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses only the configured relay and preserves cancellation", async () => {
    vi.stubEnv("MODE", "pages"); vi.stubEnv("VITE_SOURCE_RELAY_URL", "https://relay.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(searchHtml())));
    await source.search({ query: "frankenstein", language: "en" });
    expect(fetch.mock.calls[0][0]).toBe(`https://relay.example${searchPath}`);
    const controller = new AbortController(); controller.abort();
    await expect(source.search({ query: "book", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("requires the relay on static Pages rather than announcing a manual download as success", async () => {
    vi.stubEnv("MODE", "pages"); vi.stubEnv("VITE_SOURCE_RELAY_URL", ""); vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "");
    await expect(source.download(BOOK)).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIGURED" });
  });
});

describe("epubBooks bounded anonymous download relay", () => {
  it("resolves EPUB, keeps only the source's temporary cookie and returns the untouched archive", async () => {
    const original = await epubBytes();
    const upstream = vi.fn().mockResolvedValueOnce(new Response(detail())).mockResolvedValueOnce(new Response(JSON.stringify({ id: TOKEN }), { headers: { "Set-Cookie": "download=anonymous-token==; Path=/; HttpOnly; Secure" } })).mockResolvedValueOnce(new Response(original));
    const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" });
    const response = await handler(downstream(bookPath, { headers: { Origin: "https://drslid.github.io", Cookie: "private-user-session=never-forward" } }));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/book/22-frankenstein`, `${ORIGIN}/downloads`, `${ORIGIN}/downloads/${TOKEN}/file`]);
    expect(upstream.mock.calls[1][1]).toMatchObject({ method: "POST", body: '{"id":22}' });
    expect(upstream.mock.calls[2][1].headers.Cookie).toBe("download=anonymous-token==");
    expect(JSON.stringify(upstream.mock.calls)).not.toContain("private-user-session");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("https://drslid.github.io");
  });
  it("never sends another cookie or accepts a forged token URL", async () => {
    expect(() => anonymousDownloadCookie(new Headers({ "set-cookie": "session=private; Path=/" }))).toThrow();
    const upstream = vi.fn().mockResolvedValueOnce(new Response(detail())).mockResolvedValueOnce(new Response(JSON.stringify({ id: "https://evil.example/file" }), { headers: { "set-cookie": "download=ok; Path=/" } }));
    const response = await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(bookPath));
    expect(response.status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("does not select the Kindle download when no EPUB offer exists", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('<li itemprop="offers"><button data-dlid="1346">Download</button><h4>Kindle</h4></li>'));
    const response = await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(bookPath));
    expect(response.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429])("stops on HTTP %i and observes a cooldown without trying mirrors", async (status) => {
    const upstream = vi.fn().mockResolvedValue(new Response("Denied", { status }));
    const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" });
    expect((await handler(downstream(bookPath))).status).toBe(503);
    expect((await handler(downstream(bookPath))).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("rejects redirects, HTML downloads and invalid archive contents", async () => {
    for (const final of [new Response("<html>Login</html>"), new Response(new Uint8Array([80, 75, 3, 4, 0]))]) {
      const upstream = vi.fn().mockResolvedValueOnce(new Response(detail())).mockResolvedValueOnce(new Response(JSON.stringify({ id: TOKEN }), { headers: { "set-cookie": "download=anonymous; Path=/" } })).mockResolvedValueOnce(final);
      const response = await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(bookPath));
      expect(response.status).toBe(502);
    }
    const upstream = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://evil.example/book" } }));
    expect((await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(bookPath))).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary URLs, duplicate query parameters and unauthorized origins before fetching", async () => {
    const upstream = vi.fn();
    const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" });
    for (const path of ["/api/books/epubbooks/https:evil.epub", "/api/books/epubbooks/22-frankenstein.epub?url=x", `${searchPath}&query=other`, "/api/sources/epubbooks/search?query=book&page=2"]) expect((await handler(downstream(path))).status).toBe(400);
    expect((await handler(downstream(bookPath, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("caches public search HTML without creating download tokens", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(searchHtml()));
    const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" });
    expect((await handler(downstream(searchPath))).status).toBe(200);
    expect((await handler(downstream(searchPath))).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
    expect(upstream.mock.calls[0][0]).toBe(`${ORIGIN}/search?q=frankenstein`);
  });
  it("evicts search HTML by cumulative byte size even when the entry limit is not reached", async () => {
    const html = searchHtml();
    const size = new TextEncoder().encode(html).byteLength;
    const upstream = vi.fn().mockImplementation(async () => new Response(html));
    const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io", cacheMaxBytes: size * 2 - 1, maxCachedSearches: 4 });
    for (const query of ["first", "second", "second", "first"]) expect((await handler(downstream(`/api/sources/epubbooks/search?query=${query}`))).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
  });
  it("never caches a response larger than its total cache budget and supports a disabled cache", async () => {
    for (const cacheMaxBytes of [0, 10]) {
      const upstream = vi.fn().mockImplementation(async () => new Response(searchHtml()));
      const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io", cacheMaxBytes });
      expect((await handler(downstream(searchPath))).status).toBe(200);
      expect((await handler(downstream(searchPath))).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
    }
  });
  it("ends a stalled upstream when the browser cancels", async () => {
    const upstream = vi.fn(() => new Promise(() => {}));
    const controller = new AbortController();
    const handler = createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" });
    const promise = handler(downstream(bookPath, { signal: controller.signal }));
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await assertion;
  });
});

describe("epubBooks catalogue cover preservation", () => {
  it("fetches only the image declared by the selected edition and never the embedded alternative", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(new Response(detail())).mockResolvedValueOnce(new Response(jpg));
    const response = await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(coverPath));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/book/22-frankenstein`, `${ORIGIN}/images/covers/shelley-frankenstein.jpg`]);
  });
  it("rejects a foreign cover URL and SVG disguised as a JPEG", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(new Response(detail("https://evil.example/cover.jpg")));
    expect((await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(coverPath))).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
    const svg = vi.fn().mockResolvedValueOnce(new Response(detail())).mockResolvedValueOnce(new Response("<svg></svg>"));
    expect((await createEpubbooksHandler({ fetchImpl: svg, allowOrigin: "https://drslid.github.io" })(downstream(coverPath))).status).toBe(502);
  });
  it("enforces a 1 MiB cover limit and a four-second optional upstream timeout", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(new Response(detail())).mockResolvedValueOnce(new Response(jpg, { headers: { "content-length": String(1024 * 1024 + 1) } }));
    expect((await createEpubbooksHandler({ fetchImpl: upstream, allowOrigin: "https://drslid.github.io" })(downstream(coverPath))).status).toBe(413);
    vi.useFakeTimers();
    const handler = createEpubbooksHandler({ fetchImpl: vi.fn(() => new Promise(() => {})), allowOrigin: "https://drslid.github.io" });
    const promise = handler(downstream(coverPath));
    await vi.advanceTimersByTimeAsync(4000);
    expect((await promise).status).toBe(504);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns a typed image Blob to the client and refuses an HTML response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(jpg)));
    const image = await downloadEpubbooksCover(BOOK);
    expect(image.type).toBe("image/jpeg");
    expect(fetch.mock.calls[0][0]).toContain(coverPath);
    fetch.mockResolvedValueOnce(new Response("<html>Not an image</html>"));
    await expect(downloadEpubbooksCover(BOOK)).rejects.toMatchObject({ code: "INVALID_COVER" });
  });
});
