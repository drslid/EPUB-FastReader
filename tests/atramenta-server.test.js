// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createAtramentaHandler, AtramentaError } from "../server/atramenta-source.js";

const ORIGIN = "https://www.atramenta.net";
const SEARCH = "/api/sources/atramenta/search?query=Germinal&page=1";
const BOOK = "/api/books/atramenta/15038-un-coeur-simple.epub";
const request = (path, options) => new Request(`https://relay.test${path}`, options);
const html = '<form action="/search/"></form><main id="main_content_wrapper">Œuvre française</main>';
const detail = (headers = {}) => new Response('<meta content="publicaction123" name="action_sig"><button id="epubDownload" data-dl-format="epub">EPUB</button>', { headers: { "Content-Type": "text/html", "Set-Cookie": "PHPSESSID=stable-anonymous-session; Path=/; HttpOnly", ...headers } });
const epub = async () => { const zip = new JSZip(); zip.file("mimetype", "application/epub+zip"); zip.file("META-INF/container.xml", "<container/>"); return zip.generateAsync({ type: "uint8array" }); };
const mockAcquisition = (bytes, overrides = {}) => vi.fn(async (url, options) => {
  if (url.includes("/search/")) return new Response(html);
  if (!options.body && url.includes("/lire/")) return detail();
  if (options.body === "get_dl_allowance=1") return Response.json(overrides.allowance || { dl_allowance: 4, must_log_in: false });
  if (options.body?.includes("get_dl_url")) return Response.json(overrides.offer || { dl_url: `${ORIGIN}/download_libre/0123456789/un-coeur-simple/15038.epub` });
  return overrides.file || new Response(bytes, { headers: { "Content-Type": "application/epub+zip" } });
});
afterEach(() => vi.useRealTimers());

