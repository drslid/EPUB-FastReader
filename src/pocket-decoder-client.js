/** Own one optional Mimi Worker. The caller retains latents for local fallback. */
export async function createPocketDecoderPeer({
  runtimeUrl,
  voiceId,
  workerFactory = url => new Worker(url, { type: "module", name: "fastreader-pocket-decoder" }),
  timeoutMs = 15_000,
}) {
  const worker = workerFactory(new URL("pocket-decoder-worker.js", runtimeUrl));
  const pending = new Map();
  let nextId = 0;
  let failure;

  function terminate(error = new Error("Pocket decoder worker stopped")) {
    if (failure) return;
    failure = error;
    worker.terminate();
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  worker.onmessage = ({ data }) => {
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = event => {
    event?.preventDefault?.();
    terminate(new Error(event?.message || "Pocket decoder worker failed"));
  };
  worker.onmessageerror = () => terminate(new Error("Pocket decoder worker sent an unreadable message"));

  function request(type, latents) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => terminate(new Error(`Pocket decoder worker timed out (${type})`)), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        if (latents) worker.postMessage({ id, type, latents }, [latents.buffer]);
        else if (type === "init") worker.postMessage({ id, type, voiceId });
        else worker.postMessage({ id, type });
      } catch (error) { terminate(error); }
    });
  }

  try {
    await request("init");
  } catch (error) {
    terminate(error);
    throw error;
  }

  return {
    start: () => request("start"),
    async decode(latents) {
      if (!(latents instanceof Float32Array) || !latents.length) throw new TypeError("Pocket decoder needs latent frames");
      const pcm = await request("decode", new Float32Array(latents));
      if (!(pcm instanceof Float32Array) || !pcm.length) {
        const error = new Error("Pocket decoder worker returned invalid audio");
        terminate(error);
        throw error;
      }
      return pcm;
    },
    close: () => request("close"),
    terminate: () => terminate(),
  };
}
