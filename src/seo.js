import { applicationSchema, DEFAULT_SITE_URL, languageUrl, SEO_LANGUAGES } from "./seo-data.js";

const SITE_URL = import.meta.env?.VITE_SITE_URL || DEFAULT_SITE_URL;

function meta(attribute, key, value) {
  let node = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attribute, key);
    document.head.append(node);
  }
  node.content = value;
}

export function updateSeo(language, { privatePage = false } = {}) {
  if (!Object.hasOwn(SEO_LANGUAGES, language)) language = "fr";
  const data = SEO_LANGUAGES[language];
  document.documentElement.lang = language;
  document.title = data.title;
  meta("name", "description", data.description);
  meta("name", "robots", privatePage ? "noindex,follow" : "index,follow,max-image-preview:large");
  meta("property", "og:title", data.title);
  meta("property", "og:description", data.description);
  meta("property", "og:url", languageUrl(language, SITE_URL));
  meta("property", "og:locale", data.ogLocale);
  document.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((node) => node.remove());
  for (const [code, copy] of Object.entries(SEO_LANGUAGES)) {
    if (code === language) continue;
    const alternative = document.createElement("meta");
    alternative.setAttribute("property", "og:locale:alternate");
    alternative.content = copy.ogLocale;
    document.head.append(alternative);
  }
  meta("name", "twitter:title", data.title);
  meta("name", "twitter:description", data.description);
  document.head.querySelector('link[rel="canonical"]')?.setAttribute("href", languageUrl(language, SITE_URL));
  document.head.querySelector('link[rel="manifest"]')?.setAttribute("href", language === "fr" ? "./manifest.webmanifest" : `./manifest-${language}.webmanifest`);
  const schema = document.getElementById("app-schema");
  if (schema) schema.textContent = JSON.stringify(applicationSchema(language, SITE_URL));
  document.querySelector(".skip-link")?.replaceChildren(data.skip);
}
