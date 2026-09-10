import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

function luminance(color) {
  const channels = color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
  return channels.reduce((total, channel, index) => {
    const value = channel / 255;
    const linear =
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

async function openFocus(page) {
  await page.goto("/#library");
  await page
    .getByRole("button", { name: "Essayer le lecteur", exact: true })
    .click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(
    page.locator("#chapter-content .focus-prefix").first(),
  ).toBeVisible();
}

for (const [theme, label] of [
  ["night", "Sombre"],
  ["paper", "Clair"],
  ["sepia", "Sépia"],
]) {
  test(`Focus distingue les préfixes et conserve les passages surlignés lisibles en thème ${label}`, async ({
    page,
  }) => {
    await openFocus(page);
    await page
      .getByRole("button", { name: "Réglages de lecture", exact: true })
      .click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", { name: "Fermer les réglages", exact: true })
      .click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", theme);

    const colors = await page
      .locator("#chapter-content p")
      .first()
      .evaluate((paragraph) => ({
        text: getComputedStyle(paragraph).color,
        prefix: getComputedStyle(paragraph.querySelector(".focus-prefix"))
          .color,
        background: getComputedStyle(document.querySelector(".reader-shell"))
          .backgroundColor,
      }));
    expect(colors.prefix).not.toBe(colors.text);
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(colors.prefix, colors.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    // A token could accidentally change to a nearly identical colour while still
    // passing the background checks: retain a visible distinction between parts.
    expect(contrast(colors.prefix, colors.text)).toBeGreaterThanOrEqual(2);
    await expect(
      page.locator("#chapter-content .focus-prefix").first(),
    ).toHaveCSS("font-weight", "900");

    const quote = await page
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
    await page.getByRole("button", { name: "Surligner", exact: true }).click();
    await expect(page.locator(".annotation-card blockquote")).toHaveText(quote);
    await page
      .getByRole("button", { name: "Fermer mes repères", exact: true })
      .click();
    await expect(page.locator(".reader-highlight").first()).toBeVisible();
    const highlights = await page
      .locator(".reader-highlight")
      .evaluateAll((marks) =>
        marks.map((mark) => ({
          prefix: Boolean(mark.closest(".focus-prefix")),
          text: getComputedStyle(mark).color,
          background: getComputedStyle(mark).backgroundColor,
        })),
      );
    expect(highlights.some((mark) => mark.prefix)).toBe(true);
    expect(highlights.some((mark) => !mark.prefix)).toBe(true);
    for (const mark of highlights)
      expect(contrast(mark.text, mark.background)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("#chapter-content p").first()).toHaveText(quote);
  });
}

test("Focus reste lisible et ses commandes accessibles sans débordement à 320 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openFocus(page);
  await expect(
    page.getByRole("button", { name: "Focus", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByRole("button", { name: "Réglages de lecture", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByRole("button", { name: "Mes repères", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("#chapter-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);

  await page
    .getByRole("button", { name: "Réglages de lecture", exact: true })
    .click();
  await page.locator("#font-size").fill("32");
  await page
    .getByRole("button", { name: "Fermer les réglages", exact: true })
    .click();
  await expect(page.locator("#chapter-content")).toHaveCSS("font-size", "32px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("#chapter-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});
