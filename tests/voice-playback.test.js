// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createVoicePlayback } from "../src/voice-playback.js";

const voice = { id: "ff_siwis", name: "Siwis", language: "fr" };
const text = "Première phrase. Deuxième phrase. Troisième phrase. Quatrième phrase.";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

function setup({ load, synthesize, play, concurrency = 1, playbackOptions = { maxBufferedPassages: 2 } } = {}) {
  const audio = new EventTarget();
  Object.assign(audio, { src: "", paused: true, playbackRate: 1, currentTime: 0 });
  audio.play = vi.fn(() => { audio.paused = false; return play ? play() : Promise.resolve(); });
  audio.pause = vi.fn(() => { audio.paused = true; });
  audio.load = vi.fn();
  audio.removeAttribute = vi.fn((name) => { if (name === "src") audio.src = ""; });
  audio.end = () => { audio.paused = true; audio.dispatchEvent(new Event("ended")); };
  const engines = [];
  const createEngine = vi.fn(() => {
    const engine = {
      concurrency,
      load: vi.fn(load || (async () => {})),
      synthesize: vi.fn(synthesize || (async (words) => ({ blob: new Blob([words]), duration: 1 }))),
      dispose: vi.fn(),
    };
    engines.push(engine);
    return engine;
  });
  const urls = new Map();
  let serial = 0;
  const createUrl = vi.fn((blob) => { const url = `blob:voice-${++serial}`; urls.set(url, blob); return url; });
  const revokeUrl = vi.fn((url) => urls.delete(url));
  const onState = vi.fn(), onPosition = vi.fn(), onEnd = vi.fn();
  const playback = createVoicePlayback({ createEngine, createAudio: () => audio, createUrl, revokeUrl, onState, onPosition, onEnd, ...playbackOptions });
  return { playback, audio, engines, createEngine, createUrl, revokeUrl, urls, onState, onPosition, onEnd };
}

const savedPassages = Object.freeze([
  { start: 12, end: 35, text: "Premier passage gardé.", segmentId: "segment-a", duration: 2.1 },
  { start: 38, end: 63, text: "Deuxième passage gardé.", segmentId: "segment-b", duration: 2.2 },
  { start: 67, end: 93, text: "Troisième passage gardé.", segmentId: "segment-c", duration: 2.3 },
  { start: 99, end: 122, text: "Dernier passage gardé.", segmentId: "segment-d", duration: 2.4 },
].map(passage => Object.freeze({ ...passage, end: passage.start + passage.text.length })));

function setupPrepared({ read, passages = savedPassages, ...options } = {}) {
  const state = setup(options);
  const reader = vi.fn(read || (async passage => ({ blob: new Blob([passage.text]), duration: passage.duration })));
  return { ...state, read: reader, prepared: { passages, read: reader } };
}

function setupStreaming({ count = 1, complete = false, ...options } = {}) {
  const state = setupPrepared(options);
  let manifest = { passages: savedPassages.slice(0, count), complete, status: complete ? "ready" : "preparing", error: null };
  const listeners = new Set();
  const unsubscribe = vi.fn();
  const getSnapshot = vi.fn(async () => manifest);
  const prepared = { ...manifest, read: state.read, getSnapshot, subscribe: listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); unsubscribe(); };
  } };
  const notify = () => { for (const listener of listeners) listener(); };
  const publish = update => { manifest = update === null ? null : { ...manifest, ...update }; notify(); };
  return { ...state, prepared, getSnapshot, publish, notify, listeners, unsubscribe };
}

