import { expect, test } from "./fixtures.js";
import { makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });
const imageUrl = "https://www.epubbooks.com/images/covers/shelley-frankenstein_thumb.jpg";
const record = '<li class="media"><a class="media-left" href="/book/22-frankenstein"><img src="' + imageUrl + '" /></a><div class="media-body"><h4 class="media-heading"><a href="/book/22-frankenstein">Frankenstein</a><span class="small">Mary Shelley</span></h4></div></li>';
const html = `<form role="search"></form><h1>Top Search Results for "frankenstein"</h1><ul class="media-list">${record}</ul>`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");

async function sourceFixtures(page, { downloadStatus = 200, coverStatus = 200 } = {}) {
  const archive = await makeEpub({ title: "Frankenstein", author: "Mary Shelley", language: "en", paragraphs: ["I am by birth a Genevese. This edition belongs in the local library after it has been opened."] });
  const counts = { downloads: 0, covers: 0 };
  await page.route("**/api/sources/epubbooks/search?*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.route(imageUrl, (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.route("**/api/books/epubbooks/22-frankenstein.epub", (route) => {
    counts.downloads++;
    return route.fulfill({ status: downloadStatus, contentType: downloadStatus === 200 ? "application/epub+zip" : "text/plain", body: downloadStatus === 200 ? archive : "Source unavailable" });
  });
  await page.route("**/api/sources/epubbooks/cover/22-frankenstein.jpg", (route) => {
    counts.covers++;
    return route.fulfill({ status: coverStatus, contentType: coverStatus === 200 ? "image/png" : "text/plain", body: coverStatus === 200 ? png : "Cover unavailable" });
  });
  return counts;
}

async function openCatalog(page) {
  await page.goto("/#search?q=frankenstein&language=en&provider=epubbooks&page=1");
  const card = page.locator('.catalog-grid .book-card[data-provider="epubbooks"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Mary Shelley");
  await expect(card.locator('a[href="https://www.epubbooks.com/book/22-frankenstein"]')).toContainText("epubBooks");
  return card;
}

test("epubBooks ouvre un EPUB et garde la couverture choisie localement sans second téléchargement", async ({ page }) => {
  const counts = await sourceFixtures(page);
  const card = await openCatalog(page);
  await card.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Frankenstein");
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  expect(book.source).toMatchObject({ providerId: "epubbooks", canonicalSourceId: "epubbooks:22", canExportFocus: false });
  expect(book.source.presentation.remoteImage).toBe(imageUrl);
  expect(book.source.presentation.image).toMatch(/^data:image\/png;base64,/u);
  expect(counts).toEqual({ downloads: 1, covers: 1 });
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  const cover = page.locator(".library-section .book-card .cover img");
  await expect(cover).toHaveAttribute("src", book.source.presentation.image);
  await page.reload();
  await expect(cover).toHaveAttribute("src", book.source.presentation.image);
  await page.locator(".library-section").getByRole("button", { name: "Lire Frankenstein", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Frankenstein");
  expect(counts).toEqual({ downloads: 1, covers: 1 });
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});

test("une couverture epubBooks indisponible n’empêche pas l’ouverture de son EPUB", async ({ page }) => {
  await sourceFixtures(page, { coverStatus: 503 });
  await (await openCatalog(page)).getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Frankenstein");
  expect(await storedRows(page, "books")).toHaveLength(1);
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});

test("un échec EPUB n’ajoute pas de livre fictif à la bibliothèque", async ({ page }) => {
  await sourceFixtures(page, { downloadStatus: 503 });
  await (await openCatalog(page)).getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".fallback-dialog")).toBeVisible();
  expect(await storedRows(page, "books")).toHaveLength(0);
  await expect(page.locator(".reader-title")).toHaveCount(0);
});

test("les suggestions de remplacement du site ne deviennent pas de faux résultats epubBooks", async ({ page }) => {
  await page.route("**/api/sources/epubbooks/search?*", (route) => route.fulfill({ contentType: "text/html", body: `${html}<h3>No results found. You might like to try one of our featured books:</h3>` }));
  await page.goto("/#search?q=absent&language=en&provider=epubbooks&page=1");
  await expect(page.locator('section[aria-label="Résultats de recherche"]')).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('.catalog-grid .book-card[data-provider="epubbooks"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aucun livre trouvé", exact: true })).toBeVisible();
});
