import { describe, expect, it } from "vitest";
import { assetsForVoice, normalizeBookLanguage, supportedVoiceLanguages, voiceForId, legacyVoiceForId, isLegacyVoiceId, VOICES, voiceEngineIdentity } from "../src/voice-assets.js";
import { PIPER_REVISION, PIPER_VOICES } from "../src/piper-voices.js";
import { POCKET_VOICE } from "../src/pocket-voices.js";

const frenchId = "piper-fr_FR-siwis-medium";
describe("local voice catalogue", () => {
  it("offers six pinned Medium voices, including German and Brazilian Portuguese", () => {
    expect(supportedVoiceLanguages).toEqual(["fr", "en", "es", "it", "de", "pt"]);
    expect(new Set(VOICES.map(voice => voice.id)).size).toBe(7);
    expect(voiceForId("piper-de_DE-thorsten-medium").language).toBe("de");
    expect(voiceForId("piper-pt_BR-faber-medium").locale).toBe("pt-BR");
    expect(assetsForVoice("unknown")).toEqual([]);
    for (const voice of PIPER_VOICES) {
      expect(voice.id).toMatch(/^piper-.+-medium$/);
      expect(voice.model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(voice.config.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(voice.sampleRate).toBe(22050);
    }
  });
  it("retains legacy names for saved audio without authorizing new synthesis", () => {
    for (const id of ["ff_siwis", "af_heart", "ef_dora", "if_sara", "pf_dora"]) {
      expect(isLegacyVoiceId(id)).toBe(true);
      expect(legacyVoiceForId(id)).toMatchObject({ id, legacy: true });
      expect(voiceForId(id)).toBeUndefined();
      expect(assetsForVoice(id)).toEqual([]);
    }
    expect(isLegacyVoiceId(frenchId)).toBe(false);
    expect(isLegacyVoiceId(["ff_siwis"])).toBe(false);
  });
  it.each([
    ["fr-FR", "fr"], ["FR_ca", "fr"], ["fre", "fr"], ["fra", "fr"],
    ["eng", "en"], ["pt-BR", "pt"], ["ita", "it"], ["spa", "es"],
    ["deu", "de"], ["ger", "de"], ["ja-JP", "ja"], ["", ""], [undefined, ""], ["und", ""],
  ])("normalizes EPUB language %s to %s without substituting the interface language", (input, output) => {
    expect(normalizeBookLanguage(input)).toBe(output);
  });
  it("maps verified external model files to local URLs under a GitHub Pages project path", () => {
    const assets = assetsForVoice(frenchId, "https://example.org/EPUB-FastReader/");
    expect(assets.length).toBeGreaterThan(5);
    expect(new Set(assets.map(({ url }) => url)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.url).toMatch(/^https:\/\/example.org\/EPUB-FastReader\/voice-runtime\/v2\//);
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      if (asset.file.startsWith("models/")) {
        expect(asset.source).toContain(`/resolve/${PIPER_REVISION}/`);
        expect(asset.voiceId).toBe(frenchId);
      } else expect(asset.source).toBe(asset.url);
    }
    const own = assets.filter(asset => asset.voiceId);
    expect(own.map(asset => asset.file.split("/").at(-1))).toEqual(["config.json", "model.onnx"]);
    expect(own[1].bytes).toBeGreaterThan(60_000_000);
  });
  it("shares runtime files but gives each language its own model and config", () => {
    const french = assetsForVoice(frenchId, "https://example.org/");
    const frenchUrls = new Set(french.map(({ url }) => url));
    for (const voice of PIPER_VOICES.filter(voice => voice.id !== frenchId)) {
      const added = assetsForVoice(voice.id, "https://example.org/").filter(({ url }) => !frenchUrls.has(url));
      expect(added.map(asset => asset.file)).toEqual([voice.configPath, voice.modelPath]);
    }
  });
  it("gives Estelle a pinned French pack and shares only the ONNX runtime with Piper", () => {
    expect(voiceForId(POCKET_VOICE.id)).toMatchObject({ language: "fr", name: "Estelle", engine: "pocket", sampleRate: 24_000 });
    expect(VOICES.filter(voice => voice.language === "fr").map(voice => voice.id)).toEqual([frenchId, POCKET_VOICE.id]);
    const baseUrl = "https://example.org/EPUB-FastReader/";
    const piper = assetsForVoice(frenchId, baseUrl);
    const pocket = assetsForVoice(POCKET_VOICE.id, baseUrl);
    const shared = pocket.filter(asset => piper.some(other => other.url === asset.url));
    expect(shared.map(asset => asset.file)).toEqual(piper.filter(asset => asset.file.startsWith("vendor/ort")).map(asset => asset.file));
    expect(pocket.map(asset => asset.file)).toContain("pocket-worker.js");
    expect(piper.map(asset => asset.file)).not.toContain("pocket-worker.js");
    const model = pocket.filter(asset => asset.voiceId === POCKET_VOICE.id);
    expect(model).toHaveLength(7);
    expect(model.reduce((total, asset) => total + asset.bytes, 0)).toBe(120_948_003);
    for (const asset of model) {
      expect(asset.url).toContain("/EPUB-FastReader/voice-runtime/v2/models/");
      expect(asset.source).toContain(`/resolve/${POCKET_VOICE.upstreamRevision}/`);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(voiceEngineIdentity(POCKET_VOICE)).not.toEqual(voiceEngineIdentity({ ...POCKET_VOICE, upstreamRevision: "different" }));
  });
});
