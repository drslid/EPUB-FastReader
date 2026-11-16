import * as ort from "./vendor/ort.wasm.min.mjs";
import { createPocketTokenizer } from "./pocket-tokenizer.js";
import {
  configurePocketRuntime,
  disposePocketTensors as dispose,
  loadPocketDecoder,
  nextPocketState as nextState,
  pocketError,
  pocketStateNames as stateNames,
  POCKET_DECODER_BATCH,
  readPocketConfig,
} from "./pocket-decoder.js";

const EMPTY = new Float32Array(0);
export { pocketError };

function halfToFloat(bits) {
  const negative = bits >> 15;
  const exponent = (bits >> 10) & 31;
  const fraction = bits & 1023;
  if (exponent === 31) return fraction ? NaN : negative ? -Infinity : Infinity;
  const value = exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24;
  return negative ? -value : value;
}

function floatTensor(values, shape) {
  return new ort.Tensor("float32", values, shape);
}

function preparePrompt(text, config) {
  let prompt = Array.from(text.normalize("NFC"), char => config.replace_characters[char] ?? char).join("");
  prompt = prompt.replace(/\s+/gu, " ").trim().replace(/([.!?…])\s*[,;:]/gu, "$1");
  if (!prompt) throw pocketError("No pronounceable text", "VOICE_EMPTY_TEXT");
  if (config.remove_semicolons) prompt = prompt.replaceAll(";", ",");
  const words = prompt.split(" ").length;
  if (config.capitalize_first_letter) prompt = prompt[0].toUpperCase() + prompt.slice(1);
  if (config.append_terminal_punctuation) {
    const core = prompt.replace(/["'”’\])»\s]+$/u, "");
    if (core && !/[.!?…]$/u.test(core)) {
      const end = core.replace(/[,;:–—\s-]+$/u, "");
      prompt = end === core ? `${prompt}.` : `${end}.${prompt.slice(core.length).trim()}`;
    }
  }
  if (config.pad_with_spaces_for_short_inputs && words <= 4) prompt = "        " + prompt;
  return { prompt, framesAfterEnd: config.frames_after_eos ?? (words <= 4 ? 5 : 3) };
}

function createVoiceState(config, packedVoice) {
  const voice = config.voices[config.default_voice];
  const values = new Uint16Array(packedVoice);
  const state = {};
  let position = 0;
  for (const [index, layer] of config.flow_layers.entries()) {
    const offset = voice.offsets[index];
    const shape = [2, 1, offset, layer.heads, layer.head_dim];
    const length = shape.reduce((product, value) => product * value, 1);
    state[`cache_${index}`] = floatTensor(
      Float32Array.from(values.subarray(position, position + length), halfToFloat), shape,
    );
    state[`offset_${index}`] = new ort.Tensor("int64", BigInt64Array.of(BigInt(offset)), [1]);
    position += length;
  }
  if (position !== values.length) throw pocketError("Invalid Pocket voice state", "VOICE_NOT_INSTALLED");
  return state;
}

function aliasVoiceStateFactory(config, buffer) {
  const file = new DataView(buffer);
  const headerEnd = 8 + Number(file.getBigUint64(0, true));
  const invalid = () => pocketError("Invalid Pocket TTS voice tensor", "VOICE_NOT_INSTALLED");
  if (!Number.isSafeInteger(headerEnd) || headerEnd < 10 || headerEnd > buffer.byteLength) throw invalid();
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerEnd - 8)));
  const readers = config.flow_lm_state_manifest.map(({ module, key, dtype, shape, input_name }) => {
    const tensor = header[`${module}/${key}`];
    const [from, to] = tensor?.data_offsets ?? [];
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
        from < 0 || from >= to || headerEnd + to > buffer.byteLength) throw invalid();
    if (dtype === "int64" && tensor.dtype === "I64" && shape.length === 1 &&
        shape[0] === 1 && to - from === 8) {
      const value = file.getBigInt64(headerEnd + from, true);
      return () => [input_name, new ort.Tensor("int64", BigInt64Array.of(value), shape)];
    } else if (dtype === "float32" && tensor.dtype === "F32" && key === "cache" &&
               tensor.shape.length === shape.length && shape.length === 5 &&
               shape[0] === 2 && shape[1] === 1 &&
               tensor.shape.every((value, index) => index === 2 || value === shape[index])) {
      const voiceFrames = tensor.shape[2];
      const width = shape[3] * shape[4];
      const voiceHalf = voiceFrames * width;
      const modelHalf = shape[2] * width;
      if (!Number.isInteger(voiceFrames) || voiceFrames < 1 || voiceFrames > shape[2] ||
          to - from !== 2 * voiceHalf * Float32Array.BYTES_PER_ELEMENT) throw invalid();
      const voice = new Float32Array(buffer, headerEnd + from, 2 * voiceHalf);
      return () => {
        const cache = new Float32Array(2 * modelHalf);
        // The released preset stores only populated keys and values. The graph uses fixed-length halves.
        cache.set(voice.subarray(0, voiceHalf));
        cache.set(voice.subarray(voiceHalf), modelHalf);
        return [input_name, floatTensor(cache, shape)];
      };
    }
    throw invalid();
  });
  return () => Object.fromEntries(readers.map(read => read()));
}

