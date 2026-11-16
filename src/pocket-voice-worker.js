import { loadPocketTts, pocketError } from "./pocket-tts.js";
import { POCKET_VOICE } from "./pocket-voices.js";

const ROOT = new URL("./", import.meta.url);
const CACHE_NAME = "fastreader-voice-v2";
const MODEL_ROOT = new URL(`models/${POCKET_VOICE.modelKey}/`, ROOT);
const files = new Map(POCKET_VOICE.assets.map(asset => [asset.file, asset.bytes]));
const getCache = () => caches.open(CACHE_NAME);

// Only explicit installation may fetch speech assets. Generation stays in Cache Storage.
self.fetch = async input => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, ROOT);
  if (!url.href.startsWith(ROOT.href))
    throw pocketError("External speech request blocked", "VOICE_NOT_INSTALLED");
  const cache = await getCache();
  return (await cache.match(url.href, { ignoreVary: true })) ||
    new Response("Voice asset not installed", { status: 404 });
};
self.XMLHttpRequest = class {
  constructor() { throw pocketError("Speech network fallback blocked", "VOICE_NOT_INSTALLED"); }
};

async function getAsset(file) {
  const bytes = files.get(file);
  if (!bytes) throw pocketError("Unsupported Pocket TTS asset", "VOICE_NOT_INSTALLED");
  const response = await fetch(new URL(file, MODEL_ROOT));
  if (!response.ok) throw pocketError("Pocket voice not installed", "VOICE_NOT_INSTALLED");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== bytes) throw pocketError("Invalid Pocket TTS asset", "VOICE_NOT_INSTALLED");
  return buffer;
}

let model;
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const progress = value => self.postMessage({ id: data.id, type: "progress", progress: value });
    try {
      if (data.voice?.id !== POCKET_VOICE.id)
        throw pocketError("Unsupported voice", "VOICE_UNSUPPORTED");
      if (data.type !== "load" && data.type !== "synthesize")
        throw pocketError("Unsupported worker message");
      if (!model) {
        model = await loadPocketTts({
          getAsset,
          runtimeUrl: ROOT,
          resume: component => progress({ stage: "loading", status: "loading", component }),
        });
        progress({ stage: "ready", status: "ready", component: "voice", wasmThreads: 1 });
      }

      if (data.type === "load") self.postMessage({ id: data.id, result: { ready: true } });
      else {
        const result = await model.synthesize(data.text, progress);
        self.postMessage({ id: data.id, result }, [result.wav]);
      }
    } catch (error) {
      self.postMessage({
        id: data.id,
        error: { message: error?.message || String(error), code: error?.code || "VOICE_FAILED" },
      });
    }
  });
};
