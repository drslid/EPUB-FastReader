// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeLocalizedPages } from "../scripts/localized-pages.mjs";
import { DEFAULT_SITE_URL, SEO_LANGUAGES } from "../src/seo-data.js";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function outputFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fastreader-localized-output-"));
  temporaryDirectories.push(directory);
  const html = (await readFile("index.html", "utf8")).replace('./src/main.js', './assets/main-01234567.js').replace('./src/seo-landing.css', './assets/main-01234567.css');
  await Promise.all([
    writeFile(path.join(directory, "index.html"), html),
    writeFile(path.join(directory, "manifest.webmanifest"), await readFile("public/manifest.webmanifest")),
  ]);
  return directory;
}

describe("language build artifacts", () => {
  it("includes six local vector flags and their upstream license", async () => {
    for (const code of ["fr", "gb", "es", "it", "de", "pt"]) {
      const svg = await readFile(`public/flags/${code}.svg`, "utf8");
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="0 0 640 480"');
      expect(svg).not.toMatch(/<script|<foreignObject|(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/)/i);
    }
    const notice = await readFile("public/flags/NOTICE.txt", "utf8");
    expect(notice).toContain("https://github.com/lipis/flag-icons");
    expect(notice).toContain("The MIT License (MIT)");
    expect(notice).toContain("Copyright (c) 2013 Panayiotis Lipiridis");
  });

  it("writes all locale documents with shared built assets, PWA identity and translated launch URLs", async () => {
    const directory = await outputFixture();
    await writeLocalizedPages(directory, DEFAULT_SITE_URL);
    for (const [language, data] of Object.entries(SEO_LANGUAGES)) {
      const html = await readFile(path.join(directory, data.file), "utf8");
      expect(html).toContain(`<html lang="${language}">`);
      expect(html).toContain('./assets/main-01234567.js');
      expect(html).toContain('./assets/main-01234567.css');
      expect(html).not.toContain('./src/main.js');
      expect(html).toContain(data.heading);
      const manifest = JSON.parse(await readFile(path.join(directory, language === "fr" ? "manifest.webmanifest" : `manifest-${language}.webmanifest`), "utf8"));
      expect(manifest).toMatchObject({ id: "./", scope: "./", lang: language, start_url: language === "fr" ? "./" : `./${data.file}` });
    }
    expect(await readFile(path.join(directory, "sitemap.xml"), "utf8")).toContain(`${DEFAULT_SITE_URL}de.html`);
    await expect(readFile(path.join(directory, "robots.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("generates a sitemap-aware robots file only for a configured origin-root deployment", async () => {
    const directory = await outputFixture();
    await writeLocalizedPages(directory, "https://reader.example/");
    expect(await readFile(path.join(directory, "robots.txt"), "utf8")).toBe("User-agent: *\nAllow: /\nSitemap: https://reader.example/sitemap.xml\n");
    expect(await readFile(path.join(directory, "en.html"), "utf8")).toContain('rel="canonical" href="https://reader.example/en.html"');
  });
});