function embeddingsFor(tokens, table, { rows, dim }) {
  const values = new Float32Array(tokens.length * dim);
  for (const [index, token] of tokens.entries()) {
    if (token < 0 || token >= rows) throw pocketError("Missing text embedding", "VOICE_NOT_INSTALLED");
    for (let offset = 0; offset < dim; offset++)
      values[index * dim + offset] = halfToFloat(table[token * dim + offset]);
  }
  return floatTensor(values, [1, tokens.length, dim]);
}

async function encodeAliasText(tokens, textConditioner) {
  const tokenIds = new ort.Tensor("int64", BigInt64Array.from(tokens, BigInt), [1, tokens.length]);
  try {
    return (await textConditioner.run({ token_ids: tokenIds })).text_embeddings;
  } finally {
    tokenIds.dispose();
  }
}

function sampleNoise(values, std) {
  for (let index = 0; index < values.length; index += 2) {
    const radius = std * Math.sqrt(-2 * Math.log(1 - Math.random()));
    const angle = 2 * Math.PI * Math.random();
    values[index] = radius * Math.cos(angle);
    if (index + 1 < values.length) values[index + 1] = radius * Math.sin(angle);
  }
}

async function generateLatents(model, tokens, framesAfterEnd, submit) {
  const { main, flow, config, voiceState, createVoiceState, mainStateNames, embedText } = model;
  const dimension = config.latent_dim;
  const limit = Math.ceil((tokens.length / config.tokens_per_second + config.gen_seconds_padding) * config.frame_rate);
  const data = new Float32Array(limit * dimension);
  const prefix = await embedText(tokens);
  const emptyLatents = floatTensor(EMPTY, [1, 0, dimension]);
  const emptyText = floatTensor(EMPTY, [1, 0, config.conditioning_dim]);
  const latent = new Float32Array(dimension).fill(NaN);
  const sequence = floatTensor(latent, [1, 1, dimension]);
  const noise = new Float32Array(dimension);
  const x = floatTensor(noise, [1, dimension]);
  const s = floatTensor(Float32Array.of(0), [1, 1]);
  const t = floatTensor(Float32Array.of(1), [1, 1]);
  const std = Math.sqrt(config.temperature);
  const [conditionName, eosName] = main.outputNames;
  let state;
  let end;
  let frames = 0;
  try {
    const preset = createVoiceState?.() ?? voiceState;
    try {
      const initial = await main.run({ ...preset, sequence: emptyLatents, text_embeddings: prefix });
      state = nextState(initial, mainStateNames);
      initial[conditionName].dispose();
      initial[eosName].dispose();
    } finally {
      // Fixed-capacity caches need padding only until the first graph call.
      if (createVoiceState) dispose(preset);
    }

    for (let step = 0; step < limit; step++) {
      const outputs = await main.run({ ...state, sequence, text_embeddings: emptyText });
      dispose(state);
      state = nextState(outputs, mainStateNames);
      const condition = outputs[conditionName];
      const eos = outputs[eosName];
      if (end === undefined && step >= config.min_frames_before_eos && eos.data[0] > config.eos_threshold)
        end = step;
      eos.dispose();
      try {
        if (end !== undefined && step >= end + framesAfterEnd) break;
        sampleNoise(noise, std);
        const output = await flow.run({ c: condition, s, t, x });
        try {
          const delta = output[flow.outputNames[0]].data;
          for (let index = 0; index < dimension; index++) latent[index] = noise[index] + delta[index];
          data.set(latent, frames++ * dimension);
        } finally {
          dispose(output);
        }
      } finally {
        condition.dispose();
      }
      if (submit && frames % POCKET_DECODER_BATCH === 0) {
        const start = (frames - POCKET_DECODER_BATCH) * dimension;
        await submit(data.subarray(start, frames * dimension));
      }
    }
  } finally {
    if (state) dispose(state);
    dispose([prefix, emptyLatents, emptyText, sequence, x, s, t]);
  }
  if (end === undefined)
    throw pocketError("Pocket TTS could not finish this passage", "VOICE_TEXT_TOO_LONG");
  return data.subarray(0, frames * dimension);
}

