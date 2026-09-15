const DATABASE = "fastreader-audio";

/** Generated audio has its own database and never enlarges EPUB backups. */
export function createAudioStore({ indexedDB = globalThis.indexedDB, name = DATABASE } = {}) {
  let connection;
  async function open() {
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        let abandoned = false;
        request.onupgradeneeded = () => {
          request.result.createObjectStore("jobs", { keyPath: "id" });
          const segments = request.result.createObjectStore("segments", { keyPath: ["jobId", "segmentId"] });
          segments.createIndex("jobId", "jobId");
          request.result.createObjectStore("locks", { keyPath: "id" });
        };
        request.onerror = () => { abandoned = true; reject(request.error); };
        request.onblocked = () => { abandoned = true; reject(new Error("Audio storage is open in another application version")); };
        request.onsuccess = () => {
          const db = request.result;
          if (abandoned) { db.close(); return; }
          db.onversionchange = () => { db.close(); connection = undefined; };
          db.onclose = () => { connection = undefined; };
          resolve(db);
        };
      }).catch(error => { connection = undefined; throw error; });
    }
    return connection;
  }
  async function transaction(stores, mode, callback) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value, failure;
      const set = result => { value = result; };
      const fail = error => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(value);
      tx.onerror = event => { failure ||= event.target?.error; };
      tx.onabort = () => reject(failure || tx.error || new Error("Audio storage interrupted"));
      try { callback(tx, set, fail); } catch (error) { fail(error); }
    });
  }
  const get = (store, key) => transaction([store], "readonly", (tx, set) => {
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => set(request.result);
  });
  const mutateJob = (id, change) => transaction(["jobs"], "readwrite", (tx, set, fail) => {
    const table = tx.objectStore("jobs");
    const request = table.get(id);
    request.onsuccess = () => {
      try {
        const next = change(request.result);
        if (next) table.put(next);
        set(next);
      } catch (error) { fail(error); }
    };
  });
  return {
    getJob: id => get("jobs", id),
    getLease: () => get("locks", "conversion"),
    async getGeneration() { return (await get("locks", "generation"))?.version || 0; },
    mutateJob,
    listJobs: () => transaction(["jobs"], "readonly", (tx, set) => {
      const request = tx.objectStore("jobs").getAll();
      request.onsuccess = () => set(request.result);
    }),
    putIfAbsent(job, { generation } = {}) {
      return transaction(["jobs", "locks"], "readwrite", (tx, set, fail) => {
        const jobs = tx.objectStore("jobs");
        const revision = tx.objectStore("locks").get("generation");
        revision.onsuccess = () => {
          try {
            const current = revision.result?.version || 0;
            if (generation !== undefined && generation !== current) { set(null); return; }
            const request = jobs.get(job.id);
            request.onsuccess = () => {
              try {
                const saved = request.result || { ...job, generation: current };
                if (!request.result) jobs.put(saved);
                set(saved);
              } catch (error) { fail(error); }
            };
          } catch (error) { fail(error); }
        };
      });
    },
    acquireLease(owner, now, lifetime = 60000, exclusiveLockHeld = false) {
      return transaction(["locks"], "readwrite", (tx, set) => {
        const table = tx.objectStore("locks"), request = table.get("conversion");
        request.onsuccess = () => {
          const current = request.result;
          if (!exclusiveLockHeld && current && current.owner !== owner && current.expires > now) { set(false); return; }
          table.put({ id: "conversion", owner, expires: now + lifetime });
          set(true);
        };
      });
    },
    releaseLease(owner) {
      return transaction(["locks"], "readwrite", tx => {
        const table = tx.objectStore("locks"), request = table.get("conversion");
        request.onsuccess = () => { if (request.result?.owner === owner) table.delete("conversion"); };
      });
    },
    /** Audio and its ready flag are committed together, or both roll back. */
    async commitSegment(jobId, segment, owner, now, generation) {
      // Some WebKit storage contexts reject native Blob/File values. Store
      // portable bytes instead, reading them before the transaction starts so
      // its writes remain atomic and never await an external promise.
      const { blob, ...metadata } = segment;
      const bytes = await blob.arrayBuffer();
      return transaction(["jobs", "segments", "locks"], "readwrite", (tx, set, fail) => {
        const jobs = tx.objectStore("jobs");
        const jobRequest = jobs.get(jobId);
        const leaseRequest = tx.objectStore("locks").get("conversion");
        leaseRequest.onsuccess = () => {
          try {
            const job = jobRequest.result, lease = leaseRequest.result;
            if (!job || job.status !== "preparing" || job.controlOwner !== owner || lease?.owner !== owner || lease.expires <= now
              || (generation !== undefined && (job.generation || 0) !== generation)) {
              set(null); return;
            }
            const chapter = job.chapters.find(item => item.id === segment.chapterId);
            const passage = chapter?.passages.find(item => item.segmentId === segment.segmentId);
            if (!passage || passage.ready) { set(job); return; }
            tx.objectStore("segments").put({ jobId, ...metadata, bytes, mimeType: blob.type || "audio/wav" });
            passage.ready = true;
            passage.duration = segment.duration;
            passage.bytes = segment.blob.size;
            chapter.completedSegments++;
            chapter.audioDuration += segment.duration;
            chapter.complete = chapter.completedSegments === chapter.passages.length;
            job.completedSegments++;
            job.completedChars += passage.end - passage.start;
            job.completedChapters = job.chapters.filter(item => item.complete).length;
            job.audioBytes += segment.blob.size;
            job.audioDuration += segment.duration;
            job.updatedAt = now;
            if (job.completedSegments === job.totalSegments) job.status = "ready";
            jobs.put(job);
            set(job);
          } catch (error) { fail(error); }
        };
      });
    },
    async readSegment(jobId, segmentId) {
      const saved = await get("segments", [jobId, segmentId]);
      if (saved?.bytes?.byteLength) return new Blob([saved.bytes], { type: saved.mimeType || "audio/wav" });
      return saved?.blob || null;
    },
    removeJob(id) {
      return transaction(["jobs", "segments"], "readwrite", tx => {
        tx.objectStore("jobs").delete(id);
        const request = tx.objectStore("segments").index("jobId").openCursor(id);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
      });
    },
    clearAll() {
      // Clearing the stores avoids loading large WAVs and also removes orphaned
      // segments. The revision invalidates imports/conversions already in flight.
      return transaction(["jobs", "segments", "locks"], "readwrite", (tx, set, fail) => {
        const locks = tx.objectStore("locks");
        const request = locks.get("generation");
        request.onsuccess = () => {
          try {
            const generation = (request.result?.version || 0) + 1;
            tx.objectStore("jobs").clear();
            tx.objectStore("segments").clear();
            locks.clear();
            locks.put({ id: "generation", version: generation });
            set({ generation });
          } catch (error) { fail(error); }
        };
      });
    },
    async close() { (await connection)?.close(); connection = undefined; },
  };
}
