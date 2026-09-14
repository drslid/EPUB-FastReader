import { test, expect } from "./fixtures.js";
import { makeEpub, importEpub } from "./helpers/fixtures.js";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

for (const language of ["fr", "de"]) {
  for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 320 }]) {
    test(`queue close stays reachable after targeting another book (${language}, ${viewport.width}×${viewport.height})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 4 });
        window.__queueHeaderGenerations = 0;
        window.Worker = class {
          constructor(url, options) {
            if (!String(url).includes("voice-runtime/")) return new NativeWorker(url, options);
            this.stopped = false;
            this.warming = Boolean(document.querySelector(".voice-dialog"));
          }
          postMessage(data) {
            // Hold the first conversion so the second book remains queued.
            if (data.type === "synthesize") {
              // Count the durable preparation, excluding the cancelled silent
              // first-sentence warm-up in the voice chooser.
              if (!this.warming) window.__queueHeaderGenerations++;
              return;
            }
            setTimeout(() => { if (!this.stopped) this.onmessage?.({ data: { id: data.id, result: {} } }); }, 5);
          }
          terminate() { this.stopped = true; }
        };
      });
      await page.goto(language === "fr" ? "/" : `/${language}.html`);
      await page.evaluate(async ({ assets, cacheName }) => {
        const cache = await caches.open(cacheName);
        for (const asset of assets) await cache.put(asset.url, new Response("verified fixture", { headers: {
          "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
        } }));
      }, { assets: assetsForVoice("ff_siwis", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });

      await importEpub(page, await makeEpub({ title: "Le premier livre reste dans la file", chapters: 1 }));
      await page.locator('[data-mode="audio"]').click();
      await page.locator("[data-voice-prepare]").click();
      await expect(page.locator(".audio-queue-job")).toHaveAttribute("data-status", "preparing");
      await expect.poll(() => page.evaluate(() => window.__queueHeaderGenerations)).toBe(1);
      await page.locator("[data-audio-queue-browse]").click();
      const title = "Un deuxième livre au très long titre pour retrouver sa préparation sans choisir de nouveau une voix";
      await importEpub(page, await makeEpub({ title, chapters: 2 }));
      await page.locator('[data-mode="audio"]').click();
      await page.locator("[data-voice-prepare]").click();
      await expect(page.locator(".audio-queue-job")).toHaveCount(2);
      await page.locator("[data-audio-queue-close]").click();
      await page.locator('[data-mode="audio"]').click();
      const dialog = page.locator(".audio-queue-dialog");
      const row = dialog.locator(".audio-queue-job.is-current-book");
      await expect(row.locator("h3")).toHaveText(title);
      await expect(row.locator(".audio-job-status")).toBeFocused();
      await expect(page.locator(".voice-dialog")).toHaveCount(0);
      await expect(dialog.locator(".audio-queue-job")).toHaveCount(2);

      const bounds = await dialog.evaluate(el => {
        const rect = node => {
          const { top, bottom, height } = node.getBoundingClientRect();
          return { top, bottom, height };
        };
        const current = el.querySelector(".is-current-book");
        return { dialog: rect(el), heading: rect(el.querySelector(".audio-queue-heading")),
          close: rect(el.querySelector("[data-audio-queue-close]")), title: rect(current.querySelector("h3")),
          status: rect(current.querySelector(".audio-job-status")), overflow: el.scrollWidth > el.clientWidth };
      });
      expect(bounds.heading.top).toBeGreaterThanOrEqual(bounds.dialog.top);
      expect(bounds.close.bottom).toBeLessThanOrEqual(bounds.dialog.bottom);
      expect(bounds.close.height).toBeGreaterThanOrEqual(44);
      expect(bounds.title.top).toBeGreaterThanOrEqual(bounds.heading.bottom - 1);
      expect(bounds.status.top).toBeGreaterThanOrEqual(bounds.heading.bottom - 1);
      expect(bounds.status.bottom).toBeLessThanOrEqual(bounds.dialog.bottom - 1);
      expect(bounds.dialog.height - bounds.heading.height).toBeGreaterThan(160);
      expect(bounds.overflow).toBe(false);

      // Closing must work even from the end of the queue, without scrolling up.
      await dialog.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const close = dialog.locator("[data-audio-queue-close]");
      const closeBounds = await close.boundingBox();
      expect(closeBounds.y).toBeGreaterThanOrEqual(bounds.dialog.top);
      expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(bounds.dialog.bottom);
      await close.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[data-mode="audio"]')).toBeFocused();
      expect(await page.evaluate(() => window.__queueHeaderGenerations)).toBe(1);
    });
  }
}
