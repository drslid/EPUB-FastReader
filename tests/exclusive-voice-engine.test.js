// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createExclusiveVoiceEngine } from "../src/exclusive-voice-engine.js";

function fixture() {
  const lockCalls = [];
  const locks = { request: vi.fn((name, options, callback) => new Promise((resolve, reject) => {
    const request = { name, options, grant: () => Promise.resolve(callback({ name })).then(resolve, reject) };
    options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    lockCalls.push(request);
  })) };
  const underlying = { load: vi.fn(async () => {}), synthesize: vi.fn(async () => ({ blob: new Blob(["sound"]) })), dispose: vi.fn() };
  const createEngine = vi.fn(() => underlying);
  return { locks, lockCalls, underlying, createEngine, client: createExclusiveVoiceEngine({ createEngine, locks }) };
}

describe("exclusive speech generation", () => {
  it("waits for the queue's shared lock before even creating a worker", async () => {
    const { client, lockCalls, createEngine, underlying, locks } = fixture();
    underlying.concurrency = 2;
    expect(client.concurrency).toBe(1);
    const load = client.load({ id: "ff_siwis" });
    expect(createEngine).not.toHaveBeenCalled();
    const held = lockCalls[0].grant();
    await load;
    expect(client.concurrency).toBe(2);
    await client.synthesize("Bonjour");
    expect(locks.request).toHaveBeenCalledOnce();
    expect(lockCalls[0].name).toBe("fastreader-local-speech");
    expect(underlying.synthesize).toHaveBeenCalledOnce();
    client.dispose();
    await held;
  });
  it("cancels a waiting request without starting synthesis later", async () => {
    const { client, createEngine, lockCalls } = fixture();
    const controller = new AbortController();
    const load = client.load({}, { signal: controller.signal });
    controller.abort();
    await expect(load).rejects.toMatchObject({ name: "AbortError" });
    await lockCalls[0].grant();
    expect(createEngine).not.toHaveBeenCalled();
  });
  it("terminates active synthesis and releases its lock on cancellation", async () => {
    const { client, lockCalls, underlying } = fixture();
    const controller = new AbortController();
    const load = client.load({}, { signal: controller.signal });
    const held = lockCalls[0].grant();
    await load;
    underlying.synthesize.mockImplementation((text, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true })));
    const speech = client.synthesize("texte", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(speech).rejects.toMatchObject({ name: "AbortError" });
    await held;
    expect(underlying.dispose).toHaveBeenCalled();
  });
  it("preserves immediate listening on browsers without Web Locks", async () => {
    const engine = { load: vi.fn(), dispose: vi.fn() };
    const client = createExclusiveVoiceEngine({ createEngine: () => engine, locks: null });
    await client.load({});
    expect(engine.load).toHaveBeenCalledOnce();
    client.dispose();
  });
});
