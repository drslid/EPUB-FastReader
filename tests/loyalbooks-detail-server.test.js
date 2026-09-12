// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createLoyalbooksHandler, createLoyalbooksMiddleware, parseLoyalbooksMetadata } from "../server/loyalbooks-source.js";

const ORIGIN = "https://www.loyalbooks.com";
const origin = "https://drslid.github.io";
const slug = "emma-by-jane-austen";
const path = `/api/sources/loyalbooks/detail/${slug}`;
const request = (target = path, options = {}) => new Request(`https://relay.example${target}`, { headers: { Origin: origin }, ...options });
// The public edition uses this heading and author block. Reviews repeat
// name/author microdata, so they must never supply missing book metadata.
const detail = ({ title = "Emma", author = "Jane Austen", language = "", cover = "/image/detail/Emma-Jane-Austen.jpg", epub = "/download/epub/Emma-by-Jane-Austen.epub" } = {}) => `<html lang="en"><body><div itemscope itemtype="http://schema.org/Book"><table class="book" summary="Audio book details">
  ${title === null ? "" : `<h1 style="font-size:25px"><span itemprop="name">${title}</span></h1>`}
  <img itemprop="image" class="cover" src="${cover}" alt="Book cover">
  ${author === null ? "" : `<font class="book-author">By: <a href="/author?author=Jane+Austen" itemprop="author">${author}</a> (1775-1817)</font>`}
  ${language ? `<meta itemprop="inLanguage" content="${language}">` : ""}
  <span itemprop="description">A comedy of manners.</span></table>
  <h1>Audiobook downloads</h1><a href="${epub}"><font class="download-big">ePUB eBook</font></a>
  <div itemprop="review"><span itemprop="name">Reader review</span><span itemprop="author">A reviewer</span></div>
  </div></body></html>`;
const responseHtml = (html = detail()) => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
afterEach(() => { vi.useRealTimers(); });

