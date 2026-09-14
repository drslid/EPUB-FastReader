# Optional local speech components

FastReader's optional speech runtime is downloaded only when a reader requests
a voice. Book text is processed on the reader's device; there is no TTS API.
The application and downloaded models have distinct licences.

| Component | Pinned version | Licence / source |
| --- | --- | --- |
| Kokoro-82M v1.0 model and voice files | ONNX revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231` | Apache-2.0; [original model](https://huggingface.co/hexgrad/Kokoro-82M), [ONNX conversion](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231) |
| Transformers.js | 3.8.1 | Apache-2.0; [source](https://github.com/huggingface/transformers.js/tree/3.8.1) |
| ONNX Runtime Web (included by Transformers.js) | `1.22.0-dev.20250409-89f8206ba4` | MIT; [source](https://github.com/microsoft/onnxruntime/tree/89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0) |
| ephone / eSpeak NG | ephone 1.0.2, revision `4f6d246c1d3acf67a4d814e20da02fa3967bc92d` | GPL-3.0-or-later; [source and build scripts](https://github.com/sjmik/ephone-js/tree/4f6d246c1d3acf67a4d814e20da02fa3967bc92d) |
| FastReader standalone speech worker | `src/voice-worker.js` | GPL-3.0-or-later, copyright FastReader contributors |

The worker is distributed as unminified source at `voice-runtime/v1/worker.js`.
It communicates with the reader through messages and is separate from the MIT
reader application. ephone's generated JavaScript/WASM and language packs are
copied without modification. A complete, checksum-pinned archive of ephone's
corresponding source (including the modified eSpeak NG source and Emscripten
build scripts) is distributed alongside the runtime at
`voice-runtime/v1/licenses/ephone-1.0.2-source.tar.gz`. The upstream build
instructions are in that archive's `emscripten` directory. No source offer or
third-party download service is needed to obtain the source of the binaries we
distribute.

Licence texts are available in `docs/licenses/` and distributed under
`voice-runtime/v1/licenses/`. Source archives and licences are not part of the
app's initial offline cache or the required voice download.

To reproduce the optional runtime, install the pinned packages with `npm ci`
and run `npm run voice:prepare`. This copies the browser builds from those
packages and obtains the verified corresponding-source archive. No model is
downloaded by the build. The model and the selected voice are fetched from the
pinned model revision only after the user requests installation.

French uses eSpeak NG phonemization through ephone; this is an adaptation and
does not imply that official Kokoro.js supports these languages. Supported
voices are deliberately limited to the five entries in the application
catalogue. Voice quality and CPU/memory use vary by language and device.
