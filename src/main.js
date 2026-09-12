import { t, locale, setLocale, localeFromPath, localeHref, isLocale, languageSelector, formatNumber } from "./i18n.js";
import { updateSeo } from "./seo.js";
import "./i18n.css";
import "./styles.css";
import "./suggestions.css";
import "./discover.css";
import "./search.css";
import "./home.css";
import "./covers.css";
import "./reader-enhancements.css";
import { homeMarkup } from "./views/home.js";
import { createReadingWakeLock, wordDuration, previousSentenceIndex } from "./reading-comfort.js";
import { readingProfiles, focusOptions, readingFont } from "./reading-preferences.js";
import { previewContent } from "./views/reading-preferences.js";
import { createBackupController } from "./backup-ui.js";
import { registerReaderServiceWorker } from "./pwa-updates.js";
import { searchBarMarkup, localSearchResultsMarkup } from "./views/search.js";
import { partitionSearchResults } from "./search-results.js";
import { parseSearchRoute, buildSearchRoute } from "./search-route.js";
import { selectSuggestions, findLibraryBook } from "./suggestions.js";
import { resolveCover, captureCatalogPresentation } from "./covers.js";
import { getGutenbergReadingStart } from "./reading-start.js";
import { searchPassages } from "./passage-search.js";
import { normalizePosition } from "./reading-state.js";
import { importEpub, applyFocus, exportFocusedEpub, exportClassicEpub } from "./epub.js";
import { searchBooks, downloadBook, providers } from "./catalog.js";
import { libraryMarkup } from "./views/library.js";
import { readerMarkup } from "./views/reader.js";
import { discoverMarkup } from "./views/discover.js";
import {
  getTextContent,
  createTextLocator,
  restoreTextLocator,
  wordIndexForLocator,
  createSelectionLocator,
  applyLocatorHighlight,
} from "./reading-location.js";
import {
  assessImportStorage,
  listBooks,
  getBook,
  saveBook,
  deleteBook,
  getPosition,
  savePosition,
  readSettings,
  defaultSettings,
  writeSettings,
  readSuggestionHistory,
  writeSuggestionHistory,
} from "./storage.js";
import { createDemo } from "./demo.js";

const icons = {
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z"/>',
  moon: '<path d="M20.7 13A9 9 0 0 1 11 3.3 9 9 0 1 0 20.7 13z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 11 3 3 5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
};
const icon = (name, className = "") =>
  `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const escape = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const clamp = (number, min, max) =>
  Math.max(min, Math.min(max, Number(number) || 0));
const app = document.querySelector("#app");
const state = {
  books: [],
  suggestionCatalog: [],
  suggestions: [],
  view: "home",
  book: null,
  position: null,
  settings: { ...defaultSettings },
  searchDraft: "",
  searchLanguageDraft: "fr",
  localSearching: false,
  busy: false,
  catalog: [],
  catalogCount: 0,
  hasNext: false,
  searched: false,
  searching: false,
  query: "",
  language: "fr",
  page: 1,
  catalogError: "",
  settingsOpen: false,
  notesOpen: false,
  provider: "selection",
  passageQuery: "",
  passageResults: [],
  passageSearched: false,
  memory: new Map(),
  offline: !navigator.onLine,
};
let searchController;
let catalogDownloadController;
let toastTimer;
let saveTimer;
let playTimer;
let playing = false;
let words = [];
let installPrompt;
let routeVersion = 0;
let warnedStorage = false;
let restoringLocation = false;
let readingResizeObserver;
let pendingSelection;
let captureTimer;
let lastRsvpSave = 0;
const wordMeasure = document.createElement("canvas").getContext("2d");
const newId = () =>
  crypto.randomUUID?.() ||
  `mark-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const wakeLock = createReadingWakeLock({ onChange: (active) => {
  const status = document.getElementById("wake-lock-status");
  if (status) status.hidden = !active;
} });
const backups = createBackupController({
  beforeExport: async () => {
    if (state.busy) throw new Error(t("Attendez la fin de l’ouverture du livre."));
    pause();
    if (await persistPosition() === false) throw new Error(t("La position n’a pas pu être sauvegardée. Réessayez avant de créer la sauvegarde."));
    await writeSettings(state.settings);
  },
  afterRestore: async () => {
    // The merge owns the new positions. Do not let openBook save a stale copy
    // if browser Back reopened the reader behind the backup dialog.
    const currentId = state.book?.id;
    clearTimeout(saveTimer);
    clearTimeout(captureTimer);
    captureTimer = null;
    state.book = null;
    state.position = null;
    state.settings = await readSettings();
    setLocale(state.settings.locale);
    history.replaceState(null, "", localeHref(locale));
    window.dispatchEvent(new Event("languagechange"));
    await refreshLibrary();
    if (currentId) await openBook(currentId, false);
    else renderShell();
  },
});

function toast(message, persistent = false) {
  const element = document.querySelector("#toast");
  clearTimeout(toastTimer);
  element.textContent = t(message);
  element.hidden = false;
  if (!persistent)
    toastTimer = setTimeout(() => {
      element.hidden = true;
    }, 5500);
}

function storageError() {
  if (!warnedStorage) {
    warnedStorage = true;
    toast(
      t("Le stockage de cet appareil est indisponible ou plein. Votre lecture reste possible dans cet onglet, mais ne sera pas conservée."),
      true,
    );
  }
}

function ensureImportInput() {
  if (document.querySelector("#epub-file")) return;
  // Keep the selected file alive while search results refresh the page.
  const input = document.createElement("input");
  input.id = "epub-file";
  input.type = "file";
  input.accept = ".epub,application/epub+zip";
  input.hidden = true;
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = "";
    importFile(file);
  });
  document.body.append(input);
}
function importButton(extra = "") {
  return `<button class="button primary ${extra}" data-action="import" aria-label="${escape(t("Importer un EPUB"))}" ${state.busy ? "disabled" : ""}>${icon("plus")}<span>${state.busy ? t("Ouverture…") : t("Importer un EPUB")}</span></button>`;
}
function brand() {
  return `<a class="brand" href="#home" aria-label="${escape(t("FastReader, accueil"))}"><span class="brand-mark">${icon("book")}</span><span>fast<span class="brand-light">reader</span><span class="brand-dot">.</span></span></a>`;
}
function cover(book) {
  const visual = resolveCover(book, [
    ...state.suggestionCatalog,
    ...state.catalog,
  ]);
  const palette =
    Array.from(visual.key).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    5;
  return `<div class="cover cover-${palette}" style="--cover-title-scale:${visual.title.length > 130 ? 0.72 : visual.title.length > 65 ? 0.85 : 1}"><div class="cover-design" aria-hidden="true"><span class="cover-kicker">${book.demo ? t("LES PETITES PAUSES") : t("LA BIBLIOTHÈQUE")}</span><span class="cover-title">${escape(visual.title)}</span><span class="cover-rule"></span><span class="cover-author">${escape(visual.author)}</span></div>${visual.image ? `<img src="${escape(visual.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}<span class="cover-open">${icon("book")} ${t("Lire")}</span></div>`;
}

function themeButton() {
  const nextIsLight = state.settings.theme === "night";
  const label = nextIsLight
    ? t("Passer au thème clair")
    : t("Passer au thème sombre");
  return `<button class="round-button theme-toggle" data-action="global-theme" aria-label="${label}" title="${label}">${icon(nextIsLight ? "sun" : "moon")}</button>`;
}

