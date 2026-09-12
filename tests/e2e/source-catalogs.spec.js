import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

const SE = "https://standardebooks.org";
const SLUG = "jane-austen/pride-and-prejudice";
const DETAIL = `${SE}/ebooks/${SLUG}`;
const DOWNLOAD = `${DETAIL}/downloads/jane-austen_pride-and-prejudice.epub`;
const COVER = `${SE}/images/covers/jane-austen_pride-and-prejudice/495dd49502f1fd5609a27a16f5af2f0a387accb4/cover@2x.jpg`;
const XML = "http://www.w3.org/1999/xhtml";
const xhtml = (body, head = "") => `<!DOCTYPE html><html xmlns="${XML}"><head><title>Standard Ebooks fixture</title>${head}</head><body>${body}</body></html>`;
const standardSearch = xhtml(`<main class="ebooks"><form role="search"></form><ol class="ebooks-list"><li typeof="schema:Book" about="/ebooks/${SLUG}"><p><a href="/ebooks/${SLUG}"><span property="schema:name">Pride and Prejudice</span></a></p><p class="author"><span property="schema:name">Jane Austen</span></p><img property="schema:image" src="${COVER}" /></li></ol></main>`);
const frenchFeed = (title = "Candide, ou l’optimisme", id = 23) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><id>https://www.ebooksgratuits.com/opds/feed.php</id><title>Recherche</title><opensearch:totalResults>1</opensearch:totalResults><entry><id>https://www.ebooksgratuits.com/details.php?book=${id}</id><title>${title}</title><author><name>Voltaire</name></author><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://www.ebooksgratuits.com/newsendbook.php?id=${id}&amp;format=epub" /></entry></feed>`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");
const cors = { "access-control-allow-origin": "*" };
const results = (page) => page.locator('section[aria-label="Résultats de recherche"]');

async function standardRoutes(page, { downloadable = false } = {}) {
  const downloadRequests = [];
  const epub = downloadable ? await makeEpub({ title: "Pride and Prejudice", author: "Jane Austen", language: "en", paragraphs: ["It is a truth universally acknowledged. A reader can resume this complete test edition offline."] }) : null;
  await page.route(`${SE}/ebooks?*`, (route) => route.fulfill({ status: 200, contentType: "application/xhtml+xml", headers: cors, body: standardSearch }));
  await page.route(COVER, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  if (downloadable) {
    await page.route(DETAIL, (route) => route.fulfill({ status: 200, contentType: "application/xhtml+xml", headers: cors, body: xhtml(`<a href="${DOWNLOAD}">Compatible epub</a>`) }));
    await page.route(`${DOWNLOAD}*`, (route) => {
      downloadRequests.push(route.request().url());
      const direct = new URL(route.request().url()).search === "?source=download";
      return route.fulfill({ status: 200, contentType: direct ? "application/epub+zip" : "application/xhtml+xml", headers: cors, body: direct ? epub : xhtml("<p>Your Download Has Started!</p>", `<meta http-equiv="refresh" content="0; url=${DOWNLOAD}?source=download" />`) });
    });
  }
  return downloadRequests;
}

test("Standard Ebooks : recherche, couverture, EPUB direct, bibliothèque et reprise sans second téléchargement", async ({ page }) => {
  const downloads = await standardRoutes(page, { downloadable: true });
  await page.goto("/#search?q=pride&language=en&provider=standard-ebooks&page=1");
  const card = page.locator('.catalog-grid .book-card[data-provider="standard-ebooks"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Jane Austen");
  await expect(card.locator(`img[src="${COVER}"]`)).toBeVisible();
  await expect(card.locator(`a[href="${DETAIL}"]`)).toContainText("Standard Ebooks");
  await card.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Pride and Prejudice");
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(downloads).toEqual([DOWNLOAD, `${DOWNLOAD}?source=download`]);
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].source).toMatchObject({ providerId: "standard-ebooks", bookId: "standardebooks-jane-austen_pride-and-prejudice", url: DETAIL });
  expect(books[0].chapters).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".reader-title strong")).toHaveText("Pride and Prejudice");
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  await page.locator(".library-section .book-card").getByRole("button", { name: "Lire Pride and Prejudice", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(downloads).toHaveLength(2);
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});

