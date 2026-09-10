import { defineSource } from "./source.js";
import { catalogError, request, MAX_BOOK_BYTES } from "./transport.js";
import { normalizeCatalogQuery } from "./query.js";

// These exact original editions and their licenses ship with the application.
// Provenance, rights review, file sizes and hashes: public/books/provenance.json.
const entries = Object.freeze([
  Object.freeze({
    id: "selection-le-horla",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "8 mai. — Quelle journée admirable ! J'ai\npassé toute la matinée étendu sur l'herbe,\ndevant ma ma",
    },
    title: "Le Horla",
    author: "Guy de Maupassant",
    description:
      "Un recueil de quatorze nouvelles, entre quotidien et fantastique.",
    genre: "Nouvelles · Fantastique",
    gutenbergId: 10775,
    filename: "le-horla.epub",
    bytes: 175512,
  }),
  Object.freeze({
    id: "selection-trois-contes",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "Pendant un demi-siècle, les bourgeoises\nde Pont-l'Évêque envièrent à Mme Aubain\nsa servante Féli",
    },
    title: "Trois contes",
    author: "Gustave Flaubert",
    description:
      "Un cœur simple, La Légende de saint Julien l’Hospitalier et Hérodias.",
    genre: "Contes · Classique",
    gutenbergId: 12065,
    filename: "trois-contes.epub",
    bytes: 152507,
  }),
  Object.freeze({
    id: "selection-candide",
    readingStart: {
      chapterId: "chapter-4",
      exact:
        "Candide parut au plus tard en mars 1759. Le roi de Prusse en accuse\nréception par sa lettre du 2",
    },
    title: "Candide, ou l’optimisme",
    author: "Voltaire",
    description: "Un conte philosophique en trente chapitres, paru en 1759.",
    genre: "Aventure · Philosophie",
    gutenbergId: 4650,
    filename: "candide.epub",
    bytes: 193809,
  }),
  Object.freeze({
    id: "selection-tour-du-monde",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "En l'année 1872, la maison portant le numéro 7 de Saville-row,\nBurlington Gardens—maison dans la",
    },
    title: "Le tour du monde en quatre-vingts jours",
    author: "Jules Verne",
    description: "Un pari, quatre-vingts jours et un voyage autour du monde.",
    genre: "Aventure · Voyage",
    gutenbergId: 800,
    filename: "tour-du-monde.epub",
    bytes: 263479,
  }),
  Object.freeze({
    id: "selection-voyage-centre-terre",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "Le 24 mai 1863, un dimanche, mon oncle, le professeur Lidenbrock,\nrevint précipitamment vers sa ",
    },
    title: "Voyage au centre de la Terre",
    author: "Jules Verne",
    description:
      "Un professeur, son neveu et une descente vers un monde inconnu.",
    genre: "Aventure · Science-fiction",
    gutenbergId: 4791,
    filename: "voyage-centre-terre.epub",
    bytes: 266329,
  }),
  Object.freeze({
    id: "selection-vingt-mille-lieues",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "L'année 1866 fut marquée par un événement bizarre, un phénomène inexpliqué et inexplicable que p",
    },
    title: "Vingt mille lieues sous les mers",
    author: "Jules Verne",
    description:
      "À bord du Nautilus, une exploration des océans avec le capitaine Nemo.",
    genre: "Aventure · Océan",
    gutenbergId: 5097,
    filename: "vingt-mille-lieues.epub",
    bytes: 443433,
  }),
  Object.freeze({
    id: "selection-notre-dame-paris",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "Il y a quelques années qu'en visitant, ou, pour mieux dire, en furetant\nNotre-Dame, l'auteur de ",
    },
    title: "Notre-Dame de Paris",
    author: "Victor Hugo",
    description: "Esmeralda et Quasimodo au cœur du Paris du XVe siècle.",
    genre: "Roman · Histoire",
    gutenbergId: 19657,
    filename: "notre-dame-paris.epub",
    bytes: 536662,
  }),
  Object.freeze({
    id: "selection-madame-bovary",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "Cher et illustre ami,\n\n\n\nPermettez-moi d’inscrire votre nom en tête de ce livre et au-dessus\nmêm",
    },
    title: "Madame Bovary",
    author: "Gustave Flaubert",
    description: "Emma Bovary entre rêves romanesques et vie provinciale.",
    genre: "Roman · Classique",
    gutenbergId: 14155,
    filename: "madame-bovary.epub",
    bytes: 387492,
  }),
  Object.freeze({
    id: "selection-dernier-jour-condamne",
    readingStart: {
      chapterId: "chapter-2",
      exact:
        "Il n'y avait en tête des premières éditions de cet ouvrage, publié\nd'abord sans nom d'auteur, qu",
    },
    title: "Le Dernier Jour d’un Condamné",
    author: "Victor Hugo",
    description:
      "Le journal d’un homme condamné et un plaidoyer contre la peine de mort.",
    genre: "Roman court · Société",
    gutenbergId: 6838,
    filename: "dernier-jour-condamne.epub",
    bytes: 167542,
  }),
]);

