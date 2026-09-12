import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { request, catalogError, plainText, MAX_CATALOG_BYTES, MAX_BOOK_BYTES } from "./transport.js";
import { relayAvailable, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://www.epubbooks.com";
const ID = /^[1-9]\d{0,8}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RIGHTS = "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.";

function officialUrl(value) {
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

export function parseEpubbooksSearch(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.querySelector('form[role="search"]') || !/^Top Search Results for/iu.test(doc.querySelector("h1")?.textContent?.trim() || "")) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue epubBooks est illisible. Réessayez plus tard.");
  }
  // A failed search shows featured recommendations. They are not search matches.
  const empty = [...doc.querySelectorAll("h3")].some((heading) => /No results found/iu.test(heading.textContent));
  if (empty) return { books: [], count: 0, hasNext: false, countIsApproximate: false };
  const rows = [...doc.querySelectorAll("ul.media-list > li.media")];
  if (!rows.length || rows.length > 100) throw catalogError("INVALID_RESPONSE", "Le catalogue epubBooks est illisible. Réessayez plus tard.");
  const seen = new Set();
  const books = [];
  for (const row of rows) {
    const heading = row.querySelector(".media-heading");
    const link = heading?.querySelector("a[href]");
    const url = officialUrl(link?.getAttribute("href"));
    const slug = url?.pathname.replace(/^\/book\//u, "") || "";
    if (!ID.test(slug)) continue; // Author biographies are mixed into the results.
    const number = slug.split("-", 1)[0];
    const title = plainText(link.textContent, 2000);
    const author = plainText(heading.querySelector(".small")?.textContent, 1000);
    if (!title || !author || seen.has(number)) continue;
    seen.add(number);
    const image = officialUrl(row.querySelector(".media-left img")?.getAttribute("src"));
    const cover = image && /^\/images\/covers\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/iu.test(image.pathname) ? image.href : null;
    books.push({
      id: `epubbooks-${slug}`, canonicalSourceId: `epubbooks:${number}`, providerId: "epubbooks",
      title, author, cover, language: "en", source: "epubBooks", sourceUrl: url.href,
      downloadMode: "direct", rights: t(RIGHTS), rightsUrl: `${ORIGIN}/terms`,
      canExportFocus: false, canExportClassic: false,
    });
  }
  // The site provides top matches, not a paginated complete result count.
  return { books, count: books.length, hasNext: false, countIsApproximate: true };
}

export const epubbooksAvailable = () => relayAvailable();
function requireRelay() {
  if (!epubbooksAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
}
const validateRelayUrl = (expected) => (value) => new URL(value).href === new URL(expected, globalThis.location?.href || "http://localhost/").href;

/** Optional, only after importing an EPUB: preserve its chosen catalogue cover offline. */
export async function downloadEpubbooksCover(book, { signal } = {}) {
  signal?.throwIfAborted();
  const id = typeof book?.id === "string" && book.id.startsWith("epubbooks-") ? book.id.slice("epubbooks-".length) : "";
  if (!ID.test(id) || id.length > 200) throw catalogError("INVALID_BOOK", "L’adresse de téléchargement de ce livre n’est pas autorisée.");
  requireRelay();
  const url = sourceRelayUrl(`api/sources/epubbooks/cover/${id}.jpg`);
  const blob = await request(url, { signal, timeout: 4500, maxBytes: 1024 * 1024, validateUrl: validateRelayUrl(url) });
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const type = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? "image/png" : null;
  if (!type) throw catalogError("INVALID_COVER", "La couverture n’est pas disponible.");
  return new Blob([blob], { type });
}

async function search({ query = "", language = "en", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if ((language && !["en", "all"].includes(language)) || !query.trim() || page > 1) return { books: [], count: 0, hasNext: false, countIsApproximate: false };
  requireRelay();
  const url = sourceRelayUrl(`api/sources/epubbooks/search?${new URLSearchParams({ query: query.trim(), page: "1" })}`);
  const blob = await request(url, { signal, timeout: 40_000, maxBytes: MAX_CATALOG_BYTES, validateUrl: validateRelayUrl(url) });
  signal?.throwIfAborted();
  return parseEpubbooksSearch(await blob.text());
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const id = typeof book?.id === "string" && book.id.startsWith("epubbooks-") ? book.id.slice("epubbooks-".length) : "";
  if (!ID.test(id) || id.length > 200) throw catalogError("INVALID_BOOK", "L’adresse de téléchargement de ce livre n’est pas autorisée.");
  requireRelay();
  const url = sourceRelayUrl(`api/books/epubbooks/${id}.epub`);
  return request(url, { signal, timeout: 40_000, maxBytes: MAX_BOOK_BYTES, download: true, validateUrl: validateRelayUrl(url) });
}

export default defineSource({
  manifest: {
    id: "epubbooks", name: "epubBooks", version: "1.0.0", apiVersion: 1,
    description: "Classiques en anglais, avec couvertures et lecture directe des EPUB.",
    website: `${ORIGIN}/`, policy: `${ORIGIN}/terms`,
    capabilities: { search: true, download: true, bundled: false },
    languages: ["en"], searchPrivacy: "remote",
  },
  search, download,
});
