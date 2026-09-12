import { expect, test } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { importEpub, makeEpub } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

test("une recherche sans filtre trouve les livres anglais et conserve toutes les langues au rechargement", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#search-language")).toHaveValue("");
  await expect(page.locator(".local-note, .site-credit")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("Austen");
  await page.locator("#search-form").getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page).toHaveURL(/language=&/);
  await expect(page.locator('.catalog-grid .book-card[data-language="en"]').first()).toBeVisible();
  await page.reload();
  await expect(page.locator("#search-language")).toHaveValue("");
  await expect(page.locator('.catalog-grid .book-card[data-language="en"]').first()).toBeVisible();
});

test("la recherche affiche un livre par ligne, ses titres complets et ses actions, même à 320 px", async ({ page }) => {
  const title = "Voyage au cœur des livres : une très longue histoire pour les lecteurs qui aiment découvrir de nouveaux horizons";
  await page.goto("/");
  await importEpub(page, await makeEpub({ title, author: "Camille, une autrice à découvrir" }));
  await expect(page.locator(".reader-title strong")).toHaveText(title);
  await page.goto("/#search?q=voyage&language=&provider=gutenberg&page=1");
  await expect(page.locator(".local-results .book-card h3")).toHaveText(title);
  await expect.poll(() => page.locator(".catalog-grid .book-card").count()).toBeGreaterThan(2);
  for (const width of [null, 320]) {
    if (width) await page.setViewportSize({ width, height: 740 });
    const dimensions = await page.locator(".catalog-grid .book-card").evaluateAll((rows) => rows.slice(0, 4).map((row) => {
      const { x, y, width, bottom } = row.getBoundingClientRect();
      return { x, y, width, bottom };
    }));
    for (let i = 1; i < dimensions.length; i++) {
      expect(dimensions[i].x).toBeCloseTo(dimensions[0].x);
      expect(dimensions[i].width).toBeCloseTo(dimensions[0].width);
      expect(dimensions[i].y).toBeGreaterThanOrEqual(dimensions[i - 1].bottom - 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const local = page.locator(".local-results .book-card");
    await expect(local.getByRole("heading", { name: title })).toBeVisible();
    const fullTitles = await page.locator(".book-list h3").evaluateAll((titles) => titles.every((title) =>
      title.scrollHeight <= title.clientHeight + 1 && title.scrollWidth <= title.clientWidth + 1 && getComputedStyle(title).webkitLineClamp === "none"));
    expect(fullTitles).toBe(true);
    await expect(local.locator(".start-book-button")).toBeVisible();
    await expect(page.locator(".catalog-grid .book-card-meta a").first()).toContainText("Gutenberg");
    const button = await page.locator(".catalog-grid .start-book-button").first().boundingBox();
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeLessThan(70);
  }
  const audit = await new AxeBuilder({ page }).include(".book-list").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.locator(".local-results .start-book-button").click();
  await expect(page.locator(".reader-title strong")).toHaveText(title);
});
