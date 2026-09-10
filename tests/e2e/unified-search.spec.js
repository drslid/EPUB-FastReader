import { expect, test } from "@playwright/test";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

const results = (page) =>
  page.locator('section[aria-label="Résultats de recherche"]');
const localBooks = (page) => page.locator(".local-results .book-card");
const catalogBooks = (page) => page.locator(".catalog-grid .book-card");

async function submitSearch(page, query, language = "fr") {
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill(query);
  await page.getByLabel("Langue du livre", { exact: true }).selectOption(language);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page).toHaveURL(/#search\?/);
  await expect.poll(() => {
    const parameters = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    return {
      query: parameters.get("q"),
      language: parameters.get("language"),
      provider: parameters.get("provider"),
      page: parameters.get("page"),
    };
  }).toEqual({ query, language, provider: "all", page: "1" });
}

async function ready(page) {
  const parameters = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
  await expect(results(page)).toHaveAttribute("data-query", parameters.get("q") || "");
  await expect(results(page)).toHaveAttribute("aria-busy", "false");
}

async function importLocalBook(page, options = {}) {
  await page.goto("/#library");
  await importEpub(
    page,
    await makeEpub({ title: "Germinal personnel", author: "Émile Zola", ...options }),
  );
  await expect(page.locator(".reader-title strong")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(page).toHaveURL(/#library$/);
}

async function scrollPageDown(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
}

test("une seule barre reste accessible à 320 px et recherche les mêmes sources depuis les deux pages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/#library");
  await expect(page.locator('input[type="search"]')).toHaveCount(1);
  await expect(page.locator("#search-form")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("Un brouillon à effacer");
  await page.getByRole("button", { name: "Effacer la recherche", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("");
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toBeFocused();
  await expect(page).toHaveURL(/#library$/);
  await scrollPageDown(page);
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.locator(".shell-header").evaluate((header) => getComputedStyle(header).position)).toBe("sticky");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await submitSearch(page, "hugo");
  await ready(page);
  const firstTitles = await page.locator(".catalog-grid h3").allTextContents();
  expect(firstTitles.length).toBeGreaterThan(0);
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Découvrir", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("");
  await expect(page.locator('input[type="search"]')).toHaveCount(1);
  await submitSearch(page, "hugo");
  await ready(page);
  expect(await page.locator(".catalog-grid h3").allTextContents()).toEqual(firstTitles);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Effacer la recherche", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("");
  await expect.poll(() => {
    const parameters = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    return [parameters.get("q"), parameters.get("language"), parameters.get("provider"), parameters.get("page")];
  }).toEqual(["", "fr", "all", "1"]);
  await ready(page);
  await expect(catalogBooks(page)).toHaveCount(24);
});

test("les livres enregistrés précèdent les sources, ne sont pas dupliqués et reprennent sans télécharger", async ({ page }) => {
  await page.goto("/#discover");
  await page.locator('[data-action="catalog-read"][data-id="selection-le-horla"]').first().click();
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await page.getByRole("button", { name: "Avancer de dix mots", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  const readingCount = await page.locator("#rsvp-count").textContent();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();

  await submitSearch(page, "maupassant");
  await ready(page);
  await expect(localBooks(page)).toHaveCount(1);
  await expect(localBooks(page).first()).toContainText("Le Horla");
  expect(await catalogBooks(page).count()).toBeGreaterThan(0);
  await expect(page.locator('.catalog-grid [data-id="selection-le-horla"], .catalog-grid [data-id="gutenberg-10775"]')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const local = document.querySelector(".local-results");
    const remote = document.querySelector(".catalog-grid");
    return Boolean(local.compareDocumentPosition(remote) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  const downloads = [];
  await page.route(/(?:\.epub(?:\?|$)|\/api\/epub\/)/, (route) => {
    downloads.push(route.request().url());
    return route.abort("failed");
  });
  await page.locator(".local-results").getByRole("button", { name: "Lire Le Horla", exact: true }).click();
  await expect(page.locator("#rsvp-count")).toHaveText(readingCount);
  expect(await storedRows(page, "books")).toHaveLength(1);
  expect((await storedRows(page, "positions"))[0].bookmarks).toHaveLength(1);
  expect(downloads).toEqual([]);
});

test("mes livres apparaissent pendant que les autres sources chargent", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requested = [];
  await page.route("**/catalog/fr-*.json", async (route) => {
    requested.push(route.request().url());
    await pending;
    await route.continue().catch(() => {});
  });
  try {
    await importLocalBook(page);
    await submitSearch(page, "germinal");
    await expect.poll(() => requested.length).toBeGreaterThan(0);
    await expect(localBooks(page)).toHaveCount(1);
    await expect(localBooks(page)).toContainText("Germinal personnel");
    await expect(results(page)).toHaveAttribute("aria-busy", "true");
    release();
    await ready(page);
    await expect(localBooks(page)).toHaveCount(1);
    expect(await catalogBooks(page).count()).toBeGreaterThan(0);
  } finally {
    release();
  }
});

test("une source indisponible laisse la recherche et la lecture locales utilisables", async ({ page }) => {
  await page.route("**/catalog/fr-*.json", (route) => route.abort("failed"));
  await importLocalBook(page);
  await submitSearch(page, "germinal");
  await ready(page);
  await expect(localBooks(page)).toHaveCount(1);
  await expect(page.locator(".source-warning")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("germinal");
  await page.locator(".local-results").getByRole("button", { name: "Lire Germinal personnel", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Germinal personnel");
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(await storedRows(page, "books")).toHaveLength(1);
});

test("un résultat retardé conserve le brouillon et le focus puis le choix de source applique ces nouveaux critères", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requested = [];
  await page.route("**/catalog/fr-*.json", async (route) => {
    requested.push(route.request().url());
    await pending;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto("/#search?q=germinal&language=fr&provider=all&page=1");
    await expect.poll(() => requested.length).toBeGreaterThan(0);
    await expect(results(page)).toHaveAttribute("aria-busy", "true");
    await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("pride prejudice");
    const language = page.getByLabel("Langue du livre", { exact: true });
    await language.selectOption("en");
    await language.focus();
    release();
    await ready(page);
    await expect(catalogBooks(page).first()).toContainText(/Germinal/i);
    await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("pride prejudice");
    await expect(language).toHaveValue("en");
    await expect(language).toBeFocused();
    const previous = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    expect(previous.get("q")).toBe("germinal");
    expect(previous.get("language")).toBe("fr");

    await page.getByRole("button", { name: "Project Gutenberg", exact: true }).click();
    await expect.poll(() => {
      const parameters = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
      return [parameters.get("q"), parameters.get("language"), parameters.get("provider"), parameters.get("page")];
    }).toEqual(["pride prejudice", "en", "gutenberg", "1"]);
    await ready(page);
    await expect(catalogBooks(page).first()).toContainText("Pride and Prejudice");
    await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("pride prejudice");
    await expect(language).toHaveValue("en");
  } finally {
    release();
  }
});

test("l’URL conserve la recherche et la langue après rechargement, retour et avance", async ({ page }) => {
  await page.goto("/#library");
  await submitSearch(page, "hugo", "fr");
  await ready(page);
  const frenchTitles = await page.locator(".catalog-grid h3").allTextContents();
  const frenchURL = page.url();
  await submitSearch(page, "pride prejudice", "en");
  await ready(page);
  await expect(catalogBooks(page).first()).toContainText("Pride and Prejudice");
  const englishURL = page.url();
  const parameters = new URLSearchParams(new URL(englishURL).hash.split("?")[1]);
  expect(parameters.get("q")).toBe("pride prejudice");
  expect(parameters.get("language")).toBe("en");
  expect(parameters.get("provider")).toBe("all");
  expect(parameters.get("page")).toBe("1");

  await page.reload();
  await ready(page);
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("pride prejudice");
  await expect(page.getByLabel("Langue du livre", { exact: true })).toHaveValue("en");
  await expect(catalogBooks(page).first()).toContainText("Pride and Prejudice");
  await page.goBack();
  await expect(page).toHaveURL(frenchURL);
  await ready(page);
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("hugo");
  await expect(page.getByLabel("Langue du livre", { exact: true })).toHaveValue("fr");
  expect(await page.locator(".catalog-grid h3").allTextContents()).toEqual(frenchTitles);
  await page.goForward();
  await expect(page).toHaveURL(englishURL);
  await ready(page);
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("pride prejudice");
  await expect(catalogBooks(page).first()).toContainText("Pride and Prejudice");
});

test("la navigation et un clic sur la page active remontent en haut", async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize().width, height: 640 });
  await page.goto("/#discover");
  await expect(catalogBooks(page)).toHaveCount(9);
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await scrollPageDown(page);
  await navigation.getByRole("link", { name: "Découvrir", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await scrollPageDown(page);
  await navigation.getByRole("link", { name: /Ma bibliothèque/ }).click();
  await expect(page).toHaveURL(/#library$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await scrollPageDown(page);
  await navigation.getByRole("link", { name: /Ma bibliothèque/ }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await scrollPageDown(page);
  await navigation.getByRole("link", { name: "Découvrir", exact: true }).click();
  await expect(page).toHaveURL(/#discover$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
});

test("la pagination remonte les nouveaux résultats et conserve les critères dans le lien", async ({ page }) => {
  await page.goto("/#search?q=&language=en&provider=all&page=1");
  await ready(page);
  await expect(catalogBooks(page)).toHaveCount(24);
  const firstTitles = await page.locator(".catalog-grid h3").allTextContents();
  await scrollPageDown(page);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 2");
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  const parameters = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
  expect(parameters.get("language")).toBe("en");
  expect(parameters.get("page")).toBe("2");
  expect(await page.locator(".catalog-grid h3").allTextContents()).not.toEqual(firstTitles);
  await scrollPageDown(page);
  await page.getByRole("button", { name: "Précédent", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 1");
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  expect(await page.locator(".catalog-grid h3").allTextContents()).toEqual(firstTitles);
});

test("remonter les pages de navigation ne réinitialise pas le passage enregistré en lecture Classique", async ({ page }) => {
  const paragraphs = Array.from({ length: 70 }, (_, index) =>
    `Passage ${index + 1}. ${"Une longue promenade nous conduit vers les collines et les jardins de la ville. ".repeat(5)}`,
  );
  await page.goto("/#library");
  await importEpub(page, await makeEpub({ title: "Le voyage préservé", paragraphs, chapters: 1 }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Classique", exact: true }).click();
  await page.locator("#chapter-scroll").evaluate((element) => { element.scrollTop = 1700; });
  await expect.poll(async () => (await storedRows(page, "positions"))[0]?.locator?.textOffset || 0).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  const before = (await storedRows(page, "positions"))[0];
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Découvrir", exact: true }).click();
  await expect(catalogBooks(page)).toHaveCount(9);
  await scrollPageDown(page);
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: /Ma bibliothèque/ }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await submitSearch(page, "voyage préservé");
  await expect(localBooks(page)).toHaveCount(1);
  await page.locator(".local-results").getByRole("button", { name: "Lire Le voyage préservé", exact: true }).click();
  await expect(page.getByRole("button", { name: "Classique", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#chapter-scroll").evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
  const after = (await storedRows(page, "positions"))[0];
  expect(after.locator.textOffset).toBe(before.locator.textOffset);
  expect(after.locator.exact).toBe(before.locator.exact);
  expect(after.bookmarks).toHaveLength(1);
  expect(after.bookmarks[0].locator.textOffset).toBe(before.bookmarks[0].locator.textOffset);
});
