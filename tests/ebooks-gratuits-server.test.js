// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createServer } from "node:http";
import { createEbooksGratuitsHandler, createEbooksGratuitsMiddleware } from "../server/ebooks-gratuits-source.js";

const base = "https://relay.test";
const origin = "https://www.ebooksgratuits.com";
const searchPath = "/api/sources/ebooks-gratuits/search?query=Candide&page=1";
const bookPath = "/api/books/ebooks-gratuits/637.epub";
const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Candide</title></feed>';
const epub = async () => {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", "<container/>");
  zip.file("mimetype", "application/epub+zip");
  return zip.generateAsync({ type: "uint8array" });
};
const makeResponse = (bytes) => new Response(bytes, { headers: { "Content-Type": "application/epub+zip" } });
const request = (path, options) => new Request(`${base}${path}`, options);
afterEach(() => vi.useRealTimers());

describe("ELG service de recherche et acquisition", () => {
  it("traduit la pagination et borne les requêtes à l’OPDS officiel sans recopier des URL clientes", async () => {
    const fetchImpl = vi.fn(async () => new Response(xml));
    const handler = createEbooksGratuitsHandler({ fetchImpl });
    const response = await handler(request(searchPath));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(xml);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${origin}/opds/feed.php?mode=search&query=Candide&page=0`, expect.objectContaining({ redirect: "manual", credentials: "omit" }));
    await handler(request(searchPath));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await handler(request("/unrelated"))).toBe(null);
  });
  it.each([
    "/api/sources/ebooks-gratuits/search?query=",
    "/api/sources/ebooks-gratuits/search?query=book&page=0",
    "/api/sources/ebooks-gratuits/search?query=book&page=1001",
    "/api/sources/ebooks-gratuits/search?query=book&url=https://evil.test",
    "/api/sources/ebooks-gratuits/search?query=one&query=two",
    "/api/books/ebooks-gratuits/0637.epub",
    "/api/books/ebooks-gratuits/637.epub?url=https://evil.test",
  ])("rejette les paramètres invalides avant toute requête : %s", async (path) => {
    const fetchImpl = vi.fn();
    expect((await createEbooksGratuitsHandler({ fetchImpl })(request(path))).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("autorise exactement l’origine Pages prévue et les prévols publics GET", async () => {
    const fetchImpl = vi.fn(async () => new Response(xml));
    const handler = createEbooksGratuitsHandler({ fetchImpl, allowOrigin: "https://drslid.github.io" });
    const response = await handler(request(searchPath, { headers: { Origin: "https://drslid.github.io" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://drslid.github.io");
    expect((await handler(request(searchPath, { headers: { Origin: "https://evil.test" } }))).status).toBe(403);
    const preflight = await handler(request(searchPath, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Accept" } }));
    expect(preflight.status).toBe(204);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await handler(request(searchPath, { method: "OPTIONS", headers: { Origin: "https://drslid.github.io", "Access-Control-Request-Method": "POST" } }))).status).toBe(403);
  });
  it("récupère seulement la redirection EPUB officielle et conserve le fichier intégral en cache", async () => {
    const bytes = await epub();
    const fetchImpl = vi.fn(async (url) => url.includes("newsendbook") ? new Response(null, { status: 302, headers: { Location: "./epub/voltaire_candide.epub" } }) : makeResponse(bytes));
    const handler = createEbooksGratuitsHandler({ fetchImpl });
    const response = await handler(request(bookPath));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${origin}/newsendbook.php?id=637&format=epub`, `${origin}/epub/voltaire_candide.epub`]);
    expect((await handler(request(bookPath))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["https://evil.test/file.epub", "http://www.ebooksgratuits.com/epub/file.epub", "/private/data.epub", "/epub/file.epub?token=a"])("refuse une redirection non approuvée : %s", async (location) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { Location: location } }));
    const result = await createEbooksGratuitsHandler({ fetchImpl })(request(bookPath));
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({ error: { code: "UNSAFE_REDIRECT" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refuse le HTML, une archive arbitraire et un téléchargement trop volumineux", async () => {
    const zip = new JSZip(); zip.file("private.txt", "not an EPUB");
    const responses = [new Response("<html>Denied</html>", { headers: { "Content-Type": "text/html" } }), makeResponse(await zip.generateAsync({ type: "uint8array" })), new Response("x", { headers: { "Content-Type": "application/epub+zip", "Content-Length": String(31 * 1024 * 1024) } })];
    for (const value of responses) {
      const response = await createEbooksGratuitsHandler({ fetchImpl: async () => value })(request(bookPath));
      expect([502, 413]).toContain(response.status);
    }
  });
  it("honore une restriction d’accès sans seconde tentative ni repli sur un autre hôte", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "600" } }));
    const handler = createEbooksGratuitsHandler({ fetchImpl });
    const response = await handler(request(searchPath));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect((await handler(request(searchPath.replace("Candide", "autre")))).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("garantit un seul téléchargement amont et espace leurs débuts, sans bloquer la recherche", async () => {
    const bytes = await epub();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const started = [];
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("feed.php")) return new Response(xml);
      started.push(Date.now());
      return makeResponse(bytes);
    });
    const handler = createEbooksGratuitsHandler({ fetchImpl });
    expect((await handler(request(bookPath))).status).toBe(200);
    let secondDone = false;
    const second = handler(request(bookPath.replace("637", "638"))).then((response) => { secondDone = true; return response; });
    expect((await handler(request(searchPath))).status).toBe(200);
    await vi.advanceTimersByTimeAsync(12_099);
    expect(secondDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await second).status).toBe(200);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(12_100);
  });
  it("applique la limite de téléchargement et conserve les EPUB déjà en cache", async () => {
    const bytes = await epub();
    const fetchImpl = vi.fn(async () => makeResponse(bytes));
    const handler = createEbooksGratuitsHandler({ fetchImpl, maxDailyDownloads: 1 });
    expect((await handler(request(bookPath))).status).toBe(200);
    const limited = await handler(request(bookPath.replace("637", "638")));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "SOURCE_DAILY_LIMIT" } });
    expect((await handler(request(bookPath))).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("arrête un amont qui ignore AbortSignal quand le délai est dépassé", async () => {
    vi.useFakeTimers();
    const handler = createEbooksGratuitsHandler({ fetchImpl: () => new Promise(() => {}), timeoutMs: 100 });
    const pending = handler(request(searchPath));
    await vi.advanceTimersByTimeAsync(100);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: "SOURCE_TIMEOUT" } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("propage l’annulation utilisateur à l’amont", async () => {
    const controller = new AbortController();
    let upstreamSignal;
    const handler = createEbooksGratuitsHandler({ fetchImpl: (_url, { signal }) => { upstreamSignal = signal; return new Promise(() => {}); } });
    const pending = expect(handler(request(searchPath, { signal: controller.signal }))).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await pending;
    expect(upstreamSignal.aborted).toBe(true);
  });
  it("sert la même API depuis le middleware Node réel", async () => {
    const middleware = createEbooksGratuitsMiddleware({ fetchImpl: async () => new Response(xml) });
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${searchPath}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(xml);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
