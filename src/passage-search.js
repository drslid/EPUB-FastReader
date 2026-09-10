import { createTextLocator, getTextContent } from "./reading-location.js";

const indexes = new WeakMap();

// Keep a map back to UTF-16 text offsets: normalization may remove accents,
// collapse whitespace, expand ligatures, or encounter supplementary characters.
function foldText(text) {
  const chunks = [];
  const starts = [];
  const ends = [];
  let offset = 0;
  let previousSpace = false;
  for (const character of text) {
    const end = offset + character.length;
    const folded = character
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .replace(/ß/g, "ss");
    if (!folded) {
      if (ends.length) ends[ends.length - 1] = end;
    } else if (/\s/u.test(folded)) {
      if (previousSpace) ends[ends.length - 1] = end;
      else {
        chunks.push(" ");
        starts.push(offset);
        ends.push(end);
      }
      previousSpace = true;
    } else {
      chunks.push(folded);
      for (let i = 0; i < folded.length; i++) {
        starts.push(offset);
        ends.push(end);
      }
      previousSpace = false;
    }
    offset = end;
  }
  return {
    text: chunks.join(""),
    starts: Uint32Array.from(starts),
    ends: Uint32Array.from(ends),
  };
}

function parseChapter(html) {
  return new DOMParser().parseFromString(String(html || ""), "text/html").body;
}

function bookIndex(book) {
  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
  const cached = indexes.get(book);
  if (
    cached &&
    cached.length === chapters.length &&
    cached.every(
      (entry, index) =>
        entry.html === chapters[index].html &&
        entry.id === chapters[index].id &&
        entry.title === chapters[index].title,
    )
  )
    return cached;
  const index = chapters.map((chapter) => {
    const text = getTextContent(parseChapter(chapter.html));
    return {
      html: chapter.html,
      id: chapter.id,
      title: chapter.title,
      original: text,
      folded: foldText(text),
    };
  });
  indexes.set(book, index);
  return index;
}

function excerpt(text, start, end) {
  let left = Math.max(0, start - 55);
  let right = Math.min(text.length, Math.max(left + 190, end));
  // Avoid half an emoji at either edge of the preview.
  if (/[\uDC00-\uDFFF]/u.test(text[left] || "")) left -= 1;
  if (/[\uDC00-\uDFFF]/u.test(text[right] || "")) right -= 1;
  const content = text.slice(left, right).replace(/\s+/gu, " ").trim();
  return Array.from(
    `${left ? "…" : ""}${content}${right < text.length ? "…" : ""}`,
  )
    .slice(0, 200)
    .join("");
}

/** Search locally, returning at most 20 anchored chapter passages in book order. */
export function searchPassages(book, query, { limit = 20 } = {}) {
  const trimmed = Array.from(String(query || "").trim())
    .slice(0, 120)
    .join("");
  const needle = foldText(trimmed).text.trim();
  if (!book || typeof book !== "object" || Array.from(needle).length < 2)
    return [];
  const maximum = Math.min(20, Math.max(0, Math.floor(Number(limit) || 0)));
  if (!maximum) return [];
  const results = [];
  for (const [chapterIndex, chapter] of bookIndex(book).entries()) {
    let from = 0;
    let found;
    let root;
    while ((found = chapter.folded.text.indexOf(needle, from)) !== -1) {
      const start = chapter.folded.starts[found];
      const end = chapter.folded.ends[found + needle.length - 1];
      root ||= parseChapter(chapter.html);
      results.push({
        chapterIndex,
        chapterTitle: chapter.title || `Chapitre ${chapterIndex + 1}`,
        quote: excerpt(chapter.original, start, end),
        locator: createTextLocator(root, {
          chapterId: chapter.id || `chapter-${chapterIndex + 1}`,
          textOffset: start,
        }),
      });
      if (results.length >= maximum) return results;
      from = found + needle.length;
    }
  }
  return results;
}
