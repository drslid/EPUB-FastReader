// Optional online check, separate from deterministic CI: uses real Gutenberg files.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { storedRows } from "../tests/e2e/helpers/fixtures.js";

const baseURL = process.env.FASTREADER_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch();
const cases = [
  { id: 5711, query: "germinal", language: "fr" },
  { id: 17489, query: "miserables", language: "fr" },
  { id: 1342, query: "pride prejudice", language: "en" },
];
const appearance = (cover) =>
  cover.evaluate((element) => ({
    palette: [...element.classList].find((name) => /^cover-\d+$/.test(name)),
    title: element.querySelector(".cover-title").textContent,
    author: element.querySelector(".cover-author").textContent,
    image: element.querySelector("img")?.getAttribute("src") || null,
  }));
try {
  for (const book of cases) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    const downloads = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/\/api\/books\/gutenberg\/\d+\.epub$/.test(request.url()))
        downloads.push(request.url());
    });
    await page.goto(`${baseURL}/#discover`);
    await page
      .getByRole("searchbox", { name: "Titre ou auteur" })
      .fill(book.query);
    await page
      .getByLabel("Langue du livre", { exact: true })
      .selectOption(book.language);
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    const card = page.locator(
      `.catalog-grid .book-open[data-id="gutenberg-${book.id}"]`,
    );
    await expect(card).toBeVisible();
    const before = await appearance(card.locator(".cover"));
    const response = page.waitForResponse(
      (r) => r.url().endsWith(`/api/books/gutenberg/${book.id}.epub`),
      { timeout: 45_000 },
    );
    const start = performance.now();
    await card.click();
    const received = await response;
    assert.equal(received.status(), 200);
    assert.match(received.headers()["content-type"], /application\/epub\+zip/);
    await expect(page.locator("#rsvp")).toBeVisible({ timeout: 45_000 });
    const title = await page.locator(".reader-title strong").textContent();
    const word = await page.locator("#rsvp-word").textContent();
    const savedBooks = await storedRows(page, "books");
    assert.equal(savedBooks.length, 1);
    assert.equal(
      savedBooks[0].source.canonicalSourceId,
      `gutenberg:${book.id}`,
    );
    const epubBytes = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("fastreader");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction("books").objectStore("books").getAll();
            read.onsuccess = () => {
              db.close();
              resolve(read.result[0].original.byteLength);
            };
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
          };
        }),
    );
    assert.ok(epubBytes > 1_000);
    await page
      .getByRole("button", { name: "Avancer de dix mots", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Ajouter un signet", exact: true })
      .click();
    const resumeWord = await page.locator("#rsvp-word").textContent();
    await page
      .getByRole("link", { name: "Retour à ma bibliothèque", exact: true })
      .click();
    const libraryCover = page.locator(".library-section .book-card .cover");
    await expect(libraryCover).toHaveCount(1);
    assert.deepEqual(await appearance(libraryCover), before);
    await page.reload();
    await expect(libraryCover).toHaveCount(1);
    assert.deepEqual(await appearance(libraryCover), before);
    await page.locator('nav a[href="#discover"]').click();
    await page
      .getByRole("searchbox", { name: "Titre ou auteur" })
      .fill(book.query);
    await page
      .getByLabel("Langue du livre", { exact: true })
      .selectOption(book.language);
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    const savedCard = page.locator(
      `.local-results .book-open[data-id="${savedBooks[0].id}"]`,
    );
    await expect(savedCard).toBeVisible();
    assert.deepEqual(await appearance(savedCard.locator(".cover")), before);
    await expect(
      page.locator('section[aria-label="Résultats de recherche"]'),
    ).toHaveAttribute("aria-busy", "false");
    await expect(card).toHaveCount(0);
    await savedCard.click();
    await expect(page.locator("#rsvp-word")).toHaveText(resumeWord);
    assert.equal(downloads.length, 1);
    assert.equal((await storedRows(page, "positions"))[0].bookmarks.length, 1);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        id: book.id,
        title,
        firstWord: word,
        epubBytes,
        totalSeconds: +((performance.now() - start) / 1_000).toFixed(2),
        coverAndResume: "ok",
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
