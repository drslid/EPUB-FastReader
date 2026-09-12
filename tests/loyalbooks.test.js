// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import source, { parseLoyalbooksCatalog, downloadLoyalbooksCover } from "../src/sources/loyalbooks.js";
import { createLoyalbooksHandler, parseLoyalbooksDetail } from "../server/loyalbooks-source.js";

const ORIGIN = "https://www.loyalbooks.com";
const origin = "https://drslid.github.io";
const path = "/api/books/loyalbooks/emma-by-jane-austen.epub";
const coverPath = "/api/sources/loyalbooks/cover/emma-by-jane-austen.jpg";
const book = { id: "loyalbooks-emma-by-jane-austen" };
const image = new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0]);
const detail = (epub = "/download/epub/Emma-by-Jane-Austen.epub", cover = "/image/detail/Emma-Jane-Austen.jpg") => `<html><h1>Emma</h1><img src="${cover}" alt="Emma"><div>eBook Downloads</div><a href="${epub}"><img src="/image/epub.png">ePUB eBook</a><a href="/download/mobi/Emma.mobi">Kindle</a></html>`;
const responseHtml = (html = detail()) => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const request = (target = path, options = {}) => new Request(`https://relay.example${target}`, { headers: { Origin: origin }, ...options });
const snapshot = (books = [{ slug: "emma-by-jane-austen", title: "Emma", author: "Jane Austen", language: "en", cover: `${ORIGIN}/image/layout2/Emma-Jane-Austen.jpg` }]) => ({ version: 1, updatedAt: "2026-09-12T12:00:00.000Z", coverage: "selection", languages: { en: { indexed: books.length, total: 26108, pages: 1, complete: false } }, books });
async function epub() { const zip = new JSZip(); zip.file("mimetype", "application/epub+zip"); zip.file("META-INF/container.xml", "<container/>"); return zip.generateAsync({ type: "uint8array" }); }

beforeEach(() => { vi.stubEnv("MODE", "pages"); vi.stubEnv("VITE_SOURCE_RELAY_URL", "https://relay.example"); vi.stubEnv("BASE_URL", "/EPUB-FastReader/"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Loyal Books local search", () => {
  it("validates the index and exposes its dated, partial coverage", () => {
    expect(parseLoyalbooksCatalog(snapshot())).toMatchObject({ coverage: "selection", languages: { en: { indexed: 1, total: 26108, complete: false } } });
  });
  it("rejects invalid counts, duplicate editions and dishonest complete coverage", () => {
    for (const value of [{ ...snapshot(), coverage: "complete" }, { ...snapshot(), updatedAt: "bad" }, snapshot([snapshot().books[0], snapshot().books[0]]), { ...snapshot(), languages: { en: { indexed: 100, total: 26108, pages: 1, complete: false } } }]) expect(() => parseLoyalbooksCatalog(value)).toThrow();
  });
  it("retains complete long titles and Unicode slugs but strips foreign cover URLs", () => {
    const entry = { ...snapshot().books[0], slug: "Contes-Français", title: "Le titre complet ".repeat(80).trim(), cover: "https://evil.example/cover.jpg" };
    expect(parseLoyalbooksCatalog(snapshot([entry])).books[0]).toEqual({ ...entry, cover: null });
  });
  it("searches title and author in local metadata, paginates and never contacts Google or Loyal Books", async () => {
    const books = Array.from({ length: 27 }, (_, i) => ({ ...snapshot().books[0], slug: `edition-${i}`, title: `Édition ${i}` }));
    const fetch = vi.fn(async () => new Response(JSON.stringify(snapshot(books)))); vi.stubGlobal("fetch", fetch);
    const first = await source.search({ query: "edition Austen", language: "en", page: 1 });
    expect(first).toMatchObject({ count: 27, hasNext: true, catalogCoverage: { kind: "selection" } });
    expect(first.books).toHaveLength(24);
    expect((await source.search({ query: "edition", language: "en", page: 2 })).books).toHaveLength(3);
    expect((await source.search({ query: "absent", language: "en", page: 1 })).count).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/EPUB-FastReader/catalog/loyalbooks.json");
  });
  it("keeps unsupported-language and aborted searches offline", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await source.search({ language: "zz" })).books).toEqual([]);
    const controller = new AbortController(); controller.abort();
    await expect(source.search({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ignores caller-provided download URLs and encodes non-ASCII edition names", async () => {
    const bytes = await epub(); const fetch = vi.fn(async () => new Response(bytes)); vi.stubGlobal("fetch", fetch);
    await source.download({ id: "loyalbooks-Contes-Français", downloadUrl: "https://evil.example/book.epub" });
    expect(fetch.mock.calls[0][0]).toBe("https://relay.example/api/books/loyalbooks/Contes-Fran%C3%A7ais.epub");
    await expect(source.download({ id: "loyalbooks-../etc/passwd" })).rejects.toMatchObject({ code: "INVALID_BOOK" });
  });
  it("requires a configured relay for EPUBs on Pages", async () => {
    vi.stubEnv("VITE_SOURCE_RELAY_URL", ""); vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "");
    await expect(source.download(book)).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIGURED" });
  });
});

