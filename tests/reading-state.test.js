import { describe, expect, it } from "vitest";
import { isReadingPosition, normalizePosition } from "../src/reading-state.js";

const book = { chapters: [{ id: "one" }, { id: "two" }] };
const anchor = {
  version: 1,
  chapterId: "two",
  textOffset: 12,
  exact: "Un passage",
  prefix: "avant ",
  suffix: " après",
  progression: 0.3,
};

describe("persisted reading-state boundary", () => {
  it("opens missing or malformed local positions with safe defaults", () => {
    for (const value of [
      null,
      undefined,
      false,
      5,
      "wrong",
      [],
      { bookmarks: 1, annotations: {} },
    ]) {
      expect(normalizePosition(value, book)).toMatchObject({
        chapterIndex: 0,
        wordIndex: 0,
        progress: 0,
        bookmarks: [],
        annotations: [],
        locator: null,
      });
    }
  });

  it("bounds numeric values and maps legacy numeric strings without coercing objects", () => {
    expect(
      normalizePosition(
        {
          chapterIndex: "100.4",
          wordIndex: Infinity,
          scrollRatio: "0.25",
          progress: 2,
          chapterProgress: { value: 1 },
        },
        book,
      ),
    ).toMatchObject({
      chapterIndex: 1,
      wordIndex: 0,
      scrollRatio: 0.25,
      progress: 1,
      chapterProgress: 0,
    });
  });

  it("preserves historical bookmarks and assigns deterministic identifiers", () => {
    const original = {
      chapterIndex: 0,
      bookmarks: [{ chapterIndex: 1, scrollRatio: 0.7, wordIndex: 24 }],
    };
    const result = normalizePosition(original, book);
    expect(result.bookmarks[0]).toMatchObject({
      chapterIndex: 1,
      scrollRatio: 0.7,
      wordIndex: 24,
      locator: null,
    });
    expect(result.bookmarks[0].id).toBe(
      normalizePosition(original, book).bookmarks[0].id,
    );
    expect(original.bookmarks[0]).not.toHaveProperty("id");
  });

  it("filters invalid objects and unknown chapters before reader rendering", () => {
    const result = normalizePosition(
      {
        bookmarks: [null, "bad", { chapterIndex: 12 }, { chapterIndex: 1 }],
        annotations: [
          null,
          2,
          { chapterIndex: 1, note: "No anchor" },
          { chapterIndex: 1, locator: anchor, quote: "Un passage" },
        ],
      },
      book,
    );
    expect(result.bookmarks).toHaveLength(1);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]).toMatchObject({
      quote: "Un passage",
      note: "",
      color: "gold",
      locator: anchor,
    });
  });

  it("does not restore a locator from a different chapter or unknown format", () => {
    const result = normalizePosition(
      {
        chapterIndex: 0,
        locator: anchor,
        annotations: [
          { chapterIndex: 0, locator: anchor },
          { chapterIndex: 1, locator: { ...anchor, version: 2 } },
        ],
      },
      book,
    );
    expect(result.locator).toBeNull();
    expect(result.annotations).toEqual([]);
  });

  it("bounds text, deduplicates IDs and discards unknown fields", () => {
    const item = {
      id: "note-a",
      chapterIndex: 1,
      locator: anchor,
      quote: "q".repeat(3000),
      note: "n".repeat(9000),
      color: "url(javascript:bad)",
      original: "private",
    };
    const result = normalizePosition(
      { annotations: [item, item], chapters: "private", original: "private" },
      book,
    );
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].quote).toHaveLength(2000);
    expect(result.annotations[0].note).toHaveLength(4000);
    expect(result.annotations[0].color).toBe("gold");
    expect(result.annotations[0]).not.toHaveProperty("original");
    expect(result).not.toHaveProperty("chapters");
    expect(result).not.toHaveProperty("original");
  });

  it("caps large lists and survives hostile numeric and locator types", () => {
    const result = normalizePosition(
      {
        bookmarks: Array.from({ length: 1005 }, (_, index) => ({
          id: `mark-${index}`,
          chapterIndex: 0,
          scrollRatio: { bad: true },
        })),
        locator: { version: 1, textOffset: "12", exact: {} },
      },
      book,
    );
    expect(result.bookmarks).toHaveLength(1000);
    expect(result.bookmarks[0].scrollRatio).toBe(0);
    expect(result.locator).toBeNull();
  });

  it("rejects broken remote snapshots instead of treating them as the start of a book", () => {
    for (const value of [
      null,
      {},
      [],
      { chapterIndex: 0, wordIndex: 0, scrollRatio: 0, progress: 2 },
      { chapterIndex: "0", wordIndex: 0, scrollRatio: 0, progress: 0 },
    ])
      expect(isReadingPosition(value)).toBe(false);
    expect(
      isReadingPosition({
        chapterIndex: 0,
        wordIndex: 0,
        scrollRatio: 0,
        progress: 0,
      }),
    ).toBe(true);
  });
});
