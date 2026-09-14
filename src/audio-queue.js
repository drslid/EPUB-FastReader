import { voicePassages, splitVoicePassage } from "./voice-text.js";
import { createAudioStore } from "./audio-store.js";

export const AUDIO_CONVERSION_LOCK = "fastreader-local-speech";
const pronounceable = text => /[\p{L}\p{N}]/u.test(text);
const errorInfo = error => ({ code: error?.name === "QuotaExceededError" ? "STORAGE_FULL" : error?.code || "VOICE_FAILED", message: String(error?.message || "Audio preparation failed") });
const failure = (code, message) => Object.assign(new Error(message), { code });

function readyPrefix(chapter) {
  const firstMissing = chapter.passages.findIndex(passage => !passage.ready || !Number.isFinite(passage.duration) || passage.duration <= 0);
  return chapter.passages.slice(0, firstMissing < 0 ? chapter.passages.length : firstMissing);
}

async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}
function splitPassage(passage, text) {
  if ((passage.depth || 0) >= 8) return [];
  return splitVoicePassage({ ...passage, text: text.slice(passage.start, passage.end) })
    .map(({ start, end }) => ({ start, end, depth: (passage.depth || 0) + 1 }));
}

/** Persistent preparation is deliberately opt-in after every page reload. */
export function createAudioQueue({
  createEngine,
  store = createAudioStore(),
  storage = globalThis.navigator?.storage,
  locks = globalThis.navigator?.locks,
  channelFactory = name => typeof BroadcastChannel === "function" ? new BroadcastChannel(name) : null,
  now = () => Date.now(),
} = {}) {
  const owner = globalThis.crypto.randomUUID();
  const listeners = new Set(), eligible = new Set(), suspensions = new Set(), failures = new Map();
  let records = [], lease = null, active = null, pumping = false, disposed = false, retryTimer = null, lockCycle = null, speechLockHeld = null;
  const channel = channelFactory("fastreader-audio-queue");
  channel?.unref?.();

  function summary(job) {
    let status = job.status;
    if (failures.has(job.id)) status = "error";
    if (["queued", "preparing"].includes(status)) {
      const isLocal = eligible.has(job.id) || active?.jobId === job.id;
      const isRemote = speechLockHeld !== false && lease?.owner === job.controlOwner && lease.expires > now();
      if (!isLocal && !isRemote) status = "paused";
    }
    const chapters = job.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, complete: chapter.complete,
      completedSegments: chapter.completedSegments, totalSegments: chapter.passages.length, audioDuration: chapter.audioDuration,
      readySegments: readyPrefix(chapter).length }));
    let readySegments = 0;
    for (const chapter of chapters) {
      readySegments += chapter.readySegments;
      if (!chapter.complete || chapter.readySegments !== chapter.totalSegments) break;
    }
    return {
      id: job.id, bookId: job.bookId, title: job.title, voice: job.voice, status, segmentationVersion: job.segmentationVersion || 1,
      progress: job.totalChars ? Math.min(1, job.completedChars / job.totalChars) : 0,
      completedSegments: job.completedSegments, totalSegments: job.totalSegments,
      readySegments, canListen: readySegments > 0,
      completedChars: job.completedChars, totalChars: job.totalChars,
      completedChapters: job.completedChapters, totalChapters: job.chapters.length,
      audioBytes: job.audioBytes, audioDuration: job.audioDuration, error: failures.get(job.id) || job.error || null,
      createdAt: job.createdAt, updatedAt: job.updatedAt,
      chapters,
    };
  }
  function snapshot() {
    return { jobs: records.map(summary), activeJobId: active?.jobId || null, suspended: [...suspensions] };
  }
  function emit() { const value = snapshot(); for (const listener of listeners) listener(value); }
  async function refresh(broadcast = false) {
    [records, lease] = await Promise.all([store.listJobs(), store.getLease()]);
    if (locks?.query) {
      try { speechLockHeld = (await locks.query()).held.some(lock => lock.name === AUDIO_CONVERSION_LOCK); }
      catch { speechLockHeld = null; }
    }
    records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    if (active) {
      const current = records.find(job => job.id === active.jobId);
      if (!current || current.controlOwner !== owner || current.status === "paused") {
        eligible.delete(active.jobId);
        abortActive();
      }
    }
    if (!disposed) emit();
    if (broadcast && !disposed) channel?.postMessage({ type: "changed" });
    return snapshot();
  }
  const initialized = refresh().catch(() => {});
  if (channel) channel.onmessage = () => { void refresh().catch(() => {}); };

  function abortActive() {
    active?.controller.abort();
    active?.engine?.dispose();
  }
  async function checkSpace(required) {
    if (!storage?.estimate) return;
    let estimate;
    try { estimate = await storage.estimate(); } catch { return; }
    if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage) && estimate.quota > 0 &&
        estimate.quota - estimate.usage < required + Math.min(8 * 1024 * 1024, estimate.quota * 0.02)) {
      throw failure("STORAGE_FULL", "Not enough device storage. Remove prepared audio or other data, then resume.");
    }
  }
  async function prepare(jobId) {
    if (disposed || suspensions.size || !eligible.has(jobId)) return;
    // The Web Lock proves any previous worker has gone away, including a tab
    // closed moments ago. Its old database lease need not delay explicit resume.
    const claimed = await store.acquireLease(owner, now(), 60000, true);
    if (!claimed) return false;
    let heartbeat;
    const session = { jobId, controller: new AbortController(), engine: null };
    active = session;
    const signal = session.controller.signal;
    try {
      let job = await store.mutateJob(jobId, current => {
        if (!current || current.status === "ready" || !eligible.has(jobId) || suspensions.size || disposed) return current;
        return { ...current, status: "preparing", controlOwner: owner, error: null, updatedAt: now() };
      });
      if (!job || job.status !== "preparing" || job.controlOwner !== owner || signal.aborted) return;
      await refresh(true);
      // PCM mono 24 kHz / 16 bit: 48,000 bytes per second. This is a rough
      // preflight only; each actual audio chunk is checked again before commit.
      const remainingChars = job.totalChars - job.completedChars;
      await checkSpace(remainingChars / 6 / 160 * 60 * 48000);
      if (signal.aborted) return;
      heartbeat = setInterval(() => {
        void store.acquireLease(owner, now()).then(ok => { if (!ok) abortActive(); }).catch(() => abortActive());
      }, 10000);
      heartbeat.unref?.();
      session.engine = createEngine();
      await session.engine.load(job.voice, { signal });
      while (!signal.aborted && !disposed) {
        job = await store.getJob(jobId);
        if (!job || job.status !== "preparing" || job.controlOwner !== owner) break;
        const chapter = job.chapters.find(item => !item.complete);
        const capacity = Math.max(1, Math.min(2, Number(session.engine.concurrency) || 1));
        const passages = chapter?.passages.filter(item => !item.ready).slice(0, capacity) || [];
        if (!passages.length) break;
        // Only this book owns the origin-wide compute lock. Its next sentences
        // may use the accelerated engine concurrently, but commits remain in
        // reading order so a finished first sentence is available immediately.
        const pending = passages.map(passage => Promise.resolve().then(() =>
          session.engine.synthesize(chapter.text.slice(passage.start, passage.end), { voice: job.voice, speed: 1, signal })
        ).then(generated => ({ generated }), error => ({ error })));
        let finished = false;
        for (let index = 0; index < passages.length; index++) {
          const passage = passages[index];
          const { generated, error } = await pending[index];
          if (signal.aborted || disposed) break;
          if (error) {
            const parts = error.code === "VOICE_TEXT_TOO_LONG" ? splitPassage(passage, chapter.text) : [];
            if (parts.length < 2) throw error;
            await store.mutateJob(jobId, current => {
              if (!current || current.status !== "preparing" || current.controlOwner !== owner) return current;
              const target = current.chapters.find(item => item.id === chapter.id);
              const at = target.passages.findIndex(item => item.segmentId === passage.segmentId);
              if (at < 0 || target.passages[at].ready) return current;
              target.passages.splice(at, 1, ...parts.map(part => ({ ...part, segmentId: `${chapter.index}:${part.start}:${part.end}`, ready: false })));
              current.totalSegments += parts.length - 1;
              current.totalChars += parts.reduce((sum, part) => sum + part.end - part.start, 0) - (passage.end - passage.start);
              return current;
            });
            await refresh(true);
            continue;
          }
          if (!generated?.blob || !Number.isFinite(generated.duration) || generated.duration <= 0) throw failure("VOICE_FAILED", "The voice produced no audio");
          await checkSpace(generated.blob.size);
          if (signal.aborted || disposed) break;
          const committed = await store.commitSegment(jobId, { ...generated, chapterId: chapter.id, segmentId: passage.segmentId }, owner, now());
          if (!committed) { finished = true; break; }
          await refresh(true);
          if (committed.status === "ready") { eligible.delete(jobId); finished = true; break; }
        }
        if (finished) break;
      }
    } catch (error) {
      if (!signal.aborted && !disposed && error.name !== "AbortError") {
        eligible.delete(jobId);
        failures.set(jobId, errorInfo(error));
        // A full disk may reject even the small error-status update. Preserve
        // its actionable message in this tab without discarding saved audio.
        try { await store.mutateJob(jobId, job => job && ({ ...job, status: "error", error: errorInfo(error), updatedAt: now() })); }
        catch { /* Previously committed segments remain resumable. */ }
      }
    } finally {
      clearInterval(heartbeat);
      session.engine?.dispose();
      if (active === session) active = null;
      try {
        await store.mutateJob(jobId, job => {
          if (!job || job.status !== "preparing" || job.controlOwner !== owner) return job;
          return { ...job, status: eligible.has(jobId) && !disposed ? "queued" : "paused", updatedAt: now() };
        });
      } catch { /* Do not retain the cross-tab lock if storage is unavailable. */ }
      try { await store.releaseLease(owner); } catch { /* Web Lock is still released by its enclosing callback. */ }
      try { await refresh(true); } catch { emit(); }
    }
    return true;
  }
  async function pump() {
    if (pumping || disposed || suspensions.size) return;
    clearTimeout(retryTimer); retryTimer = null;
    pumping = true;
    try {
      await initialized;
      while (!disposed && !suspensions.size && eligible.size) {
        const jobId = [...eligible][0];
        const job = await store.getJob(jobId);
        if (!job || job.status === "ready" || job.controlOwner !== owner) { eligible.delete(jobId); continue; }
        // Web Locks is supported by current Safari, Firefox and Chromium.
        // Without it, refusing background conversion is safer than an expiring
        // lease that can run two workers when another tab is suspended.
        if (!locks?.request) {
          eligible.delete(jobId);
          await store.mutateJob(jobId, value => value && ({ ...value, status: "error", error: { code: "COORDINATION_UNAVAILABLE", message: "This browser cannot safely coordinate local conversion across tabs" } }));
          await refresh(true);
          continue;
        }
        let acquired = false, releaseCycle;
        lockCycle = new Promise(resolve => { releaseCycle = resolve; });
        try {
          await locks.request(AUDIO_CONVERSION_LOCK, { mode: "exclusive", ifAvailable: true }, async lock => {
            if (!lock) return;
            acquired = await prepare(jobId) !== false;
          });
        } finally { lockCycle = null; releaseCycle(); }
        if (!acquired) {
          retryTimer = setTimeout(() => { retryTimer = null; void pump(); }, 1200);
          retryTimer.unref?.();
          break;
        }
      }
    } finally { pumping = false; }
  }
  function kick() { if (!disposed) void pump().catch(() => {}); }

  async function enqueue({ bookId, title, voice, chapters }) {
    if (disposed) throw failure("QUEUE_CLOSED", "Audio preparation is closed");
    if (!bookId || !voice?.id || !Array.isArray(chapters)) throw failure("INVALID_BOOK", "A book, voice and chapters are required");
    const seen = new Set();
    const prepared = await Promise.all(chapters.map(async (chapter, index) => {
      const id = String(chapter.id ?? index);
      if (seen.has(id)) throw failure("INVALID_BOOK", "Chapter identifiers must be unique");
      seen.add(id);
      const text = typeof chapter.text === "string" ? chapter.text : "";
      const passages = voicePassages(text, voice.language).filter(item => pronounceable(item.text))
        .map(({ start, end }) => ({ start, end, segmentId: `${index}:${start}:${end}`, ready: false }));
      return { id, index, title: chapter.title || "", text, digest: await digest(text), passages, complete: passages.length === 0, completedSegments: 0, audioDuration: 0 };
    }));
    const totalSegments = prepared.reduce((sum, chapter) => sum + chapter.passages.length, 0);
    if (!totalSegments) throw failure("VOICE_EMPTY_TEXT", "This book has no text to prepare");
    const id = await digest(JSON.stringify(["kokoro-q8-natural-v2", bookId, voice.id, prepared.map(chapter => [chapter.id, chapter.digest])]));
    if (disposed) throw failure("QUEUE_CLOSED", "Audio preparation is closed");
    const timestamp = now();
    const job = await store.putIfAbsent({ id, bookId, title: title || "", voice: structuredClone(voice), chapters: prepared, segmentationVersion: 2,
      totalSegments, completedSegments: 0, totalChars: prepared.reduce((sum, chapter) => sum + chapter.passages.reduce((count, passage) => count + passage.end - passage.start, 0), 0),
      completedChars: 0, completedChapters: prepared.filter(chapter => chapter.complete).length,
      audioBytes: 0, audioDuration: 0, status: "queued", controlOwner: owner, error: null, createdAt: timestamp, updatedAt: timestamp });
    if (job.status !== "ready") await resume(id);
    else await refresh();
    return summary((await store.getJob(id)) || job);
  }
  async function pause(id) {
    eligible.delete(id);
    if (active?.jobId === id) abortActive();
    await store.mutateJob(id, job => job && job.status !== "ready" ? { ...job, status: "paused", updatedAt: now() } : job);
    await refresh(true);
  }
  async function resume(id) {
    if (disposed) return;
    failures.delete(id);
    eligible.add(id);
    await store.mutateJob(id, job => job && job.status !== "ready" ? { ...job, status: "queued", controlOwner: owner, error: null, updatedAt: now() } : job);
    await refresh(true);
    kick();
  }
  async function remove(id) {
    eligible.delete(id);
    failures.delete(id);
    if (active?.jobId === id) abortActive();
    await store.removeJob(id);
    await refresh(true);
  }
  function suspend(reason) { suspensions.add(reason); abortActive(); emit(); return lockCycle || Promise.resolve(); }
  function unsuspend(reason) { suspensions.delete(reason); emit(); kick(); }
  async function getPreparedChapter(bookId, voiceId, chapterId, text, { jobId } = {}) {
    await initialized;
    const hash = await digest(text);
    const jobs = jobId ? [await store.getJob(jobId)].filter(Boolean) : await store.listJobs();
    const candidates = jobs.filter(item => item.bookId === bookId && item.voice.id === voiceId)
      .map(job => {
        const chapter = job.chapters.find(item => item.id === String(chapterId) && item.digest === hash);
        return chapter ? { job, chapter, ready: readyPrefix(chapter) } : null;
      }).filter(Boolean)
      .sort((a, b) => (b.job.segmentationVersion || 1) - (a.job.segmentationVersion || 1)
        || (b.ready.at(-1)?.end || 0) - (a.ready.at(-1)?.end || 0) || b.job.updatedAt - a.job.updatedAt);
    if (!candidates.length) return null;
    const { job, chapter, ready } = candidates[0];
    const current = summary(job);
    // An empty prefix is a valid manifest: the listener can wait for the first
    // committed passage, instead of starting a competing synthesis worker.
    return { jobId: job.id, chapterId: chapter.id, voice: job.voice,
      segmentationVersion: job.segmentationVersion || 1,
      status: current.status, error: current.error,
      complete: chapter.complete && ready.length === chapter.passages.length,
      totalSegments: chapter.passages.length, readySegments: ready.length,
      duration: ready.reduce((sum, passage) => sum + passage.duration, 0),
      passages: ready.map(passage => ({ start: passage.start, end: passage.end, text: chapter.text.slice(passage.start, passage.end), segmentId: passage.segmentId, duration: passage.duration })) };
  }
  async function dispose() {
    disposed = true; clearTimeout(retryTimer); retryTimer = null;
    const ids = [...eligible]; eligible.clear(); abortActive();
    try {
      for (const id of ids) await store.mutateJob(id, job => job && !["ready", "error"].includes(job.status) ? { ...job, status: "paused", updatedAt: now() } : job);
    } finally {
      await lockCycle;
      channel?.close(); listeners.clear();
    }
  }
  return { enqueue, pause, resume, cancel: remove, delete: remove, remove, suspend, unsuspend, snapshot,
    async list() { await initialized; return refresh(); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); void initialized.then(() => { if (listeners.has(listener)) listener(snapshot()); }); return () => listeners.delete(listener); },
    getPreparedChapter, readSegment: (jobId, segmentId) => store.readSegment(jobId, segmentId), dispose };
}
