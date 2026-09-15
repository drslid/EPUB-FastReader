import { test, expect } from "./fixtures.js";
import { importEpub, makeEpub } from "./helpers/fixtures.js";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

async function setup(page, { parallel = false, hold = false } = {}) {
  await page.addInitScript(({ parallel, hold }) => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => parallel ? 8 : 4 });
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 8 });
    const NativeWorker = window.Worker;
    window.__warmWorkers = [];
    window.__warmSpoken = [];
    window.__warmCompleted = [];
    window.__warmActive = 0;
    window.__warmMaximum = 0;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("voice-runtime/")) return new NativeWorker(url, options);
        this.stopped = false;
        window.__warmWorkers.push(this);
      }
      postMessage(data) {
        if (data.type === "synthesize") {
          window.__warmSpoken.push(data.text);
          window.__warmActive++;
          window.__warmMaximum = Math.max(window.__warmMaximum, window.__warmActive);
          if (hold) return;
        }
        setTimeout(() => {
          if (this.stopped) return;
          if (data.type === "synthesize") {
            window.__warmActive--;
            window.__warmCompleted.push(data.text);
          }
          this.onmessage?.({ data: { id: data.id, result: data.type === "load" ? {} : { wav: new ArrayBuffer(48), duration: 12 } } });
        }, data.type === "load" ? 10 : 80);
      }
      terminate() { this.stopped = true; }
    };
    window.Audio = class extends EventTarget {
      constructor() { super(); this.src = ""; this.paused = true; this.currentTime = 0; this.playCalls = 0; window.__warmAudio = this; }
      async play() { this.playCalls++; this.paused = false; }
      pause() { this.paused = true; }
      load() {}
      removeAttribute(name) { if (name === "src") this.src = ""; }
    };
  }, { parallel, hold });
  await page.goto("/");
  await importEpub(page, await makeEpub({ chapters: 1, paragraphs: [
    "Camille ouvre son livre et commence à lire. Le soleil entre dans la pièce. Une nouvelle histoire commence. Les personnages se rencontrent. Le récit continue tranquillement. La soirée approche enfin.",
  ] }));
  await page.evaluate(async ({ assets, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("verified fixture", { headers: {
      "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
    } }));
  }, { assets: assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
  await page.locator('[data-mode="audio"]').click();
  await expect(page.locator("[data-voice-start]")).toBeEnabled();
}

test("a ready voice prepares silently and Listen reuses the first sentence without restarting the worker", async ({ page }) => {
  await setup(page);
  await expect.poll(() => page.evaluate(() => window.__warmCompleted.length)).toBeGreaterThan(0);
  const first = await page.evaluate(() => window.__warmSpoken[0]);
  expect(await page.evaluate(() => window.__warmAudio.playCalls)).toBe(0);
  await expect(page.locator(".voice-current-passage")).toHaveCount(0);
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  expect(await page.evaluate(text => window.__warmSpoken.filter(value => value === text).length, first)).toBe(1);
  expect(await page.evaluate(() => window.__warmWorkers.length)).toBe(1);
  expect((await page.locator(".voice-current-passage").allTextContents()).join(" ")).toContain("Camille ouvre son livre");
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  expect(await page.evaluate(() => window.__warmAudio.paused)).toBe(true);
  expect(await page.evaluate(() => window.__warmWorkers.every(worker => worker.stopped))).toBe(true);
});

test("changing to a voice not yet downloaded cancels silent preparation and never starts sound", async ({ page }) => {
  await setup(page, { hold: true });
  await expect.poll(() => page.evaluate(() => window.__warmSpoken.length)).toBeGreaterThan(0);
  await page.locator("[data-voice-language]").selectOption("de");
  await expect(page.locator("[data-voice-start]")).toBeEnabled();
  await expect(page.locator("[data-voice-start]")).toContainText("Télécharger");
  await expect.poll(() => page.evaluate(() => window.__warmWorkers.every(worker => worker.stopped))).toBe(true);
  expect(await page.evaluate(() => window.__warmAudio.playCalls)).toBe(0);
  await page.locator("[data-voice-close]").click();
  await expect(page.locator("#rsvp")).toBeVisible();
});

test("upcoming sentences respect the device concurrency limit and preserve reading order", async ({ page }, testInfo) => {
  await setup(page, { parallel: true });
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await expect.poll(() => page.evaluate(() => window.__warmMaximum)).toBe(testInfo.project.name === "desktop-chromium" ? 2 : 1);
  const first = await page.locator(".voice-current-passage").allTextContents();
  expect(first.join(" ")).toContain("Camille ouvre son livre");
  await expect.poll(() => page.evaluate(() => window.__warmCompleted.length)).toBeGreaterThan(2);
  await page.evaluate(() => { window.__warmAudio.paused = true; window.__warmAudio.dispatchEvent(new Event("ended")); });
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  expect((await page.locator(".voice-current-passage").allTextContents()).join(" ")).toContain("Le soleil entre dans la pièce.");
});
