import { expect, test } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

async function openBook(page, language = "fr") {
  await page.goto("/");
  await importEpub(page, await makeEpub({ language, paragraphs: Array.from({ length: 12 }, (_, i) => `Passage ${i + 1}. Voici une histoire à écouter et à retrouver sur cet appareil. Elle continue avec de nouveaux personnages.`) }));
  await expect(page.locator("#rsvp")).toBeVisible();
}

// Deterministic UI fixtures only: synthesis and already-verified cache entries
// are mocked. The real model/browser/offline checks are documented separately.
async function readyVoice(page, voiceId = "piper-fr_FR-siwis-medium") {
  await page.evaluate(async ({ assets, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("test fixture", { headers: {
      "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
    } }));
  }, { assets: assetsForVoice(voiceId, "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
}

async function mockPlayback(page) {
  await page.addInitScript(() => {
    const Worker = window.Worker;
    window.__spoken = [];
    window.Worker = class extends EventTarget {
      constructor(url, options) {
        super();
        if (!String(url).includes("voice-runtime/")) return new Worker(url, options);
        this.stopped = false;
      }
      postMessage(data) {
        if (data.type === "synthesize") window.__spoken.push(data.text);
        setTimeout(() => {
          if (!this.stopped) this.onmessage?.({ data: { id: data.id, result: data.type === "load" ? {} : { wav: new ArrayBuffer(48), duration: 10 } } });
        }, window.__voiceDelay || 15);
      }
      terminate() { this.stopped = true; }
    };
    window.Audio = class extends EventTarget {
      constructor() { super(); this.src = ""; this.paused = true; window.__voiceAudio = this; }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    };
  });
}

test("voice is optional, language follows the book, and downloading needs a connection", async ({ page, context }) => {
  const requests = [];
  page.on("request", request => { if (/voice-runtime|huggingface/.test(request.url())) requests.push(request.url()); });
  await openBook(page, "es");
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-voice-language]")).toHaveValue("es");
  await expect(dialog.locator("[data-voice-start]")).toBeEnabled();
  await expect(dialog).toContainText("Davefx");
  await expect(dialog.locator("[data-voice-size]")).toContainText("Premier téléchargement");
  expect(requests).toEqual([]);
  await context.setOffline(true);
  await expect(dialog.locator("[data-voice-start]")).toBeDisabled();
  await expect(dialog.locator("[data-voice-offline]")).toBeVisible();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(requests).toEqual([]);
});

test("German is available and the voice chooser fits a small phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openBook(page, "de");
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await expect(page.locator("[data-voice-language]")).toHaveValue("de");
  await expect(page.locator("[data-voice-list]")).toContainText("Thorsten");
  await expect(page.locator("[data-voice-start]")).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("friendly-voice-picker.png"), fullPage: true });
  await page.locator("[data-voice-language]").selectOption("fr");
  await expect(page.locator("[data-voice-start]")).toBeEnabled();
  expect(await page.locator("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".voice-dialog").analyze()).violations).toEqual([]);
});

test("failed downloads can be retried or cancelled without leaving the reader", async ({ page }) => {
  await openBook(page);
  await page.route("**/voice-runtime/**", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("[data-voice-status]")).toContainText("échoué");
  await expect(page.locator("[data-voice-start]")).toContainText("Réessayer");
  await page.unroute("**/voice-runtime/**");
  await page.route("**/voice-runtime/**", async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.abort().catch(() => {});
  });
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("[data-voice-progress]")).toBeVisible();
  await page.locator("[data-voice-cancel]").click();
  await expect(page.locator("[data-voice-start]")).toContainText("Reprendre le téléchargement");
  await page.locator("[data-voice-close]").click();
  await expect(page.locator("#rsvp")).toBeVisible();
});

