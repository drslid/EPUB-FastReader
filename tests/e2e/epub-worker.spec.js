import { test, expect } from "./fixtures.js";
import JSZip from "jszip";
import { makeEpub, importEpub, storedRows } from "./helpers/fixtures.js";

test.use({ serviceWorkers: "block" });

test("un EPUB de plusieurs chapitres se décompresse en Worker sans bloquer tout l’import", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const probe = window.__epubWorkerProbe = {
      created: 0, terminated: 0, requests: [], heartbeats: 0, importing: false,
    };
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.tracked = options?.name === "epub-import";
        if (this.tracked) probe.created++;
      }
      postMessage(message, ...rest) {
        if (this.tracked) {
          probe.requests.push(message.method);
          if (message.method === "open") probe.importing = true;
        }
        super.postMessage(message, ...rest);
      }
      terminate() {
        if (this.tracked) {
          probe.terminated++;
          probe.importing = false;
        }
        super.terminate();
      }
    };
    setInterval(() => {
      if (probe.importing) probe.heartbeats++;
    }, 5);
  });
  const buffer = await makeEpub({
    title: "Une longue lecture fluide",
    chapters: 24,
    paragraphs: Array.from({ length: 96 }, (_, index) =>
      `Paragraphe ${index}. La lecture conserve ses chapitres et laisse l’écran répondre pendant que le livre est préparé. Une histoire à retrouver avec son marque-page et ses illustrations.`,
    ),
  });
  await page.goto("/");
  await importEpub(page, buffer);
  await expect(page.locator(".reader-title strong")).toHaveText("Une longue lecture fluide");
  const probe = await page.evaluate(() => window.__epubWorkerProbe);
  expect(probe.created).toBe(1);
  expect(probe.terminated).toBe(1);
  expect(probe.requests.filter((method) => method === "text").length).toBeGreaterThanOrEqual(26);
  // A timer checks event-loop availability even when a headless browser
  // suppresses animation frames. This is not a 60 FPS performance promise.
  expect(probe.heartbeats).toBeGreaterThanOrEqual(3);
  const books = await storedRows(page, "books");
  expect(books).toHaveLength(1);
  expect(books[0].chapters).toHaveLength(24);
  expect(books[0].chapters[23].html).toContain("Paragraphe 95");
});

test("un Worker bloqué garde le repli local et les contrôles de sécurité", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() { throw new DOMException("Blocked", "SecurityError"); }
    };
  });
  await page.goto("/");
  await importEpub(page, Buffer.from("archive invalide"));
  await expect(page.locator("#toast")).toContainText("archive EPUB valide");
  await importEpub(page, await makeEpub({ title: "Repli local disponible" }));
  await expect(page.locator(".reader-title strong")).toHaveText("Repli local disponible");
});

test("le Worker refuse les DRM et libère ses ressources après une erreur", async ({ page }) => {
  const workers = [];
  let closed = 0;
  page.on("worker", (worker) => {
    if (!worker.url().includes("epub-archive")) return;
    workers.push(worker);
    worker.on("close", () => closed++);
  });
  const zip = await JSZip.loadAsync(await makeEpub());
  zip.file("META-INF/encryption.xml", '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></EncryptedData></encryption>');
  await page.goto("/");
  await importEpub(page, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  await expect(page.locator("#toast")).toContainText("DRM");
  await expect.poll(() => workers.length).toBe(1);
  await expect.poll(() => closed).toBe(1);
  expect(await storedRows(page, "books")).toHaveLength(0);
});
