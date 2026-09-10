import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// The checked-in PNGs are deterministic raster versions of the source SVG.
const iconsDirectory = new URL('../public/icons/', import.meta.url);
await mkdir(iconsDirectory, { recursive: true });
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  for (const [size, filename] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(filename, iconsDirectory)) });
    await page.close();
  }
} finally {
  await browser.close();
}
