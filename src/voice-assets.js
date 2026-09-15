import { RUNTIME_ASSETS } from "./voice-runtime-manifest.js";
import { PIPER_VOICES } from "./piper-voices.js";

export const VOICE_CACHE_NAME = "fastreader-voice-v2";
export const VOICE_RUNTIME_PATH = "voice-runtime/v2/";
export const LEGACY_VOICE_CACHE_NAME = "fastreader-voice-v1";
export const LEGACY_VOICE_RUNTIME_PATH = "voice-runtime/v1/";

// Each selected voice has its own model. Only the runtime and pronunciation
// data are shared across the six languages.
export const VOICES = PIPER_VOICES;
export const supportedVoiceLanguages = Object.freeze(VOICES.map(({ language }) => language));
export const voiceForId = id => VOICES.find(voice => voice.id === id);

// These names support saved settings/audio, never new synthesis with a
// different engine. Old audio remains readable in its separate database.
const LEGACY_VOICES = Object.freeze([
  { id: "ff_siwis", language: "fr", name: "Siwis" },
  { id: "af_heart", language: "en", name: "Heart" },
  { id: "ef_dora", language: "es", name: "Dora" },
  { id: "if_sara", language: "it", name: "Sara" },
  { id: "pf_dora", language: "pt", name: "Dora" },
].map(voice => Object.freeze({ ...voice, legacy: true })));
export const legacyVoiceForId = id => LEGACY_VOICES.find(voice => voice.id === id);
export const isLegacyVoiceId = id => Boolean(legacyVoiceForId(id));

const LANGUAGE_ALIASES = Object.freeze({ fra: "fr", fre: "fr", eng: "en", spa: "es", ita: "it", por: "pt", deu: "de", ger: "de" });
export function normalizeBookLanguage(language) {
  const code = String(language || "").trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return LANGUAGE_ALIASES[code] || (/^[a-z]{2}$/.test(code) ? code : "");
}

export function voiceBaseUrl(baseUrl) {
  const documentUrl = globalThis.document?.baseURI || globalThis.location?.href || "http://localhost/";
  return new URL(baseUrl || import.meta.env?.BASE_URL || "./", documentUrl);
}

/** Every installed entry is local; only the downloader contacts model providers. */
export function assetsForVoice(voiceId, baseUrl) {
  const voice = voiceForId(voiceId);
  if (!voice) return [];
  const root = new URL(VOICE_RUNTIME_PATH, voiceBaseUrl(baseUrl));
  return [
    ...RUNTIME_ASSETS.map(asset => ({ ...asset, url: new URL(asset.file, root).href, source: new URL(asset.file, root).href })),
    // Config first identifies an interrupted installation, so deleting another
    // voice preserves the runtime this resumable download still needs.
    ...[["config.json", voice.config], ["model.onnx", voice.model]].map(([name, asset]) => {
      const file = `models/${voice.modelKey}/${name}`;
      return { file, voiceId, bytes: asset.bytes, sha256: asset.sha256, url: new URL(file, root).href, source: asset.url };
    }),
  ];
}
