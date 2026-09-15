// SPDX-License-Identifier: GPL-3.0-or-later
// This separate speech worker uses Piper phonemization / eSpeak NG. Its source,
// corresponding upstream sources and build instructions are served in ./licenses/.
import * as ort from "./vendor/ort.wasm.min.mjs";
import { createPiperPhonemize } from "./vendor/phonemizer.mjs";
import { mapPiperPhonemeIds, readPiperPhonemeOutput } from "./piper-phoneme-map.js";
import { PIPER_VOICES } from "./piper-voices.js";

const ROOT = new URL("./", import.meta.url);
const CACHE_NAME = "fastreader-voice-v2";
const SPEAKERS = new Map(PIPER_VOICES.map(voice => [voice.id, voice]));

function fail(message, code = "VOICE_FAILED") {
  return Object.assign(new Error(message), { code });
}

// Installing a voice is the only operation allowed to download assets. Inference
// reads the dedicated cache, including the phonemizer's preloaded data package.
self.fetch = async (input) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, ROOT);
  if (!url.href.startsWith(ROOT.href)) throw fail("External speech request blocked", "VOICE_NOT_INSTALLED");
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(url.href, { ignoreVary: true })) || new Response("Voice asset not installed", { status: 404 });
};
// Emscripten has XHR fallbacks. All binaries/data are supplied explicitly below,
// so an unexpected fallback must fail rather than send text or fetch remotely.
self.XMLHttpRequest = class {
  constructor() { throw fail("Speech network fallback blocked", "VOICE_NOT_INSTALLED"); }
};

ort.env.wasm.wasmPaths = new URL("vendor/", ROOT).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
let configured = false;
let session;
let config;
let activeVoice;
let phonemizer;
let activeRequestId;
let printed = [];
let stderr = [];

function progress(value) {
  self.postMessage({ id: activeRequestId, type: "progress", progress: value });
}

function configureThreads(requested) {
  if (configured) return;
  configured = true;
  ort.env.wasm.numThreads = self.crossOriginIsolated === true && typeof SharedArrayBuffer === "function"
    ? Math.max(1, Math.min(4, Math.floor(Number(requested) || 1), navigator.hardwareConcurrency || 1)) : 1;
}

async function cachedResponse(file) {
  const response = await fetch(new URL(file, ROOT));
  if (!response.ok) throw fail("Voice not installed", "VOICE_NOT_INSTALLED");
  return response;
}

async function loadPhonemizer() {
  if (phonemizer) return;
  progress({ stage: "loading", status: "loading", component: "phonemizer" });
  const [data, wasmBinary] = await Promise.all([
    cachedResponse("vendor/piper_phonemize.data").then(response => response.arrayBuffer()),
    cachedResponse("vendor/piper_phonemize.wasm").then(response => response.arrayBuffer()),
  ]);
  phonemizer = await createPiperPhonemize({
    noInitialRun: true, noExitRuntime: true, wasmBinary,
    print: line => printed.push(line),
    printErr: line => stderr.push(line),
    locateFile: name => new URL(`vendor/${name}`, ROOT).href,
    getPreloadedPackage: (_name, size) => {
      if (data.byteLength !== size) throw fail("Invalid phonemizer data", "VOICE_NOT_INSTALLED");
      return data;
    },
  });
  // Emscripten has copied its data into the virtual filesystem; don't retain
  // another 18 MB through callbacks on the initialized Module object.
  delete phonemizer.getPreloadedPackage;
  delete phonemizer.wasmBinary;
}

function validateConfig(value, voice) {
  if (value?.phoneme_type !== "espeak" || value?.espeak?.voice !== voice.espeakVoice ||
      value?.audio?.sample_rate !== voice.sampleRate || value?.num_speakers !== 1 ||
      !value?.phoneme_id_map || !["noise_scale", "noise_w", "length_scale"].every(key =>
        Number.isFinite(value?.inference?.[key]) && value.inference[key] > 0)) {
    throw fail("Invalid voice configuration", "VOICE_NOT_INSTALLED");
  }
  return value;
}

async function load(voice) {
  const descriptor = SPEAKERS.get(voice?.id);
  if (!descriptor) throw fail("Unsupported voice", "VOICE_UNSUPPORTED");
  if (activeVoice === descriptor.id && session && phonemizer) return;
  progress({ stage: "loading", status: "loading", component: "model" });
  // Release the previous model before loading another language on small devices.
  activeVoice = undefined;
  config = undefined;
  if (session) {
    const previous = session;
    session = undefined;
    await previous.release();
  }
  const nextConfig = validateConfig(await (await cachedResponse(`models/${descriptor.modelKey}/config.json`)).json(), descriptor);
  await loadPhonemizer();
  const modelBytes = await (await cachedResponse(`models/${descriptor.modelKey}/model.onnx`)).arrayBuffer();
  if (modelBytes.byteLength !== descriptor.model.bytes) throw fail("Invalid voice model", "VOICE_NOT_INSTALLED");
  const nextSession = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ["wasm"], graphOptimizationLevel: "all",
  });
  if (!nextSession.inputNames.includes("input") || !nextSession.inputNames.includes("input_lengths") ||
      !nextSession.inputNames.includes("scales") || !nextSession.outputNames.includes("output")) {
    await nextSession.release();
    throw fail("Unsupported Piper model", "VOICE_NOT_INSTALLED");
  }
  session = nextSession;
  config = nextConfig;
  activeVoice = descriptor.id;
  progress({ stage: "ready", status: "ready", component: "voice", wasmThreads: ort.env.wasm.numThreads });
}

function toWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const string = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  string(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true);
  string(8, "WAVE"); string(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
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
  printed = []; stderr = [];
  try {
    phonemizer.callMain(["-l", config.espeak.voice, "--input", JSON.stringify([{ text: text.normalize("NFC").trim() }]),
      "--espeak_data", "/espeak-ng-data"]);
  } catch {
    // A thrown WASM exception is not evidence of bad text. In particular an
    // exhausted heap must never be hidden by skipping the rest of a book.
    throw fail("Speech phonemization failed");
  }
  const sourceIds = readPiperPhonemeOutput(printed, stderr);
  // Use native IDs, not a flattened IPA string: BOS/EOS and punctuation must
  // survive across every complete sentence. Long passages are split by the
  // parent engine and their PCM is reassembled before playback.
  const ids = mapPiperPhonemeIds(sourceIds, config.phoneme_id_map, 1024, config.phoneme_map || {});
  const boundedSpeed = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  const feeds = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([ids.length], BigInt), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([
      config.inference.noise_scale, config.inference.length_scale / boundedSpeed, config.inference.noise_w,
    ]), [3]),
  };
  let output;
  progress({ stage: "synthesizing", status: "synthesizing", tokens: ids.length });
  try {
    output = await session.run(feeds);
    const samples = output.output?.data;
    if (!samples?.length) throw fail("Empty generated audio");
    const sampleRate = config.audio.sample_rate;
    return { wav: toWav(samples, sampleRate), duration: samples.length / sampleRate };
  } finally {
    Object.values(feeds).forEach(tensor => tensor.dispose?.());
    if (output) Object.values(output).forEach(tensor => tensor.dispose?.());
  }
}

// One model session at a time, including voice changes during pre-buffering.
// The parent terminates this worker to cancel pending work and release WASM.
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
