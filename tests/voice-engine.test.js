import { describe, expect, it, vi } from "vitest";
import { createVoiceEngine } from "../src/voice-engine.js";
import { concatenateVoiceAudio, concatenateVoiceWavs } from "../src/voice-audio.js";

function wav(samples, sampleRate = 24_000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  for (const [offset, tag] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
    [...tag].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  }
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}

function automatedEngine(reply) {
  const calls = [];
  const worker = {
    terminate: vi.fn(),
    postMessage(message) {
      calls.push(message);
      queueMicrotask(() => {
        const response = reply(message, calls);
        if (response) worker.onmessage({ data: { id: message.id, ...response } });
      });
    },
  };
  const workerFactory = vi.fn(() => worker);
  return { engine: createVoiceEngine({ workerFactory }), calls, worker, workerFactory };
}

function setup() {
  const workers = [];
  const workerFactory = vi.fn((url) => {
    const worker = { url, postMessage: vi.fn(), terminate: vi.fn() };
    workers.push(worker);
    return worker;
  });
  const onProgress = vi.fn();
  const engine = createVoiceEngine({ baseUrl: "https://example.test/EPUB-FastReader/", workerFactory, onProgress });
  return { engine, workers, workerFactory, onProgress };
}

describe("optional local speech engine", () => {
  it("resolves Vite's relative base URL for development and GitHub Pages", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const workerFactory = vi.fn(() => worker);
    const engine = createVoiceEngine({ baseUrl: "/EPUB-FastReader/", workerFactory });
    const loading = engine.load({ id: "ff_siwis" });
    expect(workerFactory.mock.calls[0][0].pathname).toBe("/EPUB-FastReader/voice-runtime/v1/worker.js");
    worker.onmessage({ data: { id: 1, result: { ready: true } } });
    await loading;
    engine.dispose();
  });

  it("does not create a worker or download anything before a voice is requested", async () => {
    const { engine, workers, workerFactory } = setup();
    expect(workerFactory).not.toHaveBeenCalled();
    const loading = engine.load({ id: "ff_siwis" });
    expect(workers[0].url.href).toBe("https://example.test/EPUB-FastReader/voice-runtime/v1/worker.js");
    workers[0].onmessage({ data: { id: 1, result: { ready: true } } });
    await expect(loading).resolves.toEqual({ ready: true });
    engine.dispose();
  });

  it("returns playable WAV blobs and preserves the actual generated duration", async () => {
    const { engine, workers, onProgress } = setup();
    const generating = engine.synthesize("Bonjour.", { voice: { id: "ff_siwis" }, speed: 1.25 });
    expect(workers[0].postMessage).toHaveBeenCalledWith({ id: 1, type: "synthesize", text: "Bonjour.", voice: { id: "ff_siwis" }, speed: 1.25 });
    workers[0].onmessage({ data: { type: "progress", progress: { status: "loading" } } });
    workers[0].onmessage({ data: { id: 1, result: { wav: new ArrayBuffer(48), duration: 0.25 } } });
    const { blob, duration } = await generating;
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(48);
    expect(duration).toBe(0.25);
    expect(onProgress).toHaveBeenCalledWith({ status: "loading" });
    engine.dispose();
  });

  it("aborts running and queued synthesis, releases WASM and can start again", async () => {
    const { engine, workers } = setup();
    const controller = new AbortController();
    const first = engine.synthesize("Un passage.", { voice: { id: "ff_siwis" }, signal: controller.signal });
    const queued = engine.synthesize("La suite.", { voice: { id: "ff_siwis" } });
    const results = Promise.allSettled([first, queued]);
    controller.abort();
    for (const result of await results) expect(result.reason.name).toBe("AbortError");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const restarted = engine.load({ id: "af_heart" });
    expect(workers).toHaveLength(2);
    // Late responses from the terminated worker cannot resolve the new request.
    workers[0].onmessage({ data: { id: 1, result: { wav: new ArrayBuffer(2), duration: 10 } } });
    workers[0].onerror({ message: "Late failure from an obsolete Worker" });
    workers[1].onmessage({ data: { id: 3, result: { ready: true } } });
    await expect(restarted).resolves.toEqual({ ready: true });
    engine.dispose();
  });

  it("does not initialise an already cancelled request", async () => {
    const { engine, workerFactory } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(engine.load({ id: "ff_siwis" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("assembles a complete sentence after the worker token limit, with one sequential worker", async () => {
    const text = "Une première proposition assez longue, puis une deuxième proposition complète.";
    const completed = [];
    const { engine, calls, workerFactory } = automatedEngine(message => {
      if (message.text === text) return { error: { code: "VOICE_TEXT_TOO_LONG" } };
      completed.push(message.text);
      return { result: { wav: wav([completed.length, -completed.length]), duration: 2 / 24_000 } };
    });
    const result = await engine.synthesize(text, { voice: { id: "ff_siwis" }, speed: 1.1 });
    expect(completed).toHaveLength(2);
    expect(completed.join(" ")).toBe(text);
    expect(calls).toHaveLength(3);
    expect(calls.every(call => call.voice.id === "ff_siwis" && call.speed === 1.1)).toBe(true);
    expect(workerFactory).toHaveBeenCalledOnce();
    const buffer = await result.blob.arrayBuffer();
    expect([...new Int16Array(buffer, 44)]).toEqual([1, -1, 2, -2]);
    expect(result.duration).toBe(4 / 24_000);
    expect(new DataView(buffer).getUint32(40, true)).toBe(8);
    engine.dispose();
  });

  it("does not return partial audio when a later fragment fails", async () => {
    const { engine } = automatedEngine((message, calls) => {
      if (calls.length === 1) return { error: { code: "VOICE_TEXT_TOO_LONG" } };
      if (calls.length === 2) return { result: { wav: wav([1]), duration: 1 / 24_000 } };
      return { error: { code: "VOICE_FAILED", message: "Model failure" } };
    });
    await expect(engine.synthesize("Une première proposition, puis une deuxième proposition."))
      .rejects.toMatchObject({ code: "VOICE_FAILED", message: "Model failure" });
    engine.dispose();
  });

  it("bounds repeated context-limit retries without truncating any text", async () => {
    const { engine, calls } = automatedEngine(() => ({ error: { code: "VOICE_TEXT_TOO_LONG" } }));
    await expect(engine.synthesize("word ".repeat(2_000)))
      .rejects.toMatchObject({ code: "VOICE_TEXT_UNSPLITTABLE" });
    expect(calls.length).toBeLessThanOrEqual(9);
    engine.dispose();
  });

  it("aborts before starting the next fragment and never returns already completed audio", async () => {
    const controller = new AbortController();
    const { engine, calls, workerFactory, worker } = automatedEngine((message, received) => {
      if (received.length === 1) return { error: { code: "VOICE_TEXT_TOO_LONG" } };
      // Abort between a successful response and its async continuation.
      queueMicrotask(() => controller.abort());
      return { result: { wav: wav([1]), duration: 1 / 24_000 } };
    });
    await expect(engine.synthesize("Première partie très longue, et deuxième partie très longue.", { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(2);
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it("terminates a pending fallback fragment and ignores its late reply after cancellation", async () => {
    const controller = new AbortController();
    let secondStarted;
    const started = new Promise(resolve => { secondStarted = resolve; });
    const { engine, calls, worker } = automatedEngine((message, received) => {
      if (received.length === 1) return { error: { code: "VOICE_TEXT_TOO_LONG" } };
      secondStarted();
    });
    const result = engine.synthesize("Première partie très longue, et deuxième partie très longue.", { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await started;
    controller.abort();
    await rejected;
    worker.onmessage({ data: { id: calls[1].id, result: { wav: wav([1]), duration: 1 / 24_000 } } });
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(worker.terminate).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it("rejects pending operations after a worker crash or final disposal", async () => {
    const { engine, workers } = setup();
    const loading = engine.load({ id: "ff_siwis" });
    workers[0].onerror();
    await expect(loading).rejects.toMatchObject({ code: "VOICE_FAILED" });
    engine.dispose();
    await expect(engine.load({ id: "ff_siwis" })).rejects.toThrow("disposed");
  });

  it.each(["onerror", "onmessageerror"])("preserves VOICE_FAILED during a sentence after %s", async (event) => {
    const { engine, workers } = setup();
    const generating = engine.synthesize("Une phrase entière.", { voice: { id: "ff_siwis" } });
    workers[0][event]({ message: "Worker crashed" });
    await expect(generating).rejects.toMatchObject({ code: "VOICE_FAILED", message: "Worker crashed" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].postMessage).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(1);
    engine.dispose();
  });

  it("preserves a fragment Worker failure without returning partial audio or starting a following fragment", async () => {
    const { engine, calls, worker, workerFactory } = automatedEngine((message, received) => {
      if (received.length === 1) return { error: { code: "VOICE_TEXT_TOO_LONG" } };
      if (received.length === 2) return { result: { wav: wav([1]), duration: 1 / 24_000 } };
      worker.onerror({ message: "Worker failed during the next fragment" });
    });
    await expect(engine.synthesize("Une première proposition assez longue, puis une deuxième proposition complète."))
      .rejects.toMatchObject({ code: "VOICE_FAILED", message: "Worker failed during the next fragment" });
    expect(calls).toHaveLength(3);
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it("preserves a Worker failure between a completed fragment and its continuation", async () => {
    const { engine, calls, worker, workerFactory } = automatedEngine((message, received) => {
      if (received.length === 1) return { error: { code: "VOICE_TEXT_TOO_LONG" } };
      queueMicrotask(() => worker.onerror({ message: "Worker stopped after a fragment" }));
      return { result: { wav: wav([1]), duration: 1 / 24_000 } };
    });
    await expect(engine.synthesize("Une première proposition assez longue, puis une deuxième proposition complète."))
      .rejects.toMatchObject({ code: "VOICE_FAILED", message: "Worker stopped after a fragment" });
    expect(calls).toHaveLength(2);
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it("routes loading bytes and synthesis stages to the active operation without invented percentages", async () => {
    const { engine, workers } = setup();
    const onProgress = vi.fn();
    const generating = engine.synthesize("Bonjour.", { voice: { id: "ff_siwis" }, onProgress });
    workers[0].onmessage({ data: { id: 1, type: "progress", progress: { stage: "loading", loaded: 200, total: 1000 } } });
    workers[0].onmessage({ data: { id: 1, type: "progress", progress: { stage: "phonemizing" } } });
    workers[0].onmessage({ data: { id: 1, result: { wav: wav([1, 2]), duration: 2 / 24_000 } } });
    await generating;
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: "loading", loaded: 200, total: 1000, completedFragments: 0 }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "ready", completedFragments: 1, totalFragments: 1, audioDuration: 2 / 24_000 }));
    expect(onProgress.mock.calls.some(([value]) => "percent" in value)).toBe(false);
    engine.dispose();
  });

  it("reports completed fragments only when their WAV exists", async () => {
    const onProgress = vi.fn();
    const { engine } = automatedEngine((message, calls) => calls.length === 1
      ? { error: { code: "VOICE_TEXT_TOO_LONG" } }
      : { result: { wav: wav([1]), duration: 1 / 24_000 } });
    await engine.synthesize("Une proposition assez longue, puis une autre proposition assez longue.", { onProgress });
    const counts = onProgress.mock.calls.map(([value]) => value.completedFragments);
    expect(counts).toEqual([0, 1, 2, 2]);
    expect(onProgress.mock.calls.slice(0, -1).every(([value]) => value.totalFragments === undefined)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ totalFragments: 2 }));
    engine.dispose();
  });
});

describe("sentence WAV assembly", () => {
  it("also combines stored blobs with generated buffers using actual sample durations", async () => {
    const result = await concatenateVoiceAudio([
      { blob: new Blob([wav([1, 2])]), duration: 99 },
      { wav: wav([3, 4]), duration: 99 },
    ]);
    expect(result.blob.type).toBe("audio/wav");
    expect(result.duration).toBe(4 / 24_000);
    expect([...new Int16Array(await result.blob.arrayBuffer(), 44)]).toEqual([1, 2, 3, 4]);
  });

  it("does not read another stored blob after cancellation", async () => {
    const controller = new AbortController();
    const unread = { arrayBuffer: vi.fn() };
    await expect(concatenateVoiceAudio([
      { blob: { async arrayBuffer() { controller.abort(); return wav([1]); } } },
      { blob: unread },
    ], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(unread.arrayBuffer).not.toHaveBeenCalled();
  });

  it("keeps all PCM samples, including silent tails, and fixes the RIFF lengths", () => {
    const result = concatenateVoiceWavs([wav([32767, -32768, 0]), wav([123, 0, 0])]);
    expect([...new Int16Array(result.wav, 44)]).toEqual([32767, -32768, 0, 123, 0, 0]);
    expect(result.duration).toBe(6 / 24_000);
    const view = new DataView(result.wav);
    expect(view.getUint32(4, true)).toBe(48);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getUint32(24, true)).toBe(24_000);
  });

  it("rejects corrupt, incompatible or empty WAV fragments", () => {
    expect(() => concatenateVoiceWavs([])).toThrow();
    expect(() => concatenateVoiceWavs([new ArrayBuffer(48)])).toThrow();
    expect(() => concatenateVoiceWavs([wav([])])).toThrow();
    expect(() => concatenateVoiceWavs([wav([1]), wav([2], 48_000)])).toThrow();
    const truncated = wav([1, 2]).slice(0, 46);
    expect(() => concatenateVoiceWavs([truncated])).toThrow();
  });
});
