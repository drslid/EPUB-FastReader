import { t, formatNumber } from "../i18n.js";
const languages = [
  { value: "fr", label: "Français", short: "FR" },
  { value: "en", label: "English", short: "EN" },
  { value: "es", label: "Español", short: "ES" },
  { value: "de", label: "Deutsch", short: "DE" },
  { value: "it", label: "Italiano", short: "IT" },
  { value: "pt", label: "Português", short: "PT" },
  { value: "", label: "Toutes les langues", short: "Tous" },
];

export function searchBarMarkup(state, { icon, escape }) {
  const query = state.searchDraft ?? state.query ?? "";
  const selectedLanguage = state.searchLanguageDraft ?? state.language;
  const language = languages.find(({ value }) => value === selectedLanguage) || languages[0];
  return `<form id="search-form" class="unified-search" role="search" aria-label="${t("Rechercher des livres")}">
    <div class="unified-search-field">${icon("search")}<label class="sr-only" for="search-query">${t("Titre ou auteur")}</label><input id="search-query" name="query" type="search" maxlength="150" placeholder="${t("Mes livres et les catalogues…")}" value="${escape(query)}" autocomplete="off" enterkeyhint="search"><button type="button" class="unified-search-clear" data-action="clear-search" aria-label="${t("Effacer la recherche")}" ${query || state.query ? "" : "hidden"}>${icon("close")}</button></div>
    <div class="unified-search-language"><label class="sr-only" for="search-language">${t("Langue du livre")}</label><span class="unified-language-code" aria-hidden="true">${language.value ? language.short : t("Tous")}<span>⌄</span></span><select id="search-language" name="language">${languages.map(({ value, label }) => `<option value="${value}" ${language.value === value ? "selected" : ""}>${value ? label : t(label)}</option>`).join("")}</select></div>
    <button class="button ink unified-search-submit" type="submit" aria-label="${t("Rechercher")}">${icon("search")}<span>${t("Rechercher")}</span></button>
  </form>`;
}

export function localSearchResultsMarkup(state, { icon, escape, cover }) {
  const books = state.localSearchResults || [];
  return `<section class="local-results" aria-label="${t("Résultats dans mes livres")}" aria-busy="${Boolean(state.localSearching)}">
    <div class="section-heading"><h2>${icon("book")} ${t("Mes livres")} <span class="count-pill">${formatNumber(books.length)}</span></h2><span class="subtle">${t("Sur cet appareil")}</span></div>
    ${books.length ? `<div class="book-grid">${books.map((book) => {
      const progress = Math.max(0, Math.min(1, Number(book.position?.progress) || 0));
      return `<article class="book-card is-in-library"><button class="book-open" data-action="open" data-id="${escape(book.id)}" aria-label="${t("Lire {title}", { title: escape(book.title) })}" ${state.busy ? "disabled" : ""}>${cover(book)}<h3>${escape(book.title)}</h3><p>${escape(book.author)}</p></button><div class="book-card-meta"><span class="availability is-ready">${icon("check")} ${t("Disponible hors ligne")}</span><span>${book.position ? t("{progress} % lu", { progress: formatNumber(Math.round(progress * 100)) }) : t("Prêt à lire")}</span></div><progress max="1" value="${progress}" aria-label="${t("Progression de {title}", { title: escape(book.title) })}"></progress></article>`;
    }).join("")}</div>` : `<p class="local-results-empty" role="status">${state.localSearching ? t("Recherche dans votre bibliothèque…") : t("Aucun livre enregistré ne correspond à cette recherche.")}</p>`}
  </section>`;
}
