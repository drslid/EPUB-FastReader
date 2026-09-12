import { expect, test } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

async function openBackup(page) {
  await page.locator('.page-footer [data-action="backup"]').click();
  await expect(page.getByRole("dialog", { name: "Sauvegarde" })).toBeVisible();
  await expect(page.locator("#backup-export")).toBeEnabled();
}

test("la sauvegarde ZIP restaure le livre original, ses repères et sa position sans créer de doublons", async ({ page }, testInfo) => {
  const failures = [];
  page.on("pageerror", (cause) => failures.push(cause.message));
  const original = await makeEpub({ title: "Une bibliothèque à garder" });
  await page.goto("/");
  await importEpub(page, original, "a-garder.epub");
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Avancer de dix mots", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  const word = await page.locator("#rsvp-word").innerText();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  const position = (await storedRows(page, "positions"))[0];
  await openBackup(page);
  const pending = page.waitForEvent("download");
  await page.locator("#backup-export").click();
  const download = await pending;
  const filePath = testInfo.outputPath("bibliotheque.zip");
  await download.saveAs(filePath);
  await expect(page.locator("#backup-status")).toContainText("Sauvegarde prête : 1 livre");
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  expect(await zip.file(manifest.books[0].path).async("nodebuffer")).toEqual(original);
  expect(manifest.positions[0].locator).toEqual(position.locator);
  await page.locator("#backup-close").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Supprimer Une bibliothèque à garder", exact: true }).click();
  await expect.poll(async () => (await storedRows(page, "books")).length).toBe(0);
  await openBackup(page);
  await page.locator("#backup-file").setInputFiles(filePath);
  await page.locator("#backup-restore").click();
  await expect(page.locator("#backup-status")).toContainText("Restauration terminée. Livres ajoutés : 1");
  expect((await storedRows(page, "positions"))[0].locator).toEqual(position.locator);
  expect((await storedRows(page, "positions"))[0].bookmarks).toHaveLength(1);
  await page.locator("#backup-file").setInputFiles(filePath);
  await page.locator("#backup-restore").click();
  await expect(page.locator("#backup-status")).toContainText("Livres ajoutés : 0 ; déjà présents : 1");
  expect(await storedRows(page, "books")).toHaveLength(1);
  await page.locator("#backup-close").click();
  await page.getByRole("button", { name: "Lire Une bibliothèque à garder", exact: true }).click();
  await expect(page.locator("#rsvp-word")).toHaveText(word);
  expect(failures).toEqual([]);
});

test("la restauration invalide garde la bibliothèque intacte et le dialogue reste accessible sur mobile", async ({ page }) => {
  await page.goto("/");
  await importEpub(page, await makeEpub({ title: "Toujours présent" }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  const before = (await storedRows(page, "books")).map(({ id, title }) => ({ id, title }));
  await openBackup(page);
  await page.locator("#backup-file").setInputFiles({ name: "invalide.zip", mimeType: "application/zip", buffer: Buffer.from("ceci ne contient pas de sauvegarde") });
  await page.locator("#backup-restore").click();
  await expect(page.locator("#backup-status")).toHaveAttribute("data-error", "true");
  await expect(page.locator("#backup-restore")).toBeEnabled();
  expect((await storedRows(page, "books")).map(({ id, title }) => ({ id, title }))).toEqual(before);
  expect(await page.locator(".backup-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator("#backup-close").focus();
  await page.keyboard.press("Shift+Tab");
  expect(await page.locator(".backup-dialog").evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".backup-dialog")).toHaveCount(0);
  await expect(page.locator('.page-footer [data-action="backup"]')).toBeFocused();
});

test("restaurer après un retour navigateur au lecteur conserve les nouveaux repères fusionnés", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (cause) => failures.push(cause.message));
  const original = await makeEpub({ title: "La lecture en cours de restauration" });
  await page.goto("/");
  await importEpub(page, original);
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Avancer de dix mots", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un signet", exact: true }).click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque", exact: true }).click();
  await expect(page.locator(".page-footer")).toBeVisible();
  const book = (await storedRows(page, "books"))[0];
  const currentPosition = (await storedRows(page, "positions"))[0];

  // Simulate a valid backup from another device: the local position must win,
  // while its additional bookmark and annotation must survive re-opening.
  const incoming = {
    ...currentPosition,
    wordIndex: 0,
    bookmarks: [...currentPosition.bookmarks, {
      id: "bookmark-other-device",
      chapterIndex: 0,
      locator: currentPosition.locator,
      createdAt: Date.now(),
    }],
    annotations: [{
      id: "annotation-other-device",
      chapterIndex: 0,
      locator: currentPosition.locator,
      quote: currentPosition.locator.exact,
      note: "Une note ajoutée sur un autre appareil.",
      createdAt: Date.now(),
    }],
  };
  const zip = new JSZip();
  zip.file("books/0000.epub", original, { createFolders: false });
  zip.file("manifest.json", JSON.stringify({
    format: "fastreader-backup",
    version: 1,
    books: [{ id: book.id, kind: "epub", path: "books/0000.epub", fileName: "lecture.epub" }],
    positions: [incoming],
    preferences: [],
  }));
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  await openBackup(page);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#read=${book.id}$`));
  await expect(page.locator("#rsvp")).toBeAttached();
  await expect(page.locator(".backup-dialog")).toBeVisible();
  await page.locator("#backup-file").setInputFiles({
    name: "autre-appareil.zip",
    mimeType: "application/zip",
    buffer,
  });
  await page.locator("#backup-restore").click();
  await expect(page.locator("#backup-status")).toContainText("Restauration terminée");
  const restored = (await storedRows(page, "positions"))[0];
  expect(restored.wordIndex).toBe(currentPosition.wordIndex);
  expect(restored.locator).toEqual(currentPosition.locator);
  expect(restored.bookmarks).toHaveLength(2);
  expect(restored.annotations[0].id).toBe("annotation-other-device");
  await page.locator("#backup-close").click();
  await page.getByRole("button", { name: "Mes repères", exact: false }).click();
  await expect(page.locator(".bookmark-row")).toHaveCount(2);
  await expect(page.locator(".annotation-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect((await storedRows(page, "positions"))[0].bookmarks).toHaveLength(2);
  expect((await storedRows(page, "positions"))[0].annotations).toHaveLength(1);
  expect(failures).toEqual([]);
});
