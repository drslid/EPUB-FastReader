import { describe, expect, it } from "vitest";
import { partitionSearchResults } from "../src/search-results.js";

const filterLibrary = (books, query) => partitionSearchResults({ books, query }).localBooks;

const books = [
  { id: "1", title: "L’Étranger", author: "Albert Camus" },
  { id: "2", title: "Les Misérables", author: "Victor Hugo" },
];

describe("Local library search", () => {
  it("finds a title or author ignoring accents and case, with multiple terms", () => {
    expect(filterLibrary(books, "  MISERABLES hugo ")).toEqual([books[1]]);
    expect(filterLibrary(books, "CAMUS")).toEqual([books[0]]);
    expect(filterLibrary(books, "étranger")).toEqual([books[0]]);
  });
  it("returns every book for empty input, and no invented matches", () => {
    expect(filterLibrary(books, "")).toEqual(books);
    expect(filterLibrary(books, "Victor Camus")).toEqual([]);
    expect(filterLibrary([], "hugo")).toEqual([]);
  });
});
