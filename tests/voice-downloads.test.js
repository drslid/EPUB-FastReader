// @vitest-environment node
import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createVoiceDownloads } from "../src/voice-downloads.js";
import { VOICE_CACHE_NAME, VOICES } from "../src/voice-assets.js";

function setup({ online = true, estimate, cacheError } = {}) {
  const data = new Map();
  const assets = new Map();
  function asset(file) {
    if (!assets.has(file)) {
      const body = new TextEncoder().encode(`contents:${file}`);
      assets.set(file, { file, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), url: `https://reader.example/app/voice-runtime/v1/${file}`, source: `https://download.example/${file}`, body });
    }
    return assets.get(file);
  }
  const assetProvider = (voiceId) => {
    const voice = VOICES.find(({ id }) => id === voiceId);
    return [asset("worker.js"), asset("models/kokoro/onnx/model_quantized.onnx"), asset(`vendor/lang/${voice.pack}.js`), asset(`models/kokoro/voices/${voiceId}.bin`)];
  };
  for (const voice of VOICES) assetProvider(voice.id);
  const cache = {
    match: vi.fn(async (url) => data.get(url)?.clone()),
    put: vi.fn(async (url, response) => { if (cacheError) throw cacheError; data.set(url, response.clone()); }),
    delete: vi.fn(async (request) => data.delete(typeof request === "string" ? request : request.url)),
    keys: vi.fn(async () => [...data.keys()].map(url => new Request(url))),
  };
  const cacheStorage = {
    open: vi.fn(async () => cache),
    delete: vi.fn(async () => { data.clear(); return true; }),
  };
  const fetcher = vi.fn(async (url) => {
    const entry = [...assets.values()].find(({ source }) => source === url);
    return new Response(entry.body, { headers: { "Content-Type": "application/octet-stream" } });
  });
  const navigator = { onLine: online, storage: estimate ? { estimate } : undefined };
  const downloads = createVoiceDownloads({ baseUrl: "https://reader.example/app/", cacheStorage, fetcher, navigator, crypto: webcrypto, assetProvider });
  return { downloads, cache, data, assets, assetProvider, cacheStorage, fetcher, navigator };
}