describe("Atramenta bounded public relay", () => {
  it("transcodes the real ISO-8859-1 catalogue to UTF-8 and caches only completed responses", async () => {
    const latin = Buffer.from('<form action="/search/"></form><main id="main_content_wrapper">fran\xe7ais</main>', "latin1");
    const fetchImpl = vi.fn(async () => new Response(latin, { headers: { "Content-Type": "text/html; charset=ISO-8859-1" } }));
    const handler = createAtramentaHandler({ fetchImpl });
    const response = await handler(request(SEARCH));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("utf-8");
    expect(await response.text()).toContain("français");
    expect(fetchImpl.mock.calls[0][0]).toBe(`${ORIGIN}/search/?atmt_search=Germinal&search_encoding=UTF-8`);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined();
    expect((await handler(request(SEARCH))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("follows the ordinary public allowance and signed EPUB workflow without leaking session cookies", async () => {
    const bytes = await epub();
    const fetchImpl = mockAcquisition(bytes);
    const saveSession = vi.fn(), reserveDownload = vi.fn();
    const handler = createAtramentaHandler({ fetchImpl, saveSession, reserveDownload });
    const response = await handler(request(BOOK, { headers: { Cookie: "personal-user-secret=never-forward" } }));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/lire/un-coeur-simple/15038`, `${ORIGIN}/lire/un-coeur-simple/15038`, `${ORIGIN}/lire/un-coeur-simple/15038`, `${ORIGIN}/download_libre/0123456789/un-coeur-simple/15038.epub`]);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined();
    expect(fetchImpl.mock.calls.slice(1).every(([, options]) => options.headers.Cookie === "PHPSESSID=stable-anonymous-session")).toBe(true);
    expect(fetchImpl.mock.calls[2][1].body).toBe("get_dl_url=1&dl_format=epub&sig=publicaction123");
    expect(saveSession).toHaveBeenCalledWith({ PHPSESSID: "stable-anonymous-session" });
    expect(reserveDownload).toHaveBeenCalledWith(expect.objectContaining({ limits: expect.objectContaining({ maxDailyDownloads: 4 }) }));
    await handler(request(BOOK));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(reserveDownload).toHaveBeenCalledTimes(1);
  });
  it("reloads a previously persisted anonymous session before visiting the edition", async () => {
    const fetchImpl = mockAcquisition(await epub());
    const handler = createAtramentaHandler({ fetchImpl, loadSession: async () => ({ PHPSESSID: "previous-session", not_a_bot: "previous-marker", private: "ignore" }) });
    expect((await handler(request(BOOK))).status).toBe(200);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBe("PHPSESSID=previous-session; not_a_bot=previous-marker");
  });
  it.each([{ allowance: { dl_allowance: 0, must_log_in: false }, status: 429 }, { allowance: { dl_allowance: 4, must_log_in: true }, status: 403 }])("stops at exhausted allowance or login without resetting the session", async ({ allowance, status }) => {
    const fetchImpl = mockAcquisition(await epub(), { allowance });
    const loadSession = vi.fn(async () => ({ PHPSESSID: "same-session" }));
    const response = await createAtramentaHandler({ fetchImpl, loadSession })(request(BOOK));
    expect(response.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBe("PHPSESSID=same-session");
  });
  it("counts failed attempts against its four-download budget and respects a persisted shared reservation", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>No EPUB available</html>"));
    const handler = createAtramentaHandler({ fetchImpl });
    for (let index = 0; index < 4; index++) expect((await handler(request(BOOK))).status).toBe(404);
    expect((await handler(request(BOOK))).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const restricted = createAtramentaHandler({ fetchImpl, reserveDownload: async () => { throw new AtramentaError(429, "SOURCE_DAILY_LIMIT", "Exhausted", 600); } });
    expect((await restricted(request(BOOK))).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("persists an exhausted allowance across restarts while keeping catalogue searches available", async () => {
    let timestamp = Date.UTC(2026, 8, 12, 12), savedBlock, savedSession;
    const fetchImpl = mockAcquisition(await epub(), { allowance: { dl_allowance: 0, must_log_in: false } });
    const reserveDownload = vi.fn();
    const options = { fetchImpl, now: () => timestamp, reserveDownload, loadDownloadBlock: async () => savedBlock, saveDownloadBlock: async (value) => { savedBlock = value; }, loadSession: async () => savedSession, saveSession: async (value) => { savedSession = value; } };
    const first = await createAtramentaHandler(options)(request(BOOK));
    expect(first.status).toBe(429);
    expect(first.headers.get("retry-after")).toBe("86400");
    expect(savedBlock.downloads).toMatchObject({ scope: "downloads", code: "SOURCE_DAILY_LIMIT", until: timestamp + 86_400_000 });
    expect(savedSession).toEqual({ PHPSESSID: "stable-anonymous-session" });
    timestamp += 60_000;
    const restarted = createAtramentaHandler(options);
    const refused = await restarted(request(BOOK));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("86340");
    expect(reserveDownload).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await restarted(request(SEARCH))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const expiry = savedBlock.downloads.until;
    timestamp += 123;
    expect((await restarted(request(BOOK))).status).toBe(429);
    expect(savedBlock.downloads.until).toBe(expiry);
  });
  it.each(["3600", "Sat, 12 Sep 2026 13:00:00 GMT"])("honours a download Retry-After (%s) after a restart without blocking search", async (retryAfter) => {
    let timestamp = Date.UTC(2026, 8, 12, 12), savedBlock;
    const success = mockAcquisition(await epub());
    let refused = false;
    const fetchImpl = vi.fn((url, init) => {
      if (init.body === "get_dl_allowance=1" && !refused) { refused = true; return new Response("Wait", { status: 429, headers: { "Retry-After": retryAfter } }); }
      return success(url, init);
    });
    const options = { fetchImpl, now: () => timestamp, loadDownloadBlock: async () => savedBlock, saveDownloadBlock: async (value) => { savedBlock = value; } };
    expect((await createAtramentaHandler(options)(request(BOOK))).status).toBe(503);
    expect(savedBlock.downloads).toMatchObject({ scope: "downloads", until: timestamp + 3_600_000 });
    timestamp += 1000;
    const restarted = createAtramentaHandler(options);
    const response = await restarted(request(BOOK));
    expect(response.headers.get("retry-after")).toBe("3599");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await restarted(request(SEARCH))).status).toBe(200);
    timestamp += 3_600_000;
    expect((await restarted(request(BOOK))).status).toBe(200);
  });
  it("persists a global origin refusal without refreshing it on every blocked request", async () => {
    let savedBlock;
    const fetchImpl = vi.fn(async () => new Response("Denied", { status: 403, headers: { "Retry-After": "600" } }));
    const saveDownloadBlock = vi.fn(async (value) => { savedBlock = value; });
    const options = { fetchImpl, now: () => 10_000, loadDownloadBlock: async () => savedBlock, saveDownloadBlock };
    expect((await createAtramentaHandler(options)(request(BOOK))).status).toBe(503);
    expect(savedBlock.source).toMatchObject({ scope: "source", until: 610_000 });
    expect((await createAtramentaHandler(options)(request(SEARCH))).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(saveDownloadBlock).toHaveBeenCalledTimes(1);
  });
  it("keeps the full daily download refusal when a shorter search cooldown follows it", async () => {
    let timestamp = Date.UTC(2026, 8, 12, 12), savedBlock;
    const acquisition = mockAcquisition(await epub(), { allowance: { dl_allowance: 0, must_log_in: false } });
    let refuseSearch = true;
    const fetchImpl = vi.fn((url, init) => url.includes("/search/") && refuseSearch
      ? new Response("Wait", { status: 403, headers: { "Retry-After": "300" } })
      : acquisition(url, init));
    const options = { fetchImpl, now: () => timestamp, loadDownloadBlock: async () => savedBlock, saveDownloadBlock: async (value) => { savedBlock = value; } };
    const handler = createAtramentaHandler(options);
    expect((await handler(request(BOOK))).status).toBe(429);
    expect((await handler(request(SEARCH))).status).toBe(503);
    expect(savedBlock).toMatchObject({ version: 1, source: { until: timestamp + 300_000 }, downloads: { until: timestamp + 86_400_000 } });
    timestamp += 300_001;
    refuseSearch = false;
    const restarted = createAtramentaHandler(options);
    expect((await restarted(request(SEARCH))).status).toBe(200);
    const calls = fetchImpl.mock.calls.length;
    const refusal = await restarted(request(BOOK));
    expect(refusal.status).toBe(429);
    expect(refusal.headers.get("retry-after")).toBe("86100");
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
  });
  it("loads the previous single-refusal persistence format without contacting the provider", async () => {
    const fetchImpl = vi.fn();
    const handler = createAtramentaHandler({ fetchImpl, now: () => 10_000, loadDownloadBlock: async () => ({ scope: "downloads", until: 610_000, status: 429, code: "SOURCE_DAILY_LIMIT", message: "Quota" }) });
    expect((await handler(request(BOOK))).status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test/download_libre/0123456789/un-coeur-simple/15038.epub", "/download_libre/0123456789/another-book/15038.epub", "/download_libre/0123456789/un-coeur-simple/12.epub", "/download_libre/0123456789/un-coeur-simple/15038.epub?leak=session"])("rejects an unapproved signed file address: %s", async (dl_url) => {
    const fetchImpl = mockAcquisition(await epub(), { offer: { dl_url } });
    expect((await createAtramentaHandler({ fetchImpl })(request(BOOK))).status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each(["/api/books/atramenta/0-private.epub", "/api/books/atramenta/15038-un-coeur-simple.epub?url=https://evil.test", "/api/sources/atramenta/search?query=x&page=2", "/api/sources/atramenta/search?query=x&query=y", "/api/sources/atramenta/search?query="])("rejects invalid client routes before upstream work: %s", async (path) => {
    const fetchImpl = vi.fn();
    expect((await createAtramentaHandler({ fetchImpl })(request(path))).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("treats HTML disguised as an EPUB and oversized files as acquisition failures", async () => {
    for (const file of [new Response("<html>denied</html>", { headers: { "Content-Type": "text/html" } }), new Response("not a zip", { headers: { "Content-Type": "application/epub+zip" } }), new Response("large", { headers: { "Content-Type": "application/epub+zip", "Content-Length": String(31 * 1024 * 1024) } })]) {
      const response = await createAtramentaHandler({ fetchImpl: mockAcquisition(await epub(), { file }) })(request(BOOK));
      expect([502, 413]).toContain(response.status);
    }
  });
  it("rejects a highly compressed mimetype with a forged uncompressed size before inflating it", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "a".repeat(4 * 1024 * 1024));
    zip.file("META-INF/container.xml", "<container/>");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(bytes.readUInt32LE(central + 20)).toBeGreaterThan(256);
    bytes.writeUInt32LE(50, central + 24);
    bytes.writeUInt32LE(50, 22);
    const originalFile = JSZip.prototype.file;
    const inflation = vi.fn();
    const fileSpy = vi.spyOn(JSZip.prototype, "file").mockImplementation(function (...args) {
      const entry = originalFile.apply(this, args);
      if (args.length === 1 && args[0] === "mimetype" && entry) {
        const inflate = entry.async.bind(entry);
        entry.async = (...options) => { inflation(); return inflate(...options); };
      }
      return entry;
    });
    try {
      const response = await createAtramentaHandler({ fetchImpl: mockAcquisition(bytes) })(request(BOOK));
      expect(response.status).toBe(502);
      expect((await response.json()).error.code).toBe("INVALID_EPUB");
      expect(inflation).not.toHaveBeenCalled();
    } finally { fileSpy.mockRestore(); }
  });
  it("stops on an origin refusal, without retrying another route or changing identity", async () => {
    const fetchImpl = vi.fn(async () => new Response("Denied", { status: 403 }));
    const handler = createAtramentaHandler({ fetchImpl });
    expect((await handler(request(BOOK))).status).toBe(503);
    expect((await handler(request(SEARCH))).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("allows the exact Pages origin and only public GET preflights", async () => {
    const fetchImpl = vi.fn(async () => new Response(html));
    const handler = createAtramentaHandler({ fetchImpl, allowOrigin: "https://drslid.github.io" });
    const response = await handler(request(SEARCH, { headers: { Origin: "https://drslid.github.io" } }));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://drslid.github.io");
    expect((await handler(request(SEARCH, { headers: { Origin: "https://evil.test" } }))).status).toBe(403);
    expect((await handler(request(SEARCH, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "GET" } }))).status).toBe(204);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("cancelling one reader leaves another identical title search running", async () => {
    const pending = [];
    const fetchImpl = vi.fn((url, options) => new Promise((resolve, reject) => {
      pending.push({ signal: options.signal, resolve });
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const handler = createAtramentaHandler({ fetchImpl });
    const controller = new AbortController();
    const first = handler(request(SEARCH, { signal: controller.signal }));
    const rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = handler(request(SEARCH));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    controller.abort();
    await rejection;
    expect(pending[1].signal.aborted).toBe(false);
    pending[1].resolve(new Response(html));
    expect((await second).status).toBe(200);
  });
  it("bounds stalled bodies and releases the search slot after a timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
    const handler = createAtramentaHandler({ fetchImpl, timeoutMs: 20 });
    const pending = handler(request(SEARCH));
    await vi.advanceTimersByTimeAsync(21);
    expect((await pending).status).toBe(504);
    fetchImpl.mockImplementation(async () => new Response(html));
    expect((await handler(request(SEARCH))).status).toBe(200);
  });
  it("cancels acquisition before asking for a download link and reuses the same anonymous session", async () => {
    const successful = mockAcquisition(await epub());
    let pendingSignal, interrupted = false, storedSession;
    const fetchImpl = vi.fn(async (url, init) => {
      if (init.body === "get_dl_allowance=1" && !interrupted) {
        pendingSignal = init.signal;
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => { interrupted = true; reject(init.signal.reason); }, { once: true }));
      }
      return successful(url, init);
    });
    const handler = createAtramentaHandler({ fetchImpl, loadSession: async () => storedSession, saveSession: async (value) => { storedSession = value; } });
    const controller = new AbortController();
    const pending = handler(request(BOOK, { signal: controller.signal }));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(pendingSignal).toBeDefined());
    controller.abort();
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(storedSession).toEqual({ PHPSESSID: "stable-anonymous-session" });
    expect((await handler(request(BOOK))).status).toBe(200);
    expect(fetchImpl.mock.calls[2][1].headers.Cookie).toBe("PHPSESSID=stable-anonymous-session");
  });
  it("does not contact the source or reserve a download when cancelled while restoring persistent refusals", async () => {
    let restore;
    const fetchImpl = vi.fn(), reserveDownload = vi.fn();
    const handler = createAtramentaHandler({ fetchImpl, reserveDownload, loadDownloadBlock: () => new Promise((resolve) => { restore = resolve; }) });
    const controller = new AbortController();
    const pending = handler(request(BOOK, { signal: controller.signal }));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(restore).toBeDefined());
    controller.abort();
    await rejected;
    restore(null);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reserveDownload).not.toHaveBeenCalled();
  });
});
