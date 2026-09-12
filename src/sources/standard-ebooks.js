import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import { catalogError, plainText, request, MAX_BOOK_BYTES, MAX_CATALOG_BYTES } from "./transport.js";

const ORIGIN = "https://standardebooks.org";
const PAGE_SIZE = 24;
const PREFIX = "standardebooks-";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){1,5}$/u;
const RIGHTS = "Domaine public aux États-Unis selon la source ; vérifiez les droits dans votre pays.";

function trustedUrl(value, pathname) {
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.username && !url.password && !url.hash &&
      (pathname ? url.pathname === pathname : url.pathname.startsWith("/ebooks")) ? url : null;
  } catch { return null; }
}

function parseDocument(html) {
  // Remote markup is only inspected in an inert XML document, never inserted into the app.
  const doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  }
  return doc;
}

function bookSlug(value) {
  const url = trustedUrl(value);
  const slug = url?.pathname.replace(/^\/ebooks\//u, "") || "";
  return url && !url.search && SLUG.test(slug) ? slug : null;
}

export function parseStandardEbooksSearch(html, { page = 1 } = {}) {
  const doc = parseDocument(html);
  if (!doc.querySelector("main.ebooks form[role='search']")) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  }
  const rows = [...doc.querySelectorAll(".ebooks-list li[typeof='schema:Book']")];
  if (!rows.length && !doc.querySelector("main.ebooks .no-results")) {
    throw catalogError("INVALID_RESPONSE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
  }
  const seen = new Set();
  const books = rows.flatMap((row) => {
    const slug = bookSlug(row.getAttribute("about"));
    const title = plainText(row.querySelector("p > a > [property='schema:name']")?.textContent, 2000);
    const authors = [...row.querySelectorAll(".author [property='schema:name']")].map((author) => plainText(author.textContent, 500)).filter(Boolean);
    if (!slug || !title || !authors.length || seen.has(slug)) return [];
    seen.add(slug);
    const image = row.querySelector("img[property='schema:image']")?.getAttribute("src");
    let cover = null;
    try {
      const url = new URL(image || "", ORIGIN);
      if (url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && /^\/images\/covers\/[a-z0-9_-]+\/[a-f0-9]{40}\/cover(?:@2x)?\.jpg$/u.test(url.pathname)) cover = url.href;
    } catch { /* An invalid cover never prevents reading a valid book. */ }
    return [{
      id: `${PREFIX}${slug.replaceAll("/", "_")}`,
      canonicalSourceId: `standardebooks:${slug}`,
      providerId: "standard-ebooks",
      title,
      author: authors.join(", "),
      cover,
      language: "en",
      source: "Standard Ebooks",
      sourceUrl: `${ORIGIN}/ebooks/${slug}`,
      downloadUrl: `${ORIGIN}/ebooks/${slug}/downloads/${slug.replaceAll("/", "_")}.epub`,
      downloadMode: "direct",
      rights: t(RIGHTS),
      rightsUrl: `${ORIGIN}/ebooks/${slug}`,
    }];
  });
  // The public HTML provides pages, not an exact total. Do not invent a total.
  const hasNext = Boolean(doc.querySelector(".pagination a[rel~='next'][href]"));
  return {
    books,
    count: (page - 1) * PAGE_SIZE + books.length + (hasNext ? 1 : 0),
    countIsApproximate: hasNext || books.length !== rows.length,
    hasNext,
  };
}

async function search({ query = "", language = "en", page = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (language && language !== "all" && language !== "en") {
    return { books: [], count: 0, hasNext: false, countIsApproximate: false };
  }
  const url = new URL(`${ORIGIN}/ebooks`);
  url.searchParams.set("query", query);
  url.searchParams.set("per-page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  const blob = await request(url.href, {
    signal,
    timeout: 25_000,
    maxBytes: MAX_CATALOG_BYTES,
    validateUrl: (value) => Boolean(trustedUrl(value, "/ebooks")),
  });
  signal?.throwIfAborted();
  return parseStandardEbooksSearch(await blob.text(), { page });
}

async function isZip(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  const id = book?.id;
  const slug = typeof id === "string" && id.startsWith(PREFIX) ? id.slice(PREFIX.length).replaceAll("_", "/") : "";
  if (!SLUG.test(slug)) {
    throw catalogError("INVALID_BOOK", "L’adresse de téléchargement de ce livre n’est pas autorisée.");
  }
  const detailPath = `/ebooks/${slug}`;
  const downloadPath = `${detailPath}/downloads/${slug.replaceAll("/", "_")}.epub`;
  // Resolve the edition from its ID and the official detail page; never fetch a caller's URL.
  const detail = await request(`${ORIGIN}${detailPath}`, {
    signal, timeout: 25_000, maxBytes: MAX_CATALOG_BYTES,
    validateUrl: (value) => Boolean(trustedUrl(value, detailPath)),
  });
  const doc = parseDocument(await detail.text());
  const link = [...doc.querySelectorAll("a[href]")].map((a) => trustedUrl(a.getAttribute("href"), downloadPath)).find((url) => url && !url.search);
  if (!link) throw catalogError("INVALID_RESPONSE", "La source n’a pas renvoyé un fichier EPUB. Téléchargez-le depuis sa fiche source.");
  const options = {
    signal, timeout: 45_000, maxBytes: MAX_BOOK_BYTES, download: true,
    validateUrl: (value) => {
      const url = trustedUrl(value, downloadPath);
      return Boolean(url && (!url.search || url.search === "?source=download"));
    },
  };
  let blob = await request(link.href, options);
  if (await isZip(blob)) return blob;
  // Standard Ebooks uses a public donation page followed by this explicit meta
  // refresh. Follow only that exact file, once; no script, login or arbitrary redirect.
  if (blob.size <= MAX_CATALOG_BYTES) {
    const landing = parseDocument(await blob.text());
    const refresh = landing.querySelector("meta[http-equiv='refresh']")?.getAttribute("content") || "";
    const target = /^0;\s*url=(.+)$/iu.exec(refresh)?.[1];
    const next = target ? trustedUrl(target, downloadPath) : null;
    if (next?.search === "?source=download") {
      blob = await request(next.href, options);
      if (await isZip(blob)) return blob;
    }
  }
  throw catalogError("INVALID_RESPONSE", "La source n’a pas renvoyé un fichier EPUB. Téléchargez-le depuis sa fiche source.");
}

export default defineSource({
  manifest: {
    id: "standard-ebooks",
    name: "Standard Ebooks",
    version: "1.0.0",
    apiVersion: 1,
    description: "Éditions anglaises soignées, avec couvertures et lecture directe.",
    website: `${ORIGIN}/ebooks`,
    policy: `${ORIGIN}/`,
    capabilities: { search: true, download: true, bundled: false },
    languages: ["en"],
    searchPrivacy: "remote",
  },
  search,
  download,
});
