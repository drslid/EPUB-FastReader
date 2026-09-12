import { afterEach, describe, expect, it } from "vitest";
import { languages, locale, localeFromPath, localeHref, setLocale, t, translate, formatNumber } from "../src/i18n.js";
import main from "../src/locales/main.js";
import views from "../src/locales/views.js";
import system from "../src/locales/system.js";
import { normalizeSettings } from "../src/storage.js";
import { parseSearchRoute, buildSearchRoute } from "../src/search-route.js";

afterEach(() => setLocale("fr"));
describe("interface language preferences", () => {
  it("accepts only supported locales and preserves valid saved preferences", () => {
    for (const { code } of languages) {
      expect(setLocale(code)).toBe(true);
      expect(locale).toBe(code);
      expect(normalizeSettings({ locale: code }).locale).toBe(code);
    }
    expect(setLocale("javascript:alert(1)")).toBe(false);
    expect(locale).toBe("pt");
    expect(normalizeSettings({ locale: "unknown" }).locale).toBe("fr");
    expect(normalizeSettings({}).locale).toBe("fr");
  });

  it("keeps project subpaths, private hash routes and queries when switching language", () => {
    const source = "https://drslid.github.io/EPUB-FastReader/en.html?legacy#read=mon-livre";
    expect(localeHref("de", source)).toBe("/EPUB-FastReader/de.html?legacy#read=mon-livre");
    expect(localeHref("fr", source)).toBe("/EPUB-FastReader/?legacy=&lang=fr#read=mon-livre");
    expect(localeHref("bad", source)).toBe("/EPUB-FastReader/?legacy=&lang=fr#read=mon-livre");
    expect(localeFromPath("/EPUB-FastReader/pt.html")).toBe("pt");
    expect(localeFromPath("/pt.html/path")).toBe("fr");
    expect(localeFromPath("/EPUB-FastReader/")).toBe("fr");
  });

  it("does not reinterpret user values, regex replacement strings or prototype names", () => {
    setLocale("en");
    expect(t("Votre note")).toBe("Your note");
    expect(t("Résultats pour « {query} »", { query: "$& {title} <script>" })).toBe("Results for “$& {title} <script>”");
    expect(t("constructor")).toBe("constructor");
    expect(t("__proto__")).toBe("__proto__");
    expect(translate("unknown", "Texte original")).toBe("Texte original");
    expect(t("Texte original")).toBe("Texte original");
    expect(formatNumber(12345)).toBe("12,345");
  });

  it("provides every catalog message in all five target languages with matching placeholders", () => {
    const placeholders = (value) => [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
    for (const dictionary of [main, views, system]) {
      for (const language of ["en", "es", "it", "de", "pt"]) {
        expect(Object.keys(dictionary[language]).sort()).toEqual(Object.keys(dictionary.en).sort());
        for (const [source, translated] of Object.entries(dictionary[language])) {
          expect(translated, `${language}: ${source}`).toBeTypeOf("string");
          expect(translated.trim(), `${language}: ${source}`).not.toBe("");
          expect(placeholders(translated), `${language}: ${source}`).toEqual(placeholders(source));
        }
      }
    }
  });

  it("keeps book language independent and supports Italian and Portuguese searches", () => {
    setLocale("de");
    for (const language of ["it", "pt", "fr", ""]) {
      const hash = buildSearchRoute({ query: "livre", language });
      expect(parseSearchRoute(hash).language).toBe(language);
    }
  });
});
