// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createInstalledVoiceEngine } from "../src/installed-voice-engine.js";

const french = { id: "piper-fr_FR-siwis-medium" };
const english = { id: "piper-en_US-ljspeech-medium" };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const downloads = { ensureRuntime: vi.fn(async () => ({ ready: true })) };
  const underlying = { concurrency: 2, compute: { mode: "parallel", concurrency: 2 },
    load: vi.fn(async () => ({ ready: true })),
    synthesize: vi.fn(async () => ({ blob: new Blob(["voice"]), duration: 1 })),
    dispose: vi.fn() };
  const createEngine = vi.fn(() => underlying);
  const engine = createInstalledVoiceEngine({ downloads, createEngine });
  return { downloads, underlying, createEngine, engine };
}

describe("installed voice runtime gate", () => {
  it("does nothing until requested, then verifies files before constructing an engine", async () => {
    const { downloads, underlying, createEngine, engine } = setup();
    const update = deferred();
    downloads.ensureRuntime.mockReturnValueOnce(update.promise);
    expect(downloads.ensureRuntime).not.toHaveBeenCalled();
    expect(createEngine).not.toHaveBeenCalled();
    const loading = engine.load(french);
    await vi.waitFor(() => expect(downloads.ensureRuntime).toHaveBeenCalledOnce());
    expect(createEngine).not.toHaveBeenCalled();
    update.resolve({ ready: true });
    await loading;
    expect(underlying.load).toHaveBeenCalledWith(french, {});
    expect(engine.concurrency).toBe(2);
    expect(engine.compute).toEqual({ mode: "parallel", concurrency: 2 });
    underlying.concurrency = 1;
    expect(engine.concurrency).toBe(1);
  });

  it("reuses readiness for every passage but checks again on load or a new voice", async () => {
    const { downloads, engine, underlying } = setup();
    await engine.load(french);
    await engine.synthesize("Une phrase.", { voice: french, speed: 1 });
    await engine.synthesize("La suivante.", { voice: french, speed: 1.2 });
    expect(downloads.ensureRuntime).toHaveBeenCalledOnce();
    await engine.synthesize("Another sentence.", { voice: english });
    expect(downloads.ensureRuntime).toHaveBeenCalledTimes(2);
    expect(underlying.synthesize).toHaveBeenLastCalledWith("Another sentence.", { voice: english });
    await engine.synthesize("Retour en français.", { voice: french });
    expect(downloads.ensureRuntime).toHaveBeenCalledTimes(3);
    await engine.load(french);
    expect(downloads.ensureRuntime).toHaveBeenCalledTimes(4);
  });

  it("shares the first runtime update between concurrent passages and forwards progress", async () => {
    const { downloads, engine, createEngine } = setup();
    const update = deferred();
    downloads.ensureRuntime.mockReturnValueOnce(update.promise);
    const firstProgress = vi.fn(), secondProgress = vi.fn();
    const first = engine.synthesize("Première.", { voice: french, onProgress: firstProgress });
    const second = engine.synthesize("Deuxième.", { voice: french, onProgress: secondProgress });
    await vi.waitFor(() => expect(downloads.ensureRuntime).toHaveBeenCalledOnce());
    downloads.ensureRuntime.mock.calls[0][1].onProgress({ percent: 50, loadedBytes: 10, totalBytes: 20 });
    for (const callback of [firstProgress, secondProgress]) expect(callback).toHaveBeenCalledWith({
      stage: "loading", status: "loading", component: "runtime", percent: 50, loadedBytes: 10, totalBytes: 20,
    });
    update.resolve({ ready: true });
    await Promise.all([first, second]);
    expect(createEngine).toHaveBeenCalledOnce();
  });

  it.each(["VOICE_NOT_INSTALLED", "VOICE_RUNTIME_UPDATE_REQUIRED", "INTEGRITY"])("does not start a worker after %s and can retry", async code => {
    const { downloads, createEngine, engine } = setup();
    downloads.ensureRuntime.mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { code }));
    await expect(engine.load(french)).rejects.toMatchObject({ code });
    expect(createEngine).not.toHaveBeenCalled();
    await engine.load(french);
    expect(createEngine).toHaveBeenCalledOnce();
  });

  it("rejects incomplete readiness without starting inference", async () => {
    const { downloads, createEngine, engine } = setup();
    downloads.ensureRuntime.mockResolvedValueOnce({ ready: false });
    await expect(engine.synthesize("Bonjour.", { voice: french })).rejects.toMatchObject({ code: "VOICE_NOT_INSTALLED" });
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("cancels an updating download and never creates an engine after cancellation", async () => {
    const { downloads, createEngine, engine } = setup();
    const update = deferred(), controller = new AbortController();
    downloads.ensureRuntime.mockReturnValueOnce(update.promise);
    const loading = engine.load(french, { signal: controller.signal });
    const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(downloads.ensureRuntime).toHaveBeenCalledOnce());
    const downloadSignal = downloads.ensureRuntime.mock.calls[0][1].signal;
    controller.abort();
    expect(downloadSignal.aborted).toBe(true);
    await rejected;
    update.resolve({ ready: true });
    await vi.waitFor(() => expect(createEngine).not.toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    await engine.load(french);
    expect(createEngine).toHaveBeenCalledOnce();
  });

  it("lets another caller finish when a later waiter cancels", async () => {
    const { downloads, underlying, engine } = setup();
    const update = deferred(), controller = new AbortController();
    downloads.ensureRuntime.mockReturnValueOnce(update.promise);
    const first = engine.load(french);
    const second = engine.synthesize("Cancelled.", { voice: french, signal: controller.signal });
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(downloads.ensureRuntime).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(downloads.ensureRuntime.mock.calls[0][1].signal.aborted).toBe(false);
    update.resolve({ ready: true });
    await first;
    expect(underlying.load).toHaveBeenCalledOnce();
    expect(underlying.synthesize).not.toHaveBeenCalled();
  });

  it("dispose cancels installation and remains terminal even if the downloader resolves late", async () => {
    const { downloads, createEngine, engine } = setup();
    const update = deferred();
    downloads.ensureRuntime.mockReturnValueOnce(update.promise);
    const loading = engine.load(french);
    const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(downloads.ensureRuntime).toHaveBeenCalledOnce());
    engine.dispose();
    expect(downloads.ensureRuntime.mock.calls[0][1].signal.aborted).toBe(true);
    await rejected;
    update.resolve({ ready: true });
    await expect(engine.load(french)).rejects.toMatchObject({ name: "AbortError" });
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("forwards abort and disposal after the runtime check", async () => {
    const { underlying, engine } = setup();
    const controller = new AbortController(), onProgress = vi.fn();
    await engine.load(french, { signal: controller.signal, onProgress });
    expect(underlying.load).toHaveBeenCalledWith(french, { signal: controller.signal, onProgress });
    engine.dispose();
    engine.dispose();
    expect(underlying.dispose).toHaveBeenCalledOnce();
    await expect(engine.synthesize("Too late.", { voice: french })).rejects.toMatchObject({ name: "AbortError" });
  });
});
