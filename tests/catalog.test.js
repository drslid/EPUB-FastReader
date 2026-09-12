// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import manifest from "../src/sources/catalog-manifest.json";

let catalog;
const nativeFetch = globalThis.fetch;
const catalogRoot = resolve("public/catalog");

async function realAssetResponse(url) {
  const filename = new URL(url, "http://localhost").pathname.split("/").pop();
  if (!/^[a-z]{2}-\d+-[a-f0-9]{12}\.json$/.test(filename))
    throw new Error(`Unexpected asset: ${url}`);
  return new Response(await readFile(resolve(catalogRoot, filename)), {
    headers: { "content-type": "application/json" },
  });
}
function epubResponse(headers = {}) {
  return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), {
    headers,
  });
}
const localBook = {
  id: "selection-le-horla",
  providerId: "selection",
  title: "Alice / lecture",
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(realAssetResponse));
  catalog = await import("../src/catalog.js");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("catalogue officiel local", () => {
  it("conserve la recherche sur Pages et distingue les livres intégrés des EPUB à importer", async () => {
    vi.stubEnv("MODE", "pages");
    const result = await catalog.searchBooks({ query: "germinal", provider: "all" });
    expect(result.books.length).toBeGreaterThan(0);
    expect(result.books.every((book) => book.downloadMode === "manual")).toBe(true);
    expect((await catalog.searchBooks({ provider: "selection" })).books).toHaveLength(9);
    expect((await catalog.searchBooks({ provider: "selection" })).books.every((book) => book.downloadMode === "bundled")).toBe(true);
  });

  it("explique l’import sur Pages sans appeler un relais inexistant", async () => {
    vi.stubEnv("MODE", "pages");
    await expect(catalog.downloadBook({ id: "gutenberg-5711", title: "Germinal" }))
      .rejects.toMatchObject({ code: "MANUAL_IMPORT_REQUIRED", message: expect.stringContaining("importez-le ici") });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cherche réellement Hugo et Les Misérables sans aucune API externe", async () => {
    const result = await catalog.searchBooks({
      provider: "gutenberg",
      query: "HUGO misérables",
    });
    expect(result.books.length).toBeGreaterThan(0);
    expect(
      result.books.every(
        (book) => /Hugo/.test(book.author) && /Misérables/i.test(book.title),
      ),
    ).toBe(true);
    expect(result.books[0]).toMatchObject({
      downloadMode: "direct",
      cover: null,
      providerId: "gutenberg",
    });
    expect(result.books[0].downloadUrl).toBeUndefined();
    expect(result.books[0].sourceUrl).toMatch(
      /^https:\/\/www.gutenberg.org\/ebooks\/\d+$/,
    );
    expect(result.countIsApproximate).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(manifest.languages.fr.files.length);
    expect(
      fetch.mock.calls.every(([url]) => url.startsWith("/catalog/fr-")),
    ).toBe(true);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });

  it("ignore accents, casse, apostrophes, tirets et ligatures", async () => {
    const search = (query) =>
      catalog.searchBooks({ provider: "gutenberg", query });
    expect((await search("miserables hugo")).books).toEqual(
      (await search("Misérables, HUGO")).books,
    );
    expect((await search("notre dame")).books).toEqual(
      (await search("NOTRE-DAME")).books,
    );
    expect((await search("oeuvres")).books).toEqual(
      (await search("œuvres")).books,
    );
  });

  it("pagine exactement le catalogue français et réutilise les fichiers chargés", async () => {
    const first = await catalog.searchBooks({ provider: "gutenberg" });
    const second = await catalog.searchBooks({
      provider: "gutenberg",
      page: 2,
    });
    expect(first.count).toBe(manifest.languages.fr.count);
    expect(first.books).toHaveLength(24);
    expect(second.books).toHaveLength(24);
    expect(first.hasNext).toBe(true);
    expect(
      second.books.some((book) =>
        first.books.some((item) => item.id === book.id),
      ),
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    const last = await catalog.searchBooks({
      provider: "gutenberg",
      page: Math.ceil(first.count / 24),
    });
    expect(last.hasNext).toBe(false);
    expect(last.books).toHaveLength(first.count % 24);
    expect(
      (await catalog.searchBooks({ provider: "gutenberg", page: 1000 })).books,
    ).toEqual([]);
  });

  it("cherche toutes les langues et déduplique les éditions multilingues", async () => {
    const result = await catalog.searchBooks({
      provider: "gutenberg",
      language: "all",
      query: "",
    });
    expect(result.count).toBe(manifest.count);
    expect(result.books).toHaveLength(24);
    expect(
      (
        await catalog.searchBooks({
          provider: "gutenberg",
          language: "en",
          query: "alice wonderland",
        })
      ).books.length,
    ).toBeGreaterThan(0);
  });

  it("renvoie un résultat vide honnête pour un titre absent ou une langue absente", async () => {
    expect(
      await catalog.searchBooks({ query: "zxqvunfindable978123", provider: "gutenberg" }),
    ).toMatchObject({ count: 0, books: [], warnings: [], hasNext: false });
    fetch.mockClear();
    expect(
      await catalog.searchBooks({ provider: "gutenberg", language: "zz" }),
    ).toMatchObject({ count: 0, books: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("utilise le préfixe GitHub Pages pour chaque fichier de recherche", async () => {
    vi.stubEnv("BASE_URL", "/EPUB-FastReader/");
    await catalog.searchBooks({ query: "Verne", provider: "gutenberg" });
    expect(
      fetch.mock.calls.every(([url]) =>
        url.startsWith("/EPUB-FastReader/catalog/fr-"),
      ),
    ).toBe(true);
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { language: "fr&copyright=true" },
    { query: "a".repeat(201) },
  ])("valide les paramètres avant le chargement : %j", async (params) => {
    await expect(catalog.searchBooks(params)).rejects.toMatchObject({
      code: "INVALID_QUERY",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "<html>maintenance</html>",
    "{}",
    JSON.stringify({
      version: 1,
      language: "fr",
      authors: ["Auteur"],
      books: [[1, "Titre", 99, ["fr"], 0]],
    }),
  ])("signale un fichier illisible ou invalide", async (response) => {
    fetch.mockImplementation(() => Promise.resolve(new Response(response)));
    await expect(
      catalog.searchBooks({ provider: "gutenberg" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("refuse une redirection de l’index vers un domaine externe", async () => {
    fetch.mockImplementation(async (url) => {
      const response = await realAssetResponse(url);
      Object.defineProperty(response, "url", {
        value: "https://evil.test/index.json",
      });
      return response;
    });
    await expect(
      catalog.searchBooks({ provider: "gutenberg" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("respecte l’annulation avant et pendant le chargement", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      catalog.searchBooks({ signal: aborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    const controller = new AbortController();
    const result = expect(
      catalog.searchBooks({ provider: "gutenberg", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await result;
  });

  it("vérifie les empreintes et limites de tous les fichiers réellement publiés", async () => {
    const allIds = new Set();
    let totalBytes = 0;
    for (const [language, metadata] of Object.entries(manifest.languages)) {
      let count = 0;
      for (const file of metadata.files) {
        const bytes = await readFile(resolve(catalogRoot, file));
        totalBytes += bytes.length;
        expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
        expect(file).toContain(
          createHash("sha256").update(bytes).digest("hex").slice(0, 12),
        );
        const data = JSON.parse(bytes);
        expect(data.language).toBe(language);
        expect(data.books.length).toBeLessThanOrEqual(2500);
        count += data.books.length;
        data.books.forEach((row) => allIds.add(row[0]));
      }
      expect(count).toBe(metadata.count);
    }
    expect(allIds.size).toBe(manifest.count);
    expect(totalBytes).toBeLessThan(8 * 1024 * 1024);
  });

  it("effectue une vraie requête HTTP sur les fichiers officiels servis localement", async () => {
    const server = createServer(async (req, res) => {
      try {
        const response = await realAssetResponse(req.url);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      vi.stubEnv("BASE_URL", `http://127.0.0.1:${server.address().port}/`);
      vi.stubGlobal("fetch", nativeFetch);
      const result = await catalog.searchBooks({ query: "notre dame hugo" });
      expect(result.books[0].id).toBe("selection-notre-dame-paris");
      expect(result.books.some((book) => book.providerId === "gutenberg")).toBe(
        true,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("téléchargement des EPUB intégrés et du catalogue via le relais", () => {
  it("télécharge Gutenberg par son identifiant sans transmettre une URL injectée", async () => {
    fetch.mockResolvedValue(epubResponse());
    const file = await catalog.downloadBook({
        id: "gutenberg-11",
        title: "Alice",
        downloadUrl: "https://evil.test/epub",
    });
    expect(file.name).toBe("Alice.epub");
    expect(file.type).toBe("application/epub+zip");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/api/books/gutenberg/11.epub",
      expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
    );
    expect(catalog.providers.find((provider) => provider.id === "gutenberg")).toMatchObject({
      capabilities: { search: true, download: true, bundled: false },
    });
  });

  it("résout le relais sous le préfixe de l’application et valide son URL finale", async () => {
    vi.stubEnv("BASE_URL", "/lecteur/");
    const response = epubResponse();
    Object.defineProperty(response, "url", { value: "http://localhost/lecteur/api/books/gutenberg/11.epub" });
    fetch.mockResolvedValue(response);
    await catalog.downloadBook({ id: "gutenberg-11", title: "Alice" });
    expect(fetch.mock.calls[0][0]).toBe("/lecteur/api/books/gutenberg/11.epub");
    const redirected = epubResponse();
    Object.defineProperty(redirected, "url", { value: "https://evil.test/file.epub" });
    fetch.mockResolvedValue(redirected);
    await expect(catalog.downloadBook({ id: "gutenberg-11", title: "Alice" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each(["gutenberg-0", "gutenberg-011", "gutenberg-../11", "gutenberg-11?url=https://evil.test", "gutenberg-1234567890"])(
    "rejette les identifiants détournés avant toute requête : %s", async (id) => {
      await expect(catalog.downloadBook({ id, providerId: "gutenberg", title: "Alice" }))
        .rejects.toMatchObject({ code: "INVALID_BOOK" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("explique le premier téléchargement quand le navigateur est hors ligne", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(catalog.downloadBook({ id: "gutenberg-11", title: "Alice" }))
      .rejects.toMatchObject({ code: "OFFLINE", message: expect.stringContaining("première fois") });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retourne un vrai File EPUB avec un nom utilisable pour une édition intégrée", async () => {
    fetch.mockResolvedValue(epubResponse());
    const file = await catalog.downloadBook(localBook);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("Alice - lecture.epub");
    expect(file.type).toBe("application/epub+zip");
    expect(file.size).toBe(7);
  });

  it("signale les erreurs HTTP, réseau et un HTML à la place d’un EPUB", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(catalog.downloadBook(localBook)).rejects.toMatchObject({
      code: "NETWORK",
    });
    fetch.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(catalog.downloadBook(localBook)).rejects.toMatchObject({
      code: "HTTP",
    });
    fetch.mockResolvedValue(new Response("<html>Access denied</html>"));
    await expect(catalog.downloadBook(localBook)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("refuse un fichier annoncé au-delà de 30 Mio sans le lire", async () => {
    const response = epubResponse({
      "content-length": String(30 * 1024 * 1024 + 1),
    });
    const reader = vi.spyOn(response.body, "getReader");
    fetch.mockResolvedValue(response);
    await expect(catalog.downloadBook(localBook)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(reader).not.toHaveBeenCalled();
  });

  it("arrête un flux trop volumineux même si sa taille annoncée est fausse", async () => {
    const chunk = new Uint8Array(16 * 1024 * 1024);
    let canceled = false;
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "content-length": "10" } },
      ),
    );
    await expect(catalog.downloadBook(localBook)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(canceled).toBe(true);
  });

  it("borne le temps d’attente et nettoie son délai", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    const result = expect(
      catalog.downloadBook(localBook),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accorde au relais 40 secondes puis arrête la requête et nettoie son délai", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, { signal }) => new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
      ),
    );
    const result = expect(catalog.downloadBook({ id: "gutenberg-11", title: "Alice" }))
      .rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(40_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
