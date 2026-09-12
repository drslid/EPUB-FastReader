// Compile and exercise Pages with a fake, explicitly configured HTTPS relay.
// Everything is local: no public relay, GitHub setting or deployed file is changed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, webkit, expect } from "@playwright/test";
import { makeEpub } from "../tests/e2e/helpers/fixtures.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const projectPath = "/EPUB-FastReader/";
const relayOrigin = "https://relay.fastreader.test";
const run = promisify(execFile);
const engineName = process.env.FASTREADER_RELAY_BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(engineName), "FASTREADER_RELAY_BROWSER must be chromium or webkit.");
const engine = engineName === "webkit" ? webkit : chromium;
const temporary = await mkdtemp(path.join(os.tmpdir(), "fastreader-pages-relay-"));
const buildDirectory = path.join(temporary, "build");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".epub": "application/epub+zip",
};

async function serveBuild() {
  const root = await realpath(buildDirectory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!["GET", "HEAD"].includes(request.method) || !pathname.startsWith(projectPath)) {
        response.writeHead(404).end(); return;
      }
      const filename = await realpath(path.resolve(root, pathname.slice(projectPath.length) || "index.html"));
      if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
      const content = await readFile(filename);
      response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store", Vary: "Origin" });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let stopped = false;
  return {
    url: new URL(`http://127.0.0.1:${server.address().port}${projectPath}`),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

async function stateOf(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("fastreader");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(["books", "positions"], "readonly");
      const books = tx.objectStore("books").getAll();
      const positions = tx.objectStore("positions").getAll();
      tx.oncomplete = () => {
        database.close();
        resolve({ books: books.result.map((book) => ({ id: book.id, title: book.title, source: book.source, original: [...new Uint8Array(book.original || [])] })), positions: positions.result });
      };
      tx.onabort = () => { database.close(); reject(tx.error); };
    };
  }));
}

async function search(page, query, language = "fr") {
  await page.getByRole("searchbox", { name: "Titre ou auteur", exact: true }).fill(query);
  await page.getByLabel("Langue du livre", { exact: true }).selectOption(language);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  const results = page.locator('section[aria-label="Résultats de recherche"]');
  await expect(results).toHaveAttribute("data-query", query);
  await expect(results).toHaveAttribute("aria-busy", "false");
}

const checks = [];
const passed = (message) => { checks.push(message); console.log(`✓ ${message}`); };
let browser;
let context;
let server;
const diagnostics = [];

