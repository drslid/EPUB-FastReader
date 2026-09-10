import { expect, test } from "@playwright/test";
import { makeEpub } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

test("un EPUB déposé sur la page s’importe et les raccourcis ne perturbent pas les champs", async ({
  page,
}) => {
  const epub = await makeEpub();
  await page.goto("/");
  await page.evaluate(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "depose.epub", {
          type: "application/epub+zip",
        }),
      );
      document.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }),
      );
      document.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    },
    [...epub],
  );
  await expect(page.locator(".reader-title strong")).toHaveText(
    "Un livre pour tester",
  );
  await expect(page.locator("body")).not.toHaveClass(/dragging/);
  await page.locator("#main").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 2");
  await page.locator("#main").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 1");
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await page
    .getByRole("searchbox", { name: "Retrouver un passage" })
    .fill("une histoire");
  await page
    .getByRole("searchbox", { name: "Retrouver un passage" })
    .press("ArrowRight");
  await expect(page.locator(".chapter-heading h1")).toHaveText("Chapitre 1");
  await page.keyboard.press("Escape");
  await expect(page.locator("#reader-notes")).toBeHidden();
  await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await expect(page.locator("#reader-settings")).toBeVisible();
  await page.getByRole("button", { name: /Mes repères/ }).click();
  await expect(page.locator("#reader-settings")).toBeHidden();
  await expect(page.locator("#reader-notes")).toBeVisible();
});

test("un ancien lien ou un livre absent revient à la bibliothèque avec une explication", async ({
  page,
}) => {
  await page.goto("/#read=livre-absent");
  await expect(page).toHaveURL(/#library$/);
  await expect(page.locator("#toast")).toContainText(
    "Ce livre n’est pas présent",
  );
  await expect(
    page.getByRole("button", { name: "Importer un EPUB", exact: true }),
  ).toBeEnabled();
  await page.goto("/viewer.html?file=ancien.epub");
  await expect(page).toHaveURL(/legacy=1/);
  await expect(page.locator("#toast")).toContainText("Le lecteur a évolué");
});

test("le bouton installer n’apparaît qu’avec l’événement du navigateur et traite son résultat", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-action="install"]:visible')).toHaveCount(0);
  await page.evaluate(() => {
    window.installCalls = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.installCalls += 1;
    };
    event.userChoice = Promise.resolve({
      outcome: "accepted",
      platform: "web",
    });
    window.dispatchEvent(event);
  });
  await page.locator('[data-action="install"]:visible').first().click();
  expect(await page.evaluate(() => window.installCalls)).toBe(1);
  await expect(page.locator('[data-action="install"]:visible')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.locator("#toast")).toContainText("FastReader est installé");
});
