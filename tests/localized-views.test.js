import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import views from "../src/locales/views.js";
import { setLocale, t } from "../src/i18n.js";
import { defaultSettings } from "../src/storage.js";
import { homeMarkup } from "../src/views/home.js";
import { libraryMarkup } from "../src/views/library.js";
import { discoverMarkup } from "../src/views/discover.js";
import { searchBarMarkup, localSearchResultsMarkup } from "../src/views/search.js";
import { readerMarkup } from "../src/views/reader.js";
import { suggestionsMarkup } from "../src/views/suggestions.js";
import { searchBooks } from "../src/catalog.js";

const escape = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const helpers = { icon: () => "", escape, cover: () => "", applyFocus: (html) => html, providers: [] };
const book = {
  id: 'livre-"<test>', title: 'Lire "<script>" & découvrir', author: "Auteur original",
  language: "fr", original: new ArrayBuffer(1),
  chapters: [{ title: "Chapitre original", html: "<p>Votre place est gardée</p>", wordCount: 400 }],
  position: { chapterIndex: 0, progress: 0.2, bookmarks: [], annotations: [] },
};
const state = {
  books: [book], book, position: book.position, settings: { ...defaultSettings },
  busy: false, suggestions: [], query: "", language: "fr", catalog: [], catalogCount: 0,
  provider: "selection", page: 1, searching: false, searched: true, view: "discover",
  localSearchResults: [book], settingsOpen: true, notesOpen: false,
  passageQuery: "", passageSearched: false, passageResults: [],
};
const render = (markup) => {
  const element = document.createElement("div");
  element.innerHTML = markup;
  // A forgotten quoted template branch must never expose template syntax to users.
  expect(element.textContent).not.toContain("${t(");
  expect(element.querySelector("script")).toBeNull();
  return element;
};
afterEach(() => setLocale("fr"));

