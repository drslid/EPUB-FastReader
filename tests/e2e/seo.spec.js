import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../../server/app.js";
import { DEFAULT_SITE_URL, languageUrl, SEO_LANGUAGES } from "../../src/seo-data.js";

test.describe("public language documents", () => {
  test.use({ javaScriptEnabled: false });

  test("all language URLs expose localized, linked public content without JavaScript", async ({ page, context, baseURL }) => {
    for (const [language, data] of Object.entries(SEO_LANGUAGES)) {
      const response = await page.goto(new URL(language === "fr" ? "./" : data.file, baseURL).href);
      expect(response.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page).toHaveTitle(data.title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(data.heading);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", languageUrl(language));
      await expect(page.locator('head link[rel="alternate"]')).toHaveCount(7);
      await expect(page.locator("#app nav a")).toHaveCount(6);
      // Playwright's text matcher intentionally ignores <noscript> contents.
      expect(await page.locator("noscript").textContent()).toBe(data.noScript);
      const module = await page.locator('script[type="module"]').getAttribute("src");
      const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((nodes) => nodes.map((node) => node.href));
      expect(module).toMatch(/^\.\/assets\/.+\.js$/);
      expect((await context.request.get(new URL(module, page.url()).href)).status()).toBe(200);
      for (const style of styles) expect((await context.request.get(style)).status()).toBe(200);
      const manifestPath = await page.locator('link[rel="manifest"]').getAttribute("href");
      const manifest = await (await context.request.get(new URL(manifestPath, page.url()).href)).json();
      expect(manifest).toMatchObject({ lang: language, id: "./", scope: "./", start_url: language === "fr" ? "./" : `./${data.file}` });
    }
    const response = await context.request.get(new URL("sitemap.xml", baseURL).href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/xml");
    const sitemap = await response.text();
    for (const language of Object.keys(SEO_LANGUAGES)) expect(sitemap).toContain(`<loc>${languageUrl(language, DEFAULT_SITE_URL)}</loc>`);
    expect(sitemap).not.toMatch(/#|library|reader|import|book=|search=/);
  });
});

test("one installed app caches every language document in the same offline scope", async ({ page }) => {
  // Stop a private production server: WebKit's offline emulation can reject
  // service-worker navigations before consulting the real cache.
  const server = createAppServer({ root: fileURLToPath(new URL("../../dist/", import.meta.url)) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const stop = async () => {
    if (!server.listening) return;
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  };
  try {
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await stop();
    expect(await page.evaluate(async () => {
      try { await fetch("./uncached-network-probe"); return false; }
      catch { return true; }
    })).toBe(true);
    for (const [language, data] of Object.entries(SEO_LANGUAGES)) {
      const response = await page.goto(new URL(language === "fr" ? "./" : data.file, base).href);
      expect(response.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page).toHaveTitle(data.title);
      expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(1);
    }
  } finally {
    await stop();
  }
});
