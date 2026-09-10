// Read persisted/cross-device data defensively. Returned objects contain only reader fields.
const MAX_INTEGER = 2147483647;
const MAX_MARKS = 1000;
const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value, limit) =>
  typeof value === "string" ? value.slice(0, limit) : "";

function number(value, fallback = 0) {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
const fraction = (value) => Math.max(0, Math.min(1, number(value)));
const integer = (value, maximum = MAX_INTEGER) =>
  Math.floor(Math.max(0, Math.min(maximum, number(value))));

function timestamp(value) {
  const parsed =
    typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)
      ? Date.parse(value)
      : number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 8640000000000000)
    : 0;
}

function locator(value, chapterId = "") {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.textOffset !== "number" ||
    !Number.isFinite(value.textOffset) ||
    value.textOffset < 0
  )
    return null;
  const target = text(value.chapterId, 512);
  if (chapterId && target && target !== chapterId) return null;
  return {
    version: 1,
    chapterId: target || chapterId,
    textOffset: integer(value.textOffset),
    exact: text(value.exact, 2000),
    prefix: text(value.prefix, 200),
    suffix: text(value.suffix, 200),
    progression: fraction(value.progression),
  };
}

function stableId(value, kind, chapterIndex, anchor, fallback) {
  if (typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value))
    return value;
  // A deterministic migration ID keeps old bookmarks stable until their next local save.
  const input = `${kind}:${chapterIndex}:${anchor?.textOffset ?? ""}:${anchor?.exact || ""}:${fallback}`;
  let hash = 2166136261;
  for (const character of input)
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return `legacy-${kind}-${chapterIndex}-${(hash >>> 0).toString(16)}`;
}

/** Normalize a local or remote position without mutating its source or guessing new passages. */
export function normalizePosition(value, book) {
  const source = isRecord(value) ? value : {};
  const chapters =
    Array.isArray(book?.chapters) && book.chapters.length
      ? book.chapters
      : null;
  const maximumChapter = chapters ? chapters.length - 1 : MAX_INTEGER;
  const chapterIndex = integer(source.chapterIndex, maximumChapter);
  const scrollRatio = fraction(source.scrollRatio);
  const position = {
    chapterIndex,
    completed: source.completed === true,
    scrollRatio,
    wordIndex: integer(source.wordIndex),
    progress: fraction(source.progress),
    chapterProgress: fraction(source.chapterProgress ?? source.scrollRatio),
    locator: locator(source.locator, chapters?.[chapterIndex]?.id),
    bookmarks: [],
    annotations: [],
  };
  if (timestamp(source.updatedAt))
    position.updatedAt = timestamp(source.updatedAt);
  for (const kind of ["bookmarks", "annotations"]) {
    const seen = new Set();
    if (!Array.isArray(source[kind])) continue;
    for (const item of source[kind].slice(0, MAX_MARKS)) {
      if (!isRecord(item)) continue;
      const chapter = number(item.chapterIndex, -1);
      if (!Number.isInteger(chapter) || chapter < 0 || chapter > maximumChapter)
        continue;
      const anchor = locator(item.locator, chapters?.[chapter]?.id);
      const quote = text(item.quote, 2000) || anchor?.exact || "";
      if (kind === "annotations" && (!anchor || !quote)) continue;
      const scroll = fraction(item.scrollRatio);
      const word = integer(item.wordIndex);
      const id = stableId(
        item.id,
        kind,
        chapter,
        anchor,
        `${scroll}:${word}:${timestamp(item.createdAt)}`,
      );
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = {
        id,
        chapterIndex: chapter,
        locator: anchor,
        createdAt: timestamp(item.createdAt),
      };
      if (kind === "annotations") {
        entry.quote = quote;
        entry.note = text(item.note, 4000);
        entry.color = "gold";
      } else {
        entry.scrollRatio = scroll;
        entry.wordIndex = word;
        const label = text(item.label, 160);
        if (label) entry.label = label;
      }
      position[kind].push(entry);
    }
  }
  return position;
}

/** Missing reading-state fields indicate a broken payload, not a request to reset progress. */
export function isReadingPosition(value) {
  return (
    isRecord(value) &&
    ["chapterIndex", "wordIndex", "scrollRatio", "progress"].every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        value[key] >= 0,
    ) &&
    Number.isInteger(value.chapterIndex) &&
    Number.isInteger(value.wordIndex) &&
    value.chapterIndex <= MAX_INTEGER &&
    value.wordIndex <= MAX_INTEGER &&
    value.scrollRatio <= 1 &&
    value.progress <= 1
  );
}
