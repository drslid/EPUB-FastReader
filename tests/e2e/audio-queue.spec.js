import { test, expect } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { makeEpub, importEpub } from "./helpers/fixtures.js";
import { assetsForVoice, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const jobs = await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open("fastreader-audio");
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("jobs")) { db.close(); resolve([]); return; }
      const rows = db.transaction("jobs").objectStore("jobs").getAll();
      rows.onsuccess = () => { db.close(); resolve(rows.result.map(({ status, error, completedSegments }) => ({ status, error, completedSegments }))); };
    };
  }));
  await info.attach("audio-job-diagnostics", { body: JSON.stringify(jobs), contentType: "application/json" });
});

async function setup(page) {
  await page.addInitScript(() => {
    const Worker = window.Worker;
    // These scenarios exercise the portable, single-worker budget. Desktop
    // parallel warm-up/reuse is covered by audio-warmup.spec.js.
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 4 });
    window.__generation = { active: 0, maximum: 0, calls: 0, engines: 0, warmCalls: 0, warmEngines: 0 };
    window.__delay = 160;
    window.__pending = [];
    window.__finishOne = () => {
      let complete;
      while ((complete = window.__pending.shift())) if (complete()) return;
    };
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("voice-runtime/")) return new Worker(url, options);
        // The installed voice now warms silently before Prepare is clicked.
        // Keep its cancelled work separate from durable queue work, while the
        // global active/maximum counters still include every worker.
        this.warming = Boolean(document.querySelector(".voice-dialog"));
        window.__generation[this.warming ? "warmEngines" : "engines"]++;
        this.stopped = false; this.busy = false;
      }
      postMessage(data) {
        const work = data.type === "synthesize";
        if (work) {
          this.busy = true;
          window.__generation[this.warming ? "warmCalls" : "calls"]++;
          window.__generation.maximum = Math.max(window.__generation.maximum, ++window.__generation.active);
        }
        const complete = () => {
          if (this.stopped) return false;
          if (work) { this.busy = false; window.__generation.active--; }
          const unreadable = work && window.__unreadablePassage && data.text.includes(window.__unreadablePassage);
          this.onmessage?.({ data: unreadable
            ? { id: data.id, error: { code: "VOICE_PHONEME_UNSUPPORTED", message: "Fixture: unsupported phonemes" } }
            : { id: data.id, result: work ? { wav: new ArrayBuffer(100), duration: 3 } : {} } });
          return true;
        };
        if (work && window.__manualGeneration) {
          this.pendingCompletion = complete;
          window.__pending.push(complete);
        }
        else setTimeout(complete, work ? window.__delay : 5);
      }
      terminate() {
        this.stopped = true;
        // A cancelled warm-up must not look like live queue work to tests
        // waiting for a manually completable generation request.
        window.__pending = window.__pending.filter(complete => complete !== this.pendingCompletion);
        if (this.busy) { this.busy = false; window.__generation.active--; }
      }
    };
    window.Audio = class extends EventTarget {
      constructor() { super(); this.src = ""; this.paused = true; window.__audio = this; }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    };
  });
  await page.goto("/");
  await page.evaluate(async ({ assets, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const asset of assets) await cache.put(asset.url, new Response("verified fixture", { headers: {
      "Content-Length": String(asset.bytes), "X-Fastreader-Voice-SHA256": asset.sha256,
    } }));
  }, { assets: assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/"), cacheName: VOICE_CACHE_NAME });
}

async function addBook(page, title, paragraphs = 4) {
  await importEpub(page, await makeEpub({ title, chapters: 1, paragraphs: Array.from({ length: paragraphs }, (_, i) => `Camille lit le passage ${i + 1}. Cette histoire se prépare sur son appareil.`) }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-prepare]").click();
  await expect(page.locator(".audio-queue-dialog")).toBeVisible();
  return page.locator(".audio-queue-job").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test("Listen reopens the existing preparation after navigation and reload without starting a duplicate", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__manualGeneration = true; });
  const row = await addBook(page, "Retrouver ma préparation", 5);
  await expect(row).toHaveAttribute("data-status", "preparing");
  const id = await row.getAttribute("data-audio-job");
  await expect.poll(() => page.evaluate(() => window.__generation.calls)).toBe(1);
  await page.locator("[data-audio-queue-close]").click();
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await expect(page.locator(".audio-queue-dialog")).toBeVisible();
  await expect(page.locator(".voice-dialog")).toHaveCount(0);
  await expect(row).toHaveClass(/is-current-book/);
  await expect(row).toHaveAttribute("data-audio-job", id);
  expect(await page.evaluate(() => window.__generation.calls)).toBe(1);
  await page.locator("[data-audio-queue-browse]").click();
  await page.getByRole("button", { name: "Préparer l’audio de Retrouver ma préparation", exact: true }).click();
  await expect(row).toHaveAttribute("data-audio-job", id);
  await expect(page.locator(".voice-dialog")).toHaveCount(0);
  await row.locator('[data-audio-queue-action="choose-voice"]').click();
  await expect(page.locator(".voice-dialog")).toBeVisible();
  expect(await page.evaluate(() => window.__generation.calls)).toBe(1);
  await page.locator("[data-voice-close]").click();
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await expect(row).toHaveAttribute("data-status", "paused");
  await expect(row).toHaveAttribute("data-audio-job", id);
  await expect(page.locator(".voice-dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.__generation.calls)).toBe(0);
});

test("an unreadable sentence is skipped, reported after reload, and never interrupts prepared listening", async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => { window.__unreadablePassage = "phrase incompatible"; });
  await importEpub(page, await makeEpub({ title: "Continuer malgré un passage difficile", chapters: 1, paragraphs: [
    "Cette première phrase se lit normalement.",
    "Cette phrase incompatible ne peut pas être prononcée.",
    "La lecture continue avec cette phrase complète.",
    "Le livre peut être écouté jusqu’au bout.",
  ] }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-prepare]").click();
  const row = page.locator(".audio-queue-job");
  await expect(row).toHaveAttribute("data-status", "ready", { timeout: 20000 });
  await expect(row.locator(".audio-job-skipped")).toHaveText("1 passage n’a pas pu être lu.");
  await expect(row.locator(".audio-job-error")).toHaveCount(0);
  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("fastreader-audio", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(["jobs", "segments"]);
      const jobs = tx.objectStore("jobs").getAll(), segments = tx.objectStore("segments").getAllKeys();
      tx.oncomplete = () => {
        db.close();
        const job = jobs.result[0];
        resolve({ skipped: job.skippedSegments, passages: job.chapters[0].passages.map(({ segmentId, skipped }) => ({ segmentId, skipped: Boolean(skipped) })), segmentKeys: segments.result });
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  expect(saved.skipped).toBe(1);
  const audible = saved.passages.filter(passage => !passage.skipped);
  const skipped = saved.passages.find(passage => passage.skipped);
  expect(audible.length).toBeGreaterThanOrEqual(3);
  expect(saved.segmentKeys).toHaveLength(audible.length);
  expect(saved.segmentKeys.some(key => key.includes(skipped.segmentId))).toBe(false);
  expect(await page.locator(".audio-queue-dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".audio-queue-dialog").analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("skipped-audio-passage.png") });
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await expect(row.locator(".audio-job-skipped")).toHaveText("1 passage n’a pas pu être lu.");
  await row.locator('[data-audio-queue-action="listen"]').click();
  for (let at = 0; at < audible.length; at++) {
    await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
    await expect(page.locator("[data-voice-skipped]")).toHaveText("1 passage n’a pas pu être lu.");
    const highlighted = await page.locator(".voice-current-passage").allTextContents();
    expect(highlighted.join(" ")).not.toContain("phrase incompatible");
    const previous = await page.evaluate(() => window.__audio.src);
    await page.evaluate(() => { window.__audio.paused = true; window.__audio.dispatchEvent(new Event("ended")); });
    if (at + 1 < audible.length) await expect.poll(() => page.evaluate(() => window.__audio.src)).not.toBe(previous);
  }
  await expect(page.getByRole("heading", { name: "Ma bibliothèque", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__generation.calls)).toBe(0);
});

test("two books prepare one at a time, progress is visible, and prepared listening needs no synthesis", async ({ page, context }) => {
  await setup(page);
  await page.evaluate(() => { window.__delay = 220; });
  const first = await addBook(page, "Première histoire", 8);
  await expect(first).toHaveAttribute("data-status", "preparing");
  await expect.poll(() => first.locator("progress").getAttribute("value")).not.toBe("0");
  await page.locator("[data-audio-queue-browse]").click();
  await expect(page.getByRole("heading", { name: "Ma bibliothèque", exact: true })).toBeVisible();
  const second = await addBook(page, "Deuxième histoire", 2);
  await expect(second).toHaveAttribute("data-status", "queued");
  await expect(first).toHaveAttribute("data-status", "ready", { timeout: 20000 });
  await expect(second).toHaveAttribute("data-status", "ready", { timeout: 20000 });
  expect(await page.evaluate(() => window.__generation.maximum)).toBe(1);
  const calls = await page.evaluate(() => window.__generation.calls);
  await context.setOffline(true);
  await second.locator('[data-audio-queue-action="listen"]').click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Pause");
  await expect(page.locator(".voice-current-passage").first()).toBeVisible();
  await page.locator("[data-voice-action=next]").click();
  await expect.poll(() => page.evaluate(() => window.__audio.paused)).toBe(false);
  expect(await page.evaluate(() => window.__generation.calls)).toBe(calls);
});

test("library preparation adds another book without stopping the first, and each queue item can be cancelled", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__manualGeneration = true; });
  await importEpub(page, await makeEpub({ title: "À écouter ensuite", chapters: 1 }));
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  const first = await addBook(page, "Une histoire en cours", 4);
  await expect(first).toHaveAttribute("data-status", "preparing");
  await expect.poll(() => page.evaluate(() => window.__generation.calls)).toBe(1);
  await page.locator("[data-audio-queue-browse]").click();
  await expect(page.getByRole("button", { name: "Voir la file audio" })).toBeVisible();
  await page.getByRole("button", { name: "Préparer l’audio de À écouter ensuite", exact: true }).click();
  await page.locator("[data-voice-prepare]").click();
  const second = page.locator(".audio-queue-job").filter({ has: page.getByRole("heading", { name: "À écouter ensuite", exact: true }) });
  await expect(second).toHaveAttribute("data-status", "queued");
  await expect(first).toHaveAttribute("data-status", "preparing");
  expect(await page.evaluate(() => window.__generation.calls)).toBe(1);
  await second.locator('[data-audio-queue-action="cancel"]').click();
  await expect(second).toHaveCount(0);
  await expect(first).toHaveAttribute("data-status", "preparing");
  await page.evaluate(() => window.__finishOne());
  await expect.poll(() => first.locator("progress").getAttribute("value")).not.toBe("0");
  await first.locator('[data-audio-queue-action="cancel"]').click();
  await expect(first).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__generation.active)).toBe(0);
  await page.locator("[data-audio-queue-browse]").click();
  await expect(page.getByRole("button", { name: "Lire À écouter ensuite", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lire Une histoire en cours", exact: true })).toBeVisible();
});

test("partial listening waits for the next passage, resumes automatically, and respects pause and cancellation", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__manualGeneration = true; });
  const row = await addBook(page, "Écouter pendant la préparation", 5);
  await expect.poll(() => page.evaluate(() => window.__generation.calls)).toBe(1);
  await page.evaluate(() => window.__finishOne());
  await expect(row.locator('[data-audio-queue-action="listen"]')).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "preparing");
  await row.locator('[data-audio-queue-action="listen"]').click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  expect(await page.evaluate(() => window.__generation.engines)).toBe(1);
  await page.evaluate(() => { window.__audio.paused = true; window.__audio.dispatchEvent(new Event("ended")); });
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "buffering");
  await expect(page.locator("#voice-controls")).toContainText("suite");
  await page.evaluate(() => window.__finishOne());
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await expect(page.locator(".voice-current-passage").first()).toBeVisible();
  await page.evaluate(() => { window.__audio.paused = true; window.__audio.dispatchEvent(new Event("ended")); });
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "buffering");
  await page.locator("[data-voice-action=toggle]").click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "paused");
  await page.evaluate(() => window.__finishOne());
  await expect.poll(() => page.evaluate(() => window.__generation.calls)).toBe(4);
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "paused");
  expect(await page.evaluate(() => window.__audio.paused)).toBe(true);
  await page.locator("[data-voice-action=toggle]").click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await page.locator(".reader-commandbar [data-action=audio-queue]").click();
  await expect(row).toHaveAttribute("data-status", "preparing");
  await row.locator('[data-audio-queue-action="cancel"]').click();
  await expect(row).toHaveCount(0);
  await page.locator("[data-audio-queue-close]").click();
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "error");
  expect(await page.evaluate(() => window.__audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.__generation.maximum)).toBe(1);
  expect(await page.evaluate(() => window.__generation.engines)).toBe(1);
});

