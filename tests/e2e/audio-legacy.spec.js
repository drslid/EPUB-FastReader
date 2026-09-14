import { test, expect } from "./fixtures.js";
import JSZip from "jszip";
import { makeEpub, importEpub, storedRows } from "./helpers/fixtures.js";
import { voiceForId } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

const sentence = "Cette phrase doit rester entière même lorsque deux anciens enregistrements séparés sont nécessaires pour écouter toute sa fin.";
const firstSamples = [101, -102, 103];
const secondSamples = [201, -202, 203, -204];

async function storedFragment(page, { book, complete = false }) {
  return page.evaluate(async ({ book, complete, sentence, firstSamples, secondSamples, voice }) => {
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sentence)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const split = sentence.indexOf(" anciens");
    const pcm = samples => {
      const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
      for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
        [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
      }
      view.setUint32(4, bytes.byteLength - 8, true); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, samples.length * 2, true);
      samples.forEach((value, index) => view.setInt16(44 + index * 2, value, true));
      return bytes;
    };
    const id = `legacy-audio-${book.id}`;
    const buffers = [pcm(firstSamples), pcm(secondSamples)];
    const durations = [firstSamples.length / 24000, secondSamples.length / 24000];
    const passages = [[0, split], [split + 1, sentence.length]].map(([start, end], index) => ({
      start, end, segmentId: `legacy-part-${index}`, ready: index === 0 || complete,
      ...(index === 0 || complete ? { bytes: buffers[index].byteLength, duration: durations[index] } : {}),
    }));
    const ready = complete ? 2 : 1;
    const job = { id, bookId: book.id, title: book.title, voice, segmentationVersion: 1,
      status: complete ? "ready" : "paused", controlOwner: "legacy-fixture", error: null,
      createdAt: 1000, updatedAt: complete ? 2000 : 1000,
      totalSegments: 2, completedSegments: ready, totalChars: sentence.length - 1,
      completedChars: complete ? sentence.length - 1 : split, completedChapters: complete ? 1 : 0,
      audioBytes: buffers.slice(0, ready).reduce((total, bytes) => total + bytes.byteLength, 0),
      audioDuration: durations.slice(0, ready).reduce((total, duration) => total + duration, 0),
      chapters: [{ id: book.chapters[0].id, index: 0, title: book.chapters[0].title, text: sentence, digest,
        complete, completedSegments: ready, audioDuration: durations.slice(0, ready).reduce((total, duration) => total + duration, 0), passages }],
    };
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("fastreader-audio", 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("jobs", { keyPath: "id" });
        const segments = open.result.createObjectStore("segments", { keyPath: ["jobId", "segmentId"] });
        segments.createIndex("jobId", "jobId");
        open.result.createObjectStore("locks", { keyPath: "id" });
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(["jobs", "segments"], "readwrite");
        tx.objectStore("jobs").put(job);
        for (let index = 0; index < ready; index++) {
          tx.objectStore("segments").put({ jobId: id, chapterId: book.chapters[0].id, segmentId: passages[index].segmentId,
            bytes: buffers[index], mimeType: "audio/wav", duration: durations[index] });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const changes = new BroadcastChannel("fastreader-audio-queue");
    changes.postMessage({ type: "changed" }); changes.close();
    return id;
  }, { book, complete, sentence, firstSamples, secondSamples, voice: voiceForId("ff_siwis") });
}

test("legacy fragments wait for the complete sentence, then play one intact WAV without another voice worker", async ({ page, context, browserName }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__legacyWorkers = 0;
    window.__legacyAudioPlays = [];
    window.Worker = class {
      constructor(url, options) {
        if (String(url).includes("voice-runtime/")) { window.__legacyWorkers++; throw new Error("Legacy audio must never create a synthesis worker"); }
        return new NativeWorker(url, options);
      }
    };
    window.Audio = class extends EventTarget {
      constructor() { super(); this.src = ""; this.paused = true; window.__legacyAudio = this; }
      async play() {
        const source = this.src;
        this.paused = false;
        const bytes = await (await fetch(source)).arrayBuffer();
        // The user-gesture unlock clip contains only silence. Record actual
        // prepared samples, including their order and the final sample.
        const samples = [...new Int16Array(bytes, 44)];
        if (samples.some(sample => sample !== 0)) window.__legacyAudioPlays.push({ source, samples, bytes: bytes.byteLength });
      }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    };
  });
  await page.goto("/");
  const epub = await JSZip.loadAsync(await makeEpub({ title: "Une ancienne préparation", chapters: 1, paragraphs: [sentence] }));
  // A plain paragraph makes its canonical offsets explicit in this fixture.
  epub.file("chapter0.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapitre</title></head><body><p>${sentence}</p></body></html>`);
  await importEpub(page, await epub.generateAsync({ type: "nodebuffer" }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.locator("#chapter-content")).toHaveText(sentence);
  const [book] = await storedRows(page, "books");
  const id = await storedFragment(page, { book });
  // WebKit's offline emulation also breaks new Blob([bytes]).arrayBuffer()
  // with NotReadableError. Deny HTTP(S), keeping local Blob I/O functional.
  if (browserName === "webkit") await context.route(/^https?:\/\//u, route => route.abort("internetdisconnected"));
  else await context.setOffline(true);
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  const job = page.locator(`[data-audio-job="${id}"]`);
  await expect(job).toHaveAttribute("data-status", "paused");
  await job.locator('[data-audio-queue-action="listen"]').click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "buffering");
  expect(await page.evaluate(() => window.__legacyAudioPlays)).toEqual([]);
  expect(await page.evaluate(() => window.__legacyWorkers)).toBe(0);

  await storedFragment(page, { book, complete: true });
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await expect(page.locator(".voice-current-passage")).toHaveText(sentence);
  expect(await page.evaluate(() => window.__legacyAudioPlays.map(play => play.samples))).toEqual([[...firstSamples, ...secondSamples]]);
  expect(await page.evaluate(() => window.__legacyAudio.paused)).toBe(false);
  expect(await page.evaluate(() => window.__legacyWorkers)).toBe(0);
  expect(errors).toEqual([]);
});
