import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { request, catalogError, plainText, MAX_CATALOG_BYTES, MAX_BOOK_BYTES } from "./transport.js";
import { normalizeCatalogQuery } from "./query.js";
import { relayAvailable, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://www.loyalbooks.com";
const LANGUAGES = ["en", "fr", "es", "it", "de", "pt"];
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.,'()!~-]{0,199}$/u;
const RIGHTS = "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.";
let cachedCatalogue;

export function parseLoyalbooksCatalog(value) {
  const invalid = () => catalogError("INVALID_RESPONSE", "Le catalogue Loyal Books est illisible. Réessayez plus tard.");
  if (value?.version !== 1 || !["selection", "complete"].includes(value.coverage) || !Number.isFinite(Date.parse(value.updatedAt)) || !value.languages || !Array.isArray(value.books) || value.books.length > 40_000) throw invalid();
  const seen = new Set();
  const counts = Object.fromEntries(LANGUAGES.map((language) => [language, 0]));
  const books = value.books.map((entry) => {
    if (!entry || !SLUG.test(entry.slug) || !LANGUAGES.includes(entry.language) || typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 2000 || typeof entry.author !== "string" || !entry.author.trim() || entry.author.length > 1000) throw invalid();
    const key = `${entry.language}:${entry.slug}`;
    if (seen.has(key)) throw invalid();
    seen.add(key); counts[entry.language]++;
    let cover = null;
    if (entry.cover) {
      try {
        const url = new URL(entry.cover);
        if (url.origin === ORIGIN && !url.search && !url.hash && !url.username && !url.password && /^\/image\/(?:layout2|detail)\/[A-Za-z0-9_().-]+\.(?:jpe?g|png)$/iu.test(url.pathname)) cover = url.href;
      } catch { /* A missing illustration keeps the title and author usable. */ }
    }
    return { slug: entry.slug, title: plainText(entry.title, 2000), author: plainText(entry.author, 1000), language: entry.language, cover };
  });
  const languages = {};
  for (const language of LANGUAGES) {
    const entry = value.languages[language];
    if (!entry) { if (counts[language]) throw invalid(); continue; }
    if (!Number.isSafeInteger(entry.indexed) || entry.indexed !== counts[language] || !Number.isSafeInteger(entry.total) || entry.total < entry.indexed || !Number.isSafeInteger(entry.pages) || entry.pages < 1 || typeof entry.complete !== "boolean" || entry.complete && entry.indexed !== entry.total) throw invalid();
    languages[language] = { indexed: entry.indexed, total: entry.total, pages: entry.pages, complete: entry.complete };
  }
  if (!Object.keys(languages).length || value.coverage === "complete" && (Object.keys(languages).length !== LANGUAGES.length || Object.values(languages).some((entry) => !entry.complete))) throw invalid();
  return { version: 1, updatedAt: value.updatedAt, coverage: value.coverage, languages, books };
}

const validateLocalUrl = (expected) => (value) => new URL(value).href === new URL(expected, globalThis.location?.href || "http://localhost/").href;
export async function loadLoyalbooksCatalog({ signal } = {}) {
  signal?.throwIfAborted();
  if (cachedCatalogue) return cachedCatalogue;
  const url = `${import.meta.env.BASE_URL}catalog/loyalbooks.json`;
  const data = await request(url, { signal, timeout: 15_000, maxBytes: MAX_CATALOG_BYTES, validateUrl: validateLocalUrl(url) });
  signal?.throwIfAborted();
  let json;
  try { json = JSON.parse(await data.text()); } catch { throw catalogError("INVALID_RESPONSE", "Le catalogue Loyal Books est illisible. Réessayez plus tard."); }
  cachedCatalogue = parseLoyalbooksCatalog(json);
  return cachedCatalogue;
}

export const loyalbooksAvailable = () => relayAvailable();
function bookSlug(book) {
  const slug = typeof book?.id === "string" && book.id.startsWith("loyalbooks-") ? book.id.slice(11) : "";
  if (!SLUG.test(slug)) throw catalogError("INVALID_BOOK", "L’adresse de téléchargement de ce livre n’est pas autorisée.");
  if (!loyalbooksAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
  return slug;
}

export async function downloadLoyalbooksCover(book, { signal } = {}) {
  signal?.throwIfAborted();
  const url = sourceRelayUrl(`api/sources/loyalbooks/cover/${encodeURIComponent(bookSlug(book))}.jpg`);
  const blob = await request(url, { signal, timeout: 4500, maxBytes: 1024 * 1024, validateUrl: validateLocalUrl(url) });
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const type = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? "image/png" : null;
  if (!type) throw catalogError("INVALID_COVER", "La couverture n’est pas disponible.");
  return new Blob([blob], { type });
}

async function search({ query = "", language = "all", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (language && language !== "all" && !LANGUAGES.includes(language)) return { books: [], count: 0, hasNext: false, countIsApproximate: false };
  const catalog = await loadLoyalbooksCatalog({ signal });
  const terms = normalizeCatalogQuery(query).split(/\s+/u).filter(Boolean);
  const matches = catalog.books.filter((entry) => (!language || language === "all" || entry.language === language) && terms.every((term) => normalizeCatalogQuery(`${entry.title} ${entry.author}`).includes(term)));
  const start = (Math.max(1, Number.isSafeInteger(page) ? page : 1) - 1) * 24;
  return {
    books: matches.slice(start, start + 24).map((entry) => ({
      id: `loyalbooks-${entry.slug}`, canonicalSourceId: `loyalbooks:${entry.slug}`, providerId: "loyalbooks",
      title: entry.title, author: entry.author, cover: entry.cover, language: entry.language,
      source: "Loyal Books", sourceUrl: `${ORIGIN}/book/${encodeURIComponent(entry.slug)}`,
      downloadMode: "direct", rights: t(RIGHTS), rightsUrl: `${ORIGIN}/about`,
    })),
    count: matches.length, hasNext: start + 24 < matches.length, countIsApproximate: false,
    catalogCoverage: { kind: catalog.coverage, updatedAt: catalog.updatedAt, languages: catalog.languages },
  };
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const url = sourceRelayUrl(`api/books/loyalbooks/${encodeURIComponent(bookSlug(book))}.epub`);
  return request(url, { signal, timeout: 40_000, maxBytes: MAX_BOOK_BYTES, download: true, validateUrl: validateLocalUrl(url) });
}

export default defineSource({
  manifest: {
    id: "loyalbooks", name: "Loyal Books", version: "1.0.0", apiVersion: 1,
    description: "Sélection multilingue de classiques, issue du catalogue public de Loyal Books.",
    website: `${ORIGIN}/`, policy: `${ORIGIN}/about`,
    capabilities: { search: true, download: true, bundled: false },
    languages: LANGUAGES, searchPrivacy: "local",
  },
  search, download,
});
