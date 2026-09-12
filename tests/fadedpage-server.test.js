// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createFadedpageHandler } from "../server/fadedpage-source.js";

const ORIGIN = "https://www.fadedpage.com";
const SEARCH = "/api/sources/fadedpage/search?query=Jane&page=1";
const BOOK = "/api/books/fadedpage/20260903.epub";
const request = (path, options) => new Request(`https://relay.test${path}`, options);
const catalogue = { nrows: 1, rows: [{ pid: "20260903", title: "Jane", lang: "en", cover: "books/20260903/cover.jpg", authors: [{ realname: "Herbert", type: "author", bio: "Do not cache this biography." }] }], debug: "private debug" };
const detail = (extra = {}) => new Response('<a href="link.php?file=20260903.epub">EPUB</a>', { headers: { "Content-Type": "text/html", "Set-Cookie": "PHPSESSID=anonymous-session; Path=/; HttpOnly", ...extra } });
const epub = async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", "<container/>");
  return zip.generateAsync({ type: "uint8array" });
};
afterEach(() => vi.useRealTimers());

describe("Faded Page public relay", () => {
  it("uses the public title form without cookies, strips biographies and caches between pages", async () => {
    const fetchImpl = vi.fn(async () => Response.json(catalogue));
    const handler = createFadedpageHandler({ fetchImpl });
    const response = await handler(request(SEARCH));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nrows: 1, rows: [{ pid: "20260903", title: "Jane", lang: "en", cover: "books/20260903/cover.jpg", authors: [{ realname: "Herbert", type: "author" }] }] });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/csearc2.php`, expect.objectContaining({ method: "POST", body: "title=Jane&plang=en&sort=title", redirect: "manual", credentials: "omit" }));
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined();
    expect((await handler(request(SEARCH.replace("page=1", "page=2")))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await handler(request("/unrelated"))).toBeNull();
  });
  it("opens the public edition page, uses its anonymous session once and preserves the valid EPUB bytes", async () => {
    const bytes = await epub();
    const fetchImpl = vi.fn(async (url) => url.includes("showbook.php") ? detail() : new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
    const handler = createFadedpageHandler({ fetchImpl });
    const response = await handler(request(BOOK, { headers: { Cookie: "PRIVATE=never-forward" } }));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/showbook.php?pid=20260903`, `${ORIGIN}/link.php?file=20260903.epub`]);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1].headers.Cookie).toBe("PHPSESSID=anonymous-session");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await handler(request(BOOK))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["/api/books/fadedpage/../../secret.epub", "/api/books/fadedpage/20260903.epub?url=https://evil.test", "/api/books/fadedpage/123.epub", "/api/sources/fadedpage/search?query=", "/api/sources/fadedpage/search?query=x&page=85", "/api/sources/fadedpage/search?query=x&query=y", "/api/sources/fadedpage/search?query=x&cookie=secret"])("rejects malformed client parameters without upstream requests: %s", async (path) => {
    const fetchImpl = vi.fn();
    const response = await createFadedpageHandler({ fetchImpl })(request(path));
    expect(response?.status || 404).toBeGreaterThanOrEqual(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("requires the advertised EPUB for the requested edition and rejects external downloads", async () => {
    for (const link of ["https://evil.test/link.php?file=20260903.epub", "link.php?file=20260904.epub", "link.php?file=20260903.mobi"]) {
      const fetchImpl = vi.fn(async () => new Response(`<a href="${link}">download</a>`, { headers: { "Set-Cookie": "PHPSESSID=anonymous" } }));
      expect((await createFadedpageHandler({ fetchImpl })(request(BOOK))).status).toBe(404);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it("stops on redirects, authentication or challenges without retries or alternate hosts", async () => {
    for (const status of [302, 401, 403, 429]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status, headers: { Location: "https://evil.test", "Retry-After": "600" } }));
      const handler = createFadedpageHandler({ fetchImpl });
      const response = await handler(request(BOOK));
      expect(response.status).toBe(status === 302 ? 502 : 503);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      if (status !== 302) {
        expect(response.headers.get("retry-after")).toBe("600");
        expect((await handler(request(SEARCH))).status).toBe(503);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    }
  });
  it("rejects HTML posing as EPUB, invalid archives and oversized streams", async () => {
    const bad = [new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }), new Response("not zip", { headers: { "Content-Type": "application/octet-stream" } }), new Response("oversized", { headers: { "Content-Type": "application/epub+zip", "Content-Length": String(31 * 1024 * 1024) } })];
    for (const value of bad) {
      const handler = createFadedpageHandler({ fetchImpl: async (url) => url.includes("showbook") ? detail() : value });
      expect([502, 413]).toContain((await handler(request(BOOK))).status);
    }
  });
  it("allows exactly the configured Pages origin and limits preflight to public GET", async () => {
    const fetchImpl = vi.fn(async () => Response.json(catalogue));
    const handler = createFadedpageHandler({ fetchImpl, allowOrigin: "https://drslid.github.io" });
    const good = await handler(request(SEARCH, { headers: { Origin: "https://drslid.github.io" } }));
    expect(good.headers.get("access-control-allow-origin")).toBe("https://drslid.github.io");
    expect((await handler(request(SEARCH, { headers: { Origin: "https://evil.test" } }))).status).toBe(403);
    expect((await handler(request(SEARCH, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "accept" } }))).status).toBe(204);
    expect((await handler(request(SEARCH, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "POST" } }))).status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("times out an upstream body that stalls and releases capacity", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
    const handler = createFadedpageHandler({ fetchImpl, timeoutMs: 25 });
    const pending = handler(request(SEARCH));
    await vi.advanceTimersByTimeAsync(26);
    expect((await pending).status).toBe(504);
    fetchImpl.mockImplementation(async () => Response.json(catalogue));
    expect((await handler(request(SEARCH))).status).toBe(200);
  });
  it("cancelling one reader never aborts another reader requesting the same title", async () => {
    const calls = [];
    const fetchImpl = vi.fn((url, options) => new Promise((resolve, reject) => {
      calls.push({ resolve, signal: options.signal });
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const handler = createFadedpageHandler({ fetchImpl });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = handler(request(SEARCH, { signal: firstController.signal }));
    const firstAborted = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = handler(request(SEARCH, { signal: secondController.signal }));
    expect(calls).toHaveLength(2);
    firstController.abort();
    await firstAborted;
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    calls[1].resolve(Response.json(catalogue));
    const response = await second;
    expect(response.status).toBe(200);
    expect((await response.json()).rows[0].title).toBe("Jane");
    expect(secondController.signal.aborted).toBe(false);
    expect((await handler(request(SEARCH))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("keeps a search responsive while one EPUB is downloading and rejects extra memory pressure", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const bytes = await epub();
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("csearc2")) return Response.json(catalogue);
      if (url.includes("showbook")) return detail();
      await gate;
      return new Response(bytes, { headers: { "Content-Type": "application/epub+zip" } });
    });
    const handler = createFadedpageHandler({ fetchImpl });
    const downloading = handler(request(BOOK));
    try {
      expect((await handler(request(SEARCH))).status).toBe(200);
      expect((await handler(request(BOOK.replace("20260903", "20260904")))).status).toBe(429);
    } finally { release(); }
    expect((await downloading).status).toBe(200);
  });
});
