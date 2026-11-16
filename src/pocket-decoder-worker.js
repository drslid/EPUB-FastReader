import { loadPocketDecoder } from "./pocket-decoder.js";
import { pocketVoiceForId } from "./pocket-voices.js";
import { createPocketAssetReader, installPocketCacheFetch, pocketRuntimeUrl } from "./pocket-runtime-cache.js";

installPocketCacheFetch();

let decoder;
let activeVoiceId;
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, type, latents, voiceId } = data ?? {};
    try {
      if (type === "init") {
        const voice = pocketVoiceForId(voiceId);
        if (!voice || (decoder && activeVoiceId !== voice.id))
          throw new Error("Unsupported Pocket decoder voice");
        if (!decoder) {
          decoder = await loadPocketDecoder({
            getAsset: createPocketAssetReader(voice),
            runtimeUrl: pocketRuntimeUrl,
            bundleFile: voice.config.file,
          });
          activeVoiceId = voice.id;
        }
      } else {
        if (!decoder) throw new Error("Pocket decoder worker is uninitialized");
        if (type === "start") decoder.start();
        else if (type === "close") decoder.close();
        else if (type === "decode") {
          const result = await decoder.decode(latents);
          self.postMessage({ id, result }, [result.buffer]);
          return;
        } else throw new Error("Unsupported Pocket decoder worker message");
      }
      self.postMessage({ id });
    } catch (error) {
      self.postMessage({ id, error: error?.message || "Pocket decoder worker failed" });
    }
  });
};