function createParallelSentence(peer, samplesPerLatent, onFailure) {
  let usable = true;
  const chunks = [];
  const fail = () => {
    usable = false;
    chunks.length = 0;
    onFailure();
  };
  let pending = Promise.resolve().then(() => peer.start()).catch(fail);
  return {
    async submit(batch) {
      await pending;
      if (!usable) return;
      // The parent keeps the original latents to replay exactly if the worker dies.
      pending = Promise.resolve().then(() => peer.decode(batch.slice())).then(samples => {
        if (!(samples instanceof Float32Array) || samples.length !== batch.length * samplesPerLatent)
          throw pocketError("Invalid Pocket TTS audio frame");
        chunks.push(samples);
      }).catch(fail);
    },
    async close() {
      await pending;
      if (usable) await Promise.resolve().then(() => peer.close()).catch(fail);
    },
    result(length) {
      if (!usable) return null;
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      return samples;
    },
  };
}

async function decodeLocally(decoder, latents, batchSize, samplesPerLatent) {
  const samples = new Float32Array(latents.length * samplesPerLatent);
  decoder.start();
  try {
    for (let start = 0; start < latents.length; start += batchSize) {
      const batch = latents.subarray(start, start + batchSize);
      samples.set(await decoder.decode(batch), start * samplesPerLatent);
    }
  } finally {
    decoder.close();
  }
  return samples;
}

function toWav(samples, sampleRate) {
  // Match the checkpoint's reference playback and suppress the initial click.
  const fade = Math.min(samples.length, sampleRate / 200);
  for (let index = 0; index < fade; index++) samples[index] *= index / Math.max(1, fade - 1);

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeTag = (offset, tag) => new Uint8Array(buffer, offset, 4).set(
    Array.from(tag, char => char.charCodeAt(0)),
  );
  writeTag(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) throw pocketError("Invalid Pocket TTS audio");
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, samples[index])) * 32767, true);
  }
  return { wav: buffer, duration: samples.length / sampleRate };
}

