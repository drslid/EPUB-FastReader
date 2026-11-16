// Vincweb's INT8 export of Kyutai's French six-layer Pocket TTS model.
// See docs/THIRD-PARTY-VOICE.md for attribution and the Estelle preset source.
const revision = "84541283b060685dbc7f9f9d8066f4b00235820c";
const origin = `https://huggingface.co/Vincweb/pocket-tts-french-onnx/resolve/${revision}/`;
const modelKey = "fr_FR-estelle-int8";

const assetsAt = origin => (file, bytes, sha256) => Object.freeze({
  file, bytes, sha256, url: new URL(file, origin).href,
});
const asset = assetsAt(origin);

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

const englishRevision = "c7cd567b25ddd2b7c1646256e9eb3ab50a342a27";
const englishAsset = assetsAt(`https://huggingface.co/Vincweb/pocket-tts-english-onnx/resolve/${englishRevision}/`);
const englishKey = "en_GB-alba-int8";
const englishConfig = englishAsset("manifest.json", 5_096, "9cf498079e8f45a54792737eb09af89a9346a3db238c05d1b2ae1281a74b8e16");
const englishModel = englishAsset("flow_lm_main_int8.onnx", 76_063_417, "0c6f17cdd3ededd83ff9d989599a2dfde3f16f779f456e6ca9630186d28a3731");

const alba = Object.freeze({
  id: `pocket-${englishKey}`,
  engine: "pocket",
  language: "en",
  locale: "en-GB",
  name: "Alba",
  modelKey: englishKey,
  format: "pocket-vincweb-int8-v1",
  sampleRate: 24_000,
  upstreamRevision: englishRevision,
  modelPath: `models/${englishKey}/${englishModel.file}`,
  configPath: `models/${englishKey}/${englishConfig.file}`,
  model: englishModel,
  config: englishConfig,
  assets: Object.freeze([
    englishConfig,
    englishModel,
    englishAsset("flow_lm_flow_int8.onnx", 9_966_003, "146edf833ee6838b0da35f0ae5d330fd6c4321f97749ede0a036a8620cc87fc4"),
    englishAsset("mimi_decoder_int8.onnx", 22_688_110, "016a9644e17749a7bb74e293d4aa8333f08efd3a4225ab4db194fd5f9c4ba8c8"),
    englishAsset("text_embeddings.f16", 8_194_048, "1c2d5991bb3a7d029e025dfce0801c95bb25a5c9a8a2f4c7bbc1afa6c85c852d"),
    englishAsset("tokenizer.json", 245_020, "f498428e1eafee50492f7be13dc9bfafcfc12e508cd0eb1b01c92ecd5d8c6687"),
    englishAsset("voices/alba.f16", 3_096_576, "85d8fac411bcff6194acfe502f116da4c42e004b75e8ca923db5157e5feb6737"),
  ]),
});

const aliasRevision = "71a4d6d11a76e26b98709fa163477c77d16bdbdb";
const presetRevision = "4e1e0a3e611c51c0b4ed8174fc10f32a54644303";

function aliasVoice(language, locale, upstreamLanguage, name, preset, files, presetBytes, presetSha256) {
  const modelKey = `${locale.replace("-", "_")}-${preset}-int8`;
  const asset = assetsAt(`https://huggingface.co/Alias-Alias/pocket-3-3-0-tts-onnx/resolve/${aliasRevision}/${language}/`);
  const officialPreset = assetsAt(`https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/${presetRevision}/languages/${upstreamLanguage}/embeddings/`);
  const [config, model, ...otherAssets] = files.map(([file, bytes, sha256]) => asset(file, bytes, sha256));
  const presetFile = `${preset}.safetensors`;
  return Object.freeze({
    id: `pocket-${modelKey}`, engine: "pocket", language, locale, name, modelKey,
    format: "pocket-alias-int8-v1", sampleRate: 24_000,
    upstreamRevision: aliasRevision, presetRevision, presetFile,
    modelPath: `models/${modelKey}/${model.file}`,
    configPath: `models/${modelKey}/${config.file}`,
    model, config,
    assets: Object.freeze([config, model, ...otherAssets, officialPreset(presetFile, presetBytes, presetSha256)]),
  });
}

