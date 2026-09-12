import { expect, test } from "@playwright/test";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

const cards = (page) => page.locator(".suggestion-card");
const suggestionIds = (page) =>
  cards(page).evaluateAll((elements) =>
    elements.map((element) => element.dataset.bookId),
  );
const sortedIds = async (page) => (await suggestionIds(page)).sort();
const goTo = async (page, route) => {
  await page
    .locator(`nav[aria-label="Navigation principale"] a[href="#${route}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`#${route}$`));
};

test("l’accueil propose trois vrais livres et renouvelle sa sélection sur demande puis au prochain démarrage", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Votre prochaine lecture", exact: true }),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: /^Lire la suggestion : / }),
  ).toHaveCount(3);
  const first = await sortedIds(page);
  expect(first.every((id) => id.startsWith("selection-"))).toBe(true);
  expect(new Set(first).size).toBe(3);
  expect(await storedRows(page, "books")).toEqual([]);
  await expect
    .poll(async () =>
      (await storedRows(page, "preferences"))
        .find((row) => row.id === "suggestions")
        ?.ids?.slice()
        .sort(),
    )
    .toEqual(first);

  const refresh = page.getByRole("button", {
    name: "D’autres idées",
    exact: true,
  });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect.poll(() => sortedIds(page)).not.toEqual(first);
  const second = await sortedIds(page);
  expect(second.every((id) => !first.includes(id))).toBe(true);
  await expect
    .poll(async () =>
      (await storedRows(page, "preferences"))
        .find((row) => row.id === "suggestions")
        ?.ids?.slice()
        .sort(),
    )
    .toEqual(second);

  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  const third = await sortedIds(page);
  expect(third.every((id) => !second.includes(id))).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("les suggestions restent stables pendant les changements de thème, la recherche et la navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(cards(page)).toHaveCount(3);
  const first = await suggestionIds(page);
  await page
    .getByRole("button", { name: "Passer au thème clair", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  expect(await suggestionIds(page)).toEqual(first);
  await goTo(page, "discover");
  await page.getByRole("searchbox", { name: "Titre ou auteur" }).fill("hugo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(
    page.locator('section[aria-label="Résultats de recherche"]'),
  ).toHaveAttribute("aria-busy", "false");
  await goTo(page, "library");
  await expect(cards(page)).toHaveCount(0);
  await goTo(page, "home");
  await expect(cards(page)).toHaveCount(3);
  expect(await suggestionIds(page)).toEqual(first);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  await page
    .getByRole("button", { name: "Passer au thème sombre", exact: true })
    .click();
  expect(await suggestionIds(page)).toEqual(first);
});

test("cliquer une suggestion ouvre le livre, le conserve et le reprend depuis Découvrir sans le télécharger de nouveau", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (/\/books\/[^/]+\.epub$/.test(new URL(request.url()).pathname))
      requests.push(request.url());
  });
  await page.goto("/");
  await expect(cards(page)).toHaveCount(3);
  const chosenId = await cards(page).first().getAttribute("data-book-id");
  await cards(page)
    .first()
    .getByRole("button", { name: /^Lire la suggestion : / })
    .click();
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.locator(".reader-title strong")).not.toBeEmpty();
  expect(requests).toHaveLength(1);
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].source.bookId).toBe(chosenId);
  await page
    .getByRole("button", { name: "Avancer de dix mots", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Avancer de dix mots", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ajouter un signet", exact: true })
    .click();
  const word = await page.locator("#rsvp-word").textContent();
  await page
    .getByRole("link", { name: "Retour à ma bibliothèque", exact: true })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  const saved = (await storedRows(page, "positions"))[0];
  expect(saved.bookmarks).toHaveLength(1);
  expect(saved.wordIndex).toBeGreaterThan(0);

  await goTo(page, "discover");
  await page
    .locator(`[data-action="catalog-read"][data-id="${chosenId}"]`)
    .first()
    .click();
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.locator("#rsvp-word")).toHaveText(word);
  expect(requests).toHaveLength(1);
  const after = await storedRows(page, "books");
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(books[0].id);
  const restored = (await storedRows(page, "positions"))[0];
  expect(restored.bookmarks).toEqual(saved.bookmarks);
  expect(restored.wordIndex).toBe(saved.wordIndex);
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await expect(page.locator('[data-action="export"]')).toBeEnabled();
  await expect(page.locator('[data-action="export-original"]')).toBeEnabled();
});

