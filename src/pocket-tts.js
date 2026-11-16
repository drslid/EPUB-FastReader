import * as ort from "./vendor/ort.wasm.min.mjs";
import { createPocketTokenizer } from "./pocket-tokenizer.js";

const EMPTY = new Float32Array(0);
const DECODER_BATCH = 12;

export function pocketError(message, code = "VOICE_FAILED") {
  return Object.assign(new Error(message), { code });
}

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

function dispose(values) {
  for (const tensor of Object.values(values)) tensor.dispose();
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

function createDecoderState(config) {
  const arrayTypes = { float32: Float32Array, int64: BigInt64Array, bool: Uint8Array };
  return Object.fromEntries(config.mimi_states.map(({ dtype, shape, key }, index) => {
    const length = shape.reduce((product, value) => product * value, 1);
    const values = new arrayTypes[dtype](length);
    if (key === "first") values.fill(1);
    return [`mimi_${index}`, new ort.Tensor(dtype, values, shape)];
  }));
}

function stateNames(session, skip) {
  const outputs = session.outputNames.slice(skip);
  if (!outputs.length || outputs.some(name =>
    !name.startsWith("out_") || !session.inputNames.includes(name.slice(4)))) {
    throw pocketError("Unsupported Pocket TTS state graph", "VOICE_NOT_INSTALLED");
  }
  return outputs;
}

function nextState(outputs, names) {
  return Object.fromEntries(names.map(name => [name.slice(4), outputs[name]]));
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

function sampleNoise(values, std) {
  for (let index = 0; index < values.length; index += 2) {
    const radius = std * Math.sqrt(-2 * Math.log(1 - Math.random()));
    const angle = 2 * Math.PI * Math.random();
    values[index] = radius * Math.cos(angle);
    if (index + 1 < values.length) values[index + 1] = radius * Math.sin(angle);
  }
}

async function generateLatents(model, tokens, framesAfterEnd) {
  const { main, flow, config, voiceState, mainStateNames, table } = model;
  const dimension = config.latent_dim;
  const limit = Math.ceil((tokens.length / config.tokens_per_second + config.gen_seconds_padding) * config.frame_rate);
  const data = new Float32Array(limit * dimension);
  const prefix = embeddingsFor(tokens, table, config.text_embeddings);
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
    const initial = await main.run({ ...voiceState, sequence: emptyLatents, text_embeddings: prefix });
    state = nextState(initial, mainStateNames);
    initial[conditionName].dispose();
    initial[eosName].dispose();

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
    }
  } finally {
    if (state) dispose(state);
    dispose([prefix, emptyLatents, emptyText, sequence, x, s, t]);
  }
  if (end === undefined)
    throw pocketError("Pocket TTS could not finish this passage", "VOICE_TEXT_TOO_LONG");
  return { latents: data, frames };
}

async function decode(model, { latents, frames }) {
  const { config, decoder, decoderStateNames } = model;
  const dimension = config.latent_dim;
  const perFrame = config.sample_rate / config.frame_rate;
  const samples = new Float32Array(frames * perFrame);
  let state = createDecoderState(config);
  try {
    for (let start = 0; start < frames; start += DECODER_BATCH) {
      const end = Math.min(frames, start + DECODER_BATCH);
      const latent = floatTensor(latents.subarray(start * dimension, end * dimension), [1, end - start, dimension]);
      try {
        const output = await decoder.run({ ...state, latent });
        dispose(state);
        state = nextState(output, decoderStateNames);
        const audio = output[decoder.outputNames[0]];
        try {
          if (audio.data.length !== (end - start) * perFrame) throw pocketError("Invalid Pocket TTS audio frame");
          samples.set(audio.data, start * perFrame);
        } finally {
          audio.dispose();
        }
      } finally {
        latent.dispose();
      }
    }
  } finally {
    dispose(state);
  }
  // Match the checkpoint's reference playback and suppress the initial click.
  const fade = Math.min(samples.length, config.sample_rate / 200);
  for (let index = 0; index < fade; index++) samples[index] *= index / Math.max(1, fade - 1);
  return samples;
}

function toWav(samples, sampleRate) {
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

export async function loadPocketTts({ getAsset, runtimeUrl, resume }) {
  ort.env.wasm.wasmPaths = new URL("vendor/", runtimeUrl).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const decoder = new TextDecoder();
  const config = JSON.parse(decoder.decode(await getAsset("manifest.json")));
  if (config?.format !== "volume-board/pocket-tts-onnx@1" || config.sample_rate !== 24_000)
    throw pocketError("Unsupported Pocket voice configuration", "VOICE_NOT_INSTALLED");
  const tokenize = createPocketTokenizer(JSON.parse(decoder.decode(await getAsset(config.tokenizer))));
  const table = new Uint16Array(await getAsset("text_embeddings.f16"));
  if (table.length !== config.text_embeddings.rows * config.text_embeddings.dim)
    throw pocketError("Invalid Pocket TTS text embeddings", "VOICE_NOT_INSTALLED");
  const voiceState = createVoiceState(config, await getAsset(config.voices[config.default_voice].file));
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
    const decoderSession = await load("mimi_decoder");
    const model = {
      main, flow, decoder: decoderSession, config, table, voiceState,
      mainStateNames: stateNames(main, 2), decoderStateNames: stateNames(decoderSession, 1),
    };
    return {
      async synthesize(text, progress) {
        if (typeof text !== "string" || !text.trim()) throw pocketError("Empty passage", "VOICE_EMPTY_TEXT");
        if (text.length > 8_000) throw pocketError("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
        progress({ stage: "phonemizing", status: "phonemizing" });
        const { prompt, framesAfterEnd } = preparePrompt(text, config);
        const tokens = tokenize(prompt);
        if (tokens.length > config.max_tokens_per_chunk)
          throw pocketError("Split this passage before synthesis", "VOICE_TEXT_TOO_LONG");
        progress({ stage: "synthesizing", status: "synthesizing", tokens: tokens.length });
        return toWav(await decode(model, await generateLatents(model, tokens, framesAfterEnd)), config.sample_rate);
      },
    };
  } catch (error) {
    dispose(voiceState);
    await Promise.allSettled(sessions.map(session => session.release()));
    throw error;
  }
}