export async function loadPocketTts({ getAsset, runtimeUrl, bundleFile, presetFile, resume, createDecoderPeer }) {
  configurePocketRuntime(runtimeUrl);
  const config = await readPocketConfig(getAsset, bundleFile);
  const textDecoder = new TextDecoder();
  const tokenize = createPocketTokenizer(JSON.parse(textDecoder.decode(await getAsset(config.tokenizer))));
  const alias = config.schema_version === 3;
  let newVoiceState = alias ? aliasVoiceStateFactory(config, await getAsset(presetFile)) : null;
  const voiceState = alias ? null : createVoiceState(config, await getAsset(config.voices[config.default_voice].file));
  const sessions = [];
  async function load(key) {
    resume?.(key);
    const session = await ort.InferenceSession.create(await getAsset(config.models[key]), {
      executionProviders: ["wasm"], graphOptimizationLevel: "all",
    });
    sessions.push(session);
    return session;
  }
  try {
    // Keep only the model currently crossing from Cache Storage into WASM in memory.
    const main = await load("flow_lm_main");
    const flow = await load("flow_lm_flow");
    let embedText;
    if (alias) {
      const conditioner = await load("text_conditioner");
      if (conditioner.inputNames.join() !== "token_ids" || conditioner.outputNames.join() !== "text_embeddings")
        throw pocketError("Unsupported Pocket text conditioner", "VOICE_NOT_INSTALLED");
      embedText = tokens => encodeAliasText(tokens, conditioner);
    } else {
      const table = new Uint16Array(await getAsset("text_embeddings.f16"));
      if (table.length !== config.text_embeddings.rows * config.text_embeddings.dim)
        throw pocketError("Invalid Pocket TTS text embeddings", "VOICE_NOT_INSTALLED");
      embedText = tokens => embeddingsFor(tokens, table, config.text_embeddings);
    }
    const model = {
      main, flow, config, embedText, voiceState, createVoiceState: newVoiceState,
      mainStateNames: stateNames(main, 2, config.flow_lm_state_manifest),
    };
    let peer;
    if (createDecoderPeer) {
      try { peer = await createDecoderPeer(); } catch { /* This device can still decode locally. */ }
    }
    const loadLocal = onLoad => loadPocketDecoder({ getAsset, runtimeUrl, config, resume: onLoad });
    let local = peer ? null : await loadLocal(resume);
    const batchSize = POCKET_DECODER_BATCH * config.latent_dim;
    const samplesPerLatent = config.sample_rate / config.frame_rate / config.latent_dim;
    let disposed = false;
    return {
      get decoderMode() { return peer ? "parallel" : "single"; },
      async synthesize(text, progress) {
        if (disposed) throw pocketError("Pocket voice has been released");
        if (typeof text !== "string" || !text.trim()) throw pocketError("Empty passage", "VOICE_EMPTY_TEXT");
        if (text.length > 8_000) throw pocketError("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
        progress({ stage: "phonemizing", status: "phonemizing" });
        const { prompt, framesAfterEnd } = preparePrompt(text, config);
        const tokens = tokenize(prompt);
        if (tokens.length > config.max_tokens_per_chunk)
          throw pocketError("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
        progress({ stage: "synthesizing", status: "synthesizing", tokens: tokens.length });
        const parallel = peer && createParallelSentence(peer, samplesPerLatent, () => {
          const failedPeer = peer;
          peer = null;
          failedPeer.terminate();
        });
        let latents;
        try {
          latents = await generateLatents(model, tokens, framesAfterEnd, parallel?.submit);
          const remaining = latents.length % batchSize;
          if (parallel && remaining) await parallel.submit(latents.subarray(-remaining));
        } finally {
          await parallel?.close();
        }
        let samples = parallel?.result(latents.length * samplesPerLatent);
        if (!samples) {
          local ??= await loadLocal(component => progress({ stage: "loading", status: "loading", component }));
          samples = await decodeLocally(local, latents, batchSize, samplesPerLatent);
        }
        return toWav(samples, config.sample_rate);
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        peer?.terminate();
        peer = null;
        if (voiceState) dispose(voiceState);
        model.createVoiceState = newVoiceState = null;
        model.embedText = embedText = null;
        const releases = sessions.map(session => session.release());
        if (local) releases.push(local.dispose());
        local = null;
        await Promise.allSettled(releases);
      },
    };
  } catch (error) {
    if (voiceState) dispose(voiceState);
    await Promise.allSettled(sessions.map(session => session.release()));
    throw error;
  }
}
