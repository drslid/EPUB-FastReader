# Optional local speech components

FastReader's Piper Medium voices are downloaded only after the reader requests
a voice. Book text and generated audio stay on the device; there is no TTS API.
The reader application, speech runtime, and each model have distinct licences.

| Component | Pinned version | Licence / source |
| --- | --- | --- |
| Piper Medium voice models | `rhasspy/piper-voices` revision `1162a9173d0ce503555aed757976b7a9912eae4c` | Individual model cards and training-data notices; see the voice table below |
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

The application deliberately exposes one Medium voice per supported book
language, rather than the whole upstream catalogue. Model quality, pronunciation,
CPU use and memory consumption vary by language and device. French Siwis Medium
was selected after comparative Chromium/WebKit CPU benchmarks; this is not a
claim of measured performance on every phone or of identical quality across voices.

To reproduce the optional runtime, run `npm ci` followed by
`npm run voice:prepare`. The build copies pinned browser binaries and obtains
checksum-verified source archives/model cards. **No voice model is downloaded by
the build.** Only an explicit reader action installs a model on their device.
