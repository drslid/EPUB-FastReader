import { t, locale, formatNumber } from "./i18n.js";
import { formatVoiceBytes } from "./voice-ui.js";
import "./audio-queue.css";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const statuses = {
  queued: "En attente", preparing: "Préparation en cours", paused: "En pause",
  ready: "Prêt à écouter", error: "Préparation interrompue", unavailable: "Voix précédente",
};

export function canListenToAudioJob(job) {
  return job?.status === "ready" || (typeof job?.canListen === "boolean" ? job.canListen : Number(job?.readySegments ?? job?.completedSegments) > 0);
}

export function audioQueueErrorMessage(error) {
  if (error?.code === "VOICE_RETIRED") return t("Cette voix a été remplacée. Les passages enregistrés restent disponibles. Choisissez une nouvelle voix pour préparer le livre.");
  if (error?.code === "VOICE_EMPTY_TEXT") return t("Ce livre ne contient pas de texte à écouter.");
  if (error?.code === "COORDINATION_UNAVAILABLE") return t("Ce navigateur ne permet pas de préparer les livres en audio. Essayez un navigateur récent.");
  if (["STORAGE_FULL", "QuotaExceededError"].includes(error?.code) || error?.name === "QuotaExceededError") return t("L’espace disponible est insuffisant. Supprimez un audio préparé ou libérez du stockage, puis reprenez.");
  if (["VOICE_NOT_INSTALLED", "VOICE_NOT_READY", "VOICE_MISSING", "VOICE_ASSETS_MISSING"].includes(error?.code)) return t("Cette voix n’est plus disponible sur l’appareil. Choisissez Écouter dans le livre pour la télécharger à nouveau.");
  return t("Impossible de préparer ce livre. Les passages terminés sont conservés ; vous pouvez réessayer.");
}

export function audioQueueJobMarkup(job, { icon = () => "", busy = false, currentBook = false, canChooseVoice = false } = {}) {
  const glyph = (name, fallback) => icon(name) || `<span aria-hidden="true">${fallback}</span>`;
  const percent = Math.min(100, Math.max(0, Math.floor((Number(job.progress) || 0) * 100)));
  const ready = job.status === "ready";
  const unavailable = job.canPrepare === false && !ready || job.status === "unavailable";
  const listenable = canListenToAudioJob(job);
  let language = job.voice?.language || "";
  try { if (language) language = new Intl.DisplayNames(locale, { type: "language" }).of(language); } catch { /* Keep an unknown language code readable. */ }
  const voiceLabel = [job.voice?.name || job.voice?.id, language].filter(Boolean).join(" · ");
  const text = (source, params) => escape(t(source, params));
  const partialHint = unavailable ? `<p class="audio-job-partial">${text("Cette voix a été remplacée. Les passages enregistrés restent disponibles. Choisissez une nouvelle voix pour préparer le livre.")}</p>`
    : !ready && listenable ? `<p class="audio-job-partial">${text("Écoutez les passages déjà prêts. Une attente est possible si vous rattrapez la préparation.")}</p>` : "";
  const button = (action, label, symbol, primary = false) => `<button class="button ${primary ? "primary" : "secondary"}" data-audio-queue-action="${action}" ${busy ? 'aria-disabled="true"' : ""}>${symbol}<span>${text(label)}</span></button>`;
  let actions = "";
  if (listenable) actions += button("listen", ready ? "Lancer l’écoute" : "Écouter le début", glyph("play", "▶"), true);
  if (!ready && !unavailable && ["paused", "error"].includes(job.status)) actions += button("resume", job.status === "error" ? "Réessayer" : "Reprendre", glyph("play", "▶"), !listenable);
  else if (!ready && !unavailable) actions += button("pause", "Mettre en pause", glyph("pause", "Ⅱ"));
  actions += button(ready ? "remove" : "cancel", ready ? "Supprimer l’audio" : "Annuler la préparation", glyph("close", "×"));
  const chooseVoice = canChooseVoice ? `<button class="voice-text-button audio-job-alternate" data-audio-queue-action="choose-voice" ${busy ? 'aria-disabled="true"' : ""}>${glyph("volume", "♪")}<span>${text(unavailable ? "Préparer avec une nouvelle voix" : "Préparer avec une autre voix")}</span></button>` : "";
  return `<article class="audio-queue-job${currentBook ? " is-current-book" : ""}" data-audio-job="${escape(job.id)}" data-audio-book="${escape(job.bookId)}" data-status="${escape(job.status)}" aria-busy="${busy}"><div class="audio-job-heading"><span class="audio-job-icon" aria-hidden="true">${glyph(ready ? "check" : "volume", ready ? "✓" : "♪")}</span><div><h3>${escape(job.title)}</h3><p class="audio-job-voice">${escape(voiceLabel)}</p></div><strong class="audio-job-percent">${escape(formatNumber(ready ? 100 : percent))}%</strong></div><p class="audio-job-status" tabindex="-1"><span class="sr-only">${escape(job.title)} — </span>${text(statuses[job.status] || "En attente")}</p><progress max="100" value="${ready ? 100 : percent}" aria-label="${escape(job.title)} — ${text(statuses[job.status] || "En attente")}"></progress><div class="audio-job-details"><span>${text("{completed} sur {total} chapitres préparés", { completed: formatNumber(job.completedChapters || 0), total: formatNumber(job.totalChapters || 0) })}</span><span>${text("{completed} sur {total} passages", { completed: formatNumber(job.completedSegments || 0), total: formatNumber(job.totalSegments || 0) })}</span>${job.audioBytes > 0 ? `<span>${text("Audio conservé : {size}", { size: formatVoiceBytes(job.audioBytes) })}</span>` : ""}</div>${job.error && !unavailable ? `<p class="audio-job-error">${escape(audioQueueErrorMessage(job.error))}</p>` : ""}${partialHint}<div class="audio-job-actions">${actions}</div>${chooseVoice}</article>`;
}

