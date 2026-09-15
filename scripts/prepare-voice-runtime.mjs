import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PIPER_VOICES } from "../src/piper-voices.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "public/voice-runtime/v2");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const SOURCES = [
  {
    file: "phonemizer.mjs",
    url: "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js",
    bytes: 158217, sha256: "b5ac96981729547606fd026b8e3829aad81e9e3c22308869d50473259c563283",
  },
  {
    file: "piper-wasm-source.tar.gz",
    url: "https://codeload.github.com/diffusion-studio/piper-wasm/tar.gz/69522c832bd52d7c16389e9a8aee568065027689",
    bytes: 9236701, sha256: "482f1ace6a5ebce46c30e1a906daf9004fc6d16a760de647e1112273e1cdc27b",
  },
  {
    file: "piper-phonemize-source.tar.gz",
    url: "https://codeload.github.com/wide-video/piper-phonemize/tar.gz/cfff8e52ebaea37c7e953ae2d06b174acb827ac4",
    bytes: 9787575, sha256: "7029b52aabc2512d36f4d98c6ede732c48a0e7128d0cd0e62379dfcee770038e",
  },
  {
    file: "espeak-ng-wasm-source.tar.gz",
    url: "https://codeload.github.com/rhasspy/espeak-ng/tar.gz/0f65aa301e0d6bae5e172cc74197d32a6182200f",
    bytes: 16321475, sha256: "37ebbabb010200be8ec26c61b770e93f964f4503a329d7d74c239a1a40051e43",
  },
  {
    file: "espeak-ng-data-source.tar.gz",
    url: "https://codeload.github.com/rhasspy/espeak-ng/tar.gz/8593723f10cfd9befd50de447f14bf0a9d2a14a4",
    bytes: 16321829, sha256: "41c199da1355deec93eab6065be99d00b938dd452e78f282ab481db91657e4e4",
  },
  {
    file: "piper-tts-web-1.0.5.tgz",
    url: "https://registry.npmjs.org/@mintplex-labs/piper-tts-web/-/piper-tts-web-1.0.5.tgz",
    bytes: 101344, sha256: "b15c4b29bf958a93977e6eb950be186bd31cefe1a866a465ea5afde637246649",
  },
];

async function copy(source, target, expectedHash) {
  const destination = path.join(runtime, target);
  await mkdir(path.dirname(destination), { recursive: true });
  const data = await readFile(path.join(root, source));
  const hash = sha256(data);
  if (expectedHash && expectedHash !== hash) throw new Error(`Speech binary checksum mismatch: ${source}`);
  await writeFile(destination, data);
  return { file: target, bytes: data.byteLength, sha256: hash };
}

async function pinnedDownload(descriptor, target) {
  const cached = path.join(root, ".cache/piper-runtime-sources", descriptor.file);
  let data;
  try { data = await readFile(cached); } catch { /* First build. */ }
  if (!data || data.byteLength !== descriptor.bytes || sha256(data) !== descriptor.sha256) {
    const response = await fetch(descriptor.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Unable to obtain Piper runtime source: ${descriptor.file}, HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength !== descriptor.bytes || sha256(data) !== descriptor.sha256) {
      throw new Error(`Piper runtime source checksum mismatch: ${descriptor.file}`);
    }
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, data);
  }
  const destination = path.join(runtime, target);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
  return { file: target, bytes: descriptor.bytes, sha256: descriptor.sha256 };
}

/** Copy optional browser runtime and corresponding sources; never fetch models. */
export async function prepareVoiceRuntime() {
  for (const [name, version] of [["onnxruntime-web", "1.22.0-dev.20250409-89f8206ba4"], ["@diffusionstudio/piper-wasm", "1.0.0"]]) {
    const installed = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"));
    if (installed.version !== version) throw new Error(`Expected ${name}@${version}; run npm ci`);
  }
  const assets = [];
  for (const [source, target, hash] of [
    ["src/piper-phoneme-map.js", "piper-phoneme-map.js"],
    ["src/piper-voices.js", "piper-voices.js"],
    // Install additive dependencies before the worker that imports them.
    ["src/voice-worker.js", "worker.js"],
    ["node_modules/onnxruntime-web/dist/ort.wasm.min.mjs", "vendor/ort.wasm.min.mjs", "0cb5ac5be2c414d5b9e361f857108630c6d6e24a5ab9be3cf5f761de55289e94"],
    ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.mjs", "43c25054b6b9ac000f786c65545ff83a45f871e0e310e8c2f4d48a363bb66db4"],
    ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "vendor/ort-wasm-simd-threaded.wasm", "f061472c6e77d6d50d079aacdc0ff9b63fee287ddd2cbf46cf62438d3891de2b"],
    ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm", "vendor/piper_phonemize.wasm", "b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6"],
    ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data", "vendor/piper_phonemize.data", "29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c"],
  ]) assets.push(await copy(source, target, hash));
  // Only the standalone Emscripten wrapper is used from Piper-TTS-Web, not its
  // downloader/inference code. Its exact bytes are the ones used in our benchmark.
  assets.push(await pinnedDownload(SOURCES[0], "vendor/phonemizer.mjs"));
  for (const descriptor of SOURCES.slice(1)) await pinnedDownload(descriptor, `licenses/${descriptor.file}`);
  for (const voice of PIPER_VOICES) {
    await pinnedDownload({ ...voice.modelCard, file: `${voice.modelKey}-MODEL_CARD` }, `licenses/voices/${voice.modelKey}-MODEL_CARD`);
  }
  for (const name of ["GPL-3.0.txt", "ONNX-Runtime-MIT.txt", "Piper-phonemize-MIT.txt", "Piper-WASM-MIT.txt", "Piper-TTS-Web-MIT.txt", "PIPER-BUILD.md"]) {
    await copy(`docs/licenses/${name}`, `licenses/${name}`);
  }
  await copy("docs/THIRD-PARTY-VOICE.md", "licenses/THIRD-PARTY-VOICE.md");
  await writeFile(path.join(runtime, "licenses/source-manifest.json"), `${JSON.stringify(SOURCES, null, 2)}\n`);
  // Retire only the old generated runtime tree. User-installed caches and
  // prepared audio live in the browser and are unaffected by this build step.
  await rm(path.join(root, "public/voice-runtime/v1"), { recursive: true, force: true });
  const manifest = `// Generated by scripts/prepare-voice-runtime.mjs. Do not edit.\nexport const RUNTIME_ASSETS = Object.freeze(${JSON.stringify(assets, null, 2)});\n`;
  const manifestPath = path.join(root, "src/voice-runtime-manifest.js");
  let current;
  try { current = await readFile(manifestPath, "utf8"); } catch { /* First build. */ }
  if (current !== manifest) await writeFile(manifestPath, manifest);
  return assets;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = await prepareVoiceRuntime();
  console.log(`Prepared ${assets.length} optional speech assets; no model was downloaded.`);
}
