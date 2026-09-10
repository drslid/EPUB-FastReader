import { suggestionsMarkup } from "./suggestions.js";

export function libraryMarkup(state, { icon, escape, cover }) {
  const recent = state.books.find(
    (book) => book.position && book.position.progress < 1,
  );
  const shown = state.books;
  return `<section class="library-intro"><div><span class="eyebrow">VOTRE ESPACE DE LECTURE</span><h1>Ma bibliothèque</h1><p>${state.books.length ? "Vos livres, vos notes, votre rythme. Tout reste sur cet appareil." : "Choisissez une histoire ou importez votre EPUB pour commencer."}</p></div><a class="button ink" href="#discover">${icon("compass")} Trouver un livre</a></section>
  ${recent ? `<section class="resume-card"><div class="resume-symbol">${icon("bookmark")}</div><div><span class="eyebrow">REPRENDRE LE FIL</span><h2>${escape(recent.title)}</h2><p>${Math.round(recent.position.progress * 100)} % parcouru · votre place est gardée</p></div><button class="button ink" data-action="open" data-id="${escape(recent.id)}">${icon("play")} Reprendre ma lecture</button></section>` : ""}
  ${suggestionsMarkup(state, { icon, escape, cover })}
  <section class="library-section"><div class="section-heading"><h2>Mes livres <span class="count-pill">${state.books.length}</span></h2><span class="subtle">Sur cet appareil</span></div>
  <div class="book-grid">${shown.map((book, index) => `<article class="book-card"><button class="book-open" data-action="open" data-id="${escape(book.id)}" aria-label="Lire ${escape(book.title)}">${cover(book, index)}<h3>${escape(book.title)}</h3><p>${escape(book.author)}</p></button><div class="book-card-meta"><span>${book.position ? `${Math.round(book.position.progress * 100)} % lu` : "Prêt à lire"}</span><button class="remove-button" data-action="remove" data-id="${escape(book.id)}" aria-label="Supprimer ${escape(book.title)}" title="Supprimer de cet appareil">${icon("close")}</button></div><progress max="1" value="${book.position?.progress || 0}" aria-label="Progression de ${escape(book.title)}"></progress></article>`).join("")}
  <button class="import-card" data-action="import" ${state.busy ? "disabled" : ""}><span class="import-circle">${icon("plus")}</span><strong>${state.busy ? "Ouverture en cours…" : "Importer un EPUB"}</strong><span>Depuis les fichiers<br>de votre appareil</span><span class="file-label">30 Mo maximum</span></button></div>
  ${!state.books.length ? `<div class="library-start"><p>Envie de voir comment ça marche ?</p><button class="button secondary" data-action="demo">${icon("play")} Essayer le lecteur</button></div>` : ""}</section>`;
}