function updateAttributes(current, next) {
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
}

function updateContent(current, next) {
  updateAttributes(current, next);
  if (current.innerHTML !== next.innerHTML) current.innerHTML = next.innerHTML;
}

function updateButton(current, next) {
  updateAttributes(current, next);
  // A pointer commonly lands on the label span or SVG inside the button.
  // Keep those targets connected even when Cancel becomes Delete at completion.
  [...next.childNodes].forEach((child, index) => {
    const existing = current.childNodes[index];
    if (!existing) current.append(child.cloneNode(true));
    else if (existing.nodeType !== child.nodeType || existing.nodeName !== child.nodeName) existing.replaceWith(child.cloneNode(true));
    else if (child.nodeType === 1) updateButton(existing, child);
    else if (existing.nodeValue !== child.nodeValue) existing.nodeValue = child.nodeValue;
  });
  while (current.childNodes.length > next.childNodes.length) current.lastChild.remove();
}

function updateJobRow(current, next) {
  updateAttributes(current, next);
  // Progress events must not detach the row, its focused status or a button
  // between pointerdown and click. Only the changing read-only fields update.
  for (const selector of [".audio-job-heading", ".audio-job-status", "progress", ".audio-job-details"]) {
    updateContent(current.querySelector(selector), next.querySelector(selector));
  }
  const actions = current.querySelector(".audio-job-actions");
  for (const selector of [".audio-job-error", ".audio-job-partial"]) {
    const existing = current.querySelector(selector), replacement = next.querySelector(selector);
    if (existing && replacement) updateContent(existing, replacement);
    else if (existing) existing.remove();
    else if (replacement) current.insertBefore(replacement, selector === ".audio-job-error" ? current.querySelector(".audio-job-partial") || actions : actions);
  }
  const key = button => {
    const action = button.dataset.audioQueueAction;
    return ["pause", "resume"].includes(action) ? "pause-resume" : ["cancel", "remove"].includes(action) ? "delete" : action;
  };
  const existingActions = new Map([...actions.children].map(button => [key(button), button]));
  const nextActions = [...next.querySelector(".audio-job-actions").children];
  const nextKeys = new Set(nextActions.map(key));
  for (const [actionKey, button] of existingActions) {
    if (!nextKeys.has(actionKey)) { button.remove(); existingActions.delete(actionKey); }
  }
  let before = actions.firstElementChild;
  for (const replacement of nextActions) {
    const actionKey = key(replacement), button = existingActions.get(actionKey) || replacement;
    if (button !== replacement) updateButton(button, replacement);
    if (button !== before) actions.insertBefore(button, before);
    before = button.nextElementSibling;
    existingActions.delete(actionKey);
  }
  for (const button of existingActions.values()) button.remove();
  const alternate = current.querySelector(".audio-job-alternate"), nextAlternate = next.querySelector(".audio-job-alternate");
  if (alternate && nextAlternate) updateButton(alternate, nextAlternate);
  else if (alternate) alternate.remove();
  else if (nextAlternate) current.append(nextAlternate);
}