describe("local voice playback", () => {
  it("loads only on start and respects a configured two-passage buffer", async () => {
    const { playback, createEngine, engines, audio, onPosition } = setup();
    expect(createEngine).not.toHaveBeenCalled();
    playback.start({ text, voice });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0, passageCount: 4, voiceLabel: "Siwis" });
    expect(engines[0].synthesize.mock.calls.map(([words]) => words)).toEqual(["Première phrase.", "Deuxième phrase."]);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(onPosition).toHaveBeenCalledWith({ start: 0, end: 16, text: "Première phrase." });
    audio.end();
    await flush();
    expect(engines[0].synthesize.mock.calls.map(([words]) => words)).toEqual(["Première phrase.", "Deuxième phrase.", "Troisième phrase."]);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(playback.snapshot().passageIndex).toBe(1);
  });

  it("retains current audio/time on pause and resumes without regenerating the same passage", async () => {
    const { playback, audio, engines, createUrl } = setup();
    playback.start({ text, voice });
    await flush();
    audio.currentTime = 3;
    const src = audio.src;
    playback.pause();
    expect(playback.snapshot().status).toBe("paused");
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    playback.resume();
    await flush();
    expect(audio.src).toBe(src);
    expect(audio.currentTime).toBe(3);
    expect(createUrl).toHaveBeenCalledOnce();
    expect(engines.flatMap((engine) => engine.synthesize.mock.calls).filter(([words]) => words === "Première phrase.")).toHaveLength(1);
    expect(playback.snapshot().status).toBe("playing");
  });

  it("ignores a synthesis result that arrives after stop and aborts the worker", async () => {
    const pending = deferred();
    const { playback, audio, engines, urls } = setup({ synthesize: () => pending.promise });
    playback.start({ text, voice });
    await flush();
    expect(playback.snapshot().status).toBe("preparing");
    const signal = engines[0].synthesize.mock.calls[0][1].signal;
    playback.stop();
    expect(signal.aborted).toBe(true);
    pending.resolve({ blob: new Blob(["stale"]) });
    await flush();
    expect(playback.snapshot().status).toBe("idle");
    expect(audio.play).not.toHaveBeenCalled();
    expect(urls.size).toBe(0);
  });

  it("does not pause a new session when an older audio.play promise finally settles", async () => {
    const pending = deferred();
    let first = true;
    const { playback, audio } = setup({ play: () => { if (first) { first = false; return pending.promise; } return Promise.resolve(); } });
    playback.start({ text, voice });
    await flush();
    playback.start({ text: "Nouveau livre.", voice });
    await flush();
    expect(playback.snapshot().status).toBe("playing");
    const pauses = audio.pause.mock.calls.length;
    pending.resolve();
    await flush();
    expect(audio.pause).toHaveBeenCalledTimes(pauses);
    expect(audio.paused).toBe(false);
    expect(playback.snapshot().passage.text).toBe("Nouveau livre.");
  });

  it("offers a retry after autoplay rejection and reuses the prepared audio", async () => {
    let allowed = false;
    const { playback, audio, engines } = setup({ play: async () => { if (!allowed) throw new DOMException("Gesture required", "NotAllowedError"); } });
    playback.start({ text, voice });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "paused", error: "autoplay", playing: false });
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    allowed = true;
    playback.resume();
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", error: "" });
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(engines).toHaveLength(2);
    expect(engines[0].synthesize.mock.calls.filter(([words]) => words === "Première phrase.")).toHaveLength(1);
  });

  it("navigates without playing while paused and drops obsolete prepared passages", async () => {
    const { playback, audio, engines } = setup();
    playback.start({ text, voice });
    await flush();
    playback.pause();
    const plays = audio.play.mock.calls.length;
    playback.next();
    playback.next();
    expect(playback.snapshot()).toMatchObject({ status: "paused", passageIndex: 2 });
    expect(audio.play).toHaveBeenCalledTimes(plays);
    playback.resume();
    await flush();
    expect(playback.snapshot().passage.text).toBe("Troisième phrase.");
    expect(engines.at(-1).synthesize.mock.calls.map(([words]) => words)).toEqual(["Troisième phrase.", "Quatrième phrase."]);
    playback.previous();
    await flush();
    expect(playback.snapshot().passage.text).toBe("Deuxième phrase.");
    expect(engines.at(-1).synthesize.mock.calls.map(([words]) => words)).toEqual(["Deuxième phrase."]);
  });

  it("continues when the current passage ends before the next synthesis has finished", async () => {
    const next = deferred();
    const { playback, audio, engines } = setup({ synthesize: (words) => words === "Deuxième phrase." ? next.promise : Promise.resolve({ blob: new Blob([words]) }) });
    playback.start({ text, voice });
    await flush();
    audio.end();
    expect(playback.snapshot()).toMatchObject({ status: "preparing", passageIndex: 1 });
    next.resolve({ blob: new Blob(["Deuxième phrase."]) });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1 });
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(engines[0].synthesize.mock.calls).toHaveLength(3);
  });

  it("reports completion once, saves the final passage and can restart from the beginning", async () => {
    const { playback, audio, onEnd, onPosition } = setup();
    playback.start({ text: "Une phrase.", voice });
    await flush();
    audio.end();
    audio.end();
    await flush();
    expect(playback.snapshot().status).toBe("ended");
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onPosition).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Une phrase.", completed: true }));
    playback.resume();
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0 });
  });

  it("handles media decode errors after play and regenerates the failing passage on retry", async () => {
    const { playback, audio, engines, urls } = setup();
    playback.start({ text, voice });
    await flush();
    audio.dispatchEvent(new Event("error"));
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "playback", playing: false });
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    expect(urls.size).toBe(0);
    playback.resume();
    await flush();
    expect(playback.snapshot().status).toBe("playing");
    expect(engines[1].synthesize.mock.calls[0][0]).toBe("Première phrase.");
    playback.stop();
    audio.dispatchEvent(new Event("error"));
    expect(playback.snapshot().status).toBe("idle");
  });

  it("surfaces worker failures without advancing the reading position", async () => {
    const error = Object.assign(new Error("Out of memory"), { code: "MEMORY" });
    const { playback, engines, onPosition, onEnd } = setup({ synthesize: async () => { throw error; } });
    playback.start({ text, voice });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "MEMORY", passageIndex: 0 });
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    expect(onPosition).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("starts from the saved text offset and changes speed without synthesizing again", async () => {
    const { playback, audio, engines } = setup();
    playback.start({ text, voice, offset: text.indexOf("Troisième"), rate: 1.25 });
    await flush();
    expect(playback.snapshot()).toMatchObject({ passageIndex: 2, rate: 1.25 });
    expect(audio.playbackRate).toBe(1.25);
    const calls = engines[0].synthesize.mock.calls.length;
    playback.setRate(10);
    expect(audio.playbackRate).toBe(1.75);
    playback.setRate(0.1);
    expect(audio.playbackRate).toBe(0.75);
    expect(engines[0].synthesize).toHaveBeenCalledTimes(calls);
    for (const [, options] of engines[0].synthesize.mock.calls) expect(options.speed).toBe(1);
  });

  it("does not synthesize empty chapters and releases all blob URLs when disposed", async () => {
    const { playback, createEngine, urls, audio } = setup();
    playback.start({ text: " \n ", voice });
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "empty" });
    expect(createEngine).not.toHaveBeenCalled();
    playback.start({ text, voice });
    await flush();
    expect(urls.size).toBe(1);
    playback.dispose();
    expect(urls.size).toBe(0);
    expect(audio.src).toBe("");
    expect(playback.snapshot().passageCount).toBe(0);
  });

  it("unlocks the audio element from a gesture without starting synthesis", async () => {
    const { playback, createEngine, audio, urls } = setup();
    playback.activate();
    expect(audio.play).toHaveBeenCalledOnce();
    await flush();
    expect(audio.paused).toBe(true);
    expect(createEngine).not.toHaveBeenCalled();
    expect(urls.size).toBe(1);
    playback.stop();
    expect(urls.size).toBe(0);
  });

  it("splits oversized phoneme passages progressively without losing text, offsets or buffer bounds", async () => {
    const words = "1234567890".repeat(13) + ".";
    const { playback, audio, engines, onPosition, urls } = setup({ synthesize: async (phrase) => {
      if (phrase.length > 32) throw Object.assign(new Error("Token limit"), { code: "VOICE_TEXT_TOO_LONG" });
      return { blob: new Blob([phrase]) };
    } });
    playback.start({ text: words, voice });
    await flush();
    const successful = () => engines.flatMap(engine => engine.synthesize.mock.calls).filter(([phrase]) => phrase.length <= 32);
    expect(successful()).toHaveLength(2);
    expect(playback.snapshot().status).toBe("playing");
    let endedPassages = 0;
    while (playback.snapshot().status === "playing" && endedPassages < 20) {
      expect(urls.size).toBe(1);
      audio.end();
      endedPassages++;
      await flush();
      expect(successful().length).toBeLessThanOrEqual(endedPassages + 2);
    }
    expect(playback.snapshot().status).toBe("ended");
    const positions = onPosition.mock.calls.map(([position]) => position).filter(position => !position.completed);
    expect(positions.map(position => position.text).join("")).toBe(words);
    for (const passage of positions) expect(passage.text).toBe(words.slice(passage.start, passage.end));
    expect(engines).toHaveLength(1);
  });

  it("skips a permanently oversized sentence after bounded retries and advances to the next chapter", async () => {
    const { playback, engines, onPosition, onEnd } = setup({ synthesize: async () => {
      throw Object.assign(new Error("Cannot pronounce"), { code: "VOICE_TEXT_TOO_LONG" });
    } });
    playback.start({ text: "1234567890".repeat(12), voice });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", error: "", skippedSegments: 1 });
    expect(engines[0].synthesize.mock.calls.length).toBeLessThanOrEqual(9);
    expect(onPosition).toHaveBeenCalledExactlyOnceWith({ start: 0, end: 120, text: "1234567890".repeat(12), completed: true });
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("skips isolated punctuation and ornaments without asking the engine to pronounce them", async () => {
    const source = "***\n\nPremière phrase.\n\n...\n\nDeuxième phrase.\n\n???";
    const { playback, engines, audio, onPosition, onEnd } = setup({ synthesize: async phrase => {
      if (!/[\p{L}\p{N}]/u.test(phrase)) throw Object.assign(new Error("Nothing spoken"), { code: "VOICE_EMPTY_TEXT" });
      return { blob: new Blob([phrase]) };
    } });
    playback.start({ text: source, voice });
    await flush();
    expect(engines[0].synthesize.mock.calls).toHaveLength(2);
    audio.end(); await flush(); audio.end(); await flush();
    expect(playback.snapshot().status).toBe("ended");
    expect(onEnd).toHaveBeenCalledOnce();
    const positions = onPosition.mock.calls.map(([position]) => position).filter(position => !position.completed);
    expect(positions.map(({ text }) => text)).toEqual(["Première phrase.", "Deuxième phrase."]);
    for (const position of positions) expect(position.text).toBe(source.slice(position.start, position.end));
  });

  it("reports a skipped sentence when the engine cannot produce phonemes and completes the chapter", async () => {
    const { playback, engines, onPosition, onEnd } = setup({ synthesize: async () => {
      throw Object.assign(new Error("No phonemes"), { code: "VOICE_EMPTY_TEXT" });
    } });
    playback.start({ text: "Bonjour 2026.", voice });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", error: "", skippedSegments: 1, passageIndex: 0 });
    expect(engines[0].synthesize).toHaveBeenCalledOnce();
    expect(onPosition).toHaveBeenCalledExactlyOnceWith({ start: 0, end: 13, text: "Bonjour 2026.", completed: true });
    expect(onEnd).toHaveBeenCalledOnce();
  });
});

