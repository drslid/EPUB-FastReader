// Locations refer to text, never to Focus markup or a particular screen size.
// Offsets use UTF-16 code units, like the DOM Range API.
const BLOCKS =
  "p,div,section,article,li,dd,dt,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre,figcaption";
const EXCLUDED = "script,style,template,noscript,[hidden],[aria-hidden='true']";
const QUOTE_LENGTH = 96;
const CONTEXT_LENGTH = 48;

function clamp(value, maximum = 1) {
  return Math.max(0, Math.min(maximum, Number(value) || 0));
}

function textIndex(root) {
  if (!root) return { text: "", segments: [] };
  const doc = root.ownerDocument;
  const filter = doc.defaultView?.NodeFilter || {
    SHOW_ELEMENT: 1,
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
  };
  const walker = doc.createTreeWalker(
    root,
    filter.SHOW_ELEMENT | filter.SHOW_TEXT,
    {
      acceptNode(node) {
        return node.nodeType === 1 && node.matches(EXCLUDED)
          ? filter.FILTER_REJECT
          : filter.FILTER_ACCEPT;
      },
    },
  );
  const chunks = [];
  const segments = [];
  let length = 0;
  let lastBlock = null;
  let boundary = false;
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== 3) {
      if (node.nodeName === "BR") boundary = true;
      continue;
    }
    if (!node.nodeValue) continue;
    const block = node.parentElement?.closest(BLOCKS) || root;
    if (length && (boundary || (lastBlock && block !== lastBlock))) {
      chunks.push("\n");
      length += 1;
    }
    boundary = false;
    lastBlock = block;
    segments.push({ node, start: length, end: length + node.nodeValue.length });
    chunks.push(node.nodeValue);
    length += node.nodeValue.length;
  }
  return { text: chunks.join(""), segments };
}

/** Extract the same text for RSVP and saved locations, preserving inline words. */
export function getTextContent(root) {
  return textIndex(root).text;
}

function safeOffset(text, value) {
  let offset = Math.floor(clamp(value, text.length));
  if (
    offset > 0 &&
    /[\uDC00-\uDFFF]/u.test(text[offset] || "") &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1])
  )
    offset -= 1;
  return offset;
}

function rangeAt(index, start, end = start + 1) {
  const first =
    index.segments.find((segment) => segment.end > start) ||
    index.segments.at(-1);
  if (!first) return null;
  const last =
    index.segments.find(
      (segment) => segment.end >= end && segment.end > start,
    ) || index.segments.at(-1);
  const range = first.node.ownerDocument.createRange();
  range.setStart(first.node, clamp(start - first.start, first.node.length));
  range.setEnd(last.node, clamp(end - last.start, last.node.length));
  return range;
}

function firstVisibleOffset(index, container) {
  if (!container?.getBoundingClientRect) return 0;
  const top =
    container.getBoundingClientRect().top + (container.clientTop || 0) + 8;
  for (const segment of index.segments) {
    const range = segment.node.ownerDocument.createRange();
    range.selectNodeContents(segment.node);
    if (!range?.getClientRects) break;
    const visible = Array.from(range.getClientRects()).some(
      (rect) => rect.width > 0 && rect.bottom > top,
    );
    if (!visible) continue;
    // A text node can span many lines. Find its first glyph below the viewport
    // edge instead of saving the beginning of an entire, long paragraph.
    let low = 0;
    let high = segment.node.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      range.setStart(segment.node, middle);
      range.setEnd(segment.node, middle + 1);
      const rect = range.getBoundingClientRect();
      if (rect.bottom > top) high = middle;
      else low = middle + 1;
    }
    return segment.start + low;
  }
  const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
  return maximum
    ? Math.floor(clamp(container.scrollTop / maximum) * index.text.length)
    : 0;
}

function offsetForWord(text, wordIndex) {
  let remaining = Math.max(0, Math.floor(Number(wordIndex) || 0));
  let last = 0;
  for (const word of text.matchAll(/\S+/gu)) {
    last = word.index;
    if (remaining-- === 0) return last;
  }
  return last;
}

/**
 * Save a location using an explicit textOffset/RSVP wordIndex or the first
 * visible text in scrollContainer. Progression is text-based within a chapter.
 */
export function createTextLocator(
  root,
  { scrollContainer = root, chapterId = "", wordIndex, textOffset } = {},
) {
  const index = textIndex(root);
  let offset = Number.isFinite(textOffset)
    ? textOffset
    : Number.isFinite(wordIndex)
      ? offsetForWord(index.text, wordIndex)
      : firstVisibleOffset(index, scrollContainer);
  offset = safeOffset(index.text, offset);
  while (offset < index.text.length && /\s/u.test(index.text[offset]))
    offset += 1;
  const quoteEnd = safeOffset(index.text, offset + QUOTE_LENGTH);
  return {
    version: 1,
    chapterId,
    textOffset: offset,
    exact: index.text.slice(offset, quoteEnd),
    prefix: index.text.slice(
      safeOffset(index.text, offset - CONTEXT_LENGTH),
      offset,
    ),
    suffix: index.text.slice(
      quoteEnd,
      safeOffset(index.text, quoteEnd + CONTEXT_LENGTH),
    ),
    progression: index.text.length ? offset / index.text.length : 0,
  };
}

