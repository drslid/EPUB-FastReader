const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

// Cover combining marks, variation selectors and common emoji on older WebKit.
const extensions = String.raw`[\p{M}\p{Emoji_Modifier}\u{E0020}-\u{E007F}]*`;
const pictograph = String.raw`\p{Extended_Pictographic}${extensions}`;
const fallbackGraphemes = new RegExp(
  String.raw`\p{Regional_Indicator}{1,2}|${pictograph}(?:\u200D${pictograph})*|.${extensions}`,
  "gsu",
);
const pivotLengths = [1, 5, 9, 13, Infinity];

export function splitRsvpWord(word) {
  const graphemes = segmenter
    ? Array.from(segmenter.segment(word), ({ segment }) => segment)
    : word.match(fallbackGraphemes) ?? [];
  const letters = [];
  let index = 0;
  for (const grapheme of graphemes) {
    if (/[\p{L}\p{N}]/u.test(grapheme)) letters.push({ grapheme, index });
    index += grapheme.length;
  }

  const selected = letters[pivotLengths.findIndex(length => letters.length <= length)];
  if (!selected) return { before: word, pivot: "", after: "" };
  return {
    before: word.slice(0, selected.index),
    pivot: selected.grapheme,
    after: word.slice(selected.index + selected.grapheme.length),
  };
}
