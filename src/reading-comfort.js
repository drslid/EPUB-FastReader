const sentenceEnd = /[.!?…][»”’"')\]]*$/u;
const pauseMark = /[,;:—][»”’"')\]]*$/u;

/** Deliberately modest, adjustable reading pauses, not a comprehension score. */
export function wordDuration(word, speed = 300, cadence = "gentle") {
  const base = 60000 / Math.max(100, Math.min(800, Number(speed) || 300));
  if (cadence === "steady") return base;
  const length = Array.from(String(word).replace(/[^\p{L}\p{N}]/gu, "")).length;
  const lengthPause = Math.min(0.5, Math.max(0, length - 8) * 0.045);
  const punctuation = sentenceEnd.test(word) ? 0.8 : pauseMark.test(word) ? 0.3 : 0;
  return base * (1 + lengthPause + punctuation);
}

/** From within a sentence return to its start; at its start, return one sentence. */
export function previousSentenceIndex(words, currentIndex) {
  let index = Math.max(0, Math.min(words.length - 1, currentIndex) - 1);
  while (index > 0 && !sentenceEnd.test(words[index - 1])) index -= 1;
  return index;
}

/** A late browser grant must never keep the screen awake after the reader pauses. */
export function createReadingWakeLock({ navigator: nav = globalThis.navigator,
  isVisible = () => !globalThis.document?.hidden, onChange = () => {} } = {}) {
  let wanted = false;
  let lock;
  let revision = 0;
  return {
    async setActive(active) {
      wanted = Boolean(active);
      const version = ++revision;
      if (!wanted || !isVisible()) {
        const previous = lock;
        lock = null;
        onChange(false);
        try { await previous?.release(); } catch { /* Already released by the OS. */ }
        return;
      }
      if (lock && !lock.released) return;
      if (!nav?.wakeLock?.request) return;
      try {
        const acquired = await nav.wakeLock.request("screen");
        if (!wanted || version !== revision || !isVisible()) {
          await acquired.release();
          return;
        }
        lock = acquired;
        onChange(true);
        acquired.addEventListener("release", () => {
          if (lock !== acquired) return;
          lock = null;
          onChange(false);
        }, { once: true });
      } catch {
        if (version === revision) onChange(false);
        /* An older rejected request must not hide a newer active lock. */
      }
    },
  };
}
