import { defineSource } from "./source.js";
import selection from "./selection.js";
import gutenberg from "./gutenberg.js";

async function search(options) {
  const local = await selection.search({ ...options, page: 1 });
  try {
    const result = await gutenberg.search({
      ...options,
      preferredBooks: local.books,
    });
    return { ...result, warnings: [] };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error?.name === "AbortError") throw error;
    return {
      books: options.page === 1 ? local.books : [],
      count: local.count,
      countIsApproximate: false,
      hasNext: false,
      warnings: [
        {
          providerId: "gutenberg",
          code: error?.code || "NETWORK",
          message:
            "Le catalogue complet n’a pas pu être chargé. Les livres disponibles ici restent accessibles. Rechargez l’application puis réessayez.",
        },
      ],
    };
  }
}

export default defineSource({
  manifest: {
    id: "all",
    name: "Tout le catalogue",
    version: "2.0.0",
    apiVersion: 1,
    description:
      "Livres à lire ici et catalogue officiel dans une recherche locale commune.",
    website: "https://www.gutenberg.org/",
    policy: "https://www.gutenberg.org/policy/",
    capabilities: { search: true, download: false, bundled: false },
  },
  search,
});
