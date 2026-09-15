import { assetsForVoice, voiceBaseUrl, voiceForId, VOICES, VOICE_CACHE_NAME, VOICE_RUNTIME_PATH, LEGACY_VOICE_CACHE_NAME, LEGACY_VOICE_RUNTIME_PATH } from "./voice-assets.js";

const HASH_HEADER = "X-Fastreader-Voice-SHA256";

export class VoiceDownloadError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "VoiceDownloadError";
    this.code = code;
    Object.assign(this, options.details);
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Voice download cancelled", "AbortError");
}

function storageError(error) {
  if (error instanceof VoiceDownloadError) return error;
  const full = error?.name === "QuotaExceededError";
  return new VoiceDownloadError(full ? "STORAGE_FULL" : "STORAGE_UNAVAILABLE", full ? "Not enough device storage" : "Voice storage is unavailable", { cause: error });
}

function validCachedResponse(response, asset) {
  return response?.ok && response.headers.get(HASH_HEADER) === asset.sha256 && Number(response.headers.get("Content-Length")) === asset.bytes;
}

/** Download voice files only after an explicit user action. No text leaves the device. */
export function createVoiceDownloads({
  baseUrl,
  cacheStorage = globalThis.caches,
  fetcher = globalThis.fetch?.bind(globalThis),
  navigator = globalThis.navigator,
  crypto = globalThis.crypto,
  assetProvider = assetsForVoice,
} = {}) {
  let active = false;

  function assets(voiceId) {
    if (!voiceForId(voiceId)) throw new VoiceDownloadError("UNSUPPORTED_VOICE", "This voice is not supported");
    return assetProvider(voiceId, baseUrl);
  }

  async function openCache() {
    if (!cacheStorage?.open) throw new VoiceDownloadError("STORAGE_UNAVAILABLE", "Voice storage is unavailable");
    try { return await cacheStorage.open(VOICE_CACHE_NAME); }
    catch (error) { throw storageError(error); }
  }

  async function inspect(voiceId, cache, match = url => cache.match(url)) {
    const all = assets(voiceId);
    const missing = [];
    let storedBytes = 0;
    try {
      for (const asset of all) {
        if (validCachedResponse(await match(asset.url), asset)) storedBytes += asset.bytes;
        else missing.push(asset);
      }
    } catch (error) { throw storageError(error); }
    const totalBytes = all.reduce((sum, asset) => sum + asset.bytes, 0);
    const downloadBytes = totalBytes - storedBytes;
    return { missing, status: { voiceId, ready: missing.length === 0, state: missing.length ? "missing" : "ready", downloadBytes, bytesRemaining: downloadBytes, totalBytes, storedBytes } };
  }

  async function status(voiceId) {
    assets(voiceId);
    return (await inspect(voiceId, await openCache())).status;
  }

  async function list() {
    const cache = await openCache();
    // Shared runtime headers need one storage read per refresh, not one per
    // language. Keep this snapshot local so the next refresh detects eviction.
    const responses = new Map();
    const match = url => {
      if (!responses.has(url)) responses.set(url, cache.match(url));
      return responses.get(url);
    };
    return Promise.all(VOICES.map(async (voice) => (await inspect(voice.id, cache, match)).status));
  }

  async function checkStorage(bytes) {
    if (!navigator?.storage?.estimate) return;
    let estimate;
    try { estimate = await navigator.storage.estimate(); }
    catch { return; } // Unknown quota is not proof that a download will fail.
    const { quota, usage } = estimate || {};
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) return;
    const requiredBytes = Math.ceil(bytes * 1.1) + 2 * 1024 * 1024;
    if (quota - usage < requiredBytes) {
      throw new VoiceDownloadError("STORAGE_FULL", "Not enough device storage", { details: { requiredBytes, availableBytes: Math.max(0, quota - usage) } });
    }
  }

  async function downloadAsset(asset, cache, signal, progress) {
    throwIfAborted(signal);
    let response;
    try {
      response = await fetcher(asset.source, { signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    } catch (error) {
      throwIfAborted(signal);
      throw new VoiceDownloadError(navigator?.onLine === false ? "OFFLINE" : "NETWORK", "Voice download failed", { cause: error });
    }
    if (!response.ok || response.type === "opaque") {
      throw new VoiceDownloadError("HTTP", "Voice file is unavailable", { details: { status: response.status, file: asset.file } });
    }
    const chunks = [];
    let received = 0;
    const append = (chunk) => {
      received += chunk.byteLength;
      if (received > asset.bytes) throw new VoiceDownloadError("INTEGRITY", "Voice file has an unexpected size", { details: { file: asset.file } });
      chunks.push(chunk);
      progress(received);
    };
    const reader = response.body?.getReader();
    const abortReader = () => { reader?.cancel().catch(() => {}); };
    signal?.addEventListener("abort", abortReader, { once: true });
    try {
      if (reader) {
        while (true) {
          throwIfAborted(signal);
          const { done, value } = await reader.read();
          throwIfAborted(signal);
          if (done) break;
          append(value);
        }
      } else append(new Uint8Array(await response.arrayBuffer()));
      throwIfAborted(signal);
    } catch (error) {
      await reader?.cancel().catch(() => {});
      throwIfAborted(signal);
      if (error instanceof VoiceDownloadError) throw error;
      throw new VoiceDownloadError(navigator?.onLine === false ? "OFFLINE" : "NETWORK", "Voice download was interrupted", { cause: error });
    } finally {
      signal?.removeEventListener("abort", abortReader);
      reader?.releaseLock();
    }
    if (received !== asset.bytes) throw new VoiceDownloadError("INTEGRITY", "Voice file is incomplete", { details: { file: asset.file } });
    const blob = new Blob(chunks, { type: response.headers.get("Content-Type") || "application/octet-stream" });
    chunks.length = 0;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.sha256) throw new VoiceDownloadError("INTEGRITY", "Voice file verification failed", { details: { file: asset.file } });
    throwIfAborted(signal);
    // Cache.put commits a complete, verified response. Partial streams are never reusable.
    try {
      await cache.put(asset.url, new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(received), [HASH_HEADER]: hash } }));
    } catch (error) { throw storageError(error); }
    throwIfAborted(signal);
  }

  async function download(voiceId, { signal, onProgress = () => {} } = {}) {
    assets(voiceId);
    throwIfAborted(signal);
    if (active) throw new VoiceDownloadError("BUSY", "Another voice download is running");
    active = true;
    try {
      const cache = await openCache();
      const { missing, status: initial } = await inspect(voiceId, cache);
      if (!missing.length) return initial;
      if (navigator?.onLine === false) throw new VoiceDownloadError("OFFLINE", "Connect to the internet to download this voice");
      if (!crypto?.subtle || !fetcher) throw new VoiceDownloadError("BROWSER_UNSUPPORTED", "This browser cannot download verified voice files");
      await checkStorage(initial.downloadBytes);
      throwIfAborted(signal);
      let completed = 0;
      const notify = (loadedBytes, file, verified = false) => onProgress({ voiceId, loadedBytes, totalBytes: initial.downloadBytes, percent: verified ? 100 : Math.min(99, Math.floor(100 * loadedBytes / initial.downloadBytes)), file });
      notify(0);
      for (const asset of missing) {
        await downloadAsset(asset, cache, signal, (received) => notify(completed + received, asset.file));
        completed += asset.bytes;
      }
      const result = (await inspect(voiceId, cache)).status;
      if (!result.ready) throw new VoiceDownloadError("STORAGE_UNAVAILABLE", "Some voice files could not be retained");
      notify(initial.downloadBytes, undefined, true);
      return result;
    } finally { active = false; }
  }

  async function removeVoice(voiceId) {
    const ownAssets = assets(voiceId);
    if (active) throw new VoiceDownloadError("BUSY", "A voice download is running");
    active = true;
    try {
      const cache = await openCache();
      // Retain all files useful to another installed (even partially downloaded) voice.
      const retained = new Set();
      for (const voice of VOICES) {
        if (voice.id === voiceId) continue;
        const otherAssets = assets(voice.id);
        let installed = false;
        for (const asset of otherAssets.filter(asset => asset.voiceId === voice.id)) {
          if (validCachedResponse(await cache.match(asset.url), asset)) { installed = true; break; }
        }
        if (installed) {
          for (const asset of otherAssets) retained.add(asset.url);
        }
      }
      // Shared runtime and pronunciation data remain while another voice needs them.
      for (const asset of ownAssets) {
        if (!retained.has(asset.url)) await cache.delete(asset.url);
      }
      return (await inspect(voiceId, cache)).status;
    } catch (error) { throw storageError(error); }
    finally { active = false; }
  }

  async function clearAll() {
    if (active) throw new VoiceDownloadError("BUSY", "A voice download is running");
    active = true;
    try {
      const cache = await openCache();
      const prefix = new URL(VOICE_RUNTIME_PATH, voiceBaseUrl(baseUrl)).href;
      // GitHub Pages applications can share an origin. Delete this deployment's
      // files, preserving voices installed by a sibling FastReader deployment.
      for (const request of await cache.keys()) {
        if (request.url.startsWith(prefix)) await cache.delete(request);
      }
      await removeLegacyFiles();
    }
    catch (error) { throw storageError(error); }
    finally { active = false; }
  }

  async function legacyStatus() {
    try {
      if (!cacheStorage?.keys || !(await cacheStorage.keys()).includes(LEGACY_VOICE_CACHE_NAME)) return { storedBytes: 0 };
      const cache = await cacheStorage.open(LEGACY_VOICE_CACHE_NAME);
      const prefix = new URL(LEGACY_VOICE_RUNTIME_PATH, voiceBaseUrl(baseUrl)).href;
      let storedBytes = 0;
      for (const request of await cache.keys()) {
        if (!request.url.startsWith(prefix)) continue;
        const response = await cache.match(request.url);
        const size = Number(response?.headers.get("Content-Length"));
        if (Number.isFinite(size) && size > 0) storedBytes += size;
      }
      return { storedBytes };
    } catch (error) { throw storageError(error); }
  }

  async function removeLegacyFiles() {
    if (!cacheStorage?.keys || !(await cacheStorage.keys()).includes(LEGACY_VOICE_CACHE_NAME)) return;
    const cache = await cacheStorage.open(LEGACY_VOICE_CACHE_NAME);
    const prefix = new URL(LEGACY_VOICE_RUNTIME_PATH, voiceBaseUrl(baseUrl)).href;
    for (const request of await cache.keys()) {
      if (request.url.startsWith(prefix)) await cache.delete(request);
    }
  }

  async function removeLegacy() {
    if (active) throw new VoiceDownloadError("BUSY", "A voice download is running");
    active = true;
    try { await removeLegacyFiles(); return { storedBytes: 0 }; }
    catch (error) { throw storageError(error); }
    finally { active = false; }
  }

  return { status, list, download, ensure: download, removeVoice, remove: removeVoice, clearAll, legacyStatus, removeLegacy };
}
