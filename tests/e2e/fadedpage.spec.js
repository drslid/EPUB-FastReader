import { test, expect } from "./fixtures.js";
import { makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });
const COVER = "https://www.fadedpage.com/books/20260903/cover.jpg";
const TITLE = "Jane: A Story of Jamaica";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");

test("Faded Page: cover before download, direct reading, stored EPUB and offline reopening", async ({ page, context }) => {
  const bytes = await makeEpub({ title: TITLE, author: "Herbert G. de Lisser", language: "en", paragraphs: ["Jane leaves the countryside for Kingston. This test edition keeps the complete text in the reader’s own library."] });
  let downloads = 0;
  await page.route("**/api/sources/fadedpage/search?*", (route) => route.fulfill({ json: { nrows: 1, rows: [{ pid: "20260903", title: TITLE, lang: "en", description: "A Jamaican novel.", cover: "books/20260903/cover.jpg", authors: [{ type: "author", realname: "Herbert G. de Lisser" }] }] } }));
  await page.route(COVER, (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.route("**/api/books/fadedpage/20260903.epub", (route) => {
    downloads++;
    return route.fulfill({ contentType: "application/epub+zip", body: bytes });
  });
  await page.goto("/#search?q=Jane&language=en&provider=fadedpage&page=1");
  const result = page.locator('.book-card[data-provider="fadedpage"]');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText(TITLE);
  await expect(result.locator(`img[src="${COVER}"]`)).toBeVisible();
  await expect(result.locator('a[href="https://www.fadedpage.com/showbook.php?pid=20260903"]')).toContainText("Faded Page");
  expect(downloads).toBe(0);
  await result.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText(TITLE);
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].source).toMatchObject({ providerId: "fadedpage", bookId: "fadedpage-20260903", canExportClassic: false, canExportFocus: false });
  const savedBytes = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("fastreader"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction("books").objectStore("books").getAll(); request.onsuccess = () => resolve(request.result[0].original.byteLength); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
  expect(savedBytes).toBe(bytes.length);
  await page.reload();
  await expect(page.locator(".reader-title strong")).toHaveText(TITLE);
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await context.setOffline(true);
  await page.locator(".library-section .book-card").getByRole("button", { name: `Lire ${TITLE}`, exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(downloads).toBe(1);
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});
