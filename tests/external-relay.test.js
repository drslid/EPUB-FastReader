// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAppServer } from "../server/app.js";

let catalog;
let relayConfiguration;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("MODE", "pages");
  vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "");
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const filename = new URL(url, "http://localhost").pathname.split("/").pop();
    return new Response(await readFile(resolve("public/catalog", filename)));
  }));
  catalog = await import("../src/catalog.js");
  ({ configuredGutenbergRelay: relayConfiguration } = await import("../src/sources/gutenberg.js"));
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const book = { id: "gutenberg-5711", title: "Germinal", providerId: "gutenberg" };
const epubResponse = () => new Response(new Uint8Array([0x50, 0x4b, 3, 4, 1]));

describe("raccordement Pages à un relais explicitement configuré", () => {
  it.each(["https://relay.example", "https://relay.example/", "https://relay.example/reader/v1", "https://relay.example:8443/reader/", "https://relay.example/api-v1.0"])("utilise la base HTTPS autorisée %s avec un identifiant Gutenberg uniquement", async (url) => {
    vi.stubEnv("VITE_GUTENBERG_RELAY_URL", url);
    const results = await catalog.searchBooks({ query: "germinal", provider: "gutenberg" });
    expect(results.books.length).toBeGreaterThan(0);
    expect(results.books.every((item) => item.downloadMode === "direct")).toBe(true);
    fetch.mockClear();
    fetch.mockResolvedValue(epubResponse());
    const file = await catalog.downloadBook({ ...book, downloadUrl: "https://evil.example/book.epub", sourceUrl: "https://evil.example" });
    expect(file.name).toBe("Germinal.epub");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`${url.replace(/\/$/u, "")}/api/books/gutenberg/5711.epub`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it.each(["", "http://relay.example", "//relay.example", "javascript:alert(1)", "https://user:password@relay.example", "https://relay.example?url=evil", "https://relay.example#fragment", "https://relay.example/path/../", "https://relay.example/%2e%2e", "https://relay.example\\evil", "https://relay.example/ file"])("conserve l’import manuel si la configuration est absente ou invalide : %s", async (url) => {
    vi.stubEnv("VITE_GUTENBERG_RELAY_URL", url);
    expect(relayConfiguration()).toBe("");
    const results = await catalog.searchBooks({ query: "germinal", provider: "gutenberg" });
    expect(results.books.every((item) => item.downloadMode === "manual")).toBe(true);
    fetch.mockClear();
    await expect(catalog.downloadBook(book)).rejects.toMatchObject({ code: "MANUAL_IMPORT_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejette une réponse redirigée et conserve le message de repli quand le relais est indisponible", async () => {
    vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "https://relay.example");
    const response = epubResponse();
    Object.defineProperty(response, "url", { value: "https://other.example/book.epub" });
    fetch.mockResolvedValue(response);
    await expect(catalog.downloadBook(book)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetch.mockRejectedValue(new TypeError("CORS blocked"));
    await expect(catalog.downloadBook(book)).rejects.toMatchObject({ code: "NETWORK", message: expect.stringContaining("Vérifiez votre connexion") });
  });

  it("ne change pas les livres intégrés et refuse les identifiants détournés sans réseau", async () => {
    vi.stubEnv("VITE_GUTENBERG_RELAY_URL", "https://relay.example");
    const bundled = await catalog.searchBooks({ provider: "selection" });
    expect(bundled.books.every((item) => item.downloadMode === "bundled")).toBe(true);
    for (const id of ["gutenberg-0", "gutenberg-01", "gutenberg-../1", "gutenberg-1?url=https://evil.example"])
      await expect(catalog.downloadBook({ ...book, id })).rejects.toMatchObject({ code: "INVALID_BOOK" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("conserve le relais même origine de la version Node quand aucune base externe n’est configurée", async () => {
    vi.stubEnv("MODE", "production");
    fetch.mockResolvedValue(epubResponse());
    await catalog.downloadBook(book);
    expect(fetch.mock.calls[0][0]).toBe("/api/books/gutenberg/5711.epub");
  });
});

describe("configuration d’origine du serveur Node", () => {
  it("charge GUTENBERG_ALLOWED_ORIGIN sans exposer cette autorisation aux fichiers statiques", async () => {
    vi.stubEnv("GUTENBERG_ALLOWED_ORIGIN", "https://drslid.github.io");
    const server = createAppServer({ relayOptions: { fetchImpl: vi.fn() } });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { request } = await import("node:http");
    const makeRequest = (path) => new Promise((resolve, reject) => {
      const pending = request({ hostname: "127.0.0.1", port: server.address().port, path, method: "OPTIONS", headers: { origin: "https://drslid.github.io", "access-control-request-method": "GET" } }, (response) => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
      });
      pending.on("error", reject); pending.end();
    });
    try {
      const response = await makeRequest("/api/books/gutenberg/5711.epub");
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("https://drslid.github.io");
      const health = await makeRequest("/api/health");
      expect(health.status).toBe(405);
      expect(health.headers["access-control-allow-origin"]).toBeUndefined();
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