/** Closing this panel only closes its view; it never pauses the local queue. */
export function createAudioQueueUI({ queue, onListen = () => {}, onBrowse = () => {}, onManageStorage = () => {}, onChooseVoice = null, icon = () => "" }) {
  let dialog = null;
  let returnFocus = null;
  let unsubscribe = null;
  let snapshot = { jobs: [], suspended: [] };
  let revision = 0;
  let loading = false;
  let notice = "";
  let currentBookId = "";
  let focusBookPending = false;
  let headerObserver = null;
  const pending = new Set();
  const glyph = (name, fallback) => icon(name) || `<span aria-hidden="true">${fallback}</span>`;
  const copy = (source) => `<span data-audio-queue-copy="${escape(source)}">${escape(t(source))}</span>`;

  function measureHeader() {
    if (!dialog) return;
    const heading = dialog.querySelector(".audio-queue-heading").getBoundingClientRect();
    // The sticky heading starts inside the dialog's padding. Its height alone
    // leaves that offset uncovered when WebKit scrolls a focused job into view.
    // Round the complete inset up so fractional layout cannot cover its title.
    const inset = heading.bottom - dialog.getBoundingClientRect().top;
    if (heading.height > 0 && inset > 0) dialog.style.setProperty("--audio-queue-header-inset", `${Math.ceil(inset)}px`);
  }

  function focusCurrentBook() {
    if (!dialog?.open || !focusBookPending || !currentBookId) return;
    const row = [...dialog.querySelectorAll("[data-audio-book]")].find(item => item.dataset.audioBook === currentBookId);
    if (!row) return;
    const control = row.querySelector('[data-audio-queue-action="listen"]:not([aria-disabled="true"])')
      || row.querySelector('[data-audio-queue-action="resume"]:not([aria-disabled="true"])')
      || row.querySelector(".audio-job-status");
    focusBookPending = false;
    control.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "start", behavior: "instant" });
    control.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }

  function render() {
    if (!dialog) return;
    const active = document.activeElement;
    const action = active?.dataset?.audioQueueAction;
    const statusFocused = active?.matches?.(".audio-job-status");
    const jobId = active?.closest("[data-audio-job]")?.dataset.audioJob;
    const list = dialog.querySelector("[data-audio-queue-list]");
    const jobs = snapshot.jobs || [];
    list.setAttribute("aria-busy", String(loading));
    const template = document.createElement("template");
    template.innerHTML = jobs.map(job => audioQueueJobMarkup(job, { icon, busy: pending.has(job.id), currentBook: Boolean(currentBookId && job.bookId === currentBookId), canChooseVoice: typeof onChooseVoice === "function" })).join("");
    const existingRows = new Map([...list.children].map(row => [row.dataset.audioJob, row]));
    const nextRows = [...template.content.children];
    const nextIds = new Set(nextRows.map(row => row.dataset.audioJob));
    for (const [id, row] of existingRows) {
      if (!nextIds.has(id)) { row.remove(); existingRows.delete(id); }
    }
    let before = list.firstElementChild;
    for (const next of nextRows) {
      const row = existingRows.get(next.dataset.audioJob) || next;
      if (row !== next) updateJobRow(row, next);
      if (row !== before) list.insertBefore(row, before);
      before = row.nextElementSibling;
      existingRows.delete(row.dataset.audioJob);
    }
    for (const row of existingRows.values()) row.remove();
    if ((action || statusFocused) && jobId) {
      const sameRow = [...list.querySelectorAll("[data-audio-job]")].find(row => row.dataset.audioJob === jobId);
      const nextAction = action === "pause" ? "resume" : action === "resume" ? "pause" : action;
      const replacement = active?.isConnected && sameRow?.contains(active) ? active
        : statusFocused ? sameRow?.querySelector(".audio-job-status") : sameRow?.querySelector(`[data-audio-queue-action="${action}"]`) || sameRow?.querySelector(`[data-audio-queue-action="${nextAction}"]`) || sameRow?.querySelector("button:not(:disabled)");
      if (replacement && !replacement.disabled && replacement !== document.activeElement) replacement.focus({ preventScroll: true });
      else if (!sameRow) dialog.querySelector("[data-audio-queue-close]").focus({ preventScroll: true });
    }
    dialog.querySelector("[data-audio-queue-empty]").hidden = loading || jobs.length > 0;
    dialog.querySelector("[data-audio-queue-loading]").hidden = !loading;
    const status = dialog.querySelector("[data-audio-queue-notice]");
    status.textContent = notice ? t(notice) : "";
    status.dataset.error = String(notice !== "Les audios ont été supprimés. Vos livres et vos voix sont conservés.");
    const suspended = Array.isArray(snapshot.suspended) ? snapshot.suspended : [];
    const listening = suspended.some(reason => ["live", "listening", "playback", "direct-playback"].includes(reason));
    dialog.querySelector("[data-audio-queue-suspended]").hidden = !listening || !jobs.some(job => ["queued", "preparing"].includes(job.status));
    focusCurrentBook();
  }

  function localize() {
    if (!dialog) return;
    for (const node of dialog.querySelectorAll("[data-audio-queue-copy]")) node.textContent = t(node.dataset.audioQueueCopy);
    dialog.querySelector("[data-audio-queue-close]").setAttribute("aria-label", t("Fermer"));
    measureHeader();
    render();
  }

  function close() {
    if (!dialog) return;
    ++revision;
    unsubscribe?.();
    unsubscribe = null;
    headerObserver?.disconnect();
    headerObserver = null;
    window.removeEventListener("languagechange", localize);
    window.removeEventListener("resize", measureHeader);
    const current = dialog;
    dialog = null;
    currentBookId = "";
    focusBookPending = false;
    current.close();
    current.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  async function act(event) {
    const button = event.target.closest("[data-audio-queue-action]");
    if (!button || button.disabled) return;
    const jobId = button.closest("[data-audio-job]")?.dataset.audioJob;
    const job = snapshot.jobs.find(entry => entry.id === jobId);
    if (!job || pending.has(jobId)) return;
    const action = button.dataset.audioQueueAction;
    if (action === "choose-voice") {
      if (typeof onChooseVoice !== "function") return;
      close();
      try { await onChooseVoice(job); }
      catch { open({ bookId: job.bookId }); notice = "Impossible de mettre à jour la préparation. Réessayez."; render(); }
      return;
    }
    if (action === "listen") {
      if (!canListenToAudioJob(job)) return;
      close();
      try { await onListen(job, { fromStart: job.status !== "ready" }); }
      catch { open(); notice = "Impossible de mettre à jour la préparation. Réessayez."; render(); }
      return;
    }
    if (!["pause", "resume", "cancel", "remove"].includes(action)) return;
    pending.add(jobId);
    notice = "";
    render();
    try { await queue[action](jobId); }
    catch { notice = "Impossible de mettre à jour la préparation. Réessayez."; }
    finally {
      pending.delete(jobId);
      snapshot = queue.snapshot();
      render();
    }
  }

  function open({ bookId = "" } = {}) {
    currentBookId = String(bookId || "");
    focusBookPending = Boolean(currentBookId);
    if (dialog) {
      render();
      if (!currentBookId) dialog.querySelector("[data-audio-queue-close]").focus();
      return;
    }
    const token = ++revision;
    returnFocus = document.activeElement;
    snapshot = queue.snapshot();
    notice = "";
    loading = true;
    dialog = document.createElement("dialog");
    dialog.className = "audio-queue-dialog";
    dialog.setAttribute("aria-labelledby", "audio-queue-title");
    dialog.setAttribute("aria-describedby", "audio-queue-intro");
    dialog.innerHTML = `<div class="audio-queue-heading"><div><span class="voice-eyebrow">${copy("Prêts pour une prochaine écoute")}</span><h2 id="audio-queue-title">${copy("Préparations audio")}</h2></div><button class="round-button" data-audio-queue-close aria-label="${escape(t("Fermer"))}">${glyph("close", "×")}</button></div><p id="audio-queue-intro">${copy("Vos livres sont préparés l’un après l’autre sur cet appareil. Vous pouvez continuer à utiliser FastReader.")}</p><p class="audio-queue-foreground">${copy("Gardez FastReader ouvert. La préparation se met en pause en arrière-plan et reprend à votre retour. Après fermeture, relancez-la ici.")}</p><p class="audio-queue-suspended" data-audio-queue-suspended hidden>${copy("La préparation reprendra après l’écoute en cours.")}</p><p data-audio-queue-loading role="status">${copy("Chargement des préparations…")}</p><div class="audio-queue-empty" data-audio-queue-empty hidden><span aria-hidden="true">${glyph("volume", "♪")}</span><h3>${copy("Aucun livre en préparation")}</h3><p>${copy("Dans un livre, choisissez Écouter, puis Préparer le livre. Son audio sera conservé ici pour une écoute hors connexion.")}</p></div><div class="audio-queue-list" data-audio-queue-list></div><p class="audio-queue-notice" data-audio-queue-notice role="status" aria-live="polite" aria-atomic="true"></p><p class="audio-queue-storage-note">${copy("Supprimer l’audio ou annuler une préparation conserve le livre dans votre bibliothèque.")}</p>`;
    dialog.querySelector("[data-audio-queue-close]").onclick = close;
    const browse = document.createElement("div");
    browse.className = "audio-queue-browse";
    browse.innerHTML = `<button class="button secondary" data-audio-queue-browse>${glyph("plus", "+")}${copy("Ajouter d’autres livres")}</button><p>${copy("La préparation continue si vous fermez ce panneau.")}</p>`;
    dialog.querySelector("#audio-queue-intro").after(browse);
    dialog.querySelector("[data-audio-queue-browse]").onclick = async () => {
      close();
      try { await onBrowse(); }
      catch { open(); notice = "Impossible de mettre à jour la préparation. Réessayez."; render(); }
    };
    const foreground = dialog.querySelector(".audio-queue-foreground");
    const help = document.createElement("details");
    help.className = "audio-queue-guidance";
    help.innerHTML = `<summary>${copy("Préparation sur cet appareil")}</summary>`;
    foreground.replaceWith(help);
    help.append(foreground);
    const storage = document.createElement("button");
    storage.className = "voice-text-button audio-queue-storage-link";
    storage.dataset.audioQueueStorage = "";
    storage.innerHTML = `${glyph("storage", "▤")}${copy("Gérer le stockage audio")}`;
    help.after(storage);
    storage.onclick = () => {
      const bookId = currentBookId;
      close();
      onManageStorage({ bookId });
    };
    dialog.addEventListener("click", event => { void act(event); });
    // A delayed new job must not take focus after the reader starts interacting
    // with another part of the queue.
    for (const type of ["pointerdown", "keydown"]) dialog.addEventListener(type, () => { focusBookPending = false; });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", event => { if (event.currentTarget === dialog) close(); });
    window.addEventListener("languagechange", localize);
    window.addEventListener("resize", measureHeader);
    document.body.append(dialog);
    render();
    dialog.showModal();
    measureHeader();
    if (typeof ResizeObserver === "function") {
      headerObserver = new ResizeObserver(measureHeader);
      headerObserver.observe(dialog.querySelector(".audio-queue-heading"));
    }
    focusCurrentBook();
    unsubscribe = queue.subscribe(update => { snapshot = update; render(); });
    Promise.resolve(queue.list()).then(update => {
      if (dialog && token === revision) snapshot = update;
    }, () => {
      if (dialog && token === revision) notice = "Impossible de mettre à jour la préparation. Réessayez.";
    }).finally(() => { if (dialog && token === revision) { loading = false; render(); } });
  }

  return { open, close, dispose: close };
}
