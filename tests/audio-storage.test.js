import { describe, expect, it, vi } from "vitest";
import { createAudioStorage } from "../src/audio-storage.js";

function setup() {
  const jobs = [
    { id: "a-old", bookId: "a", title: "Book A", audioBytes: 100, status: "ready", voice: { id: "old" } },
    { id: "a-new", bookId: "a", title: "Book A", audioBytes: 200, status: "preparing", voice: { id: "voice" } },
    { id: "b", bookId: "b", title: "Book B", audioBytes: 400, status: "ready", voice: { id: "voice" } },
    { id: "c", bookId: "c", title: "Book C", audioBytes: 0, status: "queued", voice: { id: "other" } },
  ];
  const queue = { list: vi.fn(async () => ({ jobs })), remove: vi.fn(), pause: vi.fn(), clearAll: vi.fn() };
  const downloads = { storageStatus: vi.fn(async () => ({ voices: [{ id: "voice", bytes: 500 }], sharedBytes: 100, unusedBytes: 50, totalBytes: 650 })),
    removeVoice: vi.fn(), clearAll: vi.fn(), removeLegacy: vi.fn() };
  const beforeRemoveBook = vi.fn(), beforeRemoveVoice = vi.fn();
  return { queue, downloads, beforeRemoveBook, beforeRemoveVoice, storage: createAudioStorage({ queue, downloads, beforeRemoveBook, beforeRemoveVoice }) };
}

describe("audio storage actions", () => {
  it("groups all voice versions of a book without duplicating shared voice files", async () => {
    const { storage } = setup();
    expect(await storage.load()).toMatchObject({ totalBytes: 1350, sharedBytes: 100, unusedBytes: 50,
      books: [{ id: "a", title: "Book A", bytes: 300 }, { id: "b", bytes: 400 }, { id: "c", bytes: 0 }] });
  });
  it("cancels pending book setup before deleting every recording of only that book", async () => {
    const { storage, queue, downloads, beforeRemoveBook } = setup();
    await storage.removeBook("a");
    expect(beforeRemoveBook).toHaveBeenCalledWith("a");
    expect(beforeRemoveBook.mock.invocationCallOrder[0]).toBeLessThan(queue.list.mock.invocationCallOrder[0]);
    expect(queue.remove.mock.calls).toEqual([["a-old"], ["a-new"]]);
    expect(downloads.removeVoice).not.toHaveBeenCalled();
    expect(queue.clearAll).not.toHaveBeenCalled();
  });
  it("pauses only unfinished jobs using a removed voice and retains all recordings", async () => {
    const { storage, queue, downloads } = setup();
    await storage.removeVoice("voice");
    expect(queue.pause.mock.calls).toEqual([["a-new"]]);
    expect(downloads.removeVoice).toHaveBeenCalledWith("voice");
    expect(queue.remove).not.toHaveBeenCalled();
  });
  it("offers separate audio-only and complete cleanup", async () => {
    const { storage, queue, downloads } = setup();
    await storage.clearAudio();
    expect(queue.clearAll).toHaveBeenCalledTimes(1);
    expect(downloads.clearAll).not.toHaveBeenCalled();
    await storage.clearAll();
    expect(queue.clearAll).toHaveBeenCalledTimes(2);
    expect(downloads.clearAll).toHaveBeenCalledTimes(1);
    await storage.cleanup();
    expect(downloads.removeLegacy).toHaveBeenCalledTimes(1);
  });
  it("does not remove voice files if audio cleanup fails and allows retry after a partial failure", async () => {
    const { storage, queue, downloads } = setup();
    queue.clearAll.mockRejectedValueOnce(new Error("Audio storage unavailable"));
    await expect(storage.clearAll()).rejects.toThrow("Audio storage unavailable");
    expect(downloads.clearAll).not.toHaveBeenCalled();
    downloads.clearAll.mockRejectedValueOnce(new Error("Voice storage unavailable"));
    await expect(storage.clearAll()).rejects.toThrow("Voice storage unavailable");
    await expect(storage.clearAll()).resolves.toBeUndefined();
  });
  it("prevents simultaneous storage changes", async () => {
    const { storage, queue, downloads } = setup();
    let finish;
    queue.clearAll.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = storage.clearAudio();
    await Promise.resolve();
    await expect(storage.removeVoice("voice")).rejects.toThrow("already running");
    expect(downloads.removeVoice).not.toHaveBeenCalled();
    finish(); await pending;
  });
});
