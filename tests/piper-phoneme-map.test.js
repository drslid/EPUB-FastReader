import { describe, expect, it } from "vitest";
import { DEFAULT_SYMBOLS, mapPiperPhonemeIds } from "../src/piper-phoneme-map.js";

const source = symbol => DEFAULT_SYMBOLS.indexOf(symbol);
const map = { _: [0], "^": [1], $: [2], a: [11], b: [12], c: [13], k: [14], "̃": [15], ".": [16] };
const sentence = (...symbols) => [1, 0, ...symbols.flatMap(symbol => [source(symbol), 0]), 2];

function expectCode(callback, code) {
  let error;
  try { callback(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe(code);
}

describe("Piper native phoneme IDs", () => {
  it("retains both complete sentence boundaries and all padding", () => {
    const ids = [...sentence("a", "."), ...sentence("b", ".")];
    expect(mapPiperPhonemeIds(ids, map)).toEqual([1, 0, 11, 0, 16, 0, 2, 1, 0, 12, 0, 16, 0, 2]);
  });

  it("retains French nasalisation instead of dropping the combining phoneme", () => {
    expect(mapPiperPhonemeIds(sentence("a", "̃"), map)).toEqual([1, 0, 11, 0, 15, 0, 2]);
    const unsupported = { ...map };
    delete unsupported["̃"];
    expectCode(() => mapPiperPhonemeIds(sentence("a", "̃"), unsupported), "VOICE_PHONEME_UNSUPPORTED");
  });

  it("uses the Faber model's explicit c-to-k pronunciation substitution", () => {
    expect(mapPiperPhonemeIds(sentence("c"), map, 1024, { c: ["k"] })).toEqual([1, 0, 14, 0, 2]);
  });

  it("pads each part of a model-provided compound substitution", () => {
    expect(mapPiperPhonemeIds(sentence("c"), map, 1024, { c: ["k", "a"] })).toEqual([1, 0, 14, 0, 11, 0, 2]);
  });

  it("supports a model-provided deletion without leaving its PAD behind", () => {
    expect(mapPiperPhonemeIds(sentence("c", "a"), map, 1024, { c: [] })).toEqual([1, 0, 11, 0, 2]);
  });

  it("requests splitting before unbounded inference without truncating any phonemes", () => {
    expectCode(() => mapPiperPhonemeIds(sentence("a", "b"), map, 6), "VOICE_TEXT_TOO_LONG");
    expect(mapPiperPhonemeIds(sentence("a", "b"), map, 7)).toHaveLength(7);
  });

  it.each([-1, 999, 1.5])("rejects unsupported source ID %s", id => {
    expectCode(() => mapPiperPhonemeIds([1, 0, id, 0, 2], map), "VOICE_PHONEME_UNSUPPORTED");
  });

  it("rejects incomplete sentence boundaries", () => {
    expectCode(() => mapPiperPhonemeIds([1, 0, source("a"), 0], map), "VOICE_PHONEME_UNSUPPORTED");
    expectCode(() => mapPiperPhonemeIds([source("a"), 0, 2], map), "VOICE_PHONEME_UNSUPPORTED");
  });

  it("rejects invalid model substitutions rather than creating extra sentence boundaries", () => {
    expectCode(() => mapPiperPhonemeIds(sentence("c"), map, 1024, { c: ["$"] }), "VOICE_PHONEME_UNSUPPORTED");
    expectCode(() => mapPiperPhonemeIds(sentence("c"), map, 1024, { "^": ["a"] }), "VOICE_PHONEME_UNSUPPORTED");
  });

  it("rejects empty or whitespace-only phoneme streams", () => {
    expectCode(() => mapPiperPhonemeIds([], map), "VOICE_EMPTY_TEXT");
    expectCode(() => mapPiperPhonemeIds([1, 0, 2], map), "VOICE_EMPTY_TEXT");
  });
});
