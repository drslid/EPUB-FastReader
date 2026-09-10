import { describe, expect, it, vi } from "vitest";
import { searchPassages } from "../src/passage-search.js";
import { applyFocus } from "../src/epub.js";
import { getTextContent, locateTextRange } from "../src/reading-location.js";

const makeBook = (...html) => ({
  chapters: html.map((content, index) => ({
    id: `chapter-${index + 1}`,
    title: `Partie ${index + 1}`,
    html: content,
  })),
});
const root = (html) => new DOMParser().parseFromString(html, "text/html").body;

describe("local passage search", () => {
  it("finds accented text regardless of case and returns an exact navigable position", () => {
    const book = makeBook(
      "<p>Voici une ÉCOLE et sa cour.</p>",
      "<p>Une école en montagne.</p>",
    );
    const matches = searchPassages(book, "ecole");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      chapterIndex: 0,
      chapterTitle: "Partie 1",
      locator: { chapterId: "chapter-1" },
    });
    expect(matches[0].locator.exact).toBe("ÉCOLE et sa cour.");
    expect(
      locateTextRange(
        root(book.chapters[0].html),
        matches[0].locator,
      ).toString(),
    ).toBe("ÉCOLE et sa cour.");
    expect(matches[1].chapterIndex).toBe(1);
  });

  it("maps decomposed accents and supplementary characters back to UTF-16 offsets", () => {
    const book = makeBook("<p>🌍 Préambule éclair puis CAFÉ et suite.</p>");
    const text = getTextContent(root(book.chapters[0].html));
    const [match] = searchPassages(book, "café");
    expect(match.locator.textOffset).toBe(text.indexOf("CAFÉ"));
    expect(match.locator.exact).toBe("CAFÉ et suite.");
    expect(searchPassages(book, "éclair")[0].locator.exact).toMatch(/^éclair/);
  });

  it("matches words fragmented by Focus markup and ordinary emphasis", () => {
    const book = makeBook(
      applyFocus("<p>Bon<strong>jour</strong> au voyageur.</p>"),
    );
    const [match] = searchPassages(book, "bonjour au");
    expect(match.locator.textOffset).toBe(0);
    expect(
      locateTextRange(
        root("<p>Bonjour au voyageur.</p>"),
        match.locator,
      ).toString(),
    ).toBe("Bonjour au voyageur.");
  });

  it("collapses whitespace and block boundaries while preserving original indices", () => {
    const book = makeBook("<p>Un long\n   voyage</p><p>commence ici.</p>");
    const [match] = searchPassages(book, "long voyage commence");
    expect(match).toBeDefined();
    expect(match.locator.textOffset).toBe(3);
    expect(match.quote).toBe("Un long voyage commence ici.");
  });

  it("supports common French ligatures without shifting positions", () => {
    const book = makeBook("<p>Un cœur dans cette œuvre.</p>");
    expect(searchPassages(book, "coeur")[0].locator.exact).toBe(
      "cœur dans cette œuvre.",
    );
    expect(searchPassages(book, "oeuvre")[0].locator.exact).toBe("œuvre.");
  });

  it("ignores short queries without building an index", () => {
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    const book = makeBook("<p>Lire ici.</p>");
    expect(searchPassages(book, " ")).toEqual([]);
    expect(searchPassages(book, "é")).toEqual([]);
    expect(searchPassages(book, "é")).toEqual([]);
    expect(searchPassages(null, "lire")).toEqual([]);
    expect(parser).not.toHaveBeenCalled();
    parser.mockRestore();
  });

  it("caps result counts and query length", () => {
    const book = makeBook(`<p>${"passage ".repeat(100)}</p>`);
    expect(searchPassages(book, "passage")).toHaveLength(20);
    expect(searchPassages(book, "passage", { limit: 500 })).toHaveLength(20);
    expect(searchPassages(book, "passage", { limit: 3 })).toHaveLength(3);
    expect(searchPassages(book, "passage", { limit: 0 })).toEqual([]);
    const long = makeBook(`<p>${"a".repeat(120)}b</p>`);
    expect(searchPassages(long, "a".repeat(121))).toHaveLength(1);
  });

  it("returns contextual previews no longer than 200 characters", () => {
    const book = makeBook(
      `<p>${"Avant 🌍 ".repeat(100)}Le passage recherché${" après 🌍".repeat(100)}</p>`,
    );
    const [match] = searchPassages(book, "passage recherché");
    expect(match.quote).toContain("passage recherché");
    expect(Array.from(match.quote).length).toBeLessThanOrEqual(200);
    expect(match.quote).toMatch(/^…/);
    expect(match.quote).toMatch(/…$/);
    expect(match.quote).not.toMatch(/\uFFFD/u);
  });

  it("reuses the book text index while rebuilding changed chapters", () => {
    const book = makeBook("<p>Un voyage unique.</p>", "<p>Rien ici.</p>");
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    searchPassages(book, "voyage");
    expect(parser).toHaveBeenCalledTimes(3);
    parser.mockClear();
    searchPassages(book, "unique");
    expect(parser).toHaveBeenCalledTimes(1);
    book.chapters[1].html = "<p>Un voyage ajouté.</p>";
    expect(searchPassages(book, "voyage")).toHaveLength(2);
    parser.mockRestore();
  });

  it("excludes hidden and executable content", () => {
    const book = makeBook(
      '<p>Visible<span hidden>secret</span><span aria-hidden="true">secret</span></p><script>secret</script><style>secret</style>',
    );
    expect(searchPassages(book, "secret")).toEqual([]);
    expect(searchPassages(book, "visible")).toHaveLength(1);
  });
});
