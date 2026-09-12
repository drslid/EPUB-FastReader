import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { catalogError, plainText, request, MAX_BOOK_BYTES, MAX_CATALOG_BYTES } from "./transport.js";
import { relayAvailable, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://www.fadedpage.com";
const PAGE_SIZE = 24;
const RIGHTS = "Domaine public au Canada. Vérifiez les droits applicables dans votre pays avant de télécharger ce livre.";
const empty = () => ({ books: [], count: 0, hasNext: false, countIsApproximate: false });

function text(value, limit = 1000) {
  if (typeof value !== "string") return "";
  // Metadata is text, including when the upstream description contains markup.
  const document = new DOMParser().parseFromString(value, "text/html");
  document.querySelectorAll("script,style,iframe,object").forEach((node) => node.remove());
  return plainText(document.body.textContent, limit);
}

export function parseFadedpageCatalog(value, { page = 1 } = {}) {
  if (!value || !Array.isArray(value.rows) || value.rows.length > 2000 || !Number.isSafeInteger(value.nrows) || value.nrows < value.rows.length || value.nrows > 1_000_000) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  }
  const books = [];
  const seen = new Set();
  for (const row of value.rows) {
    if (!row || !/^[12]\d{7}$/u.test(row.pid || "") || row.lang !== "en" || seen.has(row.pid)) continue;
    const title = text(row.title);
    if (!title) continue;
    let cover = null;
    try {
      const candidate = new URL(row.cover, `${ORIGIN}/`);
      if (typeof row.cover === "string" && candidate.origin === ORIGIN && !candidate.username && !candidate.password && !candidate.search && !candidate.hash && new RegExp(`^/books/${row.pid}/[A-Za-z0-9_.-]+\\.(?:jpe?g|png|webp)$`, "iu").test(candidate.pathname)) cover = candidate.href;
    } catch { /* A missing or unexpected cover uses the normal text cover. */ }
    const authors = Array.isArray(row.authors) ? row.authors.filter((author) => author?.type === "author" || !author?.type) : [];
    const author = authors.map((entry) => text(entry.pseudoname || entry.realname, 500)).filter(Boolean).join(", ") || t("Auteur inconnu");
    books.push({
      id: `fadedpage-${row.pid}`, canonicalSourceId: `fadedpage:${row.pid}`,
      providerId: "fadedpage", downloadMode: "direct", language: "en",
      title, author, cover, description: text(row.description, 1500),
      source: "Faded Page", sourceUrl: `${ORIGIN}/showbook.php?pid=${row.pid}`,
      rights: t(RIGHTS), rightsUrl: `${ORIGIN}/copyright.php`,
      // Retain the original edition and its licence on export.
      canExportFocus: false, canExportClassic: false,
    });
    seen.add(row.pid);
  }
  const offset = (page - 1) * PAGE_SIZE;
  return {
    books: books.slice(offset, offset + PAGE_SIZE), count: books.length,
    hasNext: offset + PAGE_SIZE < books.length,
    countIsApproximate: value.nrows > value.rows.length || books.length !== value.rows.length,
  };
}

export function fadedpageAvailable() { return relayAvailable(); }

function requireRelay() {
  if (!fadedpageAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
}

async function search({ query = "", language = "en", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (language && !["en", "all"].includes(language)) return empty();
  const term = typeof query === "string" ? query.trim() : "";
  if (!term) return empty();
  if (term.length > 200 || /[\u0000-\u001f\u007f]/u.test(term) || !Number.isSafeInteger(page) || page < 1 || page > 84) throw catalogError("INVALID_QUERY", "Cette recherche n’est pas valide.");
  requireRelay();
  const url = sourceRelayUrl(`api/sources/fadedpage/search?${new URLSearchParams({ query: term, page: String(page) })}`);
  const response = await request(url, {
    signal, timeout: 50_000, maxBytes: MAX_CATALOG_BYTES,
    validateUrl: (value) => new URL(value).href === new URL(url, globalThis.location?.href || "http://localhost/").href,
  });
  let data;
  try { data = JSON.parse(await response.text()); }
  catch { throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard."); }
  return parseFadedpageCatalog(data, { page });
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const id = /^fadedpage-([12]\d{7})$/u.exec(book?.id || "")?.[1];
  if (!id) throw catalogError("INVALID_BOOK", "Ce livre n’a pas d’identifiant source valide.");
  requireRelay();
  if (globalThis.navigator?.onLine === false) throw catalogError("OFFLINE", "Connectez-vous pour télécharger ce livre une première fois. Il restera ensuite disponible dans votre bibliothèque hors ligne.");
  const url = sourceRelayUrl(`api/books/fadedpage/${id}.epub`);
  return request(url, {
    signal, timeout: 65_000, maxBytes: MAX_BOOK_BYTES, download: true,
    validateUrl: (value) => new URL(value).href === new URL(url, globalThis.location?.href || "http://localhost/").href,
  });
}

export default defineSource({
  manifest: {
    id: "fadedpage", version: "1.0.0", apiVersion: 1, name: "Faded Page",
    description: "Livres en anglais du domaine public au Canada, avec recherche par titre et couvertures.",
    website: `${ORIGIN}/`, policy: `${ORIGIN}/copyright.php`,
    capabilities: { search: true, download: true, bundled: false },
  },
  search, download,
});
