import { normalizeBookLanguage } from "./voice-assets.js";
import { naturalSentenceRanges } from "./voice-text.js";

const openers = /^[¿¡«“„‘([{]+$/u;
const punctuation = /^[.!?…,;:»”’"')\]}—–]+$/u;
const terminalMark = /[.!?…][»”’"')\]}]*$/u;
const newline = /[\r\n\u2028\u2029]/u;
const webAddress = /(?:https?:\/\/|www\.|\S@\S)/iu;
const abbreviations = {
  de: /(?:^|\s)(?:z|z\.\s*b|u|u\.\s*a|bzw|nr|abb)\.$/iu,
  en: /(?:^|\s)(?:rev|hon|gen|capt|mt)\.$/iu,
  es: /(?:^|\s)(?:dra|sres|sras|ud|uds|núm)\.$/iu,
  fr: /(?:^|\s)(?:me|mes|n°)\.$/iu,
  it: /(?:^|\s)(?:dott\.ssa|dott|ing|avv|sigg)\.$/iu,
  pt: /(?:^|\s)(?:dra|srs|sras|profª|nº)\.$/iu,
};

function splitAtDashes(token) {
  if (!token.includes("—") || webAddress.test(token)) return [token];
  return token.split(/(?<=[\p{L}\p{M}\p{N}]—)(?=[\p{L}\p{N}])/u);
}

/** Display units preserve canonical offsets and the legacy whitespace word index. */
export function readingUnits(text, bookLanguage) {
  const language = normalizeBookLanguage(bookLanguage) || undefined;
  const units = [];
  let sourceIndex = 0;
  let prefix = null;
  for (const match of text.matchAll(/\S+/gu)) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    const previous = units.at(-1);
    const sameLine = previous && !newline.test(text.slice(previous.end, start));

    if (openers.test(token) || (token === "—" && (!sameLine || terminalMark.test(previous.text)))) {
      prefix = { start: prefix?.start ?? start, end };
    } else if (sameLine && !prefix && punctuation.test(token)) {
      previous.text += token;
      previous.end = end;
    } else {
      let anchor = start;
      for (const word of splitAtDashes(token)) {
        const attached = prefix && !newline.test(text.slice(prefix.end, anchor));
        units.push({
          text: (attached ? text.slice(prefix.start, prefix.end).replace(/\s+/gu, "") : "") + word,
          anchor,
          end: anchor + word.length,
          sourceIndex,
          endsSentence: false,
        });
        prefix = null;
        anchor += word.length;
      }
    }
    sourceIndex++;
  }

  const ranges = naturalSentenceRanges(text, language);
  const abbreviation = abbreviations[language];
  let unit = 0;
  for (const range of ranges) {
    while (unit < units.length && units[unit].anchor < range.end) unit++;
    const last = units[unit - 1];
    if (!last || last.end > range.end || !terminalMark.test(last.text)) continue;
    if (abbreviation?.test(text.slice(Math.max(0, range.end - 32), range.end).trimEnd())) continue;
    last.endsSentence = true;
  }
  return units;
}

export function readingUnitAtOffset(units, offset) {
  const index = units.findIndex(unit => unit.end > offset);
  return index < 0 ? Math.max(0, units.length - 1) : index;
}

/** Return to this sentence's start, or to the previous one when already there. */
export function previousReadingSentence(units, currentIndex) {
  let index = Math.max(0, currentIndex - 1);
  while (index > 0 && !units[index - 1].endsSentence) index--;
  return index;
}
