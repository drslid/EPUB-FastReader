import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { request, catalogError, plainText, MAX_BOOK_BYTES } from "./transport.js";
import { relayAvailable, sourceRelayUrl } from "./relay-config.js";

const ORIGIN = "https://www.loyalbooks.com";
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.,'()!~-]{0,199}$/u;
const RIGHTS = "Les droits varient selon votre pays et cette édition. Consultez les conditions de la source avant de télécharger.";

const validateLocalUrl = (expected) => (value) => new URL(value).href === new URL(expected, globalThis.location?.href || "http://localhost/").href;

export const loyalbooksAvailable = () => relayAvailable();
function bookSlug(book) {
  const slug = typeof book?.id === "string" && book.id.startsWith("loyalbooks-") ? book.id.slice(11) : "";
  if (!SLUG.test(slug)) throw catalogError("INVALID_BOOK", "L’adresse de téléchargement de ce livre n’est pas autorisée.");
  if (!loyalbooksAvailable()) throw catalogError("SOURCE_NOT_CONFIGURED", "Cette source nécessite un service de téléchargement pour ouvrir les EPUB directement.");
  return slug;
}

/** Resolve only an edition selected in the source's embedded search panel. */
export async function resolveLoyalbooksBook(slug, { signal } = {}) {
  signal?.throwIfAborted();
  if (typeof slug !== "string" || !SLUG.test(slug)) throw catalogError("INVALID_BOOK", "L’adresse de téléchargement de ce livre n’est pas autorisée.");
  bookSlug({ id: `loyalbooks-${slug}` });
  const url = sourceRelayUrl(`api/sources/loyalbooks/detail/${encodeURIComponent(slug)}`);
  const blob = await request(url, { signal, timeout: 40_000, maxBytes: 32 * 1024, validateUrl: validateLocalUrl(url) });
  signal?.throwIfAborted();
  const invalid = () => catalogError("INVALID_RESPONSE", "Le catalogue Loyal Books est illisible. Réessayez plus tard.");
  let value;
  try { value = JSON.parse(await blob.text()); } catch { throw invalid(); }
  const sourceUrl = `${ORIGIN}/book/${encodeURIComponent(slug)}`;
  const title = plainText(value?.title, 2000);
  const author = plainText(value?.author, 1000);
  if (value?.id !== `loyalbooks-${slug}` || value.canonicalSourceId !== `loyalbooks:${slug}` || value.providerId !== "loyalbooks" || value.sourceUrl !== sourceUrl || value.downloadMode !== "direct"
    || !title || value.title.length > 2000 || !author || value.author.length > 1000
    || typeof value.language !== "string" || value.language.length > 35 || value.language && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value.language)) throw invalid();
  let cover = null;
  if (typeof value.cover === "string") {
    try {
      const image = new URL(value.cover);
      const match = /^\/image\/(?:layout2|detail)\/([^/]+)$/u.exec(image.pathname);
      const name = match && decodeURIComponent(match[1]);
      if (image.origin === ORIGIN && !image.username && !image.password && !image.search && !image.hash && name && SLUG.test(name) && /\.(?:jpe?g|png)$/iu.test(name)) cover = image.href;
    } catch { /* The optional cover cannot redirect reading to another host. */ }
  }
  return {
    id: `loyalbooks-${slug}`, canonicalSourceId: `loyalbooks:${slug}`, providerId: "loyalbooks",
    title, author, language: value.language, cover,
    source: "Loyal Books", sourceUrl, downloadMode: "direct", rights: t(RIGHTS), rightsUrl: `${ORIGIN}/about`,
  };
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

async function search({ signal } = {}) {
  signal?.throwIfAborted();
  return {
    books: [], count: 0, hasNext: false, countIsApproximate: false,
    searchPresentation: "embedded",
  };
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const url = sourceRelayUrl(`api/books/loyalbooks/${encodeURIComponent(bookSlug(book))}.epub`);
  return request(url, { signal, timeout: 40_000, maxBytes: MAX_BOOK_BYTES, download: true, validateUrl: validateLocalUrl(url) });
}

export default defineSource({
  manifest: {
    id: "loyalbooks", name: "Loyal Books", version: "2.0.0", apiVersion: 1,
    description: "Recherche officielle de Loyal Books, avec couvertures et lecture directe des EPUB.",
    website: `${ORIGIN}/`, policy: `${ORIGIN}/about`,
    capabilities: { search: true, download: true, bundled: false },
    searchPresentation: "embedded", searchPrivacy: "external",
  },
  search, download,
});