test("Ebooks libres et gratuits : une édition EPUB ouvre le texte original et reste dans la bibliothèque", async ({ page }) => {
  const original = await readFile(new URL("../../public/books/candide.epub", import.meta.url));
  let downloads = 0;
  await page.route("**/api/sources/ebooks-gratuits/search?*", (route) => route.fulfill({ contentType: "application/atom+xml", body: frenchFeed() }));
  await page.route("**/api/books/ebooks-gratuits/23.epub", (route) => {
    downloads += 1;
    return route.fulfill({ contentType: "application/epub+zip", body: original });
  });
  await page.goto("/#search?q=candide&language=fr&provider=ebooks-gratuits&page=1");
  const card = page.locator('.catalog-grid .book-card[data-provider="ebooks-gratuits"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Voltaire");
  await expect(card.locator('a[href="https://www.ebooksgratuits.com/details.php?book=23"]')).toContainText("Ebooks libres et gratuits");
  await card.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Candide, ou l'optimisme");
  await expect(page.locator("#rsvp")).toBeVisible();
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].source).toMatchObject({ providerId: "ebooks-gratuits", canExportFocus: false, canExportClassic: false });
  const savedBytes = await page.evaluate((id) => new Promise((resolve, reject) => {
    const open = indexedDB.open("fastreader");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("books").objectStore("books").get(id);
      request.onsuccess = () => { db.close(); resolve(request.result.original.byteLength); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), books[0].id);
  expect(savedBytes).toBe(original.length);
  await page.reload();
  await expect(page.locator(".reader-title strong")).toHaveText("Candide, ou l'optimisme");
  expect(downloads).toBe(1);
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
});

test("un catalogue français lent laisse déjà ouvrir un résultat pendant ses trois secondes de recherche", async ({ page }) => {
  await standardRoutes(page);
  let frenchFinished = false;
  await page.route("**/api/sources/ebooks-gratuits/search?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    frenchFinished = true;
    await route.fulfill({ contentType: "application/atom+xml", body: frenchFeed() }).catch(() => {});
  });
  await page.goto("/#search?q=horla&language=&provider=all&page=1");
  await expect(page.locator('.book-card[data-provider="standard-ebooks"]')).toHaveCount(1, { timeout: 2000 });
  await expect(results(page)).toHaveAttribute("aria-busy", "true");
  expect(frenchFinished).toBe(false);
  await page.locator('.book-open[data-id="selection-le-horla"]').click();
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect.poll(() => frenchFinished).toBe(true);
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await expect(page).toHaveURL(/#read=/u);
});

test("une erreur d’une source conserve les autres résultats et une recherche utilisable", async ({ page }) => {
  await standardRoutes(page);
  await page.route("**/api/sources/ebooks-gratuits/search?*", (route) => route.fulfill({ status: 503, body: "Temporarily unavailable" }));
  await page.goto("/#search?q=horla&language=&provider=all&page=1");
  await expect(results(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('.book-card[data-provider="standard-ebooks"]')).toHaveCount(1);
  await expect(page.locator('.book-open[data-id="selection-le-horla"]')).toBeVisible();
  await expect(page.locator(".source-warning")).toContainText("503");
  await page.getByRole("searchbox", { name: "Titre ou auteur", exact: true }).fill("hugo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(results(page)).toHaveAttribute("data-query", "hugo");
  await expect(results(page)).toHaveAttribute("aria-busy", "false");
  expect(await page.locator('.catalog-grid .book-card[data-provider="gutenberg"]').count()).toBeGreaterThan(0);
});

test("un ancien résultat distant ne remplace pas une nouvelle recherche", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let delayedRequest = false;
  await page.route("**/api/sources/ebooks-gratuits/search?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("query") === "ancien") {
      delayedRequest = true;
      await gate;
      await route.fulfill({ contentType: "application/atom+xml", body: frenchFeed("Ancien résultat", 25) }).catch(() => {});
    } else {
      await route.fulfill({ contentType: "application/atom+xml", body: frenchFeed() });
    }
  });
  try {
    await page.goto("/#search?q=ancien&language=fr&provider=all&page=1");
    await expect.poll(() => delayedRequest).toBe(true);
    await page.getByRole("searchbox", { name: "Titre ou auteur", exact: true }).fill("candide");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(results(page)).toHaveAttribute("data-query", "candide");
    await expect(results(page)).toHaveAttribute("aria-busy", "false");
    release();
    await expect(page.locator('.book-open[data-id="ebooks-gratuits-23"]')).toBeVisible();
    await expect(page.locator('.book-open[data-id="ebooks-gratuits-25"]')).toHaveCount(0);
  } finally { release(); }
});

for (const target of [
  { name: "le livre déjà choisi", selector: '.book-open[data-id="selection-le-horla"]', opensBook: true },
  { name: "le filtre de source", selector: '.source-tabs [data-provider="ebooks-gratuits"]', opensBook: false },
]) {
  test(`un résultat tardif conserve le focus sur ${target.name} et le défilement horizontal des filtres`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let requested = false;
    await page.route("**/api/sources/ebooks-gratuits/search?*", async (route) => {
      requested = true;
      await pending;
      await route.fulfill({ contentType: "application/atom+xml", body: frenchFeed() }).catch(() => {});
    });
    try {
      await page.goto("/#search?q=maupassant&language=fr&provider=all&page=1");
      await expect.poll(() => requested).toBe(true);
      // Gutenberg has finished; only the controlled French source is still pending.
      await expect.poll(() => page.locator('.catalog-grid [data-provider="gutenberg"]').count()).toBeGreaterThan(0);
      await expect(results(page)).toHaveAttribute("aria-busy", "true");
      const control = page.locator(target.selector);
      await control.focus();
      await expect(control).toBeFocused();
      const filters = page.locator(".source-tabs");
      const previousScroll = await filters.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        return element.scrollLeft;
      });
      expect(previousScroll).toBeGreaterThan(0);
      release();
      await expect(results(page)).toHaveAttribute("aria-busy", "false");
      await expect(page.locator('.book-open[data-id="ebooks-gratuits-23"]')).toBeVisible();
      await expect(control).toBeFocused();
      await expect.poll(() => filters.evaluate((element) => element.scrollLeft)).toBe(previousScroll);
      // Enter still activates the original choice after its DOM node was replaced.
      await page.keyboard.press("Enter");
      if (target.opensBook) {
        await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
      } else {
        await expect(page).toHaveURL(/provider=ebooks-gratuits/u);
        await expect(results(page)).toHaveAttribute("aria-busy", "false");
      }
    } finally { release(); }
  });
}
