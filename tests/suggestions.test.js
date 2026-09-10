import { describe, expect, it } from "vitest";
import {
  getRecommendationReason,
  findLibraryBook,
  selectSuggestions,
} from "../src/suggestions.js";

const catalog = Object.freeze(
  [
    ["horla", "Guy de Maupassant", "Nouvelles · Fantastique"],
    ["contes", "Gustave Flaubert", "Contes · Classique"],
    ["candide", "Voltaire", "Aventure · Philosophie"],
    ["tour", "Jules Verne", "Aventure · Voyage"],
    ["voyage", "Jules Verne", "Aventure · Science-fiction"],
    ["lieues", "Jules Verne", "Aventure · Océan"],
    ["notre-dame", "Victor Hugo", "Roman · Histoire"],
    ["bovary", "Gustave Flaubert", "Roman · Classique"],
    ["condamne", "Victor Hugo", "Roman court · Société"],
  ].map(([id, author, genre]) =>
    Object.freeze({
      id: `selection-${id}`,
      canonicalSourceId: `gutenberg:${id}`,
      title: id,
      author,
      genre,
      downloadMode: "bundled",
    }),
  ),
);

const ids = (books) => books.map((book) => book.id);
const owned = (book, progress = 0) => ({
  id: `local-${book.id}`,
  title: book.title,
  author: book.author,
  source: { canonicalSourceId: book.canonicalSourceId, bookId: book.id },
  position: { progress },
});

