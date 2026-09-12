// Run after npm run build. Synthetic observations, not a physical-device benchmark.
import { chromium, devices } from "@playwright/test";
import JSZip from "jszip";
import { createAppServer } from "../server/app.js";
import { makeEpub } from "../tests/e2e/helpers/fixtures.js";

const title = "Mesure des 24 chapitres";
const buffer = await makeEpub({
  title,
  chapters: 24,
  paragraphs: Array.from({ length: 96 }, (_, index) =>
    `Paragraphe ${index}. La lecture conserve ses chapitres et laisse l’écran répondre pendant que le livre est préparé. Une histoire à retrouver avec son marque-page et ses illustrations.`,
  ),
});
const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  const rows = [];
  for (const profile of ["Desktop Chrome", "Pixel 7"]) {
    for (let run = 1; run <= 3; run++) {
      for (const worker of [true, false]) {
        const context = await browser.newContext({
          ...devices[profile],
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        await page.addInitScript(({ worker, title }) => {
          if (!worker) {
            window.Worker = class {
              constructor() {
                throw new DOMException("Blocked", "SecurityError");
              }
            };
          }
          const probe = window.__importMetrics = {
            started: 0, duration: 0, frames: 0, maxFrameGap: 0, last: 0,
          };
          document.addEventListener("change", (event) => {
            if (event.target.id !== "epub-file") return;
            probe.started = performance.now();
            probe.last = probe.started;
          }, true);
          function tick(now) {
            if (probe.started && !probe.duration) {
              probe.frames++;
              probe.maxFrameGap = Math.max(probe.maxFrameGap, now - probe.last);
              probe.last = now;
            }
            requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
          new MutationObserver(() => {
            if (
              probe.started && !probe.duration &&
              document.querySelector(".reader-title strong")?.textContent === title
            ) {
              const now = performance.now();
              probe.duration = now - probe.started;
              probe.maxFrameGap = Math.max(probe.maxFrameGap, now - probe.last);
            }
          }).observe(document, { subtree: true, childList: true });
        }, { worker, title });
        await page.goto(baseURL);
        await page.locator("#epub-file").setInputFiles({
          name: "benchmark.epub",
          mimeType: "application/epub+zip",
          buffer,
        });
        await page.waitForFunction(() => window.__importMetrics.duration > 0);
        const metrics = await page.evaluate(() => window.__importMetrics);
        rows.push({
          profile,
          worker,
          run,
          durationMs: Math.round(metrics.duration),
          frames: metrics.frames,
          maxFrameGapMs: Math.round(metrics.maxFrameGap),
        });
        await context.close();
      }
    }
  }
  const zip = await JSZip.loadAsync(buffer);
  let expandedBytes = 0;
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) expandedBytes += (await entry.async("uint8array")).length;
  }
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    browser: browser.version(),
    fixture: { chapters: 24, paragraphsPerChapter: 96, archiveBytes: buffer.length, expandedBytes },
    rows,
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
