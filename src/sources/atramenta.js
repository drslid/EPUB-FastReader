import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { catalogError, plainText, request, MAX_BOOK_BYTES, MAX_CATALOG_BYTES } from "./transport.js";
import { relayAvailable, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://www.atramenta.net";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RIGHTS = "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.";
const empty = () => ({ books: [], count: 0, hasNext: false, countIsApproximate: false });

function officialUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Only the free-reading section. Printed books, paid ebooks and samples are
 * separate sections on the same search page and must never become Read buttons.
 */
export function parseAtramentaSearch(html) {
  if (typeof html !== "string" || html.length > MAX_CATALOG_BYTES || /<!ENTITY/iu.test(html)) throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document.querySelector('form[action="/search/"]') || !document.querySelector("#main_content_wrapper")) throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  const rows = [...document.querySelectorAll(".liste_oeuvres .lo_lecture_libre")];
  if (rows.length > 200) throw catalogError("INVALID_RESPONSE", "La réponse du catalogue est trop volumineuse.");
  const books = [];
  const seen = new Set();
  for (const row of rows) {
    const link = row.querySelector(".lo_titre a");
    const url = officialUrl(link?.getAttribute("href"));
    const match = /^\/lire\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([1-9]\d{0,8})$/u.exec(url?.pathname || "");
    if (!match || match[1].length > 180 || url.search || url.hash || seen.has(match[2])) continue;
    const advertised = officialUrl(row.querySelector(".ro_free_ebook a")?.getAttribute("href"));
    if (!advertised || advertised.pathname !== url.pathname || advertised.search || advertised.hash !== "#telecharger") continue;
    const title = plainText(link.textContent, 2000);
    const author = plainText(row.querySelector(".lo_auteur a")?.textContent, 1000);
    if (!title || !author) continue;
    const image = officialUrl(row.querySelector(".lo_cover img")?.getAttribute("src"));
    const cover = image && image.pathname === `/images/work_covers/${match[2]}big.jpg` && !image.hash && /^\?(?:uts=)?\d{1,12}$|^$/u.test(image.search) ? image.href : null;
    const summary = row.querySelector(".lo_short_summary");
    summary?.querySelectorAll("a,script,style,iframe,object").forEach((node) => node.remove());
    books.push({
      id: `atramenta-${match[2]}-${match[1]}`, canonicalSourceId: `atramenta:${match[2]}`,
      providerId: "atramenta", language: "fr", downloadMode: "direct", title, author, cover,
      description: plainText(summary?.textContent, 1500), source: "Atramenta", sourceUrl: url.href,
      rights: t(RIGHTS), rightsUrl: `${ORIGIN}/help/licences`,
      canExportFocus: false, canExportClassic: false,
    });
    seen.add(match[2]);
  }
  return { books, count: books.length, hasNext: false, countIsApproximate: true };
}

export const atramentaAvailable = () => relayAvailable();
function requireRelay() {
  if (!atramentaAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
}
const validateRelayUrl = (expected) => (value) => new URL(value).href === new URL(expected, globalThis.location?.href || "http://localhost/").href;

async function search({ query = "", language = "fr", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (language && !["fr", "all"].includes(language)) return empty();
  const term = typeof query === "string" ? query.trim() : "";
  if (!term || page > 1) return empty();
  if (term.length > 200 || !Number.isSafeInteger(page) || page < 1 || /[\u0000-\u001f\u007f]/u.test(term)) throw catalogError("INVALID_QUERY", "Cette recherche n’est pas valide.");
  requireRelay();
  const url = sourceRelayUrl(`api/sources/atramenta/search?${new URLSearchParams({ query: term, page: "1" })}`);
  const blob = await request(url, { signal, timeout: 40_000, maxBytes: MAX_CATALOG_BYTES, validateUrl: validateRelayUrl(url) });
  return parseAtramentaSearch(await blob.text());
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const match = /^atramenta-([1-9]\d{0,8})-(.+)$/u.exec(book?.id || "");
  if (!match || match[2].length > 180 || !SLUG.test(match[2])) throw catalogError("INVALID_BOOK", "Ce livre n’a pas d’identifiant source valide.");
  requireRelay();
  if (globalThis.navigator?.onLine === false) throw catalogError("OFFLINE", "Connectez-vous pour télécharger ce livre une première fois. Il restera ensuite disponible dans votre bibliothèque hors ligne.");
  const url = sourceRelayUrl(`api/books/atramenta/${match[1]}-${match[2]}.epub`);
  return request(url, { signal, timeout: 65_000, maxBytes: MAX_BOOK_BYTES, download: true, validateUrl: validateRelayUrl(url) });
}

export default defineSource({
  manifest: {
    id: "atramenta", version: "1.0.0", apiVersion: 1, name: "Atramenta",
    description: "Œuvres françaises en lecture libre, avec couvertures et EPUB selon le quota disponible.",
    website: `${ORIGIN}/lecture-libre/`, policy: `${ORIGIN}/help/licences`,
    capabilities: { search: true, download: true, bundled: false },
  },
  search, download,
});
