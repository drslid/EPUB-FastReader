import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { catalogError, plainText, request, MAX_BOOK_BYTES, MAX_CATALOG_BYTES } from "./transport.js";
import { configuredSourceRelay, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://www.ebooksgratuits.com";
const ATOM = "http://www.w3.org/2005/Atom";
const OPEN_SEARCH = "http://a9.com/-/spec/opensearch/1.1/";
const RIGHTS = "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.";
const directChildren = (node, name, ns = ATOM) => [...node.children].filter((child) => child.localName === name && child.namespaceURI === ns);
const childText = (node, name, max = 1000) => plainText(directChildren(node, name)[0]?.textContent, max);

function officialUrl(value) {
  try {
    const url = new URL(value, `${ORIGIN}/opds/feed.php`);
    return url.origin === ORIGIN && !url.username && !url.password && !url.hash ? url : null;
  } catch { return null; }
}

/** Parse only acquisition entries; PDF-only records never become reading buttons. */
export function parseEbooksGratuitsFeed(xml, { page = 1, query = "" } = {}) {
  if (typeof xml !== "string" || xml.length > MAX_CATALOG_BYTES || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue Ebooks libres et gratuits est illisible. Réessayez plus tard.");
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const feed = document.documentElement;
  if (feed.localName !== "feed" || feed.namespaceURI !== ATOM || document.getElementsByTagName("parsererror").length) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue Ebooks libres et gratuits est illisible. Réessayez plus tard.");
  }
  const entries = directChildren(feed, "entry");
  if (entries.length > 100) throw catalogError("INVALID_RESPONSE", "Le catalogue Ebooks libres et gratuits est illisible. Réessayez plus tard.");
  const seen = new Set();
  const books = [];
  for (const entry of entries) {
    const details = officialUrl(childText(entry, "id"));
    const number = details?.pathname === "/details.php" && /^[1-9]\d{0,8}$/u.test(details.searchParams.get("book") || "")
      ? details.searchParams.get("book") : null;
    if (!number || seen.has(number)) continue;
    const links = directChildren(entry, "link");
    const epub = links.some((link) => {
      if (link.getAttribute("type") !== "application/epub+zip" || !/^https?:\/\/opds-spec\.org\/acquisition(?:\/open-access)?$/u.test(link.getAttribute("rel") || "")) return false;
      const url = officialUrl(link.getAttribute("href"));
      return url?.pathname === "/newsendbook.php" && url.searchParams.get("id") === number && url.searchParams.get("format") === "epub";
    });
    const title = childText(entry, "title");
    if (!epub || !title) continue;
    const language = [...entry.children].find((node) => node.localName === "language")?.textContent?.trim().toLowerCase();
    if (language && !["fr", "fre", "fra", "fr-fr"].includes(language)) continue;
    const author = directChildren(entry, "author").map((node) => childText(node, "name", 500)).filter(Boolean).join(", ") || t("Auteur inconnu");
    // This feed usually has no covers. Do not fetch EPUBs to construct thumbnails.
    const image = links.find((link) => /^https?:\/\/opds-spec\.org\/image(?:\/thumbnail)?$/u.test(link.getAttribute("rel") || ""));
    const coverUrl = image && officialUrl(image.getAttribute("href"));
    const cover = coverUrl && /^\/(?:images|covers|couvertures)\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp)$/iu.test(coverUrl.pathname) ? coverUrl.href : null;
    const rawDescription = childText(entry, "content", 6000);
    // Parse provider markup inertly and retain text only; never insert its HTML.
    const description = plainText(rawDescription.replace(/<[^>]*>/gu, " "), 1500);
    seen.add(number);
    books.push({
      id: `ebooks-gratuits-${number}`,
      canonicalSourceId: `ebooks-gratuits:${number}`,
      providerId: "ebooks-gratuits",
      downloadMode: "direct",
      title, author, cover, description, language: "fr",
      source: "Ebooks libres et gratuits",
      sourceUrl: `${ORIGIN}/details.php?book=${number}`,
      rights: t(RIGHTS), rightsUrl: `${ORIGIN}/droitaut.php`,
      // The OPDS does not grant permission to alter each partner edition.
      // Original export remains available, including its licence and credits.
      canExportFocus: false, canExportClassic: false,
    });
  }
  const next = directChildren(feed, "link").some((link) => {
    if (link.getAttribute("rel") !== "next") return false;
    const url = officialUrl(link.getAttribute("href"));
    return url?.pathname === "/opds/feed.php" && url.searchParams.get("mode") === "search"
      && url.searchParams.get("query") === query && url.searchParams.get("page") === String(page);
  });
  const totalText = directChildren(feed, "totalResults", OPEN_SEARCH)[0]?.textContent?.trim() || "";
  const total = /^\d{1,8}$/u.test(totalText) ? Number(totalText) : books.length;
  return {
    books,
    count: Math.max(books.length, total),
    // The feed's total also includes editions with no EPUB; do not call it exact.
    countIsApproximate: next || page > 1 || books.length !== entries.length,
    hasNext: next,
  };
}

export function ebooksGratuitsAvailable() {
  return import.meta.env.MODE !== "pages" || Boolean(configuredSourceRelay());
}

function requireRelay() {
  if (!ebooksGratuitsAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
}

async function search({ query = "", language = "fr", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (language && !["fr", "all"].includes(language)) return { books: [], count: 0, hasNext: false, countIsApproximate: false };
  const term = typeof query === "string" ? query.trim() : "";
  if (!term) return { books: [], count: 0, hasNext: false, countIsApproximate: false };
  if (term.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw catalogError("INVALID_QUERY", "Cette recherche n’est pas valide.");
  requireRelay();
  const url = sourceRelayUrl(`api/sources/ebooks-gratuits/search?${new URLSearchParams({ query: term, page: String(page) })}`);
  const response = await request(url, {
    signal, timeout: 65_000, maxBytes: MAX_CATALOG_BYTES,
    validateUrl: (value) => new URL(value).href === new URL(url, globalThis.location?.href || "http://localhost/").href,
  });
  return parseEbooksGratuitsFeed(await response.text(), { page, query: term });
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const number = /^ebooks-gratuits-([1-9]\d{0,8})$/u.exec(book?.id || "")?.[1];
  if (!number) throw catalogError("INVALID_BOOK", "Ce livre n’a pas d’identifiant Ebooks libres et gratuits valide.");
  requireRelay();
  if (globalThis.navigator?.onLine === false) throw catalogError("OFFLINE", "Connectez-vous pour télécharger ce livre une première fois. Il restera ensuite disponible dans votre bibliothèque hors ligne.");
  const url = sourceRelayUrl(`api/books/ebooks-gratuits/${number}.epub`);
  return request(url, {
    signal, timeout: 105_000, maxBytes: MAX_BOOK_BYTES, download: true,
    validateUrl: (value) => new URL(value).href === new URL(url, globalThis.location?.href || "http://localhost/").href,
  });
}

export default defineSource({
  manifest: {
    id: "ebooks-gratuits", version: "1.0.0", apiVersion: 1,
    name: "Ebooks libres et gratuits",
    description: "Recherche par titre dans le catalogue francophone, avec les éditions disponibles en EPUB.",
    website: `${ORIGIN}/ebooks.php`, policy: `${ORIGIN}/droitaut.php`,
    capabilities: { search: true, download: true, bundled: false },
  },
  search, download,
});
