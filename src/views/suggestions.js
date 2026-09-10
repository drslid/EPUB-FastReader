import { getRecommendationReason, findLibraryBook } from "../suggestions.js";

export function suggestionsMarkup(state, { icon, escape, cover }) {
  if (!state.suggestions?.length) return "";
  return `<section class="suggestions-section" aria-labelledby="suggestions-title">
    <div class="suggestions-heading"><div><span class="eyebrow">UNE PAUSE, UNE HISTOIRE</span><h2 id="suggestions-title">Votre prochaine lecture</h2></div><button class="button secondary suggestions-refresh" data-action="refresh-suggestions" ${state.busy ? "disabled" : ""}>${icon("compass")} D’autres idées</button></div>
    <div class="suggestions-grid">${state.suggestions
      .map((book, index) => {
        const local = findLibraryBook(book, state.books);
        return `<article class="suggestion-card ${index === 0 ? "suggestion-featured" : ""}" data-book-id="${escape(book.id)}"><button class="suggestion-open" data-action="catalog-read" data-id="${escape(book.id)}" aria-label="Lire la suggestion : ${escape(book.title)}" ${state.busy ? "disabled" : ""}>
        <span class="suggestion-cover">${cover(book)}</span><span class="suggestion-copy"><span class="suggestion-genre">${escape(book.genre)}</span><span class="suggestion-title">${escape(book.title)}</span><span class="suggestion-author">${escape(book.author)}</span>${index === 0 ? `<span class="suggestion-description">${escape(book.description)}</span>` : ""}<span class="suggestion-reason">${escape(getRecommendationReason(book, state.books))}</span><span class="suggestion-cta">${local ? "Reprendre" : "Lire maintenant"} ${icon("arrow")}</span></span></button></article>`;
      })
      .join("")}</div>
    <p class="suggestions-caption">Un clic pour lire et garder le livre dans votre bibliothèque. <a href="#discover">Voir toute la sélection ${icon("arrow")}</a></p>
  </section>`;
}