test("downloaded voice starts offline, follows passages, persists position and stops when leaving", async ({ page, context }) => {
  await mockPlayback(page);
  await openBook(page);
  await readyVoice(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await expect(page.locator("[data-voice-start]")).toContainText("Lancer l’écoute");
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Pause");
  await expect(page.locator(".voice-current-passage").first()).toBeVisible();
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  await expect(page.locator(".voice-current-passage").first()).toBeVisible();
  await page.locator("[data-voice-action=toggle]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Pause");
  await page.locator("[data-voice-action=next]").click();
  await page.locator("[data-voice-action=toggle]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Reprendre");
  await page.locator("[data-voice-rate]").fill("1.25");
  await expect(page.locator("[data-voice-rate-value]")).toHaveText("1,25×");
  await expect.poll(async () => (await storedRows(page, "positions"))[0]?.locator?.textOffset || 0).toBeGreaterThan(0);
  const offset = (await storedRows(page, "positions"))[0].locator.textOffset;
  await page.locator("#chapter-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect((await storedRows(page, "positions"))[0].locator.textOffset).toBe(offset);
  await page.getByRole("button", { name: "Classique", exact: true }).click();
  expect(await page.evaluate(() => window.__voiceAudio.paused)).toBe(true);
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Pause");
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  expect(await page.evaluate(() => window.__voiceAudio.paused)).toBe(true);
  await expect(page.locator(".voice-dialog")).toHaveCount(0);
});

test("preparation can be paused and removing a downloaded voice restores online requirements", async ({ page }) => {
  await mockPlayback(page);
  await openBook(page);
  await readyVoice(page);
  await page.evaluate(() => { window.__voiceDelay = 800; });
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Pause");
  await page.locator("[data-voice-action=toggle]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Reprendre");
  expect(await page.evaluate(() => window.__voiceAudio.paused)).toBe(true);
  await page.setViewportSize({ width: 812, height: 375 });
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector(".reader-control-panel").getBoundingClientRect();
    const text = document.querySelector(".reader-layout").getBoundingClientRect();
    return panel.left >= text.right - 1 && panel.bottom <= innerHeight && text.height > 100;
  })).toBe(true);
  await page.locator("[data-voice-action=choose]").click();
  await expect(page.locator(".voice-dialog")).toBeVisible();
  await page.locator("[data-voice-storage]").click();
  await expect(page.locator(".voice-dialog")).toHaveCount(0);
  await expect(page.locator(".audio-storage-dialog")).toHaveAttribute("aria-busy", "false");
  await page.locator('[data-storage-voice="piper-fr_FR-siwis-medium"] [data-storage-action="voice"]').click();
  await expect(page.locator("[data-storage-confirmation]")).toContainText("audios déjà préparés restent disponibles");
  await page.locator('[data-storage-action="confirm"]').click();
  await expect(page.locator("[data-storage-notice]")).toHaveText("Espace libéré.");
  await expect(page.locator('[data-storage-voice="piper-fr_FR-siwis-medium"]')).toHaveCount(0);
  await page.locator('[data-storage-action="close"]').click();
  await page.locator('[data-mode="audio"]').click();
  await expect(page.locator("[data-voice-start]")).toContainText("Télécharger et écouter");
  await expect(page.locator("[data-voice-remove]")).toHaveCount(0);
});

test("listening continues to the next chapter and marks the finished book", async ({ page }) => {
  await mockPlayback(page);
  await page.goto("/");
  await importEpub(page, await makeEpub({ paragraphs: ["Une courte phrase."], chapters: 2 }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await readyVoice(page);
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-start]").click();
  for (let i = 0; i < 8; i++) {
    // Pause is also offered while loading. Dispatch a media-ended event only
    // after actual playback starts, or stop once the last chapter is finished.
    await expect.poll(() => page.evaluate(() => location.hash === "#library" || Boolean(
      document.querySelector("#voice-controls")?.dataset.status === "playing"
      && window.__voiceAudio.src && !window.__voiceAudio.paused,
    ))).toBe(true);
    if (new URL(page.url()).hash === "#library") break;
    const oldSource = await page.evaluate(() => {
      const audio = window.__voiceAudio, source = audio.src;
      audio.dispatchEvent(new Event("ended"));
      return source;
    });
    expect(oldSource).toMatch(/^blob:/);
    await expect.poll(() => page.evaluate(source => location.hash === "#library" || window.__voiceAudio.src !== source, oldSource)).toBe(true);
  }
  await expect(page).toHaveURL(/#library$/);
  await expect.poll(async () => (await storedRows(page, "positions"))[0]?.completed).toBe(true);
  expect(await page.evaluate(() => window.__voiceAudio.paused)).toBe(true);
});

test("immediate listening sends and highlights an entire long sentence instead of 180-character pieces", async ({ page }) => {
  const sentence = "Camille traverse lentement le jardin pour retrouver les amis qui l’attendent près de la grande maison, puis elle leur raconte tout ce qu’elle a découvert au cours de son voyage avant de leur montrer les photographies prises dans les villages où elle s’est arrêtée pendant plusieurs semaines.";
  await mockPlayback(page);
  await page.goto("/");
  await importEpub(page, await makeEpub({ title: "Une phrase entière", chapters: 1, paragraphs: [sentence, "La prochaine phrase attend son tour."] }));
  await readyVoice(page);
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(2);
  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken[0]).toContain(sentence);
  expect(spoken[1]).toBe("La prochaine phrase attend son tour.");
  expect((await page.locator(".voice-current-passage").allTextContents()).join(" ")).toContain(sentence);
});
