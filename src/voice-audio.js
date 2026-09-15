const HEADER_BYTES = 44;
const SAMPLE_RATES = new Set([22_050, 24_000]); // Piper and saved Kokoro audio.

function invalidAudio() {
  return Object.assign(new Error("Invalid generated WAV audio"), { code: "VOICE_FAILED" });
}

function pcmBytes(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) throw invalidAudio();
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(24, true);
  const tag = (offset, value) => [...value].every((char, index) => view.getUint8(offset + index) === char.charCodeAt(0));
  // This is the worker's fixed PCM protocol, not a general purpose WAV decoder.
  if (!tag(0, "RIFF") || !tag(8, "WAVE") || !tag(12, "fmt ") || !tag(36, "data")
    || view.getUint32(4, true) !== buffer.byteLength - 8 || view.getUint32(16, true) !== 16
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || !SAMPLE_RATES.has(sampleRate) || view.getUint32(28, true) !== sampleRate * 2
    || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== buffer.byteLength - HEADER_BYTES
    || (buffer.byteLength - HEADER_BYTES) % 2 !== 0 || buffer.byteLength === HEADER_BYTES) throw invalidAudio();
  return { bytes: new Uint8Array(buffer, HEADER_BYTES), sampleRate };
}

/** Keep every sample when a long sentence needed several model calls. */
export function concatenateVoiceWavs(buffers) {
  if (!Array.isArray(buffers) || !buffers.length) throw invalidAudio();
  const chunks = buffers.map(pcmBytes);
  const sampleRate = chunks[0].sampleRate;
  if (chunks.some(chunk => chunk.sampleRate !== sampleRate)) throw invalidAudio();
  const dataBytes = chunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0);
  if (dataBytes > 0xffffffff - HEADER_BYTES) throw invalidAudio();
  const wav = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const bytes = new Uint8Array(wav);
  bytes.set(new Uint8Array(buffers[0], 0, HEADER_BYTES));
  let offset = HEADER_BYTES;
  for (const chunk of chunks) {
    bytes.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
  }
  const view = new DataView(wav);
  view.setUint32(4, wav.byteLength - 8, true);
  view.setUint32(40, dataBytes, true);
  return { wav, duration: dataBytes / 2 / sampleRate };
}

/** Shared by newly generated sentences and previously saved audio fragments. */
export async function concatenateVoiceAudio(parts, { signal } = {}) {
  const checkActive = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };
  checkActive();
  const buffers = [];
  for (const part of parts || []) {
    buffers.push(part.wav instanceof ArrayBuffer ? part.wav : await part.blob?.arrayBuffer());
    checkActive();
  }
  const { wav, duration } = concatenateVoiceWavs(buffers);
  return { blob: new Blob([wav], { type: "audio/wav" }), duration };
}
