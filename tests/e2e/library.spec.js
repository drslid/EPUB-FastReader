import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
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

test("le téléchargement Classique retire Focus sans modifier l’EPUB original conservé dans la bibliothèque", async ({
  page,
}, testInfo) => {
  const original = await makeEpub({
    paragraphs: ['Une <strong>histoire</strong> <strong class="focus-prefix">in</strong>oubliable à retrouver dans le livre.'],
  });
  await page.goto("/");
  await importEpub(page, original, "original.epub");
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger l’EPUB", exact: true })
    .click();
  const download = await downloadPromise;
  const filename = testInfo.outputPath("classic.epub");
  await download.saveAs(filename);
  const zip = await JSZip.loadAsync(await readFile(filename));
  const chapter = await zip.file("chapter0.xhtml").async("string");
  expect(chapter).not.toContain("focus-prefix");
  expect(chapter).toMatch(/<strong(?:\s[^>]*)?>histoire<\/strong>/);
  expect(chapter).toContain("inoubliable");
  const savedBytes = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("fastreader");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("books").objectStore("books").getAll();
      request.onsuccess = () => { db.close(); resolve(Array.from(new Uint8Array(request.result[0].original))); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }));
  expect(Buffer.from(savedBytes)).toEqual(original);
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

test("un seul bouton télécharge une édition Classique réimportable depuis la bibliothèque", async ({ page }, testInfo) => {
  const original = await makeEpub({
    title: "Livre à emporter",
    paragraphs: ['Un <strong>passage important</strong> et <strong class="focus-prefix">quel</strong>ques mots à conserver.'],
  });
  await page.goto("/");
  await importEpub(page, original);
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.locator(".library-section details.book-export")).toHaveCount(0);
  const button = page.getByRole("button", { name: "Télécharger en Classique : Livre à emporter", exact: true });
  await expect(button).toHaveText("Télécharger l’EPUB");
  const pending = page.waitForEvent("download");
  await button.click();
  const download = await pending;
  const filePath = testInfo.outputPath("library-classic.epub");
  await download.saveAs(filePath);
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  expect(await zip.file("mimetype").async("string")).toBe("application/epub+zip");
  const chapterFiles = zip.file(/\.(?:xhtml|html)$/);
  expect(chapterFiles.length).toBeGreaterThan(0);
  const chapterTexts = await Promise.all(chapterFiles.map((chapter) => chapter.async("string")));
  expect(chapterTexts.join("\n")).not.toContain("focus-prefix");
  expect(chapterTexts.join("\n")).toMatch(/<strong(?:\s[^>]*)?>passage important<\/strong>/);
  await expect(page).toHaveURL(/#library$/);
  expect(await storedRows(page, "books")).toHaveLength(1);
  await importEpub(page, buffer, "classic-reimport.epub");
  await expect(page.locator(".reader-title strong")).toHaveText("Livre à emporter");
  await page.getByRole("button", { name: "Classique", exact: true }).click();
  await expect(page.locator("#chapter-content")).toContainText("Un passage important et quelques mots à conserver.");
  await expect(page.locator("#chapter-content .focus-prefix")).toHaveCount(0);
});
