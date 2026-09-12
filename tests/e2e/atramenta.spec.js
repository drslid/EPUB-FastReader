import JSZip from "jszip";
import { test, expect } from "./fixtures.js";
import { makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });
const TITLE = "Un cœur simple";
const SOURCE = "https://www.atramenta.net/lire/un-coeur-simple/15038";
const COVER = "https://www.atramenta.net/images/work_covers/15038big.jpg?1414745489";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");
const html = `<form action="/search/"></form><main id="main_content_wrapper"><div class="liste_oeuvres"><div class="lo_lecture_libre"><div class="lo_basic_info"><h4 class="lo_titre"><a href="/lire/un-coeur-simple/15038">Un c&#339;ur simple</a></h4><p class="lo_auteur">Par <a>Gustave Flaubert</a></p><p class="lo_short_summary">Un conte de Gustave Flaubert.</p></div><p class="lo_cover"><img src="${COVER}"></p><ul><li class="ro_free_ebook"><a href="/lire/un-coeur-simple/15038#telecharger">Télécharger</a></li></ul></div></div></main>`;

async function sourceFixtures(page, { quota = false } = {}) {
  const zip = await JSZip.loadAsync(await makeEpub({ title: TITLE, author: "Gustave Flaubert", language: "fr", paragraphs: ["Pendant un demi-siècle, les bourgeoises de Pont-l’Évêque envièrent à madame Aubain sa servante Félicité."] }));
  const packageXml = await zip.file("book.opf").async("string");
  zip.file("book.opf", packageXml.replace("<manifest>", '<manifest><item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>'));
  zip.file("cover.png", png);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const counts = { searches: 0, downloads: 0 };
  await page.route("**/api/sources/atramenta/search?*", (route) => {
    counts.searches++;
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
  await page.route(COVER, (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.route("**/api/books/atramenta/15038-un-coeur-simple.epub", (route) => {
    counts.downloads++;
    return quota
      ? route.fulfill({ status: 429, headers: { "Retry-After": "86400" }, json: { error: { code: "SOURCE_DAILY_LIMIT", message: "Quota partagé atteint." } } })
      : route.fulfill({ contentType: "application/epub+zip", body: bytes });
  });
  return { counts, bytes };
}

async function openCatalog(page, query = "Flaubert") {
  await page.goto(`/#search?q=${query}&provider=atramenta&page=1`);
  const result = page.locator('.book-card[data-provider="atramenta"]');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText(TITLE);
  await expect(result).toContainText("Gustave Flaubert");
  await expect(result.locator(`a[href="${SOURCE}"]`)).toContainText("Atramenta");
  return result;
}

test("Atramenta : couverture, lecture directe en mot à mot et EPUB conservé localement", async ({ page, context }) => {
  const { counts, bytes } = await sourceFixtures(page);
  const result = await openCatalog(page);
  await expect(result.locator(`img[src="${COVER}"]`)).toBeVisible();
  expect(counts.downloads).toBe(0);
  await result.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText(TITLE);
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  expect(book.source).toMatchObject({ providerId: "atramenta", canonicalSourceId: "atramenta:15038", canExportClassic: false, canExportFocus: false });
  const savedBytes = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("fastreader"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction("books").objectStore("books").getAll(); request.onsuccess = () => resolve(request.result[0].original.byteLength); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
  expect(savedBytes).toBe(bytes.length);
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  const cover = page.locator(".library-section .book-card .cover img");
  await expect(cover).toHaveAttribute("src", `data:image/png;base64,${png.toString("base64")}`);
  await page.reload();
  await expect(cover).toHaveAttribute("src", `data:image/png;base64,${png.toString("base64")}`);
  await context.setOffline(true);
  await page.locator(".library-section .book-card").getByRole("button", { name: `Lire ${TITLE}`, exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText(TITLE);
  expect(counts.downloads).toBe(1);
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});

test("Atramenta : quota explicite, aucune fausse importation et recherche encore disponible", async ({ page }) => {
  const { counts } = await sourceFixtures(page, { quota: true });
  await (await openCatalog(page)).getByRole("button", { name: "Lire", exact: true }).click();
  const dialog = page.locator(".fallback-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("La limite de téléchargement de cette source est atteinte. Réessayez plus tard.");
  await expect(dialog.getByRole("link", { name: "Ouvrir la fiche source" })).toHaveAttribute("href", SOURCE);
  expect(await storedRows(page, "books")).toHaveLength(0);
  await expect(page.locator(".reader-title")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await openCatalog(page, "coeur");
  expect(counts.searches).toBeGreaterThanOrEqual(2);
  expect(counts.downloads).toBe(1);
});
