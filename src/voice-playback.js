import { voicePassages, passageAtOffset, splitVoicePassage, isRecoverableVoiceTextError } from "./voice-text.js";

const pronounceable = text => /[\p{L}\p{N}]/u.test(text);

/** One audio element. Saved audio keeps a two-clip read window; live synthesis
 * fills a bounded window of complete sentences with the engine's concurrency. */
export function createVoicePlayback({
  createEngine,
  createAudio = () => new Audio(),
  createUrl = blob => URL.createObjectURL(blob),
  revokeUrl = url => URL.revokeObjectURL(url),
  onState = () => {},
  onPosition = () => {},
  onEnd = () => {},
  maxBufferedPassages = 6,
  targetBufferedSeconds = 30,
  maxBufferBytes = 8 * 1024 * 1024,
  now = () => Date.now(),
} = {}) {
  const audio = createAudio();
  audio.preload = "auto";
  let engine, loaded = false, controller, epoch = 0, pumpEpoch = null;
  let preparedSource = null;
  let preparedComplete = true, preparationStatus = null, preparationError = null;
  let preparedMonitor = null, requestedOffset = null;
  let passages = [], index = 0, voice = null, desired = false, url = null;
  let status = "idle", rate = 1, currentIndex = -1, problem = "";
  let skippedSegments = 0;
  let warming = false, sessionText = null, sessionOffset = 0, preparationStarted = null, hasPlayed = false;
  let playAttempt = null;
  let liveLoad = null, liveScheduled = false, loadProgress = null, warmPending = null;
  const buffers = new Map();
  const inFlight = new Map(), futureErrors = new Map(), deferredLarge = new Set();
  const splitDepths = new WeakMap();
  const splitOrigins = new WeakMap(), skippedOrigins = new WeakSet();
  const maxClips = Math.max(1, Math.min(6, Math.floor(maxBufferedPassages) || 6));
  const targetSeconds = Math.max(1, Math.min(60, Number(targetBufferedSeconds) || 30));
  const byteBudget = Math.max(1024, Number(maxBufferBytes) || 8 * 1024 * 1024);

  function bufferDuration(at, result) {
    const duration = Number(result?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    return (passages[at]?.text.trim().split(/\s+/u).length || 1) / 160 * 60;
  }
  function liveWindow() {
    const indices = [];
    let seconds = 0, bytes = 0;
    for (let at = index; at < passages.length && indices.length < maxClips; at++) {
      if (at !== index && deferredLarge.has(passages[at])) break;
      const result = buffers.get(at);
      const duration = bufferDuration(at, result);
      const size = result?.blob?.size || duration * 48000;
      if (at !== index && bytes + size > byteBudget) break;
      indices.push(at); bytes += size;
      // The target is audio AFTER the current sentence. Including a long
      // current clip would leave synthesis idle until it ends, guaranteeing a
      // gap before the next sentence even on otherwise capable devices.
      if (at !== index) seconds += duration;
      if (seconds >= targetSeconds) break;
    }
    return indices;
  }
  function preparationSnapshot() {
    const window = preparedSource ? [index, index + 1].filter(at => at < passages.length) : liveWindow();
    let bufferedSeconds = 0;
    for (const at of window) {
      if (!buffers.has(at)) break;
      const duration = Number(buffers.get(at).duration);
      if (Number.isFinite(duration) && duration > 0) {
        bufferedSeconds += Math.max(0, duration - (at === currentIndex ? Number(audio.currentTime) || 0 : 0));
      }
    }
    const ready = buffers.has(index);
    const phase = ready ? "ready" : preparedSource || hasPlayed ? "waiting" : loaded ? "generating" : "loading";
    return { phase: voice ? phase : "waiting", completed: window.filter(at => buffers.has(at)).length, total: window.length,
      bufferedSeconds: bufferedSeconds / rate, elapsedSeconds: preparationStarted !== null ? Math.max(0, (now() - preparationStarted) / 1000) : 0,
      engineProgress: inFlight.get(passages[index])?.progress || loadProgress };
  }

  function snapshot() {
    return { status, playing: status === "playing", prepared: Boolean(preparedSource), warming, preparation: preparationSnapshot(), voice, voiceLabel: voice?.name || voice?.label || "", rate,
      passageIndex: Math.min(index, Math.max(0, passages.length - 1)), passageCount: passages.length,
      passage: passages[index] || null, error: problem, preparedComplete, preparationStatus, preparationError, skippedSegments };
  }
  function emit(next = status) { status = next; onState(snapshot()); }
  function releaseUrl() { if (url) { revokeUrl(url); url = null; } }
  function abortWork() {
    epoch++;
    controller?.abort(); controller = null;
    engine?.dispose(); engine = null; loaded = false; pumpEpoch = null; liveLoad = null; liveScheduled = false;
    inFlight.clear(); loadProgress = null; playAttempt = null;
    if (warmPending) { warmPending.reject(new DOMException("Aborted", "AbortError")); warmPending = null; }
  }

  function closePreparedMonitor() {
    const monitor = preparedMonitor;
    preparedMonitor = null;
    monitor?.controller.abort();
    monitor?.unsubscribe?.();
  }
  function failPrepared(error) {
    desired = false; audio.pause(); abortWork(); buffers.clear(); currentIndex = -1;
    releaseUrl(); audio.removeAttribute?.("src"); audio.load?.();
    problem = typeof error?.code === "string" ? error.code : "AUDIO_MISSING";
    emit("error");
  }
  function selectPreparedOffset(offset) {
    const target = Math.max(0, Number(offset) || 0);
    const found = passages.findIndex(passage => passage.end > target);
    requestedOffset = found < 0 && !preparedComplete ? target : null;
    // A bookmark in an omitted ending must advance past that ending, rather
    // than replaying the last earlier WAV. Preserve legacy end-offset replay
    // for recordings that have not omitted any passage.
    index = found >= 0 ? found : preparedComplete && !skippedSegments ? Math.max(0, passages.length - 1) : passages.length;
  }
  function finishChapter() {
    if (!desired || status === "ended") return;
    index = Math.max(0, passages.length - 1);
    desired = false; abortWork(); emit("ended"); onEnd();
  }

  async function refreshPrepared(monitor = preparedMonitor) {
    if (!monitor || monitor !== preparedMonitor) return;
    monitor.dirty = true;
    if (monitor.refreshing) return monitor.refreshing;
    const run = async () => {
      while (monitor === preparedMonitor && monitor.dirty) {
        monitor.dirty = false;
        try {
          const next = await monitor.source.getSnapshot({ signal: monitor.controller.signal });
          if (monitor !== preparedMonitor || monitor.controller.signal.aborted) return;
          if (!next || !Array.isArray(next.passages)) {
            closePreparedMonitor();
            failPrepared();
            return;
          }
          // A conversion publishes an append-only ready prefix. A replacement
          // edition or a missing earlier segment must not silently change audio.
          const stablePrefix = passages.every((passage, at) => {
            const updated = next.passages[at];
            return updated && ["segmentId", "start", "end", "text", "duration"].every(key => passage[key] === updated[key]);
          });
          if (!stablePrefix || (preparedComplete && next.complete === false)) {
            closePreparedMonitor();
            failPrepared();
            return;
          }
          const complete = next.complete !== false;
          const nextStatus = next.status || null;
          const nextSkipped = Number.isSafeInteger(next.skippedSegments) ? Math.max(0, next.skippedSegments) : 0;
          const changed = next.passages.length !== passages.length || complete !== preparedComplete
            || nextStatus !== preparationStatus || next.error?.code !== preparationError?.code
            || next.error?.message !== preparationError?.message || nextSkipped !== skippedSegments;
          if (!changed) continue;
          passages = next.passages.slice();
          preparedComplete = complete;
          preparationStatus = nextStatus;
          preparationError = next.error || null;
          skippedSegments = nextSkipped;
          if (requestedOffset !== null) selectPreparedOffset(requestedOffset);
          emit();
          // Receiving audio never overrides an explicit reader pause.
          if (desired) void pump();
        } catch (error) {
          if (monitor !== preparedMonitor || monitor.controller.signal.aborted) return;
          failPrepared(error);
        }
      }
    };
    monitor.refreshing = Promise.resolve().then(run);
    try { await monitor.refreshing; }
    finally {
      monitor.refreshing = null;
      if (monitor === preparedMonitor && monitor.dirty) void refreshPrepared(monitor);
    }
  }
  function watchPrepared() {
    if (typeof preparedSource?.getSnapshot !== "function") return;
    const monitor = { source: preparedSource, controller: new AbortController(), unsubscribe: null, refreshing: null, dirty: false };
    preparedMonitor = monitor;
    if (typeof preparedSource.subscribe === "function") {
      monitor.unsubscribe = preparedSource.subscribe(() => { void refreshPrepared(monitor); });
    }
    void refreshPrepared(monitor);
  }

  function activate() {
    // This happens in the user's click handler, before a possible download.
    // Reuse the same media element so Safari can authorize later playback.
    if (audio.src) return;
    const bytes = new Uint8Array(46), view = new DataView(bytes.buffer);
    const put = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    put(0,"RIFF"); view.setUint32(4,38,true); put(8,"WAVEfmt "); view.setUint32(16,16,true);
    view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,24000,true);
    view.setUint32(28,48000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    put(36,"data"); view.setUint32(40,2,true);
    url = createUrl(new Blob([bytes], { type: "audio/wav" }));
    const silent = url;
    audio.src = silent;
    void Promise.resolve(audio.play()).then(() => { if (audio.src === silent) audio.pause(); }).catch(() => {});
  }

  async function playBuffer(token) {
    if (!desired || token !== epoch || !buffers.has(index)) return;
    if (currentIndex === index && status === "playing" && !audio.paused) return;
    if (playAttempt?.epoch === token && playAttempt.index === index) return;
    const attempt = { epoch: token, index };
    playAttempt = attempt;
    const item = buffers.get(index);
    if (currentIndex !== index) {
      releaseUrl(); url = createUrl(item.blob); audio.src = url; currentIndex = index;
      audio.playbackRate = rate;
      onPosition(passages[index]);
    }
    try {
      await audio.play();
      // A delayed play promise from an earlier session must not pause its replacement.
      if (token !== epoch || playAttempt !== attempt) return;
      if (currentIndex !== attempt.index || index !== attempt.index) return;
      if (!desired) { audio.pause(); return; }
      hasPlayed = true;
      emit("playing");
    } catch (error) {
      if (token !== epoch || playAttempt !== attempt) return;
      desired = false;
      warming = false;
      // Pausing after an autoplay/media rejection must release the shared
      // compute lock as well; the queue can continue while awaiting a gesture.
      // Keep the current blob so retrying does not regenerate that passage.
      abortWork();
      problem = error.name === "NotAllowedError" ? "autoplay" : "playback";
      emit("paused");
    } finally { if (playAttempt === attempt) playAttempt = null; }
  }

  async function pump() {
    if (!preparedSource) { scheduleLive(); return; }
    const token = epoch;
    if (!desired || !voice || pumpEpoch === token) return;
    pumpEpoch = token;
    controller ||= new AbortController();
    const signal = controller.signal;
    try {
      if (buffers.has(index)) await playBuffer(token);
      if (!desired || token !== epoch) return;
      if (preparedSource && index >= passages.length) {
        if (preparedComplete) finishChapter();
        else emit("buffering");
        return;
      }
      while (desired && token === epoch) {
        const next = [index, index + 1].find(i => i < passages.length && !buffers.has(i));
        if (next === undefined) break;
        if (next === index) emit("preparing");
        const passage = passages[next];
        const result = await preparedSource.read(passage, { signal });
        if (!result?.blob || typeof result.blob.arrayBuffer !== "function" || !(result.blob.size > 0)
          || !Number.isFinite(result.duration) || result.duration <= 0) {
          throw Object.assign(new Error("Prepared audio is missing or invalid"), { code: "AUDIO_MISSING" });
        }
        if (token !== epoch || signal.aborted) return;
        buffers.set(next, result);
        if (next === index) await playBuffer(token);
      }
    } catch (error) {
      if (token !== epoch || signal.aborted) return;
      desired = false; audio.pause();
      problem = typeof error.code === "string" && error.code ? error.code : "AUDIO_MISSING";
      emit("error");
    } finally { if (pumpEpoch === token) pumpEpoch = null; }
  }

  function scheduleLive() {
    if (preparedSource || (!desired && !warming) || !voice || liveScheduled) return;
    liveScheduled = true;
    const token = epoch;
    queueMicrotask(() => {
      if (token !== epoch) return;
      liveScheduled = false;
      fillLive(token);
    });
  }
  function failLive(error, token) {
    if (token !== epoch) return;
    const pending = warmPending;
    warmPending = null;
    desired = false; warming = false; audio.pause(); abortWork();
    problem = error?.code || "synthesis";
    pending?.reject(error);
    emit("error");
  }
  function finishWarm() {
    if (!buffers.has(index)) return;
    const pending = warmPending; warmPending = null;
    if (warming && !desired) emit("ready");
    pending?.resolve(snapshot());
  }
  function fillLive(token) {
    if (token !== epoch || preparedSource || (!desired && !warming)) return;
    if (futureErrors.has(passages[index])) { failLive(futureErrors.get(passages[index]), token); return; }
    if (buffers.has(index)) {
      finishWarm();
      if (desired) void playBuffer(token);
    }
    const wanted = liveWindow();
    // A ready sentence may outlast its estimate. Keep that useful work within
    // the passage/byte limits instead of repeatedly throwing it away.
    for (const at of buffers.keys()) if (at < index || at >= index + maxClips) buffers.delete(at);
    const missing = wanted.filter(at => !buffers.has(at) && !inFlight.has(passages[at]) && !futureErrors.has(passages[at]));
    if (!missing.length) { emit(); return; }
    if (!loaded) {
      if (liveLoad) return;
      controller ||= new AbortController();
      const signal = controller.signal;
      const loading = {};
      liveLoad = loading;
      if (!buffers.has(index)) emit("loading");
      try {
        engine ||= createEngine();
        Promise.resolve(engine.load(voice, { signal, onProgress: progress => {
          if (token === epoch && !signal.aborted) { loadProgress = progress; emit(); }
        } })).then(() => {
          if (token !== epoch || signal.aborted) return;
          loaded = true; liveLoad = null; scheduleLive();
        }).catch(error => { if (token === epoch && !signal.aborted) failLive(error, token); });
      } catch (error) { failLive(error, token); }
      return;
    }
    controller ||= new AbortController();
    const signal = controller.signal;
    const concurrency = Math.max(1, Math.min(2, Math.floor(Number(engine?.concurrency) || 1)));
    for (const at of missing) {
      if (token !== epoch || (!desired && !warming) || inFlight.size >= concurrency) break;
      const passage = passages[at];
      const task = { token, progress: null };
      inFlight.set(passage, task);
      if (at === index) emit("preparing");
      if (token !== epoch || signal.aborted) break;
      void generateLive(passage, task, signal);
    }
  }
  async function generateLive(passage, task, signal) {
    const token = task.token;
    try {
      const result = await engine.synthesize(passage.text, { voice, speed: 1, signal, onProgress: progress => {
        if (token === epoch && !signal.aborted) { task.progress = progress; emit(); }
      } });
      if (token !== epoch || signal.aborted) return;
      const at = passages.indexOf(passage);
      if (at < index || at < 0) return;
      if (!result?.blob || !(result.blob.size > 0)) throw Object.assign(new Error("The voice returned no audio"), { code: "VOICE_FAILED" });
      const bytes = [...buffers.values()].reduce((sum, item) => sum + item.blob.size, 0);
      if (at !== index && bytes + result.blob.size > byteBudget) {
        // An unusually large future clip must not grow the memory window. It
        // can be generated when it becomes current, never in a retry loop.
        deferredLarge.add(passage);
      } else {
        buffers.set(at, result);
        if (at === index) {
          finishWarm();
          if (desired) void playBuffer(token);
        }
      }
    } catch (error) {
      if (token !== epoch || signal.aborted || error.name === "AbortError") return;
      const at = passages.indexOf(passage);
      const depth = splitDepths.get(passage) || 0;
      const parts = error.code === "VOICE_TEXT_TOO_LONG" && depth < 8 ? splitVoicePassage(passage) : [];
      if (at >= index && parts.length > 1) {
        for (const part of parts) {
          splitDepths.set(part, depth + 1);
          splitOrigins.set(part, splitOrigins.get(passage) || passage);
        }
        replaceLivePassage(at, parts);
      } else if (at >= index && isRecoverableVoiceTextError(error)) {
        const original = skipLivePassage(passage);
        if (index >= passages.length) {
          if (warming && !desired) {
            // A silent preview with no usable audio must settle its promise.
            // A later explicit start can retry, but no worker is left waiting.
            failLive(Object.assign(new Error("No passage could be read aloud"), { code: "VOICE_EMPTY_TEXT" }), token);
          } else {
            onPosition({ ...original, completed: true });
            finishChapter();
          }
        }
      } else if (at === index) failLive(error, token);
      else if (at > index) futureErrors.set(passage, error);
    } finally {
      if (inFlight.get(passage) === task) inFlight.delete(passage);
      if (token === epoch) { emit(); scheduleLive(); }
    }
  }

  function replaceLivePassage(at, replacements) {
    const old = passages.slice(), kept = [...buffers.entries()];
    passages.splice(at, 1, ...replacements);
    buffers.clear();
    // In-flight work is already keyed by passage identity. Reindex ready audio
    // in the same way so skipping a sentence cannot play its neighbour's WAV.
    for (const [oldIndex, result] of kept) {
      const nextIndex = passages.indexOf(old[oldIndex]);
      if (nextIndex >= index) buffers.set(nextIndex, result);
    }
  }

  function skipLivePassage(passage) {
    const original = splitOrigins.get(passage) || passage;
    // Once even a minimal fragment is rejected, trying every remaining piece
    // of the same sentence would only delay the next readable sentence. Keep
    // any fragment already playing; remove its unplayed siblings together.
    for (let at = passages.length - 1; at >= index; at--) {
      const candidate = passages[at];
      if ((splitOrigins.get(candidate) || candidate) !== original || at === currentIndex) continue;
      replaceLivePassage(at, []);
      futureErrors.delete(candidate); deferredLarge.delete(candidate);
    }
    if (!skippedOrigins.has(original)) { skippedOrigins.add(original); skippedSegments++; }
    return original;
  }

  function pause() {
    if (status === "idle" || status === "ended") return;
    desired = false; warming = false; audio.pause(); abortWork(); emit("paused");
  }
  function resume() {
    const dynamic = preparedSource && (preparedSource.complete !== undefined || typeof preparedSource.getSnapshot === "function");
    if (!voice || (!passages.length && !dynamic)) return;
    problem = "";
    futureErrors.clear();
    if (status === "ended") { index = 0; currentIndex = -1; buffers.clear(); }
    desired = true;
    void pump();
  }
  function stop() {
    closePreparedMonitor();
    desired = false; warming = false; audio.pause(); abortWork(); buffers.clear(); passages = [];
    futureErrors.clear(); deferredLarge.clear(); sessionText = null; sessionOffset = 0; preparationStarted = null; hasPlayed = false;
    preparedSource = null;
    preparedComplete = true; preparationStatus = null; preparationError = null; requestedOffset = null;
    index = 0; currentIndex = -1; voice = null; problem = ""; skippedSegments = 0;
    releaseUrl(); audio.removeAttribute?.("src"); audio.load?.(); emit("idle");
  }
  function start({ text, voice: selected, offset = 0, rate: speed = 1, prepared = null }) {
    if (!prepared && warming && sessionText === text && voice?.id === selected?.id && sessionOffset === Math.max(0, Number(offset) || 0)) {
      warming = false; desired = true; problem = "";
      rate = Math.max(0.75, Math.min(1.75, Number(speed) || 1));
      audio.playbackRate = rate;
      if (buffers.has(index)) void playBuffer(epoch);
      scheduleLive();
      return;
    }
    // Do not replace the user-authorized audio element.
    stop(); voice = selected;
    sessionText = text; sessionOffset = Math.max(0, Number(offset) || 0); preparationStarted = now();
    preparedSource = prepared;
    preparedComplete = prepared?.complete !== false;
    preparationStatus = prepared?.status || null;
    preparationError = prepared?.error || null;
    skippedSegments = Number.isSafeInteger(prepared?.skippedSegments) ? Math.max(0, prepared.skippedSegments) : 0;
    if (prepared && (!Array.isArray(prepared.passages) || typeof prepared.read !== "function")) {
      problem = "AUDIO_MISSING"; emit("error"); return;
    }
    // Copy only the list; the queue's canonical segment metadata is preserved.
    passages = prepared ? prepared.passages.slice()
      : voicePassages(text, selected.language).filter(passage => pronounceable(passage.text));
    rate = Math.max(0.75, Math.min(1.75, Number(speed) || 1));
    if (prepared) selectPreparedOffset(offset);
    else index = passageAtOffset(passages, offset);
    if (!passages.length && (!prepared || (prepared.complete === undefined && !prepared.getSnapshot))) {
      problem = "empty"; emit("error"); return;
    }
    desired = true;
    try { watchPrepared(); }
    catch (error) { closePreparedMonitor(); failPrepared(error); return; }
    void pump();
  }
  function prepare({ text, voice: selected, offset = 0 }) {
    const requested = Math.max(0, Number(offset) || 0);
    if (!preparedSource && (warming || desired) && sessionText === text && voice?.id === selected?.id && sessionOffset === requested) {
      if (buffers.has(index)) return Promise.resolve(snapshot());
      if (warmPending) return warmPending.promise;
    }
    stop(); voice = selected; sessionText = text; sessionOffset = requested;
    passages = voicePassages(text, selected?.language).filter(passage => pronounceable(passage.text));
    index = passageAtOffset(passages, offset); preparationStarted = now();
    if (!voice || !passages.length) { problem = "empty"; emit("error"); return Promise.resolve(snapshot()); }
    warming = true;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Callers may use this as a fire-and-forget warm-up; cancellation still
    // rejects an explicitly awaited promise without creating an unhandled one.
    void promise.catch(() => {});
    warmPending = { promise, resolve, reject };
    emit("loading"); scheduleLive();
    return promise;
  }
  function seek(delta) {
    if (!passages.length) return;
    audio.pause(); abortWork();
    warming = false; futureErrors.clear();
    requestedOffset = null;
    const last = preparedSource && !preparedComplete ? passages.length : passages.length - 1;
    index = Math.max(0, Math.min(last, index + delta));
    currentIndex = -1;
    const wanted = preparedSource ? [index, index + 1] : liveWindow();
    for (const i of buffers.keys()) if (!wanted.includes(i)) buffers.delete(i);
    if (passages[index]) onPosition(passages[index]);
    problem = "";
    if (desired) void pump(); else emit("paused");
  }
  function setRate(value) {
    rate = Math.max(0.75, Math.min(1.75, Number(value) || 1));
    audio.playbackRate = rate; emit();
  }
  audio.addEventListener("ended", () => {
    if (!desired || currentIndex !== index) return;
    buffers.delete(index);
    if (index + 1 >= passages.length) {
      onPosition({ ...passages[index], completed: true });
      if (preparedSource && !preparedComplete) {
        index++; currentIndex = -1; emit("buffering");
        void pump();
      } else finishChapter();
      return;
    }
    index++; currentIndex = -1;
    if (buffers.has(index)) void playBuffer(epoch);
    else emit("preparing");
    void pump();
  });
  audio.addEventListener("error", () => {
    if (currentIndex < 0 || !audio.src || status === "idle" || status === "ended") return;
    desired = false; warming = false; audio.pause(); abortWork();
    buffers.delete(index); currentIndex = -1;
    releaseUrl(); audio.removeAttribute?.("src"); audio.load?.();
    problem = "playback"; emit("error");
  });
  return { activate, prepare, start, pause, resume, stop, previous: () => seek(-1), next: () => seek(1), setRate, snapshot, refreshPrepared: () => refreshPrepared(), dispose: stop };
}