function renderShell({ resetScroll = false } = {}) {
  syncInterfaceLanguage();
  ensureImportInput();
  const focusedField = ["search-query", "search-language"].includes(document.activeElement?.id) ? document.activeElement.id : null;
  const selection = focusedField === "search-query" ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const scrollY = resetScroll ? 0 : window.scrollY;
  const pageTitle = state.view === "home" ? t("Accueil") : state.view === "library" ? t("Ma bibliothèque") : state.view === "search" ? t("Recherche") : t("Découvrir");
  applySettings();
  document.body.classList.remove("reading");
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">${brand()}<p class="nav-label">${t("VOTRE ESPACE DE LECTURE")}</p>
      <nav aria-label="${escape(t("Navigation principale"))}"><a href="#home" class="nav-item ${state.view === "home" ? "active" : ""}" ${state.view === "home" ? 'aria-current="page"' : ""}>${icon("book")}<span>${t("Accueil")}</span></a><a href="#library" class="nav-item ${state.view === "library" ? "active" : ""}" ${state.view === "library" ? 'aria-current="page"' : ""}>${icon("grid")}<span>${t("Ma bibliothèque")}</span><span class="nav-count">${state.books.length}</span></a><a href="#discover" class="nav-item ${state.view === "discover" ? "active" : ""}" ${state.view === "discover" ? 'aria-current="page"' : ""}>${icon("compass")}<span>${t("Découvrir")}</span></a><button class="nav-item mobile-import" data-action="import">${icon("plus")}<span>${t("Importer")}</span></button></nav>
      <div class="sidebar-bottom"><button class="install-link" data-action="backup">${icon("download")} ${t("Sauvegarde et stockage")}</button><button class="install-link" data-action="install" ${matchMedia("(display-mode: standalone)").matches ? "hidden" : ""}>${icon("download")} ${t("Installer l’application")}</button><div class="local-note">${icon("shield")} ${t("Enregistré sur cet appareil")}</div></div>
    </aside>
    <div class="workspace"><header class="shell-header"><div class="topbar"><span>${pageTitle}</span><div class="topbar-right">${languageSelector()}${themeButton()}${importButton("compact")}</div></div>${searchBarMarkup(state, { icon, escape })}</header><main id="main" tabindex="-1" class="dashboard">${state.offline ? `<div class="offline-notice" role="status">${icon("check")} ${t("Hors connexion · Vos livres enregistrés restent disponibles.")}</div>` : ""}${state.view === "home" ? homeMarkup(state, { icon, escape, cover }) : state.view === "library" ? libraryMarkup(state, { icon, escape, cover }) : discoverView()}</main><footer class="page-footer"><button class="install-link" data-action="backup">${t("Sauvegarde et stockage")}</button><span>${t("Vos livres et vos repères, sur cet appareil.")}</span><button class="install-link footer-install" data-action="install" ${matchMedia("(display-mode: standalone)").matches ? "hidden" : ""}>${icon("download")} ${t("Installer l’application")}</button></footer></div>
    </div>`;
  bindImages();
  window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
  if (focusedField) {
    const input = document.getElementById(focusedField);
    input?.focus({ preventScroll: true });
    if (selection) input?.setSelectionRange(...selection);
  }
}

function discoverView() {
  if (state.view !== "search") return discoverMarkup(state, { icon, escape, cover, providers });
  const { localBooks, remoteBooks, alreadyOwnedCount } = partitionSearchResults({ books: state.books, catalog: state.catalog, query: state.query });
  return `<section class="search-intro"><span class="eyebrow">${t("UNE RECHERCHE, TOUS VOS LIVRES")}</span><h1>${state.query ? t("Résultats pour « {query} »", { query: escape(state.query) }) : t("Tous les livres")}</h1><p>${t("Vos livres d’abord, puis de nouvelles lectures à découvrir.")}</p></section>${localSearchResultsMarkup({ ...state, localSearchResults: localBooks }, { icon, escape, cover })}${discoverMarkup({ ...state, catalog: remoteBooks, alreadyOwnedCount }, { icon, escape, cover, providers })}`;
}

function bindImages() {
  app.querySelectorAll(".cover img").forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
}

async function refreshLibrary() {
  try {
    state.books = (await listBooks()).filter((book) => !book.demo);
  } catch {
    storageError();
  }
  for (const book of state.memory.values()) {
    if (!book.demo && !state.books.some((entry) => entry.id === book.id))
      state.books.unshift(book);
  }
}

async function refreshSuggestions(
  previousIds = state.suggestions.map((book) => book.id),
) {
  state.suggestions = selectSuggestions({
    catalog: state.suggestionCatalog,
    library: state.books,
    previousIds,
    seed: newId(),
    limit: 3,
  });
  try {
    await writeSuggestionHistory(state.suggestions.map((book) => book.id));
  } catch {
    storageError();
  }
}

function readerView() {
  return readerMarkup(state, { icon, escape, applyFocus });
}

function restoreReaderPosition() {
  const root = document.querySelector("#chapter-content");
  const scroll = document.querySelector("#chapter-scroll");
  if (!root || !scroll || state.settings.mode === "rsvp") return;
  restoringLocation = true;
  if (state.position.locator)
    restoreTextLocator(root, state.position.locator, scroll);
  else
    scroll.scrollTop =
      state.position.scrollRatio *
      Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  requestAnimationFrame(() => {
    if (!scroll.isConnected) return;
    restoringLocation = false;
    if (!state.position.locator) captureReaderPosition();
    else
      state.position.scrollRatio = clamp(
        scroll.scrollTop /
          Math.max(1, scroll.scrollHeight - scroll.clientHeight),
        0,
        1,
      );
    updateProgress();
  });
}

function renderReader() {
  syncInterfaceLanguage();
  const previousPanelFocus = document.activeElement?.closest("#reader-settings, #reader-notes") ? document.activeElement.id : null;
  ensureImportInput();
  pause();
  clearTimeout(captureTimer);
  captureTimer = null;
  pendingSelection = null;
  readingResizeObserver?.disconnect();
  document.body.classList.add("reading");
  app.innerHTML = readerView();
  const announcement = document.getElementById("reader-announcement");
  if (announcement) announcement.textContent = t("Chapitre {current} sur {total} : {title}", { current: state.position.chapterIndex + 1, total: state.book.chapters.length, title: state.book.chapters[state.position.chapterIndex].title });
  applySettings();
  const root = document.querySelector("#chapter-content");
  const scroll = document.querySelector("#chapter-scroll");
  words = getTextContent(root).trim().split(/\s+/u).filter(Boolean);
  if (state.position.locator)
    state.position.wordIndex = wordIndexForLocator(
      root,
      state.position.locator,
    );
  state.position.wordIndex = clamp(
    state.position.wordIndex,
    0,
    Math.max(0, words.length - 1),
  );
  for (const note of state.position.annotations || []) {
    if (note.chapterIndex === state.position.chapterIndex)
      applyLocatorHighlight(root, note.locator, {
        className: "reader-highlight",
        id: note.id,
      });
  }
  requestAnimationFrame(() => {
    if (!scroll.isConnected) return;
    restoreReaderPosition();
    scroll.addEventListener("scroll", onReadScroll, { passive: true });
    let previousWidth = scroll.clientWidth;
    readingResizeObserver = new ResizeObserver(() => {
      for (const [selector, variable] of [
        [".reader-control-panel", "--reader-footer-height"],
        [".reader-header", "--reader-header-height"],
        [".reader-modebar", "--reader-modebar-height"],
      ]) {
        const element = document.querySelector(selector);
        if (element)
          document.documentElement.style.setProperty(
            variable,
            `${element.offsetHeight}px`,
          );
      }
      fitRsvpWord();
      if (scroll.clientWidth !== previousWidth) {
        previousWidth = scroll.clientWidth;
        restoreReaderPosition();
      }
    });
    for (const selector of [
      ".reading-main",
      ".reader-control-panel",
      ".reader-header",
      ".reader-modebar",
    ]) {
      const element = document.querySelector(selector);
      if (element) readingResizeObserver.observe(element);
    }
  });
  updateRsvp();
  updateProgress();
  syncReaderPanels();
  const panel = document.getElementById(state.settingsOpen ? "reader-settings" : state.notesOpen ? "reader-notes" : "");
  if (panel) {
    const previous = previousPanelFocus && document.getElementById(previousPanelFocus);
    (previous && panel.contains(previous) ? previous : panel.querySelector("button, select, input"))?.focus({ preventScroll: true });
  }
}

function captureReaderPosition() {
  const root = document.querySelector("#chapter-content");
  const scroll = document.querySelector("#chapter-scroll");
  if (!root || !scroll || !state.book || state.position.completed) return;
  const options = {
    chapterId: state.book.chapters[state.position.chapterIndex].id,
    scrollContainer: scroll,
  };
  if (state.settings.mode === "rsvp")
    options.wordIndex = state.position.wordIndex;
  state.position.locator = createTextLocator(root, options);
  state.position.chapterProgress = state.position.locator.progression;
  if (state.settings.mode !== "rsvp") {
    state.position.wordIndex = wordIndexForLocator(
      root,
      state.position.locator,
    );
    state.position.scrollRatio = clamp(
      scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight),
      0,
      1,
    );
  }
  const bookmark = document.querySelector(
    '.reader-tools [data-action="bookmark"]',
  );
  if (bookmark)
    bookmark.classList.toggle(
      "is-marked",
      state.position.bookmarks.some(
        (mark) =>
          mark.chapterIndex === state.position.chapterIndex &&
          Math.abs(
            (mark.locator?.textOffset ?? -1000) -
              state.position.locator.textOffset,
          ) < 25,
      ),
    );
  const quote = document.querySelector("#auto-bookmark-quote");
  if (quote) quote.textContent = state.position.locator.exact;
}

function savePreferences() {
  void writeSettings(state.settings).catch(() =>
    toast(
      t("Ce réglage reste actif, mais sa sauvegarde sur cet appareil a échoué."),
    ),
  );
}

function applySettings() {
  document.documentElement.style.setProperty("--reading-line-height", state.settings.lineHeight);
  document.documentElement.style.setProperty("--reading-column-width", `${state.settings.columnWidth}ch`);
  document.body.dataset.theme = state.settings.theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor)
    themeColor.content =
      state.settings.theme === "night"
        ? "#101619"
        : state.settings.theme === "sepia"
          ? "#f2e9d8"
          : "#f6f7f8";
  document.documentElement.style.setProperty(
    "--reading-size",
    `${state.settings.fontSize}px`,
  );
  document.documentElement.style.setProperty(
    "--reading-font",
    readingFont(state.settings.font),
  );
}

function syncInterfaceLanguage() {
  updateSeo(locale, { privatePage: state.view !== "home" });
  if (state.book) document.title = `${state.book.title} — FastReader`;
  document.querySelector(".skip-link").textContent = t("Aller au contenu");
  document.body.dataset.dropLabel = t("Déposez votre EPUB pour commencer à lire");
}

async function changeInterfaceLanguage(language, { updateHistory = true } = {}) {
  if (!isLocale(language) || state.busy) return;
  pause();
  await persistPosition();
  setLocale(language);
  state.settings.locale = language;
  if (updateHistory) history.pushState(null, "", localeHref(language));
  savePreferences();
  // Only editorial presentation changes. Imported EPUB content stays intact.
  const selectedIds = state.suggestions.map((book) => book.id);
  state.suggestionCatalog = (await searchBooks({ provider: "selection", language: "fr" })).books;
  state.suggestions = selectedIds.map((id) => state.suggestionCatalog.find((book) => book.id === id)).filter(Boolean);
  if (state.book) renderReader();
  else if (["discover", "search"].includes(state.view)) await runSearch(state.page);
  else renderShell();
  window.dispatchEvent(new Event("languagechange"));
  app.querySelector(".language-picker > summary")?.focus({ preventScroll: true });
}

function updateReadingPreferences(patch) {
  pause();
  ensureReaderPosition();
  const focused = "focusIntensity" in patch || "skipShortWords" in patch || "profile" in patch;
  Object.assign(state.settings, patch);
  if (!("profile" in patch)) state.settings.profile = "custom";
  applySettings();
  const preview = document.getElementById("reading-preview");
  if (preview) {
    preview.innerHTML = previewContent(state.settings, applyFocus);
    preview.dataset.focus = state.settings.mode === "focus";
  }
  if (focused) {
    const root = document.getElementById("chapter-content");
    root.innerHTML = applyFocus(state.book.chapters[state.position.chapterIndex].html, state.settings.mode === "focus", focusOptions(state.settings));
    for (const note of state.position.annotations || []) {
      if (note.chapterIndex === state.position.chapterIndex) applyLocatorHighlight(root, note.locator, { className: "reader-highlight", id: note.id });
    }
  }
  for (const [id, key, unit] of [["font-size", "fontSize", " px"], ["line-height", "lineHeight", ""], ["column-width", "columnWidth", t(" caractères")], ["focus-intensity", "focusIntensity", " %"], ["font-family", "font", ""], ["reading-profile", "profile", ""]]) {
    const input = document.getElementById(id);
    if (input) input.value = state.settings[key];
    const output = document.getElementById(`${id}-value`);
    if (output) output.textContent = `${typeof state.settings[key] === "number" ? formatNumber(state.settings[key]) : state.settings[key]}${unit}`;
  }
  const skip = document.getElementById("skip-short-words");
  if (skip) skip.checked = state.settings.skipShortWords;
  requestAnimationFrame(() => { restoreReaderPosition(); fitRsvpWord(); });
  savePreferences();
}

function syncReaderPanels() {
  const active = state.settingsOpen ? "reader-settings" : state.notesOpen ? "reader-notes" : null;
  for (const selector of [".reader-header", ".reader-modebar", ".reading-main", ".reader-footer"]) {
    const element = document.querySelector(selector);
    if (element) element.inert = Boolean(active);
  }
  for (const [id, title] of [["reader-settings", t("Réglages de lecture")], ["reader-notes", t("Mes repères")]]) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);
    panel.setAttribute("aria-modal", "true");
  }
}

function showInstallHelp() {
  const trigger = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "toc-dialog";
  dialog.setAttribute("aria-label", t("Installer FastReader"));
  dialog.innerHTML = `<div class="dialog-heading"><h2>${t("Installer FastReader")}</h2><button class="round-button" aria-label="${escape(t("Fermer l’aide à l’installation"))}">${icon("close")}</button></div><p>${t("Retrouvez le lecteur depuis votre écran d’accueil.")}</p><ul><li><strong>${t("iPhone / iPad :")}</strong> ${t("dans Safari, ouvrez Partager puis « Sur l’écran d’accueil ».")}</li><li><strong>${t("Android :")}</strong> ${t("dans le menu du navigateur, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».")}</li><li><strong>${t("Ordinateur :")}</strong> ${t("cherchez l’icône d’installation dans la barre d’adresse ou le menu du navigateur, si cette option est proposée.")}</li></ul><p>${t("Ouvrez l’application avec une connexion une première fois. Les livres ajoutés à votre bibliothèque restent ensuite lisibles hors ligne.")}</p><button class="button ink">${t("Compris")}</button>`;
  document.body.append(dialog);
  for (const button of dialog.querySelectorAll("button")) button.onclick = () => dialog.close();
  dialog.addEventListener("close", () => { dialog.remove(); trigger?.focus(); }, { once: true });
  dialog.showModal();
}

function showTableOfContents() {
  pause();
  void persistPosition();
  const trigger = document.querySelector('[data-action="toc"]');
  const dialog = document.createElement("dialog");
  dialog.className = "toc-dialog";
  dialog.setAttribute("aria-label", t("Sommaire"));
  dialog.innerHTML = `<div class="dialog-heading"><h2>${t("Sommaire")}</h2><button class="round-button" aria-label="${escape(t("Fermer le sommaire"))}">${icon("close")}</button></div><nav aria-label="${escape(t("Chapitres du livre"))}"><ol>${state.book.chapters.map((chapter, index) => `<li><button data-chapter="${index}" ${index === state.position.chapterIndex ? 'aria-current="location"' : ""}>${index + 1}. ${escape(chapter.title)}</button></li>`).join("")}</ol></nav>`;
  document.body.append(dialog);
  dialog.querySelector(".round-button").onclick = () => dialog.close();
  dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-chapter]");
    if (!button) return;
    const index = Number(button.dataset.chapter);
    dialog.close();
    await changeChapter(index);
    document.getElementById("main")?.focus();
  });
  dialog.addEventListener("close", () => { dialog.remove(); trigger?.focus(); }, { once: true });
  dialog.showModal();
}

function progressValue() {
  if (state.position.completed) return 1;
  const chapters = state.book.chapters;
  const before = chapters
    .slice(0, state.position.chapterIndex)
    .reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return clamp(
    (before +
      chapters[state.position.chapterIndex].wordCount *
        (state.position.chapterProgress ?? state.position.scrollRatio)) /
      (state.book.totalWords || 1),
    0,
    1,
  );
}

function updateProgress() {
  if (!state.book) return;
  state.position.progress = progressValue();
  const progress = document.querySelector("#book-progress");
  if (!progress) return;
  progress.value = state.position.progress;
  const scroll = document.querySelector("#chapter-scroll");
  const screen = document.querySelector("#screen-position");
  if (scroll && screen && state.settings.mode !== "rsvp") {
    const pages = Math.max(
      1,
      Math.ceil(scroll.scrollHeight / Math.max(1, scroll.clientHeight)),
    );
    const current = Math.min(
      pages,
      1 + Math.floor(scroll.scrollTop / Math.max(1, scroll.clientHeight)),
    );
    screen.textContent = t("Écran {current} / {total}", { current, total: pages });
  }
  document.querySelector("#progress-label").textContent =
    t("{percent} % parcouru", { percent: Math.round(state.position.progress * 100) });
  const remaining = Math.ceil(
    (state.book.totalWords * (1 - state.position.progress)) /
      state.settings.speed,
  );
  document.querySelector("#remaining-label").textContent = remaining
    ? t("≈ {minutes} min restantes", { minutes: remaining })
    : t("Lecture terminée");
}

function onReadScroll() {
  if (!state.book || state.settings.mode === "rsvp" || restoringLocation)
    return;
  state.position.completed = false;
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    captureTimer = null;
    captureReaderPosition();
    updateProgress();
    scheduleSave();
  }, 120);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistPosition(), 350);
}
async function persistPosition() {
  clearTimeout(saveTimer);
  if (captureTimer) {
    clearTimeout(captureTimer);
    captureTimer = null;
    captureReaderPosition();
  }
  if (!state.book || !state.position) return;
  if (state.settings.mode === "rsvp") captureReaderPosition();
  const position = structuredClone(state.position);
  const book = state.book;
  state.memory.get(book.id) && (state.memory.get(book.id).position = position);
  try {
    await savePosition(book.id, position);
    const status = document.querySelector("#save-status");
    if (status && state.book?.id === book.id)
      status.textContent = t("Position enregistrée ici");
    return true;
  } catch {
    storageError();
    return false;
  }
}

async function openBook(id, setHash = true) {
  searchController?.abort();
  const version = ++routeVersion;
  pause();
  await persistPosition();
  let book;
  let position;
  try {
    book = await getBook(id);
    position = await getPosition(id);
  } catch {
    storageError();
  }
  if (version !== routeVersion) return;
  book ||= state.memory.get(id);
  position ||= book?.position;
  if (!book) {
    toast(
      t("Ce livre n’est pas présent sur cet appareil. Importez son EPUB pour le lire."),
    );
    location.hash = "library";
    return;
  }
  if (state.book?.id !== book.id) {
    state.passageQuery = "";
    state.passageResults = [];
    state.passageSearched = false;
  }
  state.book = book;
  state.view = "reader";
  state.position = normalizePosition(position, book);
  if (!position)
    state.position.chapterIndex = Math.max(
      0,
      book.chapters.findIndex((chapter) => chapter.wordCount > 0),
    );
  if (!position && book.source?.readingStart) {
    const hint = book.source.readingStart;
    const index = book.chapters.findIndex(
      (chapter) => chapter.id === hint.chapterId,
    );
    if (
      index >= 0 &&
      typeof hint.exact === "string" &&
      hint.exact.length >= 10
    ) {
      const article = document.createElement("article");
      article.innerHTML = book.chapters[index].html;
      const offset = getTextContent(article).indexOf(hint.exact);
      if (offset >= 0) {
        state.position.chapterIndex = index;
        state.position.locator = createTextLocator(article, {
          chapterId: hint.chapterId,
          textOffset: offset,
        });
        state.position.chapterProgress = state.position.locator.progression;
      }
    }
  }
  if (setHash) history.pushState(null, "", `#read=${encodeURIComponent(id)}`);
  document.title = `${book.title} — FastReader`;
  renderReader();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

async function navigate() {
  // Handle path and hash together on browser Back/Forward. A separate async
  // language handler could otherwise reopen a stale book while routing.
  const routeLocale = localeFromPath();
  if (routeLocale !== locale) {
    setLocale(routeLocale);
    state.settings.locale = routeLocale;
    savePreferences();
    window.dispatchEvent(new Event("languagechange"));
  }
  catalogDownloadController?.abort();
  searchController?.abort();
  const route = location.hash.slice(1);
  if (route.startsWith("read=")) {
    try {
      await openBook(decodeURIComponent(route.slice(5)), false);
    } catch {
      toast("Impossible d’ouvrir ce lien de lecture.");
      location.hash = "library";
    }
    return;
  }
  const version = ++routeVersion;
  pause();
  const savedPosition = persistPosition();
  state.book = null;
  Object.assign(state, parseSearchRoute(location.hash));
  if (!route || route === "home") state.view = "home";
  state.searchDraft = state.query;
  state.searchLanguageDraft = state.language;
  state.localSearching = true;
  state.catalog = [];
  state.catalogCount = 0;
  state.catalogError = "";
  state.catalogWarnings = [];
  state.hasNext = false;
  state.searched = false;
  state.searching = ["search", "discover"].includes(state.view);
  if (route === "account") history.replaceState(null, "", "#library");
  document.title = `${state.view === "home" ? t("Accueil") : state.view === "library" ? t("Ma bibliothèque") : state.view === "search" ? t("Recherche") : t("Découvrir")} — FastReader`;
  renderShell({ resetScroll: true });
  const localTask = (async () => {
    await savedPosition;
    if (version !== routeVersion) return;
    await refreshLibrary();
    if (version !== routeVersion) return;
    state.localSearching = false;
    renderShell();
  })();
  // Personal books and source catalogs load independently; either can finish first.
  const remoteTask = ["home", "library"].includes(state.view) ? undefined : runSearch(state.page);
  await Promise.all([localTask, remoteTask]);
}

function navigateSearch(values) {
  const hash = buildSearchRoute(values);
  if (location.hash !== hash) history.pushState(null, "", hash);
  return navigate();
}

async function importFile(file, source, { signal } = {}) {
  if (!file || state.busy) return;
  state.busy = true;
  toast(t("Ouverture de {title}…", { title: file.name }), true);
  app
    .querySelectorAll('[data-action="import"], [data-action="catalog-read"]')
    .forEach((button) => {
      button.disabled = true;
    });
  try {
    const storage = await assessImportStorage(file.size);
    if (storage.warning) toast(storage.warning, true);
    const book = await importEpub(file, { onProgress: ({ message, percent }) => {
      if (!signal?.aborted) toast(`${message} · ${percent} %${storage.warning ? ` — ${storage.warning}` : ""}`, true);
    } });
    if (signal?.aborted) return;
    let existing;
    try {
      existing = await getBook(book.id);
    } catch {
      /* Import can continue in memory. */
    }
    if (source || existing?.source) book.source = source || existing.source;
    if (book.source?.providerId === "gutenberg" && !book.source.readingStart) {
      book.source.readingStart = getGutenbergReadingStart(book);
    }
    if (existing?.addedAt) book.addedAt = existing.addedAt;
    if (signal?.aborted) return;
    try {
      await saveBook(book);
      state.memory.delete(book.id);
    } catch {
      state.memory.set(book.id, book);
      storageError();
    }
    await refreshLibrary();
    if (signal?.aborted) return;
    state.busy = false;
    await openBook(book.id);
    if (!warnedStorage)
      toast(
        existing
          ? t("Votre livre est prêt. Bonne lecture !")
          : t("Ajouté à votre bibliothèque. Bonne lecture !"),
      );
  } catch (error) {
    toast(error.message || t("Impossible d’ouvrir ce fichier EPUB."));
  } finally {
    state.busy = false;
    app
      .querySelectorAll('[data-action="import"], [data-action="catalog-read"]')
      .forEach((button) => {
        button.disabled = false;
      });
  }
}

async function runSearch(page = 1) {
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  state.page = page;
  state.searching = true;
  state.catalogError = "";
  state.catalogWarnings = [];
  state.catalog = [];
  if (state.view === "discover" || state.view === "search") renderShell();
  try {
    const result = await searchBooks({
      query: state.query,
      provider: state.provider,
      language: state.language,
      page,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    state.catalog = result.books;
    state.catalogCount = result.count;
    state.hasNext = result.hasNext;
    state.catalogWarnings = result.warnings || [];
    state.catalogCountIsApproximate = !!result.countIsApproximate;
  } catch (error) {
    if (controller.signal.aborted) return;
    state.catalogError =
      error.message || t("Vérifiez votre connexion puis réessayez.");
    state.hasNext = false;
  } finally {
    if (!controller.signal.aborted) {
      state.searching = false;
      state.searched = true;
      if (state.view === "discover" || state.view === "search") renderShell();
    }
  }
}

function showDownloadFallback(book, error) {
  const manualImport = book.downloadMode === "manual";
  const dialog = document.createElement("dialog");
  dialog.className = "fallback-dialog";
  dialog.setAttribute("aria-label", manualImport ? t("Obtenir {title}", { title: book.title }) : t("Ouvrir {title}", { title: book.title }));
  dialog.innerHTML = `<div class="dialog-heading"><span class="eyebrow">${t("VOTRE PROCHAINE LECTURE")}</span><button class="round-button" aria-label="${escape(t("Fermer"))}">${icon("close")}</button></div><h2>${escape(book.title)}</h2>${manualImport ? "" : `<button class="button ink dialog-retry">${icon("download")} ${t("Réessayer")}</button>`}<p>${escape(error.message || t("La source ne permet pas l’ouverture directe dans ce navigateur."))}</p><ol><li>${t("Ouvrez la fiche du livre et vérifiez ses droits dans votre pays.")}</li><li>${t("Téléchargez le format EPUB.")}</li><li>${t("Revenez ici et importez le fichier.")}</li></ol><a class="button ink" href="${escape(book.sourceUrl)}" target="_blank" rel="noopener noreferrer">${manualImport ? t("Télécharger sur Gutenberg") : t("Ouvrir la fiche source")} ${icon("external")}</a><button class="button secondary dialog-import">${t("Importer mon EPUB")} ${icon("plus")}</button>`;
  document.body.append(dialog);
  dialog.querySelector(".round-button").onclick = () => dialog.close();
  dialog.querySelector(".dialog-retry")?.addEventListener("click", () => {
    dialog.close();
    readCatalogBook(book.id);
  });
  dialog.querySelector(".dialog-import").onclick = () => {
    dialog.close();
    document.querySelector("#epub-file").click();
  };
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function readCatalogBook(id) {
  if (state.busy) return;
  const book =
    state.catalog.find((item) => item.id === id) ||
    state.suggestionCatalog.find((item) => item.id === id);
  if (!book) return;
  state.busy = true;
  const controller = new AbortController();
  catalogDownloadController = controller;
  try {
    await refreshLibrary();
    controller.signal.throwIfAborted();
    const local = findLibraryBook(book, state.books);
    if (local) {
      state.busy = false;
      await openBook(local.id);
      toast("Votre lecture reprend à l’endroit enregistré.");
      return;
    }
    if (book.downloadMode === "manual") {
      showDownloadFallback(book, {
        message: t("Ce titre est disponible sur Project Gutenberg. Téléchargez son EPUB, puis importez-le ici : il rejoindra vos livres et gardera votre progression."),
      });
      return;
    }
    renderShell();
    toast(t("Ouverture de {title}…", { title: book.title }), true);
    const file = await downloadBook(book, { signal: controller.signal });
    controller.signal.throwIfAborted();
    state.busy = false;
    await importFile(
      file,
      {
        name: book.source,
        providerId: book.providerId,
        bookId: book.id,
        url: book.sourceUrl,
        rights: book.rights,
        rightsUrl: book.rightsUrl,
        canonicalSourceId: book.canonicalSourceId,
        selection: book.providerId === "selection" ? book.id : undefined,
        readingStart: book.readingStart,
        presentation: captureCatalogPresentation(book),
      },
      { signal: controller.signal },
    );
  } catch (error) {
    document.querySelector("#toast").hidden = true;
    if (!controller.signal.aborted) showDownloadFallback(book, error);
  } finally {
    if (catalogDownloadController === controller) {
      catalogDownloadController = undefined;
      state.busy = false;
      if (state.view !== "reader") renderShell();
    }
  }
}

async function changeChapter(index, position = {}) {
  pause();
  if (index >= state.book.chapters.length) {
    state.position.completed = true;
    state.position.scrollRatio = 1;
    state.position.chapterProgress = 1;
    updateProgress();
    await persistPosition();
    toast("Livre terminé. Une belle histoire de plus !");
    location.hash = "library";
    return;
  }
  state.position.completed = false;
  state.position.chapterIndex = clamp(index, 0, state.book.chapters.length - 1);
  state.position.scrollRatio = clamp(position.scrollRatio, 0, 1);
  state.position.wordIndex = Math.max(0, position.wordIndex || 0);
  state.position.locator = position.locator || null;
  state.position.chapterProgress =
    position.locator?.progression ?? state.position.scrollRatio;
  renderReader();
  await persistPosition();
}

function pause() {
  void wakeLock.setActive(false);
  clearTimeout(playTimer);
  playing = false;
  const button = document.querySelector("#play-button");
  if (button) button.innerHTML = `${icon("play")} ${t("Reprendre")}`;
}

function fitRsvpWord() {
  const element = document.querySelector("#rsvp-word");
  const stage = document.querySelector(".rsvp-stage");
  if (
    !element ||
    !stage ||
    !stage.clientWidth ||
    state.settings.mode !== "rsvp"
  )
    return;
  element.style.fontSize = "";
  element.style.transform = "";
  const style = getComputedStyle(element);
  const baseSize = parseFloat(style.fontSize);
  if (!wordMeasure || !baseSize) return;
  wordMeasure.font = `${style.fontWeight} ${baseSize}px ${style.fontFamily}`;
  const width = wordMeasure.measureText(element.textContent).width;
  const available = Math.max(40, stage.clientWidth - 36);
  if (width > available) {
    const fitted = Math.max(18, (baseSize * available) / width);
    element.style.fontSize = `${fitted}px`;
    // Extremely long tokens stay contained; the complete passage remains one tap away.
    if ((width * fitted) / baseSize > available)
      element.style.transform = `scaleX(${available / ((width * fitted) / baseSize)})`;
  }
}

function updateRsvp() {
  const element = document.querySelector("#rsvp-word");
  if (!element) return;
  element.textContent = words[state.position.wordIndex] || t("Fin du chapitre");
  fitRsvpWord();
  const context = document.querySelector("#rsvp-context-text");
  if (context)
    context.textContent = words
      .slice(
        Math.max(0, state.position.wordIndex - 10),
        state.position.wordIndex + 16,
      )
      .join(" ");
  document.querySelector("#rsvp-count").textContent =
    t("{current} / {total} mots · {speed} mots/min", { current: formatNumber(Math.min(state.position.wordIndex + 1, words.length)), total: formatNumber(words.length), speed: state.settings.speed });
}

function advanceWord(offset) {
  state.position.completed = false;
  state.position.wordIndex = clamp(
    state.position.wordIndex + offset,
    0,
    Math.max(0, words.length - 1),
  );
  state.position.scrollRatio =
    words.length <= 1 ? 1 : state.position.wordIndex / (words.length - 1);
  state.position.chapterProgress = state.position.scrollRatio;
  updateRsvp();
  updateProgress();
  if (playing && Date.now() - lastRsvpSave > 2000) {
    lastRsvpSave = Date.now();
    void persistPosition();
  } else scheduleSave();
}

function play() {
  if (playing) {
    pause();
    persistPosition();
    return;
  }
  if (!words.length) return;
  if (state.position.wordIndex >= words.length - 1) advanceWord(-words.length);
  playing = true;
  void wakeLock.setActive(state.settings.wakeLock);
  document.querySelector("#play-button").innerHTML = `${icon("pause")} ${t("Pause")}`;
  const tick = () => {
    if (!playing) return;
    if (state.position.wordIndex >= words.length - 1) {
      pause();
      persistPosition();
      toast("Fin du chapitre. Passez au suivant pour continuer.");
      return;
    }
    advanceWord(1);
    playTimer = setTimeout(tick, wordDuration(words[state.position.wordIndex], state.settings.speed, state.settings.cadence));
  };
  playTimer = setTimeout(tick, wordDuration(words[state.position.wordIndex], state.settings.speed, state.settings.cadence));
}

function ensureReaderPosition() {
  if (
    captureTimer ||
    state.settings.mode === "rsvp" ||
    !state.position.locator
  ) {
    clearTimeout(captureTimer);
    captureTimer = null;
    captureReaderPosition();
  }
}

function changeReadingMode(mode) {
  if (!["classic", "focus", "rsvp"].includes(mode)) return;
  pause();
  ensureReaderPosition();
  state.settings.mode = mode;
  savePreferences();
  renderReader();
  scheduleSave();
}

function clearSelection() {
  pendingSelection = null;
  window.getSelection()?.removeAllRanges();
  const toolbar = document.querySelector("#selection-toolbar");
  if (toolbar) toolbar.hidden = true;
}

async function saveAnnotation(note = "", existingIndex) {
  if (!state.book) return;
  if (Number.isInteger(existingIndex))
    state.position.annotations[existingIndex].note = note.trim().slice(0, 4000);
  else {
    if (!pendingSelection) return;
    const locator = structuredClone(pendingSelection);
    const duplicate = state.position.annotations.find(
      (item) =>
        item.chapterIndex === state.position.chapterIndex &&
        item.locator.textOffset === locator.textOffset &&
        item.quote === locator.exact,
    );
    if (duplicate) {
      if (note.trim()) duplicate.note = note.trim().slice(0, 4000);
    } else
      state.position.annotations.push({
        id: newId(),
        chapterIndex: state.position.chapterIndex,
        locator,
        quote: locator.exact,
        note: note.trim().slice(0, 4000),
        color: "gold",
        createdAt: Date.now(),
      });
  }
  clearSelection();
  await persistPosition();
  state.notesOpen = true;
  state.settingsOpen = false;
  renderReader();
  toast("Passage enregistré dans Mes repères.");
}

function showNoteDialog(index) {
  const annotation = Number.isInteger(index)
    ? state.position.annotations[index]
    : null;
  const locator = annotation?.locator || pendingSelection;
  if (!locator) return;
  pause();
  const bookId = state.book.id;
  const dialog = document.createElement("dialog");
  dialog.className = "fallback-dialog note-dialog";
  dialog.innerHTML = `<form method="dialog"><div class="dialog-heading"><span class="eyebrow">${t("UN PASSAGE À GARDER")}</span><button class="round-button" value="cancel" aria-label="${escape(t("Annuler la note"))}">${icon("close")}</button></div><h2>${t("Votre note")}</h2><blockquote>${escape(locator.exact)}</blockquote><label for="annotation-note">${t("Ce que vous voulez retenir")}</label><textarea id="annotation-note" maxlength="4000" rows="5" placeholder="${escape(t("Une idée, une question, une réflexion…"))}">${escape(annotation?.note || "")}</textarea><div class="dialog-actions"><button class="button secondary" value="cancel">${t("Annuler")}</button><button class="button ink" value="save">${t("Enregistrer la note")}</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener("close", async () => {
    const note = dialog.querySelector("textarea").value;
    const result = dialog.returnValue;
    dialog.remove();
    if (result === "save" && state.book?.id === bookId)
      await saveAnnotation(note, index);
  });
  dialog.showModal();
  dialog.querySelector("textarea").focus();
}

function downloadText(text, fileName, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportNotes() {
  const book = state.book;
  const blocks = [
    `# ${book.title}`,
    book.author,
    t("## Pages marquées"),
    ...state.position.bookmarks.map(
      (mark) =>
        `### ${book.chapters[mark.chapterIndex]?.title || t("Chapitre")}\n\n> ${(mark.locator?.exact || "").replace(/\n/g, "\n> ")}`,
    ),
    t("## Passages et notes"),
    ...state.position.annotations.map(
      (note) =>
        `### ${book.chapters[note.chapterIndex]?.title || t("Chapitre")}\n\n> ${note.quote.replace(/\n/g, "\n> ")}\n\n${note.note || ""}`,
    ),
  ];
  downloadText(blocks.join("\n\n"), "mes-reperes.md");
}

document.addEventListener("selectionchange", () => {
  if (!state.book || state.settings.mode === "rsvp") return;
  const selection = window.getSelection();
  const root = document.querySelector("#chapter-content");
  const toolbar = document.querySelector("#selection-toolbar");
  if (!root || !toolbar) return;
  if (!selection?.rangeCount || selection.isCollapsed) {
    if (!document.activeElement?.closest("#selection-toolbar, dialog")) {
      toolbar.hidden = true;
      // Keep the captured range for the click that opened a note dialog.
    }
    return;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const locator = createSelectionLocator(root, range, {
    chapterId: state.book.chapters[state.position.chapterIndex].id,
  });
  if (!locator?.exact.trim()) return;
  pendingSelection = locator;
  toolbar.hidden = false;
});
app.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#selection-toolbar button")) event.preventDefault();
});

async function exportBook(format = "focus", id = state.book?.id) {
  if (state.busy || !id) return;
  state.busy = true;
  const buttons = [...app.querySelectorAll('[data-action="export"], [data-action="export-classic"], [data-action="library-export"]')];
  buttons.forEach((button) => { button.disabled = true; });
  const label = format === "classic" ? t("Classique") : t("Focus");
  try {
    pause();
    const book = state.book?.id === id ? state.book : await getBook(id) || state.memory.get(id);
    if (!book?.original) throw new Error(t("L’EPUB original de ce livre n’est pas disponible."));
    toast(t("Préparation de l’EPUB {mode}…", { mode: label }), true);
    const blob = format === "classic" ? await exportClassicEpub(book) : await exportFocusedEpub(book, focusOptions(state.settings));
    downloadText(blob, `${format}_${book.fileName || "livre.epub"}`, "application/epub+zip");
    toast(t("Votre EPUB {mode} est prêt à être téléchargé.", { mode: label }));
  } catch (error) {
    toast(error.message || t("L’export a échoué."));
  } finally {
    state.busy = false;
    buttons.forEach((button) => { if (button.isConnected) button.disabled = false; });
  }
}

async function downloadCatalogOriginal(id) {
  if (state.busy) return;
  const book = state.catalog.find((item) => item.id === id) || state.suggestionCatalog.find((item) => item.id === id);
  if (!book) return;
  if (book.downloadMode === "manual") {
    const number = /^gutenberg-([1-9]\d{0,8})$/.exec(book.id)?.[1];
    if (!number) return;
    const link = document.createElement("a");
    link.href = `https://www.gutenberg.org/ebooks/${number}.epub3.images`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.append(link); link.click(); link.remove();
    return;
  }
  state.busy = true;
  renderShell();
  try {
    const file = await downloadBook(book);
    downloadText(file, file.name || "livre.epub", "application/epub+zip");
    toast("L’EPUB est prêt à être téléchargé.");
  } catch (error) { toast(error.message || t("Le téléchargement n’a pas abouti.")); }
  finally { state.busy = false; if (!state.book) renderShell(); }
}

app.addEventListener("click", async (event) => {
  const languageLink = event.target.closest("a[data-locale]");
  if (languageLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    await changeInterfaceLanguage(languageLink.dataset.locale);
    return;
  }
  const pageLink = event.target.closest('a[href="#home"], a[href="#library"], a[href="#discover"]');
  if (pageLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (pageLink.hash === location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } else {
      history.pushState(null, "", pageLink.hash);
      await navigate();
    }
    return;
  }
  const chapterLink = event.target.closest('#chapter-content a[href^="#"]');
  if (chapterLink) {
    event.preventDefault();
    const fragment = chapterLink.getAttribute("href").slice(1);
    const chapterId = fragment.match(/^(chapter-\d+)/)?.[1];
    const index = state.book.chapters.findIndex(
      (chapter) => chapter.id === chapterId,
    );
    if (index >= 0) await changeChapter(index);
    requestAnimationFrame(() =>
      document.getElementById(fragment)?.scrollIntoView({ block: "start" }),
    );
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === "global-theme") {
      state.settings.theme =
        state.settings.theme === "night" ? "paper" : "night";
      savePreferences();
      if (state.book) applySettings();
      else renderShell();
    }
    if (action === "clear-search") {
      state.searchDraft = "";
      if (state.view === "search") {
        navigateSearch({ view: "search", language: state.searchLanguageDraft });
      } else renderShell();
      document.querySelector("#search-query")?.focus({ preventScroll: true });
    }
    if (action === "refresh-suggestions") {
      if (state.busy) return;
      await refreshSuggestions();
      if (state.view === "home") {
        renderShell();
        app
          .querySelector('[data-action="refresh-suggestions"]')
          ?.focus({ preventScroll: true });
        toast("Trois nouvelles idées de lecture.");
      }
    }
    if (action === "import") document.querySelector("#epub-file").click();
    if (action === "open") await openBook(button.dataset.id);
    if (action === "backup") await backups.open();
    if (action === "toc") showTableOfContents();
    if (action === "previous-sentence") { pause(); advanceWord(previousSentenceIndex(words, state.position.wordIndex) - state.position.wordIndex); }
    if (action === "reset-reading") updateReadingPreferences({ ...readingProfiles.balanced, profile: "balanced" });
    if (action === "catalog-download") await downloadCatalogOriginal(button.dataset.id);
    if (action === "library-export") await exportBook(button.dataset.format, button.dataset.id);
    if (action === "demo") {
      const book = createDemo();
      try {
        await saveBook(book);
        state.memory.delete(book.id);
      } catch {
        state.memory.set(book.id, book);
        storageError();
      }
      await openBook(book.id);
    }
    if (action === "remove") {
      const summary = state.books.find((book) => book.id === button.dataset.id);
      if (
        confirm(
          t("Supprimer « {title} » et sa progression de cet appareil ?", { title: summary.title }),
        )
      ) {
        try {
          await deleteBook(summary.id);
        } catch (error) {
          if (!state.memory.has(summary.id)) throw error;
        }
        state.memory.delete(summary.id);
        state.books = state.books.filter((book) => book.id !== summary.id);
        await refreshLibrary();
        renderShell();
        toast("Livre supprimé de cet appareil.");
      }
    }
    if (action === "search") await runSearch(state.page);
    if (action === "provider") {
      await navigateSearch({ view: state.searchDraft.trim() ? "search" : state.view, query: state.searchDraft, language: state.searchLanguageDraft, provider: button.dataset.provider });
    }
    if (action === "next-results" || action === "previous-results")
      await navigateSearch({ view: state.view, query: state.query, language: state.language, provider: state.provider, page: state.page + (action === "next-results" ? 1 : -1) });
    if (action === "catalog-read") await readCatalogBook(button.dataset.id);
    if (action === "settings" || action === "notes") {
      const field = action === "settings" ? "settingsOpen" : "notesOpen";
      const other = action === "settings" ? "notesOpen" : "settingsOpen";
      state[field] = !state[field];
      state[other] = false;
      if (state[field]) {
        pause();
        await persistPosition();
      }
      document.querySelector("#reader-settings").hidden = !state.settingsOpen;
      document.querySelector("#reader-notes").hidden = !state.notesOpen;
      for (const [panel, open] of [
        ["reader-settings", state.settingsOpen],
        ["reader-notes", state.notesOpen],
      ]) {
        const toggle = document.querySelector(`[aria-controls="${panel}"]`);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.classList.toggle("selected", open);
      }
      syncReaderPanels();
      if (state[field])
        document
          .querySelector(
            action === "settings" ? "#chapter-select" : "#reader-notes button",
          )
          .focus();
      else
        document
          .querySelector(
            `[aria-controls="${action === "settings" ? "reader-settings" : "reader-notes"}"]`,
          )
          .focus();
    }
    if (action === "reading-mode") changeReadingMode(button.dataset.mode);
    if (action === "show-context") changeReadingMode("classic");
    if (action === "speed-down" || action === "speed-up") {
      state.settings.speed = clamp(
        state.settings.speed + (action === "speed-up" ? 25 : -25),
        100,
        800,
      );
      savePreferences();
      document.querySelector("#reading-speed").value = state.settings.speed;
      document.querySelector("#speed-value").textContent =
        t("{speed} mots/min", { speed: state.settings.speed });
      document.querySelector("#quick-speed").textContent = state.settings.speed;
      updateRsvp();
      updateProgress();
    }
    if (action === "highlight") await saveAnnotation();
    if (action === "annotate") showNoteDialog();
    if (action === "clear-selection") clearSelection();
    if (action === "edit-note") showNoteDialog(Number(button.dataset.index));
    if (action === "goto-passage") {
      const result = state.passageResults[Number(button.dataset.index)];
      if (result) {
        state.notesOpen = false;
        if (state.settings.mode === "rsvp") {
          state.settings.mode = "classic";
          savePreferences();
        }
        await changeChapter(result.chapterIndex, { locator: result.locator });
      }
    }
    if (action === "goto-note") {
      const note = state.position.annotations[Number(button.dataset.index)];
      if (note) {
        state.settings.mode =
          state.settings.mode === "rsvp" ? "classic" : state.settings.mode;
        await changeChapter(note.chapterIndex, { locator: note.locator });
      }
    }
    if (action === "remove-note") {
      state.position.annotations.splice(Number(button.dataset.index), 1);
      await persistPosition();
      renderReader();
    }
    if (action === "export-notes") exportNotes();
    if (action === "theme") {
      state.settings.theme = button.dataset.theme;
      savePreferences();
      applySettings();
      app
        .querySelectorAll('[data-action="theme"]')
        .forEach((choice) =>
          choice.setAttribute(
            "aria-pressed",
            String(choice.dataset.theme === state.settings.theme),
          ),
        );
    }
    if (action === "previous-chapter")
      await changeChapter(state.position.chapterIndex - 1);
    if (action === "next-chapter")
      await changeChapter(state.position.chapterIndex + 1);
    if (action === "bookmark") {
      pause();
      captureReaderPosition();
      const { chapterIndex, scrollRatio, wordIndex, locator } = state.position;
      if (
        state.position.bookmarks.some(
          (mark) =>
            mark.chapterIndex === chapterIndex &&
            (mark.locator
              ? Math.abs(mark.locator.textOffset - locator.textOffset) < 25
              : Math.abs(mark.scrollRatio - scrollRatio) < 0.01),
        )
      ) {
        toast("Ce passage est déjà marqué. Retrouvez-le dans Mes repères.");
        return;
      }
      state.position.bookmarks.push({
        id: newId(),
        chapterIndex,
        scrollRatio,
        wordIndex,
        locator,
        createdAt: Date.now(),
      });
      await persistPosition();
      renderReader();
      toast("Passage marqué. Retrouvez-le dans Mes repères.");
    }
    if (action === "goto-bookmark") {
      const mark = state.position.bookmarks[Number(button.dataset.index)];
      if (mark) await changeChapter(mark.chapterIndex, mark);
    }
    if (action === "remove-bookmark") {
      state.position.bookmarks.splice(Number(button.dataset.index), 1);
      await persistPosition();
      renderReader();
    }
    if (action === "play") play();
    if (action === "rewind" || action === "forward") {
      pause();
      advanceWord(action === "rewind" ? -10 : 10);
    }
    if (action === "export-original" && state.book?.original) {
      downloadText(
        state.book.original,
        state.book.fileName || "mon-livre.epub",
        "application/epub+zip",
      );
    }
    if (action === "export") await exportBook("focus");
    if (action === "export-classic") await exportBook("classic");
    if (action === "install" && !installPrompt) showInstallHelp();
    if (action === "install" && installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      app.querySelectorAll('[data-action="install"]').forEach((item) => {
        item.hidden = true;
      });
    }
  } catch (error) {
    toast(error.message || t("Cette action n’a pas pu aboutir. Réessayez."));
  }
});

app.addEventListener("submit", (event) => {
  if (event.target.id === "passage-search") {
    event.preventDefault();
    ensureReaderPosition();
    state.passageQuery = new FormData(event.target)
      .get("passage")
      .trim()
      .slice(0, 120);
    state.passageResults = searchPassages(state.book, state.passageQuery);
    state.passageSearched = true;
    renderReader();
    document.querySelector(".passage-results").focus();
    return;
  }
  if (event.target.id !== "search-form") return;
  event.preventDefault();
  const data = new FormData(event.target);
  document.querySelector("#search-query")?.blur();
  navigateSearch({ query: data.get("query"), language: data.get("language") });
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "search-language") {
    state.searchLanguageDraft = target.value;
    const code = document.querySelector(".unified-language-code");
    if (code) code.firstChild.textContent = target.value ? target.value.toUpperCase() : t("Tous");
  }
  if (target.id === "chapter-select") void changeChapter(Number(target.value)).then(() => {
    if (state.settingsOpen) document.getElementById("chapter-select")?.focus({ preventScroll: true });
  });
  if (target.name === "mode") {
    changeReadingMode(target.value);
    document
      .querySelector(`input[name="mode"][value="${state.settings.mode}"]`)
      .focus();
  }
  if (target.id === "font-family") updateReadingPreferences({ font: target.value });
  if (target.id === "reading-profile" && readingProfiles[target.value]) updateReadingPreferences({ ...readingProfiles[target.value], profile: target.value });
  if (target.id === "skip-short-words") updateReadingPreferences({ skipShortWords: target.checked });
  if (target.id === "reading-cadence") { state.settings.cadence = target.value; savePreferences(); }
  if (target.id === "keep-awake") { state.settings.wakeLock = target.checked; void wakeLock.setActive(playing && target.checked); savePreferences(); }

});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "search-query") {
    state.searchDraft = target.value;
    const clear = document.querySelector('[data-action="clear-search"]');
    if (clear) clear.hidden = !target.value && !state.query;
  }
  const fields = { "font-size": "fontSize", "line-height": "lineHeight", "column-width": "columnWidth", "focus-intensity": "focusIntensity" };
  if (fields[target.id]) updateReadingPreferences({ [fields[target.id]]: Number(target.value) });
  if (target.id === "reading-speed") {
    state.settings.speed = clamp(target.value, 100, 800);
    document.querySelector("#speed-value").textContent =
      t("{speed} mots/min", { speed: state.settings.speed });
    savePreferences();
    const quick = document.querySelector("#quick-speed");
    if (quick) quick.textContent = state.settings.speed;
    updateRsvp();
    updateProgress();
  }
});

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add("dragging");
  }
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("dragging");
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  if (!state.busy) importFile(event.dataTransfer?.files[0]);
});
history.scrollRestoration = "manual";
let routeTimer;
const scheduleNavigation = () => {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(() => { void navigate(); }, 0);
};
window.addEventListener("hashchange", scheduleNavigation);
window.addEventListener("popstate", scheduleNavigation);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".language-picker"))
    document.querySelectorAll(".language-picker[open]").forEach((picker) => { picker.open = false; });
});
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#main")?.focus();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && event.target.closest(".language-picker[open]")) {
    const picker = event.target.closest(".language-picker");
    event.preventDefault();
    picker.open = false;
    picker.querySelector("summary").focus();
    return;
  }
  if (event.key === "Tab" && state.book && (state.settingsOpen || state.notesOpen) && !event.target.closest("dialog")) {
    const panel = document.getElementById(state.settingsOpen ? "reader-settings" : "reader-notes");
    const items = [...panel.querySelectorAll('button:not(:disabled), input, select, summary, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length && !item.closest('[hidden]'));
    const first = items[0], last = items.at(-1);
    if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }
  if (
    event.key === "Escape" &&
    state.book &&
    (state.settingsOpen || state.notesOpen) &&
    !event.target.closest("dialog")
  ) {
    event.preventDefault();
    document
      .querySelector(
        state.settingsOpen
          ? '[aria-controls="reader-settings"]'
          : '[aria-controls="reader-notes"]',
      )
      .click();
    return;
  }
  if (
    !state.book ||
    state.settingsOpen || state.notesOpen ||
    event.target.closest("input,select,textarea,button,a,dialog,summary,[contenteditable]") ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.code === "Space" && state.settings.mode === "rsvp") {
    event.preventDefault();
    play();
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    changeChapter(state.position.chapterIndex + 1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    changeChapter(state.position.chapterIndex - 1);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pause();
    persistPosition();
  }
});
window.addEventListener("pagehide", () => {
  pause();
  persistPosition();
});
for (const event of ["online", "offline"])
  window.addEventListener(event, () => {
    state.offline = !navigator.onLine;
    if (!state.book) renderShell();
  });
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  app.querySelectorAll('[data-action="install"]').forEach((button) => {
    button.hidden = false;
  });
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  app.querySelectorAll('[data-action="install"]').forEach((button) => {
    button.hidden = true;
  });
  toast("FastReader est installé. Vos prochaines lectures vous attendent.");
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void registerReaderServiceWorker({
    url: `${import.meta.env.BASE_URL}sw.js`,
    beforeUpdate: async () => {
      if (state.busy) throw new Error(t("Attendez la fin de l’ouverture du livre avant de mettre à jour."));
      pause();
      if (await persistPosition() === false) throw new Error(t("La position n’a pas pu être enregistrée. La mise à jour attendra."));
      await writeSettings(state.settings);
    },
    onError: (message) => toast(message, true),
  }).catch(() => { /* Reading remains possible if installation is unavailable. */ });
}

try {
  state.settings = await readSettings();
} catch {
  storageError();
}
// An explicit localized URL wins. The root remembers the reader's last choice.
const requestedLanguage = localeFromPath();
const explicitFrench = new URLSearchParams(location.search).get("lang") === "fr";
setLocale(requestedLanguage !== "fr" ? requestedLanguage : explicitFrench ? "fr" : state.settings.locale);
state.settings.locale = locale;
if (requestedLanguage !== locale) history.replaceState(null, "", localeHref(locale));
if (explicitFrench) {
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("lang");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}
savePreferences();
syncInterfaceLanguage();
// Suggestions are local catalog metadata; only opening a book imports its EPUB.
state.suggestionCatalog = (
  await searchBooks({ provider: "selection", language: "fr" })
).books;
await refreshLibrary();
let previousSuggestions = [];
try {
  previousSuggestions = await readSuggestionHistory();
} catch {
  storageError();
}
await refreshSuggestions(previousSuggestions);
await navigate();

if (new URLSearchParams(location.search).has("legacy"))
  toast(
    t("Le lecteur a évolué. Importez à nouveau votre EPUB original pour profiter de la bibliothèque et de la reprise de lecture."),
    true,
  );