test("partial listening waits across chapters and new audio cannot restart playback after leaving the reader", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__manualGeneration = true; });
  await importEpub(page, await makeEpub({ title: "La suite au prochain chapitre", chapters: 2, paragraphs: ["Une histoire courte. Encore une phrase à écouter."] }));
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-prepare]").click();
  const row = page.locator(".audio-queue-job");
  for (let i = 0; i < 8; i++) {
    if ((await row.innerText()).includes("1 sur 2 chapitres préparés")) break;
    await expect.poll(() => page.evaluate(() => window.__pending.length)).toBeGreaterThan(0);
    const previous = await row.locator("progress").getAttribute("value");
    await page.evaluate(() => window.__finishOne());
    await expect.poll(() => row.locator("progress").getAttribute("value")).not.toBe(previous);
  }
  await expect(row).toContainText("1 sur 2 chapitres préparés");
  await row.locator('[data-audio-queue-action="listen"]').click();
  for (let i = 0; i < 8; i++) {
    if ((await page.locator("#chapter-label").innerText()).includes("2 SUR 2")) break;
    await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
    const previous = await page.evaluate(() => window.__audio.src);
    await page.evaluate(() => { window.__audio.paused = true; window.__audio.dispatchEvent(new Event("ended")); });
    await expect.poll(() => page.evaluate(old => document.querySelector("#chapter-label")?.textContent.includes("2 SUR 2") || window.__audio.src !== old, previous)).toBe(true);
  }
  await expect(page.locator("#chapter-label")).toContainText("2 SUR 2");
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "buffering");
  await page.evaluate(() => window.__finishOne());
  await expect(page.locator("#voice-controls")).toHaveAttribute("data-status", "playing");
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(page.getByRole("heading", { name: "Ma bibliothèque", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voir la file audio" }).click();
  for (let i = 0; i < 8; i++) {
    if (await row.getAttribute("data-status") === "ready") break;
    await expect.poll(() => page.evaluate(() => window.__pending.length)).toBeGreaterThan(0);
    const previous = await row.locator("progress").getAttribute("value");
    await page.evaluate(() => window.__finishOne());
    await expect.poll(() => row.locator("progress").getAttribute("value")).not.toBe(previous);
    expect(await page.evaluate(() => window.__audio.paused)).toBe(true);
  }
  await expect(row).toContainText("2 sur 2 chapitres préparés");
  expect(await page.evaluate(() => window.__audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.__generation.maximum)).toBe(1);
});

test("a progress update during a held pointer keeps the cancel control and completes the click", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__manualGeneration = true; });
  const row = await addBook(page, "Une préparation à annuler sans perdre le clic", 5);
  await expect.poll(() => page.evaluate(() => window.__generation.calls)).toBe(1);
  await page.evaluate(() => window.__finishOne());
  await expect.poll(() => page.evaluate(() => window.__generation.calls)).toBe(2);
  const progress = await row.locator("progress").getAttribute("value");
  const cancel = row.locator('[data-audio-queue-action="cancel"]');
  await cancel.scrollIntoViewIfNeeded();
  const original = await cancel.elementHandle();
  const label = await cancel.locator("span").last().elementHandle();
  const box = await cancel.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.evaluate(() => window.__finishOne());
    await expect.poll(() => row.locator("progress").getAttribute("value")).not.toBe(progress);
    expect(await original.evaluate(element => element.isConnected)).toBe(true);
    expect(await label.evaluate(element => element.isConnected)).toBe(true);
  } finally {
    await page.mouse.up();
  }
  await expect(row).toHaveCount(0);
});

