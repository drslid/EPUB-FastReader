import { expect, test } from "./fixtures.js";
import { makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });
const imageUrl = "https://www.loyalbooks.com/image/layout2/Candide.jpg";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");
const catalog = {
  version: 1, updatedAt: "2026-09-12T12:00:00.000Z", coverage: "selection",
  languages: { fr: { indexed: 1, total: 1434, pages: 1, complete: false } },
  books: [{ slug: "candide-by-voltaire-2", title: "Candide ou L’optimisme", author: "Voltaire", language: "fr", cover: imageUrl }],
};

async function fixtures(page, { coverStatus = 200, downloadStatus = 200 } = {}) {
  const archive = await makeEpub({ title: "Candide ou L’optimisme", author: "Voltaire", language: "fr", paragraphs: ["Il y avait en Westphalie un jeune garçon à qui la nature avait donné les mœurs les plus douces."] });
  const counts = { catalogs: 0, downloads: 0, covers: 0, remoteSearch: 0 };
  await page.route("**/catalog/loyalbooks.json", (route) => { counts.catalogs++; return route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog) }); });
  await page.route(imageUrl, (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.route("**/api/books/loyalbooks/candide-by-voltaire-2.epub", (route) => {
    counts.downloads++;
    return route.fulfill({ status: downloadStatus, contentType: downloadStatus === 200 ? "application/epub+zip" : "text/plain", body: downloadStatus === 200 ? archive : "Source unavailable" });
  });
  await page.route("**/api/sources/loyalbooks/cover/candide-by-voltaire-2.jpg", (route) => {
    counts.covers++;
    return route.fulfill({ status: coverStatus, contentType: coverStatus === 200 ? "image/png" : "text/plain", body: coverStatus === 200 ? png : "Cover unavailable" });
  });
  // A local selection must not secretly depend on the source's Google widget.
  await page.route(/https:\/\/(?:www\.)?(?:loyalbooks\.com|google\.com|cse\.google\.com)\/(?:search|cse)/u, (route) => { counts.remoteSearch++; return route.abort(); });
  return counts;
}

async function open(page) {
  await page.goto("/#search?q=candide&language=fr&provider=loyalbooks&page=1");
  const card = page.locator('.catalog-grid .book-card[data-provider="loyalbooks"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Voltaire");
  await expect(card.locator(".cover img")).toHaveAttribute("src", imageUrl);
  await expect(card.locator('a[href="https://www.loyalbooks.com/book/candide-by-voltaire-2"]')).toContainText("Loyal Books");
  return card;
}

test("Loyal Books recherche localement puis ouvre l’EPUB en mot à mot et conserve sa couverture", async ({ page }) => {
  const counts = await fixtures(page);
  await (await open(page)).getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Candide ou L’optimisme");
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  expect(book.source).toMatchObject({ providerId: "loyalbooks", canonicalSourceId: "loyalbooks:candide-by-voltaire-2" });
  expect(book.source.presentation.remoteImage).toBe(imageUrl);
  expect(book.source.presentation.image).toMatch(/^data:image\/png;base64,/u);
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.locator(".library-section .cover img")).toHaveAttribute("src", book.source.presentation.image);
  await page.reload();
  await expect(page.locator(".library-section .cover img")).toHaveAttribute("src", book.source.presentation.image);
  await page.locator(".library-section").getByRole("button", { name: "Lire Candide ou L’optimisme", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(counts).toMatchObject({ downloads: 1, covers: 1, remoteSearch: 0 });
});

test("une couverture Loyal Books indisponible ne bloque pas l’import EPUB", async ({ page }) => {
  await fixtures(page, { coverStatus: 503 });
  await (await open(page)).getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(await storedRows(page, "books")).toHaveLength(1);
});

test("un EPUB Loyal Books indisponible ne crée pas de livre fictif", async ({ page }) => {
  await fixtures(page, { downloadStatus: 503 });
  await (await open(page)).getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".fallback-dialog")).toBeVisible();
  expect(await storedRows(page, "books")).toHaveLength(0);
});

test("une langue non indexée reste vide sans recherche extérieure", async ({ page }) => {
  const counts = await fixtures(page);
  await page.goto("/#search?q=candide&language=en&provider=loyalbooks&page=1");
  await expect(page.locator('section[aria-label="Résultats de recherche"]')).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('.catalog-grid .book-card[data-provider="loyalbooks"]')).toHaveCount(0);
  expect(counts).toMatchObject({ downloads: 0, remoteSearch: 0 });
});
