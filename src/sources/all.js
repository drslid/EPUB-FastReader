import { t } from "../i18n.js";
import { defineSource } from "./source.js";
import selection from "./selection.js";
import gutenberg from "./gutenberg.js";
import standardEbooks from "./standard-ebooks.js";
import ebooksGratuits from "./ebooks-gratuits.js";
import fadedpage from "./fadedpage.js";
import epubbooks from "./epubbooks.js";
import ebookzy from "./ebookzy.js";

const GUTENBERG_WARNING = "Le catalogue complet n’a pas pu être chargé. Les livres disponibles ici restent accessibles. Rechargez l’application puis réessayez.";

async function search(options = {}) {
  const { query = "", language = "", page = 1, signal, onUpdate } = options;
  signal?.throwIfAborted();
  const local = await selection.search({ query, language, page: 1, signal });
  signal?.throwIfAborted();
  const sources = [gutenberg];
  // Opening the app never launches an unsolicited search on every remote site.
  // A reader can still browse a provider explicitly using its own filter.
  if (query.trim()) {
    if (!language || language === "all" || language === "en") sources.push(standardEbooks, fadedpage, epubbooks, ebookzy);
    if (!language || language === "all" || language === "fr") sources.push(ebooksGratuits);
  }
  const results = new Map();
  const warnings = new Map();
  const statuses = new Map([
    ["selection", { status: "available", checkedAt: Date.now() }],
    ...sources.map((source) => [source.manifest.id, { status: "pending", checkedAt: null }]),
  ]);

  const snapshot = () => {
    const primary = results.get("gutenberg") || { ...local, books: page === 1 ? local.books : [], hasNext: false };
    const ordered = [primary, ...sources.filter((source) => source !== gutenberg).map((source) => results.get(source.manifest.id)).filter(Boolean)];
    const seen = new Set();
    const books = ordered.flatMap((result) => result.books).filter((book) => {
      const identity = book.canonicalSourceId || `${book.providerId}:${book.id}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const pendingSources = [...statuses].filter(([, value]) => value.status === "pending").map(([id]) => id);
    return {
      books,
      count: ordered.reduce((count, result) => count + result.count, 0),
      countIsApproximate: pendingSources.length > 0 || ordered.some((result) => result.countIsApproximate),
      hasNext: ordered.some((result) => result.hasNext),
      ...(primary.snapshotDate ? { snapshotDate: primary.snapshotDate } : {}),
      warnings: sources.map((source) => warnings.get(source.manifest.id)).filter(Boolean),
      pendingSources,
      sourceStatuses: Object.fromEntries([...statuses].map(([id, value]) => [id, { ...value }])),
    };
  };
  let active = true;
  const publish = () => {
    if (active && !signal?.aborted && typeof onUpdate === "function") onUpdate(snapshot());
  };
  publish();

  const tasks = sources.map(async (source) => {
    const id = source.manifest.id;
    try {
      const result = await source.search({
        query, language, page, signal,
        ...(id === "gutenberg" ? { preferredBooks: local.books } : {}),
      });
      signal?.throwIfAborted();
      results.set(id, result);
      statuses.set(id, { status: "available", checkedAt: Date.now() });
    } catch (error) {
      signal?.throwIfAborted();
      if (error?.name === "AbortError") throw error;
      const warning = {
        providerId: id,
        code: error?.code || "NETWORK",
        message: id === "gutenberg" ? t(GUTENBERG_WARNING) : error?.message || t("Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard."),
      };
      warnings.set(id, warning);
      statuses.set(id, { status: "unavailable", checkedAt: Date.now(), code: warning.code, message: warning.message });
    }
    publish();
  });

  let abort;
  try {
    // Abort also ends the aggregate immediately when an adapter ignores its signal.
    await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason || new DOMException(t("Requête annulée."), "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      Promise.all(tasks).then(resolve, reject);
    });
    signal?.throwIfAborted();
    return snapshot();
  } finally {
    active = false;
    signal?.removeEventListener("abort", abort);
  }
}

export default defineSource({
  manifest: {
    id: "all",
    name: "Tout le catalogue",
    version: "6.0.0",
    apiVersion: 1,
    description:
      "Livres disponibles ici et catalogues partenaires dans une recherche commune.",
    website: "https://www.gutenberg.org/",
    policy: "https://www.gutenberg.org/policy/",
    capabilities: { search: true, download: false, bundled: false },
  },
  search,
});
