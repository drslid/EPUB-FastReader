// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPreparedVoiceSource } from "../src/prepared-voice.js";

const text = "La première phrase reste entière même lorsque ses enregistrements sont séparés. La suivante attend.";
const end = text.indexOf(".") + 1;
const segments = [[0, 26], [26, end], [end + 1, text.length]].map(([start, end], i) => ({
  start, end, text: text.slice(start, end), segmentId: String(i), duration: 2 / 24000,
}));
function wav(value) {
  const buffer = new ArrayBuffer(48), view = new DataView(buffer);
  for (const [at, tag] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
    [...tag].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  }
  view.setUint32(4, 40, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 4, true);
  view.setInt16(44, value, true);
  return new Blob([buffer], { type: "audio/wav" });
}
function setup({ count = 1, complete = false, segmentationVersion } = {}) {
  let initial = { jobId: "job", chapterId: "chapter", voice: { id: "ff_siwis", language: "fr" },
    passages: segments.slice(0, count), complete, status: "preparing", segmentationVersion };
  let changed;
  const queue = {
    getPreparedChapter: vi.fn(async () => initial),
    readSegment: vi.fn(async (_, id) => wav(Number(id) + 1)),
    subscribe: vi.fn(listener => { changed = listener; return vi.fn(); }),
  };
  const source = createPreparedVoiceSource(queue, initial, { bookId: "book", chapterId: "chapter", text });
  return { source, queue, publish: update => { initial = update === null ? null : { ...initial, ...update }; }, notify: snapshot => changed(snapshot) };
}

describe("previously prepared short audio", () => {
  it("waits until a complete sentence is ready, then combines all old samples without regeneration", async () => {
    const { source, queue, publish } = setup();
    expect(source.passages).toEqual([]);
    expect(source.complete).toBe(false);
    publish({ passages: segments.slice(0, 2) });
    const manifest = await source.getSnapshot();
    expect(manifest.passages).toHaveLength(1);
    expect(manifest.passages[0]).toMatchObject({ start: 0, end, text: text.slice(0, end) });
    const audio = await source.read(manifest.passages[0]);
    expect([...new Int16Array(await audio.blob.arrayBuffer(), 44)]).toEqual([1, 0, 2, 0]);
    expect(audio.duration).toBe(4 / 24000);
    expect(queue.readSegment.mock.calls).toEqual([["job", "0"], ["job", "1"]]);
    expect(queue.getPreparedChapter).toHaveBeenCalledWith("book", "ff_siwis", "chapter", text, { jobId: "job" });
  });

  it("keeps published sentence identities stable as later sentences become ready", async () => {
    const { source, publish } = setup({ count: 2 });
    const first = source.passages[0];
    publish({ passages: segments, complete: true, status: "ready" });
    const complete = await source.getSnapshot();
    expect(complete.passages).toHaveLength(2);
    expect(complete.passages[0]).toEqual(first);
    expect(complete.passages[1].text).toBe("La suivante attend.");
    expect(complete.complete).toBe(true);
  });

  it("reads new complete-sentence recordings directly", async () => {
    const { source, queue } = setup({ segmentationVersion: 2 });
    expect(source.passages).toEqual(segments.slice(0, 1));
    const audio = await source.read(source.passages[0]);
    expect(audio.blob.size).toBe(48);
    expect(queue.readSegment).toHaveBeenCalledOnce();
  });

  it("rejects missing or corrupt legacy audio instead of reading an incomplete sentence", async () => {
    const { source, queue } = setup({ count: 2 });
    queue.readSegment.mockResolvedValueOnce(null);
    await expect(source.read(source.passages[0])).rejects.toMatchObject({ code: "AUDIO_MISSING" });
    queue.readSegment.mockResolvedValue(new Blob(["corrupt"]));
    await expect(source.read(source.passages[0])).rejects.toMatchObject({ code: "AUDIO_MISSING" });
  });

  it("does not read or combine further fragments after cancellation", async () => {
    const { source, queue } = setup({ count: 2 });
    const controller = new AbortController();
    queue.readSegment.mockImplementation(async () => { controller.abort(); return wav(1); });
    await expect(source.read(source.passages[0], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.readSegment).toHaveBeenCalledOnce();
  });

  it("reports removed jobs and ignores duplicate queue notifications", async () => {
    const { source, publish, notify } = setup();
    const onChange = vi.fn();
    source.subscribe(onChange);
    const job = { id: "job", status: "preparing", chapters: [{ id: "chapter", readySegments: 1, totalSegments: 3, complete: false }] };
    notify({ jobs: [job] });
    notify({ jobs: [job], suspended: [] });
    expect(onChange).toHaveBeenCalledOnce();
    notify({ jobs: [{ ...job, status: "paused" }] });
    expect(onChange).toHaveBeenCalledTimes(2);
    publish(null);
    notify({ jobs: [] });
    expect(await source.getSnapshot()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
