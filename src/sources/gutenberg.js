import { t } from "../i18n.js";
import {
  catalogError,
  plainText,
  request,
  MAX_CATALOG_BYTES,
  MAX_BOOK_BYTES,
} from "./transport.js";
import { defineSource } from "./source.js";
import manifest from "./catalog-manifest.json";
import { normalizeCatalogQuery } from "./query.js";

const PAGE_SIZE = 24;
const cache = new Map();
const RIGHTS =
  "Domaine public aux États-Unis selon la source ; vérifiez les droits dans votre pays.";

/** Deployment configuration only: a catalogue entry can never choose a relay. */
export function configuredGutenbergRelay() {
  const value = import.meta.env.VITE_GUTENBERG_RELAY_URL;
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    const rawPath = value.replace(/^https:\/\/[^/]+/u, "");
    if (
      url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^https:\/\/[^\s/?#\\]+(?:\/[A-Za-z0-9_.~-]+)*\/?$/u.test(value) ||
      rawPath.split("/").some((segment) => segment === "." || segment === "..")
    ) return "";
    return `${url.origin}${url.pathname.replace(/\/$/u, "")}`;
  } catch { return ""; }
}

const manualImportRequired = () => import.meta.env.MODE === "pages" && !configuredGutenbergRelay();

export const catalogSnapshot = Object.freeze({
  date: manifest.generatedAt,
  count: manifest.count,
  languages: Object.freeze(Object.keys(manifest.languages)),
});

function decodeShard(data, language) {
  if (
    data?.version !== 1 ||
    data.language !== language ||
    !Array.isArray(data.authors) ||
    data.authors.length > 2500 ||
    !data.authors.every(
      (author) => typeof author === "string" && author.length <= 500,
    ) ||
    !Array.isArray(data.books) ||
    data.books.length > 2500
  ) {
    throw catalogError(
      "INVALID_RESPONSE",
      "Le catalogue local est incomplet. Rechargez l’application pour le mettre à jour.",
    );
  }
  const seen = new Set();
  return data.books.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== 5 ||
      !Number.isSafeInteger(row[0]) ||
      row[0] < 1 ||
      typeof row[1] !== "string" ||
      !row[1].trim() ||
      row[1].length > 300 ||
      !Number.isSafeInteger(row[2]) ||
      row[2] < 0 ||
      row[2] >= data.authors.length ||
      !Array.isArray(row[3]) ||
      !row[3].includes(language) ||
      !row[3].every((code) => /^[a-z]{2}$/.test(code)) ||
      !Number.isSafeInteger(row[4]) ||
      row[4] < 0 ||
      seen.has(row[0])
    ) {
      throw catalogError(
        "INVALID_RESPONSE",
        "Le catalogue local contient une entrée invalide. Rechargez l’application pour le mettre à jour.",
      );
    }
    seen.add(row[0]);
    const title = plainText(row[1]);
    const author = plainText(data.authors[row[2]], 500) || "Auteur inconnu";
    return {
      number: row[0],
      title,
      author,
      languages: row[3],
      popularity: row[4],
      search: normalizeCatalogQuery(`${title} ${author}`),
      normalizedTitle: normalizeCatalogQuery(title),
    };
  });
}

async function loadShard(filename, language, signal) {
  const url = `${import.meta.env.BASE_URL}catalog/${filename}`;
  const key = `${manifest.sha256}:${url}`;
  signal?.throwIfAborted();
  if (cache.has(key)) return cache.get(key);
  const blob = await request(url, {
    signal,
    timeout: 15_000,
    maxBytes: MAX_CATALOG_BYTES,
    validateUrl: (value) =>
      new URL(value).href ===
      new URL(url, globalThis.location?.href || "http://localhost/").href,
  });
  let data;
  try {
    data = JSON.parse(await blob.text());
  } catch (error) {
    throw catalogError(
      "INVALID_RESPONSE",
      "Le catalogue local est illisible. Rechargez l’application pour le mettre à jour.",
      error,
    );
  }
  const rows = decodeShard(data, language);
  signal?.throwIfAborted();
  cache.set(key, rows);
  return rows;
}

async function loadIndex(language, signal) {
  const languages =
    language && language !== "all"
      ? [language]
      : Object.keys(manifest.languages);
  const tasks = languages.flatMap((code) =>
    (manifest.languages[code]?.files || []).map((file) => [file, code]),
  );
  const chunks = Array(tasks.length);
  let next = 0;
  // Bound concurrent requests, especially when all languages are requested on mobile.
  await Promise.all(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (next < tasks.length) {
        signal?.throwIfAborted();
        const index = next++;
        chunks[index] = await loadShard(...tasks[index], signal);
      }
    }),
  );
  const seen = new Set();
  return chunks.flat().filter((row) => {
    if (seen.has(row.number)) return false;
    seen.add(row.number);
    return true;
  });
}

