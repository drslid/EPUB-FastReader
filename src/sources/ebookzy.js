import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { request, catalogError, plainText, MAX_BOOK_BYTES, MAX_CATALOG_BYTES } from "./transport.js";
import { relayAvailable, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://ebookzy.com";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RIGHTS = "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.";
const empty = () => ({ books: [], count: 0, hasNext: false, countIsApproximate: false });
function officialUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.username && !url.password && !url.hash ? url : null;
  } catch { return null; }
}

export function parseEbookzySearch(html, { page = 1, query = "" } = {}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector("#content");
  if (!content || !/^Search results for:/iu.test(doc.querySelector("h1.page-title")?.textContent?.trim() || "")) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  }
  if (content.querySelector(".no-results")) return empty();
  const rows = [...content.querySelectorAll("article.bloglo-article")];
  if (!rows.length || rows.length > 100) throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  const books = [];
  const seen = new Set();
  for (const row of rows) {
    const link = row.querySelector(".entry-title a[href]");
    const url = officialUrl(link?.getAttribute("href"));
    const slug = url?.pathname.replace(/^\//u, "").replace(/\/$/u, "") || "";
    if (!SLUG.test(slug) || slug.length > 180 || url.search || seen.has(slug)) continue;
    const title = plainText(link.textContent, 2000);
    const author = [...row.querySelectorAll('.cat-links a[href]')].filter((link) => {
      const authorUrl = officialUrl(link.getAttribute("href"));
      return authorUrl && /^\/author\/[a-z0-9-]+\/$/u.test(authorUrl.pathname) && !authorUrl.search;
    }).map((link) => plainText(link.textContent, 500)).filter(Boolean).join(", ");
    if (!title || !author) continue;
    const image = officialUrl(row.querySelector(".entry-media img")?.getAttribute("src"));
    const cover = image && !image.search && /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/iu.test(image.pathname) ? image.href : null;
    books.push({
      id: `ebookzy-${slug}`, canonicalSourceId: `ebookzy:${slug}`, providerId: "ebookzy",
      title, author, cover, language: "en", source: "Ebookzy", sourceUrl: url.href,
      downloadMode: "direct", rights: t(RIGHTS), rightsUrl: `${ORIGIN}/about/`,
      canExportFocus: false, canExportClassic: false,
    });
    seen.add(slug);
  }
  const next = officialUrl(doc.querySelector('.pagination a.next[href]')?.getAttribute("href"));
  const hasNext = page < 100 && Boolean(next && next.pathname === `/page/${page + 1}/` && next.searchParams.get("s") === query);
  return { books, count: (page - 1) * 28 + books.length, hasNext, countIsApproximate: page > 1 || hasNext || books.length !== rows.length };
}

export const ebookzyAvailable = () => relayAvailable();
function requireRelay() {
  if (!ebookzyAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
}
const validateRelay = (expected) => (actual) => new URL(actual).href === new URL(expected, globalThis.location?.href || "http://localhost/").href;
/** Optional import-time cover snapshot; catalogue searches load covers normally. */
export async function downloadEbookzyCover(book, { signal } = {}) {
  signal?.throwIfAborted();
  const slug = typeof book?.id === "string" && book.id.startsWith("ebookzy-") ? book.id.slice(8) : "";
  if (!SLUG.test(slug) || slug.length > 180) throw catalogError("INVALID_BOOK", "Ce livre n’a pas d’identifiant source valide.");
  requireRelay();
  const url = sourceRelayUrl(`api/sources/ebookzy/cover/${slug}.png`);
  const blob = await request(url, { signal, timeout: 4500, maxBytes: 1024 * 1024, validateUrl: validateRelay(url) });
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const type = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? "image/png"
    : [82, 73, 70, 70].every((value, index) => bytes[index] === value) && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value) ? "image/webp" : null;
  if (!type) throw catalogError("INVALID_COVER", "La couverture n’est pas disponible.");
  return new Blob([blob], { type });
}

async function search({ query = "", language = "en", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (language && !["en", "all"].includes(language)) return empty();
  const term = typeof query === "string" ? query.trim() : "";
  if (!term) return empty();
  if (term.length > 200 || /[\u0000-\u001f\u007f]/u.test(term) || !Number.isSafeInteger(page) || page < 1 || page > 100) throw catalogError("INVALID_QUERY", "Cette recherche n’est pas valide.");
  requireRelay();
  const url = sourceRelayUrl(`api/sources/ebookzy/search?${new URLSearchParams({ query: term, page: String(page) })}`);
  const blob = await request(url, { signal, timeout: 40_000, maxBytes: MAX_CATALOG_BYTES, validateUrl: validateRelay(url) });
  signal?.throwIfAborted();
  return parseEbookzySearch(await blob.text(), { page, query: term });
}
async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const slug = typeof book?.id === "string" && book.id.startsWith("ebookzy-") ? book.id.slice(8) : "";
  if (!SLUG.test(slug) || slug.length > 180) throw catalogError("INVALID_BOOK", "Ce livre n’a pas d’identifiant source valide.");
  requireRelay();
  const url = sourceRelayUrl(`api/books/ebookzy/${slug}.epub`);
  return request(url, { signal, timeout: 40_000, maxBytes: MAX_BOOK_BYTES, download: true, validateUrl: validateRelay(url) });
}

export default defineSource({
  manifest: {
    id: "ebookzy", name: "Ebookzy", version: "1.0.0", apiVersion: 1,
    description: "Classiques en anglais, avec couvertures et lecture directe des EPUB.",
    website: `${ORIGIN}/`, policy: `${ORIGIN}/about/`,
    capabilities: { search: true, download: true, bundled: false }, languages: ["en"], searchPrivacy: "remote",
  }, search, download,
});
