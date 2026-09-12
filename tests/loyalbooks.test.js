// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import source, { resolveLoyalbooksBook, downloadLoyalbooksCover } from "../src/sources/loyalbooks.js";
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
const resolvedBook = (slug = "emma-by-jane-austen", extra = {}) => ({
  id: `loyalbooks-${slug}`, canonicalSourceId: `loyalbooks:${slug}`, providerId: "loyalbooks",
  title: "Emma", author: "Jane Austen", language: "en", cover: `${ORIGIN}/image/detail/Emma-Jane-Austen.jpg`,
  source: "Loyal Books", sourceUrl: `${ORIGIN}/book/${encodeURIComponent(slug)}`, downloadMode: "direct",
  rights: "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.", rightsUrl: `${ORIGIN}/about`,
  ...extra,
});
async function epub() { const zip = new JSZip(); zip.file("mimetype", "application/epub+zip"); zip.file("META-INF/container.xml", "<container/>"); return zip.generateAsync({ type: "uint8array" }); }

beforeEach(() => { vi.stubEnv("MODE", "pages"); vi.stubEnv("VITE_SOURCE_RELAY_URL", "https://relay.example"); vi.stubEnv("BASE_URL", "/EPUB-FastReader/"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Loyal Books embedded search and selected editions", () => {
  it("declares its official external search panel without a local catalogue", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(source.manifest).toMatchObject({ version: "2.0.0", searchPresentation: "embedded", searchPrivacy: "external", capabilities: { search: true, download: true } });
    for (const language of ["", "all", "en", "fr", "de", "zh"]) {
      expect(await source.search({ query: "Jane Austen", language, page: 2 })).toEqual({ books: [], count: 0, hasNext: false, countIsApproximate: false, searchPresentation: "embedded" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps aborted search and resolution requests offline", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(); controller.abort();
    await expect(source.search({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(resolveLoyalbooksBook("emma-by-jane-austen", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves a selected edition through the bounded relay and preserves its complete metadata", async () => {
    const metadata = resolvedBook("Contes-Français", { title: "Un titre français complet ".repeat(50).trim(), author: "Prosper Mérimée", language: "fr" });
    const fetch = vi.fn(async () => new Response(JSON.stringify(metadata))); vi.stubGlobal("fetch", fetch);
    expect(await resolveLoyalbooksBook("Contes-Français")).toEqual(metadata);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://relay.example/api/sources/loyalbooks/detail/Contes-Fran%C3%A7ais");
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    expect(fetch.mock.calls[0][0]).not.toMatch(/\.epub$/u);
  });
  it("keeps missing language and artwork empty, and ignores remote fields that cannot control acquisition", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(resolvedBook("emma-by-jane-austen", { language: "", cover: "https://evil.example/book.jpg", downloadUrl: "https://evil.example/book.epub", rightsUrl: "https://evil.example/rights", source: "Injected label" })))); vi.stubGlobal("fetch", fetch);
    const result = await resolveLoyalbooksBook("emma-by-jane-austen");
    expect(result).toEqual(resolvedBook("emma-by-jane-austen", { language: "", cover: null }));
    expect(result).not.toHaveProperty("downloadUrl");
  });
  it("rejects arbitrary URLs, paths, duplicate encoding and invalid identifiers before any request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const slug of ["", "../private", "https://evil.example/book", "emma/book", "emma?url=private", "emma#fragment", "%2Fprivate", "a".repeat(201), null, 123]) {
      await expect(resolveLoyalbooksBook(slug)).rejects.toMatchObject({ code: "INVALID_BOOK" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects altered edition identities, missing metadata and malformed or oversized responses", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const extra of [{ id: "loyalbooks-other" }, { canonicalSourceId: "loyalbooks:other" }, { providerId: "gutenberg" }, { sourceUrl: "https://evil.example/book/emma" }, { downloadMode: "manual" }, { title: "" }, { title: "\u0000" }, { title: "a".repeat(2001) }, { author: "" }, { language: "English" }]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(resolvedBook("emma-by-jane-austen", extra))));
      await expect(resolveLoyalbooksBook("emma-by-jane-austen")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    fetch.mockResolvedValueOnce(new Response("<html>Not JSON</html>"));
    await expect(resolveLoyalbooksBook("emma-by-jane-austen")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetch.mockResolvedValueOnce(new Response("x".repeat(32 * 1024 + 1)));
    await expect(resolveLoyalbooksBook("emma-by-jane-austen")).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  it("requires a configured detail relay without preventing the external search panel", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_SOURCE_RELAY_URL", ""); vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "");
    await expect(resolveLoyalbooksBook("emma-by-jane-austen")).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIGURED" });
    expect((await source.search({ query: "Emma" })).searchPresentation).toBe("embedded");
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
