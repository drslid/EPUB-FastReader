import { normalizeCatalogQuery } from "./sources/query.js";
import { findLibraryBook } from "./suggestions.js";

const isBook = (book) =>
  book && typeof book === "object" && !Array.isArray(book);

function searchableText(book) {
  // An EPUB's internal title can differ from the title on the selected cover.
  const presentation = book.source?.presentation;
  return normalizeCatalogQuery(
    [book.title, book.author, presentation?.title, presentation?.author]
      .filter((value) => typeof value === "string")
      .join(" "),
  );
}

/**
 * Keep personal books first, independently of the remote source/language filters.
 * Catalog entries are the current result page, already searched by their plugin.
 * An owned edition only appears in the local group, preserving library recency.
 */
export function partitionSearchResults({ books = [], catalog = [], query = "" } = {}) {
  const library = (Array.isArray(books) ? books : []).filter(isBook);
  const terms = normalizeCatalogQuery(typeof query === "string" ? query : "")
    .split(/\s+/u)
    .filter(Boolean);
  const remoteBooks = [];
  const matchedLocalBooks = new Set();
  let alreadyOwnedCount = 0;

  for (const book of Array.isArray(catalog) ? catalog : []) {
    if (!isBook(book)) continue;
    const local = findLibraryBook(book, library);
    if (local) {
      matchedLocalBooks.add(local);
      alreadyOwnedCount += 1;
    } else remoteBooks.push(book);
  }

  const localBooks = library.filter((book) => {
    // Older imports may lack the catalogue title alias. A matched edition must
    // still remain visible and open its saved copy instead of disappearing.
    if (matchedLocalBooks.has(book)) return true;
    const text = searchableText(book);
    return terms.every((term) => text.includes(term));
  });

  return { localBooks, remoteBooks, alreadyOwnedCount };
}
