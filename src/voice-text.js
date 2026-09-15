// Offsets refer to the same canonical UTF-16 chapter text as reading-location.
// This is the worker's defensive text bound, not the model's phoneme-token limit.
// The engine checks the real 512-token context and joins smaller WAV fragments
// before exposing a sentence to the player.
export const VOICE_TEXT_MAXIMUM = 8000;

const titleAbbreviations = new Set(["m", "mm", "mme", "mmes", "mlle", "mlles", "mr", "mrs", "ms", "dr", "dre", "drs", "pr", "prof", "sr", "sra", "srta", "sig", "sigra", "dott", "st", "ste"]);
const spoken = text => /[\p{L}\p{N}]/u.test(text);

function passage(text, start, end) {
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  return { start, end, text: text.slice(start, end) };
}

function graphemeBoundary(text, desired) {
  let boundary = 0;
  try {
    for (const entry of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
      if (entry.index > desired) break;
      boundary = entry.index;
    }
  } catch {
    for (let at = 0; at < text.length;) {
      if (at > desired) break;
      if (at && !/\p{M}/u.test(String.fromCodePoint(text.codePointAt(at)))) boundary = at;
      at += text.codePointAt(at) > 0xffff ? 2 : 1;
    }
  }
  return boundary;
}

function splitBoundary(text, target, minimum, maximum) {
  // Clause punctuation is preferable to splitting a grammatical phrase. A
  // decimal comma or clock time is part of its number, never a pause boundary.
  const punctuation = [...text.matchAll(/[;,:\u2013\u2014…]|\.{3,}|\)(?=\s)/gu)]
    .filter(match => !(/[,:]/u.test(match[0]) && /\d/u.test(text[match.index - 1] || "") && /\d/u.test(text[match.index + 1] || "")))
    .map(match => match.index + match[0].length);
  const whitespace = [...text.matchAll(/\s+/gu)].map(match => match.index);
  for (const candidates of [punctuation, whitespace]) {
    const eligible = candidates.filter(at => at >= minimum && at <= maximum && at > 0 && at < text.length)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    if (eligible.length) return eligible[0];
  }
  return graphemeBoundary(text, Math.min(target, maximum));
}

/** Split a rejected sentence at a natural internal boundary. The engine
 * synthesizes the pieces sequentially, then returns one complete audio clip. */
export function splitVoicePassage(value) {
  const text = value?.text;
  if (typeof text !== "string" || [...text].length < 2) return [];
  const target = Math.floor(text.length / 2);
  const boundary = splitBoundary(text, target, Math.max(1, Math.floor(text.length / 5)), Math.min(text.length - 1, Math.ceil(text.length * 4 / 5)));
  if (!boundary || boundary >= text.length) return [];
  const base = Math.max(0, Number(value.start) || 0);
  const parts = [passage(text, 0, boundary), passage(text, boundary, text.length)];
  if (!parts.every(part => part.text && spoken(part.text))) return [];
  return parts.map(part => ({ ...part, start: part.start + base, end: part.end + base }));
}

function continuesAbbreviation(before, after) {
  const tail = before.trimEnd();
  const next = after.trimStart();
  const word = /(?:^|[^\p{L}])(\p{L}{1,8})\.$/u.exec(tail)?.[1];
  if (word && titleAbbreviations.has(word.toLowerCase())) return true;
  if (word && /^\p{Lu}$/u.test(word) && !/^(?:Il|Ils|Elle|Elles|Je|Tu|Nous|Vous|On|Ce|Cet|Cette|Ces|Cela|Ceci|Le|La|Les|Un|Une|Des|I|The|This|That|He|She|It|They|We|You|Then)\b/u.test(next)) return true;
  if (/(?:p\.\s*ex|e\.\s*g|i\.\s*e|c\.\s*à\.\s*d|cf)\.$/iu.test(tail)) return true;
  if (/(?:^|\s)(?:p|pp|vol|fig|no)\.$/iu.test(tail) && /^(?:\d|ex\.)/iu.test(next)) return true;
  // A trailing ellipsis or common continuation abbreviation followed by a
  // lowercase word belongs to the same sentence, including fallback parsing.
  return /(?:\.{3,}|…|\betc\.)$/iu.test(tail) && /^\p{Ll}/u.test(next);
}