describe("voice downloads", () => {
  it("does not request any assets before explicit download and reports the exact missing bytes", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    const status = await downloads.status("ff_siwis");
    expect(status).toMatchObject({ state: "missing", ready: false, storedBytes: 0 });
    expect(status.downloadBytes).toBe(assetProvider("ff_siwis").reduce((sum, asset) => sum + asset.bytes, 0));
    expect(await downloads.list()).toHaveLength(5);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams progress, verifies every file, and reads a ready voice offline without requests", async () => {
    const { downloads, fetcher, navigator, cacheStorage } = setup();
    const progress = [];
    const result = await downloads.download("ff_siwis", { onProgress: (event) => progress.push(event) });
    expect(result).toMatchObject({ ready: true, downloadBytes: 0, storedBytes: result.totalBytes });
    expect(progress[0].loadedBytes).toBe(0);
    expect(progress.slice(0, -1).every(({ percent }) => percent < 100)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ percent: 100, loadedBytes: result.totalBytes, totalBytes: result.totalBytes });
    expect(progress.some(({ loadedBytes }) => loadedBytes > 0 && loadedBytes < result.totalBytes)).toBe(true);
    expect(cacheStorage.open).toHaveBeenCalledWith(VOICE_CACHE_NAME);
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    const calls = fetcher.mock.calls.length;
    navigator.onLine = false;
    expect((await downloads.ensure("ff_siwis")).ready).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it("requires internet for missing files, even when another voice is already installed", async () => {
    const { downloads, fetcher, navigator } = setup();
    await downloads.download("ff_siwis");
    navigator.onLine = false;
    const before = fetcher.mock.calls.length;
    await expect(downloads.download("ef_dora")).rejects.toMatchObject({ code: "OFFLINE" });
    expect(fetcher).toHaveBeenCalledTimes(before);
    expect((await downloads.status("ff_siwis")).ready).toBe(true);
  });

  it("reuses the large common model and pronunciation pack across voices", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    await downloads.download("ff_siwis");
    const spanishVoice = assetProvider("ef_dora").at(-1);
    expect((await downloads.status("ef_dora")).downloadBytes).toBe(spanishVoice.bytes);
    fetcher.mockClear();
    await downloads.download("ef_dora");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(spanishVoice.source);
    fetcher.mockClear();
    await downloads.download("af_heart");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([expect.stringContaining("en_us.js"), expect.stringContaining("af_heart.bin")]));
  });

  it("cancels an active streamed response and retains only previously verified files for retry", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    const controller = new AbortController();
    const files = assetProvider("ff_siwis");
    fetcher.mockImplementationOnce(async () => new Response(files[0].body));
    fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(files[1].body.slice(0, 4)); },
    })));
    await expect(downloads.download("ff_siwis", { signal: controller.signal, onProgress: ({ file }) => {
      if (file === files[1].file) controller.abort();
    } })).rejects.toMatchObject({ name: "AbortError" });
    const status = await downloads.status("ff_siwis");
    expect(status.ready).toBe(false);
    expect(status.storedBytes).toBe(files[0].bytes);
    fetcher.mockClear();
    await downloads.download("ff_siwis");
    expect(fetcher).toHaveBeenCalledTimes(files.length - 1);
    expect(fetcher.mock.calls.some(([url]) => url === files[0].source)).toBe(false);
  });

  it.each(["short", "long", "hash", "html", "http"])("never caches an invalid %s response or marks it ready", async (failure) => {
    const { downloads, fetcher, data, assetProvider } = setup();
    const body = assetProvider("ff_siwis")[0].body;
    if (failure === "short") fetcher.mockResolvedValueOnce(new Response(body.slice(1)));
    if (failure === "long") fetcher.mockResolvedValueOnce(new Response(new Uint8Array(body.length + 1)));
    if (failure === "hash") fetcher.mockResolvedValueOnce(new Response(new Uint8Array(body.length)));
    if (failure === "html") fetcher.mockResolvedValueOnce(new Response("<html>Service unavailable</html>"));
    if (failure === "http") fetcher.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(downloads.download("ff_siwis")).rejects.toMatchObject({ code: failure === "http" ? "HTTP" : "INTEGRITY" });
    expect(data.size).toBe(0);
    expect((await downloads.status("ff_siwis")).ready).toBe(false);
  });

  it("detects browser cache eviction and repairs only the missing file", async () => {
    const { downloads, fetcher, data, assetProvider } = setup();
    await downloads.download("ff_siwis");
    const model = assetProvider("ff_siwis")[1];
    data.delete(model.url);
    expect(await downloads.status("ff_siwis")).toMatchObject({ ready: false, downloadBytes: model.bytes });
    fetcher.mockClear();
    await downloads.download("ff_siwis");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(model.source);
  });

  it("does not trust an unverified cached response with the right byte length", async () => {
    const { downloads, data, assetProvider } = setup();
    const file = assetProvider("ff_siwis")[0];
    data.set(file.url, new Response(file.body, { headers: { "Content-Length": file.bytes } }));
    expect((await downloads.status("ff_siwis")).storedBytes).toBe(0);
  });

  it("checks available storage before downloading and maps quota failures during writes", async () => {
    const low = setup({ estimate: vi.fn(async () => ({ quota: 100, usage: 99 })) });
    await expect(low.downloads.download("ff_siwis")).rejects.toMatchObject({ code: "STORAGE_FULL", availableBytes: 1 });
    expect(low.fetcher).not.toHaveBeenCalled();
    const full = setup({ cacheError: new DOMException("Full", "QuotaExceededError") });
    await expect(full.downloads.download("ff_siwis")).rejects.toMatchObject({ code: "STORAGE_FULL" });
    expect((await full.downloads.status("ff_siwis")).ready).toBe(false);
  });

  it("continues when a browser cannot estimate quota, but surfaces unavailable Cache API", async () => {
    const { downloads } = setup({ estimate: vi.fn(async () => { throw new Error("Unavailable"); }) });
    expect((await downloads.download("ff_siwis")).ready).toBe(true);
    const unavailable = createVoiceDownloads({ cacheStorage: null });
    await expect(unavailable.status("ff_siwis")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("removes one voice without breaking another, then releases remaining shared files", async () => {
    const { downloads, data } = setup();
    await downloads.download("ff_siwis");
    await downloads.download("af_heart");
    expect((await downloads.removeVoice("ff_siwis")).ready).toBe(false);
    expect((await downloads.status("af_heart")).ready).toBe(true);
    expect([...data.keys()].some((url) => url.includes("roa.js"))).toBe(false);
    expect([...data.keys()].some((url) => url.includes("model_quantized.onnx"))).toBe(true);
    await downloads.remove("af_heart");
    expect(data.size).toBe(0);
  });

  it("clears this deployment's voices without touching the book database or sibling deployments", async () => {
    const { downloads, cacheStorage, data } = setup();
    await downloads.download("ff_siwis");
    const other = "https://reader.example/another-app/voice-runtime/v1/worker.js";
    data.set(other, new Response("Another deployment"));
    await downloads.clearAll();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
    expect([...data.keys()]).toEqual([other]);
    expect((await downloads.status("ff_siwis")).storedBytes).toBe(0);
  });

  it("prevents a new download while files are being removed", async () => {
    const { downloads } = setup();
    await downloads.download("ff_siwis");
    const removal = downloads.removeVoice("ff_siwis");
    await expect(downloads.download("af_heart")).rejects.toMatchObject({ code: "BUSY" });
    await removal;
    const clearing = downloads.clearAll();
    await expect(downloads.download("ff_siwis")).rejects.toMatchObject({ code: "BUSY" });
    await clearing;
    expect((await downloads.download("ff_siwis")).ready).toBe(true);
  });

  it("rejects unknown voices, pre-aborted requests and concurrent mutations", async () => {
    const { downloads } = setup();
    await expect(downloads.download("unsupported")).rejects.toMatchObject({ code: "UNSUPPORTED_VOICE" });
    const controller = new AbortController();
    controller.abort();
    await expect(downloads.download("ff_siwis", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const first = downloads.download("ff_siwis");
    await expect(downloads.download("af_heart")).rejects.toMatchObject({ code: "BUSY" });
    await expect(downloads.clearAll()).rejects.toMatchObject({ code: "BUSY" });
    await expect(downloads.removeVoice("af_heart")).rejects.toMatchObject({ code: "BUSY" });
    expect((await first).ready).toBe(true);
  });
});
