import { voicePassages } from "./voice-text.js";
import { concatenateVoiceAudio } from "./voice-audio.js";

/** Existing short recordings stay usable: wait for a whole sentence before
 * exposing its audio, without changing or regenerating the saved segments. */
export function createPreparedVoiceSource(queue, initial, { bookId, chapterId, text }) {
  const sentences = initial.segmentationVersion >= 2 ? [] : voicePassages(text, initial.voice.language)
    .filter(passage => /[\p{L}\p{N}]/u.test(passage.text));

  function manifest(value) {
    if (!value || value.segmentationVersion >= 2) return value;
    const passages = [];
    let parts = [], sentence = 0;
    for (const part of value.passages) {
      parts.push(part);
      const boundary = sentences[sentence]?.end ?? text.trimEnd().length;
      if (part.end < boundary) continue;
      append();
      while (sentence < sentences.length && sentences[sentence].end <= part.end) sentence++;
    }
    // A complete legacy chapter can end before a final punctuation-only span.
    if (value.complete && parts.length) append();
    return { ...value, passages };

    function append() {
      const start = parts[0].start, end = parts.at(-1).end;
      passages.push({ start, end, text: text.slice(start, end),
        segmentId: JSON.stringify(parts.map(part => part.segmentId)),
        duration: parts.reduce((total, part) => total + part.duration, 0), parts });
      parts = [];
    }
  }

  return {
    ...manifest(initial),
    async read(passage, { signal } = {}) {
      const parts = [];
      for (const part of passage.parts || [passage]) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const blob = await queue.readSegment(initial.jobId, part.segmentId);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (!blob?.size) throw Object.assign(new Error("Prepared audio is missing"), { code: "AUDIO_MISSING" });
        parts.push({ blob, duration: part.duration });
      }
      if (parts.length === 1) return parts[0];
      try { return await concatenateVoiceAudio(parts, { signal }); }
      catch (error) {
        if (error.name === "AbortError") throw error;
        throw Object.assign(new Error("Prepared audio is invalid"), { code: "AUDIO_MISSING" });
      }
    },
    async getSnapshot() {
      return manifest(await queue.getPreparedChapter(bookId, initial.voice.id, chapterId, text, { jobId: initial.jobId }));
    },
    subscribe(notify) {
      let previous;
      return queue.subscribe(snapshot => {
        const job = snapshot.jobs.find(item => item.id === initial.jobId);
        const chapter = job?.chapters.find(item => item.id === chapterId);
        // Playback updates queue suspension too. Publish only actual progress
        // changes, avoiding feedback loops and unnecessary database reads.
        const revision = JSON.stringify([job?.status, job?.error?.code, chapter?.readySegments, chapter?.totalSegments, chapter?.complete]);
        if (revision === previous) return;
        previous = revision;
        notify();
      });
    },
  };
}
