import { t } from "./i18n.js";
const text = (value) => (typeof value === "string" ? value.trim() : "");
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

function sourceIdentity(book) {
  const source = record(book.source);
  const explicit = text(book.canonicalSourceId) || text(source?.canonicalSourceId);
  if (explicit) return explicit;
  // Older saved books only retained the source page and the selection ID.
  try {
    const url = new URL(source?.url || book.sourceUrl);
    const number = /^\/ebooks\/([1-9]\d*)\/?$/u.exec(url.pathname)?.[1];
    if (
      number &&
      ["gutenberg.org", "www.gutenberg.org"].includes(url.hostname)
    )
      return `gutenberg:${number}`;
  } catch {
    // A missing or unrelated source URL does not identify a catalogue edition.
  }
  return "";
}

function presentation(book) {
  const source = record(book.source);
  return {
    key:
      sourceIdentity(book) ||
      text(source?.bookId) ||
      text(source?.selection) ||
      text(book.id) ||
      text(book.title) ||
      "livre",
    title: text(book.title) || t("Sans titre"),
    author: text(book.author) || t("Auteur inconnu"),
    image: text(book.cover) || null,
  };
}

/** Store the catalogue's appearance independently from the EPUB metadata. */
export function captureCatalogPresentation(book = {}) {
  return { version: 1, ...presentation(record(book) || {}) };
}

/**
 * One cover for Discover, suggestions and saved books. The original EPUB cover
 * remains available in the archive; importing it must not replace the cover the
 * reader selected. A current catalogue also restores older saved presentations.
 */
export function resolveCover(value, catalog = []) {
  const book = record(value) || {};
  const source = record(book.source);
  if (!source || Object.keys(source).length === 0) return presentation(book);

  const canonical = sourceIdentity(book);
  const ids = [source.bookId, source.selection].map(text).filter(Boolean);
  const current = (Array.isArray(catalog) ? catalog : []).find((candidate) => {
    if (!record(candidate)) return false;
    return (
      (canonical && sourceIdentity(candidate) === canonical) ||
      ids.includes(text(candidate.id))
    );
  });
  if (current) return presentation(current);

  const saved = record(source.presentation);
  if (saved?.version === 1 && text(saved.key) && text(saved.title)) {
    return {
      key: text(saved.key),
      title: text(saved.title),
      author: text(saved.author) || t("Auteur inconnu"),
      image: text(saved.image) || null,
    };
  }

  // Legacy source imports used generated catalogue covers. Do not overlay their
  // internal cover image while waiting for the matching catalogue metadata.
  return { ...presentation(book), image: null };
}
