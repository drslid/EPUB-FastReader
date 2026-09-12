import { test, expect, emptyStandardSearch } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";

test.use({ serviceWorkers: "block" });
const statusUrl = /\/api\/sources\/status$/;
const statusBody = (available = true) => ({ checkedAt: new Date().toISOString(), sources: [
  { providerId: "gutenberg", available }, { providerId: "ebooks-gratuits", available }, { providerId: "fadedpage", available }, { providerId: "epubbooks", available },
] });
async function openSettings(page) {
  const trigger = page.locator('.page-footer [data-action="source-settings"]');
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Paramètres", exact: true })).toBeVisible();
  return trigger;
}

test("les sources ont des états textuels rouge/vert, se revérifient et réutilisent le cache sans EPUB", async ({ page }) => {
  const epubs = [];
  let requests = 0;
  page.on("request", (request) => { if (/\.epub(?:\?|$)/.test(request.url())) epubs.push(request.url()); });
  await page.route(statusUrl, (route) => route.fulfill({ json: statusBody(++requests === 1) }));
  await page.goto("/#library");
  await openSettings(page);
  const dialog = page.locator(".source-settings-dialog");
  await expect(dialog.locator("[data-check]")).toBeEnabled();
  for (const id of ["selection", "standard-ebooks", "gutenberg", "ebooks-gratuits", "fadedpage", "epubbooks"]) {
    await expect(dialog.locator(`[data-source="${id}"] .source-status-label`)).toHaveText("Disponible");
    await expect(dialog.locator(`[data-source="${id}"] .source-status-dot`)).toHaveClass(/is-available/);
  }
  await expect(dialog.locator('[data-source="z-library"] .source-status-dot')).toHaveClass(/is-unavailable/);
  await expect(dialog.locator('[data-source="z-library"] .source-status-label')).toHaveText("Indisponible");
  await dialog.locator("[data-check]").click();
  await expect(dialog.locator('[data-source="ebooks-gratuits"] .source-status-label')).toHaveText("Indisponible");
  await expect(dialog.locator("[data-check]")).toBeEnabled();
  expect(requests).toBe(2);
  await dialog.locator("[data-close]").click();
  await openSettings(page);
  await expect(dialog.locator("[data-check]")).toBeEnabled();
  await expect(dialog.locator('[data-source="ebooks-gratuits"] .source-status-label')).toHaveText("Indisponible");
  expect(requests).toBe(2);
  expect(epubs).toEqual([]);
});

test("une source lente laisse apparaître les autres et fermer le panneau annule sa requête", async ({ page }) => {
  let finish;
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.sourceProbeAborted = false;
    window.fetch = (input, options) => {
      if (String(input).endsWith("/api/sources/status")) options?.signal?.addEventListener("abort", () => { window.sourceProbeAborted = true; }, { once: true });
      return originalFetch(input, options);
    };
  });
  await page.route(statusUrl, async (route) => {
    await new Promise((resolve) => { finish = resolve; });
    await route.fulfill({ json: statusBody() }).catch(() => {});
  });
  await page.route(/^https:\/\/standardebooks\.org\/ebooks\?/, (route) => route.fulfill({ status: 200, contentType: "application/xhtml+xml", headers: { "access-control-allow-origin": "*" }, body: emptyStandardSearch }));
  await page.goto("/#library");
  const trigger = await openSettings(page);
  const dialog = page.locator(".source-settings-dialog");
  await expect(dialog.locator('[data-source="standard-ebooks"] .source-status-label')).toHaveText("Disponible");
  await expect(dialog.locator('[data-source="gutenberg"] .source-status-label')).toHaveText("Vérification…");
  await expect(dialog.locator("[data-check]")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.sourceProbeAborted)).toBe(true);
  finish();
});

test("le panneau reste lisible dans les trois thèmes et contient le focus sur petit écran", async ({ page }) => {
  await page.route(statusUrl, (route) => route.fulfill({ json: statusBody() }));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/#library");
  const trigger = await openSettings(page);
  const dialog = page.locator(".source-settings-dialog");
  await expect(dialog.locator("[data-check]")).toBeEnabled();
  for (const theme of ["sepia", "night", "paper"]) {
    await page.evaluate((value) => { document.body.dataset.theme = value; }, theme);
    const result = await new AxeBuilder({ page }).include(".source-settings-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await dialog.locator("[data-close]").focus();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
