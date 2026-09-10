import { describe, expect, it } from "vitest";
import { partitionSearchResults } from "../src/search-results.js";

const localBooks = [
  { id: "local-hugo", title: "Les Misérables", author: "Victor Hugo", language: "fr" },
  { id: "local-verne", title: "Voyage au centre de la Terre", author: "Jules Verne", language: "fr" },
  { id: "local-heart", title: "Le Cœur et l’âme", author: "Éloïse Ægir", language: "en" },
];

const sourceBook = {
  id: "gutenberg-135",
  canonicalSourceId: "gutenberg:135",
  title: "Les Misérables",
  author: "Victor Hugo",
  language: "fr",
};

describe("unified library and source results", () => {
  it("finds local titles and authors regardless of case, accents, ligatures or punctuation", () => {
    for (const query of ["MISERABLES hugo", "  les—misérables!! ", "hugo, victor"]) {
      expect(partitionSearchResults({ books: localBooks, query }).localBooks).toEqual([localBooks[0]]);
    }
    expect(partitionSearchResults({ books: localBooks, query: "coeur ame aegir" }).localBooks).toEqual([localBooks[2]]);
    expect(partitionSearchResults({ books: localBooks, query: "L'âme" }).localBooks).toEqual([localBooks[2]]);
  });

  it("requires every query term and preserves the library's recent-first order", () => {
    const books = [localBooks[1], localBooks[0], { id: "second-hugo", title: "Notre-Dame de Paris", author: "Victor Hugo" }];
    expect(partitionSearchResults({ books, query: "victor" }).localBooks).toEqual(books.slice(1));
    expect(partitionSearchResults({ books, query: "victor verne" }).localBooks).toEqual([]);
  });

  it("also finds the catalogue title and author retained with the selected cover", () => {
    const book = {
      id: "imported-hash",
      title: "Fantine",
      author: "Hugo, Victor, 1802-1885",
      source: { presentation: { version: 1, title: "Les Misérables — Tome I", author: "Victor Hugo" } },
    };
    for (const query of ["les miserables hugo", "fantine", "tome i victor"]) {
      expect(partitionSearchResults({ books: [book], query }).localBooks).toEqual([book]);
    }
  });

  it("keeps local matches available while a remote search has no results", () => {
    const result = partitionSearchResults({ books: localBooks, catalog: [], query: "coeur" });
    expect(result).toEqual({ localBooks: [localBooks[2]], remoteBooks: [], alreadyOwnedCount: 0 });
  });

  it("returns all local books for an empty or punctuation-only browse query", () => {
    for (const query of ["", "   ", "—!? "]) {
      expect(partitionSearchResults({ books: localBooks, query }).localBooks).toEqual(localBooks);
    }
  });

  it("removes a matching source edition from the remote page and keeps the stored local entry", () => {
    const local = { ...localBooks[0], source: { canonicalSourceId: sourceBook.canonicalSourceId }, position: { progress: 0.42 } };
    const remote = { id: "other", title: "Quatrevingt-treize", author: "Victor Hugo" };
    const result = partitionSearchResults({ books: [local], catalog: [sourceBook, remote], query: "hugo" });
    expect(result).toEqual({ localBooks: [local], remoteBooks: [remote], alreadyOwnedCount: 1 });
    expect(result.localBooks[0]).toBe(local);
    expect(result.remoteBooks[0]).toBe(remote);
  });

  it.each([
    { selection: "gutenberg-135" },
    { bookId: "gutenberg-135" },
    { canonicalSourceId: "gutenberg:135" },
  ])("recognizes historical saved source identities: %j", (source) => {
    const local = { id: "old-import", title: "Un titre interne différent", source };
    const result = partitionSearchResults({ books: [local], catalog: [sourceBook] });
    expect(result).toEqual({ localBooks: [local], remoteBooks: [], alreadyOwnedCount: 1 });
  });

  it("recognizes an old catalogue ID or unnamed matching import", () => {
    for (const book of [{ id: sourceBook.id }, localBooks[0]]) {
      expect(partitionSearchResults({ books: [book], catalog: [sourceBook] }).remoteBooks).toEqual([]);
    }
  });

  it("promotes an owned remote result even if an old EPUB title lacks the searched catalogue alias", () => {
    const oldImport = {
      id: "old-hash",
      title: "Fantine",
      author: "V. H.",
      source: { canonicalSourceId: sourceBook.canonicalSourceId },
    };
    const otherLocal = { id: "recent", title: "Victor Hugo, une vie", author: "Autre auteur" };
    const result = partitionSearchResults({ books: [otherLocal, oldImport], catalog: [sourceBook], query: "hugo" });
    expect(result).toEqual({ localBooks: [otherLocal, oldImport], remoteBooks: [], alreadyOwnedCount: 1 });
  });

  it("retains explicitly different editions of the same named work", () => {
    const local = { ...localBooks[0], source: { canonicalSourceId: "gutenberg:17489" } };
    expect(partitionSearchResults({ books: [local], catalog: [sourceBook], query: "hugo" })).toEqual({
      localBooks: [local], remoteBooks: [sourceBook], alreadyOwnedCount: 0,
    });
  });

  it("retains a translation while accepting compatible language tags for unnamed imports", () => {
    const local = { ...localBooks[0], language: "fr-FR" };
    const translated = { ...sourceBook, id: "gutenberg-translation", canonicalSourceId: "gutenberg:translation", language: "en" };
    const result = partitionSearchResults({ books: [local], catalog: [translated, { ...sourceBook, language: "fra" }], query: "hugo" });
    expect(result).toEqual({ localBooks: [local], remoteBooks: [translated], alreadyOwnedCount: 1 });
  });

  it("does not apply source or language restrictions to matching private books", () => {
    const local = { ...localBooks[0], language: "en", source: { provider: "manual-import" } };
    const result = partitionSearchResults({ books: [local], catalog: [sourceBook], query: "hugo", language: "fr", provider: "gutenberg" });
    expect(result.localBooks).toEqual([local]);
    expect(result.remoteBooks).toEqual([sourceBook]);
  });

  it("counts removed entries on this page without changing remote result order", () => {
    const remaining = [{ id: "z", title: "Zulu" }, { id: "a", title: "Alpha" }];
    const result = partitionSearchResults({ books: [localBooks[0]], catalog: [remaining[0], sourceBook, remaining[1], sourceBook] });
    expect(result.remoteBooks).toEqual(remaining);
    expect(result.alreadyOwnedCount).toBe(2);
  });

  it("does not mutate catalogue, library or nested source metadata", () => {
    const books = [localBooks[0], { ...localBooks[1], source: { presentation: { title: "Voyage", author: "Verne" } } }];
    const catalog = [sourceBook, { id: "new", title: "Nouveau livre" }];
    const snapshot = structuredClone({ books, catalog });
    partitionSearchResults({ books, catalog, query: "hugo" });
    expect({ books, catalog }).toEqual(snapshot);
  });

  it("handles missing arrays, malformed records and incomplete book metadata", () => {
    expect(partitionSearchResults()).toEqual({ localBooks: [], remoteBooks: [], alreadyOwnedCount: 0 });
    expect(partitionSearchResults({ books: null, catalog: "invalid", query: null })).toEqual({ localBooks: [], remoteBooks: [], alreadyOwnedCount: 0 });
    expect(partitionSearchResults({ books: [null, "invalid", [], { id: "untitled" }], catalog: [null, false, [], { id: "other" }], query: "missing" })).toEqual({
      localBooks: [], remoteBooks: [{ id: "other" }], alreadyOwnedCount: 0,
    });
  });
});
