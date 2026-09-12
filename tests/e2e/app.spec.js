import { test, expect } from "./fixtures.js";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

// Network fixtures must stay in Playwright's routing layer; the real service
// worker and its offline behavior are exercised separately in offline.spec.js.
test.use({ serviceWorkers: "block" });

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
  "base64",
);
async function fixture() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    "OPS/book.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Le voyage des pages</dc:title><dc:creator>Camille Test</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
  );
  zip.file(
    "OPS/text/two.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Deux</title></head><body><h1>Le second horizon</h1><p>Le voyage se poursuit dans ce deuxième chapitre. Une belle histoire à découvrir.</p></body></html>',
  );
  const paragraphs = Array.from(
    { length: 45 },
    (_, index) =>
      `<p>Paragraphe ${index + 1}. La bibliothèque ouvre ses portes. Une histoire prend vie entre les pages, et chaque lecteur trouve son propre chemin.</p>`,
  ).join("");
  zip.file(
    "OPS/text/one.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Un</title><style>body { display:none }</style></head><body><h1>Le premier horizon</h1><script>window.__unsafe = true</script><img src="https://tracker.invalid/pixel.png" onerror="window.__unsafe = true" alt="Image distante"/><img src="../images/cover.png" alt="Couverture locale"/><a href="two.xhtml">Continuer vers le second horizon</a>${paragraphs}</body></html>`,
  );
  zip.file("OPS/images/cover.png", png);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function upload(page, buffer) {
  await page.locator("#epub-file").setInputFiles({
    name: "voyage.epub",
    mimeType: "application/epub+zip",
    buffer,
  });
  await expect(page.locator(".reader-title strong")).toHaveText(
    "Le voyage des pages",
  );
}

async function openSettings(page) {
  const panel = page.locator("#reader-settings");
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "Réglages de lecture" }).click();
  await expect(panel).toBeVisible();
}

async function closeSettings(page) {
  if (await page.locator("#reader-settings").isVisible())
    await page.getByRole("button", { name: "Fermer les réglages" }).click();
}

test("import EPUB, sécurité, ordre des chapitres, export et reprise après rechargement", async ({
  page,
}, testInfo) => {
  const pageErrors = [];
  const trackerRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("tracker.invalid"))
      trackerRequests.push(request.url());
  });
  await page.goto("/");
  const buffer = await fixture();
  await upload(page, buffer);
  await expect(page.locator(".chapter-heading h1")).toHaveText(
    "Le premier horizon",
  );
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "sepia");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(
    page.locator("#chapter-content .focus-prefix").first(),
  ).toBeVisible();
  await expect(page.locator("#chapter-content img")).toHaveCount(1);
  expect(
    await page.locator("#chapter-content img").getAttribute("src"),
  ).toMatch(/^data:image\/png/);
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
  expect(trackerRequests).toEqual([]);
  await openSettings(page);
  await expect(
    page.getByRole("button", { name: "Exporter l’EPUB Focus" }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter l’EPUB Focus" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("focus_voyage.epub");
  const output = testInfo.outputPath("focused.epub");
  await download.saveAs(output);
  const exported = await JSZip.loadAsync(await readFile(output));
  expect(await exported.file("mimetype").async("string")).toBe(
    "application/epub+zip",
  );
  expect(exported.file("OPS/images/cover.png")).not.toBeNull();
  const focusedChapter = await exported
    .file("OPS/text/one.xhtml")
    .async("string");
  expect(focusedChapter).toContain("focus-prefix");
  expect(focusedChapter).not.toContain("<script");
  expect(focusedChapter).not.toContain("tracker.invalid");
  await closeSettings(page);
  await page.locator("#chapter-content a").click();
  await expect(page.locator(".chapter-heading h1")).toHaveText(
    "Le second horizon",
  );
  await page.getByRole("button", { name: "Ajouter un signet" }).click();
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await expect(
    page.getByRole("button", { name: "Lire Le voyage des pages", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Lire Le voyage des pages", exact: true })
    .click();
  await expect(page.locator(".chapter-heading h1")).toHaveText(
    "Le second horizon",
  );
  await page.getByRole("button", { name: "Mes repères", exact: false }).click();
  await expect(page.locator(".bookmark-row")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test("modes de lecture, thèmes, progression et commandes tactiles sans débordement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Essayer le lecteur" }).click();
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page.locator(".reader-title strong")).toHaveText(
    "L’art de prendre le temps",
  );
  await openSettings(page);
  await page
    .getByRole("radio", { name: "Classique", exact: true })
    .check();
  await expect(page.locator("#chapter-content .focus-prefix")).toHaveCount(0);
  await page.getByRole("button", { name: "Sombre", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await page.locator("#font-size").fill("25");
  await expect(page.locator("#font-size-value")).toHaveText("25 px");
  await page
    .getByRole("radio", {
      name: "Mot à mot", exact: true,
    })
    .check();
  await page.locator("#reading-speed").fill("600");
  await page.keyboard.press("Escape");
  await expect(page.locator("#reader-settings")).not.toBeVisible();
  await expect(page.locator("#rsvp")).toBeVisible();
  const initial = await page.locator("#rsvp-count").textContent();
  await page.locator("#play-button").click();
  await expect(page.locator("#rsvp-count")).not.toHaveText(initial);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.locator("#rsvp-count").textContent();
  await page.waitForTimeout(250);
  await expect(page.locator("#rsvp-count")).toHaveText(paused);
  await page.getByRole("button", { name: "Avancer de dix mots" }).click();
  await expect(page.locator("#rsvp-count")).not.toHaveText(paused);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Retour à ma bibliothèque" }).click();
  await page.reload();
  await expect(page.locator(".library-section .book-card")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Accueil", exact: true }).click();
  await page.getByRole("button", { name: "Essayer le lecteur", exact: true }).click();
  await expect(page.locator("#rsvp")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "night");
  await expect(page.locator("#rsvp-count")).toContainText("600 mots/min");
  await openSettings(page);
  await expect(page.locator("#font-size")).toHaveValue("25");
});

test("fichier invalide, bibliothèque vide et mise en page étroite restent utilisables", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#main")).toBeVisible();
  await page.locator("#epub-file").setInputFiles({
    name: "invalide.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from("un faux epub"),
  });
  await expect(page.locator("#toast")).toContainText("archive EPUB valide");
  await expect(
    page.locator(".home-actions").getByRole("button", { name: "Importer un EPUB", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Essayer le lecteur" }).click();
  await expect(page.locator(".reader-title strong")).toHaveText(
    "L’art de prendre le temps",
  );
});
