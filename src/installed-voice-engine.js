const aborted = () => new DOMException("Speech cancelled", "AbortError");

/** Refresh installed runtime files before constructing a worker. This gate
 * never downloads a missing model and has no effect before load/synthesize. */
export function createInstalledVoiceEngine({ downloads, createEngine }) {
  const lifetime = new AbortController();
  const pending = new Map();
  let engine, verifiedVoice;

  function dispose() {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    engine?.dispose();
    verifiedVoice = undefined;
  }

  function check(signal) {
    if (lifetime.signal.aborted || signal?.aborted) throw aborted();
  }

  // A caller can stop waiting for a shared check even when another caller
  // started it. Its cancellation must not start a worker when that check ends.
  function wait(promise, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener("abort", cancel);
        lifetime.signal.removeEventListener("abort", cancel);
      };
      const cancel = () => { cleanup(); reject(aborted()); };
      signal?.addEventListener("abort", cancel, { once: true });
      lifetime.signal.addEventListener("abort", cancel, { once: true });
      promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  async function ensure(voice, options, force) {
    check(options.signal);
    const id = voice?.id;
    if (!force && id && verifiedVoice === id) return;
    verifiedVoice = undefined;
    let operation = pending.get(id);
    if (!operation) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const listeners = new Set();
      options.signal?.addEventListener("abort", cancel, { once: true });
      lifetime.signal.addEventListener("abort", cancel, { once: true });
      operation = { listeners, promise: null };
      operation.promise = Promise.resolve().then(() => {
        check(controller.signal);
        return downloads.ensureRuntime(id, {
          signal: controller.signal,
          onProgress: value => {
            const event = { ...value, stage: "loading", status: "loading", component: "runtime" };
            for (const listener of listeners) listener(event);
          },
        });
      }).then(result => {
        check(controller.signal);
        if (!result?.ready) throw Object.assign(new Error("Voice files are unavailable"), { code: "VOICE_NOT_INSTALLED" });
        verifiedVoice = id;
      }).finally(() => {
        options.signal?.removeEventListener("abort", cancel);
        lifetime.signal.removeEventListener("abort", cancel);
        if (pending.get(id) === operation) pending.delete(id);
      });
      pending.set(id, operation);
    }
    if (options.onProgress) operation.listeners.add(options.onProgress);
    try { await wait(operation.promise, options.signal); }
    finally { if (options.onProgress) operation.listeners.delete(options.onProgress); }
    check(options.signal);
  }

  async function run(method, voice, args, options) {
    await ensure(voice, options, method === "load");
    check(options.signal);
    engine ||= createEngine();
    return engine[method](...args, options);
  }

  return {
    get concurrency() { return Math.max(1, Number(engine?.concurrency) || 1); },
    get compute() { return engine?.compute; },
    load(voice, options = {}) { return run("load", voice, [voice], options); },
    synthesize(text, options = {}) { return run("synthesize", options.voice, [text], options); },
    dispose,
  };
}
