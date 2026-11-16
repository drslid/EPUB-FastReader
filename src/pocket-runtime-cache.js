export const pocketRuntimeUrl = new URL("./", import.meta.url);
const unavailable = message => Object.assign(new Error(message), { code: "VOICE_NOT_INSTALLED" });

export function installPocketCacheFetch() {
  // Only explicit installation may fetch speech assets.
  self.fetch = async input => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, pocketRuntimeUrl);
    if (!url.href.startsWith(pocketRuntimeUrl.href)) throw unavailable("External speech request blocked");
    const cache = await caches.open("fastreader-voice-v2");
    return (await cache.match(url.href, { ignoreVary: true })) ||
      new Response("Voice asset not installed", { status: 404 });
  };
  self.XMLHttpRequest = class {
    constructor() { throw unavailable("Speech network fallback blocked"); }
  };
}

export function createPocketAssetReader(voice) {
  const modelRoot = new URL(`models/${voice.modelKey}/`, pocketRuntimeUrl);
  const files = new Map(voice.assets.map(asset => [asset.file, asset.bytes]));
  return async file => {
    const bytes = files.get(file);
    if (!bytes) throw unavailable("Unsupported Pocket TTS asset");
    const response = await fetch(new URL(file, modelRoot));
    if (!response.ok) throw unavailable("Pocket voice not installed");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== bytes) throw unavailable("Invalid Pocket TTS asset");
    return buffer;
  };
}