test("partial audio survives reload, requires an explicit resume, and can be cancelled without deleting the book", async ({ page, browserName }) => {
  await setup(page);
  await page.evaluate(() => { window.__delay = 240; });
  const row = await addBook(page, "Une préparation à reprendre", 10);
  await expect.poll(() => row.locator("progress").getAttribute("value")).not.toBe("0");
  await row.locator('[data-audio-queue-action="pause"]').click();
  await expect(row).toHaveAttribute("data-status", "paused");
  const progress = await row.locator("progress").getAttribute("value");
  let cacheDocument;
  if (browserName === "webkit") {
    // Playwright's temporary WebKit context drops CacheStorage when its last
    // document for an origin is replaced, even for valid binary responses.
    // Keep the original cache alive while testing audio/queue persistence.
    // A persistent WebKit profile was checked separately; no entries are
    // reseeded after reload and the production readiness gate stays intact.
    cacheDocument = await page.context().newPage();
    const fixtureUrl = new URL("/voice-cache-fixture.html", page.url()).href;
    await cacheDocument.route(fixtureUrl, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Voice cache fixture</title>" }));
    await cacheDocument.goto(fixtureUrl);
    await cacheDocument.evaluate(async name => { window.retainedVoiceCache = await caches.open(name); }, VOICE_CACHE_NAME);
    await page.bringToFront();
  }
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  const installedAssets = assetsForVoice("piper-fr_FR-siwis-medium", "http://127.0.0.1:4173/");
  expect(await page.evaluate(async ({ assets, cacheName }) => {
    const cache = await caches.open(cacheName);
    return Promise.all(assets.map(async asset => (await cache.match(asset.url))?.headers.get("X-Fastreader-Voice-SHA256")));
  }, { assets: installedAssets, cacheName: VOICE_CACHE_NAME })).toEqual(installedAssets.map(asset => asset.sha256));
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await page.locator(".topbar [data-action=audio-queue]").click();
  await expect(row).toHaveAttribute("data-status", "paused");
  await expect(row.locator("progress")).toHaveAttribute("value", progress);
  expect(await page.evaluate(() => window.__generation.calls)).toBe(0);
  await row.locator('[data-audio-queue-action="resume"]').click();
  await expect.poll(async () => Number(await row.locator("progress").getAttribute("value"))).not.toBe(Number(progress));
  await row.locator('[data-audio-queue-action="cancel"]').click();
  await expect(row).toHaveCount(0);
  await page.locator("[data-audio-queue-close]").click();
  await expect(page.getByRole("button", { name: "Lire Une préparation à reprendre", exact: true })).toBeVisible();
  await cacheDocument?.close();
});

test("queue and voice choice remain accessible on a small phone", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => { window.__delay = 400; });
  const row = await addBook(page, "Un long titre pour écouter tranquillement un livre préparé sur ce petit téléphone", 3);
  await expect(row).toBeVisible();
  expect(await page.locator(".audio-queue-dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".audio-queue-dialog").analyze()).violations).toEqual([]);
  await page.locator("[data-audio-queue-close]").click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".topbar [data-action=audio-queue]").click();
  await expect(page.locator(".audio-queue-dialog")).toBeVisible();
});