function naturalSentenceRanges(text, language) {
  // Canonical EPUB text can contain line breaks inside a sentence (from inline
  // layout or paragraph boundaries). Replace each code unit only for analysis:
  // the original characters and their offsets are retained in every result.
  const analysis = text.replace(/[\r\n\u2028\u2029]/gu, " ");
  let raw;
  try {
    raw = [...new Intl.Segmenter(language, { granularity: "sentence" }).segment(analysis)]
      .map(entry => ({ start: entry.index, end: entry.index + entry.segment.length }));
  } catch {
    raw = [];
    let start = 0;
    for (const match of analysis.matchAll(/[.!?…]+[»”’"')\]]*(?=\s|$)/gu)) {
      const end = match.index + match[0].length;
      raw.push({ start, end }); start = end;
    }
    if (start < text.length) raw.push({ start, end: text.length });
  }
  const ranges = [];
  for (const value of raw) {
    const current = { ...value };
    const previous = ranges.at(-1);
    if (previous) {
      const following = analysis.slice(current.start, current.end);
      const closer = /^\s*[»”’\])]+/u.exec(following);
      if (closer) {
        const remainder = following.slice(closer[0].length);
        if (/^[\s,;:—–-]*\p{Ll}/u.test(remainder)) { previous.end = current.end; continue; }
        // French typography allows a space before the closing guillemet.
        // Attach it to its quoted sentence, not to the following one.
        previous.end = current.start + closer[0].length;
        current.start = previous.end;
      }
      if (continuesAbbreviation(analysis.slice(previous.start, previous.end), analysis.slice(current.start, current.end))) {
        previous.end = current.end; continue;
      }
    }
    if (analysis.slice(current.start, current.end).trim()) ranges.push(current);
    else if (previous) previous.end = current.end;
  }
  return ranges;
}

function sentenceRanges(text, language) {
  const ranges = [];
  let start = 0;
  for (const line of text.matchAll(/[^\r\n\u2028\u2029]+/gu)) {
    if (!line[0].trim() || spoken(line[0])) continue;
    // Standalone ornaments and punctuation-only lines are not sentence text.
    // Retain their exact range so callers can skip them without attaching
    // "***" or a divider to the neighboring spoken sentence.
    for (const range of naturalSentenceRanges(text.slice(start, line.index), language)) {
      ranges.push({ start: start + range.start, end: start + range.end });
    }
    const end = line.index + line[0].length;
    ranges.push({ start: line.index, end });
    start = end;
  }
  for (const range of naturalSentenceRanges(text.slice(start), language)) {
    ranges.push({ start: start + range.start, end: start + range.end });
  }
  return ranges;
}

export function voicePassages(text, language = "fr", maximum = VOICE_TEXT_MAXIMUM) {
  if (typeof text !== "string" || !text.trim()) return [];
  const requested = Number(maximum);
  const limit = Math.max(40, Math.min(VOICE_TEXT_MAXIMUM, Number.isNaN(requested) ? VOICE_TEXT_MAXIMUM : Math.floor(requested)));
  const passages = [];
  for (const sentence of sentenceRanges(text, language)) {
    let start = sentence.start;
    while (start < sentence.end) {
      while (start < sentence.end && /\s/u.test(text[start])) start++;
      if (start >= sentence.end) break;
      let stop = sentence.end;
      if (stop - start > limit) {
        const sample = text.slice(start, Math.min(sentence.end, start + limit + 2));
        const boundary = splitBoundary(sample, limit, Math.floor(limit / 2), limit);
        stop = start + (boundary || (text.codePointAt(start) > 0xffff ? 2 : 1));
      }
      const part = passage(text, start, stop);
      if (part.text) passages.push(part);
      start = stop;
    }
  }
  return passages;
}

export function passageAtOffset(passages, offset = 0) {
  const index = passages.findIndex(passage => passage.end > Math.max(0, Number(offset) || 0));
  return index < 0 ? Math.max(0, passages.length - 1) : index;
}