test("Découvrir retrouve aussi une œuvre déjà importée et conserve ses repères", async ({
  page,
}) => {
  await page.goto("/");
  await importEpub(
    page,
    await makeEpub({
      title: "Le Horla",
      author: "Guy de Maupassant",
      paragraphs: [
        "Cette édition importée conserve ses propres chapitres et tous les passages déjà marqués dans le navigateur.",
      ],
    }),
  );
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await page
    .getByRole("button", { name: "Ajouter un signet", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Retour à ma bibliothèque", exact: true })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  const original = (await storedRows(page, "books"))[0];
  const position = (await storedRows(page, "positions"))[0];
  const requests = [];
  page.on("request", (request) => {
    if (/\/books\/[^/]+\.epub$/.test(new URL(request.url()).pathname))
      requests.push(request.url());
  });
  await goTo(page, "discover");
  await page
    .locator('[data-action="catalog-read"][data-id="selection-le-horla"]')
    .first()
    .click();
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await expect(page.locator("#chapter-content")).toContainText(
    "Cette édition importée",
  );
  expect(requests).toEqual([]);
  const after = await storedRows(page, "books");
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(original.id);
  expect((await storedRows(page, "positions"))[0].bookmarks).toEqual(
    position.bookmarks,
  );
});

test("une édition dans une autre langue ne remplace pas le livre français choisi", async ({
  page,
}) => {
  await page.goto("/");
  await importEpub(
    page,
    await makeEpub({
      title: "Le Horla",
      author: "Guy de Maupassant",
      language: "en",
      paragraphs: [
        "This separate edition must remain in its original language and keep its own reading position.",
      ],
    }),
  );
  await expect(page.locator(".reader-title strong")).toHaveText("Le Horla");
  await page
    .getByRole("button", { name: "Ajouter un signet", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Retour à ma bibliothèque", exact: true })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  const imported = (await storedRows(page, "books"))[0];
  const originalPosition = (await storedRows(page, "positions"))[0];
  await goTo(page, "discover");
  const card = page
    .locator(".catalog-grid .book-card")
    .filter({ has: page.locator('[data-id="selection-le-horla"]') });
  await expect(card).not.toContainText("Dans votre bibliothèque");
  await card
    .getByRole("button", { name: "Lire Le Horla", exact: true })
    .click();
  await expect(page.locator("#rsvp-word")).toHaveText("8");
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(2);
  expect(books.find((book) => book.id === imported.id).language).toBe("en");
  expect(books.find((book) => book.id !== imported.id).source.bookId).toBe(
    "selection-le-horla",
  );
  expect(
    (await storedRows(page, "positions")).find(
      (position) => position.id === imported.id,
    ).bookmarks,
  ).toEqual(originalPosition.bookmarks);
});

test("l’accueil explique les trois modes et la démo reste hors de la bibliothèque", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-intro")).toBeVisible();
  await expect(page.locator(".home-mode h2")).toHaveText(["Mot à mot", "Classique", "Focus"]);
  const help = page.locator(".home-help");
  await expect(help).not.toHaveAttribute("open", "");
  await help.locator("summary").click();
  await expect(help.locator("ol")).toBeVisible();
  await expect(help).toContainText("sans compte");
  await page.getByRole("button", { name: "Essayer le lecteur", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(0);
  await expect(page.locator(".suggestions-section")).toHaveCount(0);
  await expect(page.locator('[data-action="demo"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Voir les suggestions", exact: true }).click();
  await expect(page).toHaveURL(/#home$/);
  await expect(cards(page)).toHaveCount(3);
});
