import { expect, test } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });
const locales = [
  ["fr", "Ma bibliothèque", "Mot à mot", "Importer un EPUB", "Sauvegarde"],
  ["en", "My library", "Word by word", "Import an EPUB", "Backup"],
  ["es", "Mi biblioteca", "Palabra a palabra", "Importar un EPUB", "Copia de seguridad"],
  ["it", "La mia biblioteca", "Parola per parola", "Importa un EPUB", "Backup"],
  ["de", "Meine Bibliothek", "Wort für Wort", "EPUB importieren", "Sicherung"],
  ["pt", "A minha biblioteca", "Palavra a palavra", "Importar um EPUB", "Cópia de segurança"],
];
const invalidMessages = {
  fr: "Ce fichier n’est pas une archive EPUB valide.",
  en: "This file is not a valid EPUB archive.",
  es: "Este archivo no es un EPUB válido.",
  it: "Questo file non è un archivio EPUB valido.",
  de: "Diese Datei ist kein gültiges EPUB-Archiv.",
  pt: "Este ficheiro não é um arquivo EPUB válido.",
};
const switchLanguage = async (page, code) => {
  await page.locator(".language-picker > summary").click();
  await page.locator(`[data-locale="${code}"]`).click();
  await expect(page.locator("html")).toHaveAttribute("lang", code);
  await expect(page.locator(".language-picker summary")).toContainText(code.toUpperCase());
};

test("all six languages cover home, search, library, backup, installation and reading", async ({ page }) => {
  for (const [code, library, mode, importLabel, backupLabel] of locales) {
    await page.goto(code === "fr" ? "/" : `/${code}.html`);
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", code);
    await expect(page.locator("#search-form")).toBeVisible();
    await expect(page.locator('.sidebar a[href="#library"]')).toContainText(library);
    await expect(page.locator('.topbar [data-action="import"]')).toHaveAttribute("aria-label", importLabel);
    await page.locator('[data-action="demo"]').click();
    await expect(page.locator('[data-mode="rsvp"]')).toHaveText(mode);
    await expect(page.locator("#chapter-content")).toHaveAttribute("lang", code);
    await page.locator('[data-action="settings"]').first().click();
    await expect(page.locator("#reading-preview")).toBeVisible();
    await expect(page.locator("#reader-settings .language-picker a")).toHaveCount(6);
    await page.keyboard.press("Escape");
    await page.locator('.reader-back').click();
    await expect(page.locator("#main h1")).toHaveText(library);
    await page.locator('[data-action="backup"]:visible').first().click();
    await expect(page.locator("#backup-title")).toBeVisible();
    await expect(page.locator("#backup-title")).toHaveText(backupLabel);
    await expect(page.locator(".backup-dialog")).toHaveAttribute("aria-busy", "false");
    await page.keyboard.press("Escape");
    await expect(page.locator(".backup-dialog")).toHaveCount(0);
    await page.locator('[data-action="install"]:visible').first().click();
    await expect(page.locator("dialog")).toContainText("Android");
    if (code !== "fr") await expect(page.locator("dialog")).not.toContainText("Retrouvez le lecteur");
    await page.keyboard.press("Escape");
    await page.locator('.sidebar a[href="#discover"]').click();
    await expect(page.locator('[data-action="catalog-read"]').first()).toBeVisible();
    await expect(page.locator("#search-language option[value=it]")).toHaveCount(1);
    await expect(page.locator("#search-language option[value=pt]")).toHaveCount(1);
    await page.locator("#epub-file").setInputFiles({ name: "invalid.epub", mimeType: "application/epub+zip", buffer: Buffer.from("Not a valid ZIP archive. ".repeat(5)) });
    await expect(page.locator("#toast")).toHaveText(invalidMessages[code]);
  }
});

test("switching language preserves the EPUB, bookmarks, reading position and saved choice", async ({ page }) => {
  await page.goto("/");
  await importEpub(page, await makeEpub({ title: "Mon livre original", paragraphs: ["Votre note ne doit jamais être traduite. Une histoire personnelle continue.".repeat(6)] }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.locator('[data-action="forward"]').click();
  await page.locator('.reader-header [data-action="bookmark"]').click();
  const before = (await storedRows(page, "positions"))[0];
  const original = (await storedRows(page, "books"))[0];
  await page.locator('[data-action="settings"]').first().click();
  await switchLanguage(page, "de");
  await expect(page).toHaveURL(/de\.html#read=/);
  await expect(page.locator(".reader-title strong")).toHaveText("Mon livre original");
  await expect(page.locator("#chapter-content")).toHaveAttribute("lang", "fr");
  await expect(page.locator("#chapter-content")).toContainText("Votre note ne doit jamais être traduite.");
  const after = (await storedRows(page, "positions"))[0];
  expect(after.wordIndex).toBe(before.wordIndex);
  expect(after.bookmarks).toEqual(before.bookmarks);
  expect((await storedRows(page, "books"))[0].chapters).toEqual(original.chapters);
  await page.keyboard.press("Escape");
  await page.locator(".reader-back").click();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page).toHaveURL(/de\.html$/);
  await switchLanguage(page, "en");
  await page.goBack();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator('.sidebar a[href="#library"]')).toContainText("Meine Bibliothek");
  await page.goForward();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await switchLanguage(page, "fr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  expect((await storedRows(page, "preferences")).find((item) => item.id === "reader").locale).toBe("fr");
});

test("explicit French links and combined language/reader history restore the intended page", async ({ page, context }) => {
  await page.goto("/");
  await importEpub(page, await makeEpub({ title: "Le livre de mon historique" }));
  await expect(page.locator("#rsvp")).toBeVisible();
  const originalRoute = page.url();
  await page.locator('[data-action="settings"]').first().click();
  await switchLanguage(page, "de");
  await page.keyboard.press("Escape");
  await page.locator(".reader-back").click();
  await switchLanguage(page, "en");
  await page.goBack();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("#main h1")).toHaveText("Meine Bibliothek");
  await page.goBack();
  await expect(page.locator(".reader-title strong")).toHaveText("Le livre de mon historique");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.goBack();
  await expect(page).toHaveURL(originalRoute);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator(".reader-title strong")).toHaveText("Le livre de mon historique");
  await page.locator(".reader-back").click();
  await switchLanguage(page, "en");
  // Follow the actual href in a new tab: its explicit French hint must win
  // over the shared IndexedDB preference saved as English by this tab.
  const frenchHref = await page.locator('[data-locale="fr"]').getAttribute("href");
  const other = await context.newPage();
  await other.goto(new URL(frenchHref, page.url()).href);
  await expect(other.locator("html")).toHaveAttribute("lang", "fr");
  await expect(other.locator("#main h1")).toHaveText("Ma bibliothèque");
  await expect(other).not.toHaveURL(/lang=/);
  await other.close();
});

test("language selector is keyboard accessible and translated layouts fit a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  for (const [code] of locales) {
    await switchLanguage(page, code);
    const summary = page.locator(".language-picker > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".language-picker")).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-locale="fr"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(summary).toBeFocused();
    await expect(page.locator(".language-picker")).not.toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.locator('[data-action="demo"]').click();
    await expect(page.locator("#rsvp")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.locator(".reader-back").click();
    await page.locator('.sidebar nav a[href="#home"]').click();
  }
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
});
