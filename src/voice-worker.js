// SPDX-License-Identifier: GPL-3.0-or-later
// This separate speech worker uses ephone/eSpeak NG. Its full source is served
// unchanged here; corresponding ephone sources and licences are in ./licenses/.
import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor } from "./vendor/transformers.min.js";
import createEphone, { roa, en_us } from "./vendor/ephone.js";

const ROOT = new URL("./", import.meta.url);
const CACHE_NAME = "fastreader-voice-v1";
const SAMPLE_RATE = 24_000;
const SPEAKERS = Object.freeze({
  ff_siwis: { language: "fr", phonemeLanguage: "fr", pack: "roa" },
  af_heart: { language: "en", phonemeLanguage: "en-US", pack: "en_us" },
  ef_dora: { language: "es", phonemeLanguage: "es", pack: "roa" },
  if_sara: { language: "it", phonemeLanguage: "it", pack: "roa" },
  pf_dora: { language: "pt", phonemeLanguage: "pt-BR", pack: "roa" },
});

function fail(message, code = "VOICE_FAILED") {
  return Object.assign(new Error(message), { code });
}

// Speech never fetches a book, model or voice from the network. The dedicated
// downloader must have installed every asset before this worker is started.
self.fetch = async (input) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, ROOT);
  if (!url.href.startsWith(ROOT.href)) throw fail("External speech request blocked", "VOICE_NOT_INSTALLED");
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(url.href, { ignoreVary: true })) || new Response("Voice asset not installed", { status: 404 });
};

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL("models/", ROOT).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL("vendor/", ROOT).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let model;
let tokenizer;
let activeVoice;
let speaker;
let phonemizer;
let activePack;
let activeRequestId;
let configured = false;

function progress(value) {
  self.postMessage({ id: activeRequestId, type: "progress", progress: value });
}

function configureThreads(requested) {
  if (configured) return;
  configured = true;
  // Shared WASM memory requires isolation in the actual Worker, regardless of
  // what the parent document requested. No extra model is loaded for threads.
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated === true && typeof SharedArrayBuffer === "function"
    ? Math.max(1, Math.min(4, Math.floor(Number(requested) || 1), navigator.hardwareConcurrency || 1)) : 1;
}

async function load(voice) {
  const descriptor = SPEAKERS[voice?.id];
  if (!descriptor) throw fail("Unsupported voice", "VOICE_UNSUPPORTED");
  if (activeVoice === voice.id && model && tokenizer && phonemizer) return;
  progress({ stage: "loading", status: "loading", component: "model" });
  if (!model) {
    [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained("kokoro", { dtype: "q8", device: "wasm", progress_callback: value => {
        progress({ stage: "loading", status: "loading", component: "model", file: value.file,
          ...(Number.isFinite(value.loaded) ? { loaded: value.loaded } : {}),
          ...(Number.isFinite(value.total) ? { total: value.total } : {}) });
      } }),
      AutoTokenizer.from_pretrained("kokoro"),
    ]);
  }
  if (activePack !== descriptor.pack) {
    progress({ stage: "loading", status: "loading", component: "phonemizer" });
    phonemizer = await createEphone(descriptor.pack === "roa" ? roa : en_us);
    activePack = descriptor.pack;
  }
  const response = await fetch(new URL(`models/kokoro/voices/${voice.id}.bin`, ROOT));
  if (!response.ok) throw fail("Voice not installed", "VOICE_NOT_INSTALLED");
  const data = await response.arrayBuffer();
  if (data.byteLength !== 522_240) throw fail("Invalid voice data", "VOICE_NOT_INSTALLED");
  speaker = new Float32Array(data);
  phonemizer.setVoice(descriptor.phonemeLanguage);
  activeVoice = voice.id;
  progress({ stage: "ready", status: "ready", component: "voice", wasmThreads: env.backends.onnx.wasm.numThreads });
}

function toWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const string = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  string(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true);
  string(8, "WAVE"); string(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  string(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) throw fail("Invalid generated audio");
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return buffer;
}

async function synthesize(text, voice, speed = 1) {
  if (typeof text !== "string" || !text.trim()) throw fail("Empty passage", "VOICE_EMPTY_TEXT");
  if (text.length > 8_000) throw fail("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
  await load(voice);
  progress({ stage: "phonemizing", status: "phonemizing" });
  // eSpeak may mark foreign words with language switches. Preserve French
  // nasal vowels, stress and punctuation; do not apply English substitutions.
  const phonemes = phonemizer.textToIpa(text.normalize("NFC"))
    .replace(/\([a-z]{2,3}(?:-[a-z0-9]+)*\)/gi, "")
    .replace(/[-^]/g, "").trim();
  const { input_ids } = tokenizer(phonemes, { truncation: false });
  const count = input_ids.dims.at(-1);
  if (count > 512) throw fail("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
  if (count <= 2) throw fail("No pronounceable text", "VOICE_EMPTY_TEXT");
  const offset = Math.min(count - 2, 509) * 256;
  progress({ stage: "synthesizing", status: "synthesizing", tokens: count });
  const { waveform } = await model({
    input_ids,
    style: new Tensor("float32", speaker.slice(offset, offset + 256), [1, 256]),
    speed: new Tensor("float32", [Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1], [1]),
  });
  try {
    if (!waveform.data.length) throw fail("Empty generated audio");
    return { wav: toWav(waveform.data), duration: waveform.data.length / SAMPLE_RATE };
  } finally {
    waveform.dispose?.();
  }
}

// One model session at a time, including voice changes during pre-buffering.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      activeRequestId = data.id;
      configureThreads(data.wasmThreads);
      if (data.type === "load") {
        await load(data.voice);
        self.postMessage({ id: data.id, result: { ready: true } });
      } else if (data.type === "synthesize") {
        const result = await synthesize(data.text, data.voice, data.speed);
        self.postMessage({ id: data.id, result }, [result.wav]);
      } else throw fail("Unsupported worker message");
    } catch (error) {
      self.postMessage({ id: data.id, error: { message: error.message, code: error.code || "VOICE_FAILED" } });
    }
  });
};
