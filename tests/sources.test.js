// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../src/sources/catalog-manifest.json";
let downloadBook, providers, searchBooks, sourceManifests;
import { defineSource } from "../src/sources/source.js";

beforeEach(async () => {
  vi.resetModules();
  ({ downloadBook, providers, searchBooks, sourceManifests } =
    await import("../src/catalog.js"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const name = new URL(url, "http://localhost").pathname.split("/").pop();
      if (!/^[a-z]{2}-\d+-[a-f0-9]{12}\.json$/.test(name))
        throw new Error("Unexpected request");
      return new Response(await readFile(resolve("public/catalog", name)));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function epubResponse() {
  return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]));
}

describe("plugins de sources versionnés", () => {
  it("expose les versions et capacités de sources explicitement enregistrées", () => {
    expect(sourceManifests.map((manifest) => manifest.id)).toEqual([
      "selection",
      "all",
      "gutenberg",
      "standard-ebooks",
      "ebooks-gratuits",
      "public-domain-library",
    ]);
    expect(
      providers.find((provider) => provider.id === "selection"),
    ).toMatchObject({
      version: "1.1.0",
      apiVersion: 1,
      searchable: true,
      capabilities: { search: true, download: true, bundled: true },
    });
    expect(Object.isFrozen(sourceManifests)).toBe(true);
    expect(Object.isFrozen(sourceManifests[0].capabilities)).toBe(true);
  });

  it("refuse une version de contrat incompatible ou une capacité sans implémentation", () => {
    const manifest = { ...sourceManifests[0] };
    expect(() => defineSource({ manifest })).toThrow(TypeError);
    expect(() =>
      defineSource({
        manifest: { ...manifest, apiVersion: 2 },
        search() {},
        download() {},
      }),
    ).toThrow(TypeError);
    expect(() =>
      defineSource({
        manifest: { ...manifest, policy: "javascript:alert(1)" },
        search() {},
        download() {},
      }),
    ).toThrow(TypeError);
  });

  it("n’accepte pas un nom de plugin distant comme source", async () => {
    await expect(
      searchBooks({ provider: "https://evil.test/plugin.js" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("sélection intégrée", () => {
  it("propose neuf livres français complets avec provenance sans requête distante", async () => {
    const result = await searchBooks({ provider: "selection" });
    expect(result).toMatchObject({ count: 9, hasNext: false });
    expect(result.books.slice(0, 3).map((book) => book.title)).toEqual([
      "Le Horla",
      "Trois contes",
      "Candide, ou l’optimisme",
    ]);
    expect(result.books[0]).toMatchObject({
      providerId: "selection",
      downloadMode: "bundled",
      language: "fr",
      sourceUrl: "https://www.gutenberg.org/ebooks/10775",
      downloadUrl: "/books/le-horla.epub",
      rightsUrl: "/books/NOTICE.html",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("filtre titre et auteur sans accents, tient compte de la langue et des pages", async () => {
    expect(
      (
        await searchBooks({
          provider: "selection",
          query: "  FLÂUBERT  contes ",
        })
      ).books,
    ).toHaveLength(1);
    expect(
      (await searchBooks({ provider: "selection", language: "en" })).count,
    ).toBe(0);
    expect(
      (await searchBooks({ provider: "selection", language: "all" })).count,
    ).toBe(9);
    expect(await searchBooks({ provider: "selection", page: 2 })).toMatchObject({
      books: [],
      count: 9,
      hasNext: false,
    });
  });

  it("résout les fichiers et notices sous le préfixe GitHub Pages", async () => {
    vi.stubEnv("BASE_URL", "/EPUB-FastReader/");
    const { books } = await searchBooks({ provider: "selection" });
    expect(books[0].downloadUrl).toBe("/EPUB-FastReader/books/le-horla.epub");
    expect(books[0].rightsUrl).toBe("/EPUB-FastReader/books/NOTICE.html");
    fetch.mockResolvedValue(epubResponse());
    await downloadBook(books[0]);
    expect(fetch.mock.calls[0][0]).toBe("/EPUB-FastReader/books/le-horla.epub");
  });

  it("télécharge le fichier autorisé même si une URL injectée tente de le remplacer", async () => {
    const { books } = await searchBooks({ provider: "selection" });
    fetch.mockResolvedValue(epubResponse());
    const file = await downloadBook({
      ...books[0],
      downloadUrl: "https://evil.test/file.epub",
    });
    expect(file.name).toBe("Le Horla.epub");
    expect(fetch.mock.calls[0][0]).toBe("/books/le-horla.epub");
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
  });

  it("rejette un identifiant inconnu ou détourné d’un autre plugin", async () => {
    for (const id of [
      "selection-../../private",
      "gutenberg-11",
      "selection-inconnu",
    ]) {
      await expect(
        downloadBook({ id, providerId: "selection", title: "Livre" }),
      ).rejects.toMatchObject({ code: "INVALID_BOOK" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejette une redirection distante et un HTML renvoyé par un hébergeur", async () => {
    const { books } = await searchBooks({ provider: "selection" });
    const redirected = epubResponse();
    Object.defineProperty(redirected, "url", {
      value: "https://evil.test/file.epub",
    });
    fetch.mockResolvedValue(redirected);
    await expect(downloadBook(books[0])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    fetch.mockResolvedValue(
      new Response("<!doctype html><html>not found</html>"),
    );
    await expect(downloadBook(books[0])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("respecte une annulation dans la recherche locale et le téléchargement", async () => {
    const { books } = await searchBooks({ provider: "selection" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchBooks({ provider: "selection", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      downloadBook(books[0], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("recherche commune", () => {
  it("privilégie les neuf livres intégrés, déduplique et compte toutes les éditions exactement", async () => {
    const result = await searchBooks({ provider: "all" });
    const selection = await searchBooks({ provider: "selection" });
    expect(result.books.slice(0, 9).map((book) => book.id)).toEqual(
      selection.books.map((book) => book.id),
    );
    expect(
      result.books.slice(0, 9).every((book) => book.downloadMode === "bundled"),
    ).toBe(true);
    expect(
      new Set(result.books.map((book) => book.canonicalSourceId)).size,
    ).toBe(result.books.length);
    expect(result).toMatchObject({
      count: manifest.languages.fr.count,
      countIsApproximate: false,
      hasNext: true,
      warnings: [],
    });
  });

  it("garde la sélection et affiche une indisponibilité explicite si le fichier d’index manque", async () => {
    fetch.mockRejectedValue(new TypeError("Offline"));
    const result = await searchBooks({ provider: "all", query: "Horla" });
    expect(result.books).toHaveLength(1);
    expect(result.warnings).toEqual([
      {
        providerId: "gutenberg",
        code: "NETWORK",
        message: expect.stringContaining("n’a pas pu être chargé"),
      },
      {
        providerId: "ebooks-gratuits",
        code: "NETWORK",
        message: expect.stringContaining("catalogue est inaccessible"),
      },
    ]);
    expect(result.count).toBe(1);
  });

  it("ne répète pas la sélection sur les pages suivantes, sans trou de pagination", async () => {
    const first = await searchBooks({ provider: "all" });
    const second = await searchBooks({ provider: "all", page: 2 });
    expect(first.books).toHaveLength(24);
    expect(second.books).toHaveLength(24);
    expect(second.books.every((book) => book.providerId === "gutenberg")).toBe(
      true,
    );
    expect(
      second.books.some((book) =>
        first.books.some(
          (item) => item.canonicalSourceId === book.canonicalSourceId,
        ),
      ),
    ).toBe(false);
    expect(second.count).toBe(first.count);
  });

  it("cherche titre et auteur sans ponctuation dans la sélection comme dans le catalogue", async () => {
    const result = await searchBooks({ query: "NOTRE DAME HUGO" });
    expect(result.books[0].id).toBe("selection-notre-dame-paris");
    expect(result.books.some((book) => book.id === "gutenberg-19657")).toBe(
      false,
    );
  });

  it("ne transforme pas une annulation en faux résultat sans livre", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchBooks({ provider: "all", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
