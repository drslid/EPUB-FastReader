// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createAudioQueue, AUDIO_CONVERSION_LOCK } from "../src/audio-queue.js";
import { createAudioStore } from "../src/audio-store.js";
import { voicePassages } from "../src/voice-text.js";

const voice = { id: "ff_siwis", language: "fr", name: "Siwis" };
const book = (bookId = "first", text = "Bonjour le monde. Une deuxième phrase.") => ({ bookId, title: `Livre ${bookId}`, voice,
  chapters: [{ id: "one", title: "Chapitre 1", text }] });
const audio = () => ({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), duration: 1 });
const waitFor = async predicate => vi.waitFor(async () => { expect(await predicate()).toBeTruthy(); }, { interval: 5, timeout: 3000 });

function fakeLocks() {
  let occupied = false;
  return { request: vi.fn(async (name, options, callback) => {
    expect(name).toBe(AUDIO_CONVERSION_LOCK);
    if (occupied) return callback(null);
    occupied = true;
    try { return await callback({ name }); } finally { occupied = false; }
  }), query: async () => ({ held: occupied ? [{ name: AUDIO_CONVERSION_LOCK }] : [], pending: [] }), get occupied() { return occupied; } };
}
function controlledEngine(concurrency = 1) {
  const pending = [], calls = [];
  let live = 0, maximum = 0;
  const create = vi.fn(() => {
    let closed = false;
    live++; maximum = Math.max(maximum, live);
    return {
      concurrency,
      load: vi.fn(async () => {}),
      synthesize: vi.fn((text, { signal }) => {
        calls.push(text);
        return new Promise((resolve, reject) => {
          const cancel = () => reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", cancel, { once: true });
          pending.push({ text, resolve: value => { signal.removeEventListener("abort", cancel); resolve(value || audio()); }, reject });
        });
      }),
      dispose() { if (!closed) { live--; closed = true; } },
    };
  });
  return { create, calls, pending, get maximum() { return maximum; } };
}
let factory, store, locks, queues;
function queue(extra = {}) {
  const created = createAudioQueue({ store, locks, channelFactory: () => null, createEngine: () => ({ load: async () => {}, synthesize: async () => audio(), dispose() {} }), ...extra });
  queues.push(created); return created;
}
beforeEach(() => { factory = new IDBFactory(); store = createAudioStore({ indexedDB: factory }); locks = fakeLocks(); queues = []; });
afterEach(async () => { for (const item of queues) await item.dispose(); await waitFor(() => !locks.occupied); await store.close(); vi.restoreAllMocks(); });