describe("translated reading interface", () => {
  it("provides every view key in each translation with intact placeholders", () => {
    const files = readdirSync(`${process.cwd()}/src/views`).filter((name) => name.endsWith(".js"));
    const keys = new Set(files.flatMap((file) => [...readFileSync(`${process.cwd()}/src/views/${file}`, "utf8").matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1])));
    for (const key of ["Équilibré", "Confort", "Focus léger", "Personnalisé", "Toutes les langues", "Clair", "Sépia", "Sombre", "La page, tout simplement", "Le début des mots en évidence", "Un mot à la fois, à votre vitesse"]) keys.add(key);
    const placeholders = (text) => [...text.matchAll(/\{\w+\}/g)].map(([value]) => value).sort();
    for (const language of ["en", "es", "it", "de", "pt"]) {
      for (const key of keys) {
        expect(views[language][key], `${language}: ${key}`).toBeTypeOf("string");
        expect(views[language][key].trim()).not.toBe("");
        expect(placeholders(views[language][key]), `${language}: ${key}`).toEqual(placeholders(key));
      }
    }
  });

  it.each([
    ["fr", "Ma bibliothèque", "Mot à mot", "Titre ou auteur"],
    ["en", "My library", "Word by word", "Title or author"],
    ["es", "Mi biblioteca", "Palabra a palabra", "Título o autor"],
    ["it", "La mia biblioteca", "Parola per parola", "Titolo o autore"],
    ["de", "Meine Bibliothek", "Wort für Wort", "Titel oder Autor"],
    ["pt", "A minha biblioteca", "Palavra a palavra", "Título ou autor"],
  ])("renders %s throughout navigation, discovery and reading without translating book content", (language, libraryTitle, wordMode, searchLabel) => {
    setLocale(language);
    const home = render(homeMarkup(state, helpers));
    expect(home.querySelector("#home-title").textContent).toBe(t("Ouvrez un livre.<br><em>Trouvez votre rythme.</em>").replace(/<[^>]+>/g, ""));
    const library = render(libraryMarkup(state, helpers));
    expect(library.querySelector("h1").textContent).toBe(libraryTitle);
    expect(library.querySelector(".book-open h3").textContent).toBe(book.title);
    expect(library.querySelector(".book-open").getAttribute("aria-label")).toBe(t("Lire {title}", { title: book.title }));
    const search = render(searchBarMarkup(state, helpers));
    expect(search.querySelector('label[for="search-query"]').textContent).toBe(searchLabel);
    expect([...search.querySelectorAll("#search-language option")].map((item) => item.value)).toEqual(["fr", "en", "es", "de", "it", "pt", ""]);
    const local = render(localSearchResultsMarkup(state, helpers));
    expect(local.querySelector("h2").textContent).toContain(t("Mes livres"));
    const discover = render(discoverMarkup({ ...state, searching: true }, helpers));
    expect(discover.querySelector(".loading-state").textContent).toBe(t("Recherche des livres…"));
    const reader = render(readerMarkup(state, helpers));
    expect(reader.querySelector('[data-mode="rsvp"]').textContent).toBe(wordMode);
    expect(reader.querySelector("#chapter-content").textContent).toBe("Votre place est gardée");
    expect(reader.querySelector("#chapter-content").lang).toBe("fr");
    expect(reader.querySelector("#rsvp-word").lang).toBe("fr");
    expect(reader.querySelector("#rsvp-context-text").lang).toBe("fr");
    expect(reader.querySelector(".reader-title strong").textContent).toBe(book.title);
    expect(reader.querySelector(".bookmark-list").textContent).toBe(t("Touchez le ruban en haut du lecteur pour garder un passage."));
    expect(reader.querySelectorAll("#reader-settings [data-locale]")).toHaveLength(6);
  });


  it("refreshes cached editorial descriptions on language changes without changing catalog or user metadata", async () => {
    setLocale("en");
    const { books } = await searchBooks({ provider: "selection" });
    const cached = Object.freeze(books[0]);
    const original = { ...cached };
    expect(cached.descriptionKey).toBe("Un recueil de quatorze nouvelles, entre quotidien et fantastique.");
    expect(cached.genreKey).toBe("Nouvelles · Fantastique");
    const untouched = Object.freeze({ ...book, providerId: "custom", description: "La page, tout simplement", genre: "Classique", downloadMode: "manual", sourceUrl: "https://example.test/book" });
    for (const language of ["de", "fr", "pt", "en"]) {
      setLocale(language);
      const discover = render(discoverMarkup({ ...state, catalog: [cached, untouched] }, helpers));
      const cards = discover.querySelectorAll(".book-card");
      expect(cards[0].querySelector(".book-description").textContent).toBe(t(cached.descriptionKey));
      expect(cards[0].querySelector(".genre-label").textContent).toBe(t(cached.genreKey));
      expect(cards[0].querySelector("h3").textContent).toBe(cached.title);
      expect(cards[1].querySelector(".book-description").textContent).toBe(untouched.description);
      expect(cards[1].querySelector(".genre-label").textContent).toBe(untouched.genre);
      const suggestions = render(suggestionsMarkup({ ...state, suggestions: [cached] }, helpers));
      expect(suggestions.querySelector(".suggestion-description").textContent).toBe(t(cached.descriptionKey));
      expect(suggestions.querySelector(".suggestion-genre").textContent).toBe(t(cached.genreKey));
      expect(cached).toEqual(original);
    }
  });

  it("localizes passage result counts including the capped count while leaving quotations untouched", () => {
    setLocale("de");
    for (const count of [0, 1, 2, 20]) {
      const results = Array.from({ length: count }, () => ({ chapterTitle: "Titre original", quote: "Passage original." }));
      const reader = render(readerMarkup({ ...state, passageSearched: true, passageResults: results }, helpers));
      const resultText = reader.querySelector(".passage-results > p").textContent;
      expect(resultText).toBe(count === 0 ? "Keine Textstelle gefunden. Versuche andere Wörter." : count === 1 ? "1 Textstelle gefunden" : count === 20 ? "Die ersten 20 gefundenen Textstellen" : "2 Textstellen gefunden");
      if (count) expect(reader.querySelector(".passage-result q").textContent).toBe("Passage original.");
    }
  });
});
