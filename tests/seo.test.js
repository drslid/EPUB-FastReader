import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applicationSchema, DEFAULT_SITE_URL, languageFromPath, languageUrl, normalizeSiteUrl, SEO_LANGUAGES } from "../src/seo-data.js";
import { localizeHtml, renderSitemap } from "../scripts/localized-pages.mjs";
import { updateSeo } from "../src/seo.js";

const template = await readFile(path.resolve("index.html"), "utf8");
const parse = (html) => new DOMParser().parseFromString(html, "text/html");

describe("localized public documents", () => {
  it.each(Object.keys(SEO_LANGUAGES))("renders a complete public landing page in %s without JavaScript", (language) => {
    const data = SEO_LANGUAGES[language];
    const html = localizeHtml(template, language, DEFAULT_SITE_URL);
    const doc = parse(html);
    expect(doc.documentElement.lang).toBe(language);
    expect(doc.title).toBe(data.title);
    expect(doc.querySelectorAll("title")).toHaveLength(1);
    expect(doc.querySelector('meta[name="description"]').content).toBe(data.description);
    expect(doc.querySelector('meta[property="og:title"]').content).toBe(data.title);
    expect(doc.querySelector('meta[property="og:locale"]').content).toBe(data.ogLocale);
    expect(doc.querySelector('meta[name="twitter:description"]').content).toBe(data.description);
    expect(doc.querySelector('link[rel="canonical"]').href).toBe(languageUrl(language));
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("#app h1").textContent).toBe(data.heading);
    expect(doc.querySelector("#app").textContent).toContain(data.features[3][1]);
    expect(doc.querySelector("noscript").textContent).toBe(data.noScript);
    expect(doc.querySelector('link[rel="manifest"]').getAttribute("href")).toBe(language === "fr" ? "./manifest.webmanifest" : `./manifest-${language}.webmanifest`);
    const alternatives = [...doc.querySelectorAll('head link[rel="alternate"]')];
    expect(alternatives).toHaveLength(7);
    for (const alternate of alternatives)
      expect(alternate.href).toBe(languageUrl(alternate.hreflang === "x-default" ? "fr" : alternate.hreflang));
    const links = [...doc.querySelectorAll("#app nav a")];
    expect(links).toHaveLength(6);
    expect(links.find((link) => link.lang === language).getAttribute("aria-current")).toBe("page");
    expect(doc.querySelectorAll("#app nav [aria-hidden=true]")).toHaveLength(6);
    expect([...doc.querySelectorAll("#app nav img")].map((flag) => flag.getAttribute("src"))).toEqual(["fr", "gb", "es", "it", "de", "pt"].map((code) => `./flags/${code}.svg`));
    expect(JSON.parse(doc.getElementById("app-schema").textContent)).toEqual(applicationSchema(language));
    // Reusing a built locale as the template cannot duplicate metadata or content.
    expect(localizeHtml(html, language, DEFAULT_SITE_URL)).toBe(html);
  });

  it("uses six public canonical URLs in the sitemap, without local user routes or fake dates", () => {
    const sitemap = new DOMParser().parseFromString(renderSitemap(DEFAULT_SITE_URL), "application/xml");
    expect(sitemap.querySelector("parsererror")).toBeNull();
    expect([...sitemap.querySelectorAll("loc")].map((node) => node.textContent)).toEqual(Object.keys(SEO_LANGUAGES).map((language) => languageUrl(language)));
    expect(sitemap.querySelector("lastmod")).toBeNull();
    expect(renderSitemap(DEFAULT_SITE_URL)).not.toMatch(/#|library|reader|import|book=|search=/);
  });

  it("honors a different deployment base without changing the local asset scope", () => {
    const base = "https://reader.example/apps/reading/";
    const doc = parse(localizeHtml(template, "de", base));
    expect(doc.querySelector('link[rel="canonical"]').href).toBe(`${base}de.html`);
    expect(doc.querySelector('meta[property="og:image"]').content).toBe(`${base}icons/icon-512.png`);
    expect(doc.querySelector('script[type="module"]').getAttribute("src")).toBe("./src/main.js");
    expect(doc.querySelector("#app nav a").getAttribute("href")).toBe("./");
  });

  it("normalizes only absolute deploy URLs without query, credentials or fragments", () => {
    expect(normalizeSiteUrl("https://reader.example/apps")).toBe("https://reader.example/apps/");
    for (const url of ["/relative/", "javascript:alert(1)", "https://a:b@reader.example/", "https://reader.example/?secret=test", "https://reader.example/#library"])
      expect(() => normalizeSiteUrl(url)).toThrow();
  });

  it("identifies language documents independently of the deployment directory", () => {
    expect(languageFromPath("/EPUB-FastReader/pt.html")).toBe("pt");
    expect(languageFromPath("/it.html")).toBe("it");
    expect(languageFromPath("/EPUB-FastReader/")).toBe("fr");
    expect(languageFromPath("/index.html")).toBe("fr");
    expect(languageFromPath("/unknown.html")).toBe("fr");
  });

  it("updates metadata for the selected language without exposing private book contents", () => {
    const parsed = parse(localizeHtml(template, "fr", DEFAULT_SITE_URL));
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = '<a class="skip-link" href="#main">Aller au contenu</a>';
    updateSeo("it", { privatePage: true });
    expect(document.documentElement.lang).toBe("it");
    expect(document.title).toBe(SEO_LANGUAGES.it.title);
    expect(document.querySelector('meta[name="robots"]').content).toBe("noindex,follow");
    expect(document.querySelector('link[rel="canonical"]').href).toBe(languageUrl("it"));
    expect(document.querySelector('link[rel="manifest"]').getAttribute("href")).toBe("./manifest-it.webmanifest");
    expect(document.querySelector(".skip-link").textContent).toBe(SEO_LANGUAGES.it.skip);
    expect(JSON.parse(document.getElementById("app-schema").textContent).inLanguage).toBe("it");
    updateSeo("it");
    expect(document.querySelector('meta[name="robots"]').content).toContain("index,follow");
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  });
});
