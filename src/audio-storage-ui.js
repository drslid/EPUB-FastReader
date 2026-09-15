import { t, locale } from "./i18n.js";
import "./audio-storage.css";

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const bytes = value => Math.max(0, Number(value) || 0);
const size = value => new Intl.NumberFormat(locale, { style: "unit", unit: value >= 1_000_000_000 ? "gigabyte" : "megabyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(bytes(value) / (value >= 1_000_000_000 ? 1_000_000_000 : 1_000_000));
const empty = () => ({ books: [], voices: [], sharedBytes: 0, unusedBytes: 0, totalBytes: 0 });

/** A view over storage metadata. Callbacks own deletion and playback/queue safety. */
export function createAudioStorageUI({ load, removeBook, removeVoice, clearAudio, clearAll, cleanup, icon = () => "" }) {
  let dialog = null, returnFocus = null, revision = 0;
  let snapshot = empty(), confirmation = null, loading = false, busy = false;
  let notice = "", failed = false, loadFailed = false;
  const actions = { book: removeBook, voice: removeVoice, audio: clearAudio, all: clearAll, cleanup };
  const text = (source, parameters) => escape(t(source, parameters));
  const glyph = (name, fallback) => icon(name) || `<span aria-hidden="true">${fallback}</span>`;
  const control = key => [...(dialog?.querySelectorAll("[data-storage-key]") || [])].find(node => node.dataset.storageKey === key);

  function languageName(code) {
    try { return code ? new Intl.DisplayNames(locale, { type: "language" }).of(code) : ""; }
    catch { return code || ""; }
  }

  function confirmationText() {
    if (!confirmation) return "";
    const { action, label } = confirmation;
    if (action === "book") return t("Supprimer l’audio de « {title} » ? Son écoute et sa préparation s’arrêteront.", { title: label });
    if (action === "voice") return t("Supprimer la voix {name} ? Les audios déjà préparés restent disponibles. Il faudra télécharger cette voix à nouveau pour préparer d’autres livres.", { name: label });
    if (action === "audio") return t("Supprimer tous les audios ? L’écoute et les préparations s’arrêteront. Les voix téléchargées seront conservées.");
    if (action === "all") return t("Supprimer tous les audios et les voix téléchargées ? L’écoute et les préparations s’arrêteront. Vous pourrez télécharger les voix à nouveau.");
    return t("Supprimer les fichiers inutilisés ? Vos audios et vos voix téléchargées seront conservés.");
  }

  function confirmationMarkup(key) {
    if (confirmation?.key !== key) return "";
    return `<div class="audio-storage-confirmation" data-storage-confirmation role="group" aria-label="${text("Confirmer la suppression")}"><p>${escape(confirmationText())}</p><div class="audio-storage-confirm-actions"><button class="button secondary" data-storage-action="cancel" data-storage-key="cancel" ${busy ? "disabled" : ""}>${text("Annuler")}</button><button class="button secondary audio-storage-delete" data-storage-action="confirm" data-storage-key="confirm" ${busy ? "disabled" : ""}>${text(busy ? "Suppression…" : "Supprimer")}</button></div></div>`;
  }

  function button(action, key, label, { id = "", compact = false, disabled = false } = {}) {
    return `<button class="${compact ? "round-button audio-storage-trash" : "button secondary"}" data-storage-action="${action}" data-storage-key="${escape(key)}" data-storage-id="${escape(id)}" ${compact ? `aria-label="${escape(label)}" title="${escape(label)}"` : ""} ${disabled || busy || loading || loadFailed ? "disabled" : ""}>${compact ? glyph("trash", "×") : escape(label)}</button>`;
  }

  function render(focusKey) {
    if (!dialog) return;
    const activeKey = focusKey || (dialog.contains(document.activeElement) ? document.activeElement?.dataset.storageKey : "");
    const scrollTop = dialog.scrollTop;
    const bookRows = snapshot.books.map(book => {
      const key = `book:${book.id}`;
      return `<li data-storage-book="${escape(book.id)}"><div class="audio-storage-row"><div class="audio-storage-label"><h4>${escape(book.title)}</h4><span>${escape(size(book.bytes))}</span></div>${button("book", key, t("Supprimer l’audio de {title}", { title: book.title }), { id: book.id, compact: true })}</div>${confirmationMarkup(key)}</li>`;
    }).join("");
    const voiceRows = snapshot.voices.map(voice => {
      const key = `voice:${voice.id}`;
      return `<li data-storage-voice="${escape(voice.id)}"><div class="audio-storage-row"><div class="audio-storage-label"><h4>${escape(voice.name)}</h4><span>${escape([languageName(voice.language), size(voice.bytes)].filter(Boolean).join(" · "))}</span></div>${button("voice", key, t("Supprimer {name}", { name: voice.name }), { id: voice.id, compact: true })}</div>${confirmationMarkup(key)}</li>`;
    }).join("");
    dialog.setAttribute("aria-busy", String(loading || busy));
    dialog.innerHTML = `<header class="audio-storage-heading"><div><h2 id="audio-storage-title">${text("Stockage audio")}</h2><p data-storage-total>${loading ? text("Chargement…") : loadFailed ? "" : text("{size} utilisés", { size: size(snapshot.totalBytes) })}</p></div><button class="round-button" data-storage-action="close" data-storage-key="close" aria-label="${text("Fermer")}" ${busy ? "disabled" : ""}>${glyph("close", "×")}</button></header><p class="audio-storage-notice" data-storage-notice role="status" aria-live="polite" aria-atomic="true" data-error="${failed}">${notice ? text(notice) : ""}</p>${loadFailed ? `<div class="audio-storage-retry">${button("reload", "reload", t("Réessayer"))}</div>` : ""}<div data-storage-content ${loading || loadFailed ? "hidden" : ""}><section aria-labelledby="audio-storage-books-title"><h3 id="audio-storage-books-title">${text("Livres audio")}</h3>${bookRows ? `<ul class="audio-storage-list">${bookRows}</ul>` : `<p class="audio-storage-empty">${text("Aucun audio enregistré")}</p>`}</section><section aria-labelledby="audio-storage-voices-title"><h3 id="audio-storage-voices-title">${text("Voix téléchargées")}</h3>${voiceRows ? `<ul class="audio-storage-list">${voiceRows}</ul>` : `<p class="audio-storage-empty">${text("Aucune voix téléchargée")}</p>`}${snapshot.sharedBytes > 0 ? `<p class="audio-storage-shared">${text("Fichiers partagés entre les voix : {size}", { size: size(snapshot.sharedBytes) })}</p>` : ""}</section>${snapshot.unusedBytes > 0 ? `<section class="audio-storage-unused" aria-labelledby="audio-storage-unused-title"><div class="audio-storage-row"><h3 id="audio-storage-unused-title">${text("Fichiers inutilisés")}</h3>${button("cleanup", "cleanup", t("Nettoyer {size}", { size: size(snapshot.unusedBytes) }))}</div>${confirmationMarkup("cleanup")}</section>` : ""}<footer class="audio-storage-footer"><p>${text("Vos livres et vos repères sont conservés.")}</p><div class="audio-storage-global-actions">${button("audio", "audio", t("Supprimer tous les audios"), { disabled: snapshot.books.length === 0 })}${button("all", "all", t("Tout libérer"), { disabled: snapshot.totalBytes === 0 && snapshot.books.length === 0 && snapshot.voices.length === 0 })}</div>${confirmationMarkup("audio")}${confirmationMarkup("all")}</footer></div>`;
    // A failed read is recoverable even though deletion is disabled until a fresh read.
    const reload = control("reload");
    if (reload) reload.disabled = busy || loading;
    dialog.scrollTop = scrollTop;
    if (activeKey) (control(activeKey) || control("close"))?.focus({ preventScroll: true });
  }

  async function refresh(token) {
    try {
      const result = await load();
      if (!dialog || token !== revision) return false;
      snapshot = { ...empty(), ...result, books: result?.books || [], voices: result?.voices || [] };
      loadFailed = false;
      return true;
    } catch {
      if (dialog && token === revision) loadFailed = true;
      return false;
    }
  }

  async function reload() {
    const token = ++revision;
    loading = true; notice = ""; failed = false; confirmation = null; render();
    const loaded = await refresh(token);
    if (!dialog || token !== revision) return;
    loading = false;
    if (!loaded) { notice = "Impossible d’afficher le stockage audio. Réessayez."; failed = true; }
    render();
  }

  function cancelConfirmation() {
    if (!confirmation || busy) return;
    const key = confirmation.key;
    confirmation = null; notice = ""; failed = false;
    render(key);
  }

  async function remove() {
    if (!confirmation || busy || loading || loadFailed) return;
    const target = confirmation, token = revision;
    busy = true; notice = ""; failed = false; render();
    let removed = false;
    try {
      await actions[target.action](...(target.id ? [target.id] : []));
      removed = true;
    } catch { /* Refresh after partial deletion so sizes and remaining actions stay accurate. */ }
    const loaded = await refresh(token);
    if (!dialog || token !== revision) return;
    busy = false;
    if (!loaded) {
      confirmation = null; failed = true;
      notice = removed ? "Suppression terminée. Impossible d’actualiser l’espace disponible. Réessayez." : "La suppression n’a pas pu être terminée. Réessayez pour actualiser l’espace disponible.";
    } else if (!removed) {
      failed = true;
      notice = "La suppression n’a pas pu être terminée. L’espace affiché est à jour ; vous pouvez réessayer.";
      if (target.action === "book" && !snapshot.books.some(book => book.id === target.id)
        || target.action === "voice" && !snapshot.voices.some(voice => voice.id === target.id)
        || target.action === "cleanup" && snapshot.unusedBytes === 0) confirmation = null;
    } else {
      confirmation = null;
      notice = "Espace libéré.";
    }
    render(confirmation ? "cancel" : "close");
  }

  function act(event) {
    const element = event.target.closest("[data-storage-action]");
    if (!element || element.disabled || busy) return;
    const action = element.dataset.storageAction;
    if (action === "close") { close(); return; }
    if (action === "cancel") { cancelConfirmation(); return; }
    if (action === "confirm") { void remove(); return; }
    if (action === "reload") { void reload(); return; }
    if (loading || loadFailed || typeof actions[action] !== "function") return;
    const id = element.dataset.storageId;
    const entry = action === "book" ? snapshot.books.find(book => book.id === id) : action === "voice" ? snapshot.voices.find(voice => voice.id === id) : null;
    if (["book", "voice"].includes(action) && !entry) return;
    confirmation = { action, id, key: element.dataset.storageKey, label: entry?.title || entry?.name || "" };
    notice = ""; failed = false;
    render("cancel");
    dialog.querySelector("[data-storage-confirmation]")?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }

  function localize() { render(); }

  function close() {
    if (!dialog || busy) return;
    revision++;
    const current = dialog;
    dialog = null; confirmation = null; loading = false;
    window.removeEventListener("languagechange", localize);
    current.close(); current.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  async function open({ bookId = "", voiceId = "" } = {}) {
    if (dialog) { control("close")?.focus(); return; }
    returnFocus = document.activeElement;
    snapshot = empty(); confirmation = null; notice = ""; failed = false; loadFailed = false;
    dialog = document.createElement("dialog");
    dialog.className = "audio-storage-dialog";
    dialog.setAttribute("aria-labelledby", "audio-storage-title");
    dialog.addEventListener("click", act);
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (confirmation) cancelConfirmation(); else close(); });
    dialog.addEventListener("close", event => { if (event.currentTarget === dialog) close(); });
    window.addEventListener("languagechange", localize);
    document.body.append(dialog);
    const openedDialog = dialog;
    const opening = reload();
    dialog.showModal();
    control("close")?.focus({ preventScroll: true });
    await opening;
    if (dialog !== openedDialog) return;
    const selected = bookId ? control(`book:${bookId}`) : voiceId ? control(`voice:${voiceId}`) : null;
    if (selected && !selected.disabled) { selected.focus({ preventScroll: true }); selected.scrollIntoView?.({ block: "nearest", behavior: "instant" }); }
  }

  function dispose() {
    // Disposal tears down the view only; an already confirmed deletion still completes.
    busy = false; close();
  }

  return { open, close, dispose };
}
