import { describe, expect, it, vi } from "vitest";
import { splitRsvpWord } from "../src/rsvp-pivot.js";

describe("lettre de fixation", () => {
  it.each([
    ["a", "a"],
    ["ab", "b"],
    ["abcde", "b"],
    ["abcdef", "c"],
    ["abcdefghi", "c"],
    ["abcdefghij", "d"],
    ["abcdefghijklm", "d"],
    ["abcdefghijklmn", "e"],
    ["word", "o"],
    ["positioning", "i"],
    ["really", "a"],
    ["matters", "t"],
  ])("choisit le graphème attendu dans %s", (word, pivot) => {
    expect(splitRsvpWord(word).pivot).toBe(pivot);
  });

  it("conserve les signes et sélectionne aussi les chiffres", () => {
    expect(splitRsvpWord("« l’été »")).toEqual({ before: "« l’", pivot: "é", after: "té »" });
    expect(splitRsvpWord("3,14")).toEqual({ before: "3,", pivot: "1", after: "4" });
  });

  it.each(["", "« — … »", "👨‍👩‍👧‍👦🇫🇷"])("laisse %s entier en l’absence de pivot", word => {
    expect(splitRsvpWord(word)).toEqual({ before: word, pivot: "", after: "" });
  });

  const unicodeWord = "🇫🇷a👩🏽‍🚀e\u0301!";
  const unicodeParts = { before: "🇫🇷a👩🏽‍🚀", pivot: "e\u0301", after: "!" };

  it("garde les accents combinés, les drapeaux et les emoji intacts", () => {
    expect(splitRsvpWord(unicodeWord)).toEqual(unicodeParts);
    expect(splitRsvpWord("a2️⃣!")).toEqual({ before: "a", pivot: "2️⃣", after: "!" });
  });

  it("conserve ces séquences sur les navigateurs sans Intl.Segmenter", async () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    vi.resetModules();
    try {
      const { splitRsvpWord: fallback } = await import("../src/rsvp-pivot.js");
      expect(fallback(unicodeWord)).toEqual(unicodeParts);
      expect(fallback("a2️⃣!")).toEqual({ before: "a", pivot: "2️⃣", after: "!" });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
