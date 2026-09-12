import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

test("les livres importés se retrouvent par la recherche commune et se suppriment avec leurs repères", async ({
  page,
}) => {
  await page.goto("/");
  await importEpub(
    page,
    await makeEpub({ title: "Étoiles du matin", author: "Louise Céleste" }),
  );
  await expect(page.locator(".reader-title strong")).toHaveText(
    "Étoiles du matin",
  );
  await page.getByRole("button", { name: "Ajouter un signet" }).click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(
    page.getByRole("button", { name: "Lire Étoiles du matin", exact: true }),
  ).toBeVisible();
  await importEpub(
    page,
    await makeEpub({ title: "Les chemins de mer", author: "Paul Marin" }),
  );
  await expect(page.locator(".reader-title strong")).toHaveText(
    "Les chemins de mer",
  );
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(2);
  await page
    .getByRole("searchbox", { name: "Titre ou auteur" })
    .fill("etoiles");
  await page
    .locator("#search-form")
    .evaluate((form) => form.requestSubmit());
  await expect(page).toHaveURL(/#search\?/);
  await expect(page.locator(".local-results .book-card")).toHaveCount(1);
  await expect(
    page.locator(".local-results").getByRole("button", { name: "Lire Étoiles du matin", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Titre ou auteur" })
    .fill("MARIN");
  await page
    .locator("#search-form")
    .evaluate((form) => form.requestSubmit());
  await expect(
    page.locator(".local-results").getByRole("button", { name: "Lire Les chemins de mer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Titre ou auteur" })
    .fill("aucunlivrezxy");
  await page
    .locator("#search-form")
    .evaluate((form) => form.requestSubmit());
  await expect(page.locator(".local-results .book-card")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: /Ma bibliothèque/ })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(2);
  await expect(page.getByRole("searchbox", { name: "Titre ou auteur" })).toHaveValue("");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Supprimer Étoiles du matin", exact: true })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Supprimer Étoiles du matin", exact: true })
    .click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  const books = await storedRows(page, "books");
  const positions = await storedRows(page, "positions");
  expect(books.map((book) => book.title)).toEqual(["Les chemins de mer"]);
  expect(positions.every((position) => position.id === books[0].id)).toBe(true);
  await page.reload();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Lire Les chemins de mer", exact: true }),
  ).toBeVisible();
});

test("l’EPUB original téléchargé conserve exactement les octets importés, même après une lecture Focus", async ({
  page,
}, testInfo) => {
  const original = await makeEpub();
  await page.goto("/");
  await importEpub(page, original, "original.epub");
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger l’EPUB original", exact: true })
    .click();
  const download = await downloadPromise;
  const filename = testInfo.outputPath("original.epub");
  await download.saveAs(filename);
  expect(await readFile(filename)).toEqual(original);
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(
    page.getByRole("heading", { name: "Ma bibliothèque", exact: true }),
  ).toBeVisible();
  await importEpub(page, original, "reimport.epub");
  await expect(page.locator(".reader-title strong")).toHaveText(
    "Un livre pour tester",
  );
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(page.locator(".library-section .book-card")).toHaveCount(1);
});

test("le thème sépia est global par défaut et le cycle sombre, clair, sépia persiste en base navigateur", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  await page.getByRole("button", { name: "Passer au thème sombre", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  const darkBackground = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page
    .getByRole("button", { name: "Passer au thème clair", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  await page.goto("/#discover");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  await page.getByRole("button", { name: "Passer au thème sépia", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  await page.getByRole("button", { name: "Passer au thème sombre", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await page.getByRole("button", { name: "Passer au thème clair", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  await page.goto("/#home");
  await page
    .getByRole("button", { name: "Essayer le lecteur", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "paper");
  const lightBackground = await page
    .locator(".reader-shell")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(lightBackground).not.toBe(darkBackground);
  const lightChannels = lightBackground.match(/\d+/g).slice(0, 3).map(Number);
  expect(Math.min(...lightChannels)).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  const panelChannels = await page
    .locator("#reader-settings")
    .evaluate((element) =>
      getComputedStyle(element)
        .backgroundColor.match(/\d+/g)
        .slice(0, 3)
        .map(Number),
    );
  expect(Math.min(...panelChannels)).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Sépia", exact: true }).click();
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  expect(await storedRows(page, "preferences")).not.toHaveLength(0);
});

test("les exports Classique et Focus sont accessibles directement depuis un livre enregistré", async ({ page }, testInfo) => {
  const JSZip = (await import("jszip")).default;
  const original = await makeEpub({ title: "Livre à emporter" });
  await page.goto("/");
  await importEpub(page, original);
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  const menu = page.locator(".library-section .book-export");
  await menu.locator("summary").click();
  for (const format of ["Classique", "Focus"]) {
    const pending = page.waitForEvent("download");
    await menu.getByRole("button", { name: `Télécharger en ${format} : Livre à emporter`, exact: true }).click();
    const download = await pending;
    const filePath = testInfo.outputPath(`library-${format}.epub`);
    await download.saveAs(filePath);
    const buffer = await readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file("mimetype").async("string")).toBe("application/epub+zip");
    const chapterFiles = zip.file(/\.(?:xhtml|html)$/);
    expect(chapterFiles.length).toBeGreaterThan(0);
    const chapterTexts = await Promise.all(chapterFiles.map((chapter) => chapter.async("string")));
    if (format === "Focus") expect(chapterTexts.join("\n")).toContain("focus-prefix");
    else expect(chapterTexts.join("\n")).not.toContain("focus-prefix");
    await expect(page).toHaveURL(/#library$/);
    // Rendering after a completed export may close the native disclosure.
    if ((await menu.getAttribute("open")) === null) await menu.locator("summary").click();
  }
  expect(await storedRows(page, "books")).toHaveLength(1);
});
