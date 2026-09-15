// @vitest-environment node
import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createVoiceDownloads } from "../src/voice-downloads.js";
import { VOICE_CACHE_NAME, LEGACY_VOICE_CACHE_NAME, VOICES } from "../src/voice-assets.js";

function setup({ online = true, estimate, cacheError } = {}) {
  const data = new Map();
  const assets = new Map();
  function asset(file, voiceId) {
    if (!assets.has(file)) {
      const body = new TextEncoder().encode(`contents:${file}`);
      assets.set(file, { file, ...(voiceId ? { voiceId } : {}), bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), url: `https://reader.example/app/voice-runtime/v2/${file}`, source: `https://download.example/${file}`, body });
    }
    return assets.get(file);
  }
  const assetProvider = (voiceId) => {
    const voice = VOICES.find(({ id }) => id === voiceId);
    return [asset("worker.js"), asset("vendor/phonemizer.data"), asset(`models/${voice.modelKey}/config.json`, voiceId), asset(`models/${voice.modelKey}/model.onnx`, voiceId)];
  };
  for (const voice of VOICES) assetProvider(voice.id);
  const stores = new Map([[VOICE_CACHE_NAME, data]]), caches = new Map();
  const makeCache = entries => ({
    match: vi.fn(async url => entries.get(url)?.clone()),
    put: vi.fn(async (url, response) => { if (cacheError) throw cacheError; entries.set(url, response.clone()); }),
    delete: vi.fn(async request => entries.delete(typeof request === "string" ? request : request.url)),
    keys: vi.fn(async () => [...entries.keys()].map(url => new Request(url))),
  });
  const cache = makeCache(data);
  caches.set(VOICE_CACHE_NAME, cache);
  const cacheStorage = {
    keys: vi.fn(async () => [...stores.keys()]),
    open: vi.fn(async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      if (!caches.has(name)) caches.set(name, makeCache(stores.get(name)));
      return caches.get(name);
    }),
    delete: vi.fn(async name => { caches.delete(name); return stores.delete(name); }),
  };
  const fetcher = vi.fn(async (url) => {
    const entry = [...assets.values()].find(({ source }) => source === url);
    return new Response(entry.body, { headers: { "Content-Type": "application/octet-stream" } });
  });
  const navigator = { onLine: online, storage: estimate ? { estimate } : undefined };
  const downloads = createVoiceDownloads({ baseUrl: "https://reader.example/app/", cacheStorage, fetcher, navigator, crypto: webcrypto, assetProvider });
  return { downloads, cache, data, stores, assets, assetProvider, cacheStorage, fetcher, navigator };
}

