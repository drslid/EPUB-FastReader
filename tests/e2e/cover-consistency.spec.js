import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { importEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

const catalogCover = (page, id) =>
  page.locator(`.catalog-grid .book-open[data-id="${id}"] .cover`);
const libraryCover = (page) =>
  page.locator(".library-section .book-card .cover");

async function appearance(cover) {
  await expect(cover).toHaveCount(1);
  return cover.evaluate((element) => ({
    palette: [...element.classList].find((name) => /^cover-\d+$/.test(name)),
    title: element.querySelector(".cover-title").textContent,
    author: element.querySelector(".cover-author").textContent,
    image: element.querySelector("img")?.getAttribute("src") || null,
    imageCount: element.querySelectorAll("img").length,
  }));
}

async function returnToLibrary(page) {
  await page
    .getByRole("link", { name: "Retour à ma bibliothèque", exact: true })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
}

test("Candide conserve exactement sa couverture de Découvrir dans Mes livres après import et rechargement", async ({ page }) => {
  await page.goto("/#discover");
  const expected = await appearance(catalogCover(page, "selection-candide"));
  expect(expected.title).toBe("Candide, ou l’optimisme");
  expect(expected.imageCount).toBe(0);
  await page
    .locator('.catalog-grid .book-open[data-id="selection-candide"]')
    .click();
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  // The real Gutenberg EPUB contains its own image and a differently punctuated
  // title. Neither should unexpectedly replace the cover chosen in Discover.
  expect(book.title).toBe("Candide, ou l'optimisme");
  expect(book.cover).toMatch(/^data:image\/png;base64,/);
  expect(book.source.presentation.title).toBe(expected.title);
  expect(book.source.presentation.image).toBeNull();
  await returnToLibrary(page);
  expect(await appearance(libraryCover(page))).toEqual(expected);
  await page.reload();
  expect(await appearance(libraryCover(page))).toEqual(expected);
  await page
    .locator('nav[aria-label="Navigation principale"] a[href="#discover"]')
    .click();
  expect(await appearance(catalogCover(page, "selection-candide"))).toEqual(expected);
  expect((await storedRows(page, "books"))[0].cover).toBe(book.cover);
});

test("les anciens livres sans présentation enregistrée retrouvent la couverture du catalogue", async ({ page }) => {
  await page.goto("/#discover");
  const expected = await appearance(catalogCover(page, "selection-le-horla"));
  await page
    .locator('.catalog-grid .book-open[data-id="selection-le-horla"]')
    .click();
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  expect(book.cover).toMatch(/^data:image\/png;base64,/);
  await returnToLibrary(page);

  await page.evaluate(
    (id) => new Promise((resolve, reject) => {
      const open = indexedDB.open("fastreader");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("books", "readwrite");
        const store = tx.objectStore("books");
        const request = store.get(id);
        request.onsuccess = () => {
          const saved = request.result;
          delete saved.source.presentation;
          delete saved.source.canonicalSourceId;
          delete saved.source.bookId;
          // Early versions retained only the curated selection identifier.
          saved.source = { selection: saved.source.selection };
          saved.title = "Le Horla (édition EPUB)";
          saved.author = "Maupassant, Guy de";
          store.put(saved);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }),
    book.id,
  );
  await page.reload();
  expect(await appearance(libraryCover(page))).toEqual(expected);
  const [saved] = await storedRows(page, "books");
  expect(saved.source.presentation).toBeUndefined();
  expect(saved.cover).toBe(book.cover);
});

test("un EPUB personnel garde son image de couverture originale après rechargement", async ({ page }) => {
  await page.goto("/");
  await importEpub(
    page,
    await readFile(new URL("../../public/books/candide.epub", import.meta.url)),
    "mon-candide.epub",
  );
  await expect(page.locator("#rsvp")).toBeVisible();
  const [book] = await storedRows(page, "books");
  expect(book.source).toBeUndefined();
  expect(book.cover).toMatch(/^data:image\/png;base64,/);
  await returnToLibrary(page);
  const expected = await appearance(libraryCover(page));
  expect(expected.imageCount).toBe(1);
  expect(expected.image).toBe(book.cover);
  await expect.poll(() => libraryCover(page).locator("img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  expect(await appearance(libraryCover(page))).toEqual(expected);
  await expect.poll(() => libraryCover(page).locator("img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
});

async function expectWholeCoverText(page, container) {
  const results = await container.locator(".cover").evaluateAll((covers) => covers.map((cover) => {
    const bounds = cover.getBoundingClientRect();
    const title = cover.querySelector(".cover-title");
    const author = cover.querySelector(".cover-author");
    const fits = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && node.scrollHeight <= node.clientHeight + 1;
    };
    return { title: title.textContent, author: author.textContent, titleFits: fits(title), authorFits: fits(author), clamp: getComputedStyle(title).webkitLineClamp };
  }));
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.titleFits, result.title).toBe(true);
    expect(result.authorFits, result.author).toBe(true);
    expect(result.clamp).toBe("none");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("les titres longs et leurs auteurs restent entiers dans les couvertures de recherche et de bibliothèque", async ({ page }) => {
  await page.goto("/#discover");
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("hugo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator('.catalog-grid .book-card').first()).toBeVisible();
  await expect(page.locator('section[aria-label="Résultats de recherche"]')).toHaveAttribute("aria-busy", "false");
  await expectWholeCoverText(page, page.locator(".catalog-grid"));
  await expect(page.locator(".cover-emblem")).toHaveCount(0);

  const { makeEpub } = await import("./helpers/fixtures.js");
  const title = "Les aventures extraordinaires d’une lectrice qui parcourait les bibliothèques du monde à la recherche d’une histoire inoubliable et de ses nombreux personnages";
  const author = "Éléonore de la Fontaine et Jean-Baptiste des Horizons";
  await importEpub(page, await makeEpub({ title, author }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.locator(".library-section .cover-title")).toHaveText(title);
  await expect(page.locator(".library-section .cover-author")).toHaveText(author);
  await expectWholeCoverText(page, page.locator(".library-section"));
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("aventures extraordinaires");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator(".local-results .book-card")).toHaveCount(1);
  await expectWholeCoverText(page, page.locator(".local-results"));
});
