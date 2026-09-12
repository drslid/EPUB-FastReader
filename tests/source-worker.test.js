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
      expect.objectContaining({ providerId: "ebookzy", available: true, code: "AVAILABLE" }),
      expect.objectContaining({ providerId: "atramenta", available: true, code: "AVAILABLE" }),
      expect.objectContaining({ providerId: "loyalbooks", available: true, code: "AVAILABLE" }),
    ]);
    expect(fetchImpl.mock.calls.find(([url]) => url.endsWith(".epub"))[1].method).toBe("HEAD");
    expect(fetchImpl.mock.calls.find(([url]) => url.includes("ebooksgratuits"))[0]).toBe("https://www.ebooksgratuits.com/opds/");
    await handler(request("/api/sources/status"));
    expect(fetchImpl).toHaveBeenCalledTimes(7);
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
      expect.objectContaining({ providerId: "ebookzy", available: false, code: "SOURCE_UNAVAILABLE" }),
      expect.objectContaining({ providerId: "atramenta", available: false, code: "SOURCE_UNAVAILABLE" }),
      expect.objectContaining({ providerId: "loyalbooks", available: false, code: "SOURCE_UNAVAILABLE" }),
    ]);
  });
});

describe("relais Worker", () => {
  it("remplace une disponibilité en cache lorsque le quota Atramenta est atteint, puis vérifie son expiration", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 8, 12, 12);
    vi.setSystemTime(now);
    const records = new Map();
    const storage = { get: vi.fn(async (key) => records.get(key)), put: vi.fn(async (key, value) => records.set(key, value)) };
    const fetch = vi.fn(async (url) => new Response(null, { headers: { "Content-Type": url.includes("ebooksgratuits") ? "application/atom+xml" : url.endsWith(".epub") ? "application/epub+zip" : "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    const object = new FastReaderSources({ storage }, { SOURCE_ALLOWED_ORIGIN: origin });
    const status = async () => (await (await object.fetch(request("/api/sources/status"))).json()).sources.find((source) => source.providerId === "atramenta");
    expect(await status()).toMatchObject({ available: true, code: "AVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(7);

    const timestamps = Array(4).fill(now - 86_400_000 + 60_000);
    records.set("atramenta-download-timestamps", timestamps);
    expect(await status()).toMatchObject({ available: false, code: "SOURCE_DAILY_LIMIT", retryAfter: 60 });
    expect(fetch).toHaveBeenCalledTimes(7);
    vi.setSystemTime(now + 30_000);
    expect(await status()).toMatchObject({ available: false, code: "SOURCE_DAILY_LIMIT", retryAfter: 30 });
    expect(fetch).toHaveBeenCalledTimes(7);

    vi.setSystemTime(now + 60_000);
    expect(await status()).toMatchObject({ available: true, code: "AVAILABLE" });
    // Other source checks remain cached; Atramenta must be checked anew.
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(fetch.mock.calls.filter(([url]) => url.includes("atramenta.net"))).toHaveLength(2);
    expect(records.get("atramenta-download-timestamps")).toEqual(timestamps);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it("ne sonde jamais Atramenta pendant un bloc persistant, y compris après recréation du Worker", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 8, 12, 12);
    vi.setSystemTime(now);
    const records = new Map([["atramenta-download-block", { version: 1, source: { until: now + 600_000, scope: "source", status: 503, code: "SOURCE_BUSY", message: "La source demande de patienter." }, downloads: null }]]);
    const storage = { get: vi.fn(async (key) => records.get(key)), put: vi.fn() };
    const fetch = vi.fn(async (url) => new Response(null, { headers: { "Content-Type": url.includes("ebooksgratuits") ? "application/atom+xml" : url.endsWith(".epub") ? "application/epub+zip" : "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    for (let index = 0; index < 2; index++) {
      const object = new FastReaderSources({ storage }, { SOURCE_ALLOWED_ORIGIN: origin });
      const response = await object.fetch(request("/api/sources/status", { headers: { Origin: origin } }));
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect((await response.json()).sources.find((source) => source.providerId === "atramenta")).toMatchObject({ available: false, code: "SOURCE_BUSY", retryAfter: 600 });
    }
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(fetch.mock.calls.some(([url]) => url.includes("atramenta.net"))).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it("expose une connexion exigée et ne masque pas une restriction illisible derrière une pastille verte", async () => {
    const now = Date.now();
    const storage = { get: vi.fn(async (key) => key === "atramenta-download-block" ? { scope: "downloads", status: 403, code: "SOURCE_LOGIN_REQUIRED", message: "Connexion exigée", until: now + 120_000 } : []), put: vi.fn() };
    const fetch = vi.fn(async (url) => new Response(null, { headers: { "Content-Type": url.includes("ebooksgratuits") ? "application/atom+xml" : url.endsWith(".epub") ? "application/epub+zip" : "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    const object = new FastReaderSources({ storage }, { SOURCE_ALLOWED_ORIGIN: origin });
    const status = async () => (await (await object.fetch(request("/api/sources/status"))).json()).sources.find((source) => source.providerId === "atramenta");
    const blocked = await status();
    expect(blocked).toMatchObject({ available: false, code: "SOURCE_LOGIN_REQUIRED" });
    expect(blocked.retryAfter).toBeGreaterThan(0);
    storage.get.mockRejectedValue(new Error("Storage unavailable"));
    expect(await status()).toMatchObject({ available: false, code: "SOURCE_UNAVAILABLE", retryAfter: 30 });
    expect(fetch.mock.calls.some(([url]) => url.includes("atramenta.net"))).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
  });
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
  it("préserve le quota partagé Atramenta après redémarrage sans contacter la source", async () => {
    const timestamps = Array.from({ length: 4 }, (_, index) => Date.now() - 60_000 + index * 1000);
    const records = new Map([["atramenta-download-timestamps", timestamps]]);
    const storage = { get: vi.fn(async (key) => records.get(key)), put: vi.fn(async (key, value) => records.set(key, value)) };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (let index = 0; index < 2; index++) {
      const response = await new FastReaderSources({ storage }, { SOURCE_ALLOWED_ORIGIN: origin }).fetch(request("/api/books/atramenta/15038-un-coeur-simple.epub", { headers: { Origin: origin } }));
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ error: { code: "SOURCE_DAILY_LIMIT" } });
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(records.get("atramenta-download-timestamps")).toEqual(timestamps);
    expect(storage.put.mock.calls.every(([key]) => key === "atramenta-download-block")).toBe(true);
  });
});