const lola = aliasVoice("es", "es-ES", "spanish", "Lola", "lola", [
  ["bundle.json", 13_654, "196151a61b907afb2b0ccb4570a4c39993de69d705b371d38ae459120f6aac23"],
  ["flow_lm_main_int8.onnx", 76_397_201, "f37c8b4a2409de010f638529daf947b863396a78b8b659a77ed6e35362174629"],
  ["flow_lm_flow_int8.onnx", 10_040_048, "b3f028c3cdd909ffa10dffa8055edc9147f273e43bda852733e6a4a36cc3d292"],
  ["mimi_decoder_int8.onnx", 22_638_621, "f2f1b6e380a6388557768534d24036cb8b549b9f4eb49bedbb7ed3c4fb06336a"],
  ["text_conditioner_int8.onnx", 16_388_338, "8e98c0abd4ba06fde1db0decb75e3b211e6097ba15854fc9266aa1d16feaeae4"],
  ["tokenizer.json", 246_610, "9ade09bbdc64ab2b59952b90773fa0890b780ece4fd5aef0d36a00c6ad5f0531"],
], 5_949_240, "9f7bef177c7a80bb1f8d0a0db0a77ad3d23f75ee2d627ea6ef70e2d843352e26");

const giovanni = aliasVoice("it", "it-IT", "italian", "Giovanni", "giovanni", [
  ["bundle.json", 13_624, "5dce446b175a8b9fd8766bde7ce3ee15fb396f2228b77777028c26eb88acfc4f"],
  ["flow_lm_main_int8.onnx", 76_397_201, "80c1ebae13a0033f7746f2b7a886e3d7fa3523c9d7be2122bec9412ad82c46b8"],
  ["flow_lm_flow_int8.onnx", 10_040_048, "b4da5f938b81d895eee0a8c6267162c6466382b761114affb96049db9e649431"],
  ["mimi_decoder_int8.onnx", 22_638_621, "c258c72d1b8079eb16a08fc9c6a255e918d897f53f784abcb5eaae2f3a0e9344"],
  ["text_conditioner_int8.onnx", 16_388_338, "f716f278fa279495889fbe8f4426da68d4ca5112b962121991ec8fed002ff090"],
  ["tokenizer.json", 246_586, "4bc1c0d4d54f9480183e94c94cfabf74fd89b0912537d4ef607d1982c4a381ec"],
], 4_622_128, "62ff1812374ad61b2ec6903083d5210515f2101bedd5b0f5d3129b44a4900f16");

const juergen = aliasVoice("de", "de-DE", "german", "Jürgen", "juergen", [
  ["bundle.json", 13_623, "7e43fa70568f3a1800a7dfeab6b3f97e2b5f1ff682c11db9cf22103d53f5fea5"],
  ["flow_lm_main_int8.onnx", 76_397_201, "96cb9a628438ca4b26d7ed3160d79bd8ad2e0f097d08a8faea95e00c944ea84e"],
  ["flow_lm_flow_int8.onnx", 10_040_048, "6198087a456287420d14b98083cd534bee3e92fa107dca1324f03a27c65c8315"],
  ["mimi_decoder_int8.onnx", 22_638_621, "3d0f9574384d73c91404514b933e239333d9580bc42c8fcc161e5402ff67d6b9"],
  ["text_conditioner_int8.onnx", 16_388_338, "0479f6bc635fedf130086c357d013a6a0c54568b301d9b255ffd67d732965378"],
  ["tokenizer.json", 245_966, "2d77849811e3d1b6ae80e5b11b203f57e1847901104d8a0573b34f46f8dddb53"],
], 6_244_152, "0846249f121a8fb9466519080544549409f27f52b64bd381d41ef2b2c0410a50");

const rafael = aliasVoice("pt", "pt-BR", "portuguese", "Rafael", "rafael", [
  ["bundle.json", 13_624, "4b23a635bd375e5d476416cc960ad7488aabd4441aea2861eaf54d98734ea34b"],
  ["flow_lm_main_int8.onnx", 76_397_201, "15357eb39cbd574bc4193fef960d6b332a861c84bfcf99e9417316bac129d1d8"],
  ["flow_lm_flow_int8.onnx", 10_040_048, "f2e2a3da0fb5c1e6b472f1921459f7e6c051fa54c25e08186b46d559d620b379"],
  ["mimi_decoder_int8.onnx", 22_638_621, "6974a4330bbbfe91fcc46084b26e769c8eefd6121bd3ad42e84861f9f05854b2"],
  ["text_conditioner_int8.onnx", 16_388_338, "22ee9182a3dadc37ba06cdf3ff9c0e0ac0622f006a2eb29d2f5e0a13ba642d3e"],
  ["tokenizer.json", 247_014, "b33e269f7f042a763080d71ba087d74d2f6759674b238a723c028e436b1a25ab"],
], 6_195_000, "47a1b9490c6c7b395260682d2cc8a3542e9544a9c3bd1058808e4af9d522bf7f");

export const POCKET_VOICES = Object.freeze([POCKET_VOICE, alba, lola, giovanni, juergen, rafael]);
export const pocketVoiceForId = id => POCKET_VOICES.find(voice => voice.id === id);
