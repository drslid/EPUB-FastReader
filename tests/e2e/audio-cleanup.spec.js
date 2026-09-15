import { test, expect } from "./fixtures.js";
import JSZip from "jszip";
import AxeBuilder from "@axe-core/playwright";
import { makeEpub, importEpub, storedRows } from "./helpers/fixtures.js";
import { assetsForVoice, legacyVoiceForId, voiceForId, VOICE_CACHE_NAME, LEGACY_VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

const text = "Cette histoire reste disponible dans la bibliothèque après avoir supprimé son audio.";
const bookContents = books => books.map(({ id, title, chapters, original }) => ({ id, title, chapters, original }));

async function seedSavedAudio(page, book, otherBook = null) {
  await page.evaluate(async ({ book, otherBook, text, voice, currentVoice, assets, cacheName }) => {
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
        tx.objectStore("jobs").put({ ...job, id: "another-saved-audio", voice: currentVoice });
        for (const jobId of [job.id, "another-saved-audio"]) {
          tx.objectStore("segments").put({ jobId, chapterId: book.chapters[0].id, segmentId: "passage", bytes, mimeType: "audio/wav", duration });
        }
        if (otherBook) {
          tx.objectStore("jobs").put({ ...job, id: "other-book-audio", bookId: otherBook.id, title: otherBook.title,
            chapters: job.chapters.map(chapter => ({ ...chapter, id: otherBook.chapters[0].id, title: otherBook.chapters[0].title })) });
          tx.objectStore("segments").put({ jobId: "other-book-audio", chapterId: otherBook.chapters[0].id, segmentId: "passage", bytes, mimeType: "audio/wav", duration });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("downloaded voice retained", { headers: { "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256 } }));
    const changes = new BroadcastChannel("fastreader-audio-queue");
    changes.postMessage({ type: "changed" }); changes.close();
  }, { book, otherBook, text, voice: legacyVoiceForId("ff_siwis"), currentVoice: voiceForId("piper-fr_FR-siwis-medium"), assets: assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
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

async function setup(page, { secondBook = false } = {}) {
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
  for (const title of secondBook ? ["Autre livre conservé", "Mon livre conservé"] : ["Mon livre conservé"]) {
    const epub = await JSZip.loadAsync(await makeEpub({ title, chapters: 1, paragraphs: [text] }));
    epub.file("chapter0.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapitre</title></head><body><p>${text}</p></body></html>`);
    await importEpub(page, await epub.generateAsync({ type: "nodebuffer" }));
    await expect(page.locator("#rsvp")).toBeVisible();
    await expect(page.locator(".reader-title strong")).toContainText(title);
  }
  const books = await storedRows(page, "books");
  const book = books.find(value => value.title === "Mon livre conservé");
  const otherBook = books.find(value => value.id !== book.id);
  await seedSavedAudio(page, book, otherBook);
  await page.locator('[data-mode="audio"]').click();
  await expect(page.locator(".audio-queue-job")).toHaveCount(secondBook ? 3 : 2);
  return { book, otherBook, books };
}

async function openStorage(page) {
  await page.locator("[data-audio-queue-storage]").click();
  await expect(page.locator(".audio-storage-dialog")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".audio-queue-dialog")).toHaveCount(0);
}

async function voiceCacheCount(page) {
  return page.evaluate(async cacheName => (await (await caches.open(cacheName)).keys()).length, VOICE_CACHE_NAME);
}

async function confirmDeletion(page) {
  await page.locator('[data-storage-action="confirm"]').click();
  await expect(page.locator("[data-storage-notice]")).toHaveText("Espace libéré.");
}

test("clear generated audio stops listening, frees IndexedDB and keeps EPUBs and downloaded voices on a small screen", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const { book, books } = await setup(page);
  await page.locator('[data-audio-job="saved-book-audio"] [data-audio-queue-action="listen"]').click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await page.locator('.reader-commandbar [data-action="audio-queue"]').click();
  await openStorage(page);
  await expect(page.locator(`[data-storage-book="${book.id}"]`)).toContainText("2 Mo");
  await page.screenshot({ path: testInfo.outputPath("friendly-storage.png"), fullPage: true });
  await page.locator('[data-storage-action="audio"]').click();
  await expect(page.locator('[data-storage-action="cancel"]')).toBeFocused();
  await page.locator('[data-storage-action="cancel"]').click();
  expect(await audioCounts(page)).toEqual({ jobs: 2, segments: 2 });
  expect(await page.evaluate(() => window.__cleanupAudio.paused)).toBe(false);
  await page.locator('[data-storage-action="audio"]').click();
  expect(await page.locator(".audio-storage-dialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  for (const action of ["cancel", "confirm"]) {
    expect((await page.locator(`[data-storage-action="${action}"]`).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect((await new AxeBuilder({ page }).include(".audio-storage-dialog").analyze()).violations).toEqual([]);
  await confirmDeletion(page);
  await expect(page.locator('[data-storage-action="audio"]')).toBeDisabled();
  expect(await audioCounts(page)).toEqual({ jobs: 0, segments: 0 });
  expect(await page.evaluate(() => window.__cleanupAudio.paused)).toBe(true);
  expect(await voiceCacheCount(page)).toBe(assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/").length);
  expect(bookContents(await storedRows(page, "books"))).toEqual(bookContents(books));
  await page.locator('[data-storage-action="close"]').click();
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await page.locator('.topbar [data-action="audio-queue"]').click();
  await expect(page.locator("[data-audio-queue-empty]")).toBeVisible();
  expect(await audioCounts(page)).toEqual({ jobs: 0, segments: 0 });
  expect(errors).toEqual([]);
});

test("deleting a book's audio removes every voice version while preserving another book and its WAV", async ({ page }) => {
  const { book, otherBook, books } = await setup(page, { secondBook: true });
  await openStorage(page);
  await expect(page.locator("[data-storage-book]")).toHaveCount(2);
  await page.locator(`[data-storage-book="${book.id}"] [data-storage-action="book"]`).click();
  await expect(page.locator("[data-storage-confirmation]")).toContainText(book.title);
  await confirmDeletion(page);
  await expect(page.locator(`[data-storage-book="${book.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-storage-book="${otherBook.id}"]`)).toBeVisible();
  expect(await audioCounts(page)).toEqual({ jobs: 1, segments: 1 });
  const surviving = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("fastreader-audio", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(["jobs", "segments"]);
      const jobs = tx.objectStore("jobs").getAll(), segments = tx.objectStore("segments").getAll();
      tx.oncomplete = () => { db.close(); resolve({ jobs: jobs.result.map(job => job.bookId), segments: segments.result.map(segment => ({ jobId: segment.jobId, bytes: segment.bytes.byteLength })) }); };
    };
  }));
  expect(surviving).toEqual({ jobs: [otherBook.id], segments: [{ jobId: "other-book-audio", bytes: 1_000_000 }] });
  expect(bookContents(await storedRows(page, "books"))).toEqual(bookContents(books));
  expect(await voiceCacheCount(page)).toBeGreaterThan(0);
  await page.locator('[data-storage-action="close"]').click();
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(await audioCounts(page)).toEqual({ jobs: 1, segments: 1 });
});

test("voice removal is confirmed separately and preserves every prepared recording", async ({ page }) => {
  const { books } = await setup(page);
  await openStorage(page);
  const voice = '[data-storage-voice="piper-fr_FR-siwis-medium"]';
  await page.locator(`${voice} [data-storage-action="voice"]`).click();
  await expect(page.locator("[data-storage-confirmation]")).toContainText("audios déjà préparés restent disponibles");
  await page.keyboard.press("Escape");
  await expect(page.locator(`${voice} [data-storage-action="voice"]`)).toBeFocused();
  expect(await voiceCacheCount(page)).toBeGreaterThan(0);
  await page.locator(`${voice} [data-storage-action="voice"]`).click();
  await confirmDeletion(page);
  await expect(page.locator(voice)).toHaveCount(0);
  expect(await voiceCacheCount(page)).toBe(0);
  expect(await audioCounts(page)).toEqual({ jobs: 2, segments: 2 });
  expect(bookContents(await storedRows(page, "books"))).toEqual(bookContents(books));
  await page.locator('[data-storage-action="close"]').click();
  await page.locator('[data-mode="audio"]').click();
  await page.locator('[data-audio-job="another-saved-audio"] [data-audio-queue-action="listen"]').click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
});

test("freeing all audio storage removes recordings, voices and unused engine files while preserving EPUBs", async ({ page }) => {
  const { books } = await setup(page);
  const own = "http://127.0.0.1:4173/voice-runtime/v1/worker.js";
  const sibling = "http://127.0.0.1:4173/other/voice-runtime/v1/worker.js";
  await page.evaluate(async ({ cacheName, own, sibling }) => {
    const cache = await caches.open(cacheName);
    await cache.put(own, new Response("retired engine", { headers: { "Content-Length": "11000000" } }));
    await cache.put(sibling, new Response("another installation"));
  }, { cacheName: LEGACY_VOICE_CACHE_NAME, own, sibling });
  await openStorage(page);
  await expect(page.locator(".audio-storage-unused")).toContainText("11 Mo");
  await page.locator('[data-storage-action="all"]').click();
  await page.locator('[data-storage-action="cancel"]').click();
  expect(await audioCounts(page)).toEqual({ jobs: 2, segments: 2 });
  expect(await voiceCacheCount(page)).toBeGreaterThan(0);
  await page.locator('[data-storage-action="all"]').click();
  await confirmDeletion(page);
  expect(await audioCounts(page)).toEqual({ jobs: 0, segments: 0 });
  expect(await voiceCacheCount(page)).toBe(0);
  await expect(page.locator("[data-storage-total]")).toContainText("0 Mo");
  await expect(page.locator('[data-storage-action="all"]')).toBeDisabled();
  const oldFiles = await page.evaluate(async ({ cacheName, own, sibling }) => {
    const cache = await caches.open(cacheName);
    return { own: Boolean(await cache.match(own)), sibling: Boolean(await cache.match(sibling)) };
  }, { cacheName: LEGACY_VOICE_CACHE_NAME, own, sibling });
  expect(oldFiles).toEqual({ own: false, sibling: true });
  expect(bookContents(await storedRows(page, "books"))).toEqual(bookContents(books));
  await page.locator('[data-storage-action="close"]').click();
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(await audioCounts(page)).toEqual({ jobs: 0, segments: 0 });
  expect(await voiceCacheCount(page)).toBe(0);
});
