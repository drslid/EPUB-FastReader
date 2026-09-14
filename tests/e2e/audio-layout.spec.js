import { test, expect } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { makeEpub, importEpub } from "./helpers/fixtures.js";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

test("partial listening keeps text and controls separate in a short landscape and survives rotation", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 4 });
    window.__preparedPassages = 0;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("voice-runtime/")) return new NativeWorker(url, options);
        this.stopped = false;
        this.warming = Boolean(document.querySelector(".voice-dialog"));
      }
      postMessage(data) {
        const generate = data.type === "synthesize";
        // Silent dialogue warm-up is cancelled on Prepare and does not count
        // as persisted audio. Leave it pending until the worker is terminated.
        if (generate && this.warming) return;
        // Leave the second passage pending to exercise the real buffering UI.
        if (generate && ++window.__preparedPassages > 1) return;
        setTimeout(() => {
          if (!this.stopped) this.onmessage?.({ data: { id: data.id, result: generate ? { wav: new ArrayBuffer(100), duration: 3 } : {} } });
        }, 10);
      }
      terminate() { this.stopped = true; }
    };
    window.Audio = class extends EventTarget {
      constructor() { super(); this.src = ""; this.paused = true; window.__layoutAudio = this; }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    };
  });
  await page.goto("/de.html");
  await page.evaluate(async ({ assets, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("verified fixture", { headers: {
      "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
    } }));
  }, { assets: assetsForVoice("ff_siwis", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
  await importEpub(page, await makeEpub({ title: "Un livre à écouter en paysage", chapters: 1,
    paragraphs: Array.from({ length: 8 }, () => "Camille suit le récit. Chaque passage raconte une nouvelle aventure.") }));
  await page.locator('[data-mode="audio"]').click();
  await page.locator("[data-voice-prepare]").click();
  await page.locator('[data-audio-queue-action="listen"]').click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await page.evaluate(() => { window.__layoutAudio.paused = true; window.__layoutAudio.dispatchEvent(new Event("ended")); });
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "buffering");

  const landscape = await page.evaluate(() => {
    const text = document.querySelector(".reader-layout").getBoundingClientRect();
    const footer = document.querySelector(".reader-footer").getBoundingClientRect();
    const chapter = document.querySelector("#chapter-scroll");
    return { textRight: text.right, footerLeft: footer.left, footerBottom: footer.bottom,
      chapterHeight: chapter.clientHeight, chapterScrolls: chapter.scrollHeight > chapter.clientHeight,
      footerScroll: getComputedStyle(document.querySelector(".reader-footer")).overflowY,
      footerDisplay: getComputedStyle(document.querySelector(".reader-footer")).display,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(landscape.footerLeft).toBeGreaterThanOrEqual(landscape.textRight - 1);
  expect(landscape.footerBottom).toBeLessThanOrEqual(320);
  expect(landscape.chapterHeight).toBeGreaterThan(48);
  expect(landscape.chapterScrolls).toBe(true);
  expect(landscape.footerScroll).toBe("auto");
  expect(landscape.footerDisplay).toBe("block");
  expect(landscape.overflow).toBe(false);
  expect((await new AxeBuilder({ page }).include("#voice-controls").analyze()).violations).toEqual([]);

  const queue = page.locator('[data-voice-action="queue"]');
  await queue.focus();
  expect((await queue.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await queue.boundingBox()).width).toBeGreaterThan(150);
  await queue.click();
  await expect(page.locator(".audio-queue-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(queue).toBeFocused();

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "buffering");
  const portrait = await page.evaluate(() => {
    const text = document.querySelector(".reader-layout").getBoundingClientRect();
    const footer = document.querySelector(".reader-footer").getBoundingClientRect();
    return { textBottom: text.bottom, footerTop: footer.top, footerBottom: footer.bottom,
      width: text.width, audioPaused: window.__layoutAudio.paused,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(portrait.footerTop).toBeGreaterThanOrEqual(portrait.textBottom - 1);
  expect(portrait.footerBottom).toBeLessThanOrEqual(640);
  expect(portrait.width).toBe(320);
  expect(portrait.audioPaused).toBe(true);
  expect(portrait.overflow).toBe(false);
  expect(await page.evaluate(() => window.__preparedPassages)).toBe(2);
  await page.locator('[data-mode="classic"]').click();
  expect(await page.locator(".reader-shell").evaluate(el => getComputedStyle(el).display)).toBe("flex");
});
