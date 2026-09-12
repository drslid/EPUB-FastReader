// End-to-end acceptance check for the static GitHub Pages build, without an API.
// By default serve dist-pages under the real project subpath. Set an HTTPS
// FASTREADER_PAGES_URL to check the published site in an isolated browser profile.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import JSZip from "jszip";
import { languageUrl, SEO_LANGUAGES } from "../src/seo-data.js";

const projectPath = "/EPUB-FastReader/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".epub": "application/epub+zip",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

async function staticServer() {
  const directory = await realpath(fileURLToPath(new URL("../dist-pages/", import.meta.url)));
  await readFile(path.join(directory, "index.html"));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!["GET", "HEAD"].includes(request.method) || !pathname.startsWith(projectPath)) {
        response.writeHead(404).end();
        return;
      }
      const relative = pathname.slice(projectPath.length) || "index.html";
      const filename = await realpath(path.resolve(directory, relative));
      if (!filename.startsWith(`${directory}${path.sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const content = await readFile(filename);
      response.writeHead(200, {
        "Content-Type": types[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "Vary": "Origin",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      // Deliberately no SPA fallback and no Gutenberg relay.
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: new URL(`http://127.0.0.1:${server.address().port}${projectPath}`),
    stop: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}

function publishedURL(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", "A published Pages check requires HTTPS.");
  assert.equal(url.username + url.password, "", "Do not embed credentials in the Pages URL.");
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

async function fetchAsset(baseURL, relative, expectedType) {
  const url = new URL(relative, baseURL);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${url.pathname} must be a real static file.`);
  if (expectedType) assert.match(response.headers.get("content-type") || "", expectedType);
  return Buffer.from(await response.arrayBuffer());
}

async function libraryState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open("fastreader");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(["books", "positions", "preferences"], "readonly");
      const books = tx.objectStore("books").getAll();
      const positions = tx.objectStore("positions").getAll();
      const preferences = tx.objectStore("preferences").getAll();
      tx.oncomplete = () => {
        db.close();
        resolve({
          books: books.result.map((book) => ({
            id: book.id,
            title: book.title,
            source: book.source,
            bytes: book.original?.byteLength || 0,
          })),
          positions: positions.result,
          preferences: preferences.result,
        });
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function coverAppearance(cover) {
  return cover.evaluate((element) => ({
    palette: [...element.classList].find((name) => /^cover-\d+$/.test(name)),
    title: element.querySelector(".cover-title")?.textContent,
    author: element.querySelector(".cover-author")?.textContent,
    image: element.querySelector("img")?.getAttribute("src") || null,
  }));
}

async function search(page, query, language = "fr") {
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill(query);
  await page.getByLabel("Langue du livre", { exact: true }).selectOption(language);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  const results = page.locator('section[aria-label="Résultats de recherche"]');
  await expect(results).toHaveAttribute("data-query", query);
  await expect(results).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
}

async function returnToLibrary(page) {
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ma bibliothèque", exact: true })).toBeVisible();
}

async function scrollDown(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
}

const server = process.env.FASTREADER_PAGES_URL ? null : await staticServer();
const baseURL = server?.url || publishedURL(process.env.FASTREADER_PAGES_URL);
let browser;
let context;
const completed = [];
function passed(name) {
  completed.push(name);
  console.log(`✓ ${name}`);
}

try {
  const provenance = JSON.parse(await fetchAsset(baseURL, "books/provenance.json", /json/));
  assert.equal(provenance.books.length, 9);
  const verified = await Promise.all(provenance.books.map(async (book) => {
    const buffer = await fetchAsset(baseURL, `books/${book.file}`, /application\/epub\+zip/);
    assert.equal(buffer.byteLength, book.bytes, book.file);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), book.sha256, book.file);
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    assert.equal(await zip.file("mimetype")?.async("string"), "application/epub+zip");
    assert.ok(zip.file("META-INF/container.xml"));
    return [book.file, buffer];
  }));
  const originals = new Map(verified);
  const manifest = JSON.parse(await fetchAsset(baseURL, "manifest.webmanifest", /json/));
  assert.equal(new URL(manifest.scope, baseURL).pathname, baseURL.pathname);
  assert.equal(new URL(manifest.start_url, baseURL).pathname, baseURL.pathname);
  await Promise.all(manifest.icons.map((icon) => fetchAsset(baseURL, icon.src, /image\//)));
  await Promise.all(["fr", "gb", "es", "it", "de", "pt"].map((code) => fetchAsset(baseURL, `flags/${code}.svg`, /image\/svg\+xml/)));
  const serviceWorker = (await fetchAsset(baseURL, "sw.js", /javascript/)).toString();
  assert.doesNotMatch(serviceWorker, /__BUILD_VERSION__|__PRECACHE_MANIFEST__/);
  passed("Static subpath, manifest, icons and nine original EPUB archives");

  browser = await chromium.launch();
  const seoContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const seoPage = await seoContext.newPage();
    for (const [language, copy] of Object.entries(SEO_LANGUAGES)) {
      const response = await seoPage.goto(new URL(language === "fr" ? "./" : copy.file, baseURL).href);
      assert.equal(response.status(), 200);
      await expect(seoPage.locator("html")).toHaveAttribute("lang", language);
      await expect(seoPage).toHaveTitle(copy.title);
      await expect(seoPage.getByRole("heading", { level: 1 })).toHaveText(copy.heading);
      await expect(seoPage.locator('meta[name="description"]')).toHaveAttribute("content", copy.description);
      await expect(seoPage.locator('link[rel="canonical"]')).toHaveAttribute("href", languageUrl(language));
      await expect(seoPage.locator('head link[rel="alternate"]')).toHaveCount(7);
      await expect(seoPage.locator("#app nav a")).toHaveCount(6);
      const localizedManifest = JSON.parse(await fetchAsset(baseURL, language === "fr" ? "manifest.webmanifest" : `manifest-${language}.webmanifest`, /json/));
      assert.equal(localizedManifest.lang, language);
      assert.equal(new URL(localizedManifest.scope, baseURL).pathname, baseURL.pathname);
      assert.equal(new URL(localizedManifest.id, baseURL).pathname, baseURL.pathname);
      assert.equal(new URL(localizedManifest.start_url, baseURL).pathname, new URL(language === "fr" ? "./" : copy.file, baseURL).pathname);
    }
    const sitemap = (await fetchAsset(baseURL, "sitemap.xml", /xml/)).toString();
    assert.equal((sitemap.match(/<loc>/g) || []).length, 6);
    for (const language of Object.keys(SEO_LANGUAGES)) assert.ok(sitemap.includes(`<loc>${languageUrl(language)}</loc>`));
    assert.doesNotMatch(sitemap, /#|library|reader|import|book=|search=/);
    passed("Six translated static landing pages, canonical URLs, language links and public sitemap");
  } finally {
    await seoContext.close();
  }
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const scriptErrors = [];
  const httpErrors = [];
  const apiRequests = [];
  const epubRequests = [];
  page.on("pageerror", (error) => scriptErrors.push(error.message));
  context.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });
  context.on("request", (request) => {
    if (/\/api\//.test(new URL(request.url()).pathname)) apiRequests.push(request.url());
  });
  page.on("request", (request) => {
    if (/\.epub$/.test(new URL(request.url()).pathname)) epubRequests.push(request.url());
  });

  await page.goto(baseURL.href);
  await expect(page.locator(".home-intro")).toBeVisible();
  await expect(page.locator(".suggestion-card")).toHaveCount(3);
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: /Ma bibliothèque/ }).click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(0);
  await expect(page.locator(".suggestions-section, [data-action=demo]")).toHaveCount(0);
  await page.goto(`${baseURL}#discover`);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await expect(page.locator(".catalog-grid .book-card")).toHaveCount(9);
  await expect(page.locator(".catalog-grid .cover")).toHaveCount(9);
  assert.equal((await libraryState(page)).books.length, 0);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });
  const offlineCache = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const prefix = `fastreader:${new URL(registration.scope).pathname}:`;
    const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
    const files = (await Promise.all(names.map(async (name) => (await caches.open(name)).keys())))
      .flat().map((request) => request.url);
    return { scope: registration.scope, names, files };
  });
  assert.equal(offlineCache.scope, baseURL.href);
  assert.equal(offlineCache.names.length, 1);
  assert.ok(offlineCache.files.every((file) => file.startsWith(baseURL.href)));
  for (const [language, copy] of Object.entries(SEO_LANGUAGES)) {
    assert.ok(offlineCache.files.includes(new URL(copy.file, baseURL).href));
    assert.ok(offlineCache.files.includes(new URL(language === "fr" ? "manifest.webmanifest" : `manifest-${language}.webmanifest`, baseURL).href));
  }
  for (const book of provenance.books) {
    assert.ok(offlineCache.files.includes(new URL(`books/${book.file}`, baseURL).href));
  }
  assert.ok(offlineCache.files.some((file) => /\/assets\/[^/]+\.js$/.test(file)));
  assert.ok(offlineCache.files.some((file) => /\/assets\/[^/]+\.css$/.test(file)));
  assert.ok(offlineCache.files.some((file) => /\/catalog\/fr-[^/]+\.json$/.test(file)));
  passed("Dark defaults, nine covers and complete offline installation within the project scope");

  const horla = page.locator('.catalog-grid .book-open[data-id="selection-le-horla"]');
  const expectedCover = await coverAppearance(horla.locator(".cover"));
  await horla.click();
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#chapter-content")).toContainText("Quelle journée admirable");
  await page.getByRole("button", { name: "Avancer de dix mots", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  const savedWord = await page.locator("#rsvp-word").textContent();
  const savedCount = await page.locator("#rsvp-count").textContent();
  await returnToLibrary(page);
  let state = await libraryState(page);
  assert.equal(state.books.length, 1);
  assert.equal(state.books[0].bytes, originals.get("le-horla.epub").byteLength);
  assert.equal(state.books[0].source.canonicalSourceId, "gutenberg:10775");
  const horlaId = state.books[0].id;
  assert.equal(state.positions.find((position) => position.id === horlaId).bookmarks.length, 1);
  assert.deepEqual(await coverAppearance(page.locator(".library-section .book-card .cover")), expectedCover);
  passed("One-click Horla reading, original EPUB storage, identical cover and saved bookmark");

  await search(page, "maupassant");
  const savedCard = page.locator(`.local-results .book-open[data-id="${horlaId}"]`);
  await expect(savedCard).toBeVisible();
  await expect(page.locator('.catalog-grid [data-id="selection-le-horla"], .catalog-grid [data-id="gutenberg-10775"]')).toHaveCount(0);
  assert.ok(await page.locator(".catalog-grid .book-card").count() > 0);
  assert.equal(await page.evaluate(() => Boolean(
    document.querySelector(".local-results").compareDocumentPosition(document.querySelector(".catalog-grid"))
      & Node.DOCUMENT_POSITION_FOLLOWING,
  )), true);
  assert.deepEqual(await coverAppearance(savedCard.locator(".cover")), expectedCover);
  const requestsBeforeResume = epubRequests.length;
  await savedCard.click();
  await expect(page.locator("#rsvp-word")).toHaveText(savedWord);
  await expect(page.locator("#rsvp-count")).toHaveText(savedCount);
  assert.equal(epubRequests.length, requestsBeforeResume);
  await returnToLibrary(page);
  passed("Unified search puts saved editions first and resumes without another EPUB request");

  await search(page, "germinal");
  const germinal = page.locator('.catalog-grid .book-card[data-provider="gutenberg"]').filter({
    has: page.locator('.book-open[data-id="gutenberg-5711"]'),
  });
  await expect(germinal.locator(".cover")).toBeVisible();
  await expect(germinal.getByRole("button", { name: /Obtenir l’EPUB :/ })).toBeVisible();
  await expect(germinal.getByRole("button", { name: "Lire", exact: true })).toBeVisible();
  await expect(germinal).not.toContainText("EPUB à télécharger puis importer");
  await expect(germinal).not.toContainText("Lecture en un clic");
  await germinal.locator(".book-open").click();
  const dialog = page.locator(".fallback-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/télécharge/i);
  await expect(dialog).toContainText(/import/i);
  await expect(dialog.getByRole("button", { name: "Réessayer", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Télécharger sur Gutenberg" })).toHaveAttribute("href", "https://www.gutenberg.org/ebooks/5711");
  assert.equal((await libraryState(page)).books.length, 1);
  assert.deepEqual(apiRequests, []);
  const chooserPending = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Importer mon EPUB", exact: true }).click();
  const chooser = await chooserPending;
  await chooser.setFiles({
    name: "candide.epub",
    mimeType: "application/epub+zip",
    buffer: originals.get("candide.epub"),
  });
  await expect(page.locator(".reader-title strong")).toContainText(/Candide/i);
  await expect(page.locator("#rsvp")).toBeVisible();
  for (const mode of ["Classique", "Focus", "Mot à mot"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await returnToLibrary(page);
  state = await libraryState(page);
  assert.equal(state.books.length, 2);
  assert.ok(state.books.some((book) => /Candide/i.test(book.title) && book.bytes === originals.get("candide.epub").byteLength));
  assert.ok(state.books.every((book) => book.source?.canonicalSourceId !== "gutenberg:5711"));
  passed("Gutenberg manual access requests no API; actual EPUB import and all three reading modes work");

  await page.setViewportSize({ width: 320, height: 640 });
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await navigation.getByRole("link", { name: "Découvrir", exact: true }).click();
  await expect(page.locator(".catalog-grid .book-card")).toHaveCount(9);
  await scrollDown(page);
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toBeInViewport({ ratio: 1 });
  assert.equal(await page.locator("#search-form").count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await navigation.getByRole("link", { name: "Découvrir", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await scrollDown(page);
  await navigation.getByRole("link", { name: /Ma bibliothèque/ }).click();
  await expect(page.getByRole("heading", { name: "Ma bibliothèque", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  passed("320 px sticky search, no horizontal overflow and navigation scroll reset");

  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => {
    try { await fetch("./offline-network-probe"); return false; } catch { return true; }
  }), true);
  const offlineResponse = await page.reload();
  assert.equal(offlineResponse.fromServiceWorker(), true);
  await expect(page.getByRole("heading", { name: "Ma bibliothèque", exact: true })).toBeVisible();
  await expect(page.locator(".library-section .book-card")).toHaveCount(2);
  await page.locator(`.library-section .book-open[data-id="${horlaId}"]`).click();
  await expect(page.locator("#rsvp-word")).toHaveText(savedWord);
  await expect(page.locator("#rsvp-count")).toHaveText(savedCount);
  await page.reload();
  await expect(page.locator("#rsvp-word")).toHaveText(savedWord);
  await returnToLibrary(page);
  await search(page, "maupassant");
  await expect(page.locator(`.local-results .book-open[data-id="${horlaId}"]`)).toBeVisible();
  assert.ok(await page.locator(".catalog-grid .book-card").count() > 0);
  await expect(page.locator(".source-warning")).toHaveCount(0);
  await navigation.getByRole("link", { name: "Découvrir", exact: true }).click();
  await page.locator('.catalog-grid .book-open[data-id="selection-trois-contes"]').click();
  await expect(page.locator(".reader-title strong")).toContainText(/Trois contes/i);
  await expect(page.locator("#rsvp")).toBeVisible();
  await returnToLibrary(page);
  state = await libraryState(page);
  assert.equal(state.books.length, 3);
  assert.equal(state.positions.find((position) => position.id === horlaId).bookmarks.length, 1);
  passed("Offline page reload, saved position, French search and first opening of a precached EPUB");

  assert.deepEqual(apiRequests, [], "A static Pages build must never request a server API.");
  assert.deepEqual(httpErrors, [], "No missing assets or HTTP errors are expected.");
  assert.deepEqual(scriptErrors, [], "The browser must not report uncaught JavaScript errors.");
  passed("No API calls, missing HTTP assets or uncaught browser errors");
  console.log(JSON.stringify({ url: baseURL.href, checks: completed.length, result: "passed" }));
} finally {
  await context?.close();
  await browser?.close();
  await server?.stop();
}