const byId = new Map(entries.map((entry) => [entry.id, entry]));

function assetUrl(filename) {
  return `${import.meta.env.BASE_URL}books/${filename}`;
}

function publicBook(entry) {
  return {
    id: entry.id,
    canonicalSourceId: `gutenberg:${entry.gutenbergId}`,
    providerId: "selection",
    title: entry.title,
    author: entry.author,
    description: entry.description,
    readingStart: entry.readingStart,
    genre: entry.genre,
    cover: null,
    language: "fr",
    source: "Project Gutenberg · sélection disponible ici",
    sourceUrl: `https://www.gutenberg.org/ebooks/${entry.gutenbergId}`,
    downloadUrl: assetUrl(entry.filename),
    actualDownloadUrl: assetUrl(entry.filename),
    downloadMode: "bundled",
    bytes: entry.bytes,
    rights:
      "Textes anciens du domaine public en France ; éditions déclarées libres aux États-Unis. Autres pays : vérifiez les droits locaux.",
    rightsUrl: assetUrl("NOTICE.html"),
  };
}

async function search({ query, language, page, signal }) {
  signal?.throwIfAborted();
  const terms = normalizeCatalogQuery(query).split(/\s+/u).filter(Boolean);
  const matches = entries.filter((entry) => {
    if (language && language !== "all" && language !== "fr") return false;
    const searchable = normalizeCatalogQuery(`${entry.title} ${entry.author}`);
    return terms.every((term) => searchable.includes(term));
  });
  return {
    books: page === 1 ? matches.map(publicBook) : [],
    count: matches.length,
    hasNext: false,
  };
}

async function download(book, { signal } = {}) {
  const entry = byId.get(book?.id);
  if (!entry) {
    throw catalogError(
      "INVALID_BOOK",
      "Ce livre ne fait pas partie de la sélection.",
    );
  }
  // Resolve only the reviewed file attached to this ID, never a caller's URL.
  const url = assetUrl(entry.filename);
  return request(url, {
    signal,
    timeout: 15_000,
    maxBytes: MAX_BOOK_BYTES,
    download: true,
    validateUrl: (value) => {
      const expected = new URL(
        url,
        globalThis.location?.href || "http://localhost/",
      );
      return new URL(value).href === expected.href;
    },
  });
}

export default defineSource({
  manifest: {
    id: "selection",
    name: "À lire maintenant",
    version: "1.1.0",
    apiVersion: 1,
    description:
      "Neuf classiques en français, disponibles directement dans le lecteur.",
    website: "https://www.gutenberg.org/",
    policy: "https://www.gutenberg.org/policy/license",
    capabilities: { search: true, download: true, bundled: true },
  },
  search,
  download,
});
