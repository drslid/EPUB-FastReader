import { test, expect } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { makeEpub, importEpub } from "./helpers/fixtures.js";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

for (const [language, viewport] of [["fr", { width: 320, height: 640 }], ["de", { width: 640, height: 320 }]]) {
  test(`listening explains slow loading and displays real prepared audio (${language})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      // Use one model in this UI test; compute-policy tests cover parallelism.
      Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 2 });
      const NativeWorker = window.Worker;
      window.__progressLoads = [];
      window.__progressSentences = [];
      window.__progressLoadReleased = false;
      window.__progressPlayCount = 0;
      window.__releaseProgressLoads = () => {
        window.__progressLoadReleased = true;
        for (const complete of window.__progressLoads.splice(0)) complete();
      };
      window.__completeProgressSentence = () => window.__progressSentences.shift()?.();
      window.Worker = class {
        constructor(url, options) {
          if (!String(url).includes("voice-runtime/")) return new NativeWorker(url, options);
          this.stopped = false;
        }
        postMessage(data) {
          const complete = () => {
            if (this.stopped) return;
            this.onmessage?.({ data: { id: data.id, result: data.type === "load" ? {} : { wav: new ArrayBuffer(100), duration: 10 } } });
          };
          if (data.type === "load") {
            if (window.__progressLoadReleased) setTimeout(complete, 0);
            else window.__progressLoads.push(complete);
          } else {
            window.__progressSentences.push(complete);
            setTimeout(() => {
              if (!this.stopped) this.onmessage?.({ data: { type: "progress", id: data.id, progress: { stage: "phonemizing" } } });
            }, 0);
          }
        }
        terminate() { this.stopped = true; }
      };
      window.Audio = class extends EventTarget {
        constructor() { super(); this.src = ""; this.paused = true; }
        async play() { this.paused = false; window.__progressPlayCount++; }
        pause() { this.paused = true; }
        removeAttribute() { this.src = ""; }
        load() {}
      };
    });
    await page.goto(language === "fr" ? "/" : `/${language}.html`);
    await page.evaluate(async ({ assets, cacheName }) => {
      const cache = await caches.open(cacheName);
      for (const asset of assets) await cache.put(asset.url, new Response("verified fixture", { headers: {
        "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
      } }));
    }, { assets: assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
    await importEpub(page, await makeEpub({ title: "Une écoute avec un suivi visible", chapters: 1,
      paragraphs: Array.from({ length: 10 }, () => "Camille ouvre un livre. Une nouvelle aventure commence. Le récit continue dans la forêt.") }));
    await page.locator('[data-mode="audio"]').click();
    await expect(page.locator("[data-voice-start]")).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__progressLoads.length)).toBe(1);
    expect(await page.evaluate(() => window.__progressPlayCount)).toBe(0);
    await page.locator("[data-voice-start]").click();
    const controls = page.locator("#voice-controls");
    const progress = controls.locator("[data-voice-preparation] progress");
    await expect(controls).toHaveAttribute("data-status", "loading");
    await expect(progress).toBeVisible();
    await expect(progress).not.toHaveAttribute("value", /.+/);
    await expect(controls.locator(".voice-player-status")).toContainText(language === "fr" ? "Chargement de la voix" : "Stimme wird geladen");
    await expect(controls.locator(".voice-player-status")).toContainText(language === "fr" ? "automatiquement" : "automatisch");
    const pause = controls.locator('[data-voice-action="toggle"]');
    await expect(pause).toBeEnabled();
    expect((await pause.boundingBox()).height).toBeGreaterThanOrEqual(44);
    // The click may play a silent sample to unlock mobile audio.
    const authorizedPlays = await page.evaluate(() => window.__progressPlayCount);

    await page.evaluate(() => window.__releaseProgressLoads());
    await expect(controls).toHaveAttribute("data-status", "preparing");
    await expect(controls.locator(".voice-player-status")).toContainText(language === "fr" ? "Analyse du texte" : "Text wird analysiert");
    await expect(progress).toHaveAttribute("value", "0");
    await expect.poll(() => page.evaluate(() => window.__progressSentences.length)).toBeGreaterThan(0);
    await page.evaluate(() => window.__completeProgressSentence());
    await expect(controls).toHaveAttribute("data-status", "playing");
    await expect(progress).toHaveAttribute("value", "1");
    await expect(controls.locator("[data-voice-buffered-seconds]")).toContainText("10");
    expect(await page.evaluate(() => window.__progressPlayCount)).toBe(authorizedPlays + 1);
    await expect(controls.locator("[data-voice-preparation]")).toHaveClass(/is-playing/);
    await expect(controls.locator("[data-voice-preparation]")).toHaveAttribute("aria-live", "off");
    expect((await new AxeBuilder({ page }).include("#voice-controls").analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.locator("#chapter-scroll").evaluate(el => el.clientHeight)).toBeGreaterThan(40);
    await pause.click();
    await expect(controls).toHaveAttribute("data-status", "paused");
    await expect(pause).toBeFocused();
  });
}
