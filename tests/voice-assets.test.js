import { describe, expect, it } from "vitest";
import { assetsForVoice, KOKORO_REVISION, normalizeBookLanguage, supportedVoiceLanguages, voiceForId, VOICES } from "../src/voice-assets.js";

describe("local voice catalogue", () => {
  it("offers one pinned voice for each supported language, without pretending German exists", () => {
    expect(supportedVoiceLanguages).toEqual(["fr", "en", "es", "it", "pt"]);
    expect(VOICES.map((voice) => voice.id)).toEqual(["ff_siwis", "af_heart", "ef_dora", "if_sara", "pf_dora"]);
    expect(voiceForId("de_voice")).toBeUndefined();
    expect(assetsForVoice("unknown")).toEqual([]);
    for (const voice of VOICES) expect(voice.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["fr-FR", "fr"], ["FR_ca", "fr"], ["fre", "fr"], ["fra", "fr"],
    ["eng", "en"], ["pt-BR", "pt"], ["ita", "it"], ["spa", "es"],
    ["deu", "de"], ["ger", "de"], ["ja-JP", "ja"], ["", ""], [undefined, ""], ["und", ""],
  ])("normalizes EPUB language %s to %s without substituting the interface language", (input, output) => {
    expect(normalizeBookLanguage(input)).toBe(output);
  });

  it("maps external downloads to local cache URLs under a GitHub Pages project path", () => {
    const assets = assetsForVoice("ff_siwis", "https://example.org/EPUB-FastReader/");
    expect(assets.length).toBeGreaterThan(5);
    expect(new Set(assets.map(({ url }) => url)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.url).toMatch(/^https:\/\/example.org\/EPUB-FastReader\/voice-runtime\/v1\//);
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      if (asset.file.startsWith("models/")) expect(asset.source).toContain(`/resolve/${KOKORO_REVISION}/`);
      else expect(asset.source).toBe(asset.url);
    }
    expect(assets.find(({ file }) => file.endsWith("model_quantized.onnx")).bytes).toBe(92361116);
    expect(assets.find(({ file }) => file.endsWith("ff_siwis.bin")).bytes).toBe(522240);
  });

  it("shares the model and Romance pack while English only adds its own pack and voice", () => {
    const byId = (id) => assetsForVoice(id, "https://example.org/");
    const french = byId("ff_siwis"), spanish = byId("ef_dora"), english = byId("af_heart");
    const frenchUrls = new Set(french.map(({ url }) => url));
    expect(spanish.filter(({ url }) => !frenchUrls.has(url)).map(({ file }) => file)).toEqual(["models/kokoro/voices/ef_dora.bin"]);
    expect(english.filter(({ url }) => !frenchUrls.has(url)).map(({ file }) => file)).toEqual(["vendor/lang/en-us.js", "models/kokoro/voices/af_heart.bin"]);
    expect(english.some(({ file }) => file === "vendor/lang/roa.js")).toBe(false);
  });
});
