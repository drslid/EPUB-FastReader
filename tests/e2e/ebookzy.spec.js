import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { createAppServer } from "../../server/app.js";
import { makeEpub, storedRows } from "./helpers/fixtures.js";

const TITLE = "Macbeth: The Tragedy of the Scottish King, a Complete Edition of William Shakespeare’s Play";
const COVER = "https://ebookzy.com/wp-content/uploads/2025/10/macbeth-by-william-shakespeare.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");
const html = `<h1 class="page-title">Search results for: Shakespeare</h1><main id="content"><article class="bloglo-article"><div class="entry-media"><img src="${COVER}"></div><h4 class="entry-title"><a href="https://ebookzy.com/macbeth/">${TITLE}</a></h4><div class="cat-links"><a href="/author/william-shakespeare/">William Shakespeare</a></div></article></main>`;

const fixtureEpub = () => makeEpub({ title: TITLE, author: "William Shakespeare", language: "en", paragraphs: ["When shall we three meet again? In thunder, lightning, or in rain? This edition remains available in the reader’s library."] });

async function fixtures(page, { coverStatus = 200, bookStatus = 200 } = {}) {
  const bytes = await fixtureEpub();
  const counts = { downloads: 0, covers: 0 };
  await page.route("**/api/sources/ebookzy/search?*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.route(COVER, (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.route("**/api/books/ebookzy/macbeth.epub", (route) => {
    counts.downloads++;
    return route.fulfill({ status: bookStatus, contentType: bookStatus === 200 ? "application/epub+zip" : "text/plain", body: bookStatus === 200 ? bytes : "Unavailable" });
  });
  await page.route("**/api/sources/ebookzy/cover/macbeth.png", (route) => {
    counts.covers++;
    return route.fulfill({ status: coverStatus, contentType: coverStatus === 200 ? "image/png" : "text/plain", body: coverStatus === 200 ? png : "Unavailable" });
  });
  return { bytes, counts };
}

async function result(page, base = "/") {
  await page.goto(`${base}#search?q=Shakespeare&language=en&provider=ebookzy&page=1`);
  const card = page.locator('.catalog-grid .book-card[data-provider="ebookzy"]');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("heading", { name: TITLE, exact: true })).toBeVisible();
  await expect(card).toContainText("William Shakespeare");
  await expect(card.locator(`img[src="${COVER}"]`)).toBeVisible();
  await expect(card.locator('a[href="https://ebookzy.com/macbeth/"]')).toContainText("Ebookzy");
  return card;
}

test("Ebookzy : couverture et titre complet, EPUB local, rechargement hors ligne et téléchargement Classique", async ({ page }, testInfo) => {
  // A private production server can be stopped without WebKit's offline
  // emulation blocking a service-worker navigation before it reaches the cache.
  // Mock upstream at that server too: WebKit can send controlled requests past
  // page.route(), so browser interception alone must never reach a real source.
  const bytes = await fixtureEpub();
  const counts = { downloads: 0, covers: 0 };
  const unexpected = [];
  const denied = { fetchImpl: async (url) => { unexpected.push(String(url)); throw new Error("No upstream network is allowed in this test."); } };
  let upstreamCalls = 0;
  const fetchImpl = async (url, options) => {
    options.signal?.throwIfAborted();
    const target = String(url);
    if (++upstreamCalls > 8 || options.method !== "GET") return denied.fetchImpl(target);
    if (target === "https://ebookzy.com/?s=Shakespeare") return new Response(`<form><input name="s"></form>${html}`, { headers: { "Content-Type": "text/html" } });
    if (target === "https://ebookzy.com/macbeth/") return new Response(`<h1>${TITLE}</h1><img class="wp-post-image" src="${COVER}"><a href="/free-ebooks/macbeth.epub">EPUB</a>`, { headers: { "Content-Type": "text/html" } });
    if (target === "https://ebookzy.com/free-ebooks/macbeth.epub") {
      counts.downloads++;
      return new Response(bytes, { headers: { "Content-Type": "application/epub+zip" } });
    }
    if (target === COVER) {
      counts.covers++;
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    }
    return denied.fetchImpl(target);
  };
  const server = createAppServer({
    ebookzyOptions: { fetchImpl },
    relayOptions: denied, ebooksGratuitsOptions: denied, fadedpageOptions: denied,
    epubbooksOptions: denied, atramentaOptions: denied, loyalbooksOptions: denied,
    sourceStatusOptions: denied,
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const stop = async () => {
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
  try {
    // Let the app's own API reach its isolated server in every browser. The
    // catalogue illustration is still a browser-only, in-memory fixture.
    await page.route(/\/api\/(?:sources\/ebookzy\/|books\/ebookzy\/)/u, (route) => route.continue());
    await page.route(COVER, (route) => route.fulfill({ contentType: "image/png", body: png }));
    await page.setViewportSize({ width: 320, height: 740 });
    const card = await result(page, base);
    expect(counts).toEqual({ downloads: 0, covers: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.getByRole("button", { name: "Lire", exact: true }).click();
    await expect(page.locator(".reader-title strong")).toHaveText(TITLE);
    await expect(page.locator("#rsvp")).toBeVisible();
    const [book] = await storedRows(page, "books");
    expect(book.source).toMatchObject({ providerId: "ebookzy", canonicalSourceId: "ebookzy:macbeth", canExportClassic: false });
    expect(book.source.presentation.remoteImage).toBe(COVER);
    expect(book.source.presentation.image).toMatch(/^data:image\/png;base64,/u);
    expect(counts).toEqual({ downloads: 1, covers: 1 });
    expect(unexpected).toEqual([]);
    await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
    const cover = page.locator(".library-section .book-card .cover img");
    await expect(cover).toHaveAttribute("src", book.source.presentation.image);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await stop();
    expect(await page.evaluate(async () => { try { await fetch("./uncached-network-probe"); return false; } catch { return true; } })).toBe(true);
    await page.reload();
    await expect(cover).toHaveAttribute("src", book.source.presentation.image);
    await page.locator(".library-section").getByRole("button", { name: `Lire ${TITLE}`, exact: true }).click();
    await expect(page.locator("#rsvp")).toBeVisible();
    await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Télécharger en Classique : ${TITLE}`, exact: true }).click();
    const download = await pending;
    const filename = testInfo.outputPath("ebookzy-classic.epub");
    await download.saveAs(filename);
    // This provider retains the original edition and its rights notice.
    expect(await readFile(filename)).toEqual(bytes);
    expect(counts).toEqual({ downloads: 1, covers: 1 });
    expect(unexpected).toEqual([]);
    await expect(page.locator(".fallback-dialog")).toHaveCount(0);
  } finally { await stop(); }
});

test.describe("Ebookzy failures", () => {
  test.use({ serviceWorkers: "block" });
  test("une couverture indisponible ne bloque pas la lecture", async ({ page }) => {
    await fixtures(page, { coverStatus: 503 });
    await (await result(page)).getByRole("button", { name: "Lire", exact: true }).click();
    await expect(page.locator("#rsvp")).toBeVisible();
    expect(await storedRows(page, "books")).toHaveLength(1);
  });
  test("un téléchargement refusé ne crée aucun livre fictif", async ({ page }) => {
    await fixtures(page, { bookStatus: 503 });
    await (await result(page)).getByRole("button", { name: "Lire", exact: true }).click();
    await expect(page.locator(".fallback-dialog")).toBeVisible();
    expect(await storedRows(page, "books")).toHaveLength(0);
  });
});
