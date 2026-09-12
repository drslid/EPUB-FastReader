// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import worker, { FastReaderSources } from "../server/worker.js";
import { createGutenbergHandler } from "../server/gutenberg-fetch.js";
import { createSourceStatusHandler } from "../server/source-status.js";

const origin = "https://drslid.github.io";
const request = (path, options) => new Request(`https://relay.test${path}`, options);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("disponibilité des sources", () => {
  it("vérifie les vrais endpoints sans télécharger un EPUB, puis réutilise le contrôle pendant cinq minutes", async () => {
    const fetchImpl = vi.fn(async (url) => new Response(null, { headers: { "Content-Type": url.includes("ebooksgratuits") ? "application/atom+xml" : url.endsWith(".epub") ? "application/epub+zip" : "text/html" } }));
    const handler = createSourceStatusHandler({ fetchImpl, allowOrigin: origin });
    const response = await handler(request("/api/sources/status", { headers: { Origin: origin } }));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect((await response.json()).sources).toEqual([
      expect.objectContaining({ providerId: "gutenberg", available: true, code: "AVAILABLE" }),
      expect.objectContaining({ providerId: "ebooks-gratuits", available: true, code: "AVAILABLE" }),
      expect.objectContaining({ providerId: "fadedpage", available: true, code: "AVAILABLE" }),
      expect.objectContaining({ providerId: "epubbooks", available: true, code: "AVAILABLE" }),
    ]);
    expect(fetchImpl.mock.calls.find(([url]) => url.endsWith(".epub"))[1].method).toBe("HEAD");
    expect(fetchImpl.mock.calls.find(([url]) => url.includes("ebooksgratuits"))[0]).toBe("https://www.ebooksgratuits.com/opds/");
    await handler(request("/api/sources/status"));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.find(([url]) => url.includes("fadedpage"))).toEqual(["https://www.fadedpage.com/csearch.php", expect.objectContaining({ method: "HEAD" })]);
    expect(fetchImpl.mock.calls.find(([url]) => url.includes("epubbooks"))[0]).toBe("https://www.epubbooks.com/");
    expect((await handler(request("/api/sources/status", { headers: { Origin: "https://evil.test" } }))).status).toBe(403);
  });
  it("ne transforme pas une page HTML de blocage ou un timeout en pastille verte", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((url) => url.includes("ebooksgratuits") ? new Promise(() => {}) : Promise.resolve(new Response("blocked", { status: url.endsWith(".epub") ? 200 : 403, headers: { "Content-Type": "text/html" } })));
    const handler = createSourceStatusHandler({ fetchImpl, timeoutMs: 100 });
    const pending = handler(request("/api/sources/status"));
    await vi.advanceTimersByTimeAsync(100);
    expect((await (await pending).json()).sources).toEqual([
      expect.objectContaining({ providerId: "gutenberg", available: false, code: "SOURCE_UNAVAILABLE" }),
      expect.objectContaining({ providerId: "ebooks-gratuits", available: false, code: "SOURCE_TIMEOUT" }),
      expect.objectContaining({ providerId: "fadedpage", available: false, code: "SOURCE_UNAVAILABLE" }),
      expect.objectContaining({ providerId: "epubbooks", available: false, code: "SOURCE_UNAVAILABLE" }),
    ]);
  });
});

describe("relais Worker", () => {
  it("réutilise le middleware Gutenberg et fournit son EPUB intégral avec CORS", async () => {
    const zip = new JSZip(); zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const fetchImpl = vi.fn(async () => new Response(bytes, { headers: { "Content-Type": "application/epub+zip" } }));
    const handler = createGutenbergHandler({ fetchImpl, allowOrigin: origin });
    const response = await handler(request("/api/books/gutenberg/11.epub", { headers: { Origin: origin } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(await handler(request("/api/unknown"))).toBe(null);
  });
  it("achemine toutes les régions vers le même Durable Object et rejette les origines étrangères", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const env = { SOURCE_ALLOWED_ORIGIN: origin, SOURCES: { idFromName: vi.fn((name) => name), get: vi.fn(() => ({ fetch })) } };
    expect((await worker.fetch(request("/api/sources/status", { headers: { Origin: origin } }), env)).status).toBe(200);
    expect(env.SOURCES.idFromName).toHaveBeenCalledWith("fastreader-public-sources-v1");
    expect((await worker.fetch(request("/api/sources/status", { headers: { Origin: "https://evil.test" } }), env)).status).toBe(403);
    expect((await worker.fetch(request("/api/private"), env)).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("préserve la limite quotidienne ELG après recréation du processus grâce au stockage du Durable Object", async () => {
    const timestamps = Array.from({ length: 50 }, (_, index) => Date.now() - 1_000_000 + index * 12_100);
    const state = { storage: { get: vi.fn(async () => timestamps), put: vi.fn() } };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (let index = 0; index < 2; index++) {
      const object = new FastReaderSources(state, { SOURCE_ALLOWED_ORIGIN: origin });
      const response = await object.fetch(request("/api/books/ebooks-gratuits/637.epub", { headers: { Origin: origin } }));
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ error: { code: "SOURCE_DAILY_LIMIT" } });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(state.storage.put).not.toHaveBeenCalled();
  });
  it("préserve aussi l’espacement des acquisitions ELG après un redémarrage", async () => {
    const state = { storage: { get: vi.fn(async () => [Date.now() - 100]), put: vi.fn() } };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await new FastReaderSources(state, { SOURCE_ALLOWED_ORIGIN: origin }).fetch(request("/api/books/ebooks-gratuits/637.epub"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
