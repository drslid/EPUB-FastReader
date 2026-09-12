import main from "./locales/main.js";
import views from "./locales/views.js";
import system from "./locales/system.js";

export const languages = Object.freeze([
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "pt", name: "Português", flag: "🇵🇹" },
]);
export const isLocale = (value) => languages.some(({ code }) => code === value);
export function localeFromPath(pathname = globalThis.location?.pathname || "/") {
  return /\/(en|es|it|de|pt)\.html$/.exec(pathname)?.[1] || "fr";
}
export let locale = localeFromPath();
export function setLocale(value) {
  if (!isLocale(value)) return false;
  locale = value;
  return true;
}

// Catalogs contain UI copy only. Book text, titles and personal notes never pass
// through this function. HTML callers escape user data before interpolation.
const dictionaries = Object.fromEntries(languages.map(({ code }) => [code, {
  ...system[code], ...views[code], ...main[code],
}]));
export function translate(language, source, parameters = {}) {
  const dictionary = dictionaries[language];
  const text = dictionary && Object.hasOwn(dictionary, source) ? dictionary[source] : source;
  return String(text).replace(/\{([\w]+)\}/g, (token, name) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : token,
  );
}
export const t = (source, parameters) => translate(locale, source, parameters);
export const formatNumber = (number, options) => new Intl.NumberFormat(locale, options).format(number);
export const formatDate = (date, options) => new Intl.DateTimeFormat(locale, options).format(date);

/** Keep the app directory, hash and query; never include personal data in SEO. */
export function localeHref(language, current = globalThis.location?.href || "https://example.test/") {
  const url = new URL(current);
  const directory = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  const target = isLocale(language) ? language : "fr";
  url.pathname = `${directory}${target === "fr" ? "" : `${target}.html`}`;
  // French shares the entry URL with remembered preferences. This hint also
  // makes Ctrl/cmd-click and new-tab navigation explicitly choose French.
  if (target === "fr") url.searchParams.set("lang", "fr");
  else if (url.searchParams.has("lang")) url.searchParams.delete("lang");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function languageSelector() {
  const current = languages.find(({ code }) => code === locale);
  const flagImage = (code) => `<img class="language-flag" src="./flags/${code === "en" ? "gb" : code}.svg" alt="" width="24" height="18" aria-hidden="true">`;
  return `<details class="language-picker"><summary aria-label="${t("Langue de l’interface")}" title="${t("Langue de l’interface")}">${flagImage(current.code)}<span>${current.code.toUpperCase()}</span><span class="language-chevron" aria-hidden="true">⌄</span></summary><nav aria-label="${t("Choisir la langue")}">${languages.map(({ code, name }) => `<a href="${localeHref(code).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" data-locale="${code}" lang="${code}" hreflang="${code}" ${code === locale ? 'aria-current="true"' : ""}>${flagImage(code)}<span>${name}</span>${code === locale ? '<span aria-hidden="true">✓</span>' : ""}</a>`).join("")}</nav></details>`;
}
