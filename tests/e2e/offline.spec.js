import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

async function isolatedProductionServer() {
  const directory = fileURLToPath(new URL("../../dist/", import.meta.url));
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".epub": "application/epub+zip",
  };
  const server = createServer(async (request, response) => {
    const filename =
      new URL(request.url, "http://localhost").pathname.slice(1) ||
      "index.html";
    try {
      const content = await readFile(path.join(directory, filename));
      response.setHeader(
        "Content-Type",
        types[path.extname(filename)] || "application/octet-stream",
      );
      response.setHeader("Vary", "Origin");
      response.setHeader("Cache-Control", "no-store");
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    stop: async () => {
      if (!server.listening) return;
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}

test("la bibliothèque, la lecture et la progression restent disponibles hors ligne", async ({
  page,
  context,
  browserName,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // WebKit's network emulation can reject SW reloads with an internal error.
  // A private server is stopped instead: no shared server or HTTP cache can help.
  const server =
    browserName === "webkit" ? await isolatedProductionServer() : null;
  try {
    await page.goto(server?.url || "/");
    await importEpub(page, await makeEpub({ title: "Un livre hors connexion", chapters: 3 }));
    await expect(
      page.getByRole("heading", { name: "Chapitre 1", exact: true }),
    ).toBeVisible();
    await page.locator('[aria-label="Chapitre suivant"]').click();
    await expect(
      page.getByRole("heading", { name: "Chapitre 2", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ajouter un signet" }).click();
    await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
    await expect(
      page.getByRole("button", {
        name: "Lire Un livre hors connexion",
        exact: true,
      }),
    ).toBeVisible();

    // A first online visit must complete installation before offline use is possible.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() =>
      Boolean(navigator.serviceWorker.controller),
    );
    const cachedURLs = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) =>
        name.startsWith("fastreader:/"),
      );
      const cache = await caches.open(names[0]);
      return (await cache.keys()).map((request) => request.url);
    });
    expect(cachedURLs.some((url) => /\/assets\/[^/]+\.js$/.test(url))).toBe(
      true,
    );
    expect(cachedURLs.some((url) => /\/assets\/[^/]+\.css$/.test(url))).toBe(
      true,
    );

    if (server) await server.stop();
    else await context.setOffline(true);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch("./uncached-offline-probe");
          return "network available";
        } catch {
          return "network unavailable";
        }
      }),
    ).toBe("network unavailable");
    await page.reload();
    if (!server)
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(
      page.getByRole("button", {
        name: "Lire Un livre hors connexion",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Lire Un livre hors connexion",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Chapitre 2", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#chapter-scroll")).toContainText(
      "Une histoire à garder sur cet appareil",
    );
    await page.getByRole("button", { name: /Mes repères/ }).click();
    await expect(page.locator('[data-action="goto-bookmark"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Fermer mes repères", exact: true }).click();

    // Changes made without a connection also survive a complete document reload.
    await page.locator('[aria-label="Chapitre suivant"]').click();
    await expect(
      page.getByRole("heading", { name: "Chapitre 3", exact: true }),
    ).toBeVisible();
    // Returning to the library completes its asynchronous save before closing the page.
    await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
    await expect(
      page.getByRole("button", {
        name: "Lire Un livre hors connexion",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Lire Un livre hors connexion",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Chapitre 3", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Chapitre 3", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await server?.stop();
  }
});

test("un livre de la sélection s’ouvre pour la première fois après la coupure réseau", async ({
  page,
  context,
  browserName,
}) => {
  const server =
    browserName === "webkit" ? await isolatedProductionServer() : null;
  try {
    await page.goto(`${server?.url || "/"}#discover`);
    await expect(
      page.getByRole("button", { name: "Lire Le Horla", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() =>
      Boolean(navigator.serviceWorker.controller),
    );
    if (server) await server.stop();
    else await context.setOffline(true);
    await page.reload();
    await page
      .getByRole("button", { name: "Lire Le Horla", exact: true })
      .click();
    await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
    await expect(page.locator("#rsvp")).toBeVisible();
    await expect(page.locator("#chapter-content")).toContainText(
      "Quelle journée admirable",
    );
    await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Lire Le Horla", exact: true }),
    ).toBeVisible();
  } finally {
    await server?.stop();
  }
});

test("la recherche fonctionne hors ligne en français et dans une langue déjà consultée", async ({
  page,
  context,
  browserName,
}) => {
  const server =
    browserName === "webkit" ? await isolatedProductionServer() : null;
  const manifest = JSON.parse(
    await readFile(
      new URL("../../src/sources/catalog-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  try {
    await page.goto(`${server?.url || "/"}#discover`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() =>
      Boolean(navigator.serviceWorker.controller),
    );
    await page
      .getByRole("searchbox", { name: "Titre ou auteur" })
      .fill("pride prejudice");
    await page
      .getByLabel("Langue du livre", { exact: true })
      .selectOption("en");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(page.locator(".catalog-grid")).toContainText(
      /Pride and Prejudice/i,
    );
    await expect
      .poll(() =>
        page.evaluate(async (files) => {
          const names = (await caches.keys()).filter((name) =>
            name.startsWith("fastreader:/"),
          );
          const cachesForApp = await Promise.all(
            names.map((name) => caches.open(name)),
          );
          const requests = (
            await Promise.all(cachesForApp.map((cache) => cache.keys()))
          ).flat();
          return files.every((file) =>
            requests.some((request) =>
              request.url.endsWith(`/catalog/${file}`),
            ),
          );
        }, manifest.languages.en.files),
      )
      .toBe(true);
    if (server) await server.stop();
    else await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("pride prejudice");
    await expect(page.getByLabel("Langue du livre", { exact: true })).toHaveValue("en");
    await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("hugo");
    await page.getByLabel("Langue du livre", { exact: true }).selectOption("fr");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(page.locator(".catalog-grid")).toContainText(/Hugo/);
    await expect(page.locator(".source-warning")).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Titre ou auteur" })
      .fill("pride prejudice");
    await page
      .getByLabel("Langue du livre", { exact: true })
      .selectOption("en");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(page.locator(".catalog-grid")).toContainText(
      /Pride and Prejudice/i,
    );
    await expect(page.locator(".source-warning")).toHaveCount(0);
    const book = page.locator('.catalog-grid [data-provider="gutenberg"] .book-open').first();
    await expect(book.locator(".cover")).toBeVisible();
    await book.click();
    await expect(page.getByRole("dialog")).toContainText(/première fois|Vérifiez votre connexion/);
    expect(await storedRows(page, "books")).toHaveLength(0);
  } finally {
    await server?.stop();
  }
});
