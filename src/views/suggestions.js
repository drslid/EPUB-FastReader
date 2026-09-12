import { t } from "../i18n.js";
import { getRecommendationReason, findLibraryBook } from "../suggestions.js";

export function suggestionsMarkup(state, { icon, escape, cover }) {
  if (!state.suggestions?.length) return "";
  return `<section class="suggestions-section" aria-labelledby="suggestions-title">
    <div class="suggestions-heading"><div><span class="eyebrow">${t("UNE PAUSE, UNE HISTOIRE")}</span><h2 id="suggestions-title">${t("Votre prochaine lecture")}</h2></div><button class="button secondary suggestions-refresh" data-action="refresh-suggestions" ${state.busy ? "disabled" : ""}>${icon("compass")} ${t("D’autres idées")}</button></div>
    <div class="suggestions-grid">${state.suggestions
      .map((book, index) => {
        const local = findLibraryBook(book, state.books);
        const genre = book.genreKey ? t(book.genreKey) : book.genre;
        const description = book.descriptionKey ? t(book.descriptionKey) : book.description;
        return `<article class="suggestion-card ${index === 0 ? "suggestion-featured" : ""}" data-book-id="${escape(book.id)}"><button class="suggestion-open" data-action="catalog-read" data-id="${escape(book.id)}" aria-label="${t("Lire la suggestion : {title}", { title: escape(book.title) })}" ${state.busy ? "disabled" : ""}>
        <span class="suggestion-cover">${cover(book)}</span><span class="suggestion-copy"><span class="suggestion-genre">${escape(genre)}</span><span class="suggestion-title">${escape(book.title)}</span><span class="suggestion-author">${escape(book.author)}</span>${index === 0 ? `<span class="suggestion-description">${escape(description)}</span>` : ""}<span class="suggestion-reason">${escape(getRecommendationReason(book, state.books))}</span><span class="suggestion-cta">${local ? t("Reprendre") : t("Lire maintenant")} ${icon("arrow")}</span></span></button></article>`;
      })
      .join("")}</div>
    <p class="suggestions-caption">${t("Une sélection à renouveler selon vos envies.")} <a href="#discover">${t("Voir toute la sélection")} ${icon("arrow")}</a></p>
  </section>`;
}
