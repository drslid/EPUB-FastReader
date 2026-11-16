const SPACE = "▁";
const encoder = new TextEncoder();

/** The pinned French checkpoint uses SentencePiece Unigram with Metaspace and UTF-8 byte fallback. */
export function createPocketTokenizer({ model, normalizer, pre_tokenizer: preTokenizer }) {
  const prepend = normalizer?.type === "Sequence" && normalizer.normalizers?.length === 1
    ? normalizer.normalizers[0] : normalizer;
  if (model?.type !== "Unigram" || !model.byte_fallback ||
      prepend?.type !== "Prepend" || prepend.prepend !== SPACE || preTokenizer?.type !== "Metaspace" ||
      preTokenizer.replacement !== SPACE || preTokenizer.prepend_scheme !== "always" || !preTokenizer.split) {
    throw new Error("Unsupported Pocket TTS tokenizer");
  }
  const pieces = new Map(model.vocab.map(([piece, score], id) => [piece, { id, score }]));
  const maxLength = Math.max(...model.vocab.map(([piece]) => piece.length));
  const unknownScore = Math.min(...model.vocab.map(([, score]) => score)) - 10;
  const byteIds = Array.from({ length: 256 }, (_, byte) =>
    pieces.get(`<0x${byte.toString(16).toUpperCase().padStart(2, "0")}>`)?.id);
  if (byteIds.some(id => id === undefined)) throw new Error("Incomplete Pocket TTS tokenizer");

  function encodeWord(word, ids) {
    const chars = Array.from(word);
    const best = Array(chars.length + 1);
    best[0] = { score: 0 };
    const visit = (from, to, id, score) => {
      const total = best[from].score + score;
      if (!best[to] || total > best[to].score) best[to] = { from, id, score: total };
    };
    for (let from = 0; from < chars.length; from++) {
      let piece = "";
      for (let to = from + 1; to <= Math.min(chars.length, from + maxLength); to++) {
        piece += chars[to - 1];
        const token = pieces.get(piece);
        if (token) visit(from, to, token.id, token.score);
        else if (to === from + 1) visit(from, to, model.unk_id, unknownScore);
      }
    }

    const path = [];
    for (let end = chars.length; end > 0; end = best[end].from) path.push(best[end]);
    for (const token of path.reverse()) {
      if (token.id === model.unk_id) {
        for (const byte of encoder.encode(chars[token.from])) ids.push(byteIds[byte]);
      } else ids.push(token.id);
    }
  }

  return text => {
    const ids = [];
    // Escape literal markup as text. Each space starts an independent Metaspace piece.
    const words = `${SPACE}${text.replaceAll(" ", SPACE)}`.split(/(?=▁)/u);
    for (const word of words) encodeWord(word, ids);
    return ids;
  };
}
