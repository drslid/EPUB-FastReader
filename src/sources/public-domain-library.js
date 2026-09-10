import { defineSource } from "./source.js";

// No supported public search API or OPDS endpoint has been verified.
export default defineSource({
  manifest: {
    id: "public-domain-library",
    name: "Public Domain Library",
    version: "1.0.0",
    apiVersion: 1,
    description:
      "Téléchargez un EPUB sur le site, puis importez-le ici. Recherche intégrée à venir.",
    website: "https://publicdomainlibrary.org/en/ebooks",
    policy: "https://publicdomainlibrary.org/en/terms-and-conditions",
    capabilities: { search: false, download: false, bundled: false },
  },
});
