import { describe, expect, it } from "vitest";
import { captureCatalogPresentation, resolveCover } from "../src/covers.js";

const candide = Object.freeze({
  id: "selection-candide",
  canonicalSourceId: "gutenberg:4650",
  title: "Candide, ou l’optimisme",
  author: "Voltaire",
  source: "Project Gutenberg",
  cover: null,
});
const imported = (source = {}) => ({
  id: "epub-content-sha256",
  // This edition's actual OPF uses a straight apostrophe.
  title: "Candide, ou l'optimisme",
  author: "Voltaire",
  cover: "data:image/jpeg;base64,ZXB1Yi1jb3Zlcg==",
  source,
});

describe("cover identity", () => {
  it("preserves the selected cover after EPUB import, including its title", () => {
    const book = imported({
      canonicalSourceId: candide.canonicalSourceId,
      presentation: captureCatalogPresentation(candide),
    });
    expect(resolveCover(book)).toEqual(resolveCover(candide));
    expect(resolveCover(book).image).toBeNull();
    expect(book.cover).toBe("data:image/jpeg;base64,ZXB1Yi1jb3Zlcg==");
  });

  it("keeps a catalogue image if that is the cover originally selected", () => {
    const illustrated = { ...candide, cover: "./covers/candide.webp" };
    const book = imported({
      presentation: captureCatalogPresentation(illustrated),
    });
    expect(resolveCover(book)).toEqual(resolveCover(illustrated));
  });

  it.each([
    { canonicalSourceId: candide.canonicalSourceId },
    { bookId: candide.id },
    { selection: candide.id },
    { url: "https://www.gutenberg.org/ebooks/4650" },
  ])("restores an older source import from its saved identity: %j", (source) => {
    expect(resolveCover(imported(source), [candide])).toEqual(
      resolveCover(candide),
    );
  });

  it("reflects an updated catalogue consistently across all pages", () => {
    const book = imported({
      canonicalSourceId: candide.canonicalSourceId,
      presentation: captureCatalogPresentation(candide),
    });
    const updated = { ...candide, cover: "./covers/reviewed-candide.webp" };
    expect(resolveCover(book, [updated])).toEqual(resolveCover(updated));
    expect(resolveCover(book)).toEqual(resolveCover(candide));
  });

  it("keeps an old source book typographic even if its catalogue is unavailable", () => {
    const book = imported({ canonicalSourceId: candide.canonicalSourceId });
    expect(resolveCover(book)).toEqual({
      key: candide.canonicalSourceId,
      title: book.title,
      author: book.author,
      image: null,
    });
  });

  it("does not substitute a different edition with a matching title", () => {
    const book = imported({
      canonicalSourceId: "gutenberg:99999",
      presentation: captureCatalogPresentation({
        ...candide,
        canonicalSourceId: "gutenberg:99999",
        cover: "./covers/other-edition.webp",
      }),
    });
    expect(resolveCover(book, [candide]).image).toBe(
      "./covers/other-edition.webp",
    );
  });

  it("retains embedded covers for personal imports", () => {
    const book = imported();
    delete book.source;
    expect(resolveCover(book)).toEqual({
      key: book.id,
      title: book.title,
      author: book.author,
      image: book.cover,
    });
    expect(resolveCover({ ...book, source: {} }).image).toBe(book.cover);
  });

  it("does not mutate the saved presentation or depend on catalogue ordering", () => {
    const snapshot = Object.freeze(captureCatalogPresentation(candide));
    const source = Object.freeze({
      canonicalSourceId: candide.canonicalSourceId,
      presentation: snapshot,
    });
    const book = Object.freeze(imported(source));
    const unrelated = { ...candide, id: "different", canonicalSourceId: "other" };
    expect(resolveCover(book, [unrelated, candide])).toEqual(
      resolveCover(book, [candide, unrelated]),
    );
    expect(source.presentation).toBe(snapshot);
  });

  it("handles malformed old metadata without showing the EPUB image", () => {
    const book = imported({
      canonicalSourceId: candide.canonicalSourceId,
      presentation: { version: 8, title: {}, image: [] },
    });
    expect(resolveCover(book, [null, [], candide])).toEqual(resolveCover(candide));
    expect(resolveCover(book, null).image).toBeNull();
    expect(resolveCover(null)).toEqual({
      key: "livre",
      title: "Sans titre",
      author: "Auteur inconnu",
      image: null,
    });
  });

  it("does not mistake a lookalike source host for Gutenberg", () => {
    const book = imported({
      url: "https://www.gutenberg.org.example.com/ebooks/4650",
    });
    expect(resolveCover(book, [candide]).key).toBe(book.id);
  });
});


it("keeps identical Standard Ebooks artwork locally when the live catalogue is present", () => {
  const catalogue = { id: "standardebooks-jane-austen_pride-and-prejudice", canonicalSourceId: "standardebooks:jane-austen/pride-and-prejudice", title: "Pride and Prejudice", author: "Jane Austen", cover: "https://standardebooks.org/images/covers/jane-austen_pride-and-prejudice.jpg" };
  const captured = captureCatalogPresentation(catalogue);
  const local = { ...catalogue, source: { canonicalSourceId: catalogue.canonicalSourceId, presentation: { ...captured, remoteImage: captured.image, image: "data:image/jpeg;base64,bG9jYWw=" } } };
  expect(resolveCover(local, [catalogue]).image).toBe("data:image/jpeg;base64,bG9jYWw=");
  expect(resolveCover(local).image).toBe("data:image/jpeg;base64,bG9jYWw=");
  expect(resolveCover(local, [{ ...catalogue, cover: "https://standardebooks.org/images/covers/new.jpg" }]).image).toContain("new.jpg");
});
