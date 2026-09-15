import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { mapPiperPhonemeIds } from "../src/piper-phoneme-map.js";

const root = "https://reader.example/voice-runtime/v2/";
const voices = [
  { id: "french", modelKey: "fr", espeakVoice: "fr", sampleRate: 22050, model: { bytes: 8 } },
  { id: "english", modelKey: "en", espeakVoice: "en", sampleRate: 22050, model: { bytes: 8 } },
];
const workerSource = (await readFile("src/voice-worker.js", "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify(`${root}worker.js`));

function harness() {
  const files = new Map();
  const history = [];
  const requests = new Map();
  let id = 0;
  let creates = 0;
  for (const file of ["vendor/piper_phonemize.data", "vendor/piper_phonemize.wasm"]) {
    files.set(`${root}${file}`, { ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  }
  for (const voice of voices) {
    files.set(`${root}models/${voice.modelKey}/config.json`, { ok: true, json: async () => ({
      espeak: { voice: voice.espeakVoice }, audio: { sample_rate: 22050 }, num_speakers: 1, phoneme_type: "espeak",
      inference: { noise_scale: 0.667, noise_w: 0.8, length_scale: 1 },
      phoneme_id_map: { _: [0], "^": [1], $: [2], a: [14] },
    }) });
    files.set(`${root}models/${voice.modelKey}/model.onnx`, { ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  }
  const ort = {
    env: { wasm: {} },
    InferenceSession: { create: vi.fn(async () => {
      const serial = ++creates;
      history.push(`create:${serial}`);
      return { inputNames: ["input", "input_lengths", "scales"], outputNames: ["output"],
        release: async () => history.push(`release:${serial}`),
      };
    }) },
  };
  const phonemizer = vi.fn(async options => {
    expect(options.getPreloadedPackage("data", 4).byteLength).toBe(4);
    expect(options.wasmBinary.byteLength).toBe(4);
    return { ...options };
  });
  const context = {
    URL, Response, SharedArrayBuffer, navigator: { hardwareConcurrency: 8 }, crossOriginIsolated: false,
    ort, createPiperPhonemize: phonemizer, PIPER_VOICES: voices, mapPiperPhonemeIds,
    caches: { open: vi.fn(async name => {
      expect(name).toBe("fastreader-voice-v2");
      return { match: async url => files.get(url) };
    }) },
    postMessage: message => {
      if (message.type === "progress") return;
      requests.get(message.id)?.(message);
      requests.delete(message.id);
    },
  };
  context.self = context;
  vm.runInNewContext(workerSource, context);
  return { context, files, history, ort, phonemizer, async load(voice = voices[0]) {
    const requestId = ++id;
    const result = new Promise(resolve => requests.set(requestId, resolve));
    context.onmessage({ data: { id: requestId, type: "load", voice, wasmThreads: 4 } });
    return result;
  } };
}

describe("Piper worker model lifecycle and offline boundary", () => {
  it("loads only cached binaries and reuses the active model", async () => {
    const worker = harness();
    expect(await worker.load()).toMatchObject({ result: { ready: true } });
    expect(await worker.load()).toMatchObject({ result: { ready: true } });
    expect(worker.ort.InferenceSession.create).toHaveBeenCalledTimes(1);
    expect(worker.phonemizer).toHaveBeenCalledTimes(1);
    expect(worker.ort.env.wasm.numThreads).toBe(1);
    await expect(worker.context.fetch("https://outside.example/book-text")).rejects.toMatchObject({ code: "VOICE_NOT_INSTALLED" });
    expect(() => new worker.context.XMLHttpRequest()).toThrow("Speech network fallback blocked");
  });

  it("releases the previous session before changing language", async () => {
    const worker = harness();
    await worker.load();
    await worker.load(voices[1]);
    expect(worker.history).toEqual(["create:1", "release:1", "create:2"]);
    expect(worker.phonemizer).toHaveBeenCalledTimes(1);
  });

  it("can retry a missing model after a failed language change without keeping a stale session", async () => {
    const worker = harness();
    await worker.load();
    const modelUrl = `${root}models/en/model.onnx`;
    const model = worker.files.get(modelUrl);
    worker.files.delete(modelUrl);
    expect(await worker.load(voices[1])).toMatchObject({ error: { code: "VOICE_NOT_INSTALLED" } });
    expect(worker.history).toEqual(["create:1", "release:1"]);
    worker.files.set(modelUrl, model);
    expect(await worker.load(voices[1])).toMatchObject({ result: { ready: true } });
    expect(worker.history).toEqual(["create:1", "release:1", "create:2"]);
  });

  it("rejects an unknown voice before touching any model", async () => {
    const worker = harness();
    expect(await worker.load({ id: "old-kokoro" })).toMatchObject({ error: { code: "VOICE_UNSUPPORTED" } });
    expect(worker.ort.InferenceSession.create).not.toHaveBeenCalled();
  });
});
