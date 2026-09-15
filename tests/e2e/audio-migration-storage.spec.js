import { test, expect } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";
import { LEGACY_VOICE_CACHE_NAME, VOICE_CACHE_NAME } from "../../src/voice-assets.js";

test.use({ serviceWorkers: "block" });

test("removing the previous speech engine preserves books and other installations on a small screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/de.html");
  await importEpub(page, await makeEpub({ title: "Un livre conservé", chapters: 1 }));
  await expect(page.locator("#rsvp")).toBeVisible();
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  const own = "http://127.0.0.1:4173/voice-runtime/v1/worker.js";
  const sibling = "http://127.0.0.1:4173/other/voice-runtime/v1/worker.js";
  const current = "http://127.0.0.1:4173/voice-runtime/v2/worker.js";
  await page.evaluate(async ({ own, sibling, current, oldCache, newCache }) => {
    const old = await caches.open(oldCache);
    await old.put(own, new Response("previous engine", { headers: { "Content-Length": "117000000" } }));
    await old.put(sibling, new Response("another installation"));
    await (await caches.open(newCache)).put(current, new Response("current engine"));
  }, { own, sibling, current, oldCache: LEGACY_VOICE_CACHE_NAME, newCache: VOICE_CACHE_NAME });
  await page.locator('[data-mode="audio"]').click();
  await expect(page.locator("[data-voice-legacy]")).toBeVisible();
  expect(await page.locator("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".voice-dialog").analyze()).violations).toEqual([]);
  const remove = page.locator("[data-voice-remove-legacy]");
  expect((await remove.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(page.locator("[data-voice-legacy]")).toBeHidden();
  await expect(page.locator("[data-voice-start]")).toBeFocused();
  const retained = await page.evaluate(async ({ own, sibling, current, oldCache, newCache }) => {
    const old = await caches.open(oldCache);
    return { own: Boolean(await old.match(own)), sibling: Boolean(await old.match(sibling)), current: Boolean(await (await caches.open(newCache)).match(current)) };
  }, { own, sibling, current, oldCache: LEGACY_VOICE_CACHE_NAME, newCache: VOICE_CACHE_NAME });
  expect(retained).toEqual({ own: false, sibling: true, current: true });
  expect(await storedRows(page, "books")).toEqual(books);
});
