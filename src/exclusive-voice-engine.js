/** Share the same origin-wide compute lock as audiobook preparation. */
export function createExclusiveVoiceEngine({ createEngine, locks = globalThis.navigator?.locks, lockName = "fastreader-local-speech" }) {
  const lifetime = new AbortController();
  let engine, pending, release;
  const aborted = () => new DOMException("Speech cancelled", "AbortError");
  function dispose() {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    engine?.dispose();
    release?.();
  }
  function acquire() {
    if (lifetime.signal.aborted) return Promise.reject(aborted());
    if (!locks?.request) return Promise.resolve(engine ||= createEngine());
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        void locks.request(lockName, { signal: lifetime.signal }, async () => {
          if (lifetime.signal.aborted) throw aborted();
          const finished = new Promise(done => { release = done; });
          try {
            engine = createEngine();
            resolve(engine);
            await finished;
          } finally { engine?.dispose(); }
        }).catch(reject);
      });
    }
    return pending;
  }
  async function run(method, args, signal) {
    if (signal?.aborted) throw aborted();
    signal?.addEventListener("abort", dispose, { once: true });
    try {
      const current = await acquire();
      if (lifetime.signal.aborted || signal?.aborted) throw aborted();
      return await current[method](...args);
    } finally { signal?.removeEventListener("abort", dispose); }
  }
  return {
    get concurrency() { return Math.max(1, Number(engine?.concurrency) || 1); },
    load(voice, options = {}) { return run("load", [voice, options], options.signal); },
    synthesize(text, options = {}) { return run("synthesize", [text, options], options.signal); },
    dispose,
  };
}
