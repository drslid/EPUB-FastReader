// Vincweb's INT8 export of Kyutai's French six-layer Pocket TTS model.
// See docs/THIRD-PARTY-VOICE.md for attribution and the Estelle preset source.
const revision = "84541283b060685dbc7f9f9d8066f4b00235820c";
const origin = `https://huggingface.co/Vincweb/pocket-tts-french-onnx/resolve/${revision}/`;
const modelKey = "fr_FR-estelle-int8";

const asset = (file, bytes, sha256) => Object.freeze({
  file,
  bytes,
  sha256,
  url: new URL(file, origin).href,
});

const config = asset("manifest.json", 5_318, "feeefe94c2accd81f4f4d87901dc0fe2d318bab5c073ff4fd38bed1b6aa584d8");
const model = asset("flow_lm_main_int8.onnx", 76_063_417, "fbdafb5f3f004565114aca628ebf96c4c5c6e861d953f293351c2c585fbc211f");

export const POCKET_VOICE = Object.freeze({
  id: "pocket-fr_FR-estelle-int8",
  engine: "pocket",
  language: "fr",
  locale: "fr-FR",
  name: "Estelle",
  modelKey,
  sampleRate: 24_000,
  upstreamRevision: revision,
  modelPath: `models/${modelKey}/${model.file}`,
  configPath: `models/${modelKey}/${config.file}`,
  model,
  config,
  assets: Object.freeze([
    config,
    model,
    asset("flow_lm_flow_int8.onnx", 9_966_003, "edee960ed0d3783bc31c9d3ae182884562193d78bbc3ab28fefa23bd2949e0e4"),
    asset("mimi_decoder_int8.onnx", 22_688_110, "b7fd081d6ee991521553a32ffc19981bc40a68042c3219cd1b6845c983c84e21"),
    asset("text_embeddings.f16", 8_194_048, "00cbfe5ea0e0a93689e07917750cc99193af02800e35190333dbbcef50a6d2af"),
    asset("tokenizer.json", 246_403, "6211acffe9cb95172f71f0051f18e26ea305b2b32ea00b331ee976551c70887f"),
    asset("voices/estelle.f16", 3_784_704, "24b8fed0f9b0b959960c05008b77c1df7d436bd269121dc235b1cc8bd48b26f1"),
  ]),
});
