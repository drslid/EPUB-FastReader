/** Storage actions work on audio only; EPUBs and reading positions are separate. */
export function createAudioStorage({ queue, downloads, beforeRemoveBook = () => {}, beforeRemoveVoice = () => {} }) {
  let pending = null;
  function change(operation) {
    if (pending) return Promise.reject(new Error("An audio storage change is already running"));
    pending = Promise.resolve().then(operation).finally(() => { pending = null; });
    return pending;
  }
  async function load() {
    const [snapshot, voices] = await Promise.all([queue.list(), downloads.storageStatus()]);
    const books = new Map();
    for (const job of snapshot.jobs) {
      if (!books.has(job.bookId)) books.set(job.bookId, { id: job.bookId, title: job.title, bytes: 0 });
      books.get(job.bookId).bytes += Math.max(0, Number(job.audioBytes) || 0);
    }
    const rows = [...books.values()];
    return { ...voices, books: rows, totalBytes: voices.totalBytes + rows.reduce((sum, book) => sum + book.bytes, 0) };
  }
  const removeBook = id => change(async () => {
    await beforeRemoveBook(id);
    const { jobs } = await queue.list();
    // A book may have recordings made with several voices. Remove each version.
    for (const job of jobs.filter(job => job.bookId === id)) await queue.remove(job.id);
  });
  const removeVoice = id => change(async () => {
    await beforeRemoveVoice(id);
    const { jobs } = await queue.list();
    for (const job of jobs.filter(job => job.voice?.id === id && job.status !== "ready")) await queue.pause(job.id);
    await downloads.removeVoice(id);
  });
  return { load, removeBook, removeVoice,
    clearAudio: () => change(() => queue.clearAll()),
    clearAll: () => change(async () => { await queue.clearAll(); await downloads.clearAll(); }),
    cleanup: () => change(() => downloads.removeLegacy()),
  };
}
