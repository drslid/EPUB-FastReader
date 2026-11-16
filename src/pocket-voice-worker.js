import { loadPocketTts, pocketError } from "./pocket-tts.js";
import { pocketVoiceForId } from "./pocket-voices.js";
import { createPocketDecoderPeer } from "./pocket-decoder-client.js";
import { createPocketAssetReader, installPocketCacheFetch, pocketRuntimeUrl } from "./pocket-runtime-cache.js";

installPocketCacheFetch();

let model;
let activeVoiceId;
let queue = Promise.resolve();

function canOverlapDecoder(voice) {
  // The worker owns only Mimi. It never loads a second copy of the speech model.
  // Keep the portable path when the browser cannot establish memory headroom.
  if (typeof Worker !== "function" || navigator.hardwareConcurrency < 4 || !(navigator.deviceMemory >= 4))
    return false;
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/iu.test(navigator.userAgent);
  // The multilingual export uses fixed-capacity attention caches.
  return !voice.presetFile || !mobile;
}

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, type, voice: requestedVoice, text } = data ?? {};
    const progress = value => self.postMessage({ id, type: "progress", progress: value });
    try {
      const voice = pocketVoiceForId(requestedVoice?.id);
      if (!voice) throw pocketError("Unsupported voice", "VOICE_UNSUPPORTED");
      if (type !== "load" && type !== "synthesize")
        throw pocketError("Unsupported worker message");
      if (!model || activeVoiceId !== voice.id) {
        const previous = model;
        model = undefined;
        activeVoiceId = undefined;
        await previous?.dispose();
        model = await loadPocketTts({
          getAsset: createPocketAssetReader(voice),
          runtimeUrl: pocketRuntimeUrl,
          bundleFile: voice.config.file,
          presetFile: voice.presetFile,
          createDecoderPeer: canOverlapDecoder(voice)
            ? () => createPocketDecoderPeer({ runtimeUrl: pocketRuntimeUrl, voiceId: voice.id }) : undefined,
          resume: component => progress({ stage: "loading", status: "loading", component }),
        });
        activeVoiceId = voice.id;
        progress({ stage: "ready", status: "ready", component: "voice", wasmThreads: 1 });
      }

      if (type === "load") self.postMessage({ id, result: { ready: true, decoderMode: model.decoderMode } });
      else {
        const result = await model.synthesize(text, progress);
        self.postMessage({ id, result: { ...result, decoderMode: model.decoderMode } }, [result.wav]);
      }
    } catch (error) {
      self.postMessage({
        id,
        error: { message: error?.message || String(error), code: error?.code || "VOICE_FAILED" },
      });
    }
  });
};