describe("Loyal Books direct EPUB relay", () => {
  it("resolves the advertised EPUB, validates the archive and never forwards browser cookies", async () => {
    const bytes = await epub();
    const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(new Response(bytes));
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    const result = await handler(request(path, { headers: { Origin: origin, Cookie: "private=never-forward" } }));
    expect(result.status).toBe(200); expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/book/emma-by-jane-austen`, `${ORIGIN}/download/epub/Emma-by-Jane-Austen.epub`]);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("private");
    expect(result.headers.get("access-control-allow-origin")).toBe(origin);
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("does not select audio, Kindle or foreign URLs", () => {
    expect(parseLoyalbooksDetail('<a href="https://evil.example/download/epub/book.epub">ePUB</a><a href="/download/mobi/book.mobi">Kindle</a>')).toEqual({ epub: null, cover: null });
    expect(parseLoyalbooksDetail(detail("/download/epub/..%2F..%2Fsecret.epub", "https://evil.example/image/detail/cover.jpg"))).toEqual({ epub: null, cover: null });
  });
  it("does not turn a missing EPUB or challenge HTML into a downloadable book", async () => {
    const fetch = vi.fn(async () => responseHtml('<h1>Verification required</h1>'));
    const result = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request());
    expect(result.status).toBe(404); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429])("honors upstream HTTP %i without retries or alternate domains", async (status) => {
    const fetch = vi.fn(async () => new Response("Denied", { status, headers: { "Retry-After": "120" } }));
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    expect((await handler(request())).status).toBe(503);
    const again = await handler(request());
    expect(again.status).toBe(503); expect(again.headers.get("retry-after")).toBe("120"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects redirects and malformed EPUB files", async () => {
    for (const response of [new Response(null, { status: 302, headers: { Location: "https://evil.example/book" } }), new Response("<html>Login</html>")]) {
      const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(response);
      expect((await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request())).status).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });
  it("rejects a forged tiny mimetype before inflating a multi-megabyte member", async () => {
    const zip = new JSZip();
    zip.file("mimetype", new Uint8Array(4 * 1024 * 1024));
    zip.file("META-INF/container.xml", "<container/>");
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Central-directory metadata controls the size exposed by JSZip. Lie about
    // uncompressed size while preserving the actual four-MiB compressed member.
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50 && new TextDecoder().decode(bytes.subarray(offset + 46, offset + 54)) === "mimetype") { view.setUint32(offset + 24, 50, true); break; }
    }
    const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(new Response(bytes));
    const result = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request());
    expect(result.status).toBe(502); expect(await result.json()).toMatchObject({ error: { code: "INVALID_EPUB" } });
  });
  it("enforces origin, method, path and preflight restrictions before contacting the source", async () => {
    const fetch = vi.fn(); const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    for (const target of [`${path}?url=https://evil.example/`, "/api/books/loyalbooks/%2Fetc.epub", "/api/books/loyalbooks/%ZZ.epub"]) expect((await handler(request(target))).status).toBe(400);
    expect((await handler(request(path, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
    expect((await handler(request(path, { method: "POST" }))).status).toBe(405);
    expect((await handler(request(path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Accept" } }))).status).toBe(204);
    expect((await handler(request(path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Cookie" } }))).status).toBe(403);
    expect(await handler(request("/unrelated"))).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it("limits streamed and declared archive size", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(new Response("too large", { headers: { "Content-Length": "99999" } }));
    expect((await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin, maxBookBytes: 5 })(request())).status).toBe(413);
    const stream = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(new Response("too large"));
    expect((await createLoyalbooksHandler({ fetchImpl: stream, allowOrigin: origin, maxBookBytes: 5 })(request())).status).toBe(413);
  });
  it("cancels stalled requests and releases the single EPUB slot", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(() => new Promise(() => {})); const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    const first = handler(request(path, { signal: controller.signal }));
    const rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect((await handler(request())).status).toBe(429);
    controller.abort(); await rejection;
    fetch.mockResolvedValue(responseHtml("<h1>Gone</h1>"));
    expect((await handler(request())).status).toBe(404);
  });
  it("preserves a valid real-world EPUB fixture without changing its bytes", async () => {
    // Existing project fixture; no source network access in the test suite.
    const bytes = await readFile(new URL("../public/books/candide.epub", import.meta.url));
    const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(new Response(bytes));
    const response = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request());
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});

describe("Loyal Books optional catalogue covers", () => {
  it("preserves only the edition's real JPEG and caches small metadata rather than book data", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(new Response(image)).mockResolvedValueOnce(new Response(image));
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    expect((await handler(request(coverPath))).headers.get("content-type")).toBe("image/jpeg");
    expect((await handler(request(coverPath))).status).toBe(200);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/book/emma-by-jane-austen`, `${ORIGIN}/image/detail/Emma-Jane-Austen.jpg`, `${ORIGIN}/image/detail/Emma-Jane-Austen.jpg`]);
  });
  it("rejects SVG or oversized data masquerading as a cover", async () => {
    for (const response of [new Response("<svg></svg>"), new Response(image, { headers: { "Content-Length": "1048577" } })]) {
      const fetch = vi.fn().mockResolvedValueOnce(responseHtml()).mockResolvedValueOnce(response);
      expect((await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request(coverPath))).status).toBe(response.headers.has("Content-Length") ? 413 : 502);
    }
  });
  it("ends an optional cover request after four seconds", async () => {
    vi.useFakeTimers();
    const handler = createLoyalbooksHandler({ fetchImpl: vi.fn(() => new Promise(() => {})), allowOrigin: origin });
    const promise = handler(request(coverPath)); await vi.advanceTimersByTimeAsync(4000);
    expect((await promise).status).toBe(504);
  });
  it("returns a correctly typed client Blob with a bounded relay request", async () => {
    const fetch = vi.fn(async () => new Response(image)); vi.stubGlobal("fetch", fetch);
    expect((await downloadLoyalbooksCover(book)).type).toBe("image/jpeg");
    expect(fetch.mock.calls[0][0]).toBe(`https://relay.example${coverPath}`);
  });
});
