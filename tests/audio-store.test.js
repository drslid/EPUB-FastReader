// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createAudioStore } from "../src/audio-store.js";

let factory, store;
const sample = (id = "job") => ({ id, bookId: id, controlOwner: "owner", status: "preparing", totalSegments: 1,
  completedSegments: 0, completedChars: 0, completedChapters: 0, audioBytes: 0, audioDuration: 0,
  chapters: [{ id: "chapter", complete: false, completedSegments: 0, audioDuration: 0, passages: [{ segmentId: "segment", start: 0, end: 7, ready: false }] }] });
const segment = () => ({ segmentId: "segment", chapterId: "chapter", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), duration: 1.5 });

beforeEach(() => { factory = new IDBFactory(); store = createAudioStore({ indexedDB: factory }); });
afterEach(async () => { vi.restoreAllMocks(); await store.close(); });

describe("durable local audio storage", () => {
  it("commits PCM audio and completed progress atomically, surviving a connection restart", async () => {
    await store.putIfAbsent(sample());
    await store.acquireLease("owner", 1000);
    const saved = await store.commitSegment("job", segment(), "owner", 1500);
    expect(saved).toMatchObject({ status: "ready", completedChars: 7, completedSegments: 1, audioBytes: 3, audioDuration: 1.5, completedChapters: 1 });
    await store.close();
    store = createAudioStore({ indexedDB: factory });
    expect(await store.getJob("job")).toMatchObject({ status: "ready", audioBytes: 3 });
    expect([...new Uint8Array(await (await store.readSegment("job", "segment")).arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("does not count a duplicate saved passage twice", async () => {
    await store.putIfAbsent(sample()); await store.acquireLease("owner", 1000);
    await store.commitSegment("job", segment(), "owner", 1500);
    await store.commitSegment("job", segment(), "owner", 1600);
    expect(await store.getJob("job")).toMatchObject({ completedSegments: 1, audioBytes: 3 });
  });

  it("rolls back metadata and blob together on quota errors", async () => {
    await store.putIfAbsent(sample()); await store.acquireLease("owner", 1000);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (value) {
      if (this.name === "segments") throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, value);
    });
    await expect(store.commitSegment("job", segment(), "owner", 1500)).rejects.toHaveProperty("name", "QuotaExceededError");
    expect(await store.getJob("job")).toMatchObject({ completedSegments: 0, audioBytes: 0 });
    expect(await store.readSegment("job", "segment")).toBeNull();
  });

  it("rejects expired leases and stale workers after another owner takes over", async () => {
    await store.putIfAbsent(sample());
    expect(await store.acquireLease("owner", 1000, 100)).toBe(true);
    expect(await store.acquireLease("other", 1050)).toBe(false);
    expect(await store.commitSegment("job", segment(), "owner", 1101)).toBeNull();
    expect(await store.acquireLease("other", 1200)).toBe(true);
    expect(await store.commitSegment("job", segment(), "owner", 1250)).toBeNull();
    await store.releaseLease("owner");
    expect(await store.getLease()).toMatchObject({ owner: "other" });
  });

  it("never saves an in-flight result after the user paused or deleted its job", async () => {
    await store.putIfAbsent(sample()); await store.acquireLease("owner", 1000);
    await store.mutateJob("job", job => ({ ...job, status: "paused" }));
    expect(await store.commitSegment("job", segment(), "owner", 1500)).toBeNull();
    await store.removeJob("job");
    expect(await store.commitSegment("job", segment(), "owner", 1500)).toBeNull();
    expect(await store.readSegment("job", "segment")).toBeNull();
  });

  it("deletes only the selected conversion and all of its audio", async () => {
    await store.putIfAbsent(sample("remove")); await store.putIfAbsent(sample("keep")); await store.acquireLease("owner", 1000);
    await store.commitSegment("remove", segment(), "owner", 1500);
    await store.commitSegment("keep", segment(), "owner", 1500);
    await store.removeJob("remove");
    expect((await store.listJobs()).map(job => job.id)).toEqual(["keep"]);
    expect(await store.readSegment("remove", "segment")).toBeNull();
    expect((await store.readSegment("keep", "segment")).size).toBe(3);
  });

  it("deduplicates concurrent creates without overwriting existing progress", async () => {
    await Promise.all([store.putIfAbsent(sample()), store.putIfAbsent({ ...sample(), title: "other" })]);
    expect(await store.listJobs()).toHaveLength(1);
    await store.mutateJob("job", job => ({ ...job, audioBytes: 999 }));
    expect(await store.putIfAbsent(sample())).toMatchObject({ audioBytes: 999 });
  });

  it("clears every job, audio segment and conversion lease, including orphaned bytes", async () => {
    await store.putIfAbsent(sample("first"));
    await store.putIfAbsent(sample("second"));
    await store.acquireLease("owner", 1000);
    await store.commitSegment("first", segment(), "owner", 1500);
    await store.commitSegment("second", segment(), "owner", 1500);
    await new Promise((resolve, reject) => {
      const request = factory.open("fastreader-audio", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("segments", "readwrite");
        tx.objectStore("segments").put({ jobId: "orphan", segmentId: "segment", bytes: new Uint8Array([4, 5]).buffer, mimeType: "audio/wav" });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    expect((await store.readSegment("orphan", "segment")).size).toBe(2);
    const generation = await store.getGeneration();
    await store.clearAll();
    expect(await store.listJobs()).toEqual([]);
    expect(await store.getLease()).toBeUndefined();
    for (const id of ["first", "second", "orphan"]) expect(await store.readSegment(id, "segment")).toBeNull();
    expect(await store.getGeneration()).toBe(generation + 1);
    await store.close();
    store = createAudioStore({ indexedDB: factory });
    expect(await store.getGeneration()).toBe(generation + 1);
    await store.clearAll();
    expect(await store.getGeneration()).toBe(generation + 2);
  });

  it("rolls back jobs, audio, lease and generation together if clearing storage fails", async () => {
    await store.putIfAbsent(sample());
    await store.acquireLease("owner", 1000);
    await store.commitSegment("job", segment(), "owner", 1500);
    const generation = await store.getGeneration();
    const previous = await store.getJob("job");
    const original = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(function () {
      if (this.name === "segments") throw new DOMException("Storage unavailable", "UnknownError");
      return original.call(this);
    });
    await expect(store.clearAll()).rejects.toHaveProperty("name", "UnknownError");
    expect(await store.getJob("job")).toEqual(previous);
    expect((await store.readSegment("job", "segment")).size).toBe(3);
    expect(await store.getLease()).toMatchObject({ owner: "owner" });
    expect(await store.getGeneration()).toBe(generation);
  });

  it("rejects an enqueue from before the clear while allowing a new generation", async () => {
    const before = await store.getGeneration();
    await store.clearAll();
    expect(await store.putIfAbsent(sample(), { generation: before })).toBeNull();
    expect(await store.listJobs()).toEqual([]);
    const current = await store.getGeneration();
    const fresh = { ...sample(), title: "New preparation" };
    expect(await store.putIfAbsent(fresh, { generation: current })).toEqual({ ...fresh, generation: current });
    expect(await store.putIfAbsent(sample(), { generation: before })).toBeNull();
    expect(await store.getJob("job")).toEqual({ ...fresh, generation: current });
  });

  it("rejects audio whose bytes finish loading after the cache was cleared", async () => {
    await store.putIfAbsent(sample());
    await store.acquireLease("owner", 1000);
    let finishBytes;
    const bytes = new Promise(resolve => { finishBytes = resolve; });
    const committing = store.commitSegment("job", { ...segment(), blob: { size: 3, type: "audio/wav", arrayBuffer: () => bytes } }, "owner", 1500);
    await store.clearAll();
    finishBytes(new Uint8Array([1, 2, 3]).buffer);
    expect(await committing).toBeNull();
    expect(await store.listJobs()).toEqual([]);
    expect(await store.readSegment("job", "segment")).toBeNull();
  });

  it("never appends a stale result to the same book re-created by the same tab after clearing", async () => {
    const oldGeneration = await store.getGeneration();
    await store.putIfAbsent(sample(), { generation: oldGeneration });
    await store.acquireLease("owner", 1000);
    let finishBytes;
    const bytes = new Promise(resolve => { finishBytes = resolve; });
    const late = store.commitSegment("job", { ...segment(), blob: { size: 3, type: "audio/wav", arrayBuffer: () => bytes } }, "owner", 1500, oldGeneration);
    await store.clearAll();
    const generation = await store.getGeneration();
    await store.putIfAbsent(sample(), { generation });
    await store.acquireLease("owner", 1000);
    finishBytes(new Uint8Array([9, 9, 9]).buffer);
    expect(await late).toBeNull();
    expect(await store.readSegment("job", "segment")).toBeNull();
    expect(await store.getJob("job")).toMatchObject({ generation, completedSegments: 0, audioBytes: 0 });
    expect(await store.commitSegment("job", segment(), "owner", 1500, generation)).toMatchObject({ status: "ready", generation });
    expect([...new Uint8Array(await (await store.readSegment("job", "segment")).arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
