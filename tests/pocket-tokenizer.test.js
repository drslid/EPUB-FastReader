// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createPocketTokenizer } from "../src/pocket-tokenizer.js";

const pieces = [["<unk>", 0], ["▁", -1], ["salut", -2], ["▁salut", -1], ["été", -2], ["▁été", -1]];
const byteOffset = pieces.length;
const bytes = Array.from({ length: 256 }, (_, byte) => [
  `<0x${byte.toString(16).toUpperCase().padStart(2, "0")}>`, -10,
]);
const prepend = { type: "Prepend", prepend: "▁" };

describe.each([
  ["French", { type: "Sequence", normalizers: [prepend] }],
  ["English", prepend],
])("the Pocket TTS tokenizer for %s", (_language, normalizer) => {
  const config = {
    model: { type: "Unigram", byte_fallback: true, unk_id: 0, vocab: [...pieces, ...bytes] },
    normalizer,
    pre_tokenizer: { type: "Metaspace", replacement: "▁", prepend_scheme: "always", split: true },
  };

  it("prefers the best-scored Unigram segmentation for each word", () => {
    expect(createPocketTokenizer(config)("salut été")).toEqual([3, 5]);
  });

  it("preserves an unknown Unicode character through UTF-8 byte tokens", () => {
    const tokenIds = [...new TextEncoder().encode("🧪")].map(byte => byteOffset + byte);
    expect(createPocketTokenizer(config)("salut 🧪")).toEqual([3, 1, ...tokenIds]);
  });

  it("rejects a tokenizer that cannot represent all UTF-8 bytes", () => {
    expect(() => createPocketTokenizer({ ...config, model: { ...config.model, vocab: config.model.vocab.slice(0, -1) } }))
      .toThrow("Incomplete Pocket TTS tokenizer");
  });
});