test("immediate listening pauses conversion and releasing its worker lets the queue continue", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.__delay = 220; });
  const row = await addBook(page, "Une seule voix à calculer", 15);
  await expect(row).toHaveAttribute("data-status", "preparing");
  await page.locator("[data-audio-queue-browse]").click();
  // Listen to another, unprepared book to exercise live synthesis rather than
  // the ready prefix of the book that is already in the preparation queue.
  await importEpub(page, await makeEpub({ title: "Une écoute immédiate distincte", chapters: 1 }));
  await page.getByRole("button", { name: "Écouter", exact: true }).click();
  await page.locator("[data-voice-start]").click();
  await expect(page.locator("[data-voice-action=toggle]")).toContainText("Pause");
  await expect.poll(() => page.evaluate(() => window.__audio.paused)).toBe(false);
  await page.locator(".reader-commandbar [data-action=audio-queue]").click();
  await expect(page.locator("[data-audio-queue-suspended]")).toBeVisible();
  await page.locator("[data-audio-queue-close]").click();
  await page.locator("[data-voice-action=toggle]").click();
  await page.locator(".reader-commandbar [data-action=audio-queue]").click();
  await expect(row).toHaveAttribute("data-status", "preparing");
  const progress = await row.locator("progress").getAttribute("value");
  await expect.poll(() => row.locator("progress").getAttribute("value")).not.toBe(progress);
  expect(await page.evaluate(() => window.__generation.maximum)).toBe(1);
  await row.locator('[data-audio-queue-action="cancel"]').click();
});
