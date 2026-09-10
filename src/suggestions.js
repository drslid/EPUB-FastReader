const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[’']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

function identities(book) {
  if (!book || typeof book !== "object") return [];
  const ids = [book.id, book.source?.bookId, book.source?.selection]
    .filter((value) => typeof value === "string" && value)
    .map((value) => `id:${value}`);
  const canonical = book.canonicalSourceId || book.source?.canonicalSourceId;
  if (typeof canonical === "string" && canonical)
    ids.push(`canonical:${canonical}`);
  // An imported edition can lack source metadata. Match its named work locally.
  if (book.title && book.author)
    ids.push(`work:${normalize(book.title)}:${normalize(book.author)}`);
  return ids;
}

function libraryIndex(library) {
  const index = new Map();
  for (const book of Array.isArray(library) ? library : []) {
    for (const identity of new Set(identities(book))) {
      const editions = index.get(identity) || [];
      editions.push(book);
      index.set(identity, editions);
    }
  }
  // Keep alternatives: the preferred edition may have incompatible source data.
  for (const editions of index.values())
    editions.sort(
      (left, right) => readingPriority(left) - readingPriority(right),
    );
  return index;
}

function languageOf(book) {
  if (typeof book?.language !== "string") return "";
  const base = book.language.trim().toLowerCase().split(/[-_]/u)[0];
  if (["", "und", "mul", "zxx"].includes(base)) return "";
  return (
    { fra: "fr", fre: "fr", eng: "en", deu: "de", ger: "de", spa: "es" }[
      base
    ] || base
  );
}

function compatibleWork(book, local) {
  const canonical = book.canonicalSourceId || book.source?.canonicalSourceId;
  const localCanonical =
    local.canonicalSourceId || local.source?.canonicalSourceId;
  if (canonical && localCanonical && canonical !== localCanonical) return false;
  const language = languageOf(book);
  const localLanguage = languageOf(local);
  return !language || !localLanguage || language === localLanguage;
}

function findLocalBook(book, index) {
  for (const identity of identities(book)) {
    const editions = index.get(identity) || [];
    const found = identity.startsWith("work:")
      ? editions.find((local) => compatibleWork(book, local))
      : editions[0];
    if (found) return found;
  }
  return null;
}

/** Match a source edition or imported work to its existing local library entry. */
export function findLibraryBook(book, library = []) {
  return findLocalBook(book, libraryIndex(library));
}

function progressOf(book) {
  const value = book?.position?.progress;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function readingPriority(book) {
  if (!book) return 0;
  const progress = progressOf(book);
  if (book.position?.completed === true || progress === 1) return 3;
  return progress > 0 ? 2 : 1;
}

function randomRank(seed, identity) {
  let hash = 2166136261;
  for (const character of `${String(seed)}\u0000${identity}`)
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  // An avalanche prevents adjacent IDs from moving together as the seed changes.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function compareScores(left, right) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Choose only immediately readable editions, without network access or mutation.
 * The caller owns the seed and previous IDs: no timer, random global or storage is
 * consulted, so suggestions stay stable while the user navigates or types.
 */
export function selectSuggestions({
  catalog = [],
  library = [],
  previousIds = [],
  seed = "default",
  limit = 3,
} = {}) {
  if (!Number.isFinite(limit) || limit < 1 || !Array.isArray(catalog))
    return [];
  const maximum = Math.floor(limit);
  const localBooks = libraryIndex(library);
  const previous = new Set(Array.isArray(previousIds) ? previousIds : []);
  const seen = new Set();
  const candidates = [];
  for (const book of catalog) {
    if (
      !book ||
      typeof book.id !== "string" ||
      !book.id ||
      book.downloadMode !== "bundled"
    )
      continue;
    const keys = identities(book);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    candidates.push({
      book,
      priority: readingPriority(findLocalBook(book, localBooks)),
      previous:
        previous.has(book.id) || previous.has(book.canonicalSourceId) ? 1 : 0,
      author: normalize(book.author),
      genres: normalize(book.genre)
        .split(/\s*[·,;|]\s*/u)
        .filter(Boolean),
      rank: randomRank(seed, book.canonicalSourceId || book.id),
    });
  }
  // Stable tie breaking also makes changing the input order harmless.
  candidates.sort((left, right) => left.book.id.localeCompare(right.book.id));
  const selected = [];
  const authors = new Set();
  const genres = new Set();
  while (selected.length < maximum && candidates.length) {
    const score = (candidate) => [
      candidate.previous,
      candidate.priority,
      candidate.author && authors.has(candidate.author) ? 1 : 0,
      candidate.genres.filter((genre) => genres.has(genre)).length,
      candidate.rank,
    ];
    let bestIndex = 0;
    let bestScore = score(candidates[0]);
    for (let index = 1; index < candidates.length; index++) {
      const nextScore = score(candidates[index]);
      if (compareScores(nextScore, bestScore) < 0) {
        bestIndex = index;
        bestScore = nextScore;
      }
    }
    const [candidate] = candidates.splice(bestIndex, 1);
    selected.push(candidate.book);
    if (candidate.author) authors.add(candidate.author);
    for (const genre of candidate.genres) genres.add(genre);
  }
  return selected;
}

/** Explain the local reading status; never infer the reader's tastes. */
export function getRecommendationReason(book, library = []) {
  const local = findLibraryBook(book, library);
  const priority = readingPriority(local);
  if (priority === 0) return "À découvrir";
  if (priority === 1) return "Dans votre bibliothèque · à commencer";
  if (priority === 3) return "Déjà lu · à retrouver";
  const percent = Math.min(99, Math.round(progressOf(local) * 100));
  return percent > 0 ? `Reprendre à ${percent} %` : "Reprendre la lecture";
}
