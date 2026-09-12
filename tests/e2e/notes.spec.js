import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";

test.use({ serviceWorkers: "block" });

async function openDemo(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Essayer le lecteur" }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  await page.getByRole("button", { name: "Classique", exact: true }).click();
  await expect(page.locator("#chapter-content")).toBeVisible();
}

async function selectFirstPassage(page) {
  return page
    .locator("#chapter-content p")
    .first()
    .evaluate((paragraph) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return range.toString();
    });
}

test("un passage sélectionné devient une note persistante et exportable", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDemo(page);
  const quote = await selectFirstPassage(page);
  await expect(page.getByRole("toolbar")).toBeVisible();
  await page
    .getByRole("button", { name: "Fermer la sélection", exact: true })
    .click();
  await expect(page.getByRole("toolbar")).toBeHidden();
  await selectFirstPassage(page);
  await page
    .getByRole("button", { name: "Ajouter une note", exact: true })
    .click();
  await page
    .getByLabel("Ce que vous voulez retenir")
    .fill("Prendre cinq minutes pour lire. <script> reste du texte.");
  await page
    .getByRole("button", { name: "Enregistrer la note", exact: true })
    .click();
  await expect(page.locator(".annotation-card")).toHaveCount(1);
  await expect(page.locator(".annotation-card blockquote")).toHaveText(quote);
  await expect(page.locator(".annotation-card > p")).toContainText(
    "<script> reste du texte.",
  );
  await page.getByRole("button", { name: "Fermer mes repères" }).click();
  await expect(page.locator(".reader-highlight").first()).toBeVisible();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".reader-highlight").first()).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await expect(page.locator(".annotation-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Modifier la note" }).click();
  await page
    .getByLabel("Ce que vous voulez retenir")
    .fill("Modification à annuler");
  await page
    .getByRole("button", { name: "Annuler la note", exact: true })
    .click();
  await expect(page.locator(".annotation-card > p")).toContainText(
    "<script> reste du texte.",
  );
  await page.getByRole("button", { name: "Modifier la note" }).click();
  await page
    .getByLabel("Ce que vous voulez retenir")
    .fill("Une pause chaque jour.");
  await page.getByRole("button", { name: "Enregistrer la note" }).click();
  await expect(page.locator(".annotation-card > p")).toHaveText(
    "Une pause chaque jour.",
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter mes repères" }).click();
  const download = await downloaded;
  const file = testInfo.outputPath("notes.md");
  await download.saveAs(file);
  const markdown = await readFile(file, "utf8");
  expect(markdown).toContain(quote);
  expect(markdown).toContain("Une pause chaque jour.");
  await page.getByRole("button", { name: "Supprimer le passage 1" }).click();
  await expect(page.locator(".annotation-card")).toHaveCount(0);
  await expect(page.locator(".reader-highlight")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("le mode mot à mot retrouve le passage dans le texte avec un signet", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Mot à mot", exact: true }).click();
  for (let step = 0; step < 5; step += 1)
    await page.getByRole("button", { name: "Avancer de dix mots" }).click();
  const word = await page.locator("#rsvp-word").innerText();
  expect(word).toBeTruthy();
  await expect(page.locator("#rsvp-context-text")).toContainText(word);
  await page.getByRole("button", { name: "Ajouter un signet" }).click();
  await page.locator('[data-action="show-context"]').click();
  await expect(page.locator("#chapter-scroll")).toBeVisible();
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await expect(page.locator(".bookmark-card")).toHaveCount(1);
  await expect(page.locator(".bookmark-card q")).toContainText(word);
  await page.getByRole("button", { name: "Fermer mes repères" }).click();
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await page.locator("#font-size").fill("30");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await expect(page.locator(".bookmark-card q")).toContainText(word);
  await page.locator(".bookmark-jump").click();
  await page.getByRole("button", { name: "Fermer mes repères" }).click();
  await page.getByRole("button", { name: "Mot à mot", exact: true }).click();
  await expect(page.locator("#rsvp-word")).toHaveText(word);
});

test("chercher des mots retrouve un passage dans un autre chapitre", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await page
    .getByRole("searchbox", { name: "Retrouver un passage" })
    .fill("caracteres");
  await page.getByRole("button", { name: "Chercher dans le livre" }).click();
  await expect(page.locator(".passage-result")).toHaveCount(1);
  await expect(page.locator(".passage-result")).toContainText(
    "Elle a agrandi les caractères",
  );
  await page.locator(".passage-result").click();
  await expect(page.locator(".chapter-heading h1")).toHaveText(
    "Trouver son rythme",
  );
  await expect(page.locator("#reader-notes")).toBeHidden();
  await page.getByRole("button", { name: "Mot à mot", exact: true }).click();
  await expect(page.locator("#rsvp-word")).toHaveText("caractères.");
});

test("surligner sans note, revenir au passage et supprimer un signet restent cohérents", async ({
  page,
}) => {
  await openDemo(page);
  const quote = await selectFirstPassage(page);
  await page.getByRole("button", { name: "Surligner", exact: true }).click();
  await expect(page.locator(".annotation-card blockquote")).toHaveText(quote);
  await expect(page.locator(".annotation-card > p")).toHaveCount(0);
  await page.getByRole("button", { name: "Fermer mes repères" }).click();
  await page.getByRole("button", { name: "Ajouter un signet" }).click();
  await page.getByRole("button", { name: "Ajouter un signet" }).click();
  await expect(page.locator("#toast")).toContainText("déjà marqué");
  await page.locator('.reader-navigation [data-action="next-chapter"]').click();
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await page.locator(".annotation-jump").click();
  await expect(page.locator(".chapter-heading h1")).toHaveText(
    "Un peu de place",
  );
  await expect(page.locator(".reader-highlight").first()).toHaveText(quote);
  if (!(await page.locator("#reader-notes").isVisible()))
    await page.getByRole("button", { name: /Mes repères/ }).click();
  await expect(page.locator(".bookmark-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Supprimer le signet 1", exact: true })
    .click();
  await expect(page.locator(".bookmark-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Supprimer le passage 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Exporter mes repères", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Fermer mes repères" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await expect(page.locator(".bookmark-card, .annotation-card")).toHaveCount(0);
});

test("une recherche de passage vide de résultats annonce l’absence sans déplacer la lecture", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await page
    .getByRole("searchbox", { name: "Retrouver un passage" })
    .fill("zzqvpassageintrouvable");
  await page.getByRole("button", { name: "Chercher dans le livre" }).click();
  await expect(page.locator(".passage-results")).toContainText(
    "Aucun passage trouvé",
  );
  await expect(page.locator(".passage-result")).toHaveCount(0);
  await expect(page.locator(".chapter-heading h1")).toHaveText(
    "Un peu de place",
  );
});
