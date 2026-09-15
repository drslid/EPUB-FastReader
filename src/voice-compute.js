import { createVoiceEngine } from "./voice-engine.js";
import { isRecoverableVoiceTextError } from "./voice-text.js";

const aborted = () => new DOMException("Speech cancelled", "AbortError");

/** One portable session on phones/tablets avoids duplicating the model in RAM. */
export function voiceComputePolicy({ navigator = globalThis.navigator, crossOriginIsolated = globalThis.crossOriginIsolated } = {}) {
  const cores = Number(navigator?.hardwareConcurrency) || 1;
  const memory = Number(navigator?.deviceMemory) || 0;
  const mobile = navigator?.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator?.userAgent || "")
    || (navigator?.platform === "MacIntel" && navigator?.maxTouchPoints > 1);
  const capable = !mobile && cores >= 4 && memory >= 8;
  if (capable && crossOriginIsolated === true) {
    return { concurrency: 1, wasmThreads: cores >= 8 ? 4 : 2, mode: "multithread" };
  }
  return { concurrency: capable ? 2 : 1, wasmThreads: 1, mode: capable ? "parallel" : "portable" };
}

/** Reuse one or two local model sessions, with FIFO execution inside each. */
export function createAcceleratedVoiceEngine({
  navigator = globalThis.navigator,
  crossOriginIsolated = globalThis.crossOriginIsolated,
  createEngine = options => createVoiceEngine(options),
  onProgress = () => {},
  ...engineOptions
} = {}) {
  const policy = voiceComputePolicy({ navigator, crossOriginIsolated });
  const lifetime = new AbortController();
  const slots = Array.from({ length: policy.concurrency }, (_, index) => ({ index, tail: Promise.resolve(), sentences: 0, engine: null, voice: null }));
  let secondaryDisabled = false;

  const progress = (index, value, callback) => {
    const message = { ...value, workerIndex: index };
    onProgress(message);
    if (callback && callback !== onProgress) callback(message);
  };
  function getEngine(slot) {
    return slot.engine ||= createEngine({ ...engineOptions, wasmThreads: policy.wasmThreads,
      onProgress: value => progress(slot.index, value) });
  }
  function disableSecondary() {
    if (secondaryDisabled) return;
    secondaryDisabled = true;
    slots[1]?.engine?.dispose();
    progress(1, { stage: "fallback", status: "fallback", concurrency: 1 });
  }
  const canFallback = error => error?.name !== "AbortError"
    && !isRecoverableVoiceTextError(error) && error?.code !== "VOICE_UNSUPPORTED";

  function enqueue(slot, method, args, options = {}) {
    if (lifetime.signal.aborted || options.signal?.aborted) return Promise.reject(aborted());
    if (method === "synthesize") slot.sentences++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        options.signal?.removeEventListener("abort", cancel);
        lifetime.signal.removeEventListener("abort", cancel);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const cancel = () => finish(reject, aborted());
      options.signal?.addEventListener("abort", cancel, { once: true });
      lifetime.signal.addEventListener("abort", cancel, { once: true });
      const task = slot.tail.then(async () => {
        if (settled || lifetime.signal.aborted || options.signal?.aborted) throw aborted();
        if (slot.index === 1 && secondaryDisabled) return enqueue(slots[0], method, args, options);
        const callback = options.onProgress ? value => options.onProgress({ ...value, workerIndex: slot.index }) : undefined;
        try {
          const result = await getEngine(slot)[method](...args, { ...options, onProgress: callback });
          slot.voice = method === "load" ? args[0]?.id : options.voice?.id;
          return result;
        } catch (error) {
          if (slot.index !== 1 || lifetime.signal.aborted || options.signal?.aborted || !canFallback(error)) throw error;
          // The optional second session may exceed a browser's memory limit.
          // Retry the whole sentence on the first; never return partial audio.
          disableSecondary();
          return enqueue(slots[0], method, args, options);
        }
      });
      slot.tail = task.then(() => {}, () => {}).finally(() => {
        if (method === "synthesize") slot.sentences--;
      });
      void task.then(result => finish(resolve, result), error => finish(reject, error));
    });
  }

  return {
    get concurrency() { return secondaryDisabled ? 1 : policy.concurrency; },
    get compute() { return { ...policy, concurrency: secondaryDisabled ? 1 : policy.concurrency, mode: secondaryDisabled ? "portable" : policy.mode }; },
    async load(voice, options = {}) {
      progress(0, { stage: "loading", status: "loading" }, options.onProgress);
      // Reserve capacity without loading an unused second model. Its first
      // queued sentence initializes it while Worker 1 handles the beginning.
      return enqueue(slots[0], "load", [voice], options);
    },
    synthesize(text, options = {}) {
      const available = secondaryDisabled ? [slots[0]] : slots;
      // A background model load is not a queued sentence: reserve passage two
      // for that Worker even while its model is still becoming available.
      const slot = available.reduce((best, candidate) => candidate.sentences < best.sentences ? candidate : best);
      progress(slot.index, { stage: slot.voice === options.voice?.id ? "synthesizing" : "loading", status: slot.voice === options.voice?.id ? "synthesizing" : "loading" }, options.onProgress);
      return enqueue(slot, "synthesize", [text], options);
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      for (const slot of slots) slot.engine?.dispose();
    },
  };
}
