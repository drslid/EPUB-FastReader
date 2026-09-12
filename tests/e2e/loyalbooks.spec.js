import { expect, test } from "./fixtures.js";
import { makeEpub, storedRows } from "./helpers/fixtures.js";
import { installGoogleSearchFixture } from "./helpers/google-search.js";

test.use({ serviceWorkers: "block" });
const slug = "emma-by-jane-austen";
const bookUrl = `https://www.loyalbooks.com/book/${slug}`;
const imageUrl = "https://www.loyalbooks.com/image/detail/Emma-by-Jane-Austen.jpg";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=", "base64");
// Actual observed book identities, served as simulated responses only.
const searchResults = {
  emma: [
    { title: "Emma by Jane Austen - Free at Loyal Books", url: bookUrl },
    { title: "Emma Dorothy Eliza Nevitte Southworth", url: "http://www.loyalbooks.com/author?author=Emma+Dorothy+Eliza+Nevitte+Southworth" },
    { title: "Emma audio feed", url: `${bookUrl}/feed` },
    { title: "English — Featured free audio books", url: "https://www.loyalbooks.com/language/English" },
  ],
  candide: [
    { title: "Candide ou L'optimisme by Voltaire - French - Free at Loyal Books", url: "https://www.loyalbooks.com/book/candide-by-voltaire-2" },
    { title: "Candide by Voltaire - Free at Loyal Books", url: "http://www.loyalbooks.com/book/candide-by-voltaire" },
    { title: "French — Featured free audio books", url: "https://www.loyalbooks.com/language/French" },
  ],
};
const book = {
  id: `loyalbooks-${slug}`, canonicalSourceId: `loyalbooks:${slug}`, providerId: "loyalbooks",
  title: "Emma", author: "Jane Austen", language: "en", cover: imageUrl,
  source: "Loyal Books", sourceUrl: bookUrl, downloadMode: "direct",
};

