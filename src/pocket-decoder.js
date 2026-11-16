import * as ort from "./vendor/ort.wasm.min.mjs";

export const POCKET_DECODER_BATCH = 12;

export function pocketError(message, code = "VOICE_FAILED") {
  return Object.assign(new Error(message), { code });
}

export function configurePocketRuntime(runtimeUrl) {
  ort.env.wasm.wasmPaths = new URL("vendor/", runtimeUrl).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
}

export async function readPocketConfig(getAsset, bundleFile = "manifest.json") {
  const config = JSON.parse(new TextDecoder().decode(await getAsset(bundleFile)));
  if (config?.sample_rate === 24_000) {
    if (config.format === "volume-board/pocket-tts-onnx@1") return config;
    if (config.schema_version === 3 && config.tokenizer_kind === "tokenizers" &&
        config.voice_state_includes_bos === true && config.sampler_decode_steps === 1 && config.noise_clamp == null &&
        Array.isArray(config.flow_lm_state_manifest) && Array.isArray(config.mimi_state_manifest)) {
      const modelNames = ["text_conditioner", "flow_lm_main", "flow_lm_flow", "mimi_decoder"];
      return {
        ...config,
        models: Object.fromEntries(modelNames.map(name => [name, `${name}_int8.onnx`])),
        tokenizer: config.tokenizer_file,
        frame_rate: config.sample_rate / config.samples_per_frame,
        max_tokens_per_chunk: config.max_token_per_chunk,
        frames_after_eos: config.model_recommended_frames_after_eos,
        tokens_per_second: 3,
        gen_seconds_padding: 2,
      };
    }
  }
  throw pocketError("Unsupported Pocket voice configuration", "VOICE_NOT_INSTALLED");
}

export function disposePocketTensors(values) {
  for (const tensor of Object.values(values)) tensor.dispose();
}

export function pocketStateNames(session, skip, manifest) {
  const states = manifest
    ? manifest.map(({ input_name, output_name }) => [input_name, output_name])
    : session.outputNames.slice(skip).map(name => [name.slice(4), name]);
  if (!states.length || states.length !== session.outputNames.length - skip ||
      states.some(([input, output]) => !session.inputNames.includes(input) || !session.outputNames.includes(output))) {
    throw pocketError("Unsupported Pocket TTS state graph", "VOICE_NOT_INSTALLED");
  }
  return states;
}

export function nextPocketState(outputs, names) {
  return Object.fromEntries(names.map(([input, output]) => [input, outputs[output]]));
}

function createDecoderState(config) {
  const arrayTypes = { float32: Float32Array, int64: BigInt64Array, bool: Uint8Array };
  const states = config.mimi_state_manifest ?? config.mimi_states;
  return Object.fromEntries(states.map(({ dtype, shape, key, fill, input_name }, index) => {
    const length = shape.reduce((product, value) => product * value, 1);
    const values = new arrayTypes[dtype](length);
    if (key === "first" || fill === "ones") values.fill(dtype === "int64" ? 1n : 1);
    return [input_name ?? `mimi_${index}`, new ort.Tensor(dtype, values, shape)];
  }));
}

export async function loadPocketDecoder({ getAsset, runtimeUrl, config, bundleFile, resume }) {
  configurePocketRuntime(runtimeUrl);
  config ??= await readPocketConfig(getAsset, bundleFile);
  resume?.("mimi_decoder");
  const session = await ort.InferenceSession.create(await getAsset(config.models.mimi_decoder), {
    executionProviders: ["wasm"], graphOptimizationLevel: "all",
  });
  let stateNames;
  try {
    stateNames = pocketStateNames(session, 1, config.mimi_state_manifest);
  } catch (error) {
    await session.release();
    throw error;
  }
  const dimension = config.latent_dim;
  const samplesPerFrame = config.sample_rate / config.frame_rate;
  let state;
  function close() {
    if (state) disposePocketTensors(state);
    state = undefined;
  }
  return {
    start() {
      close();
      state = createDecoderState(config);
    },
    async decode(latents) {
      const frames = latents.length / dimension;
      if (!state || !Number.isInteger(frames) || frames < 1 || frames > POCKET_DECODER_BATCH)
        throw pocketError("Invalid Pocket TTS decoder batch");
      const latent = new ort.Tensor("float32", latents, [1, frames, dimension]);
      try {
        const output = await session.run({ ...state, latent });
        disposePocketTensors(state);
        state = nextPocketState(output, stateNames);
        const audio = output[session.outputNames[0]];
        try {
          if (audio.data.length !== frames * samplesPerFrame)
            throw pocketError("Invalid Pocket TTS audio frame");
          return audio.data.slice();
        } finally {
          audio.dispose();
        }
      } finally {
        latent.dispose();
      }
    },
    close,
    async dispose() {
      close();
      await session.release();
    },
  };
}
