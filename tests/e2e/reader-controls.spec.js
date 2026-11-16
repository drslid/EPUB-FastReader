import { expect, test } from "./fixtures.js";
import { importEpub, makeEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

async function openDemo(page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Essayer le lecteur", exact: true })
    .click();
  await expect(page.locator("#rsvp")).toBeVisible();
}

async function expectFixedLetter(page, letter) {
  const pivot = page.locator(".rsvp-pivot-letter");
  await expect(pivot).toHaveText(letter);
  await expect.poll(() => pivot.evaluate((element) => {
    const stage = element.closest(".rsvp-stage");
    const stageBounds = stage.getBoundingClientRect();
    const pivotBounds = element.getBoundingClientRect();
    const stageLeft = stageBounds.left + stage.clientLeft;
    const axis = stage.clientWidth * 0.4;
    const pivotCenter = pivotBounds.left + pivotBounds.width / 2 - stageLeft;
    const guideOffsets = ["::before", "::after"].map((guide) => {
      const style = getComputedStyle(stage, guide);
      return Math.abs(parseFloat(style.left) + parseFloat(style.width) / 2 - axis);
    });
    return Math.max(Math.abs(pivotCenter - axis), ...guideOffsets);
  })).toBeLessThanOrEqual(1);
}

test("la lettre de fixation est colorée et son réglage survit au rechargement", async ({ page }) => {
  await openDemo(page);
  const stage = page.locator(".rsvp-stage");
  const word = page.locator("#rsvp-word");
  const pivot = page.locator(".rsvp-pivot-letter");
  const currentWord = await word.textContent();
  await expect(stage).toHaveAttribute("data-fixation");
  await expect(pivot).toBeVisible();
  expect(await pivot.evaluate((letter) => getComputedStyle(letter).color))
    .not.toBe(await word.evaluate((element) => getComputedStyle(element).color));

  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  const fixation = page.locator("#rsvp-fixation");
  await expect(fixation).toBeChecked();
  await fixation.uncheck();
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await expect(stage).not.toHaveAttribute("data-fixation");
  await expect(pivot).toBeHidden();
  await expect(word).toHaveText(currentWord);

  await page.reload();
  await expect(word).toHaveText(currentWord);
  await expect(stage).not.toHaveAttribute("data-fixation");
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await expect(fixation).not.toBeChecked();
  await fixation.check();
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await expect(stage).toHaveAttribute("data-fixation");
  await expect(pivot).toBeVisible();
  await expect(word).toHaveText(currentWord);
});

test("les commandes du mot à mot respectent pause, clavier, bornes de vitesse et retour arrière", async ({
  page,
}) => {
  await openDemo(page);
  await expect(
    page.getByRole("button", { name: "Mot à mot", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Chapitre précédent", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reculer de dix mots", exact: true })
    .click();
  await expect(page.locator("#rsvp-count")).toContainText("1 /");
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await page.locator("#reading-speed").fill("100");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page
    .getByRole("button", { name: "Ralentir de 25 mots par minute" })
    .click();
  await expect(page.locator("#quick-speed")).toHaveText("100");
  await page
    .getByRole("button", { name: "Accélérer de 25 mots par minute" })
    .click();
  await expect(page.locator("#quick-speed")).toHaveText("125");
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await page.locator("#reading-speed").fill("800");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page
    .getByRole("button", { name: "Accélérer de 25 mots par minute" })
    .click();
  await expect(page.locator("#quick-speed")).toHaveText("800");
  await page.locator("#main").focus();
  const initial = await page.locator("#rsvp-count").textContent();
  await page.keyboard.press("Space");
  await expect(page.locator("#rsvp-count")).not.toHaveText(initial);
  await page.keyboard.press("Space");
  const paused = await page.locator("#rsvp-count").textContent();
  await page.waitForTimeout(220);
  await expect(page.locator("#rsvp-count")).toHaveText(paused);
  await page.getByRole("button", { name: "Avancer de dix mots" }).click();
  await expect(page.locator("#rsvp-count")).not.toHaveText(paused);
  await page.getByRole("button", { name: "Reculer de dix mots" }).click();
  await expect(page.locator("#rsvp-count")).toHaveText(paused);
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await page.locator("#font-family").selectOption("sans");
  await expect(page.locator("#chapter-content")).toHaveCSS(
    "font-family",
    /sans-serif/,
  );
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.reload();
  await expect(page.locator("#rsvp-count")).toHaveText(paused);
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await expect(page.locator("#font-family")).toHaveValue("sans");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  for (const [open, close] of [
    ["Réglages de lecture", "Fermer les réglages"],
    ["Mes repères", "Fermer mes repères"],
  ]) {
    const before = await page.locator("#rsvp-count").textContent();
    await page.locator("#play-button").click();
    await expect(page.locator("#rsvp-count")).not.toHaveText(before);
    await page.getByRole("button", { name: open, exact: true }).click();
    const stopped = await page.locator("#rsvp-count").textContent();
    await page.waitForTimeout(220);
    await expect(page.locator("#rsvp-count")).toHaveText(stopped);
    await expect(page.locator("#play-button")).toContainText("Reprendre");
    await page.getByRole("button", { name: close, exact: true }).click();
  }
  await page.locator("#play-button").click();
  await page
    .getByRole("button", { name: "Ajouter un signet", exact: true })
    .click();
  const marked = await page.locator("#rsvp-count").textContent();
  await page.waitForTimeout(220);
  await expect(page.locator("#rsvp-count")).toHaveText(marked);
});

test("le choix des chapitres, la fin d’un chapitre et la fin du livre sauvegardent la bonne progression", async ({
  page,
}) => {
  await page.goto("/");
  await importEpub(page, await makeEpub({ paragraphs: ["Fin."], chapters: 2 }));
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await page.locator("#reading-speed").fill("800");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.locator("#play-button").click();
  await expect(page.locator("#toast")).toContainText("Fin du chapitre");
  await expect(page.locator("#play-button")).not.toContainText("Pause");
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await page.locator("#chapter-select").selectOption("1");
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 2");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page
    .getByRole("button", { name: "Chapitre précédent", exact: true })
    .click();
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 1");
  await page
    .getByRole("button", { name: "Chapitre suivant", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Terminer le livre", exact: true })
    .click();
  await expect(page).toHaveURL(/#library$/);
  await expect(
    page.locator(".library-section .book-card progress"),
  ).toHaveAttribute("value", "1");
  expect((await storedRows(page, "positions"))[0].progress).toBe(1);
  await page.reload();
  await expect(
    page.locator(".library-section .book-card progress"),
  ).toHaveAttribute("value", "1");
});

for (const viewport of [
  { width: 375, height: 740 },
  { width: 320, height: 640 },
  { width: 812, height: 375 },
]) {
  test(`le mot et les commandes restent stables avec un contexte long à ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const longWord = "anticonstitutionnellement";
    const words = Array.from({ length: 100 }, (_, index) =>
      index < 16 ? "un" : index < 50 ? longWord : "respiration",
    );
    await page.goto("/");
    await importEpub(
      page,
      await makeEpub({ paragraphs: [words.join(" ")], chapters: 1 }),
    );
    await expect(page.locator("#rsvp")).toBeVisible();
    const before = await page.locator(".rsvp-stage").boundingBox();
    const controlBefore = await page.locator("#play-button").boundingBox();
    const forward = page.getByRole("button", { name: "Avancer de dix mots" });
    await forward.click();
    await expect(page.locator("#rsvp-word")).toHaveText("un");
    await expectFixedLetter(page, "n");
    await forward.click();
    await expect(page.locator("#rsvp-word")).toHaveText(longWord);
    await expectFixedLetter(page, "c");
    const after = await page.locator(".rsvp-stage").boundingBox();
    const controlAfter = await page.locator("#play-button").boundingBox();
    const word = await page.locator("#rsvp-word").evaluate((element) => {
      const text = document.createRange();
      text.selectNodeContents(element);
      return text.getBoundingClientRect().toJSON();
    });
    expect(
      Math.abs(before.y + before.height / 2 - after.y - after.height / 2),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBefore.y - controlAfter.y)).toBeLessThanOrEqual(1);
    expect(word.left).toBeGreaterThanOrEqual(after.x - 1);
    expect(word.right).toBeLessThanOrEqual(after.x + after.width + 1);
    expect(word.height).toBeLessThanOrEqual(after.height + 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("#play-button")).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "Classique", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "Mot à mot", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "Réglages de lecture" }).click();
    await page.locator("#font-family").selectOption("serif");
    await expect(
      page.getByRole("button", { name: "Fermer les réglages" }),
    ).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "Fermer les réglages" }).click();
    await expect(page.locator("#rsvp-word")).toHaveCSS("font-family", /Georgia/);
    await expectFixedLetter(page, "c");
    await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("/#discover");
    await expect(
      page.getByRole("searchbox", { name: "Titre ou auteur" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
