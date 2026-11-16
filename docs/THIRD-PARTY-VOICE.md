# Optional local speech components

FastReader downloads Piper Medium and Pocket TTS voices when requested by the
reader. Book text and generated audio stay on the device.
The reader application, speech runtime, and each model have distinct licences.

| Component | Pinned version | Licence / source |
| --- | --- | --- |
| Piper Medium voice models | `rhasspy/piper-voices` revision `1162a9173d0ce503555aed757976b7a9912eae4c` | Individual model cards and training-data notices; see the voice table below |
| Pocket TTS French INT8 | `Vincweb/pocket-tts-french-onnx` revision `84541283b060685dbc7f9f9d8066f4b00235820c` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), Pocket TTS by Kyutai, converted to ONNX and quantized by Vincweb. See the Estelle attribution below. |
| Pocket TTS English INT8 | [`Vincweb/pocket-tts-english-onnx`](https://huggingface.co/Vincweb/pocket-tts-english-onnx/tree/c7cd567b25ddd2b7c1646256e9eb3ab50a342a27) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), Pocket TTS by Kyutai, converted to ONNX and quantized by Vincweb. |
| Pocket TTS Spanish, Italian, German and Portuguese INT8 | [`Alias-Alias/pocket-3-3-0-tts-onnx`](https://huggingface.co/Alias-Alias/pocket-3-3-0-tts-onnx/tree/71a4d6d11a76e26b98709fa163477c77d16bdbdb) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), Pocket TTS by Kyutai, converted to ONNX and quantized by Alias-Alias. |
| ONNX Runtime Web | `1.22.0-dev.20250409-89f8206ba4` | MIT; [source](https://github.com/microsoft/onnxruntime/tree/89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0) |
| Piper phonemizer browser binaries | `@diffusionstudio/piper-wasm` 1.0.0 | Package wrapper declares MIT; embedded eSpeak NG is GPL-3.0-or-later; [source/build recipe](https://github.com/diffusion-studio/piper-wasm/tree/69522c832bd52d7c16389e9a8aee568065027689) |
| Piper phonemizer ES module | `@mintplex-labs/piper-tts-web` 1.0.5 | Package wrapper declares MIT; embedded eSpeak NG is GPL-3.0-or-later; only the standalone Emscripten wrapper is used |
| Piper phonemizer C++ | `cfff8e52ebaea37c7e953ae2d06b174acb827ac4` | MIT; [source](https://github.com/wide-video/piper-phonemize/tree/cfff8e52ebaea37c7e953ae2d06b174acb827ac4) |
| eSpeak NG | WASM source `0f65aa301e0d6bae5e172cc74197d32a6182200f`; native-data source `8593723f10cfd9befd50de447f14bf0a9d2a14a4` | GPL-3.0-or-later; [source](https://github.com/rhasspy/espeak-ng) |
| FastReader standalone worker and phoneme mapper | `src/voice-worker.js`, `src/piper-phoneme-map.js` | GPL-3.0-or-later, FastReader contributors |

The worker is distributed as readable source at `voice-runtime/v2/worker.js`,
with its readable phoneme mapper and voice metadata next to it. It communicates
with the MIT reader application through messages. Piper phonemizer JavaScript,
WASM and data are copied unchanged. ONNX Runtime uses the exact version measured
in the comparative benchmark; inference is CPU/WASM, with no cloud fallback.

Complete eSpeak/Piper source archives, original build instructions and licence
texts are hosted under `voice-runtime/v2/licenses/`. See `PIPER-BUILD.md` there
for pinned revisions, dependencies and rebuild instructions. Sources and
licences are not part of the initial offline cache or required voice download.

## Selected voices and attribution

Each model/config is pinned by revision, file size and SHA-256 in
`src/piper-voices.js`. The six original model cards are copied unchanged into
`voice-runtime/v2/licenses/voices/<model-key>-MODEL_CARD`. Dataset licences are
recorded per voice; the Hugging Face repository badge is not treated as a blanket
licence for every model.

| Language | Voice / model key | Dataset notice and attribution |
| --- | --- | --- |
| French | Siwis / `fr_FR-siwis-medium` | CC-BY-4.0; SIWIS French Speech Synthesis Database (2017), Junichi Yamagishi, Pierre-Edouard Honnet, Philip Garner and Alexandros Lazaridis, University of Edinburgh; Piper contributors |
| English (US) | LJ Speech / `en_US-ljspeech-medium` | Public-domain LJ Speech dataset by Keith Ito and Linda Johnson; model contributed by Bryce Beattie, trained from scratch according to its model card |
| Spanish (Spain) | Davefx / `es_ES-davefx-medium` | CC0-1.0; Davefx and Piper/Open Home Foundation voice-dataset contributors |
| Italian | Paola / `it_IT-paola-medium` | CC0-1.0; Paola Persico, Voice-Dataset-Italian, and Piper contributors |
| German | Thorsten / `de_DE-thorsten-medium` | CC0-1.0; Thorsten Müller, Dominik Kreutz and Piper contributors |
| Portuguese (Brazil) | Faber / `pt_BR-faber-medium` | CC0-1.0; Faber and Piper/Open Home Foundation voice-dataset contributors |

FastReader offers one Piper Medium and one Pocket TTS voice per supported book
language. Model quality, pronunciation, CPU use and
memory consumption vary by language and device. French Siwis Medium was selected
after comparative Chromium/WebKit CPU benchmarks.

### French Pocket TTS voice Estelle

Pocket TTS by Kyutai uses the [French six-layer weights at revision
`1e08e6a23401048648a9fdcfde2f89348215c2a7`](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/1e08e6a23401048648a9fdcfde2f89348215c2a7/languages/french).
Vincweb adapted the weights into [three quantized ONNX graphs, text embeddings
and a voice preset](https://huggingface.co/Vincweb/pocket-tts-french-onnx/tree/84541283b060685dbc7f9f9d8066f4b00235820c).
The model and its quantized adaptation are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The preset comes from Kyutai's precomputed Estelle embedding at the same
upstream model revision. Its source recording is Kyutai's
[`developpeuse-3.wav`](https://huggingface.co/kyutai/tts-voices/blob/main/unmute-prod-website/developpeuse-3.wav)
at recording revision `1fc7395b7e012e2bbebfca14b942a4ef62ccc899`, released
under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
See [Kyutai's voice collection](https://huggingface.co/kyutai/tts-voices#unmute-prod-website).

`src/pocket-voices.js` records the revision, size and SHA-256 of all seven model
assets. Together they total 120,948,003 bytes. The installer fetches these
public files from Hugging Face and verifies them before saving them locally.
The Pocket worker shares ONNX Runtime Web with Piper and synthesizes audio
locally using the fixed Estelle preset.

### Other Pocket TTS voices

The English preset **Alba** comes with the Vincweb export. Its source recording
is [Alba McKenna’s casual sample](https://huggingface.co/kyutai/tts-voices/blob/main/alba-mackenna/casual.wav)
from Kyutai’s voice collection, released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

For Spanish **Lola**, Italian **Giovanni**, German **Jürgen** and Portuguese
**Rafael**, FastReader combines the Alias-Alias quantized ONNX graphs with the
corresponding [individual voice presets published by Kyutai](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/4e1e0a3e611c51c0b4ed8174fc10f32a54644303/languages)
under CC BY 4.0. [Kyutai’s source maps each preset to its source recording](https://github.com/kyutai-labs/pocket-tts/blob/3dbee45d343d7dddd0d105468d17f8dcba14db3e/pocket_tts/utils/utils.py#L519-L534).
FastReader downloads the selected preset individually. The complete speaker
bank and the raw source recordings are unnecessary for synthesis.

To reproduce the optional runtime, run `npm ci` followed by
`npm run voice:prepare`. The build copies pinned browser binaries and obtains
checksum-verified source archives/model cards. **No voice model is downloaded by
the build.** Only an explicit reader action installs a model on their device.