describe("suggestions locales de lectures immédiates", () => {
  it("reste déterministe et ne dépend pas de l’ordre du catalogue", () => {
    const options = { catalog, seed: "2026-09-10:0" };
    const result = selectSuggestions(options);
    expect(result).toHaveLength(3);
    expect(selectSuggestions(options)).toEqual(result);
    expect(
      selectSuggestions({ ...options, catalog: [...catalog].reverse() }),
    ).toEqual(result);
    expect(result.every((book) => catalog.includes(book))).toBe(true);
  });

  it("fait varier les sélections selon la graine et couvre les neuf titres", () => {
    const rounds = Array.from({ length: 30 }, (_, index) =>
      selectSuggestions({ catalog, seed: `2026-09-10:${index}` }),
    );
    expect(
      new Set(rounds.map((books) => ids(books).join(","))).size,
    ).toBeGreaterThan(10);
    expect(new Set(rounds.flatMap(ids)).size).toBe(9);
  });

  it("renouvelle tout le groupe précédent lorsque le catalogue le permet", () => {
    const first = selectSuggestions({ catalog, seed: "rotation:0" });
    const second = selectSuggestions({
      catalog,
      seed: "rotation:1",
      previousIds: Object.freeze(ids(first)),
    });
    expect(second).toHaveLength(3);
    expect(second.every((book) => !first.includes(book))).toBe(true);
    expect(new Set(ids(second)).size).toBe(second.length);
  });

  it("renouvelle les trois dernières découvertes même lorsque les six autres livres sont déjà connus", () => {
    const library = catalog.slice(0, 6).map((book) => owned(book, 0.42));
    const first = selectSuggestions({ catalog, library, seed: "first" });
    expect(new Set(first)).toEqual(new Set(catalog.slice(6)));
    const next = selectSuggestions({
      catalog,
      library,
      seed: "next",
      previousIds: ids(first),
    });
    expect(next).toHaveLength(3);
    expect(next.every((book) => !first.includes(book))).toBe(true);
    expect(next.every((book) => catalog.slice(0, 6).includes(book))).toBe(true);
  });

  it("remplit une petite sélection sans doubler les livres déjà suggérés", () => {
    const small = catalog.slice(0, 2);
    const result = selectSuggestions({
      catalog: small,
      previousIds: ids(small),
      limit: 5,
    });
    expect(new Set(result)).toEqual(new Set(small));
    expect(result).toHaveLength(2);
  });

  it("préfère les livres absents puis non commencés aux lectures en cours ou terminées", () => {
    const library = catalog.slice(0, 7).map((book) => owned(book, 0.5));
    library[0].position.progress = 0;
    library[1].position.progress = 1;
    const result = selectSuggestions({ catalog, library, limit: 4 });
    expect(new Set(result.slice(0, 2))).toEqual(new Set(catalog.slice(7)));
    expect(result[2]).toBe(catalog[0]);
    expect(
      library.find((book) => book.source.bookId === result[3].id).position
        .progress,
    ).toBe(0.5);
  });

  it("reconnaît les imports via source canonique, identifiant de plugin ou nom de l’œuvre", () => {
    const library = [
      {
        id: "sha1",
        source: { canonicalSourceId: catalog[0].canonicalSourceId },
      },
      { id: "sha2", source: { selection: catalog[1].id } },
      { id: "sha3", title: "  CANDIDE  ", author: "VOLTAIRE" },
    ];
    const result = selectSuggestions({ catalog, library, limit: 6 });
    expect(new Set(result)).toEqual(new Set(catalog.slice(3)));
  });

  it("reste utile quand tous les livres sont dans la bibliothèque", () => {
    const library = catalog.map((book, index) =>
      owned(book, index === 0 ? 1 : 0.42),
    );
    const result = selectSuggestions({ catalog, library, limit: 3 });
    expect(result).toHaveLength(3);
    expect(result).not.toContain(catalog[0]);
    for (const book of result)
      expect(getRecommendationReason(book, library)).toBe("Reprendre à 42 %");
  });

  it("varie les auteurs et les genres lorsque la sélection le permet", () => {
    for (let seed = 0; seed < 20; seed++) {
      const result = selectSuggestions({ catalog, seed });
      expect(new Set(result.map((book) => book.author)).size).toBe(3);
      const firstGenres = result.map((book) => book.genre.split(" · ")[0]);
      expect(new Set(firstGenres).size).toBe(3);
    }
  });

  it("n’invente pas de diversité quand le sous-ensemble ne la permet pas", () => {
    const sameAuthor = catalog.filter((book) => book.author === "Jules Verne");
    expect(new Set(selectSuggestions({ catalog: sameAuthor }))).toEqual(
      new Set(sameAuthor),
    );
  });

  it("écarte les sources externes, entrées invalides et doublons d’édition ou d’œuvre", () => {
    const mixed = [
      null,
      { ...catalog[0], downloadMode: "external" },
      catalog[1],
      { ...catalog[1] },
      { ...catalog[1], id: "same-canonical" },
      {
        ...catalog[1],
        id: "same-work",
        canonicalSourceId: "different-edition",
      },
      { downloadMode: "bundled" },
      catalog[2],
    ];
    expect(new Set(selectSuggestions({ catalog: mixed, limit: 9 }))).toEqual(
      new Set([catalog[1], catalog[2]]),
    );
  });

  it("gère les listes vides et les limites invalides sans accès à des valeurs globales", () => {
    expect(selectSuggestions()).toEqual([]);
    expect(selectSuggestions({ catalog: null, library: null })).toEqual([]);
    for (const limit of [0, -1, NaN, Infinity, "3", null])
      expect(selectSuggestions({ catalog, limit })).toEqual([]);
    expect(selectSuggestions({ catalog, limit: 2.9 })).toHaveLength(2);
    expect(selectSuggestions({ catalog, limit: 50 })).toHaveLength(
      catalog.length,
    );
  });

  it("ne modifie aucune entrée, bibliothèque, liste précédente ou objet imbriqué", () => {
    const local = Object.freeze({
      ...owned(catalog[0], 0.2),
      source: Object.freeze({
        canonicalSourceId: catalog[0].canonicalSourceId,
      }),
      position: Object.freeze({ progress: 0.2 }),
    });
    const library = Object.freeze([local]);
    const previousIds = Object.freeze([catalog[1].id]);
    const before = JSON.stringify({ catalog, library, previousIds });
    selectSuggestions({ catalog, library, previousIds, seed: "immutable" });
    getRecommendationReason(catalog[0], library);
    expect(JSON.stringify({ catalog, library, previousIds })).toBe(before);
  });
});

describe("raisons factuelles des suggestions", () => {
  it("distingue découverte, livre non commencé, reprise et livre terminé", () => {
    expect(getRecommendationReason(catalog[0])).toBe("À découvrir");
    expect(getRecommendationReason(catalog[0], [owned(catalog[0])])).toBe(
      "Dans votre bibliothèque · à commencer",
    );
    expect(
      getRecommendationReason(catalog[0], [owned(catalog[0], 0.375)]),
    ).toBe("Reprendre à 38 %");
    expect(getRecommendationReason(catalog[0], [owned(catalog[0], 1)])).toBe(
      "Déjà lu · à retrouver",
    );
    const completed = owned(catalog[0], 0.9);
    completed.position.completed = true;
    expect(getRecommendationReason(catalog[0], [completed])).toBe(
      "Déjà lu · à retrouver",
    );
  });

  it("n’affiche jamais NaN, Infinity ni 100 % pour une lecture encore en cours", () => {
    for (const progress of [NaN, Infinity, -Infinity, "0.5", null, -1])
      expect(
        getRecommendationReason(catalog[0], [owned(catalog[0], progress)]),
      ).toBe("Dans votre bibliothèque · à commencer");
    expect(
      getRecommendationReason(catalog[0], [owned(catalog[0], 0.001)]),
    ).toBe("Reprendre la lecture");
    expect(
      getRecommendationReason(catalog[0], [owned(catalog[0], 0.9999)]),
    ).toBe("Reprendre à 99 %");
  });
});

