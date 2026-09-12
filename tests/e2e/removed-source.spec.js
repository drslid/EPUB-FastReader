import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { test, expect } from "./fixtures.js";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

test("les anciens liens Atramenta reviennent aux sources actives avec toutes les langues", async ({ page }) => {
  const requests = [];
  await page.route(/atramenta/iu, (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.goto("/#search?q=Flaubert&provider=atramenta&page=1");
  await expect(page.locator('.source-tabs [data-provider="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-action="provider"][data-provider="atramenta"]')).toHaveCount(0);
  await expect(page.locator("#search-language")).toHaveValue("");
  await expect.poll(() => page.locator(".catalog-grid .book-card").count()).toBeGreaterThan(0);
  await page.goto("/#discover?provider=atramenta&page=1");
  await expect(page.locator('.source-tabs [data-provider="selection"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.catalog-grid .book-card[data-provider="selection"]')).toHaveCount(9);
  expect(requests).toEqual([]);
});

test("un EPUB Atramenta déjà conservé garde sa couverture, ses repères et son export original hors ligne", async ({ page, context }, testInfo) => {
  const title = "Un cœur simple — édition de test";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");
  const cover = `data:image/png;base64,${png.toString("base64")}`;
  const zip = await JSZip.loadAsync(await makeEpub({ title, author: "Gustave Flaubert", language: "fr" }));
  zip.file("book.opf", (await zip.file("book.opf").async("string")).replace("<manifest>", '<manifest><item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>'));
  zip.file("cover.png", png);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const source = {
    providerId: "atramenta", name: "Atramenta", bookId: "atramenta-15038-un-coeur-simple",
    canonicalSourceId: "atramenta:15038", url: "https://www.atramenta.net/lire/un-coeur-simple/15038",
    rightsUrl: "https://www.atramenta.net/help/licences", canExportFocus: false, canExportClassic: false,
    presentation: { version: 1, key: "atramenta:15038", image: cover, remoteImage: "https://www.atramenta.net/images/work_covers/15038big.jpg", title, author: "Gustave Flaubert" },
  };
  const requests = [];
  await page.route(/atramenta/iu, (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.goto("/#library");
  await importEpub(page, bytes, "un-coeur-simple.epub");
  await expect(page.locator(".reader-title strong")).toHaveText(title);
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  // Reproduce an archive saved before the source was removed, including its
  // original export restrictions and a reading bookmark. No adapter is needed.
  await page.evaluate(async (source) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("fastreader");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["books", "positions"], "readwrite");
        const get = tx.objectStore("books").getAll();
        get.onsuccess = () => {
          const book = get.result[0];
          tx.objectStore("books").put({ ...book, source });
          tx.objectStore("positions").put({ id: book.id, chapterIndex: 0, wordIndex: 3, scrollRatio: 0, progress: 0.1, bookmarks: [{ id: "saved-before-removal", chapterIndex: 0, wordIndex: 3, scrollRatio: 0, label: "À retrouver", createdAt: 1 }], annotations: [] });
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, source);
  await page.reload();
  const card = page.locator(".library-section .book-card");
  await expect(card.locator(".cover img")).toHaveAttribute("src", cover);
  expect((await storedRows(page, "books"))[0].source).toEqual(source);
  await context.setOffline(true);
  await card.getByRole("button", { name: `Lire ${title}`, exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText(title);
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(card.locator(".cover img")).toHaveAttribute("src", cover);
  const downloadPending = page.waitForEvent("download");
  await card.getByRole("button", { name: `Télécharger en Classique : ${title}`, exact: true }).click();
  const download = await downloadPending;
  const filename = testInfo.outputPath("retained-original.epub");
  await download.saveAs(filename);
  expect(await readFile(filename)).toEqual(bytes);
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].source).toEqual(source);
  expect((await storedRows(page, "positions"))[0].bookmarks).toContainEqual(expect.objectContaining({ id: "saved-before-removal", label: "À retrouver" }));
  expect(requests).toEqual([]);
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});