describe("local audiobook preparation queue", () => {
  it("repairs an interrupted older URL split without regenerating already saved speech", async () => {
    const text = "Un début déjà enregistré. Consultez https://example.org/read?query=bonjour&edition=2. Le récit continue.";
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const input = book("older-url", text), saved = await q.enqueue(input);
    await waitFor(() => engine.pending.length === 1);
    engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    await q.pause(saved.id);
    await waitFor(() => !locks.occupied);
    const first = (await store.getJob(saved.id)).chapters[0].passages[0];
    const firstAudio = await (await q.readSegment(saved.id, first.segmentId)).arrayBuffer();
    await store.mutateJob(saved.id, job => {
      delete job.textPreparationVersion;
      const chapter = job.chapters[0], [beginning, link, ending] = chapter.passages;
      const split = text.indexOf("?") + 1;
      chapter.passages = [beginning,
        { start: link.start, end: split, segmentId: "old-url-start", ready: false },
        { start: split, end: link.end, segmentId: "old-query", ready: false }, ending];
      job.totalSegments = 4;
      job.status = "error";
      job.error = { code: "VOICE_PHONEME_UNSUPPORTED" };
      return job;
    });
    await q.dispose();
    const nextEngine = controlledEngine(), next = queue({ createEngine: nextEngine.create });
    await next.resume(saved.id);
    await waitFor(() => nextEngine.pending.length === 1);
    expect(nextEngine.calls).toEqual(["Consultez https://example.org/read?query=bonjour&edition=2."]);
    nextEngine.pending.shift().resolve();
    await waitFor(() => nextEngine.pending.length === 1);
    expect(nextEngine.calls[1]).toBe("Le récit continue.");
    nextEngine.pending.shift().resolve();
    await waitFor(() => next.snapshot().jobs[0].status === "ready");
    expect((await store.getJob(saved.id)).chapters[0].passages[0]).toEqual(first);
    expect(await (await next.readSegment(saved.id, first.segmentId)).arrayBuffer()).toEqual(firstAudio);
    expect(next.snapshot().jobs[0]).toMatchObject({ totalSegments: 3, completedSegments: 3, skippedSegments: 0 });
  });

  it("skips a bad sentence, publishes the following audio in order, and keeps exact text offsets", async () => {
    const input = book("recovery", "Une adresse illisible. Le récit continue. La fin illisible.");
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const job = await q.enqueue(input);
    await waitFor(() => engine.pending.length === 1);
    engine.pending.shift().reject(Object.assign(new Error("Unsupported text"), { code: "VOICE_PHONEME_UNSUPPORTED" }));
    await waitFor(() => engine.pending.length === 1);
    const waiting = await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text);
    expect(waiting).toMatchObject({ complete: false, skippedSegments: 1, readySegments: 0, passages: [] });
    expect(q.snapshot().jobs[0]).toMatchObject({ status: "preparing", skippedSegments: 1, canListen: false });
    engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    const audible = await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text);
    expect(audible).toMatchObject({ readySegments: 1, skippedSegments: 1 });
    expect(audible.passages[0]).toMatchObject({ text: "Le récit continue.", start: input.chapters[0].text.indexOf("Le récit") });
    engine.pending.shift().reject(Object.assign(new Error("Unsupported text"), { code: "VOICE_TEXT_UNSPLITTABLE" }));
    await waitFor(() => q.snapshot().jobs[0].status === "ready");
    expect(q.snapshot().jobs[0]).toMatchObject({ completedSegments: 3, skippedSegments: 2, progress: 1, canListen: true, audioBytes: 3, audioDuration: 1 });
    const complete = await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text);
    expect(complete).toMatchObject({ complete: true, readySegments: 1, skippedSegments: 2 });
    expect(complete.passages).toEqual(audible.passages);
    const saved = await store.getJob(job.id);
    for (const part of saved.chapters[0].passages.filter(part => part.skipped)) expect(await q.readSegment(job.id, part.segmentId)).toBeNull();
    await q.dispose();
    const restartedEngine = controlledEngine(), restarted = queue({ createEngine: restartedEngine.create });
    expect((await restarted.list()).jobs[0]).toMatchObject({ status: "ready", skippedSegments: 2 });
    await restarted.resume(job.id);
    expect(restartedEngine.create).not.toHaveBeenCalled();
  });

  it("continues beyond a fully skipped chapter without advertising nonexistent audio", async () => {
    const q = queue({ createEngine: () => ({ load: async () => {}, dispose() {}, synthesize: async text => {
      if (text.includes("illisible")) throw Object.assign(new Error("Unsupported text"), { code: "VOICE_PHONEME_UNSUPPORTED" });
      return audio();
    } }) });
    const input = { ...book(), chapters: [{ id: "one", text: "Texte illisible." }, { id: "two", text: "La lecture continue." }] };
    await q.enqueue(input);
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    expect(q.snapshot().jobs[0]).toMatchObject({ completedChapters: 2, skippedSegments: 1, canListen: true, readySegments: 1 });
    expect(await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text))
      .toMatchObject({ complete: true, skippedSegments: 1, passages: [] });
    expect(await q.getPreparedChapter(input.bookId, voice.id, "two", input.chapters[1].text))
      .toMatchObject({ complete: true, skippedSegments: 0, readySegments: 1 });
  });

  it.each(["VOICE_FAILED", "VOICE_NOT_INSTALLED", "VOICE_UNSUPPORTED", "VOICE_TIMEOUT", "STORAGE_FULL"])("does not hide a %s failure by skipping book content", async code => {
    const q = queue({ createEngine: () => ({ load: async () => {}, dispose() {}, synthesize: async () => {
      throw Object.assign(new Error("System failure"), { code });
    } }) });
    await q.enqueue(book());
    await waitFor(() => q.snapshot().jobs[0]?.status === "error");
    expect(q.snapshot().jobs[0]).toMatchObject({ skippedSegments: 0, completedSegments: 0, canListen: false, error: { code } });
  });

  it("does not commit a late text failure after cancellation", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const job = await q.enqueue(book());
    await waitFor(() => engine.pending.length === 1);
    await q.pause(job.id);
    engine.pending.shift().reject(Object.assign(new Error("Unsupported text"), { code: "VOICE_PHONEME_UNSUPPORTED" }));
    await waitFor(() => !locks.occupied);
    expect(q.snapshot().jobs[0]).toMatchObject({ status: "paused", skippedSegments: 0, completedSegments: 0 });
  });

  it("a text error in the second parallel sentence cannot hide the earlier pending sentence", async () => {
    const engine = controlledEngine(2), q = queue({ createEngine: engine.create });
    await q.enqueue(book());
    await waitFor(() => engine.pending.length === 2);
    engine.pending[1].reject(Object.assign(new Error("Unsupported text"), { code: "VOICE_PHONEME_UNSUPPORTED" }));
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 0, skippedSegments: 0 });
    engine.pending[0].resolve();
    await waitFor(() => q.snapshot().jobs[0].status === "ready");
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 1, skippedSegments: 1, completedSegments: 2, audioBytes: 3 });
  });

  it("retains playable old audio and rejects resuming it with a replacement engine", async () => {
    const oldEngine = controlledEngine(), previous = queue({ createEngine: oldEngine.create });
    const input = book();
    const old = await previous.enqueue(input);
    await waitFor(() => oldEngine.pending.length === 1);
    oldEngine.pending.shift().resolve();
    await waitFor(() => oldEngine.pending.length === 1);
    await previous.dispose();
    await waitFor(() => !locks.occupied);
    const original = await store.getJob(old.id);
    const replacement = { id: "piper-fr_FR-siwis-medium", language: "fr", name: "Siwis", modelKey: "piper-medium-v1" };
    const newEngine = controlledEngine();
    const current = queue({ createEngine: newEngine.create, canPrepareVoice: item => item.id === replacement.id });
    expect((await current.list()).jobs[0]).toMatchObject({ id: old.id, status: "unavailable", canPrepare: false, canListen: true, readySegments: 1 });
    await expect(current.resume(old.id)).rejects.toHaveProperty("code", "VOICE_RETIRED");
    await expect(current.enqueue(input)).rejects.toHaveProperty("code", "VOICE_RETIRED");
    expect(newEngine.create).not.toHaveBeenCalled();
    const manifest = await current.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text, { jobId: old.id });
    expect(manifest).toMatchObject({ status: "unavailable", voice, readySegments: 1, complete: false });
    expect(await (await current.readSegment(old.id, manifest.passages[0].segmentId)).arrayBuffer()).toEqual(await audio().blob.arrayBuffer());
    const next = await current.enqueue({ ...input, voice: replacement });
    expect(next.id).not.toBe(old.id);
    await waitFor(() => newEngine.pending.length === 1);
    expect(newEngine.calls).toEqual(["Bonjour le monde."]);
    expect(await store.getJob(old.id)).toEqual(original);
    expect((await current.list()).jobs).toHaveLength(2);
  });

  it("keeps a complete old audiobook available across chapters without loading any engine", async () => {
    const previous = queue();
    const input = { ...book(), chapters: [{ id: "one", text: "Le début." }, { id: "two", text: "La fin." }] };
    const old = await previous.enqueue(input);
    await waitFor(() => previous.snapshot().jobs[0]?.status === "ready");
    await previous.dispose();
    const createEngine = vi.fn();
    const current = queue({ createEngine, canPrepareVoice: () => false });
    expect((await current.list()).jobs[0]).toMatchObject({ status: "ready", canListen: true, canPrepare: false });
    await current.resume(old.id);
    for (const chapter of input.chapters) {
      const saved = await current.getPreparedChapter(input.bookId, voice.id, chapter.id, chapter.text, { jobId: old.id });
      expect(saved).toMatchObject({ complete: true, voice, readySegments: 1 });
      expect((await current.readSegment(old.id, saved.passages[0].segmentId)).size).toBe(3);
    }
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("keeps preparations from different model revisions separate", async () => {
    const q = queue(); await q.suspend("test");
    const current = { ...voice, modelKey: "piper-medium-v1", model: { sha256: "model-first-revision" }, config: { sha256: "config-first-revision" } };
    const first = await q.enqueue({ ...book(), voice: current });
    const second = await q.enqueue({ ...book(), voice: { ...current, model: { sha256: "model-second-revision" } } });
    const third = await q.enqueue({ ...book(), voice: { ...current, config: { sha256: "config-second-revision" } } });
    expect(first.id).not.toBe(second.id);
    expect(third.id).not.toBe(first.id);
    expect((await q.list()).jobs).toHaveLength(3);
  });

  it("prepares two sentences concurrently while publishing the first without waiting for the second", async () => {
    const engine = controlledEngine(2), q = queue({ createEngine: engine.create });
    await q.enqueue(book());
    await q.enqueue(book("second", "Le prochain livre attend."));
    await waitFor(() => engine.pending.length === 2);
    const [first, second] = engine.pending.splice(0);
    expect(engine.calls).toEqual(["Bonjour le monde.", "Une deuxième phrase."]);
    first.resolve();
    await waitFor(() => q.snapshot().jobs[0].readySegments === 1);
    expect(q.snapshot().jobs[0].canListen).toBe(true);
    expect(q.snapshot().jobs[1].status).toBe("queued");
    second.resolve();
    await waitFor(() => engine.pending.length === 1);
    expect(q.snapshot().jobs[0].status).toBe("ready");
    engine.pending.shift().resolve();
    await waitFor(() => q.snapshot().jobs.every(job => job.status === "ready"));
    expect(engine.maximum).toBe(1);
  });

  it("never exposes a later parallel result before its first sentence, or commits it after cancellation", async () => {
    const engine = controlledEngine(2), q = queue({ createEngine: engine.create });
    const job = await q.enqueue(book());
    await waitFor(() => engine.pending.length === 2);
    engine.pending[1].resolve();
    await q.list();
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 0, canListen: false });
    await q.pause(job.id);
    await waitFor(() => !locks.occupied);
    expect((await store.getJob(job.id)).completedSegments).toBe(0);
    expect(q.snapshot().jobs[0].status).toBe("paused");
  });

  it("retains the first sentence and reports a failure of the next concurrent generation", async () => {
    const engine = controlledEngine(2), q = queue({ createEngine: engine.create });
    await q.enqueue(book());
    await waitFor(() => engine.pending.length === 2);
    engine.pending[1].reject(Object.assign(new Error("Worker failed"), { code: "VOICE_FAILED" }));
    engine.pending[0].resolve();
    await waitFor(() => q.snapshot().jobs[0].status === "error");
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 1, canListen: true, error: { code: "VOICE_FAILED" } });
  });

  it("prepares books sequentially and records character, chapter and audio progress", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const first = await q.enqueue(book());
    await q.enqueue(book("second", "Un autre livre."));
    await waitFor(() => engine.pending.length === 1);
    expect(q.snapshot().jobs[1].status).toBe("queued");
    engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    expect(q.snapshot().jobs[0]).toMatchObject({ completedSegments: 1, totalSegments: 2, audioBytes: 3, readySegments: 1, canListen: true });
    engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    expect(engine.calls[2]).toBe("Un autre livre.");
    engine.pending.shift().resolve();
    await waitFor(() => q.snapshot().jobs.every(job => job.status === "ready"));
    expect(engine.maximum).toBe(1);
    expect(q.snapshot().jobs.find(job => job.id === first.id)).toMatchObject({ progress: 1, completedChapters: 1, audioDuration: 2, audioBytes: 6 });
  });

  it("deduplicates the same book and voice; a different edition gets a separate conversion", async () => {
    const q = queue(); await q.suspend("test");
    const [a, b] = await Promise.all([q.enqueue(book()), q.enqueue(book())]);
    expect(a.id).toBe(b.id);
    expect((await q.list()).jobs).toHaveLength(1);
    await q.enqueue(book("first", "Texte révisé."));
    await q.enqueue({ ...book(), voice: { ...voice, id: "other" } });
    expect((await q.list()).jobs).toHaveLength(3);
  });

  it("prepares complete natural sentences instead of exposing a 180-character cut", async () => {
    const sentence = "Camille retrouve le plaisir de parcourir une histoire, pendant que les prochaines phrases se préparent tranquillement sur son appareil, et elle prend le temps de comprendre les personnages avant de commencer le chapitre suivant.";
    const calls = [];
    const q = queue({ createEngine: () => ({ load: async () => {}, dispose() {}, synthesize: async text => { calls.push(text); return audio(); } }) });
    await q.enqueue(book("natural", `${sentence}\n\nUne deuxième\nphrase continue ici.`));
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    expect(calls).toEqual([sentence, "Une deuxième\nphrase continue ici."]);
    expect(q.snapshot().jobs[0]).toMatchObject({ segmentationVersion: 2, totalSegments: 2 });
  });

  it("creates version 2 explicitly while retaining readable version 1 passages and pinned manifests", async () => {
    const text = "Un lecteur attentif parcourt les pages de son livre et découvre les personnages, leurs aventures, leurs doutes et leurs espoirs, puis il prend quelques instants pour comprendre ce que cette longue histoire lui raconte avant de poursuivre sa lecture.";
    const q = queue(); await q.suspend("test");
    const current = await q.enqueue(book("versions", text));
    const legacy = structuredClone(await store.getJob(current.id));
    delete legacy.segmentationVersion;
    legacy.id = "legacy-conversion";
    legacy.controlOwner = "legacy-owner";
    legacy.status = "preparing";
    legacy.chapters[0].passages = voicePassages(text, "fr", 180).map(({ start, end }, index) => ({ start, end, segmentId: `legacy-${index}`, ready: false }));
    legacy.totalSegments = legacy.chapters[0].passages.length;
    legacy.totalChars = legacy.chapters[0].passages.reduce((sum, passage) => sum + passage.end - passage.start, 0);
    await store.putIfAbsent(legacy);
    await store.acquireLease("legacy-owner", Date.now());
    for (const passage of legacy.chapters[0].passages) {
      await store.commitSegment(legacy.id, { ...audio(), chapterId: "one", segmentId: passage.segmentId }, "legacy-owner", Date.now());
    }
    await store.releaseLease("legacy-owner");
    const savedLegacy = await store.getJob(legacy.id);
    const pinned = await q.getPreparedChapter("versions", voice.id, "one", text, { jobId: legacy.id });
    expect(pinned).toMatchObject({ segmentationVersion: 1, complete: true, jobId: legacy.id });
    expect(pinned.passages.length).toBeGreaterThan(1);
    for (const passage of pinned.passages) expect((await q.readSegment(legacy.id, passage.segmentId)).size).toBe(3);
    // Explicit new preparations take precedence, even while the older format
    // has more ready segments. Listening pinned to that old job stays valid.
    expect(await q.getPreparedChapter("versions", voice.id, "one", text)).toMatchObject({ segmentationVersion: 2, jobId: current.id, complete: false });
    q.unsuspend("test");
    await waitFor(() => q.snapshot().jobs.find(job => job.id === current.id)?.status === "ready");
    expect(await q.getPreparedChapter("versions", voice.id, "one", text)).toMatchObject({ segmentationVersion: 2, readySegments: 1 });
    expect(await store.getJob(legacy.id)).toEqual(savedLegacy);
    expect((await q.list()).jobs).toHaveLength(2);
    expect((await q.enqueue(book("versions", text))).id).toBe(current.id);
    expect(await q.getPreparedChapter("versions", voice.id, "one", text, { jobId: legacy.id })).toEqual(pinned);
  });

  it("persists every passage and resumes only missing audio after a reload and explicit resume", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const job = await q.enqueue(book());
    await waitFor(() => engine.pending.length === 1); engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    await q.dispose();
    await waitFor(() => !locks.occupied);
    const nextEngine = controlledEngine(), next = queue({ createEngine: nextEngine.create });
    const loaded = await next.list();
    expect(loaded.jobs[0]).toMatchObject({ status: "paused", completedSegments: 1 });
    expect(nextEngine.create).not.toHaveBeenCalled();
    await next.resume(job.id);
    await waitFor(() => nextEngine.pending.length === 1);
    expect(nextEngine.calls).toEqual(["Une deuxième phrase."]);
    nextEngine.pending.shift().resolve();
    await waitFor(() => next.snapshot().jobs[0].status === "ready");
  });

  it("restores abandoned queued/preparing jobs as paused without changing another tab's active jobs", async () => {
    const q = queue(); await q.suspend("test");
    const job = await q.enqueue(book());
    await q.dispose();
    await store.mutateJob(job.id, value => ({ ...value, status: "preparing", controlOwner: "abandoned" }));
    const resumed = queue();
    expect((await resumed.list()).jobs[0].status).toBe("paused");
    await store.acquireLease("abandoned", Date.now());
    // A leftover lease alone must not pretend a closed tab is still working.
    expect((await resumed.list()).jobs[0].status).toBe("paused");
    let release;
    const held = locks.request(AUDIO_CONVERSION_LOCK, {}, () => new Promise(resolve => { release = resolve; }));
    expect((await resumed.list()).jobs[0].status).toBe("preparing");
    release(); await held;
    await store.releaseLease("abandoned");
  });

  it("resumes immediately after an old tab closed, without waiting for its database lease to expire", async () => {
    const q = queue(); await q.suspend("test"); const job = await q.enqueue(book("lease", "Bonjour."));
    await q.dispose();
    await store.acquireLease("closed-tab", Date.now(), 60000);
    const next = queue(); await next.resume(job.id);
    await waitFor(() => next.snapshot().jobs[0]?.status === "ready");
    expect(next.snapshot().jobs[0].completedSegments).toBe(1);
  });

  it("pauses immediately, keeps completed audio and ignores stale generation results", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const job = await q.enqueue(book());
    await waitFor(() => engine.pending.length === 1); engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    const late = engine.pending.shift();
    await q.pause(job.id); late.resolve();
    await waitFor(() => !locks.occupied);
    expect((await q.list()).jobs[0]).toMatchObject({ status: "paused", completedSegments: 1 });
    expect((await store.getJob(job.id)).audioBytes).toBe(3);
  });

  it("suspends for live listening, releases its lock, and resumes once all reasons clear", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    await q.enqueue(book()); await waitFor(() => engine.pending.length === 1);
    await q.suspend("live");
    expect(locks.occupied).toBe(false);
    await q.suspend("hidden"); q.unsuspend("live");
    expect(engine.create).toHaveBeenCalledTimes(1);
    q.unsuspend("hidden");
    await waitFor(() => engine.create.mock.calls.length === 2);
    expect(engine.maximum).toBe(1);
  });

  it("can cancel while the model loads without starting synthesis or retaining its lock", async () => {
    let loading = false;
    const synthesize = vi.fn();
    const q = queue({ createEngine: () => ({
      load: (_voice, { signal }) => { loading = true; return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })); },
      synthesize, dispose() {},
    }) });
    const job = await q.enqueue(book()); await waitFor(() => loading);
    await q.cancel(job.id); await waitFor(() => !locks.occupied);
    expect(synthesize).not.toHaveBeenCalled();
    expect(q.snapshot().jobs).toHaveLength(0);
  });

  it("serializes conversions from two independent queue instances sharing the origin", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create }), other = queue({ createEngine: engine.create });
    await q.enqueue(book("a", "Premier.")); await waitFor(() => engine.pending.length === 1);
    const next = await other.enqueue(book("b", "Second."));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(engine.calls).toEqual(["Premier."]);
    engine.pending.shift().resolve(); await waitFor(() => !locks.occupied);
    await other.resume(next.id); await waitFor(() => engine.pending.length === 1);
    expect(engine.calls).toEqual(["Premier.", "Second."]);
    engine.pending.shift().resolve(); await waitFor(() => other.snapshot().jobs.every(job => job.status === "ready"));
    expect(engine.maximum).toBe(1);
  });

  it("refuses unsafe multi-tab conversion on browsers without Web Locks", async () => {
    const engine = controlledEngine(), q = queue({ locks: null, createEngine: engine.create });
    await q.enqueue(book());
    await waitFor(() => q.snapshot().jobs[0]?.status === "error");
    expect(q.snapshot().jobs[0].error.code).toBe("COORDINATION_UNAVAILABLE");
    expect(engine.create).not.toHaveBeenCalled();
  });

  it("checks estimated disk space before loading the model", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create, storage: { estimate: async () => ({ quota: 1000000, usage: 999999 }) } });
    await q.enqueue(book());
    await waitFor(() => q.snapshot().jobs[0]?.status === "error");
    expect(q.snapshot().jobs[0].error.code).toBe("STORAGE_FULL");
    expect(engine.create).not.toHaveBeenCalled();
  });

  it("checks actual remaining space again before writing each generated chunk", async () => {
    const estimate = vi.fn().mockResolvedValueOnce({ quota: 100000000, usage: 0 }).mockResolvedValue({ quota: 100000000, usage: 99999999 });
    const q = queue({ storage: { estimate } }); await q.enqueue(book());
    await waitFor(() => q.snapshot().jobs[0]?.status === "error");
    expect(q.snapshot().jobs[0]).toMatchObject({ completedSegments: 0, audioBytes: 0, error: { code: "STORAGE_FULL" } });
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it("preserves prior passages on a real quota error and resumes successfully after space is freed", async () => {
    const original = store.commitSegment;
    let full = false;
    vi.spyOn(store, "commitSegment").mockImplementation(async (...args) => {
      if (full) throw new DOMException("Full", "QuotaExceededError");
      const value = await original(...args); full = true; return value;
    });
    const q = queue(); const job = await q.enqueue(book());
    await waitFor(() => q.snapshot().jobs[0]?.status === "error");
    expect(q.snapshot().jobs[0]).toMatchObject({ completedSegments: 1, audioBytes: 3, error: { code: "STORAGE_FULL" } });
    full = false; await q.resume(job.id);
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    expect(q.snapshot().jobs[0].completedSegments).toBe(2);
  });

  it("returns growing prepared prefixes only for exactly matching book text", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const input = book(); await q.enqueue(input);
    await waitFor(() => engine.pending.length === 1); engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    const partial = await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text);
    expect(partial).toMatchObject({ complete: false, readySegments: 1, totalSegments: 2, duration: 1, status: "preparing" });
    expect(partial.passages.map(item => item.text)).toEqual(["Bonjour le monde."]);
    engine.pending.shift().resolve(); await waitFor(() => q.snapshot().jobs[0].status === "ready");
    const prepared = await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text);
    expect(prepared).toMatchObject({ complete: true, readySegments: 2, status: "ready" });
    expect(prepared.passages[0]).toEqual(partial.passages[0]);
    expect(prepared.passages.map(item => item.text)).toEqual(["Bonjour le monde.", "Une deuxième phrase."]);
    expect((await q.readSegment(prepared.jobId, prepared.passages[0].segmentId)).size).toBe(3);
    expect(await q.getPreparedChapter(input.bookId, voice.id, "one", "Une autre édition.")).toBeNull();
    expect(await q.getPreparedChapter(input.bookId, "another-voice", "one", input.chapters[0].text)).toBeNull();
  });

  it("identifies a queued chapter before any audio exists without starting another worker", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    await q.suspend("test");
    const input = book(), job = await q.enqueue(input);
    expect(await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text)).toMatchObject({
      jobId: job.id, passages: [], readySegments: 0, totalSegments: 2, complete: false, status: "queued", duration: 0,
    });
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 0, canListen: false });
    expect(engine.create).not.toHaveBeenCalled();
  });

  it("never exposes audio beyond a missing passage in the prepared prefix", async () => {
    const text = "Première phrase. Deuxième phrase. Troisième phrase.", q = queue();
    const job = await q.enqueue(book("gap", text));
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    await store.mutateJob(job.id, item => {
      item.chapters[0].passages[1].ready = false;
      return item;
    });
    const manifest = await q.getPreparedChapter("gap", voice.id, "one", text);
    expect(manifest).toMatchObject({ readySegments: 1, totalSegments: 3, complete: false, duration: 1 });
    expect(manifest.passages.map(item => item.text)).toEqual(["Première phrase."]);
    expect((await q.list()).jobs[0]).toMatchObject({ completedSegments: 3, readySegments: 1, canListen: true });
    await store.mutateJob(job.id, item => { item.chapters[0].passages[0].ready = false; return item; });
    expect((await q.list()).jobs[0]).toMatchObject({ readySegments: 0, canListen: false });
  });

  it("keeps partial audio available while paused or failed, and invalidates it when cancelled", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const input = book(), job = await q.enqueue(input);
    await waitFor(() => engine.pending.length === 1); engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    await q.pause(job.id);
    const read = () => q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text, { jobId: job.id });
    expect(await read()).toMatchObject({ complete: false, readySegments: 1, status: "paused" });
    await store.mutateJob(job.id, item => ({ ...item, status: "error", error: { code: "STORAGE_FULL", message: "Full" } }));
    const failed = await read();
    expect(failed).toMatchObject({ complete: false, readySegments: 1, status: "error", error: { code: "STORAGE_FULL" } });
    expect((await q.readSegment(job.id, failed.passages[0].segmentId)).size).toBe(3);
    await q.cancel(job.id);
    expect(await read()).toBeNull();
  });

  it("pins a listening session to its chosen preparation even when another edition has more audio", async () => {
    const q = queue();
    const input = { ...book(), chapters: [{ id: "one", text: "Même introduction." }, { id: "two", text: "Ancienne édition." }] };
    const complete = await q.enqueue(input);
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    await q.suspend("test");
    const newer = await q.enqueue({ ...input, chapters: [input.chapters[0], { id: "two", text: "Nouvelle édition." }] });
    expect(await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text)).toMatchObject({ jobId: complete.id, complete: true });
    expect(await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text, { jobId: newer.id })).toMatchObject({ jobId: newer.id, complete: false, passages: [] });
    expect(await q.getPreparedChapter("another-book", voice.id, "one", input.chapters[0].text, { jobId: newer.id })).toBeNull();
    expect(await q.getPreparedChapter(input.bookId, voice.id, "one", input.chapters[0].text, { jobId: "deleted-job" })).toBeNull();
  });

  it("makes a finished chapter available while later chapters are still being prepared", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    await q.enqueue({ ...book(), chapters: [{ id: "one", text: "Bonjour." }, { id: "two", text: "La suite." }] });
    await waitFor(() => engine.pending.length === 1); engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    expect(await q.getPreparedChapter("first", voice.id, "one", "Bonjour.")).toMatchObject({ duration: 1 });
    expect(await q.getPreparedChapter("first", voice.id, "two", "La suite.")).toMatchObject({ complete: false, passages: [], readySegments: 0 });
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 1, canListen: true, chapters: [{ readySegments: 1 }, { readySegments: 0 }] });
  });

  it("keeps a failed book resumable and proceeds to the next queued book", async () => {
    const q = queue({ createEngine: () => ({ load: async () => {}, dispose() {}, synthesize: async text => {
      if (text === "Erreur.") throw Object.assign(new Error("Failed"), { code: "VOICE_FAILED" });
      return audio();
    } }) });
    await q.suspend("test");
    await q.enqueue(book("error", "Erreur.")); await q.enqueue(book("good", "Bonjour."));
    q.unsuspend("test");
    await waitFor(() => q.snapshot().jobs.some(job => job.bookId === "good" && job.status === "ready"));
    expect(q.snapshot().jobs.find(job => job.bookId === "error")).toMatchObject({ status: "error", completedSegments: 0 });
  });

  it("adapts passages that expand past model context without losing text offsets", async () => {
    const text = "1234567890 1234567890 1234567890 1234567890";
    const spoken = [];
    const q = queue({ createEngine: () => ({ load: async () => {}, dispose() {}, synthesize: async value => {
      if (value.length > 15) throw Object.assign(new Error("Too long"), { code: "VOICE_TEXT_TOO_LONG" });
      spoken.push(value); return audio();
    } }) });
    await q.enqueue(book("numbers", text));
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    expect(spoken).toEqual(Array(4).fill("1234567890"));
    const prepared = await q.getPreparedChapter("numbers", voice.id, "one", text);
    expect(prepared.passages.map(passage => text.slice(passage.start, passage.end))).toEqual(spoken);
    expect(q.snapshot().jobs[0].progress).toBe(1);
  });

  it("cancels a book without allowing its late result to restore deleted audio", async () => {
    const engine = controlledEngine(), q = queue({ createEngine: engine.create });
    const job = await q.enqueue(book()); await waitFor(() => engine.pending.length === 1);
    const late = engine.pending.shift(); await q.cancel(job.id); late.resolve();
    await waitFor(() => !locks.occupied);
    expect((await q.list()).jobs).toHaveLength(0);
    expect(await store.getJob(job.id)).toBeUndefined();
  });

  it("clears prepared and queued audio, stops conversion, and allows a fresh preparation", async () => {
    const engine = controlledEngine(), onClear = vi.fn();
    const q = queue({ createEngine: engine.create, onClear });
    const first = await q.enqueue(book());
    await waitFor(() => engine.pending.length === 1);
    engine.pending.shift().resolve();
    await waitFor(() => engine.pending.length === 1);
    const saved = await q.getPreparedChapter("first", voice.id, "one", book().chapters[0].text);
    expect(saved.readySegments).toBe(1);
    await q.enqueue(book("queued", "Ce livre attend."));
    const late = engine.pending.shift();
    await q.clearAll();
    late.resolve();
    await waitFor(() => !locks.occupied);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(q.snapshot()).toMatchObject({ jobs: [], activeJobId: null });
    expect(await store.listJobs()).toEqual([]);
    expect(await q.readSegment(first.id, saved.passages[0].segmentId)).toBeNull();
    expect(await q.getPreparedChapter("first", voice.id, "one", book().chapters[0].text)).toBeNull();

    await q.enqueue(book("fresh", "Nouvelle lecture."));
    await waitFor(() => engine.pending.length === 1);
    expect(engine.pending[0].text).toBe("Nouvelle lecture.");
    engine.pending.shift().resolve();
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    expect(q.snapshot().jobs.map(job => job.bookId)).toEqual(["fresh"]);
    expect(engine.maximum).toBe(1);
  });

  it("invalidates an enqueue that is still hashing the book when audio is cleared", async () => {
    const q = queue();
    await q.suspend("test");
    const original = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let releaseHash;
    const gate = new Promise(resolve => { releaseHash = resolve; });
    const hashing = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
      await gate;
      return original(...args);
    });
    const enqueuing = q.enqueue(book("delayed"));
    const result = enqueuing.then(value => ({ value }), error => ({ error }));
    await waitFor(() => hashing.mock.calls.length === 1);
    await q.clearAll();
    releaseHash();
    expect((await result).error).toBeInstanceOf(Error);
    expect(await store.listJobs()).toEqual([]);
    expect((await q.list()).jobs).toEqual([]);
    await q.enqueue(book("new"));
    expect((await q.list()).jobs.map(job => job.bookId)).toEqual(["new"]);
  });

  it("blocks a delayed cross-tab insertion even before a clear notification arrives", async () => {
    const q = queue(), other = queue();
    await q.suspend("test");
    await other.suspend("test");
    const original = store.putIfAbsent;
    let releaseInsert;
    const gate = new Promise(resolve => { releaseInsert = resolve; });
    const inserting = vi.spyOn(store, "putIfAbsent").mockImplementationOnce(async (...args) => {
      await gate;
      return original(...args);
    });
    const result = q.enqueue(book("delayed")).then(value => ({ value }), error => ({ error }));
    await waitFor(() => inserting.mock.calls.length === 1);
    await other.clearAll();
    releaseInsert();
    expect((await result).error).toBeInstanceOf(Error);
    expect(await store.listJobs()).toEqual([]);
    expect((await q.list()).jobs).toEqual([]);
    await q.enqueue(book("fresh"));
    expect((await q.list()).jobs.map(job => job.bookId)).toEqual(["fresh"]);
  });

  it("notifies another open queue to stop conversion and release listening resources", async () => {
    const channels = new Set(), messages = [];
    const channelFactory = () => {
      const channel = {
        onmessage: null,
        postMessage(message) {
          messages.push(message);
          for (const peer of channels) if (peer !== channel) {
            queueMicrotask(() => peer.onmessage?.({ data: structuredClone(message) }));
          }
        },
        close() { channels.delete(channel); },
      };
      channels.add(channel);
      return channel;
    };
    const localCleared = vi.fn(), remoteCleared = vi.fn(), engine = controlledEngine();
    const other = queue({ channelFactory, onClear: remoteCleared, createEngine: engine.create });
    await other.enqueue(book());
    await waitFor(() => engine.pending.length === 1);
    const late = engine.pending.shift();
    const q = queue({ channelFactory, onClear: localCleared });
    await q.list();
    await q.clearAll();
    await waitFor(() => remoteCleared.mock.calls.length === 1 && !locks.occupied);
    late.resolve();
    expect(localCleared).toHaveBeenCalledTimes(1);
    expect(messages.some(message => message.type === "cleared")).toBe(true);
    expect(other.snapshot()).toMatchObject({ jobs: [], activeJobId: null });
    expect((await other.list()).jobs).toEqual([]);
    expect(await store.listJobs()).toEqual([]);
  });

  it("keeps saved audio recoverable and exposes a failed clear instead of claiming success", async () => {
    const q = queue();
    const first = await q.enqueue(book("keep", "Bonjour."));
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    const prepared = await q.getPreparedChapter("keep", voice.id, "one", "Bonjour.");
    vi.spyOn(store, "clearAll").mockRejectedValueOnce(new DOMException("Storage unavailable", "UnknownError"));
    await expect(q.clearAll()).rejects.toHaveProperty("name", "UnknownError");
    expect((await q.list()).jobs).toMatchObject([{ id: first.id, status: "ready", audioBytes: 3 }]);
    expect((await q.readSegment(first.id, prepared.passages[0].segmentId)).size).toBe(3);
    await q.clearAll();
    expect((await q.list()).jobs).toEqual([]);
  });

  it("never republishes an old refresh after the audio cache has been cleared", async () => {
    const q = queue();
    await q.enqueue(book("old", "Bonjour."));
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready" && !locks.occupied);
    const original = store.listJobs;
    let captured = false, releaseRead;
    const gate = new Promise(resolve => { releaseRead = resolve; });
    vi.spyOn(store, "listJobs").mockImplementationOnce(async () => {
      const oldJobs = await original();
      captured = true;
      await gate;
      return oldJobs;
    });
    const staleRefresh = q.list();
    await waitFor(() => captured);
    await q.clearAll();
    expect(q.snapshot()).toMatchObject({ jobs: [], activeJobId: null });
    const updates = [];
    const unsubscribe = q.subscribe(snapshot => updates.push(snapshot.jobs.map(job => job.bookId)));
    releaseRead();
    expect((await staleRefresh).jobs).toEqual([]);
    expect(q.snapshot()).toMatchObject({ jobs: [], activeJobId: null });
    expect(updates.every(jobs => jobs.length === 0)).toBe(true);
    expect(await store.listJobs()).toEqual([]);
    unsubscribe();
  });

  it("filters punctuation-only chapters and rejects books with no pronounceable text", async () => {
    const q = queue();
    await expect(q.enqueue(book("empty", "... — !!"))).rejects.toHaveProperty("code", "VOICE_EMPTY_TEXT");
    await q.enqueue({ ...book(), chapters: [{ id: "empty", text: "..." }, { id: "full", text: "Bonjour." }] });
    await waitFor(() => q.snapshot().jobs[0]?.status === "ready");
    expect(q.snapshot().jobs[0]).toMatchObject({ completedChapters: 2, totalChapters: 2 });
    expect(await q.getPreparedChapter("first", voice.id, "empty", "...")).toMatchObject({ complete: true, passages: [], totalSegments: 0 });
    expect(q.snapshot().jobs[0]).toMatchObject({ readySegments: 1, canListen: true });
  });
});
