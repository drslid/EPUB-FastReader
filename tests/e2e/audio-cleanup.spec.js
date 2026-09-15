import { test, expect } from "./fixtures.js";
import JSZip from "jszip";
import AxeBuilder from "@axe-core/playwright";
import { makeEpub, importEpub, storedRows } from "./helpers/fixtures.js";
import { assetsForVoice, legacyVoiceForId, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

const text = "Cette histoire reste disponible dans la bibliothèque après avoir supprimé son audio.";

async function seedSavedAudio(page, book) {
  await page.evaluate(async ({ book, text, voice, assets, cacheName }) => {
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const bytes = new ArrayBuffer(1_000_000);
    const wav = new DataView(bytes), duration = (bytes.byteLength - 44) / 44100;
    for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
      [...value].forEach((character, index) => wav.setUint8(offset + index, character.charCodeAt(0)));
    }
    wav.setUint32(4, bytes.byteLength - 8, true); wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, 22050, true); wav.setUint32(28, 44100, true);
    wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); wav.setUint32(40, bytes.byteLength - 44, true);
    const job = { id: "saved-book-audio", bookId: book.id, title: book.title, voice, segmentationVersion: 2,
      status: "ready", controlOwner: "fixture", error: null, createdAt: 1000, updatedAt: 2000,
      totalSegments: 1, completedSegments: 1, totalChars: text.length, completedChars: text.length,
      completedChapters: 1, audioBytes: bytes.byteLength, audioDuration: duration,
      chapters: [{ id: book.chapters[0].id, index: 0, title: book.chapters[0].title, text, digest,
        complete: true, completedSegments: 1, audioDuration: duration,
        passages: [{ start: 0, end: text.length, segmentId: "passage", ready: true, bytes: bytes.byteLength, duration }] }],
    };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("fastreader-audio", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["jobs", "segments"], "readwrite");
        tx.objectStore("jobs").put(job);
        tx.objectStore("jobs").put({ ...job, id: "another-saved-audio", status: "paused", completedSegments: 0, completedChars: 0, completedChapters: 0, audioBytes: 0, chapters: job.chapters.map(chapter => ({ ...chapter, complete: false, completedSegments: 0, passages: chapter.passages.map(passage => ({ ...passage, ready: false })) })) });
        tx.objectStore("segments").put({ jobId: job.id, chapterId: book.chapters[0].id, segmentId: "passage", bytes, mimeType: "audio/wav", duration });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("downloaded voice retained", { headers: { "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256 } }));
    const changes = new BroadcastChannel("fastreader-audio-queue");
    changes.postMessage({ type: "changed" }); changes.close();
  }, { book, text, voice: legacyVoiceForId("ff_siwis"), assets: assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
}

async function audioCounts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("fastreader-audio", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(["jobs", "segments"]);
      const jobs = tx.objectStore("jobs").count(), segments = tx.objectStore("segments").count();
      tx.oncomplete = () => { db.close(); resolve({ jobs: jobs.result, segments: segments.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

test("clear generated audio stops listening, frees IndexedDB and keeps EPUBs and downloaded voices on a small screen", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (String(url).includes("voice-runtime/")) throw new Error("Saved audio cleanup must not launch generation");
        return new NativeWorker(url, options);
      }
    };
    window.Audio = class extends EventTarget {
      constructor() { super(); this.src = ""; this.paused = true; window.__cleanupAudio = this; }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    };
  });
  await page.goto("/");
  const epub = await JSZip.loadAsync(await makeEpub({ title: "Mon livre conservé", chapters: 1, paragraphs: [text] }));
  epub.file("chapter0.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapitre</title></head><body><p>${text}</p></body></html>`);
  await importEpub(page, await epub.generateAsync({ type: "nodebuffer" }));
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  await seedSavedAudio(page, book);
  await page.locator('[data-mode="audio"]').click();
  await expect(page.locator(".audio-queue-job")).toHaveCount(2);
  await expect(page.locator("[data-audio-queue-size]")).toHaveText("Audio généré : 1 Mo");
  await page.locator('[data-audio-job="saved-book-audio"] [data-audio-queue-action="listen"]').click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await page.locator('.reader-commandbar [data-action="audio-queue"]').click();
  await page.locator("[data-audio-queue-clear]").click();
  await expect(page.locator("[data-audio-queue-clear-cancel]")).toBeFocused();
  await page.locator("[data-audio-queue-clear-cancel]").click();
  expect(await audioCounts(page)).toEqual({ jobs: 2, segments: 1 });
  expect(await page.evaluate(() => window.__cleanupAudio.paused)).toBe(false);
  await page.locator("[data-audio-queue-clear]").click();
  expect(await page.locator(".audio-queue-dialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  for (const selector of ["[data-audio-queue-clear-cancel]", "[data-audio-queue-clear-confirm]"]) {
    expect((await page.locator(selector).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect((await new AxeBuilder({ page }).include(".audio-queue-dialog").analyze()).violations).toEqual([]);
  await page.locator("[data-audio-queue-clear-confirm]").click();
  await expect(page.locator("[data-audio-queue-notice]")).toContainText("Vos livres et vos voix sont conservés");
  await expect(page.locator("[data-audio-queue-size]")).toHaveText("Audio généré : 0 Mo");
  await expect(page.locator("[data-audio-queue-clear]")).toBeDisabled();
  expect(await audioCounts(page)).toEqual({ jobs: 0, segments: 0 });
  expect(await page.evaluate(() => window.__cleanupAudio.paused)).toBe(true);
  const retained = await page.evaluate(async cacheName => (await (await caches.open(cacheName)).keys()).length, VOICE_CACHE_NAME);
  expect(retained).toBe(assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/").length);
  expect((await storedRows(page, "books")).map(({ id, title }) => ({ id, title }))).toEqual([{ id: book.id, title: book.title }]);
  await page.locator("[data-audio-queue-close]").click();
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await page.locator('.topbar [data-action="audio-queue"]').click();
  await expect(page.locator("[data-audio-queue-empty]")).toBeVisible();
  expect(await audioCounts(page)).toEqual({ jobs: 0, segments: 0 });
  expect(errors).toEqual([]);
});