function matchingContext(text, offset, locator) {
  let score = 0;
  const prefix = typeof locator.prefix === "string" ? locator.prefix : "";
  const suffix = typeof locator.suffix === "string" ? locator.suffix : "";
  for (
    let i = 1;
    i <= prefix.length && text[offset - i] === prefix[prefix.length - i];
    i++
  )
    score += 1;
  const end = offset + locator.exact.length;
  for (let i = 0; i < suffix.length && text[end + i] === suffix[i]; i++)
    score += 1;
  return score;
}

function resolveOffset(index, locator) {
  if (!locator || !index.text.length) return null;
  const expected = safeOffset(index.text, locator.textOffset);
  if (typeof locator.exact !== "string" || !locator.exact.length) {
    return Number.isFinite(locator.textOffset) ? expected : null;
  }
  let best = null;
  let bestScore = -1;
  let from = 0;
  let found;
  while ((found = index.text.indexOf(locator.exact, from)) !== -1) {
    const score = matchingContext(index.text, found, locator);
    if (
      score > bestScore ||
      (score === bestScore &&
        Math.abs(found - expected) < Math.abs(best - expected))
    ) {
      best = found;
      bestScore = score;
    }
    from = found + 1;
  }
  return best;
}

/** Resolve a saved quote; contextual matching disambiguates repeated passages. */
export function locateTextRange(root, locator) {
  const index = textIndex(root);
  const offset = resolveOffset(index, locator);
  if (offset === null) return null;
  const end = safeOffset(index.text, offset + (locator.exact?.length || 1));
  return rangeAt(index, offset, end);
}

/** Restore near the top of the reader, falling back to progression if needed. */
export function restoreTextLocator(root, locator, scrollContainer = root) {
  if (!root || !locator || !scrollContainer) return false;
  const range = locateTextRange(root, locator);
  const rect = range?.getClientRects
    ? Array.from(range.getClientRects()).find(
        (item) => item.width > 0 && item.height > 0,
      )
    : null;
  if (rect) {
    const viewport = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTop +=
      rect.top - viewport.top - (scrollContainer.clientTop || 0) - 8;
    return true;
  }
  if (Number.isFinite(locator.progression)) {
    scrollContainer.scrollTop =
      clamp(locator.progression) *
      Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    return true;
  }
  return false;
}

/** Word index matching the extracted text, suitable for returning to RSVP. */
export function wordIndexForLocator(root, locator) {
  const index = textIndex(root);
  const offset = resolveOffset(index, locator);
  const position =
    offset ?? Math.floor(clamp(locator?.progression) * index.text.length);
  let wordIndex = 0;
  for (const word of index.text.matchAll(/\S+/gu)) {
    if (word.index + word[0].length > position) return wordIndex;
    wordIndex += 1;
  }
  return Math.max(0, wordIndex - 1);
}

function boundaryOffset(index, node, offset, isEnd = false) {
  let previous = 0;
  for (const segment of index.segments) {
    if (segment.node === node)
      return segment.start + clamp(offset, node.length);
    const range = segment.node.ownerDocument.createRange();
    range.selectNodeContents(segment.node);
    if (range.comparePoint(node, offset) < 0)
      return isEnd ? previous : segment.start;
    previous = segment.end;
  }
  return index.text.length;
}

/** Capture a selection contained entirely inside the chapter (up to 2,000 chars). */
export function createSelectionLocator(root, range, { chapterId = "" } = {}) {
  if (
    !root ||
    !range ||
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const index = textIndex(root);
  const start = safeOffset(
    index.text,
    boundaryOffset(index, range.startContainer, range.startOffset),
  );
  const end = safeOffset(
    index.text,
    Math.min(
      boundaryOffset(index, range.endContainer, range.endOffset, true),
      start + 2000,
    ),
  );
  if (end <= start || !index.text.slice(start, end).trim()) return null;
  return {
    version: 1,
    chapterId,
    textOffset: start,
    exact: index.text.slice(start, end),
    prefix: index.text.slice(
      safeOffset(index.text, start - CONTEXT_LENGTH),
      start,
    ),
    suffix: index.text.slice(end, safeOffset(index.text, end + CONTEXT_LENGTH)),
    progression: index.text.length ? start / index.text.length : 0,
  };
}

/** Mark each selected text fragment without moving or flattening its ancestors. */
export function applyLocatorHighlight(
  root,
  locator,
  { className = "reading-highlight", id = "" } = {},
) {
  const index = textIndex(root);
  const start = resolveOffset(index, locator);
  if (start === null || !locator.exact?.length) return [];
  const end = start + locator.exact.length;
  const highlights = [];
  for (const segment of index.segments) {
    if (segment.end <= start || segment.start >= end) continue;
    const range = segment.node.ownerDocument.createRange();
    range.setStart(segment.node, Math.max(0, start - segment.start));
    range.setEnd(
      segment.node,
      Math.min(segment.node.length, end - segment.start),
    );
    const mark = segment.node.ownerDocument.createElement("mark");
    mark.className = className;
    if (id) mark.dataset.annotationId = String(id);
    range.surroundContents(mark);
    highlights.push(mark);
  }
  return highlights;
}
