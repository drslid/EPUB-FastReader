# Piper phonemizer: distributed source and build inputs

The optional speech runtime contains the original `piper_phonemize.wasm` and
`piper_phonemize.data` from `@diffusionstudio/piper-wasm@1.0.0`. The standalone
ES module `phonemizer.mjs` is copied unchanged from
`@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js`.
All three binary/module hashes are enforced by `scripts/prepare-voice-runtime.mjs`.
The Emscripten module is already distributed as readable JavaScript.

The complete sources and upstream build recipe are served beside this document:

| Archive | Revision / purpose |
| --- | --- |
| `piper-wasm-source.tar.gz` | diffusion-studio/piper-wasm `69522c832bd52d7c16389e9a8aee568065027689`; original build recipe in `README.md`, original generated JS/WASM/data |
| `piper-phonemize-source.tar.gz` | wide-video/piper-phonemize `cfff8e52ebaea37c7e953ae2d06b174acb827ac4`; phonemizer, complete phoneme/ID map, CLI, CMake configuration |
| `espeak-ng-wasm-source.tar.gz` | rhasspy/espeak-ng `0f65aa301e0d6bae5e172cc74197d32a6182200f`; exact dependency pinned by the phonemizer's `CMakeLists.txt` |
| `espeak-ng-data-source.tar.gz` | rhasspy/espeak-ng `8593723f10cfd9befd50de447f14bf0a9d2a14a4`; native data build source, the upstream head when the package was published |
| `piper-tts-web-1.0.5.tgz` | Complete original npm package, including the unchanged readable Emscripten wrapper and package licence declaration |

Archive hashes and upstream URLs are recorded in `source-manifest.json`. They
are downloaded and checked at application build time, then hosted directly
with FastReader. They are not downloaded onto a reader's phone by voice setup.

To rebuild the phonemizer, follow the complete `README.md` recipe inside
`piper-wasm-source.tar.gz`. Its required compiler is **Emscripten 3.1.47**. Use the
supplied pinned source archives instead of its unpinned `git clone` commands:

1. Unpack the native-data eSpeak source into `/wasm/modules/espeak-ng`. Run
   `./autogen.sh`, `./configure`, and `make` as in the upstream recipe.
2. Unpack the Piper phonemizer source into `/wasm/modules/piper-phonemize`.
3. Its CMake file pins the WASM eSpeak dependency to revision `0f65aa30...`.
   The same complete dependency source is available in
   `espeak-ng-wasm-source.tar.gz`; CMake's archive URL can be replaced with a
   `file:///.../espeak-ng-wasm-source.tar.gz` URL to build without fetching it.
4. Apply the Emscripten `wchar.h` compatibility edit, configure CMake with the
   flags from the upstream recipe, and apply its two generated-makefile and
   `speechWaveGenerator.cpp` edits before rerunning the release build.
5. The resulting `piper_phonemize.js`, `.wasm` and `.data` are in the phonemizer
   build directory. The npm package's JS wrapper is a separately bundled ES
   module around this Emscripten output; FastReader copies that module unchanged.

These are the upstream's source and build instructions, not a claim of a
byte-for-byte rebuild with an arbitrary modern compiler. FastReader's normal
runtime preparation is reproducible from the pinned npm lockfile and the
checksum-pinned artifacts above, and rejects altered binaries.

FastReader's GPL standalone integration sources are also served unchanged at
`../worker.js` and `../piper-phoneme-map.js`; the selected model metadata is in
`../piper-voices.js`. Inference runs in ONNX Runtime Web, pinned separately to
`1.22.0-dev.20250409-89f8206ba4` (MIT).
