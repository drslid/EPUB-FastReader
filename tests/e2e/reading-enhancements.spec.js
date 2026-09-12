import { expect, test } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

async function openReader(page) {
  await page.goto("/");
  await importEpub(page, await makeEpub({ paragraphs: ["Voici une première phrase. Une seconde phrase à retrouver. Puis une autre histoire."], chapters: 3 }));
  await expect(page.locator("#rsvp")).toBeVisible();
}

test("les profils et réglages Focus ont un aperçu immédiat et survivent à la fermeture", async ({ page }) => {
  await openReader(page);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Réglages de lecture", exact: true }).click();
  await page.locator("#reading-profile").selectOption("comfort");
  await expect(page.locator("#font-size")).toHaveValue("23");
  await expect(page.locator("#reading-preview")).toHaveCSS("line-height", "46px");
  await page.getByText("Ajuster la mise en page et Focus", { exact: true }).click();
  await page.locator("#focus-intensity").fill("70");
  await expect(page.locator("#focus-intensity-value")).toHaveText("70 %");
  await page.locator("#skip-short-words").check();
  await expect(page.locator("#reading-preview .focus-prefix").first()).toHaveText("soi");
  await expect(page.locator("#chapter-content .focus-prefix").first()).toHaveText("Chapit");
  await page.getByRole("button", { name: "Fermer les réglages", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator("#chapter-scroll")).toBeVisible();
  await page.getByRole("button", { name: "Réglages de lecture", exact: true }).click();
  await expect(page.locator("#font-family")).toHaveValue("humanist");
  await expect(page.locator("#focus-intensity")).toHaveValue("70");
  await expect(page.locator("#skip-short-words")).toBeChecked();
  await page.getByText("Ajuster la mise en page et Focus", { exact: true }).click();
  await page.getByRole("button", { name: "Réinitialiser le confort" }).click();
  await expect(page.locator("#font-size")).toHaveValue("20");
  await expect(page.locator("#focus-intensity")).toHaveValue("50");
});

test("le lecteur commence en Sépia et Verdana, présente les modes dans l’ordre et applique chaque police", async ({ page }) => {
  await openReader(page);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  await expect(page.locator("#rsvp-word")).toHaveCSS("font-family", /Verdana/);
  await expect(page.locator(".reading-modes button")).toHaveText(["Mot à mot", "Focus", "Classique"]);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Réglages de lecture", exact: true }).click();
  await expect(page.locator('.mode-option input')).toHaveCount(3);
  expect(await page.locator('.mode-option input').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(["rsvp", "focus", "classic"]);
  await expect(page.locator("#font-family")).toHaveValue("humanist");
  for (const [value, family] of [["humanist", /Verdana/], ["sans", /Arial/], ["serif", /Georgia/], ["palatino", /Palatino/], ["trebuchet", /Trebuchet/], ["system", /system-ui/]]) {
    await page.locator("#font-family").selectOption(value);
    await expect(page.locator("#chapter-content")).toHaveCSS("font-family", family);
    await expect(page.locator("#reading-preview")).toHaveCSS("font-family", family);
  }
  await page.reload();
  await page.getByRole("button", { name: "Réglages de lecture", exact: true }).click();
  await expect(page.locator("#font-family")).toHaveValue("system");
  await expect(page.locator("#chapter-content")).toHaveCSS("font-family", /system-ui/);
});

test("le sommaire est accessible directement et les panneaux gardent le focus clavier", async ({ page }) => {
  await openReader(page);
  await page.getByRole("button", { name: "Sommaire", exact: true }).click();
  const toc = page.getByRole("dialog", { name: "Sommaire", exact: true });
  await toc.getByRole("button", { name: "2. Chapitre 2" }).click();
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 2");
  await expect(toc).toHaveCount(0);
  await page.getByRole("button", { name: "Réglages de lecture", exact: true }).click();
  await expect(page.locator(".reading-main")).toHaveAttribute("inert", "");
  const advanced = page.getByText("Ajuster la mise en page et Focus", { exact: true });
  await advanced.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".advanced-reading")).toHaveAttribute("open", "");
  await expect(page.locator("#play-button")).not.toContainText("Pause");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 2");
  await page.locator("#chapter-select").selectOption("2");
  await expect(page.locator("#chapter-select")).toBeFocused();
  await expect(page.locator("#reader-announcement")).toHaveText("Chapitre 3 sur 3 : Chapitre 3");
  const close = page.getByRole("button", { name: "Fermer les réglages", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement.closest("#reader-settings") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#reader-settings")).toBeHidden();
  await expect(page.getByRole("button", { name: "Réglages de lecture", exact: true })).toBeFocused();
});

test("l’aide d’installation reste accessible quand le navigateur ne propose pas de bouton natif", async ({ page }) => {
  await page.goto("/#library");
  await page.locator('[data-action="install"]:visible').first().click();
  const help = page.getByRole("dialog", { name: "Installer FastReader", exact: true });
  await expect(help).toContainText("iPhone / iPad");
  await expect(help).toContainText("Android");
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(page.locator('[data-action="install"]:visible').first()).toBeFocused();
});

test("la réduction des mouvements choisit Classique initialement et respecte un choix explicite", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Essayer le lecteur", exact: true }).click();
  await expect(page.getByRole("button", { name: "Classique", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Mot à mot", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mot à mot", exact: true })).toHaveAttribute("aria-pressed", "true");
  const position = await page.locator("#rsvp-count").textContent();
  await page.waitForTimeout(350);
  await expect(page.locator("#rsvp-count")).toHaveText(position);
  await page.reload();
  await expect(page.getByRole("button", { name: "Classique", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#rsvp")).toBeHidden();
});

test("le téléphone garde son écran pendant la lecture et libère le verrou à la pause ou au masquage", async ({ page }) => {
  await page.addInitScript(() => {
    window.wakeEvents = [];
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => {
      window.wakeEvents.push("request");
      const sentinel = new EventTarget();
      sentinel.release = async () => { window.wakeEvents.push("release"); sentinel.dispatchEvent(new Event("release")); };
      return sentinel;
    } } });
  });
  await openReader(page);
  await page.locator("#play-button").click();
  await expect(page.locator("#wake-lock-status")).toBeVisible();
  await page.locator("#play-button").click();
  await expect(page.locator("#wake-lock-status")).toBeHidden();
  expect(await page.evaluate(() => window.wakeEvents)).toEqual(["request", "release"]);
  await page.locator("#play-button").click();
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#play-button")).toContainText("Reprendre");
  expect(await page.evaluate(() => window.wakeEvents)).toEqual(["request", "release", "request", "release"]);
  expect((await storedRows(page, "positions"))[0]).toHaveProperty("locator");
});

test("accueil, bibliothèque, découverte et les trois modes passent les contrôles axe", async ({ page }) => {
  const audit = async () => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  };
  for (const route of ["/", "/#library", "/#discover"]) {
    await page.goto(route);
    await expect(page.locator("#main h1")).toBeVisible();
    await audit();
  }
  await openReader(page);
  for (const mode of ["Mot à mot", "Classique", "Focus"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await audit();
  }
  await page.getByRole("button", { name: "Réglages de lecture", exact: true }).click();
  await audit();
});
