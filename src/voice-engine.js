import { concatenateVoiceWavs } from "./voice-audio.js";
import { splitVoicePassage } from "./voice-text.js";
export { createAcceleratedVoiceEngine } from "./voice-compute.js";

/** A lazy, disposable bridge to the optional local speech worker. */
export function createVoiceEngine({
  baseUrl = "./",
  onProgress = () => {},
  wasmThreads = 1,
  workerFactory = (url) => new Worker(url, { type: "module", name: "fastreader-voice" }),
} = {}) {
  const rootUrl = new URL(baseUrl, globalThis.document?.baseURI || globalThis.location?.href || "http://localhost/");
  let worker;
  let nextId = 0;
  let disposed = false;
  let generation = { error: null };
  const pending = new Map();
  const report = (progress, callback) => {
    onProgress(progress);
    if (callback && callback !== onProgress) callback(progress);
  };

  function stop(error) {
    // Keep the reason on the interrupted generation so an awaiting sentence
    // cannot mistake a Worker failure for a user cancellation.
    generation.error = error;
    generation = { error: null };
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = workerFactory(new URL("voice-runtime/v1/worker.js", rootUrl));
    const currentWorker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== currentWorker) return;
      if (data.type === "progress") {
        const callback = pending.get(data.id)?.onProgress;
        if (callback) callback(data.progress);
        else onProgress(data.progress);
        return;
      }
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      request.cleanup();
      if (data.error) {
        const error = new Error(data.error.message || "Local speech failed");
        error.code = data.error.code || "VOICE_FAILED";
        request.reject(error);
      } else request.resolve(data.result);
    };
    worker.onerror = (event) => {
      if (worker !== currentWorker) return;
      stop(Object.assign(new Error(event?.message || "Local speech worker failed"), { code: "VOICE_FAILED" }));
    };
    worker.onmessageerror = worker.onerror;
    return worker;
  }

  function request(type, data, signal, progress) {
    if (disposed) return Promise.reject(new Error("Voice engine is disposed"));
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      // Inference cannot be interrupted safely inside WASM: terminating the
      // worker releases its model and guarantees stale audio cannot arrive.
      const abort = () => stop(new DOMException("Aborted", "AbortError"));
      const cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      pending.set(id, { resolve, reject, cleanup, onProgress: progress });
      try { ensureWorker().postMessage({ id, type, ...data, ...(wasmThreads > 1 ? { wasmThreads } : {}) }); }
      catch (error) { stop(error); }
    });
  }

  return {
    concurrency: 1,
    load(voice, { signal, onProgress: progress } = {}) {
      report({ stage: "loading", status: "loading" }, progress);
      return request("load", { voice }, signal, value => report(value, progress));
    },
    async synthesize(text, { voice, speed = 1, signal, onProgress: progress } = {}) {
      const currentGeneration = generation;
      const abortOperation = () => stop(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", abortOperation, { once: true });
      const checkActive = () => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (generation !== currentGeneration) throw currentGeneration.error;
      };
      const parts = [];
      const emit = value => report({ ...value, completedFragments: parts.length, audioDuration: parts.reduce((sum, part) => sum + part.duration, 0) }, progress);
      const synthesizePassage = async (passage, depth = 0) => {
        checkActive();
        try {
          const result = await request("synthesize", { text: passage.text, voice, speed }, signal, emit);
          checkActive();
          parts.push(result);
          emit({ stage: "synthesizing", status: "synthesizing" });
        } catch (error) {
          checkActive();
          if (error.code !== "VOICE_TEXT_TOO_LONG") throw error;
          const fragments = depth < 8 ? splitVoicePassage(passage) : [];
          if (!fragments || fragments.length < 2 || fragments.some(part => !part.text || part.text.length >= passage.text.length)) {
            throw Object.assign(new Error("This sentence cannot be prepared without cutting its text"), { code: "VOICE_TEXT_UNSPLITTABLE" });
          }
          // Complete all fragments on the same worker before exposing audio to
          // playback: reaching the model limit cannot interrupt a sentence.
          for (const fragment of fragments) await synthesizePassage(fragment, depth + 1);
        }
      };
      try {
        emit({ stage: "loading", status: "loading" });
        await synthesizePassage({ start: 0, end: typeof text === "string" ? text.length : 0, text });
        checkActive();
        const result = parts.length === 1 ? parts[0] : concatenateVoiceWavs(parts.map(part => part.wav));
        emit({ stage: "ready", status: "ready", totalFragments: parts.length });
        return { blob: new Blob([result.wav], { type: "audio/wav" }), duration: result.duration };
      } finally {
        signal?.removeEventListener("abort", abortOperation);
      }
    },
    dispose() {
      disposed = true;
      stop(new DOMException("Aborted", "AbortError"));
    },
  };
}
