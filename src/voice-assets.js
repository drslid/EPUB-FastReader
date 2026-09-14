import { RUNTIME_ASSETS } from "./voice-runtime-manifest.js";

export const VOICE_CACHE_NAME = "fastreader-voice-v1";
export const VOICE_RUNTIME_PATH = "voice-runtime/v1/";
export const KOKORO_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const MODEL_SOURCE = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${KOKORO_REVISION}/`;

// A deliberately small selection: one voice per supported book language.
// Language names are translated by the interface, never inferred from its locale.
export const VOICES = Object.freeze([
  { id: "ff_siwis", language: "fr", name: "Siwis", pack: "roa", phonemeLanguage: "fr-fr", sha256: "a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861" },
  { id: "af_heart", language: "en", name: "Heart", pack: "en_us", phonemeLanguage: "en-us", sha256: "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b" },
  { id: "ef_dora", language: "es", name: "Dora", pack: "roa", phonemeLanguage: "es", sha256: "f66ec66bd295acb18372e37008533a9a3228483ccd294e7538d5d9294ac9a532" },
  { id: "if_sara", language: "it", name: "Sara", pack: "roa", phonemeLanguage: "it", sha256: "409b69248798fcdc2542330c76953d230710f19b057e59cb82fdc3c4cf71265c" },
  { id: "pf_dora", language: "pt", name: "Dora", pack: "roa", phonemeLanguage: "pt-br", sha256: "3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee" },
].map(Object.freeze));

export const supportedVoiceLanguages = Object.freeze(VOICES.map(({ language }) => language));
export const voiceForId = (id) => VOICES.find((voice) => voice.id === id);

const LANGUAGE_ALIASES = Object.freeze({ fra: "fr", fre: "fr", eng: "en", spa: "es", ita: "it", por: "pt", deu: "de", ger: "de" });

export function normalizeBookLanguage(language) {
  const code = String(language || "").trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return LANGUAGE_ALIASES[code] || (/^[a-z]{2}$/.test(code) ? code : "");
}

const MODEL_ASSETS = [
  { file: "config.json", bytes: 44, sha256: "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f" },
  { file: "tokenizer.json", bytes: 3497, sha256: "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34" },
  { file: "tokenizer_config.json", bytes: 113, sha256: "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20" },
  { file: "onnx/model_quantized.onnx", bytes: 92361116, sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478" },
];

export function voiceBaseUrl(baseUrl) {
  const documentUrl = globalThis.document?.baseURI || globalThis.location?.href || "http://localhost/";
  return new URL(baseUrl || import.meta.env?.BASE_URL || "./", documentUrl);
}

/** Every cache key is local, even when its immutable download source is external. */
export function assetsForVoice(voiceId, baseUrl) {
  const voice = voiceForId(voiceId);
  if (!voice) return [];
  const root = new URL(VOICE_RUNTIME_PATH, voiceBaseUrl(baseUrl));
  const remoteAssets = [...MODEL_ASSETS, { file: `voices/${voice.id}.bin`, bytes: 522240, sha256: voice.sha256 }];
  return [
    ...RUNTIME_ASSETS.filter((asset) => !asset.pack || asset.pack === voice.pack).map((asset) => ({
      ...asset,
      url: new URL(asset.file, root).href,
      source: new URL(asset.file, root).href,
    })),
    ...remoteAssets.map((asset) => ({
      ...asset,
      file: `models/kokoro/${asset.file}`,
      url: new URL(`models/kokoro/${asset.file}`, root).href,
      source: new URL(asset.file, MODEL_SOURCE).href,
    })),
  ];
}