describe("voice downloads", () => {
  it("updates only an outdated runtime file before resuming an installed voice", async () => {
    const { downloads, fetcher, assets, assetProvider } = setup();
    const id = VOICES[0].id;
    await downloads.download(id);
    const worker = assets.get("worker.js");
    worker.body = new TextEncoder().encode("new compatible worker");
    worker.bytes = worker.body.length;
    worker.sha256 = createHash("sha256").update(worker.body).digest("hex");
    fetcher.mockClear();
    const onProgress = vi.fn();
    expect((await downloads.ensureRuntime(id, { onProgress })).ready).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([worker.source]);
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
    expect(onProgress.mock.calls.at(-1)[0]).toMatchObject({ percent: 100, totalBytes: worker.bytes });
    expect((await downloads.status(id)).storedBytes).toBe(assetProvider(id).reduce((sum, asset) => sum + asset.bytes, 0));
  });

  it.each(["config.json", "model.onnx"])("never installs a missing %s when resuming a preparation", async (name) => {
    const { downloads, fetcher, data, assetProvider } = setup();
    const id = VOICES[0].id;
    await downloads.download(id);
    data.delete(assetProvider(id).find(asset => asset.file.endsWith(name)).url);
    data.delete(assetProvider(id)[0].url);
    fetcher.mockClear();
    await expect(downloads.ensureRuntime(id)).rejects.toMatchObject({ code: "VOICE_NOT_INSTALLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never downloads a voice that has not been explicitly installed", async () => {
    const { downloads, fetcher } = setup();
    await expect(downloads.ensureRuntime(VOICES[0].id)).rejects.toMatchObject({ code: "VOICE_NOT_INSTALLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("starts an installed voice while another language is downloading", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    const french = VOICES[0].id, english = VOICES[1].id;
    await downloads.download(french);
    fetcher.mockClear();
    let finishDownload;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finishDownload = resolve; }));
    const downloading = downloads.download(english);
    await vi.waitFor(() => expect(finishDownload).toBeTypeOf("function"));
    expect((await downloads.ensureRuntime(french)).ready).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    const nextAsset = assetProvider(english).find(asset => asset.voiceId);
    expect(fetcher.mock.calls[0][0]).toBe(nextAsset.source);
    finishDownload(new Response(nextAsset.body));
    await downloading;
  });

  it("honors cancellation even for a voice whose files are already installed", async () => {
    const { downloads, fetcher } = setup();
    const id = VOICES[0].id;
    await downloads.download(id);
    fetcher.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(downloads.ensureRuntime(id, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a connection only for an outdated runtime and preserves the installed model", async () => {
    const { downloads, fetcher, navigator, data, assetProvider } = setup();
    const id = VOICES[0].id;
    await downloads.download(id);
    navigator.onLine = false;
    fetcher.mockClear();
    expect((await downloads.ensureRuntime(id)).ready).toBe(true);
    const worker = assetProvider(id)[0];
    data.delete(worker.url);
    await expect(downloads.ensureRuntime(id)).rejects.toMatchObject({ code: "VOICE_RUNTIME_UPDATE_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(assetProvider(id).filter(asset => asset.voiceId).every(asset => data.has(asset.url))).toBe(true);
    navigator.onLine = true;
    expect((await downloads.ensureRuntime(id)).ready).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([worker.source]);
  });

  it("keeps a previous runtime file when its update fails integrity verification", async () => {
    const { downloads, fetcher, assets, data } = setup();
    const id = VOICES[0].id;
    await downloads.download(id);
    const worker = assets.get("worker.js");
    const previous = await data.get(worker.url).clone().text();
    worker.sha256 = "0".repeat(64);
    fetcher.mockClear();
    await expect(downloads.ensureRuntime(id)).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await data.get(worker.url).clone().text()).toBe(previous);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([worker.source]);
  });

  it("reports real per-voice storage, counts shared files once and excludes other deployments", async () => {
    const { downloads, assetProvider, cache, stores, fetcher } = setup();
    const french = VOICES.find(voice => voice.language === "fr").id;
    const english = VOICES.find(voice => voice.language === "en").id;
    await downloads.download(french);
    await downloads.download(english);
    await cache.put("https://reader.example/other/voice-runtime/v2/worker.js", new Response("other", { headers: { "Content-Length": "9999" } }));
    stores.set(LEGACY_VOICE_CACHE_NAME, new Map([
      ["https://reader.example/app/voice-runtime/v1/worker.js", new Response("old", { headers: { "Content-Length": "7" } })],
      ["https://reader.example/other/voice-runtime/v1/worker.js", new Response("other", { headers: { "Content-Length": "9999" } })],
    ]));
    fetcher.mockClear();
    const own = id => assetProvider(id).filter(asset => asset.voiceId).reduce((sum, asset) => sum + asset.bytes, 0);
    const shared = assetProvider(french).filter(asset => !asset.voiceId).reduce((sum, asset) => sum + asset.bytes, 0);
    expect(await downloads.storageStatus()).toMatchObject({
      voices: expect.arrayContaining([{ id: french, name: "Siwis", language: "fr", bytes: own(french) }, { id: english, name: "LJ Speech", language: "en", bytes: own(english) }]),
      sharedBytes: shared, unusedBytes: 7, totalBytes: shared + own(french) + own(english) + 7,
    });
    expect((await downloads.storageStatus()).voices).toHaveLength(2);
    expect(fetcher).not.toHaveBeenCalled();
    await downloads.removeVoice(french);
    expect((await downloads.storageStatus()).voices.map(voice => voice.id)).toEqual([english]);
  });

  it("does not request any assets before explicit download and reports the exact missing bytes", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    const status = await downloads.status("piper-fr_FR-siwis-medium");
    expect(status).toMatchObject({ state: "missing", ready: false, storedBytes: 0 });
    expect(status.downloadBytes).toBe(assetProvider("piper-fr_FR-siwis-medium").reduce((sum, asset) => sum + asset.bytes, 0));
    expect(await downloads.list()).toHaveLength(6);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams progress, verifies every file, and reads a ready voice offline without requests", async () => {
    const { downloads, fetcher, navigator, cacheStorage } = setup();
    const progress = [];
    const result = await downloads.download("piper-fr_FR-siwis-medium", { onProgress: (event) => progress.push(event) });
    expect(result).toMatchObject({ ready: true, downloadBytes: 0, storedBytes: result.totalBytes });
    expect(progress[0].loadedBytes).toBe(0);
    expect(progress.slice(0, -1).every(({ percent }) => percent < 100)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ percent: 100, loadedBytes: result.totalBytes, totalBytes: result.totalBytes });
    expect(progress.some(({ loadedBytes }) => loadedBytes > 0 && loadedBytes < result.totalBytes)).toBe(true);
    expect(cacheStorage.open).toHaveBeenCalledWith(VOICE_CACHE_NAME);
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    const calls = fetcher.mock.calls.length;
    navigator.onLine = false;
    expect((await downloads.ensure("piper-fr_FR-siwis-medium")).ready).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it("reads shared runtime headers once per refresh while still detecting later eviction", async () => {
    const { downloads, cache, data, assetProvider } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    await downloads.download("piper-en_US-ljspeech-medium");
    cache.match.mockClear();
    const first = await downloads.list();
    expect(first.filter(status => status.ready).map(status => status.voiceId)).toEqual([
      "piper-fr_FR-siwis-medium", "piper-en_US-ljspeech-medium",
    ]);
    const readUrls = cache.match.mock.calls.map(([url]) => url);
    const allUrls = new Set(VOICES.flatMap(voice => assetProvider(voice.id).map(asset => asset.url)));
    expect(readUrls).toHaveLength(allUrls.size);
    expect(new Set(readUrls)).toEqual(allUrls);

    const runtime = assetProvider("piper-fr_FR-siwis-medium")[0];
    data.delete(runtime.url);
    cache.match.mockClear();
    const refreshed = await downloads.list();
    expect(refreshed.every(status => !status.ready)).toBe(true);
    expect(refreshed[0].downloadBytes).toBe(runtime.bytes);
    expect(cache.match.mock.calls.filter(([url]) => url === runtime.url)).toHaveLength(1);
  });

  it("requires internet for missing files, even when another voice is already installed", async () => {
    const { downloads, fetcher, navigator } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    navigator.onLine = false;
    const before = fetcher.mock.calls.length;
    await expect(downloads.download("piper-es_ES-davefx-medium")).rejects.toMatchObject({ code: "OFFLINE" });
    expect(fetcher).toHaveBeenCalledTimes(before);
    expect((await downloads.status("piper-fr_FR-siwis-medium")).ready).toBe(true);
  });

  it("reuses shared runtime files but downloads each language's own model and configuration", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    const spanishFiles = assetProvider("piper-es_ES-davefx-medium").filter(asset => asset.voiceId);
    expect((await downloads.status("piper-es_ES-davefx-medium")).downloadBytes).toBe(spanishFiles.reduce((sum, file) => sum + file.bytes, 0));
    fetcher.mockClear();
    await downloads.download("piper-es_ES-davefx-medium");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(spanishFiles.map(file => file.source));
    fetcher.mockClear();
    await downloads.download("piper-en_US-ljspeech-medium");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(assetProvider("piper-en_US-ljspeech-medium").filter(asset => asset.voiceId).map(file => file.source));
  });

  it("cancels an active streamed response and retains only previously verified files for retry", async () => {
    const { downloads, fetcher, assetProvider } = setup();
    const controller = new AbortController();
    const files = assetProvider("piper-fr_FR-siwis-medium");
    fetcher.mockImplementationOnce(async () => new Response(files[0].body));
    fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(files[1].body.slice(0, 4)); },
    })));
    await expect(downloads.download("piper-fr_FR-siwis-medium", { signal: controller.signal, onProgress: ({ file }) => {
      if (file === files[1].file) controller.abort();
    } })).rejects.toMatchObject({ name: "AbortError" });
    const status = await downloads.status("piper-fr_FR-siwis-medium");
    expect(status.ready).toBe(false);
    expect(status.storedBytes).toBe(files[0].bytes);
    fetcher.mockClear();
    await downloads.download("piper-fr_FR-siwis-medium");
    expect(fetcher).toHaveBeenCalledTimes(files.length - 1);
    expect(fetcher.mock.calls.some(([url]) => url === files[0].source)).toBe(false);
  });

  it.each(["short", "long", "hash", "html", "http"])("never caches an invalid %s response or marks it ready", async (failure) => {
    const { downloads, fetcher, data, assetProvider } = setup();
    const body = assetProvider("piper-fr_FR-siwis-medium")[0].body;
    if (failure === "short") fetcher.mockResolvedValueOnce(new Response(body.slice(1)));
    if (failure === "long") fetcher.mockResolvedValueOnce(new Response(new Uint8Array(body.length + 1)));
    if (failure === "hash") fetcher.mockResolvedValueOnce(new Response(new Uint8Array(body.length)));
    if (failure === "html") fetcher.mockResolvedValueOnce(new Response("<html>Service unavailable</html>"));
    if (failure === "http") fetcher.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(downloads.download("piper-fr_FR-siwis-medium")).rejects.toMatchObject({ code: failure === "http" ? "HTTP" : "INTEGRITY" });
    expect(data.size).toBe(0);
    expect((await downloads.status("piper-fr_FR-siwis-medium")).ready).toBe(false);
  });

  it("detects browser cache eviction and repairs only the missing file", async () => {
    const { downloads, fetcher, data, assetProvider } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    const model = assetProvider("piper-fr_FR-siwis-medium").at(-1);
    data.delete(model.url);
    expect(await downloads.status("piper-fr_FR-siwis-medium")).toMatchObject({ ready: false, downloadBytes: model.bytes });
    fetcher.mockClear();
    await downloads.download("piper-fr_FR-siwis-medium");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(model.source);
  });

  it("does not trust an unverified cached response with the right byte length", async () => {
    const { downloads, data, assetProvider } = setup();
    const file = assetProvider("piper-fr_FR-siwis-medium")[0];
    data.set(file.url, new Response(file.body, { headers: { "Content-Length": file.bytes } }));
    expect((await downloads.status("piper-fr_FR-siwis-medium")).storedBytes).toBe(0);
  });

  it("checks available storage before downloading and maps quota failures during writes", async () => {
    const low = setup({ estimate: vi.fn(async () => ({ quota: 100, usage: 99 })) });
    await expect(low.downloads.download("piper-fr_FR-siwis-medium")).rejects.toMatchObject({ code: "STORAGE_FULL", availableBytes: 1 });
    expect(low.fetcher).not.toHaveBeenCalled();
    const full = setup({ cacheError: new DOMException("Full", "QuotaExceededError") });
    await expect(full.downloads.download("piper-fr_FR-siwis-medium")).rejects.toMatchObject({ code: "STORAGE_FULL" });
    expect((await full.downloads.status("piper-fr_FR-siwis-medium")).ready).toBe(false);
  });

  it("continues when a browser cannot estimate quota, but surfaces unavailable Cache API", async () => {
    const { downloads } = setup({ estimate: vi.fn(async () => { throw new Error("Unavailable"); }) });
    expect((await downloads.download("piper-fr_FR-siwis-medium")).ready).toBe(true);
    const unavailable = createVoiceDownloads({ cacheStorage: null });
    await expect(unavailable.status("piper-fr_FR-siwis-medium")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("removes one voice without breaking another, then releases remaining shared files", async () => {
    const { downloads, data } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    await downloads.download("piper-en_US-ljspeech-medium");
    expect((await downloads.removeVoice("piper-fr_FR-siwis-medium")).ready).toBe(false);
    expect((await downloads.status("piper-en_US-ljspeech-medium")).ready).toBe(true);
    expect([...data.keys()].some(url => url.includes("fr_FR-siwis-medium"))).toBe(false);
    expect([...data.keys()].some(url => url.includes("phonemizer.data"))).toBe(true);
    expect([...data.keys()].some(url => url.includes("en_US-ljspeech-medium/model.onnx"))).toBe(true);
    await downloads.remove("piper-en_US-ljspeech-medium");
    expect(data.size).toBe(0);
  });

  it("keeps shared files for another language even if only its configuration is downloaded", async () => {
    const { downloads, data, assetProvider, fetcher } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    const config = assetProvider("piper-es_ES-davefx-medium").find(file => file.file.endsWith("config.json"));
    data.set(config.url, new Response(config.body, { headers: { "Content-Length": String(config.bytes), "X-Fastreader-Voice-SHA256": config.sha256 } }));
    await downloads.removeVoice("piper-fr_FR-siwis-medium");
    expect([...data.keys()]).toContain(config.url);
    const model = assetProvider("piper-es_ES-davefx-medium").at(-1);
    expect(await downloads.status("piper-es_ES-davefx-medium")).toMatchObject({ ready: false, downloadBytes: model.bytes });
    fetcher.mockClear();
    await downloads.download("piper-es_ES-davefx-medium");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(model.source, expect.any(Object));
  });

  it("does not create or delete an old runtime cache merely by inspecting its size", async () => {
    const { downloads, cacheStorage } = setup();
    expect(await downloads.legacyStatus()).toEqual({ storedBytes: 0 });
    expect(cacheStorage.open).not.toHaveBeenCalled();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
  });

  it("reports and removes only this deployment's previous engine while preserving current voices", async () => {
    const { downloads, cacheStorage, stores, fetcher } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    const previous = await cacheStorage.open(LEGACY_VOICE_CACHE_NAME);
    const own = "https://reader.example/app/voice-runtime/v1/models/kokoro/model.onnx";
    const sibling = "https://reader.example/another-app/voice-runtime/v1/worker.js";
    const foreign = "https://another.example/app/voice-runtime/v1/worker.js";
    await previous.put(own, new Response("old model", { headers: { "Content-Length": "90000000" } }));
    await previous.put(sibling, new Response("sibling", { headers: { "Content-Length": "500" } }));
    await previous.put(foreign, new Response("foreign", { headers: { "Content-Length": "700" } }));
    expect(await downloads.legacyStatus()).toEqual({ storedBytes: 90000000 });
    expect(stores.get(LEGACY_VOICE_CACHE_NAME).has(own)).toBe(true);
    fetcher.mockClear();
    expect(await downloads.removeLegacy()).toEqual({ storedBytes: 0 });
    expect(await downloads.legacyStatus()).toEqual({ storedBytes: 0 });
    expect([...stores.get(LEGACY_VOICE_CACHE_NAME).keys()]).toEqual([sibling, foreign]);
    expect((await downloads.status("piper-fr_FR-siwis-medium")).ready).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
  });

  it("clears this deployment's voices without touching the book database or sibling deployments", async () => {
    const { downloads, cacheStorage, data, stores } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    const other = "https://reader.example/another-app/voice-runtime/v2/worker.js";
    data.set(other, new Response("Another deployment"));
    const previous = await cacheStorage.open(LEGACY_VOICE_CACHE_NAME);
    const previousOther = "https://reader.example/another-app/voice-runtime/v1/worker.js";
    await previous.put("https://reader.example/app/voice-runtime/v1/worker.js", new Response("Old runtime"));
    await previous.put(previousOther, new Response("Another old runtime"));
    await downloads.clearAll();
    expect(cacheStorage.delete).not.toHaveBeenCalled();
    expect([...data.keys()]).toEqual([other]);
    expect([...stores.get(LEGACY_VOICE_CACHE_NAME).keys()]).toEqual([previousOther]);
    expect((await downloads.status("piper-fr_FR-siwis-medium")).storedBytes).toBe(0);
  });

  it("prevents a new download while files are being removed", async () => {
    const { downloads } = setup();
    await downloads.download("piper-fr_FR-siwis-medium");
    const removal = downloads.removeVoice("piper-fr_FR-siwis-medium");
    await expect(downloads.download("piper-en_US-ljspeech-medium")).rejects.toMatchObject({ code: "BUSY" });
    await removal;
    const clearing = downloads.clearAll();
    await expect(downloads.download("piper-fr_FR-siwis-medium")).rejects.toMatchObject({ code: "BUSY" });
    await clearing;
    expect((await downloads.download("piper-fr_FR-siwis-medium")).ready).toBe(true);
  });

  it("rejects unknown voices, pre-aborted requests and concurrent mutations", async () => {
    const { downloads } = setup();
    await expect(downloads.download("unsupported")).rejects.toMatchObject({ code: "UNSUPPORTED_VOICE" });
    await expect(downloads.download("ff_siwis")).rejects.toMatchObject({ code: "UNSUPPORTED_VOICE" });
    const controller = new AbortController();
    controller.abort();
    await expect(downloads.download("piper-fr_FR-siwis-medium", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const first = downloads.download("piper-fr_FR-siwis-medium");
    await expect(downloads.download("piper-en_US-ljspeech-medium")).rejects.toMatchObject({ code: "BUSY" });
    await expect(downloads.clearAll()).rejects.toMatchObject({ code: "BUSY" });
    await expect(downloads.removeVoice("piper-en_US-ljspeech-medium")).rejects.toMatchObject({ code: "BUSY" });
    await expect(downloads.removeLegacy()).rejects.toMatchObject({ code: "BUSY" });
    expect((await first).ready).toBe(true);
  });
});