function publicBook(row, language) {
  return {
    id: `gutenberg-${row.number}`,
    canonicalSourceId: `gutenberg:${row.number}`,
    providerId: "gutenberg",
    downloadMode: manualImportRequired() ? "manual" : "direct",
    title: row.title,
    author: row.author,
    cover: null,
    language: row.languages.includes(language) ? language : row.languages[0],
    source: "Project Gutenberg",
    sourceUrl: `https://www.gutenberg.org/ebooks/${row.number}`,
    rights: t(RIGHTS),
    rightsUrl: "https://www.gutenberg.org/policy/license",
  };
}

async function search({ query, language, page, signal, preferredBooks = [] }) {
  const terms = normalizeCatalogQuery(query).split(" ").filter(Boolean);
  const phrase = terms.join(" ");
  const rows = (await loadIndex(language, signal)).filter((row) =>
    terms.every((term) => row.search.includes(term)),
  );
  signal?.throwIfAborted();
  const rank = (row) =>
    phrase && row.normalizedTitle === phrase
      ? 2
      : phrase && row.normalizedTitle.startsWith(phrase)
        ? 1
        : 0;
  rows.sort(
    (a, b) =>
      rank(b) - rank(a) || b.popularity - a.popularity || a.number - b.number,
  );
  const preferred = new Set(
    preferredBooks.map((book) => book.canonicalSourceId),
  );
  const remaining = rows.filter(
    (row) => !preferred.has(`gutenberg:${row.number}`),
  );
  const count = remaining.length + preferredBooks.length;
  const start = (page - 1) * PAGE_SIZE;
  const books = [];
  for (let index = start; index < Math.min(start + PAGE_SIZE, count); index++) {
    books.push(
      index < preferredBooks.length
        ? preferredBooks[index]
        : publicBook(remaining[index - preferredBooks.length], language),
    );
  }
  return {
    books,
    count,
    countIsApproximate: false,
    hasNext: start + PAGE_SIZE < count,
    snapshotDate: manifest.generatedAt,
  };
}

async function download(book, { signal } = {}) {
  signal?.throwIfAborted();
  // Never forward a URL supplied by catalog data or an imported book. The relay
  // accepts a Gutenberg identifier and resolves a reviewed upstream itself.
  const number = /^gutenberg-([1-9]\d{0,8})$/.exec(book?.id || "")?.[1];
  if (!number) {
    throw catalogError("INVALID_BOOK", "Ce livre n’a pas d’identifiant Gutenberg valide.");
  }
  if (manualImportRequired()) {
    throw catalogError(
      "MANUAL_IMPORT_REQUIRED",
      "Téléchargez l’EPUB depuis Project Gutenberg, puis importez-le ici pour commencer votre lecture.",
    );
  }
  if (globalThis.navigator?.onLine === false) {
    throw catalogError(
      "OFFLINE",
      "Connectez-vous pour télécharger ce livre une première fois. Il restera ensuite disponible dans votre bibliothèque hors ligne.",
    );
  }
  const relay = configuredGutenbergRelay();
  const url = `${relay ? `${relay}/` : import.meta.env.BASE_URL}api/books/gutenberg/${number}.epub`;
  try {
    return await request(url, {
      signal,
      timeout: 40_000,
      maxBytes: MAX_BOOK_BYTES,
      download: true,
      validateUrl: (value) =>
        new URL(value).href ===
        new URL(url, globalThis.location?.href || "http://localhost/").href,
    });
  } catch (error) {
    if (error?.code === "NETWORK") {
      throw catalogError(
        "NETWORK",
        "Le téléchargement n’a pas abouti. Vérifiez votre connexion puis réessayez. Les livres déjà dans votre bibliothèque restent disponibles.",
        error,
      );
    }
    throw error;
  }
}

export default defineSource({
  manifest: {
    id: "gutenberg",
    name: "Project Gutenberg",
    version: "3.1.0",
    apiVersion: 1,
    description: manualImportRequired()
      ? "Recherche locale dans le catalogue officiel ; EPUB à télécharger depuis la source puis à importer."
      : "Recherche locale dans le catalogue officiel ; téléchargement de l’EPUB et lecture en un clic.",
    website: "https://www.gutenberg.org/",
    policy: "https://www.gutenberg.org/policy/",
    capabilities: { search: true, download: true, bundled: false },
  },
  search,
  download,
});