describe("Loyal Books public edition resolution", () => {
  it("returns only safe book metadata from the selected public edition without acquiring an EPUB", async () => {
    const fetch = vi.fn(async () => responseHtml(detail({ language: "French" })));
    const result = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request(path, { headers: { Origin: origin, Cookie: "private=never-forward", Authorization: "secret" } }));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(result.headers.get("access-control-allow-origin")).toBe(origin);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(await result.json()).toEqual({
      id: `loyalbooks-${slug}`, canonicalSourceId: `loyalbooks:${slug}`, providerId: "loyalbooks",
      title: "Emma", author: "Jane Austen", language: "fr", cover: `${ORIGIN}/image/detail/Emma-Jane-Austen.jpg`,
      source: "Loyal Books", sourceUrl: `${ORIGIN}/book/${slug}`, downloadMode: "direct",
      rights: "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.", rightsUrl: `${ORIGIN}/about`,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([`${ORIGIN}/book/${slug}`, expect.objectContaining({ redirect: "manual", credentials: "omit" })]);
    expect(JSON.stringify(fetch.mock.calls)).not.toMatch(/private|secret/);
  });

  it("decodes bounded plain metadata, rejects foreign covers, and leaves an unreported language empty", async () => {
    const fetch = vi.fn(async () => responseHtml(detail({ title: "<i>Les Mis&#233;rables</i> &amp; &#x1F4DA;<script>bad()</script>", author: "Victor&nbsp;Hugo\u0000", cover: "https://evil.example/cover.jpg" })));
    const result = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request("/api/sources/loyalbooks/detail/Contes-Fran%C3%A7ais"));
    expect(await result.json()).toMatchObject({ title: "Les Misérables & 📚", author: "Victor Hugo", language: "", cover: null, sourceUrl: `${ORIGIN}/book/Contes-Fran%C3%A7ais` });
    expect(fetch.mock.calls[0][0]).toBe(`${ORIGIN}/book/Contes-Fran%C3%A7ais`);
    expect(parseLoyalbooksMetadata(detail().replace('<span itemprop="description">', '<b>Language:</b> <a href="/language/German">German</a><span itemprop="description">')).language).toBe("de");
    expect(parseLoyalbooksMetadata(detail({ title: "&Eacute;tude des &oelig;uvres &amp; &OElig;uvres", language: "constructor" }))).toMatchObject({ title: "Étude des œuvres & Œuvres", language: "" });
  });

  it("shares five-minute metadata with covers while keeping the sixteen-entry cache bounded", async () => {
    let now = 1000;
    const image = new Uint8Array([255, 216, 255, 224]);
    const fetch = vi.fn(async (url) => url.includes("/image/") ? new Response(image) : responseHtml());
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin, now: () => now });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request(`/api/sources/loyalbooks/cover/${slug}.jpg`))).status).toBe(200);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/book/${slug}`, `${ORIGIN}/image/detail/Emma-Jane-Austen.jpg`]);
    now += 300_000;
    expect((await handler(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 16; index++) expect((await handler(request(`/api/sources/loyalbooks/detail/edition-${index}`))).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(20);
    expect(fetch.mock.calls.every(([url]) => !url.includes("/download/"))).toBe(true);
  });

  it.each([
    ["missing title", { title: null }], ["missing author", { author: null }],
    ["empty title", { title: " <script>bad()</script> " }], ["empty author", { author: " " }],
    ["oversized title", { title: "x".repeat(2001) }], ["oversized author", { author: "x".repeat(1001) }],
  ])("rejects %s instead of substituting reviews or download headings", async (_, fields) => {
    const fetch = vi.fn(async () => responseHtml(detail(fields)));
    const response = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_RESPONSE" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://evil.example/download/epub/book.epub", "//evil.example/download/epub/book.epub",
    "/download/epub/..%2F..%2Fsecret.epub", "/download/epub/book.epub?url=https://evil.example",
    "/download/epub/book.epub#fragment", "/download/mobi/book.mobi",
  ])("requires an advertised official EPUB instead of %s", async (epub) => {
    const fetch = vi.fn(async () => responseHtml(detail({ epub })));
    const result = await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request());
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({ error: { code: "BOOK_UNAVAILABLE" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores EPUB links in scripts, comments, data attributes and nested tags", async () => {
    const html = detail().replace(/<a href="\/download\/epub\/[\s\S]*?<\/a>/u, "");
    for (const extra of [
      '<script>const hidden = \'<a href="/download/epub/Emma.epub">ePUB</a>\';</script>',
      '<!-- <a href="/download/epub/Emma.epub">ePUB</a> -->',
      '<a data-href="/download/epub/Emma.epub">ePUB</a>',
      '<a><span href="/download/epub/Emma.epub">ePUB</span></a>',
    ]) {
      const fetch = vi.fn(async () => responseHtml(html + extra));
      expect((await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request())).status).toBe(404);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("checks paths, origin, methods and preflight before any source request", async () => {
    const fetch = vi.fn();
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    for (const suffix of ["%2Fetc", "%2e%2e%2fsecret", "%252fsecret", "%ZZ", "https%3A%2F%2Fevil.example", "book%3Furl%3Devil", "book/extra", ""]) {
      expect((await handler(request(`/api/sources/loyalbooks/detail/${suffix}`))).status).toBe(400);
    }
    expect((await handler(request(`${path}?url=https://evil.example`))).status).toBe(400);
    expect((await handler(request(path, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
    expect((await handler(request(path, { method: "POST" }))).status).toBe(405);
    expect((await handler(request(path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Accept" } }))).status).toBe(204);
    expect((await handler(request(path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Cookie" } }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429])("honors HTTP %i and its cooldown without a retry or alternate source", async (status) => {
    const fetch = vi.fn(async () => new Response("Denied", { status, headers: { "Retry-After": "120" } }));
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    for (const target of [path, "/api/sources/loyalbooks/detail/other-edition"]) {
      const result = await handler(request(target));
      expect(result.status).toBe(503);
      expect(result.headers.get("retry-after")).toBe("120");
      expect(await result.json()).toMatchObject({ error: { code: "SOURCE_BUSY" } });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects, missing editions, wrong media types and oversized detail responses", async () => {
    for (const [response, status] of [
      [new Response(null, { status: 302, headers: { Location: "https://evil.example/book" } }), 502],
      [new Response("Gone", { status: 404 }), 404],
      [new Response("{}", { headers: { "Content-Type": "application/json" } }), 502],
      [new Response(detail(), { headers: { "Content-Type": "text/html", "Content-Length": "1048577" } }), 413],
      [responseHtml("x".repeat(1_048_577)), 413],
    ]) {
      const fetch = vi.fn(async () => response);
      expect((await createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin })(request())).status).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("bounds simultaneous detail requests and releases their slots after timeout", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin, timeoutMs: 50 });
    const first = handler(request());
    const second = handler(request("/api/sources/loyalbooks/detail/another-edition"));
    expect((await handler(request())).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    for (const pending of [first, second]) {
      const result = await pending;
      expect(result.status).toBe(504);
      expect(await result.json()).toMatchObject({ error: { code: "SOURCE_TIMEOUT" } });
    }
    fetch.mockImplementation(async () => responseHtml());
    expect((await handler(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("cancels a detail request without caching a late response", async () => {
    const controller = new AbortController();
    let resolve;
    const fetch = vi.fn(() => new Promise((done) => { resolve = done; }));
    const handler = createLoyalbooksHandler({ fetchImpl: fetch, allowOrigin: origin });
    const pending = handler(request(path, { signal: controller.signal }));
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    resolve(responseHtml());
    fetch.mockImplementation(async () => responseHtml());
    expect((await handler(request())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("exposes detail resolution through the shared development/server middleware", async () => {
    const fetch = vi.fn(async () => responseHtml());
    const middleware = createLoyalbooksMiddleware({ fetchImpl: fetch, allowOrigin: origin });
    const response = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn(), destroyed: false, writableEnded: false });
    const next = vi.fn();
    await middleware({ url: path, method: "GET", headers: { origin } }, response, next);
    expect(next).not.toHaveBeenCalled();
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "content-type": "application/json; charset=utf-8" }));
    expect(JSON.parse(new TextDecoder().decode(response.end.mock.calls[0][0]))).toMatchObject({ title: "Emma", author: "Jane Austen" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
