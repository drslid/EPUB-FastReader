import { test, expect } from "./fixtures.js";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";
import { importEpub, makeEpub } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });
const voiceId = "piper-fr_FR-siwis-medium";
const assets = assetsForVoice(voiceId, "http://127.0.0.1:4173/");

async function pausedPreparation(page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 4 });
    window.__runtimeWorkers = 0;
    window.__runtimePassages = 0;
    // Inference is mocked; cache inspection, update downloads and the app's
    // existing preparation/resume path remain real.
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("voice-runtime/")) return new OriginalWorker(url, options);
        this.stopped = false;
        window.__runtimeWorkers++;
      }
      postMessage(data) {
        if (data.type === "synthesize") { window.__runtimePassages++; return; }
        queueMicrotask(() => { if (!this.stopped) this.onmessage?.({ data: { id: data.id, result: {} } }); });
      }
      terminate() { this.stopped = true; }
    };
  });
  await page.goto("/");
  await page.evaluate(async ({ assets, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("verified fixture", { headers: {
      "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
    } }));
  }, { assets, cacheName: VOICE_CACHE_NAME });
  await importEpub(page, await makeEpub({ title: "Préparation existante", chapters: 1, paragraphs: ["Camille ouvre son livre. Elle commence une nouvelle histoire."] }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-prepare]").click();
  const row = page.locator(".audio-queue-job");
  await expect(row).toHaveAttribute("data-status", "preparing");
  await expect.poll(() => page.evaluate(() => window.__runtimeWorkers)).toBeGreaterThan(0);
  await row.locator('[data-audio-queue-action="pause"]').click();
  await expect(row).toHaveAttribute("data-status", "paused");
  return row;
}

async function makeRuntimeOutdated(page) {
  const files = assets.filter(asset => ["piper-phoneme-map.js", "worker.js"].includes(asset.file));
  await page.evaluate(async ({ files, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const asset of files) await cache.put(asset.url, new Response("previous runtime", { headers: {
      "Content-Length": "16", "X-Fastreader-Voice-SHA256": "outdated",
    } }));
  }, { files, cacheName: VOICE_CACHE_NAME });
  return files;
}

test("resuming an existing preparation repairs only its outdated runtime dependencies", async ({ page }) => {
  const row = await pausedPreparation(page);
  const files = await makeRuntimeOutdated(page);
  const requests = [];
  page.on("request", request => { if (/voice-runtime|huggingface/.test(request.url())) requests.push(request.url()); });
  const workers = await page.evaluate(() => window.__runtimeWorkers);
  await row.locator('[data-audio-queue-action="resume"]').click();
  await expect.poll(() => page.evaluate(() => window.__runtimeWorkers)).toBe(workers + 1);
  await expect(row).toHaveAttribute("data-status", "preparing");
  await expect(page.locator(".voice-dialog")).toHaveCount(0);
  expect(requests).toEqual(files.map(asset => asset.source));
  expect(files.map(asset => asset.file)).toEqual(["piper-phoneme-map.js", "worker.js"]);
  expect(await page.evaluate(async ({ files, cacheName }) => {
    const cache = await caches.open(cacheName);
    return Promise.all(files.map(async asset => (await cache.match(asset.url))?.headers.get("X-Fastreader-Voice-SHA256")));
  }, { files, cacheName: VOICE_CACHE_NAME })).toEqual(files.map(asset => asset.sha256));
});

test("an outdated runtime pauses with a connection message and resumes after reconnecting", async ({ page, context }) => {
  const row = await pausedPreparation(page);
  const files = await makeRuntimeOutdated(page);
  const workers = await page.evaluate(() => window.__runtimeWorkers);
  const requests = [];
  page.on("request", request => { if (/voice-runtime|huggingface/.test(request.url())) requests.push(request.url()); });
  await context.setOffline(true);
  await row.locator('[data-audio-queue-action="resume"]').click();
  await expect(row).toHaveAttribute("data-status", "error");
  await expect(row).toContainText("Connectez-vous à Internet");
  expect(await page.evaluate(() => window.__runtimeWorkers)).toBe(workers);
  expect(requests).toEqual([]);
  await context.setOffline(false);
  await row.locator('[data-audio-queue-action="resume"]').click();
  await expect.poll(() => page.evaluate(() => window.__runtimeWorkers)).toBe(workers + 1);
  await expect(row).toHaveAttribute("data-status", "preparing");
  expect(requests).toEqual(files.map(asset => asset.source));
});

test("resuming with a missing model requires choosing a voice without downloading anything", async ({ page }) => {
  const row = await pausedPreparation(page);
  await makeRuntimeOutdated(page);
  const model = assets.find(asset => asset.file.endsWith("model.onnx"));
  await page.evaluate(async ({ url, cacheName }) => { await (await caches.open(cacheName)).delete(url); }, { url: model.url, cacheName: VOICE_CACHE_NAME });
  const workers = await page.evaluate(() => window.__runtimeWorkers);
  const requests = [];
  page.on("request", request => { if (/voice-runtime|huggingface/.test(request.url())) requests.push(request.url()); });
  await row.locator('[data-audio-queue-action="resume"]').click();
  await expect(row).toHaveAttribute("data-status", "error");
  await expect(row).toContainText("Cette voix n’est plus disponible");
  expect(await page.evaluate(() => window.__runtimeWorkers)).toBe(workers);
  expect(requests).toEqual([]);
  await row.getByRole("button", { name: "Choisir une voix", exact: true }).click();
  await expect(page.locator(".voice-dialog")).toBeVisible();
  await expect(page.locator("[data-voice-prepare]")).toContainText("Télécharger et préparer");
  expect(requests).toEqual([]);
});