describe("recoverable text failures during direct listening", () => {
  const unsupported = () => Object.assign(new Error("Unsupported phonemes"), { code: "VOICE_PHONEME_UNSUPPORTED" });
  const clip = words => ({ blob: new Blob([words]), duration: 1 });

  it("keeps already buffered later audio in order when the first sentence fails", async () => {
    const first = deferred();
    const { playback, audio, engines, urls, onPosition, onEnd } = setup({ concurrency: 2,
      playbackOptions: { maxBufferedPassages: 6 }, synthesize: words => words === "Première phrase." ? first.promise : Promise.resolve(clip(words)) });
    playback.start({ text, voice }); await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
    expect(audio.play).not.toHaveBeenCalled();
    first.reject(unsupported()); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", skippedSegments: 1, passageCount: 3, passageIndex: 0, error: "" });
    for (const words of ["Deuxième phrase.", "Troisième phrase.", "Quatrième phrase."]) {
      expect(await urls.get(audio.src).text()).toBe(words);
      expect(playback.snapshot().passage).toMatchObject({ start: text.indexOf(words), text: words });
      audio.end(); await flush();
    }
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
    expect(onPosition.mock.calls.filter(([value]) => !value.completed).map(([value]) => value.text)).toEqual(["Deuxième phrase.", "Troisième phrase.", "Quatrième phrase."]);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(playback.snapshot()).toMatchObject({ status: "ended", skippedSegments: 1 });
  });

  it("skips a future sentence without interrupting the one playing or replaying subsequent buffers", async () => {
    const second = deferred();
    const { playback, audio, engines, urls } = setup({ concurrency: 2, playbackOptions: { maxBufferedPassages: 6 },
      synthesize: words => words === "Deuxième phrase." ? second.promise : Promise.resolve(clip(words)) });
    playback.start({ text, voice }); await flush();
    const src = audio.src, pauses = audio.pause.mock.calls.length;
    expect(await urls.get(src).text()).toBe("Première phrase.");
    second.reject(unsupported()); await flush();
    expect(audio.src).toBe(src);
    expect(audio.pause).toHaveBeenCalledTimes(pauses);
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0, skippedSegments: 1, passageCount: 3 });
    audio.end(); await flush();
    expect(await urls.get(audio.src).text()).toBe("Troisième phrase.");
    audio.end(); await flush();
    expect(await urls.get(audio.src).text()).toBe("Quatrième phrase.");
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
    playback.stop();
  });

  it("ignores text failures from a cancelled session and does not skip a new book's passage", async () => {
    const pending = deferred();
    const { playback, audio, urls } = setup({ synthesize: words => words === "Première phrase." ? pending.promise : Promise.resolve(clip(words)) });
    playback.start({ text, voice }); await flush();
    playback.stop();
    playback.start({ text: "Une nouvelle histoire.", voice }); await flush();
    pending.reject(unsupported()); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", skippedSegments: 0, passageCount: 1, passage: { text: "Une nouvelle histoire." } });
    expect(await urls.get(audio.src).text()).toBe("Une nouvelle histoire.");
    playback.stop();
  });

  it.each(["VOICE_FAILED", "MEMORY", "VOICE_NOT_INSTALLED", "STORAGE_FULL"])("keeps %s errors retryable without skipping text", async code => {
    const { playback, onEnd } = setup({ synthesize: async () => { throw Object.assign(new Error("Unavailable"), { code }); } });
    playback.start({ text, voice }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: code, skippedSegments: 0, passageIndex: 0, passageCount: 4 });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("finishes once when the last sentence cannot be read after the previous one ends", async () => {
    const last = deferred();
    const { playback, audio, onEnd, onPosition } = setup({ synthesize: words => words === "Dernière phrase." ? last.promise : Promise.resolve(clip(words)) });
    const source = "Une phrase lisible. Dernière phrase.";
    playback.start({ text: source, voice }); await flush();
    audio.end(); await flush();
    expect(playback.snapshot().status).toBe("preparing");
    last.reject(unsupported()); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", error: "", skippedSegments: 1 });
    expect(onPosition).toHaveBeenLastCalledWith({ start: source.indexOf("Dernière"), end: source.length, text: "Dernière phrase.", completed: true });
    expect(onEnd).toHaveBeenCalledOnce();
    audio.end(); await flush();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("settles silent warm-up using the next readable sentence and reuses its audio", async () => {
    const { playback, engines, audio, urls } = setup({ synthesize: async words => {
      if (words === "Première phrase.") throw unsupported();
      return clip(words);
    } });
    const warmed = playback.prepare({ text, voice }); await flush();
    await expect(warmed).resolves.toMatchObject({ status: "ready", warming: true, skippedSegments: 1, passage: { text: "Deuxième phrase." } });
    expect(audio.play).not.toHaveBeenCalled();
    playback.start({ text, voice }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", warming: false, skippedSegments: 1 });
    expect(await urls.get(audio.src).text()).toBe("Deuxième phrase.");
    expect(engines).toHaveLength(1);
    expect(engines[0].synthesize.mock.calls.filter(([words]) => words === "Deuxième phrase.")).toHaveLength(1);
    playback.stop();
  });

  it("settles and releases silent warm-up when every sentence is unreadable", async () => {
    const { playback, engines, audio, onEnd } = setup({ concurrency: 2, synthesize: async () => { throw unsupported(); } });
    const warmed = playback.prepare({ text, voice }); await flush();
    await expect(warmed).rejects.toMatchObject({ code: "VOICE_EMPTY_TEXT" });
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "VOICE_EMPTY_TEXT", skippedSegments: 4, passageCount: 0, warming: false });
    expect(audio.play).not.toHaveBeenCalled();
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("finishes an entirely unreadable chapter once, without playing or retrying skipped sentences", async () => {
    const { playback, engines, audio, onEnd } = setup({ concurrency: 2, synthesize: async () => { throw unsupported(); } });
    playback.start({ text, voice }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", skippedSegments: 4, passageCount: 0, error: "" });
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
    expect(audio.play).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });
});

describe("previously converted local audio playback", () => {
  it("does not replay the previous WAV when resuming in an omitted chapter ending", async () => {
    const { playback, prepared, read, onEnd, audio } = setupPrepared({ passages: savedPassages.slice(0, 1) });
    playback.start({ text, voice, offset: savedPassages[0].end + 10, prepared: { ...prepared, complete: true, skippedSegments: 1 } });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", skippedSegments: 1 });
    expect(read).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("preserves end-offset replay for complete recordings without omissions", async () => {
    const { playback, prepared, read, onEnd } = setupPrepared({ passages: savedPassages.slice(0, 1) });
    playback.start({ text, voice, offset: savedPassages[0].end + 10, prepared: { ...prepared, complete: true, skippedSegments: 0 } });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", skippedSegments: 0 });
    expect(read).toHaveBeenCalledExactlyOnceWith(savedPassages[0], expect.any(Object));
    expect(onEnd).not.toHaveBeenCalled();
    playback.stop();
  });

  it("reads saved segments without creating an engine or recomputing their boundaries", async () => {
    const { playback, prepared, read, createEngine, onPosition, audio } = setupPrepared();
    playback.start({ text: "This fallback text must not be segmented.", voice, prepared, offset: 40, rate: 1.25 });
    await flush();
    expect(createEngine).not.toHaveBeenCalled();
    expect(playback.snapshot()).toMatchObject({ status: "playing", prepared: true, passageIndex: 1, passageCount: 4, rate: 1.25 });
    expect(playback.snapshot().passage).toBe(savedPassages[1]);
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-b", "segment-c"]);
    expect(onPosition).toHaveBeenLastCalledWith(savedPassages[1]);
    expect(audio.playbackRate).toBe(1.25);
    playback.setRate(1.5);
    expect(audio.playbackRate).toBe(1.5);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps only the current and next segment, releasing older blobs when moving", async () => {
    const { playback, prepared, read, createEngine, audio, urls } = setupPrepared();
    playback.start({ voice, prepared });
    await flush();
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b"]);
    expect(urls.size).toBe(1);
    audio.end(); await flush();
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b", "segment-c"]);
    playback.previous(); await flush();
    // A has left the two-passage window and must be read again, while B remains.
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b", "segment-c", "segment-a"]);
    playback.next(); await flush();
    // Moving back discarded C; only the current/next pair was retained.
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b", "segment-c", "segment-a", "segment-c"]);
    expect(urls.size).toBe(1);
    expect(createEngine).not.toHaveBeenCalled();
    playback.dispose();
    expect(urls.size).toBe(0);
  });

  it("pauses and resumes the same media position without rereading or loading a model", async () => {
    const { playback, prepared, read, createEngine, audio, createUrl } = setupPrepared();
    playback.start({ voice, prepared });
    await flush();
    audio.currentTime = 1.2;
    const src = audio.src;
    playback.pause();
    expect(playback.snapshot()).toMatchObject({ prepared: true, status: "paused" });
    playback.resume();
    await flush();
    expect(audio.src).toBe(src);
    expect(audio.currentTime).toBe(1.2);
    expect(createUrl).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(createEngine).not.toHaveBeenCalled();
    expect(playback.snapshot().status).toBe("playing");
  });

  it("allows navigation while paused without reading or playing until resumed", async () => {
    const { playback, prepared, read, audio, onPosition, createEngine } = setupPrepared();
    playback.start({ voice, prepared });
    await flush();
    playback.pause();
    const plays = audio.play.mock.calls.length;
    playback.next(); playback.next();
    expect(playback.snapshot()).toMatchObject({ status: "paused", passageIndex: 2, prepared: true });
    expect(onPosition).toHaveBeenLastCalledWith(savedPassages[2]);
    expect(audio.play).toHaveBeenCalledTimes(plays);
    expect(read).toHaveBeenCalledTimes(2);
    playback.resume(); await flush();
    expect(read.mock.calls.slice(2).map(([passage]) => passage.segmentId)).toEqual(["segment-c", "segment-d"]);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("ignores a late IndexedDB read after disposal even when the reader cannot cancel it", async () => {
    const pending = deferred();
    const { playback, prepared, read, audio, urls, createEngine } = setupPrepared({ read: () => pending.promise });
    playback.start({ voice, prepared });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "preparing", prepared: true });
    const signal = read.mock.calls[0][1].signal;
    playback.dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve({ blob: new Blob(["stale"]), duration: 1 });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "idle", prepared: false, passageCount: 0 });
    expect(audio.play).not.toHaveBeenCalled();
    expect(urls.size).toBe(0);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("does not let an old read failure affect a replacement chapter", async () => {
    const pending = deferred();
    const { playback, prepared, audio, createEngine } = setupPrepared({ read: () => pending.promise });
    playback.start({ voice, prepared });
    await flush();
    const replacement = { passages: [savedPassages[3]], read: async passage => ({ blob: new Blob([passage.text]), duration: passage.duration }) };
    playback.start({ voice, prepared: replacement });
    await flush();
    pending.reject(new Error("Old transaction failed"));
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", error: "", prepared: true, passageCount: 1 });
    expect(playback.snapshot().passage.segmentId).toBe("segment-d");
    expect(audio.paused).toBe(false);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("retries an interrupted first read after pausing without consuming its stale result", async () => {
    const pending = deferred();
    let first = true;
    const { playback, prepared, read, audio } = setupPrepared({ read: async passage => {
      if (first) { first = false; return pending.promise; }
      return { blob: new Blob([passage.text]), duration: passage.duration };
    } });
    playback.start({ voice, prepared });
    await flush();
    playback.pause();
    expect(read.mock.calls[0][1].signal.aborted).toBe(true);
    playback.resume(); await flush();
    expect(playback.snapshot().status).toBe("playing");
    const plays = audio.play.mock.calls.length;
    pending.resolve({ blob: new Blob(["Old first read"]), duration: 1 });
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(plays);
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-a", "segment-b"]);
  });

  it("waits for a pending next read when audio finishes before that segment is loaded", async () => {
    const next = deferred();
    const { playback, prepared, audio, read, createEngine } = setupPrepared({ read: passage => passage.segmentId === "segment-b"
      ? next.promise : Promise.resolve({ blob: new Blob([passage.text]), duration: passage.duration }) });
    playback.start({ voice, prepared });
    await flush();
    audio.end();
    expect(playback.snapshot()).toMatchObject({ status: "preparing", passageIndex: 1, prepared: true });
    next.resolve({ blob: new Blob([savedPassages[1].text]), duration: savedPassages[1].duration });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1 });
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(3);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { blob: null, duration: 1 },
    { blob: new Blob([]), duration: 1 },
    { blob: { size: 100 }, duration: 1 },
    { blob: new Blob(["audio"]), duration: NaN },
    { blob: new Blob(["audio"]), duration: 0 },
  ])("reports missing or invalid audio instead of synthesizing it implicitly (%#)", async result => {
    const { playback, prepared, createEngine, onPosition, onEnd } = setupPrepared({ read: async () => result });
    playback.start({ voice, prepared });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "AUDIO_MISSING", prepared: true, passageIndex: 0 });
    expect(createEngine).not.toHaveBeenCalled();
    expect(onPosition).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("reports an independently aborted storage transaction instead of waiting forever", async () => {
    const { playback, prepared, createEngine } = setupPrepared({ read: async () => {
      throw new DOMException("Database transaction aborted", "AbortError");
    } });
    playback.start({ voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "AUDIO_MISSING", prepared: true });
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("does not read or synthesize an empty prepared chapter", async () => {
    const { playback, prepared, read, createEngine } = setupPrepared({ passages: [] });
    playback.start({ voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "empty", prepared: true });
    expect(read).not.toHaveBeenCalled();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("preserves saved segment metadata after a read error and retries through the same provider", async () => {
    let available = false;
    const { playback, prepared, read, createEngine, onPosition } = setupPrepared({ read: async passage => {
      if (!available) throw Object.assign(new Error("Stored segment unavailable"), { code: "VOICE_TEXT_TOO_LONG" });
      return { blob: new Blob([passage.text]), duration: passage.duration };
    } });
    playback.start({ voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "VOICE_TEXT_TOO_LONG", passageCount: 4 });
    expect(read).toHaveBeenCalledOnce();
    available = true;
    playback.resume(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", error: "", passageCount: 4 });
    expect(onPosition).toHaveBeenLastCalledWith(savedPassages[0]);
    expect(prepared.passages).toBe(savedPassages);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("handles autoplay rejection by replaying saved audio after a user gesture", async () => {
    let allowed = false;
    const { playback, prepared, read, createEngine } = setupPrepared({ play: async () => {
      if (!allowed) throw new DOMException("Gesture required", "NotAllowedError");
    } });
    playback.start({ voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "paused", error: "autoplay", prepared: true });
    allowed = true;
    playback.resume(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", error: "" });
    expect(read.mock.calls.filter(([passage]) => passage.segmentId === "segment-a")).toHaveLength(1);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("releases failed media and rereads the same stored segment on decode retry", async () => {
    const { playback, prepared, audio, read, urls, createEngine } = setupPrepared();
    playback.start({ voice, prepared }); await flush();
    audio.dispatchEvent(new Event("error"));
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "playback", prepared: true });
    expect(urls.size).toBe(0);
    playback.resume(); await flush();
    expect(playback.snapshot().status).toBe("playing");
    expect(read.mock.calls.filter(([passage]) => passage.segmentId === "segment-a")).toHaveLength(2);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("reports completion with saved offsets, restarts, and clears prepared mode for live reading", async () => {
    const { playback, prepared, audio, read, createEngine, onEnd, onPosition } = setupPrepared({ passages: [savedPassages[3]] });
    playback.start({ voice, prepared }); await flush();
    audio.end(); audio.end(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", prepared: true });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onPosition).toHaveBeenLastCalledWith({ ...savedPassages[3], completed: true });
    playback.resume(); await flush();
    expect(playback.snapshot().status).toBe("playing");
    expect(read).toHaveBeenCalledTimes(2);
    expect(createEngine).not.toHaveBeenCalled();
    playback.start({ text, voice }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", prepared: false, passageCount: 4 });
    expect(createEngine).toHaveBeenCalledOnce();
  });

  it.each([
    { passages: savedPassages },
    { read: async () => undefined },
    { passages: null, read: async () => undefined },
  ])("fails invalid prepared descriptors without activating synthesis (%#)", async prepared => {
    const { playback, createEngine } = setup();
    playback.start({ text, voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "AUDIO_MISSING", prepared: true });
    expect(createEngine).not.toHaveBeenCalled();
  });
});

describe("listening while sequential preparation continues", () => {
  it("finishes a pending bookmark when the remaining preparation only contains skipped passages", async () => {
    const { playback, prepared, publish, read, onEnd, audio } = setupStreaming();
    playback.start({ text, voice, offset: savedPassages[0].end + 10, prepared }); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    expect(read).not.toHaveBeenCalled();
    publish({ complete: true, status: "ready", skippedSegments: 1 }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", skippedSegments: 1 });
    expect(audio.play).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("updates the skipped-passage notice even without new ready audio, then plays the next saved segment", async () => {
    const { playback, prepared, publish, audio, read } = setupStreaming();
    playback.start({ text, voice, prepared }); await flush();
    publish({ skippedSegments: 1 }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", skippedSegments: 1, passageCount: 1 });
    expect(read).toHaveBeenCalledOnce();
    audio.end(); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    publish({ passages: savedPassages.slice(0, 2), complete: true, status: "ready" }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", skippedSegments: 1, passage: { segmentId: "segment-b" } });
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b"]);
    playback.stop();
    expect(playback.snapshot().skippedSegments).toBe(0);
  });

  it("waits at the ready frontier and resumes as the next segment is published", async () => {
    const { playback, prepared, read, audio, publish, onEnd, onPosition, createEngine } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", prepared: true, preparedComplete: false });
    expect(read).toHaveBeenCalledOnce();
    audio.end(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "buffering", prepared: true, preparationStatus: "preparing", passage: null });
    expect(onEnd).not.toHaveBeenCalled();
    expect(onPosition).toHaveBeenLastCalledWith({ ...savedPassages[0], completed: true });
    publish({ passages: savedPassages.slice(0, 2) }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1 });
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b"]);
    expect(onEnd).not.toHaveBeenCalled();
    audio.end(); await flush();
    publish({ complete: true, status: "ready" }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "ended", preparedComplete: true });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("accepts zero initial ready passages and never starts a second synthesis worker", async () => {
    const { playback, prepared, read, audio, publish, createEngine, onEnd } = setupStreaming({ count: 0 });
    playback.start({ voice, prepared }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "buffering", passageCount: 0, prepared: true });
    expect(read).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    publish({ passages: savedPassages.slice(0, 1) }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0 });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("does not resume after a reader pause even if more audio and completion arrive", async () => {
    const { playback, prepared, read, audio, publish, onEnd } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    audio.end(); await flush();
    playback.pause();
    const plays = audio.play.mock.calls.length;
    publish({ passages: savedPassages.slice(0, 2), complete: true, status: "ready" }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "paused", passageCount: 2, preparedComplete: true });
    expect(audio.play).toHaveBeenCalledTimes(plays);
    expect(read).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
    playback.resume(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1 });
    expect(read).toHaveBeenCalledTimes(2);
    audio.end(); await flush();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("can pause and resume waiting before any audio exists", async () => {
    const { playback, prepared, audio, publish, read } = setupStreaming({ count: 0 });
    playback.start({ voice, prepared }); await flush();
    playback.pause();
    expect(playback.snapshot().status).toBe("paused");
    playback.resume(); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    expect(read).not.toHaveBeenCalled();
    publish({ passages: savedPassages.slice(0, 1) }); await flush();
    expect(audio.paused).toBe(false);
    expect(playback.snapshot().status).toBe("playing");
  });

  it("waits for the saved offset instead of replaying the last available fragment", async () => {
    const { playback, prepared, read, publish, onPosition, createEngine } = setupStreaming();
    playback.start({ voice, prepared, offset: savedPassages[2].start + 4 }); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    expect(read).not.toHaveBeenCalled();
    expect(onPosition).not.toHaveBeenCalled();
    publish({ passages: savedPassages.slice(0, 2) }); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    expect(read).not.toHaveBeenCalled();
    publish({ passages: savedPassages.slice(0, 3) }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 2 });
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-c"]);
    expect(onPosition).toHaveBeenLastCalledWith(savedPassages[2]);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("waits when the bookmark equals the end of the current ready prefix", async () => {
    const { playback, prepared, read, publish } = setupStreaming();
    playback.start({ voice, prepared, offset: savedPassages[0].end }); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    expect(read).not.toHaveBeenCalled();
    publish({ passages: savedPassages.slice(0, 2) }); await flush();
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-b"]);
  });

  it("updates preparation pause/error hints while keeping already saved audio playable", async () => {
    const { playback, prepared, publish, audio, onEnd } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    publish({ status: "paused" }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", preparationStatus: "paused" });
    audio.end(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "buffering", preparationStatus: "paused" });
    const error = { code: "STORAGE_FULL", message: "Storage full" };
    publish({ status: "error", error }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "buffering", preparationStatus: "error", preparationError: error, error: "" });
    expect(onEnd).not.toHaveBeenCalled();
    publish({ passages: savedPassages.slice(0, 2), status: "preparing", error: null }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", preparationStatus: "preparing", preparationError: null });
  });

  it("stops waiting and unsubscribes when preparation is cancelled or deleted", async () => {
    const { playback, prepared, read, publish, audio, unsubscribe, createEngine } = setupStreaming({ count: 0 });
    playback.start({ voice, prepared }); await flush();
    publish(null); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "AUDIO_MISSING", prepared: true });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(audio.paused).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("discards an audio read which completes after cancellation", async () => {
    const pending = deferred();
    const { playback, prepared, read, publish, audio, urls } = setupStreaming({ read: () => pending.promise });
    playback.start({ voice, prepared }); await flush();
    const signal = read.mock.calls[0][1].signal;
    publish(null); await flush();
    expect(signal.aborted).toBe(true);
    pending.resolve({ blob: new Blob(["late"]), duration: 1 }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "AUDIO_MISSING" });
    expect(audio.play).not.toHaveBeenCalled();
    expect(urls.size).toBe(0);
  });

  it("ignores a late manifest and notifications after navigation to another chapter", async () => {
    const pending = deferred();
    const { playback, prepared, getSnapshot, notify, unsubscribe, audio } = setupStreaming({ count: 0 });
    getSnapshot.mockImplementationOnce(() => pending.promise);
    playback.start({ voice, prepared }); await flush();
    const oldSignal = getSnapshot.mock.calls[0][0].signal;
    const replacement = { passages: [savedPassages[3]], read: async passage => ({ blob: new Blob([passage.text]), duration: passage.duration }) };
    playback.start({ voice, prepared: replacement }); await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    pending.resolve({ passages: savedPassages, complete: true });
    notify(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageCount: 1 });
    expect(playback.snapshot().passage.segmentId).toBe("segment-d");
    expect(audio.paused).toBe(false);
  });

  it("coalesces manifest notifications and does not emit unchanged snapshots", async () => {
    const { playback, prepared, getSnapshot, notify, onState, read } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    const events = onState.mock.calls.length;
    const reads = read.mock.calls.length;
    getSnapshot.mockClear();
    for (let i = 0; i < 20; i++) notify();
    await flush();
    expect(getSnapshot.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onState).toHaveBeenCalledTimes(events);
    expect(read).toHaveBeenCalledTimes(reads);
  });

  it("keeps the two-blob bound when a much longer ready prefix is published", async () => {
    const { playback, prepared, publish, read, audio, createEngine } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    publish({ passages: savedPassages, complete: true, status: "ready" }); await flush();
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b"]);
    audio.end(); await flush();
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b", "segment-c"]);
    playback.previous(); await flush();
    expect(read.mock.calls.map(([passage]) => passage.segmentId)).toEqual(["segment-a", "segment-b", "segment-c", "segment-a"]);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("allows explicit previous/next navigation at the frontier without replaying on next", async () => {
    const { playback, prepared, audio, read } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    audio.end(); await flush();
    playback.next(); await flush();
    expect(playback.snapshot().status).toBe("buffering");
    expect(read).toHaveBeenCalledOnce();
    playback.previous(); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports an empty chapter complete only after the completion manifest arrives", async () => {
    const { playback, prepared, publish, onEnd, read, createEngine } = setupStreaming({ count: 0 });
    playback.start({ voice, prepared }); await flush();
    expect(onEnd).not.toHaveBeenCalled();
    playback.pause();
    publish({ complete: true, status: "ready" }); await flush();
    expect(onEnd).not.toHaveBeenCalled();
    expect(playback.snapshot().status).toBe("paused");
    playback.resume(); await flush();
    expect(playback.snapshot().status).toBe("ended");
    expect(onEnd).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("does not announce completion while the final available audio is still playing", async () => {
    const { playback, prepared, publish, audio, onEnd } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    publish({ complete: true, status: "ready" }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", preparedComplete: true });
    expect(onEnd).not.toHaveBeenCalled();
    audio.end(); await flush();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("rejects changes to an already published segment instead of playing mismatched audio", async () => {
    const { playback, prepared, publish, audio, unsubscribe } = setupStreaming();
    playback.start({ voice, prepared }); await flush();
    publish({ passages: [{ ...savedPassages[0], text: "Different edition" }] }); await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "AUDIO_MISSING" });
    expect(audio.paused).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("live speech preparation pipeline", () => {
  const longText = "Un. Deux. Trois. Quatre. Cinq. Six. Sept. Huit.";
  const clip = (words, duration = 1, bytes = null) => ({ blob: new Blob([bytes ? new Uint8Array(bytes) : words]), duration });
  const live = options => setup({ playbackOptions: {}, ...options });

  it("uses the production six-sentence limit and replenishes it as playback advances", async () => {
    const { playback, engines, audio } = live();
    playback.start({ text: longText, voice });
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(6);
    expect(playback.snapshot().preparation).toMatchObject({ phase: "ready", completed: 6, total: 6, bufferedSeconds: 6 });
    audio.end();
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(7);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(playback.snapshot().preparation.bufferedSeconds).toBe(6);
  });

  it("buffers thirty seconds ahead in addition to the current complete sentence", async () => {
    const { playback, engines, audio } = live({ synthesize: async words => clip(words, 15) });
    playback.start({ text: longText, voice });
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(3);
    expect(playback.snapshot().preparation).toMatchObject({ completed: 3, total: 3, bufferedSeconds: 45 });
    audio.end();
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
  });

  it("keeps full current and next sentences even when each exceeds the duration target", async () => {
    const { playback, engines } = live({ synthesize: async words => clip(words, 75) });
    playback.start({ text: longText, voice });
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(2);
    expect(playback.snapshot()).toMatchObject({ status: "playing", preparation: { total: 2, completed: 2, bufferedSeconds: 150 } });
  });

  it.each([1, 2])("does not wait for a forty-second current sentence to end before preparing its successor with concurrency %i", async concurrency => {
    const first = deferred();
    const { playback, audio, engines } = live({ concurrency, synthesize: words => {
      if (words === "Un.") return first.promise;
      return Promise.resolve(clip(words, 15));
    } });
    playback.start({ text: longText, voice });
    await flush();
    expect(engines[0].synthesize.mock.calls.map(([words]) => words)).toEqual(concurrency === 1 ? ["Un."] : ["Un.", "Deux.", "Trois."]);
    expect(audio.play).not.toHaveBeenCalled();
    first.resolve(clip("forty-second current sentence", 40));
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0 });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(engines[0].synthesize.mock.calls.some(([words]) => words === "Deux.")).toBe(true);
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 0, preparation: { bufferedSeconds: 70, completed: 3 } });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(engines[0].synthesize.mock.calls.map(([words]) => words)).toEqual(["Un.", "Deux.", "Trois."]);
    audio.end();
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1 });
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("dispatches the first two sentences in order and starts the first without awaiting the second", async () => {
    const first = deferred(), second = deferred();
    const { playback, engines, audio } = live({ concurrency: 2, synthesize: words => words === "Première phrase." ? first.promise : second.promise });
    playback.start({ text, voice });
    await flush();
    expect(engines[0].synthesize.mock.calls.map(([words]) => words)).toEqual(["Première phrase.", "Deuxième phrase."]);
    expect(audio.play).not.toHaveBeenCalled();
    first.resolve(clip("first", 4));
    await flush();
    expect(playback.snapshot().status).toBe("playing");
    expect(audio.play).toHaveBeenCalledOnce();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(3);
    expect(playback.snapshot().preparation).toMatchObject({ completed: 1, total: 4, bufferedSeconds: 4 });
    playback.stop();
    second.resolve(clip("stale"));
    await flush();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("retains out-of-order ready audio but never plays it before the current sentence", async () => {
    const first = deferred();
    const { playback, audio, engines, urls } = live({ concurrency: 2, synthesize: words => words === "Première phrase." ? first.promise : Promise.resolve(clip(words)) });
    playback.start({ text, voice });
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
    expect(audio.play).not.toHaveBeenCalled();
    expect(playback.snapshot().preparation).toMatchObject({ completed: 3, total: 4, bufferedSeconds: 0 });
    first.resolve(clip("first"));
    await flush();
    expect(await urls.get(audio.src).text()).toBe("first");
    audio.end();
    await flush();
    expect(await urls.get(audio.src).text()).toBe("Deuxième phrase.");
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
  });

  it("never exceeds the engine concurrency even when later sentences complete first", async () => {
    const work = [], pending = new Set();
    let maximum = 0;
    const { playback } = live({ concurrency: 2, synthesize: words => {
      const item = deferred(); work.push({ ...item, words }); pending.add(item);
      maximum = Math.max(maximum, pending.size);
      return item.promise.finally(() => pending.delete(item));
    } });
    playback.start({ text: longText, voice });
    await flush();
    expect(work).toHaveLength(2);
    for (let at = 1; at < 5; at++) {
      work[at].resolve(clip(work[at].words));
      await flush();
      expect(pending.size).toBeLessThanOrEqual(2);
    }
    expect(work).toHaveLength(6);
    expect(maximum).toBe(2);
    playback.stop();
    for (const item of work) item.resolve(clip(item.words));
    await flush();
    expect(playback.snapshot().status).toBe("idle");
  });

  it("warms installed speech silently and reuses both ready audio and the loaded engine", async () => {
    const { playback, engines, createEngine, audio, onPosition } = live();
    const warmed = playback.prepare({ text, voice });
    await flush();
    await expect(warmed).resolves.toMatchObject({ status: "ready", warming: true });
    expect(playback.snapshot()).toMatchObject({ status: "ready", warming: true, preparation: { completed: 4 } });
    expect(audio.play).not.toHaveBeenCalled();
    expect(onPosition).not.toHaveBeenCalled();
    const calls = engines[0].synthesize.mock.calls.length;
    playback.start({ text, voice, rate: 1.25 });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", warming: false, rate: 1.25 });
    expect(createEngine).toHaveBeenCalledOnce();
    expect(engines[0].load).toHaveBeenCalledOnce();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(calls);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(onPosition).toHaveBeenCalledOnce();
    playback.stop();
  });

  it("reuses in-flight warm-up when listening is requested before loading finishes", async () => {
    const loading = deferred();
    const { playback, engines, createEngine, audio } = live({ load: () => loading.promise });
    const warmed = playback.prepare({ text, voice });
    await flush();
    expect(playback.prepare({ text, voice })).toBe(warmed);
    playback.start({ text, voice });
    await flush();
    expect(createEngine).toHaveBeenCalledOnce();
    expect(engines[0].load).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
    loading.resolve();
    await flush();
    await expect(warmed).resolves.toMatchObject({ warming: false });
    expect(engines[0].synthesize).toHaveBeenCalledTimes(4);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("reuses in-flight first-sentence synthesis when silent preparation becomes playback", async () => {
    const first = deferred();
    const { playback, engines, createEngine, audio } = live({ synthesize: words => words === "Première phrase." ? first.promise : Promise.resolve(clip(words)) });
    const warmed = playback.prepare({ text, voice });
    await flush();
    playback.start({ text, voice });
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(1);
    first.resolve(clip("first"));
    await flush();
    await warmed;
    expect(createEngine).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(engines[0].synthesize.mock.calls.filter(([words]) => words === "Première phrase.")).toHaveLength(1);
  });

  it.each(["stop", "pause"])("aborts silent preparation on %s and ignores every late parallel result", async action => {
    const requests = [];
    const { playback, audio, engines, urls } = live({ concurrency: 2, synthesize: () => {
      const request = deferred(); requests.push(request); return request.promise;
    } });
    const warmed = playback.prepare({ text, voice });
    await flush();
    expect(requests).toHaveLength(2);
    playback[action]();
    await expect(warmed).rejects.toMatchObject({ name: "AbortError" });
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    for (const [, options] of engines[0].synthesize.mock.calls) expect(options.signal.aborted).toBe(true);
    for (const request of requests) request.resolve(clip("stale"));
    await flush();
    expect(audio.play).not.toHaveBeenCalled();
    expect(urls.size).toBe(0);
    expect(playback.snapshot()).toMatchObject({ status: action === "stop" ? "idle" : "paused", warming: false });
  });

  it.each([
    { text: "Un autre chapitre.", voice },
    { text, voice: { ...voice, id: "af_heart", language: "en" } },
    { text, voice, offset: text.indexOf("Deuxième") },
  ])("does not reuse warm audio for a changed chapter, voice or position: %j", async request => {
    const { playback, engines, audio } = live();
    await playback.prepare({ text, voice });
    await flush();
    playback.start(request);
    await flush();
    expect(engines).toHaveLength(2);
    expect(engines[0].dispose).toHaveBeenCalledOnce();
    expect(engines[1].load).toHaveBeenCalledWith(request.voice, expect.any(Object));
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("reports actual loading stages, ready counts and elapsed/buffered time", async () => {
    const loading = deferred(), first = deferred();
    let loadingOptions, synthesisOptions, time = 0;
    const { playback, audio } = live({ playbackOptions: { now: () => time },
      load: (_voice, options) => { loadingOptions = options; return loading.promise; },
      synthesize: (_text, options) => { synthesisOptions = options; return first.promise; } });
    const warmed = playback.prepare({ text: "Une phrase.", voice });
    await flush();
    loadingOptions.onProgress({ stage: "loading", loaded: 100, total: 500 });
    time = 1200;
    expect(playback.snapshot().preparation).toMatchObject({ phase: "loading", completed: 0, total: 1, elapsedSeconds: 1.2,
      engineProgress: { stage: "loading", loaded: 100, total: 500 } });
    loading.resolve();
    await flush();
    synthesisOptions.onProgress({ stage: "synthesizing", completedFragments: 1 });
    expect(playback.snapshot().preparation).toMatchObject({ phase: "generating", completed: 0, total: 1, engineProgress: { completedFragments: 1 } });
    first.resolve(clip("whole sentence", 10));
    await warmed;
    await flush();
    expect(playback.snapshot().preparation).toMatchObject({ phase: "ready", completed: 1, total: 1, bufferedSeconds: 10 });
    playback.start({ text: "Une phrase.", voice, rate: 1.25 });
    await flush();
    audio.currentTime = 2.5;
    expect(playback.snapshot().preparation.bufferedSeconds).toBe(6);
    expect(playback.snapshot().preparation.engineProgress?.completedFragments).not.toBe(10);
  });

  it("issues only one play request while the browser has not settled the first promise", async () => {
    const playing = deferred();
    const { playback, audio } = live({ concurrency: 2, play: () => playing.promise });
    playback.start({ text, voice });
    await flush();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(playback.snapshot().preparation.completed).toBe(4);
    playing.resolve();
    await flush();
    expect(playback.snapshot().status).toBe("playing");
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("lets the current sentence finish when a future preparation fails, then offers retry", async () => {
    let failed = true;
    const { playback, audio, engines } = live({ concurrency: 2, synthesize: async words => {
      if (words === "Deuxième phrase." && failed) throw Object.assign(new Error("memory"), { code: "MEMORY" });
      return clip(words);
    } });
    playback.start({ text, voice });
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", error: "", passageIndex: 0 });
    audio.end();
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "error", error: "MEMORY", passageIndex: 1 });
    failed = false;
    playback.resume();
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1, error: "" });
    expect(engines[1].synthesize.mock.calls[0][0]).toBe("Deuxième phrase.");
  });

  it("drops an unexpectedly huge future result without endlessly regenerating it", async () => {
    const { playback, audio, engines } = live({ playbackOptions: { maxBufferBytes: 100_000 },
      synthesize: async words => clip(words, 1, words === "Deuxième phrase." ? 120_000 : 1000) });
    playback.start({ text, voice });
    await flush();
    expect(engines[0].synthesize.mock.calls.map(([words]) => words)).toEqual(["Première phrase.", "Deuxième phrase."]);
    expect(playback.snapshot().preparation.bufferedSeconds).toBe(1);
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledTimes(2);
    audio.end();
    await flush();
    expect(playback.snapshot()).toMatchObject({ status: "playing", passageIndex: 1 });
    expect(engines[0].synthesize.mock.calls.filter(([words]) => words === "Deuxième phrase.")).toHaveLength(2);
    expect(engines[0].synthesize).toHaveBeenCalledTimes(3);
  });

  it("aborts parallel work during seek and cannot play an obsolete result afterward", async () => {
    const requests = [];
    const { playback, engines, audio, urls } = live({ concurrency: 2, synthesize: words => {
      const request = deferred(); requests.push({ ...request, words }); return request.promise;
    } });
    playback.start({ text, voice });
    await flush();
    playback.next();
    await flush();
    expect(engines).toHaveLength(2);
    expect(requests.map(({ words }) => words)).toEqual(["Première phrase.", "Deuxième phrase.", "Deuxième phrase.", "Troisième phrase."]);
    requests[0].resolve(clip("obsolete first"));
    requests[1].resolve(clip("obsolete second"));
    await flush();
    expect(audio.play).not.toHaveBeenCalled();
    requests[2].resolve(clip("current second"));
    await flush();
    expect(await urls.get(audio.src).text()).toBe("current second");
    expect(playback.snapshot().passageIndex).toBe(1);
    playback.stop();
    for (const request of requests) request.resolve(clip("done"));
    await flush();
  });
});
