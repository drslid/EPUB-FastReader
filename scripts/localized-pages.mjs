import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applicationSchema, languageFromPath, languageUrl, normalizeSiteUrl, SEO_LANGUAGES } from "../src/seo-data.js";

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const relativePage = (language) => language === "fr" ? "./" : `./${SEO_LANGUAGES[language].file}`;

export function renderSeoHead(language, siteUrl) {
  const data = SEO_LANGUAGES[language];
  const canonical = languageUrl(language, siteUrl);
  return `<title>${escape(data.title)}</title>
    <meta name="description" content="${escape(data.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${escape(canonical)}" />
    ${Object.keys(SEO_LANGUAGES).map((code) => `<link rel="alternate" hreflang="${code}" href="${escape(languageUrl(code, siteUrl))}" />`).join("\n    ")}
    <link rel="alternate" hreflang="x-default" href="${escape(languageUrl("fr", siteUrl))}" />
    <link rel="sitemap" type="application/xml" href="./sitemap.xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FastReader" />
    <meta property="og:title" content="${escape(data.title)}" />
    <meta property="og:description" content="${escape(data.description)}" />
    <meta property="og:url" content="${escape(canonical)}" />
    <meta property="og:locale" content="${data.ogLocale}" />
    ${Object.entries(SEO_LANGUAGES).filter(([code]) => code !== language).map(([, copy]) => `<meta property="og:locale:alternate" content="${copy.ogLocale}" />`).join("\n    ")}
    <meta property="og:image" content="${escape(new URL("icons/icon-512.png", siteUrl).href)}" />
    <meta property="og:image:width" content="512" />
    <meta property="og:image:height" content="512" />
    <meta property="og:image:alt" content="FastReader" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escape(data.title)}" />
    <meta name="twitter:description" content="${escape(data.description)}" />
    <meta name="twitter:image" content="${escape(new URL("icons/icon-512.png", siteUrl).href)}" />
    <meta name="twitter:image:alt" content="FastReader" />
    <script id="app-schema" type="application/ld+json">${JSON.stringify(applicationSchema(language, siteUrl)).replace(/</g, "\\u003c")}</script>`;
}

export function renderLanding(language) {
  const data = SEO_LANGUAGES[language];
  return `<main id="main" class="seo-landing">
      <a href="${relativePage(language)}" aria-label="FastReader">FastReader</a>
      <nav aria-label="${escape(data.languages)}">
        ${Object.entries(SEO_LANGUAGES).map(([code, copy]) => `<a href="${relativePage(code)}" lang="${code}" hreflang="${code}"${code === language ? ' aria-current="page"' : ""}><img class="language-flag" src="./flags/${code === "en" ? "gb" : code}.svg" alt="" width="24" height="18" aria-hidden="true"> ${copy.name}</a>`).join("\n        ")}
      </nav>
      <h1>${escape(data.heading)}</h1>
      <p>${escape(data.intro)}</p>
      <div class="seo-actions"><a href="#import">${escape(data.import)}</a><a href="#discover">${escape(data.discover)}</a></div>
      ${data.features.map(([title, description]) => `<section><h2>${escape(title)}</h2><p>${escape(description)}</p></section>`).join("\n      ")}
    </main>`;
}

export function localizeHtml(html, language, siteUrl) {
  if (!Object.hasOwn(SEO_LANGUAGES, language)) language = "fr";
  const data = SEO_LANGUAGES[language];
  siteUrl = normalizeSiteUrl(siteUrl);
  return html
    .replace(/<html\s+lang="[^"]*"/, `<html lang="${language}"`)
    .replace(/<!-- seo:head:start -->[\s\S]*?<!-- seo:head:end -->/, `<!-- seo:head:start -->\n    ${renderSeoHead(language, siteUrl)}\n    <!-- seo:head:end -->`)
    .replace(/<!-- seo:landing:start -->[\s\S]*?<!-- seo:landing:end -->/, `<!-- seo:landing:start -->\n    ${renderLanding(language)}\n    <!-- seo:landing:end -->`)
    .replace(/<a class="skip-link" href="#main">[^<]*<\/a>/, `<a class="skip-link" href="#main">${escape(data.skip)}</a>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${escape(data.noScript)}</noscript>`)
    .replace(/(<link rel="manifest" href=")[^"]*("\s*\/?>)/, `$1${language === "fr" ? "./manifest.webmanifest" : `./manifest-${language}.webmanifest`}$2`);
}

export function renderSitemap(siteUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(SEO_LANGUAGES).map((language) => `  <url><loc>${escape(languageUrl(language, siteUrl))}</loc></url>`).join("\n")}\n</urlset>\n`;
}

export async function writeLocalizedPages(outputDirectory, siteUrl) {
  const index = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(outputDirectory, "manifest.webmanifest"), "utf8"));
  const files = [];
  for (const [language, data] of Object.entries(SEO_LANGUAGES)) {
    files.push(writeFile(path.join(outputDirectory, data.file), localizeHtml(index, language, siteUrl)));
    files.push(writeFile(path.join(outputDirectory, language === "fr" ? "manifest.webmanifest" : `manifest-${language}.webmanifest`), JSON.stringify({
      ...manifest, lang: language, description: data.description, start_url: relativePage(language),
    }, null, 2) + "\n"));
  }
  files.push(writeFile(path.join(outputDirectory, "sitemap.xml"), renderSitemap(siteUrl)));
  // A robots.txt at a GitHub project subpath has no crawler authority. Only emit
  // one for deployments explicitly configured at the origin root.
  if (new URL(siteUrl).pathname === "/")
    files.push(writeFile(path.join(outputDirectory, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${new URL("sitemap.xml", siteUrl).href}\n`));
  await Promise.all(files);
}

export function localizedSeoPlugin(siteUrl) {
  return {
    name: "fastreader-localized-seo",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        const language = /^\/manifest-(en|es|it|de|pt)\.webmanifest$/.exec(pathname)?.[1];
        if (pathname !== "/sitemap.xml" && !language) return next();
        if (!["GET", "HEAD"].includes(request.method)) return next();
        try {
          let body;
          if (language) {
            const manifest = JSON.parse(await readFile(path.join(server.config.publicDir, "manifest.webmanifest"), "utf8"));
            body = JSON.stringify({ ...manifest, lang: language, description: SEO_LANGUAGES[language].description, start_url: relativePage(language) });
          } else body = renderSitemap(siteUrl);
          response.writeHead(200, { "Content-Type": language ? "application/manifest+json" : "application/xml; charset=utf-8", "Cache-Control": "no-cache" });
          response.end(request.method === "HEAD" ? undefined : body);
        } catch (error) {
          next(error);
        }
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (!html.includes("<!-- seo:head:start -->")) return html;
        const pathname = new URL(context.originalUrl || context.path, "http://localhost").pathname;
        return localizeHtml(html, languageFromPath(pathname), siteUrl);
      },
    },
  };
}
