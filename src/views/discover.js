import { findLibraryBook } from "../suggestions.js";

export function discoverMarkup(state, { icon, escape, cover, providers }) {
  const selection = state.provider === "selection";
  const unified = state.view === "search";
  const searchable = providers.filter((source) => source.searchable);
  const heading = `<div class="section-heading"><h2>${unified ? "Dans les catalogues" : selection ? "À lire maintenant" : "Explorer les classiques"}</h2><span class="subtle" role="status">${state.searching ? "Recherche en cours…" : state.searched ? `${state.catalogCountIsApproximate ? "≈ " : ""}${state.catalogCount.toLocaleString("fr-FR")} ${unified ? (state.catalogCount === 1 ? "référence" : "références") : (state.catalogCount === 1 ? "livre" : "livres")}${selection ? "" : ` · page ${state.page}`}` : ""}</span></div>`;
  const renderBook = (book, index) => {
    const inLibrary = Boolean(findLibraryBook(book, state.books));
    const needsConnection = book.downloadMode === "direct" && !inLibrary;
    const availability = inLibrary
      ? "Dans votre bibliothèque"
      : needsConnection && state.offline
        ? "Connexion requise"
        : "Lecture en un clic";
    return `<article class="book-card ${inLibrary ? "is-in-library" : ""}" data-provider="${escape(book.providerId)}" data-language="${escape(book.language || "")}"><button class="book-open" data-action="catalog-read" data-id="${escape(book.id)}" aria-label="Lire ${escape(book.title)}" ${state.busy ? "disabled" : ""}>${cover(book, index)}<h3>${escape(book.title)}</h3><p>${escape(book.author)}</p></button>
      ${book.genre ? `<span class="genre-label">${escape(book.genre)}</span>` : ""}
      ${book.description ? `<p class="book-description">${escape(book.description)}</p>` : ""}
      <div class="book-card-meta"><span class="availability is-ready">${icon(needsConnection && state.offline ? "download" : "check")} ${availability}</span><a href="${escape(book.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Source et droits : ${escape(book.title)}">Source ${icon("external")}</a></div>
      <button class="button ink start-book-button" data-action="catalog-read" data-id="${escape(book.id)}" ${state.busy ? "disabled" : ""}>${inLibrary ? "Reprendre" : "Commencer"} ${icon("play")}</button></article>`;
  };
  return `${unified ? "" : '<section class="discovery-intro"><div class="eyebrow">DES LIVRES LIBRES À EXPLORER</div><h1>Une envie de <em>lecture ?</em></h1><p>Touchez une couverture pour commencer votre prochaine histoire.</p></section>'}
    <section aria-label="Résultats de recherche" aria-busy="${state.searching}" data-query="${escape(state.query)}">
    ${unified ? heading : ""}
    <div class="source-tabs" role="group" aria-label="Sources de livres">${searchable.map((source) => `<button data-action="provider" data-provider="${escape(source.id)}" aria-pressed="${state.provider === source.id}">${source.id === "selection" ? icon("book") : icon("compass")}${escape(source.name)}</button>`).join("")}</div>
    ${!unified ? `<div class="source-row"><span class="source-chip">${icon("check")}Touchez une couverture : le livre s’ouvre et rejoint votre bibliothèque.</span></div>` : ""}
    ${!unified && !selection ? `<p class="catalog-download-hint">Un premier téléchargement nécessite une connexion. Retrouvez ensuite vos livres et votre progression hors ligne.</p>` : ""}
    ${!unified ? heading : ""}

    ${state.catalogError ? `<div class="notice" role="alert"><strong>La recherche n’a pas pu aboutir.</strong><p>${escape(state.catalogError)}</p><div class="notice-actions"><button class="button secondary" data-action="search">Réessayer</button><button class="button ink" data-action="provider" data-provider="selection">Livres prêts à lire</button></div></div>` : ""}
    ${(state.catalogWarnings || []).map((warning) => `<p class="source-warning" role="status">${escape(warning.message)} Les livres intégrés restent accessibles.</p>`).join("")}
    ${!state.searching && state.alreadyOwnedCount && !state.catalog.length ? `<p class="local-results-empty">Les résultats de cette page sont déjà dans vos livres, juste au-dessus.</p>` : ""}
    ${!state.searching && state.searched && !state.catalog.length && !state.alreadyOwnedCount && !state.catalogError ? `<div class="empty-state">${icon("search")}<h3>${state.catalogWarnings?.length ? "Aucun résultat dans les sources accessibles" : "Aucun livre trouvé"}</h3><p>Essayez un nom d’auteur, moins de mots ou une autre langue.</p><button class="button secondary" data-action="provider" data-provider="selection">Explorer les livres prêts à lire</button></div>` : ""}
    <div class="book-grid catalog-grid ${selection ? "featured-grid" : ""}">${state.catalog.map(renderBook).join("")}</div>

    ${state.searching && !state.catalog.length ? '<div class="loading-state"><span class="spinner"></span>Recherche des livres…</div>' : ""}
    ${state.searched && !selection ? `<div class="pagination"><button class="button secondary" data-action="previous-results" ${state.page <= 1 || state.searching ? "disabled" : ""}>${icon("back")} Précédent</button><span>Page ${state.page}</span><button class="button secondary" data-action="next-results" ${!state.hasNext || state.searching ? "disabled" : ""}>Suivant ${icon("arrow")}</button></div>` : ""}</section>
    ${unified ? `<p class="catalog-download-hint">La langue et les sources filtrent uniquement les catalogues. Les éditions déjà enregistrées sont affichées dans « Mes livres ». Un premier téléchargement nécessite une connexion ; la lecture reste ensuite disponible hors ligne.</p>` : ""}
    <aside class="catalog-note">${icon("book")}<div><h3>Trois façons de lire, à vous de choisir</h3><p><strong>Mot à mot</strong> pour régler votre cadence, <strong>Classique</strong> pour garder la page entière, <strong>Focus</strong> pour accentuer le début des mots. Changez de mode pendant la lecture.</p></div></aside>
    <p class="rights-note">Les éditions intégrées conservent leur provenance et leur licence. Gutenberg indique les droits aux États-Unis ; vérifiez ceux de votre pays. <a href="${import.meta.env.BASE_URL}books/NOTICE.html" target="_blank" rel="noopener noreferrer">Sources et droits des livres intégrés</a> · <a href="https://publicdomainlibrary.org/en/ebooks" target="_blank" rel="noopener noreferrer">Autres livres sur Public Domain Library ${icon("external")}</a></p>`;
}
