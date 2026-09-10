import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

// The real catalog snapshot and EPUB files must reach the preview server.
// The remote relay has deterministic fixture/failure tests; bundled EPUBs and
// the complete catalog snapshot are served unchanged. Offline has its own suite.
test.use({ serviceWorkers: "block" });

const expectedFirstWords = {
  "le-horla.epub": "8",
  "trois-contes.epub": "Pendant",
  "candide.epub": "Candide",
  "tour-du-monde.epub": "En",
  "voyage-centre-terre.epub": "Le",
  "vingt-mille-lieues.epub": "L'année",
  "notre-dame-paris.epub": "Il",
  "madame-bovary.epub": "Cher",
  "dernier-jour-condamne.epub": "Il",
};

const selection = JSON.parse(
  await readFile(
    new URL("../../public/books/provenance.json", import.meta.url),
    "utf8",
  ),
).books;

// All search results are covers that open the reader.
const catalogResults = (page) =>
  page.locator(".catalog-grid .book-card");
const catalogTitles = (page) =>
  page.locator(".catalog-grid .book-card h3");

for (const book of selection) {
  test(`le vrai EPUB intégré ${book.title} s’ouvre en un clic avec texte, commandes et droits`, async ({
    page,
  }) => {
    const errors = [];
    const externalRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        /^(?:www\.)?gutenberg\.org$|^gutendex\.com$/.test(
          new URL(request.url()).hostname,
        )
      )
        externalRequests.push(request.url());
    });
    await page.goto("/#discover");
    await expect(page.locator(".catalog-grid .book-card")).toHaveCount(
      selection.length,
    );
    await expect(
      page.getByRole("link", { name: /Sources et droits/ }),
    ).toBeVisible();
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/books/${book.file}`),
    );
    await page
      .locator(`[data-action="catalog-read"][data-id="${book.id}"]`)
      .first()
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(
      "application/epub+zip",
    );
    await expect(page.locator(".reader-title strong")).not.toBeEmpty();
    await expect(page.locator("#rsvp")).toBeVisible();
    await expect(page.locator("#rsvp-word")).toHaveText(
      expectedFirstWords[book.file],
    );
    await expect
      .poll(
        async () =>
          (await page.locator("#chapter-content").textContent()).trim().length,
      )
      .toBeGreaterThan(100);
    await expect(
      page.getByRole("button", { name: "Mot à mot", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Mes repères", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Réglages de lecture" }).click();
    await expect(
      page.locator('#reader-settings a[href$="books/NOTICE.html"]'),
    ).toBeVisible();
    if (book.file === "le-horla.epub") {
      await page.getByRole("button", { name: "Fermer les réglages" }).click();
      await page
        .getByRole("button", { name: "Ajouter un signet", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Retour à ma bibliothèque" })
        .click();
      await expect(
        page.getByRole("button", { name: "Lire Le Horla", exact: true }),
      ).toBeVisible();
      const before = (await storedRows(page, "books"))[0];
      await importEpub(
        page,
        await readFile(
          new URL(`../../public/books/${book.file}`, import.meta.url),
        ),
        "le-horla-reimporte.epub",
      );
      await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
      const after = (await storedRows(page, "books"))[0];
      expect(after.source).toEqual(before.source);
      expect(after.addedAt).toBe(before.addedAt);
      expect((await storedRows(page, "positions"))[0].bookmarks).toHaveLength(
        1,
      );
    }
    expect(externalRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

async function search(page, query, language = "fr") {
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill(query);
  await page
    .getByLabel("Langue du livre", { exact: true })
    .selectOption(language);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page).toHaveURL(/#search\?/);
  await expect.poll(() => {
    const parameters = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    return [parameters.get("q"), parameters.get("language")];
  }).toEqual([query, language]);
  await expect(
    page.locator('section[aria-label="Résultats de recherche"]'),
  ).toHaveAttribute("data-query", query);
  await expect(
    page.locator('section[aria-label="Résultats de recherche"]'),
  ).toHaveAttribute("aria-busy", "false");
}

test("la recherche réelle trouve Hugo, les titres sans accents et leurs éditions intégrées sans API tierce", async ({
  page,
}) => {
  const externalRequests = [];
  page.on("request", (request) => {
    if (/gutendex|gutenberg\.org/.test(request.url()))
      externalRequests.push(request.url());
  });
  await page.goto("/#discover");
  await search(page, "hugo");
  await expect(page.locator(".catalog-grid .book-card").first()).toContainText(
    /Hugo/,
  );
  await expect(catalogResults(page)).toHaveCount(24);
  await expect(page.locator(".catalog-grid .book-card").first()).toContainText(/Hugo/);
  await search(page, "notre-dame");
  await expect(
    page
      .locator(
        '[data-action="catalog-read"][data-id="selection-notre-dame-paris"]',
      )
      .first(),
  ).toBeVisible();
  await page
    .locator(
      '[data-action="catalog-read"][data-id="selection-notre-dame-paris"]',
    )
    .first()
    .click();
  await expect(page.locator(".reader-title strong")).toContainText(
    /Notre-Dame/i,
  );
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("le catalogue local gère langue, pagination et absence de résultats sans perdre le formulaire", async ({
  page,
}) => {
  await page.goto("/#discover");
  await search(page, "", "en");
  await expect(catalogResults(page)).toHaveCount(24);
  await expect(page.locator(".catalog-grid .cover")).toHaveCount(24);
  await expect(page.locator(".catalog-grid .book-card").first()).toHaveAttribute("data-language", "en");
  await page
    .getByRole("button", { name: "À lire maintenant", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Project Gutenberg", exact: true })
    .click();
  await expect(catalogResults(page)).toHaveCount(24);
  const firstPage = await catalogTitles(page).allTextContents();
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 2");
  await expect(catalogResults(page)).toHaveCount(24);
  expect(await catalogTitles(page).allTextContents()).not.toEqual(firstPage);
  await page.getByRole("button", { name: "Précédent", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 1");
  expect(await catalogTitles(page).allTextContents()).toEqual(firstPage);
  await search(page, "pride prejudice", "en");
  await expect(page.locator(".catalog-grid .book-card").first()).toContainText(
    /Pride and Prejudice/i,
  );
  await search(page, "zzzzlivrequinexistepaszzzz", "fr");
  await expect(
    page.getByRole("heading", { name: "Aucun livre trouvé", exact: true }),
  ).toBeVisible();
  await expect(catalogResults(page)).toHaveCount(0);
  await search(page, "miserables", "fr");
  expect(await catalogResults(page).count()).toBeGreaterThan(0);
  await expect(page.locator(".catalog-grid")).toContainText(
    /Misérables/i,
  );
});

test("un index indisponible annonce la panne et la recherche commune garde les livres intégrés", async ({
  page,
}) => {
  await page.route("**/catalog/fr-*.json", (route) => route.abort("failed"));
  await page.goto("/#discover");
  await page
    .getByRole("button", { name: "Project Gutenberg", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "La recherche n’a pas pu aboutir",
  );
  await page
    .getByRole("button", { name: "Livres prêts à lire", exact: true })
    .click();
  await expect(page.locator(".catalog-grid .book-card")).toHaveCount(
    selection.length,
  );
  await search(page, "horla");
  await expect(page.locator(".source-warning")).toBeVisible();
  await expect(page.locator(".catalog-grid .book-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Lire Le Horla", exact: true })
    .click();
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await expect(page.locator("#rsvp")).toBeVisible();
});

test("un téléchargement local en panne donne accès à la source et à l’import manuel", async ({
  page,
}) => {
  await page.route("**/books/le-horla.epub", (route) => route.abort("failed"));
  await page.goto("/#discover");
  await page
    .getByRole("button", { name: "Lire Le Horla", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Ouvrir la fiche source" }),
  ).toHaveAttribute("href", "https://www.gutenberg.org/ebooks/10775");
  await expect(
    dialog.getByRole("button", { name: "Importer mon EPUB", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.unroute("**/books/le-horla.epub");
  await page
    .getByRole("button", { name: "Lire Le Horla", exact: true })
    .click();
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
});

test("une couverture Gutenberg télécharge l’EPUB, ouvre le lecteur et se reprend depuis la bibliothèque sans second téléchargement", async ({
  page,
  context,
}) => {
  const externalRequests = [];
  page.on("request", (request) => {
    if (/gutenberg\.org/.test(request.url())) externalRequests.push(request.url());
  });
  await page.goto("/#discover");
  await search(page, "miserables");
  await expect(page.locator(".source-result, .external-results")).toHaveCount(0);
  const card = page.locator('.catalog-grid [data-provider="gutenberg"]').first();
  await expect(card.locator(".cover")).toBeVisible();
  const title = await card.locator("h3").textContent();
  const bookId = await card.locator(".book-open").getAttribute("data-id");
  const endpoint = `**/api/books/gutenberg/${bookId.replace("gutenberg-", "")}.epub`;
  const epub = await makeEpub({ title, author: "Victor Hugo" });
  let downloads = 0;
  await page.route(endpoint, async (route) => {
    downloads += 1;
    await route.fulfill({ status: 200, contentType: "application/epub+zip", body: epub });
  });
  await expect(card.getByRole("link", { name: `Source et droits : ${title}`, exact: true })).toHaveAttribute("rel", /noopener noreferrer/);
  await card.locator(".book-open").click();
  await expect(page.locator(".reader-title strong")).toHaveText(title);
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].source.bookId).toBe(bookId);
  expect(books[0].source.canonicalSourceId).toBe(bookId.replace("gutenberg-", "gutenberg:"));
  await page.getByRole("button", { name: "Chapitre suivant", exact: true }).click();
  await expect(page.locator("#chapter-label")).toContainText("2");
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(page.locator(".library-section .book-card h3")).toHaveText(title);
  await page.getByRole("link", { name: "Découvrir", exact: true }).click();
  await search(page, "miserables");
  const savedCard = page.locator(".local-results .book-card").filter({
    has: page.locator(`[data-action="open"][data-id="${books[0].id}"]`),
  });
  await expect(savedCard).toContainText("Disponible hors ligne");
  await expect(page.locator(`.catalog-grid [data-id="${bookId}"]`)).toHaveCount(0);
  await context.setOffline(true);
  await savedCard.locator(".book-open").click();
  await expect(page.locator(".reader-title strong")).toHaveText(title);
  await expect(page.locator("#chapter-label")).toContainText("2");
  expect(downloads).toBe(1);
  expect(await storedRows(page, "books")).toHaveLength(1);
  expect((await storedRows(page, "positions"))[0].bookmarks).toHaveLength(1);
  expect(externalRequests).toEqual([]);
});

test("un relais indisponible n’ajoute aucun livre et permet de réessayer la même couverture", async ({ page }) => {
  await page.goto("/#discover");
  await search(page, "pride prejudice", "en");
  const card = page.locator('.catalog-grid [data-provider="gutenberg"]').first();
  const title = await card.locator("h3").textContent();
  const bookId = await card.locator(".book-open").getAttribute("data-id");
  const endpoint = `**/api/books/gutenberg/${bookId.replace("gutenberg-", "")}.epub`;
  let downloads = 0;
  await page.route(endpoint, async (route) => {
    downloads += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Source unavailable"}' });
  });
  await card.locator(".book-open").click();
  await expect(page.getByRole("dialog")).toContainText("indisponible");
  expect(await storedRows(page, "books")).toHaveLength(0);
  await page.unroute(endpoint);
  await page.route(endpoint, async (route) => {
    downloads += 1;
    await route.fulfill({ status: 200, contentType: "application/epub+zip", body: await makeEpub({ title, language: "en" }) });
  });
  await page.getByRole("dialog").getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText(title);
  expect(downloads).toBe(2);
  expect(await storedRows(page, "books")).toHaveLength(1);
});

test("quitter une ouverture Gutenberg annule le téléchargement sans ajouter de livre et laisse la bibliothèque utilisable", async ({ page }) => {
  await page.goto("/#discover");
  await search(page, "pride prejudice", "en");
  const card = page.locator('.catalog-grid [data-provider="gutenberg"]').first();
  const title = await card.locator("h3").textContent();
  const bookId = await card.locator(".book-open").getAttribute("data-id");
  const path = `/api/books/gutenberg/${bookId.replace("gutenberg-", "")}.epub`;
  const epub = await makeEpub({ title, language: "en" });
  let release;
  let acknowledge;
  const pending = new Promise((resolve) => { release = resolve; });
  const delivered = new Promise((resolve) => { acknowledge = resolve; });
  const started = page.waitForRequest((request) => new URL(request.url()).pathname === path);
  await page.route(`**${path}`, async (route) => {
    await pending;
    try {
      await route.fulfill({ status: 200, contentType: "application/epub+zip", body: epub });
    } catch {
      // A canceled browser request may already be closed when its response arrives.
    } finally {
      acknowledge();
    }
  });
  const aborted = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname === path);
  await card.locator(".book-open").click();
  await started;
  await page.locator('nav[aria-label="Navigation principale"] a[href="#library"]').click();
  await expect(page).toHaveURL(/#library$/);
  release();
  await delivered;
  await aborted;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await storedRows(page, "books")).toHaveLength(0);
  await page.getByRole("button", { name: "Essayer le lecteur", exact: true }).click();
  await expect(page.locator(".reader-title strong")).toHaveText("L’art de prendre le temps");
  expect(await storedRows(page, "books")).toHaveLength(1);
});

test("la notice des livres permet de lire la licence, télécharger un original et revenir au catalogue", async ({
  page,
}, testInfo) => {
  await page.goto("/books/NOTICE.html");
  await expect(
    page.getByRole("heading", {
      name: "Sources et droits des livres",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("a[download]")).toHaveCount(9);
  await expect(page.locator("pre")).toContainText("THE FULL PROJECT GUTENBERG");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const pending = page.waitForEvent("download");
  await page.locator("a[download]").filter({ hasText: "Le Horla" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("le-horla.epub");
  await download.saveAs(testInfo.outputPath("notice-horla.epub"));
  await page.getByRole("link", { name: "Retour au catalogue" }).click();
  await expect(page).toHaveURL(/#discover$/);
  await expect(
    page.getByRole("button", { name: "Lire Le Horla", exact: true }),
  ).toBeVisible();
});
