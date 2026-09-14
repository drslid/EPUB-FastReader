// @vitest-environment node
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { describe, it, expect, vi } from "vitest";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function setup(response) {
  const listeners = {};
  const cache = { match: vi.fn().mockResolvedValue(response), addAll: vi.fn().mockResolvedValue() };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue(["fastreader-voice-v1", "fastreader:/reader/:old"]), delete: vi.fn().mockResolvedValue(true) };
  const fetch = vi.fn().mockResolvedValue(new Response("network"));
  const self = { registration: { scope: "https://example.test/reader/" }, addEventListener: (type, handler) => { listeners[type] = handler; }, clients: { claim: vi.fn() } };
  vm.runInNewContext(source, { self, caches, fetch, Request, Response, URL, Set });
  async function request(url, options) {
    let result;
    listeners.fetch({ request: new Request(`https://example.test${url}`, options), respondWith: (promise) => { result = promise; } });
    return result;
  }
  return { cache, caches, fetch, listeners, request };
}

describe("persistent optional voice cache", () => {
  it("serves a downloaded model from its separate cache", async () => {
    const { request, caches, fetch } = setup(new Response("model"));
    expect(await (await request("/reader/voice-runtime/v1/models/kokoro/onnx/model_quantized.onnx")).text()).toBe("model");
    expect(caches.open).toHaveBeenCalledWith("fastreader-voice-v1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never downloads a missing model or substitutes the app shell", async () => {
    const { request, fetch } = setup();
    const response = await request("/reader/voice-runtime/v1/models/kokoro/voices/ff_siwis.bin");
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows explicit runtime installation without filling cache implicitly", async () => {
    const { request, fetch, cache } = setup();
    expect(await (await request("/reader/voice-runtime/v1/vendor/ephone.js")).text()).toBe("network");
    expect(fetch).toHaveBeenCalledOnce();
    expect(cache.addAll).not.toHaveBeenCalled();
  });

  it("repairs stale runtime bytes without serving the same cached worker again", async () => {
    const { request, fetch, cache } = setup(new Response("old worker"));
    expect(await (await request("/reader/voice-runtime/v1/worker.js", { cache: "no-store" })).text()).toBe("network");
    expect(fetch).toHaveBeenCalledOnce();
    expect(cache.match).not.toHaveBeenCalled();
  });

  it("retains voice installations during app updates and isolates other apps", async () => {
    const { caches, listeners, request } = setup();
    let activation;
    listeners.activate({ waitUntil: (promise) => { activation = promise; } });
    await activation;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith("fastreader:/reader/:old");
    expect(await request("/other/voice-runtime/v1/worker.js")).toBeUndefined();
  });
});
