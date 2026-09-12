import { t, formatNumber } from "../i18n.js";
import { findLibraryBook } from "../suggestions.js";

export function discoverMarkup(state, { icon, escape, cover, providers }) {
  const selection = state.provider === "selection";
  const unified = state.view === "search";
  const searchable = providers.filter((source) => source.searchable);
  const count = formatNumber(state.catalogCount);
  const tabs = `<div class="source-tabs" role="group" aria-label="${t("Sources de livres")}">${searchable.map((source) => `<button data-action="provider" data-provider="${escape(source.id)}" aria-pressed="${state.provider === source.id}">${source.id === "selection" ? icon("book") : icon("compass")}${escape(t(source.name))}</button>`).join("")}</div>`;
  if (state.provider === "loyalbooks") {
    const sourceUrl = `https://www.loyalbooks.com/search?${new URLSearchParams({ q: state.query || "" })}`;
    return `<section class="loyal-search-section" aria-label="${t("Résultats de recherche")}" aria-busy="false" data-query="${escape(state.query)}"><div class="section-heading"><h2>${t("Dans les catalogues")}</h2></div>${tabs}<div class="loyal-search-intro"><h3>Loyal Books</h3><p>${t("Recherchez un titre ou un auteur dans la barre en haut. La recherche Loyal Books inclut toutes les langues.")}</p><p class="catalog-download-hint">${t("Les résultats sont fournis par Google et peuvent inclure des annonces ou des pages sans EPUB. Le bouton Lire ouvre les fiches compatibles dans FastReader.")}</p></div><div id="loyal-search-host"></div><p class="catalog-download-hint"><a data-loyal-source-link href="${escape(sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("Ouvrir la recherche sur Loyal Books")} ${icon("external")}</a></p><p class="source-privacy">${t("Cette recherche est transmise à Google. Vos EPUB, notes et repères restent dans votre navigateur.")} <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">${t("Confidentialité")}</a></p></section><p class="rights-note">${t("Les droits varient selon votre pays. Téléchargez uniquement des livres du domaine public ou pour lesquels vous avez l’autorisation requise.")}</p>`;
  }
  const countLabel = unified
    ? (state.catalogCount === 1 ? t("{count} référence", { count }) : t("{count} références", { count }))
    : (state.catalogCount === 1 ? t("{count} livre", { count }) : t("{count} livres", { count }));
  const heading = `<div class="section-heading"><h2>${unified ? t("Dans les catalogues") : selection ? t("À lire maintenant") : t("Explorer les classiques")}</h2><span class="subtle" role="status">${state.searching ? t("Recherche en cours…") : state.searched ? `${state.catalogCountIsApproximate ? "≈ " : ""}${countLabel}${selection ? "" : ` · ${t("page {number}", { number: formatNumber(state.page) })}`}` : ""}</span></div>`;
  const renderBook = (book, index) => {
    const inLibrary = Boolean(findLibraryBook(book, state.books));
    const genre = book.genreKey ? t(book.genreKey) : book.genre;
    const description = book.descriptionKey ? t(book.descriptionKey) : book.description;
    const needsConnection = ["direct", "manual"].includes(book.downloadMode) && !inLibrary;
    const availability = inLibrary
      ? t("Dans votre bibliothèque")
      : needsConnection && state.offline
        ? t("Connexion requise")
        : "";
    return `<article class="book-card ${inLibrary ? "is-in-library" : ""}" data-provider="${escape(book.providerId)}" data-language="${escape(book.language || "")}"><button class="book-open" data-action="catalog-read" data-id="${escape(book.id)}" aria-label="${t("Lire {title}", { title: escape(book.title) })}" ${state.busy ? "disabled" : ""}>${cover(inLibrary ? { ...book, downloadMode: "local" } : book, index)}<h3>${escape(book.title)}</h3><p>${escape(book.author)}</p></button>
      ${genre && !unified ? `<span class="genre-label">${escape(genre)}</span>` : ""}
      ${description && !unified ? `<p class="book-description">${escape(description)}</p>` : ""}
      <div class="book-card-meta">${availability ? `<span class="availability is-ready">${icon(needsConnection && state.offline ? "download" : "check")} ${availability}</span>` : ""}<a href="${escape(book.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${t("Source et droits : {title}", { title: escape(book.title) })}">${escape(book.source || book.providerId)} ${icon("external")}</a></div>
      <div class="catalog-book-actions"><button class="button secondary catalog-download-button" data-action="catalog-download" data-id="${escape(book.id)}" aria-label="${t("Obtenir l’EPUB : {title}", { title: escape(book.title) })}" ${state.busy ? "disabled" : ""}>${icon("download")} ${t("Obtenir l’EPUB")}</button><button class="button ink start-book-button" data-action="catalog-read" data-id="${escape(book.id)}" ${state.busy ? "disabled" : ""}>${inLibrary ? t("Reprendre") : t("Lire")} ${icon("play")}</button></div></article>`;
  };
  return `${unified ? "" : `<section class="discovery-intro"><div class="eyebrow">${t("DES LIVRES LIBRES À EXPLORER")}</div><h1>${t("Une envie de <em>lecture ?</em>")}</h1><p>${t("Touchez une couverture pour commencer votre prochaine histoire.")}</p></section>`}
    <section aria-label="${t("Résultats de recherche")}" aria-busy="${state.searching}" data-query="${escape(state.query)}">
    ${unified ? heading : ""}
    ${tabs}
    ${!unified && !selection && import.meta.env.MODE !== "pages" ? `<p class="catalog-download-hint">${t("Un premier téléchargement nécessite une connexion. Retrouvez ensuite vos livres et votre progression hors ligne.")}</p>` : ""}
    ${!unified ? heading : ""}
    ${state.searching && state.catalog.length && state.pendingSources?.length ? `<p class="source-status-short" role="status">${t("D’autres sources poursuivent la recherche… Vous pouvez déjà ouvrir un résultat.")}</p>` : ""}

    ${state.catalogError ? `<div class="notice" role="alert"><strong>${t("La recherche n’a pas pu aboutir.")}</strong><p>${escape(state.catalogError)}</p><div class="notice-actions"><button class="button secondary" data-action="search">${t("Réessayer")}</button><button class="button ink" data-action="provider" data-provider="selection">${t("Livres prêts à lire")}</button></div></div>` : ""}
    ${(state.catalogWarnings || []).map((warning) => `<p class="source-warning" data-provider="${escape(warning.providerId)}" role="status">${escape(providers.find((source) => source.id === warning.providerId)?.name || warning.providerId)} : ${escape(warning.message)} ${t("Les livres intégrés restent accessibles.")}</p>`).join("")}
    ${!state.searching && state.alreadyOwnedCount && !state.catalog.length ? `<p class="local-results-empty">${t("Les résultats de cette page sont déjà dans vos livres, juste au-dessus.")}</p>` : ""}
    ${!state.searching && state.searched && !state.catalog.length && !state.alreadyOwnedCount && !state.catalogError ? `<div class="empty-state">${icon("search")}<h3>${state.catalogWarnings?.length ? t("Aucun résultat dans les sources accessibles") : t("Aucun livre trouvé")}</h3><p>${t("Essayez un nom d’auteur, moins de mots ou une autre langue.")}</p><button class="button secondary" data-action="provider" data-provider="selection">${t("Explorer les livres prêts à lire")}</button></div>` : ""}
    ${unified && state.catalog.length ? `<div class="book-list-heading" aria-hidden="true"><span>${t("Titre ou auteur")}</span><span>${t("Source")}</span><span>${t("Lire")}</span></div>` : ""}
    <div class="book-grid catalog-grid ${unified ? "book-list" : selection ? "featured-grid" : ""}">${state.catalog.map(renderBook).join("")}</div>

    ${state.searching && !state.catalog.length ? `<div class="loading-state"><span class="spinner"></span>${t("Recherche des livres…")}</div>` : ""}
    ${state.searched && !selection ? `<div class="pagination"><button class="button secondary" data-action="previous-results" ${state.page <= 1 || state.searching ? "disabled" : ""}>${icon("back")} ${t("Précédent")}</button><span>${t("Page {number}", { number: formatNumber(state.page) })}</span><button class="button secondary" data-action="next-results" ${!state.hasNext || state.searching ? "disabled" : ""}>${t("Suivant")} ${icon("arrow")}</button></div>` : ""}</section>
    ${unified ? `<p class="catalog-download-hint catalog-search-hint">${t("La langue et les sources filtrent uniquement les catalogues. Les éditions déjà enregistrées sont affichées dans « Mes livres ». Un premier téléchargement nécessite une connexion ; la lecture reste ensuite disponible hors ligne.")}</p>` : ""}
    <aside class="catalog-note">${icon("book")}<div><h3>${t("Trois façons de lire, à vous de choisir")}</h3><p>${t("<strong>Mot à mot</strong> pour régler votre cadence, <strong>Classique</strong> pour garder la page entière, <strong>Focus</strong> pour accentuer le début des mots. Changez de mode pendant la lecture.")}</p></div></aside>
    <p class="rights-note">${t("Les droits varient selon votre pays. Téléchargez uniquement des livres du domaine public ou pour lesquels vous avez l’autorisation requise.")} <a href="${import.meta.env.BASE_URL}books/NOTICE.html" target="_blank" rel="noopener noreferrer">${t("Sources et droits des livres intégrés")}</a> · <a href="https://publicdomainlibrary.org/en/ebooks" target="_blank" rel="noopener noreferrer">${t("Autres livres sur Public Domain Library")} ${icon("external")}</a></p>`;
}
