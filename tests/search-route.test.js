import { describe, expect, it } from "vitest";
import { buildSearchRoute, parseSearchRoute } from "../src/search-route.js";

const library = { view: "library", query: "", language: "", provider: "selection", page: 1 };
const search = { view: "search", query: "", language: "", provider: "all", page: 1 };
const discover = { view: "discover", query: "", language: "", provider: "selection", page: 1 };

describe("search route parsing", () => {
  it("assigns distinct default providers to unified search and catalogue browsing", () => {
    expect(parseSearchRoute("#search")).toEqual(search);
    expect(parseSearchRoute("#discover")).toEqual(discover);
    expect(parseSearchRoute("#library")).toEqual(library);
  });

  it("restores a query, language, provider and page from a browser history URL", () => {
    expect(parseSearchRoute("#search?q=%20Les+Mis%C3%A9rables%20&language=en&provider=gutenberg&page=3")).toEqual({
      view: "search", query: "Les Misérables", language: "en", provider: "gutenberg", page: 3,
    });
  });

  it("uses all languages unless a supported filter is explicitly selected", () => {
    expect(parseSearchRoute("#search?language=").language).toBe("");
    for (const parameter of ["", "?language=unknown", "?language=all", "?language=fr-FR"]) {
      expect(parseSearchRoute(`#search${parameter}`).language).toBe("");
    }
    for (const language of ["fr", "en", "es", "de"]) {
      expect(parseSearchRoute(`#search?language=${language}`).language).toBe(language);
    }
  });

  it("accepts only the searchable source allowlist and resets unknown providers per view", () => {
    for (const provider of ["selection", "all", "gutenberg"]) {
      expect(parseSearchRoute(`#search?provider=${provider}`).provider).toBe(provider);
    }
    for (const provider of ["", "unknown", "public-domain-library", "https://other.example"]) {
      expect(parseSearchRoute(`#search?provider=${provider}`).provider).toBe("all");
      expect(parseSearchRoute(`#discover?provider=${provider}`).provider).toBe("selection");
    }
  });

  it("requires positive whole page numbers within the route limit", () => {
    for (const page of ["", "0", "-1", "1.5", "1e2", "Infinity", "100001", "9999999999999999999999", "1extra"]) {
      expect(parseSearchRoute(`#search?page=${page}`).page).toBe(1);
    }
    expect(parseSearchRoute("#search?page=24").page).toBe(24);
    expect(parseSearchRoute("#search?page=100000").page).toBe(100000);
    expect(parseSearchRoute("#search?page=0002").page).toBe(2);
  });

  it("trims and limits search text while preserving meaningful symbols", () => {
    const query = `  ${"é".repeat(160)}  `;
    expect(parseSearchRoute(`#search?q=${encodeURIComponent(query)}`).query).toBe("é".repeat(150));
    expect(parseSearchRoute("#search?q=C%2B%2B+%26+l%27%C3%A9t%C3%A9%3F").query).toBe("C++ & l’été?".replace("’", "'"));
  });

  it("keeps catalogue browsing separate from a text search", () => {
    expect(parseSearchRoute("#discover?q=ignored&language=de&provider=gutenberg&page=4")).toEqual({
      ...discover, language: "de", provider: "gutenberg", page: 4,
    });
  });

  it("returns a clean library route for unknown destinations without adopting their parameters", () => {
    for (const hash of ["", "#", "#account", "#unknown?q=hidden&language=de&page=8", "#library?q=hidden&page=4", "#read=book", null, 12]) {
      expect(parseSearchRoute(hash)).toEqual(library);
    }
  });

  it("tolerates malformed encodings and uses the first value of duplicate parameters", () => {
    expect(() => parseSearchRoute("#search?q=%E0%A4%A&language=%" )).not.toThrow();
    expect(parseSearchRoute("#search?q=first&q=second&language=fr&language=en&page=2&page=9")).toEqual({
      ...search, query: "first", language: "fr", page: 2,
    });
  });
});

describe("search route generation", () => {
  it("produces explicit reproducible defaults", () => {
    expect(buildSearchRoute()).toBe("#search?q=&language=&provider=all&page=1");
    expect(parseSearchRoute(buildSearchRoute())).toEqual(search);
  });

  it("round-trips search text with accents, ampersands, plus signs, slashes and hashes", () => {
    const route = { view: "search", query: "Cœur & C++ / Éditions #2 ?", language: "", provider: "gutenberg", page: 8 };
    const hash = buildSearchRoute(route);
    expect(hash).toContain("language=&");
    expect(hash).toContain("%26");
    expect(hash).toContain("%23");
    expect(parseSearchRoute(hash)).toEqual(route);
  });

  it("keeps browse filters in the URL without adding a query field", () => {
    expect(buildSearchRoute({ ...discover, query: "ignored", language: "es", page: 2 })).toBe("#discover?language=es&provider=selection&page=2");
    expect(parseSearchRoute(buildSearchRoute(discover))).toEqual(discover);
  });

  it("produces a simple library route and normalizes invalid supplied destinations", () => {
    expect(buildSearchRoute({ view: "library", query: "hidden", page: 20 })).toBe("#library");
    expect(buildSearchRoute({ view: "unknown" })).toBe("#library");
  });

  it("normalizes invalid filters and trims overlong text before writing history", () => {
    const route = buildSearchRoute({ query: `  ${"a".repeat(160)}`, language: "bad", provider: "bad", page: -3 });
    expect(parseSearchRoute(route)).toEqual({ ...search, query: "a".repeat(150) });
  });

  it("does not mutate the caller's route state", () => {
    const route = Object.freeze({ ...search, query: "  Candide  ", page: 2 });
    expect(parseSearchRoute(buildSearchRoute(route)).query).toBe("Candide");
    expect(route.query).toBe("  Candide  ");
  });
});
