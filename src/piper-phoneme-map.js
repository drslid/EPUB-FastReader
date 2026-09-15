// SPDX-License-Identifier: GPL-3.0-or-later
// Default IDs from wide-video/piper-phonemize, revision
// cfff8e52ebaea37c7e953ae2d06b174acb827ac4/src/phoneme_ids.hpp (MIT).
// Its corresponding source and licence accompany the standalone speech worker.
export const DEFAULT_SYMBOLS = ["_", "^", "$", " ", "!", "'", "(", ")", ",", "-", ".", ":", ";", "?", "a", "b", "c", "d", "e", "f", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "æ", "ç", "ð", "ø", "ħ", "ŋ", "œ", "ǀ", "ǁ", "ǂ", "ǃ", "ɐ", "ɑ", "ɒ", "ɓ", "ɔ", "ɕ", "ɖ", "ɗ", "ɘ", "ə", "ɚ", "ɛ", "ɜ", "ɞ", "ɟ", "ɠ", "ɡ", "ɢ", "ɣ", "ɤ", "ɥ", "ɦ", "ɧ", "ɨ", "ɪ", "ɫ", "ɬ", "ɭ", "ɮ", "ɯ", "ɰ", "ɱ", "ɲ", "ɳ", "ɴ", "ɵ", "ɶ", "ɸ", "ɹ", "ɺ", "ɻ", "ɽ", "ɾ", "ʀ", "ʁ", "ʂ", "ʃ", "ʄ", "ʈ", "ʉ", "ʊ", "ʋ", "ʌ", "ʍ", "ʎ", "ʏ", "ʐ", "ʑ", "ʒ", "ʔ", "ʕ", "ʘ", "ʙ", "ʛ", "ʜ", "ʝ", "ʟ", "ʡ", "ʢ", "ʲ", "ˈ", "ˌ", "ː", "ˑ", "˞", "β", "θ", "χ", "ᵻ", "ⱱ", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "̧", "̃", "̪", "̯", "̩", "ʰ", "ˤ", "ε", "↓", "#", "\"", "↑", "̺", "̻", "g", "ʦ", "X", "̝", "̊"];

/** Preserve Piper's complete BOS/PAD/phonemes/EOS stream, including sentences. */
export function mapPiperPhonemeIds(sourceIds, map, maxIds = 1024, phonemeMap = {}) {
  const fail = (message, code = "VOICE_PHONEME_UNSUPPORTED") => {
    throw Object.assign(new Error(message), { code });
  };
  if (!Array.isArray(sourceIds) || !sourceIds.length) fail("No pronounceable text", "VOICE_EMPTY_TEXT");
  for (const boundary of ["_", "^", "$"]) {
    if (!Array.isArray(map?.[boundary]) || map[boundary].length !== 1) fail("Invalid Piper boundary map");
  }
  const ids = [];
  let starts = 0, ends = 0;
  const append = symbol => {
    const mapped = map[symbol];
    if (!Array.isArray(mapped) || !mapped.length || mapped.some(id => !Number.isInteger(id) || id < 0)) {
      fail("The selected voice does not support a phoneme in this passage");
    }
    ids.push(...mapped);
    if (ids.length > maxIds) fail("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
  };
  for (let index = 0; index < sourceIds.length; index++) {
    const sourceId = sourceIds[index];
    if (!Number.isInteger(sourceId) || sourceId < 0 || sourceId >= DEFAULT_SYMBOLS.length) fail("Unknown Piper phoneme ID");
    const symbol = DEFAULT_SYMBOLS[sourceId];
    // Never silently omit unsupported pronunciation marks (notably French nasal vowels).
    if (symbol === "^") starts++;
    if (symbol === "$") ends++;
    if (Object.hasOwn(phonemeMap, symbol)) {
      // Piper models can explicitly substitute a phoneme (Faber maps c → k).
      // Apply that before ID mapping, adding PAD after each replacement as Piper does.
      const replacement = phonemeMap[symbol];
      if (sourceId <= 2 || !Array.isArray(replacement) || sourceIds[index + 1] !== 0 ||
          replacement.some(value => typeof value !== "string" || ["_", "^", "$"].includes(value))) {
        fail("Invalid Piper phoneme substitution");
      }
      for (const value of replacement) { append(value); append("_"); }
      index++;
    } else append(symbol);
  }
  if (!starts || starts !== ends || sourceIds[0] !== 1 || sourceIds.at(-1) !== 2) fail("Invalid Piper sentence boundaries");
  if (ids.filter(id => id === map["^"][0]).length !== starts || ids.filter(id => id === map["$"][0]).length !== ends) {
    fail("Piper sentence boundary was lost");
  }
  if (sourceIds.every(id => id <= 3)) fail("No pronounceable text", "VOICE_EMPTY_TEXT");
  return ids;
}