try {
  await run(process.execPath, [path.join(projectRoot, "node_modules/vite/bin/vite.js"), "build", "--mode", "pages", "--outDir", buildDirectory, "--emptyOutDir"], {
    cwd: projectRoot,
    env: { ...process.env, VITE_SOURCE_RELAY_URL: relayOrigin, VITE_GUTENBERG_RELAY_URL: relayOrigin },
    timeout: 120_000,
    maxBuffer: 4 * 1024 ** 2,
  });
  passed("Pages compiled with an explicit fake relay into an isolated temporary directory");
  server = await serveBuild();
  const base = server.url;
  const fixture = await makeEpub({
    title: "Germinal — vérification du relais", author: "Émile Zola",
    paragraphs: ["Un chapitre de test pour vérifier la reprise exacte de lecture. Ce fichier EPUB est une fixture locale et ne représente pas le texte du roman. La lecture continue au même endroit après un retour à la bibliothèque, une fermeture de page ou une coupure du réseau."],
  });
  browser = await engine.launch();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  if (engineName === "webkit") {
    // Playwright WebKit cannot intercept a controlled page's cross-origin fetch.
    // Defer the first real SW registration until fixture downloads finish, then
    // verify its actual installation, controlled reload and offline reader.
    await context.addInitScript(() => {
      const serviceWorker = navigator.serviceWorker;
      if (!serviceWorker || serviceWorker.controller) return;
      const register = serviceWorker.register.bind(serviceWorker);
      let pending = [];
      let enabled = false;
      serviceWorker.register = (...args) => enabled ? register(...args) : new Promise((resolve, reject) => pending.push({ args, resolve, reject }));
      window.__enableRelayTestServiceWorker = async () => {
        enabled = true;
        const tasks = pending;
        pending = [];
        await Promise.all(tasks.map(async (task) => {
          try { task.resolve(await register(...task.args)); }
          catch (cause) { task.reject(cause); throw cause; }
        }));
      };
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  const localApiRequests = [];
  const unexpectedRequests = [];
  const relayRequests = [];
  let refused = false;
  page.on("pageerror", (cause) => errors.push(cause.message));
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()); });
  context.on("requestfailed", (request) => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin && /\/api\//u.test(url.pathname)) localApiRequests.push(url.href);
    if (url.origin === relayOrigin && request.method() === "GET" && url.pathname.startsWith("/api/books/")) relayRequests.push(url.href);
    if (["http:", "https:"].includes(url.protocol) && ![base.origin, relayOrigin, "https://standardebooks.org"].includes(url.origin)) unexpectedRequests.push(url.href);
  });
  await context.route(/^https?:\/\//u, async (route) => {
    const origin = new URL(route.request().url()).origin;
    if ([base.origin, relayOrigin].includes(origin)) await route.fallback();
    else await route.abort("blockedbyclient");
  });
  await context.route("https://standardebooks.org/ebooks?**", (route) => route.fulfill({ status: 200, contentType: "application/xhtml+xml", headers: { "access-control-allow-origin": "*" }, body: '<html><main class="ebooks"><form role="search"></form><p class="no-results">No ebooks matched your filters.</p></main></html>' }));
  await context.route(`${base}catalog/loyalbooks.json`, (route) => route.fulfill({
    json: { version: 1, updatedAt: "2026-09-12T00:00:00.000Z", coverage: "selection", languages: { en: { indexed: 0, total: 0, pages: 1, complete: true } }, books: [] },
  }));
  await context.route(`${relayOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    diagnostics.push(`Intercepted ${request.method()} ${url.href}`);
    if (url.pathname === "/api/sources/ebooks-gratuits/search") {
      await route.fulfill({ status: 200, contentType: "application/atom+xml", headers: { "access-control-allow-origin": base.origin }, body: '<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty test feed</title></feed>' });
      return;
    }
    if (url.pathname === "/api/sources/fadedpage/search" || url.pathname === "/api/sources/epubbooks/search") {
      const faded = url.pathname.includes("fadedpage");
      await route.fulfill({ status: 200, contentType: faded ? "application/json" : "text/html", headers: { "access-control-allow-origin": base.origin }, body: faded ? '{"nrows":0,"rows":[]}' : '<html><body><form role="search"></form><h1>Top Search Results for "absent"</h1><h3>No results found.</h3></body></html>' });
      return;
    }
    const additionalSearches = {
      "/api/sources/ebookzy/search": '<!doctype html><html><body><div id="content"><h1 class="page-title">Search results for: absent</h1><section class="no-results"></section></div></body></html>',
      "/api/sources/atramenta/search": '<!doctype html><html><body><form action="/search/"></form><main id="main_content_wrapper"><h1>Recherche</h1><p>Aucun résultat</p></main></body></html>',
    };
    if (Object.hasOwn(additionalSearches, url.pathname)) {
      assert.equal(request.method(), "GET");
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "access-control-allow-origin": base.origin }, body: additionalSearches[url.pathname] });
      return;
    }
    assert.match(url.pathname, /^\/api\/books\/gutenberg\/[1-9]\d{0,8}\.epub$/u);
    assert.equal(request.headers().origin, base.origin);
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().authorization, undefined);
    assert.equal(request.headers().referer, undefined);
    const headers = { "access-control-allow-origin": base.origin, vary: "Origin", "cache-control": "no-store" };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...headers, "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": "Accept" } });
      return;
    }
    assert.equal(request.method(), "GET");
    if (refused) {
      await route.fulfill({ status: 403, contentType: "application/json", headers, body: JSON.stringify({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Refus de test" } }) });
    } else {
      assert.equal(url.pathname, "/api/books/gutenberg/5711.epub");
      await route.fulfill({ status: 200, contentType: "application/epub+zip", headers, body: fixture });
    }
  });

  await page.goto(`${base}#discover`);
  if (engineName !== "webkit") await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });
  await search(page, "germinal");
  const germinal = page.locator('.catalog-grid .book-card[data-provider="gutenberg"]').filter({ has: page.locator('.book-open[data-id="gutenberg-5711"]') });
  await expect(germinal.getByRole("button", { name: "Lire", exact: true })).toBeVisible();
  assert.equal((await stateOf(page)).books.length, 0);
  await germinal.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("Germinal — vérification du relais");
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.locator(".fallback-dialog")).toHaveCount(0);
  let state = await stateOf(page);
  assert.equal(state.books.length, 1);
  assert.deepEqual(Buffer.from(state.books[0].original), fixture);
  assert.equal(state.books[0].source.canonicalSourceId, "gutenberg:5711");
  assert.deepEqual(relayRequests, [`${relayOrigin}/api/books/gutenberg/5711.epub`]);
  passed("Compiled Pages search opens the original EPUB through the configured HTTPS relay and stores it in IndexedDB");

  await page.getByRole("button", { name: "Avancer de dix mots", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  const word = await page.locator("#rsvp-word").innerText();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  state = await stateOf(page);
  const bookId = state.books[0].id;
  const position = state.positions.find((item) => item.id === bookId);
  assert.equal(position.bookmarks.length, 1);
  assert.ok(position.locator?.exact);
  await search(page, "germinal");
  await page.locator(`.local-results .book-open[data-id="${bookId}"]`).click();
  await expect(page.locator("#rsvp-word")).toHaveText(word);
  assert.equal(relayRequests.length, 1);
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  passed("The saved book resumes its exact word and bookmark without another relay request");

  refused = true;
  await search(page, "pride prejudice", "en");
  const denied = page.locator('.catalog-grid .book-card[data-provider="gutenberg"]').filter({ has: page.locator('.book-open[data-id="gutenberg-1342"]') });
  await denied.getByRole("button", { name: "Lire", exact: true }).click();
  const dialog = page.locator(".fallback-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Ouvrir la fiche source" })).toHaveAttribute("href", "https://www.gutenberg.org/ebooks/1342");
  await expect(dialog.getByRole("button", { name: "Importer mon EPUB", exact: true })).toBeVisible();
  assert.equal((await stateOf(page)).books.length, 1);
  assert.deepEqual(relayRequests, [`${relayOrigin}/api/books/gutenberg/5711.epub`, `${relayOrigin}/api/books/gutenberg/1342.epub`]);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: /Ma bibliothèque/u }).click();
  passed("A refused relay request opens the official-source/import fallback and adds no book");

  if (engineName === "webkit") await page.evaluate(() => window.__enableRelayTestServiceWorker());
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });
  await context.unroute(`${relayOrigin}/**`);
  if (engineName !== "webkit") await context.setOffline(true);
  // Use actual server loss on WebKit; its offline emulation can fail SW reloads.
  await server.stop();
  assert.equal(await page.evaluate(async () => {
    try { await fetch("./unavailable-network-probe"); return false; }
    catch { return true; }
  }), true);
  const response = await page.reload();
  assert.equal(response.fromServiceWorker(), true);
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  await page.locator(`.library-section .book-open[data-id="${bookId}"]`).click();
  await expect(page.locator("#rsvp-word")).toHaveText(word);
  const restored = (await stateOf(page)).positions.find((item) => item.id === bookId);
  assert.deepEqual(restored.locator, position.locator);
  assert.equal(restored.bookmarks.length, 1);
  assert.equal(relayRequests.length, 2);
  passed("Offline page reload and reading work after the static server stops and a network probe fails");

  assert.deepEqual(localApiRequests, [], "Configured Pages must never request a same-origin API.");
  assert.deepEqual(unexpectedRequests, [], "No real remote service may be contacted.");
  assert.deepEqual(errors, [], "No uncaught browser exception is expected.");
  passed("No same-origin API calls, real external services or uncaught browser errors");
  console.log(JSON.stringify({ browser: engineName, mode: "pages", relay: "intercepted local fixture", checks: checks.length, result: "passed" }));
} catch (cause) {
  if (diagnostics.length) console.error(JSON.stringify({ diagnostics }));
  if (cause.stdout) process.stderr.write(cause.stdout);
  if (cause.stderr) process.stderr.write(cause.stderr);
  throw cause;
} finally {
  await context?.close();
  await browser?.close();
  await server?.stop();
  await rm(temporary, { recursive: true, force: true });
}
