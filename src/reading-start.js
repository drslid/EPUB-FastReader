import { getTextContent } from "./reading-location.js";

const HEADER_SELECTOR =
  '[id="pg-header"], [id$="--pg-header"], .pgheader';
const FOOTER_SELECTOR =
  '[id="pg-footer"], [id$="--pg-footer"], .pgfooter';
const START_MARKER =
  /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG E(?:BOOK|TEXT)\b[\s\S]{0,600}?\*{3}/i;
const END_MARKER =
  /^\s*\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG E(?:BOOK|TEXT)\b/i;
const HEADER_INTRO =
  /^\s*(?:The Project Gutenberg eBook\b|This eBook is for the use of anyone\b|Project Gutenberg['’]s\b)/i;

function afterLegacyCredits(article, text, offset) {
  // Older text conversions repeat their production metadata after START.
  // Only recognize a confirmed production paragraph followed by named fields.
  const blocks = [];
  let cursor = offset;
  for (const paragraph of article.querySelectorAll("p")) {
    if (paragraph.closest(HEADER_SELECTOR)) continue;
    const quote = getTextContent(paragraph).trim();
    if (!quote) continue;
    const start = text.indexOf(quote, cursor);
    if (start < 0 || start > offset + 4_000) continue;
    blocks.push({ quote, start, end: start + quote.length });
    cursor = start + quote.length;
    if (blocks.length === 16) break;
  }
  if (
    !blocks.length ||
    text.slice(offset, blocks[0].start).trim() ||
    !/^This eBook was produced by\b/i.test(blocks[0].quote) ||
    !["Author", "Title", "Language"].every((field) =>
      blocks.slice(1, 8).some((block) =>
        new RegExp(`^${field}\\s*:`, "i").test(block.quote),
      ),
    )
  ) return offset;

  let end = offset;
  for (const block of blocks) {
    if (text.slice(end, block.start).trim()) break;
    const production = /^This eBook was produced by\b/i.test(block.quote);
    const metadata = /^(?:Author|Title|Remark|Language|Encoding)\s*:/i.test(block.quote);
    const digitizationCredit =
      /^(?:We thank|Nous remercions)\b/i.test(block.quote) &&
      /gallica\.bnf\.fr/i.test(block.quote) &&
      /(?:image|OCR|etext)/i.test(block.quote);
    if (!production && !metadata && !digitizationCredit) break;
    end = block.end;
  }
  return end;
}

function hintAt(chapter, text, offset) {
  const whitespace = /^\s*/u.exec(text.slice(offset))[0].length;
  const start = offset + whitespace;
  if (text.length - start < 10) return null;
  // The caller resolves an exact quote in the original, unchanged chapter.
  // Refuse an ambiguous quote instead of returning an earlier occurrence.
  for (const length of [160, 320, 640]) {
    const exact = text.slice(start, start + length).trimEnd();
    if (text.indexOf(exact) === start && text.lastIndexOf(exact) === start)
      return { chapterId: chapter.id, exact };
  }
  return null;
}

/**
 * A starting hint for confirmed Gutenberg boilerplate. Chapters, titles,
 * prefaces and the original licence remain untouched and navigable.
 * Call only for Gutenberg sources; a curated hint takes precedence.
 */
export function getGutenbergReadingStart(book) {
  if (!Array.isArray(book?.chapters)) return null;
  let passedHeader = false;
  for (const chapter of book.chapters) {
    const article = document.createElement("article");
    article.innerHTML = chapter.html || "";
    const text = getTextContent(article);
    if (!text.trim()) continue;

    const header = article.querySelector(HEADER_SELECTOR);
    const marker = START_MARKER.exec(text.slice(0, 12_000));
    let offset = 0;
    if (header) {
      const headerText = getTextContent(header).trim();
      const start = text.indexOf(headerText);
      if (start < 0 || text.slice(0, start).trim()) return null;
      offset = start + headerText.length;
      passedHeader = true;
    } else if (marker && HEADER_INTRO.test(text.slice(0, marker.index))) {
      offset = marker.index + marker[0].length;
      passedHeader = true;
    } else if (!passedHeader) {
      // A title or ordinary text before the header is a valid natural opening.
      return null;
    }

    offset = afterLegacyCredits(article, text, offset);
    const remaining = text.slice(offset).trim();
    if (!remaining) continue;
    const footer = article.querySelector(FOOTER_SELECTOR);
    if (
      END_MARKER.test(remaining) ||
      /^THE FULL PROJECT GUTENBERG(?:™)? LICENSE\b/i.test(remaining) ||
      (footer && getTextContent(footer).trim() === remaining)
    ) return null;
    return hintAt(chapter, text, offset);
  }
  return null;
}
