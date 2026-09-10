import { expect, test } from "@playwright/test";

// Legacy account links resolve to the only personal space: the local library.
test.use({ serviceWorkers: "block" });

test("l’ancien lien Mon espace retrouve les livres locaux sans compte ni requête d’authentification", async ({
  page,
}) => {
  const authRequests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/supabase|\/auth\/v1|\/functions\/v1/.test(request.url()))
      authRequests.push(request.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Essayer le lecteur", exact: true })
    .click();
  await expect(page.locator(".reader-title strong")).toHaveText(
    "L’art de prendre le temps",
  );
  await page.goto("/#account");
  await expect(page).toHaveURL(/#library$/);
  await expect(
    page.getByRole("button", {
      name: "Lire L’art de prendre le temps",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Mon espace", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#account-signin, #account-code")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", {
      name: "Lire L’art de prendre le temps",
      exact: true,
    })
    .click();
  await expect(page.locator("#rsvp")).toBeVisible();
  expect(authRequests).toEqual([]);
  expect(errors).toEqual([]);
});