async function fixtures(page, { coverStatus = 200, downloadStatus = 200, detailStatus = 200, holdDetail = false, manualGoogle = false, invalidDetail = false } = {}) {
  const archive = await makeEpub({ title: "Emma", author: "Jane Austen", language: "en", paragraphs: ["Emma opened a book and read its first chapter. This test edition remains available on this device after reading."] });
  const counts = { details: 0, downloads: 0, covers: 0, snapshots: 0 };
  let releaseDetail;
  const detailReady = holdDetail ? new Promise((resolve) => { releaseDetail = resolve; }) : Promise.resolve();
  const google = await installGoogleSearchFixture(page, { resultsByQuery: searchResults, manual: manualGoogle });
  await page.route("**/catalog/loyalbooks.json", (route) => { counts.snapshots++; return route.abort(); });
  await page.route(imageUrl, (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.route(`**/api/sources/loyalbooks/detail/${slug}`, async (route) => {
    counts.details++;
    await detailReady;
    await route.fulfill({ status: detailStatus, contentType: "application/json", body: JSON.stringify(detailStatus === 200 ? (invalidDetail ? { ...book, sourceUrl: "https://evil.example/book/emma" } : book) : { error: { code: "SOURCE_UNAVAILABLE", message: "Loyal Books est temporairement indisponible." } }) }).catch(() => {});
  });
  await page.route(`**/api/books/loyalbooks/${slug}.epub`, (route) => {
    counts.downloads++;
    return route.fulfill({ status: downloadStatus, contentType: downloadStatus === 200 ? "application/epub+zip" : "text/plain", body: downloadStatus === 200 ? archive : "Source unavailable" });
  });
  await page.route(`**/api/sources/loyalbooks/cover/${slug}.jpg`, (route) => {
    counts.covers++;
    return route.fulfill({ status: coverStatus, contentType: coverStatus === 200 ? "image/png" : "text/plain", body: coverStatus === 200 ? png : "Cover unavailable" });
  });
  return { counts, google, releaseDetail: () => releaseDetail?.() };
}

const readEmma = (page) => page.locator(`[data-loyalbook-read="${slug}"]`);
const googleState = (page) => page.evaluate(() => {
  const state = window.__googleSearchFixture;
  return state ? { renders: state.renders, queries: state.queries, completed: state.completed } : null;
});
async function open(page) {
  await page.goto("/#search?q=Emma&language=en&provider=loyalbooks&page=1");
  await expect(readEmma(page)).toBeVisible();
}
const libraryLink = (page) => page.getByRole("link", { name: /Ma bibliothèque/u }).first();

test("Google ne charge ni à l’accueil, ni dans Tous, ni dans la bibliothèque", async ({ page }) => {
  const { counts, google } = await fixtures(page);
  for (const route of ["/#home", "/#search?q=Emma&language=en&provider=all&page=1", "/#library"]) {
    await page.goto(route);
    await expect(page.locator(".app-shell")).toBeVisible();
    if (route.includes("provider=all")) await expect(page.locator('section[aria-label="Résultats de recherche"]')).toHaveAttribute("aria-busy", "false");
    expect(await googleState(page)).toBeNull();
    expect(google.sdkRequests).toBe(0);
  }
  expect(counts).toEqual({ details: 0, downloads: 0, covers: 0, snapshots: 0 });
});

test("Loyal Books conserve résultats anglais, annonces, attribution et liens avec une seule barre", async ({ page }) => {
  const { counts, google } = await fixtures(page);
  await page.goto("/#search?q=Emma&language=en&provider=all&page=1");
  await page.getByRole("button", { name: "Loyal Books", exact: true }).click();
  await expect(readEmma(page)).toBeVisible();
  await expect(page.locator('input[type="search"]')).toHaveCount(1);
  await expect(page.locator("#search-language")).toHaveCount(0);
  await expect(page.locator(".loyal-search-intro")).toContainText("toutes les langues");
  await expect(page.locator(".source-privacy")).toContainText("Google");
  await expect(page.locator(".gsc-result")).toHaveCount(4);
  await expect(page.locator("[data-loyalbook-read]")).toHaveCount(1);
  await expect(page.locator("[data-google-advertisement]")).toBeVisible();
  await expect(page.getByRole("link", { name: "Enhanced by Google", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Page Google 2", exact: true })).toBeVisible();
  const original = page.locator(".gsc-result a.gs-title").first();
  await expect(original).toHaveAttribute("href", bookUrl);
  await expect(original).toHaveAttribute("target", "_blank");
  await expect(original).toHaveAttribute("rel", "noopener");
  const { renders, queries } = await googleState(page);
  expect(renders).toHaveLength(1);
  expect(renders[0].tag).toBe("searchresults-only");
  expect(queries).toEqual(["Emma"]);
  expect(google.sdkRequests).toBe(1);
  expect(counts).toEqual({ details: 0, downloads: 0, covers: 0, snapshots: 0 });
});

test("une recherche suivante garde Loyal Books et le DOM Google connecté", async ({ page }) => {
  await fixtures(page);
  await open(page);
  await page.evaluate(() => {
    window.__originalGoogleRoot = document.querySelector(".gsc-control-cse");
    window.__originalGoogleAd = document.querySelector("[data-google-advertisement]");
  });
  await page.getByRole("searchbox", { name: "Titre ou auteur", exact: true }).fill("Candide");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page).toHaveURL(/provider=loyalbooks/u);
  await expect(page.locator(".gsc-result")).toHaveCount(3);
  await expect(page.locator('[data-loyalbook-read="candide-by-voltaire"]')).toBeVisible();
  expect(await page.evaluate(() => window.__originalGoogleRoot === document.querySelector(".gsc-control-cse") && window.__originalGoogleAd === document.querySelector("[data-google-advertisement]") && window.__originalGoogleRoot.isConnected)).toBe(true);
  expect((await googleState(page)).queries).toEqual(["Emma", "Candide"]);
  expect((await googleState(page)).renders).toHaveLength(1);
});

test("Lire importe l’EPUB et conserve couverture et reprise hors ligne sans second téléchargement", async ({ page, context }) => {
  const { counts } = await fixtures(page);
  await open(page);
  await readEmma(page).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Emma");
  await expect(page.locator("#rsvp")).toBeVisible();
  const [saved] = await storedRows(page, "books");
  expect(saved.author).toBe("Jane Austen");
  expect(saved.source).toMatchObject({ providerId: "loyalbooks", canonicalSourceId: `loyalbooks:${slug}`, url: bookUrl });
  expect(saved.source.presentation.remoteImage).toBe(imageUrl);
  expect(saved.source.presentation.image).toMatch(/^data:image\/png;base64,/u);
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await page.reload();
  await expect(page.locator(".library-section .cover img")).toHaveAttribute("src", saved.source.presentation.image);
  await open(page);
  await readEmma(page).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(counts).toEqual({ details: 1, downloads: 1, covers: 1, snapshots: 0 });
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await context.setOffline(true);
  await page.locator(".library-section").getByRole("button", { name: "Lire Emma", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(counts.downloads).toBe(1);
});

test("le chargement d’une édition conserve le widget sans autre recherche", async ({ page }) => {
  const { counts, releaseDetail } = await fixtures(page, { holdDetail: true });
  await open(page);
  await page.evaluate(() => { window.__originalGoogleRoot = document.querySelector(".gsc-control-cse"); });
  await readEmma(page).click();
  try {
    await expect.poll(() => counts.details).toBe(1);
    await expect(readEmma(page)).toBeDisabled();
    expect(await page.evaluate(() => window.__originalGoogleRoot === document.querySelector(".gsc-control-cse") && window.__originalGoogleRoot.isConnected)).toBe(true);
    expect((await googleState(page)).queries).toEqual(["Emma"]);
  } finally { releaseDetail(); }
  await expect(page.locator("#rsvp")).toBeVisible();
});

test("quitter Loyal Books ignore les réponses Google tardives", async ({ page }) => {
  const { counts } = await fixtures(page, { manualGoogle: true });
  await page.goto("/#search?q=Emma&language=&provider=loyalbooks&page=1");
  await expect.poll(async () => (await googleState(page))?.queries).toEqual(["Emma"]);
  await libraryLink(page).click();
  await expect(page.locator(".library-intro")).toBeVisible();
  await page.evaluate(() => window.__googleSearchFixture.flush());
  await expect(page.locator("#loyal-search-host")).toHaveCount(0);
  await expect(page.locator("[data-loyalbook-read]")).toHaveCount(0);
  expect(await storedRows(page, "books")).toHaveLength(0);
  expect(counts.details).toBe(0);
});

test("quitter Loyal Books annule la résolution sans importer un livre tardif", async ({ page }) => {
  const { counts, releaseDetail } = await fixtures(page, { holdDetail: true });
  await open(page);
  await readEmma(page).click();
  try {
    await expect.poll(() => counts.details).toBe(1);
    await libraryLink(page).click();
    await expect(page.locator(".library-intro")).toBeVisible();
  } finally { releaseDetail(); }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await storedRows(page, "books")).toHaveLength(0);
  expect(counts.downloads).toBe(0);
  await expect(page.locator("#rsvp")).toHaveCount(0);
});

test("une couverture indisponible ne bloque pas l’EPUB", async ({ page }) => {
  await fixtures(page, { coverStatus: 503 });
  await open(page);
  await readEmma(page).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(await storedRows(page, "books")).toHaveLength(1);
});

for (const failure of ["detail", "invalidDetail", "epub"]) {
  test(`une erreur ${failure} ne crée pas de livre fictif`, async ({ page }) => {
    const { counts } = await fixtures(page, { detailStatus: failure === "detail" ? 503 : 200, invalidDetail: failure === "invalidDetail", downloadStatus: failure === "epub" ? 503 : 200 });
    await open(page);
    await readEmma(page).click();
    if (failure === "epub") await expect(page.locator(".fallback-dialog")).toBeVisible();
    else {
      await expect(page.locator("#toast")).toBeVisible();
      await expect(readEmma(page)).toBeEnabled();
      expect(counts.downloads).toBe(0);
    }
    expect(await storedRows(page, "books")).toHaveLength(0);
    await expect(page.locator("#rsvp")).toHaveCount(0);
  });
}