describe("shared catalog and library matching", () => {
  it("returns the actual local entry, including its position and bytes, by canonical source", () => {
    const local = owned(catalog[0], 0.42);
    local.original = new Uint8Array([80, 75]).buffer;
    expect(findLibraryBook(catalog[0], [local])).toBe(local);
    expect(
      findLibraryBook({ ...catalog[0], id: "different-edition-id" }, [local]),
    ).toBe(local);
  });

  it("finds plugin identities and named imports while ignoring unrelated or invalid entries", () => {
    const fromSelection = {
      id: "sha-selection",
      source: { selection: catalog[0].id },
    };
    const fromBookId = { id: "sha-id", source: { bookId: catalog[1].id } };
    const imported = {
      id: "sha-import",
      title: "  CANDIDE ",
      author: "Voltâire",
    };
    const library = [null, "invalid", fromSelection, fromBookId, imported];
    expect(findLibraryBook(catalog[0], library)).toBe(fromSelection);
    expect(findLibraryBook(catalog[1], library)).toBe(fromBookId);
    expect(findLibraryBook(catalog[2], library)).toBe(imported);
    expect(findLibraryBook(catalog[3], library)).toBeNull();
    expect(findLibraryBook(null, library)).toBeNull();
    expect(findLibraryBook(catalog[0], null)).toBeNull();
  });

  it("does not confuse explicitly different source editions that share a title and author", () => {
    const local = {
      id: "another-edition",
      title: catalog[0].title,
      author: catalog[0].author,
      source: { canonicalSourceId: "gutenberg:different-edition" },
      language: "fr",
    };
    expect(
      findLibraryBook({ ...catalog[0], language: "fr" }, [local]),
    ).toBeNull();
    expect(
      findLibraryBook({ ...catalog[0], language: "en" }, [local]),
    ).toBeNull();
    expect(getRecommendationReason(catalog[0], [local])).toBe("À découvrir");
  });

  it("accepts compatible EPUB language tags but does not substitute a translation for an unnamed import", () => {
    const local = {
      id: "local-import",
      title: catalog[0].title,
      author: catalog[0].author,
      language: "fr-FR",
    };
    expect(findLibraryBook({ ...catalog[0], language: "fr" }, [local])).toBe(
      local,
    );
    expect(findLibraryBook({ ...catalog[0], language: "fra" }, [local])).toBe(
      local,
    );
    expect(findLibraryBook({ ...catalog[0], language: "fre" }, [local])).toBe(
      local,
    );
    expect(
      findLibraryBook({ ...catalog[0], language: "en" }, [local]),
    ).toBeNull();
    expect(
      findLibraryBook({ ...catalog[0], language: "en-US" }, [local]),
    ).toBeNull();
    expect(findLibraryBook(catalog[0], [local])).toBe(local);
    expect(
      findLibraryBook({ ...catalog[0], language: "fr" }, [
        { ...local, language: "und" },
      ]),
    ).not.toBeNull();
  });

  it("keeps exact local and plugin identities authoritative even with incomplete conflicting metadata", () => {
    const direct = { id: catalog[0].id, language: "en" };
    const source = {
      id: "local-source",
      language: "en",
      source: { bookId: catalog[0].id, canonicalSourceId: "outdated-metadata" },
    };
    expect(findLibraryBook({ ...catalog[0], language: "fr" }, [direct])).toBe(
      direct,
    );
    expect(findLibraryBook({ ...catalog[0], language: "fr" }, [source])).toBe(
      source,
    );
  });

  it("finds a compatible local edition even when an incompatible unread edition is indexed first", () => {
    const matching = {
      id: "import-fr",
      title: catalog[0].title,
      author: catalog[0].author,
      language: "fr",
      position: { progress: 0.42 },
    };
    const other = {
      ...matching,
      id: "import-en",
      language: "en",
      position: { progress: 0 },
    };
    expect(
      findLibraryBook({ ...catalog[0], language: "fr" }, [other, matching]),
    ).toBe(matching);
    expect(
      findLibraryBook({ ...catalog[0], language: "en" }, [matching, other]),
    ).toBe(other);
  });
});
