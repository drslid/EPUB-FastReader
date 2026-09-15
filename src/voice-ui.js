import { t, locale, languages, formatNumber } from "./i18n.js";
import { VOICES, normalizeBookLanguage } from "./voice-assets.js";
import "./voice.css";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const errors = {
  OFFLINE: "Connexion nécessaire pour télécharger une voix.",
  STORAGE_FULL: "Espace insuffisant. Libérez du stockage puis réessayez.",
  STORAGE_UNAVAILABLE: "Le navigateur ne permet pas de conserver cette voix. Vérifiez ses réglages de stockage.",
  INTEGRITY: "Le fichier vocal est incomplet. Réessayez le téléchargement.",
  BUSY: "Un téléchargement est déjà en cours. Réessayez dans un instant.",
  UNSUPPORTED_VOICE: "Aucune voix disponible dans cette langue pour le moment.",
  BROWSER_UNSUPPORTED: "Ce navigateur ne permet pas la lecture vocale locale. Essayez un navigateur récent.",
};

export function voiceErrorMessage(error) {
  return t(errors[error?.code] || "Le téléchargement a échoué. Vérifiez votre connexion puis réessayez.");
}

export function formatVoiceBytes(bytes) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: bytes >= 10_000_000 ? 0 : 1 }).format(Math.max(0, Number(bytes) || 0) / 1_000_000);
}

/** Optional voice download dialog. Opening it never starts a network download.
 * onActivate runs synchronously in the click gesture (for mobile audio unlock).
 * onChoose owns playback/error handling after the dialog closes.
 * onReady may prepare an installed voice locally; null cancels an obsolete
 * selection. Readiness never triggers a download or starts audio here.
 */
export function createVoiceUI({ downloads, onChoose = () => {}, onActivate = () => {}, onClose = () => {}, onReady = () => {}, onManageStorage = () => {}, icon = () => "" }) {
  let dialog = null;
  let controller = null;
  let returnFocus = null;
  let language = "";
  let selectedId = "";
  let statuses = new Map();
  let pending = false;
  let checking = false;
  let progress = null;
  let notice = "";
  let error = null;
  let interrupted = false;
  let revision = 0;
  let session = 0;
  let notifiedVoiceId = null;

  const selectedVoice = () => VOICES.find((voice) => voice.id === selectedId && voice.language === language);
  const online = () => navigator.onLine !== false;
  const copy = (source) => `<span data-voice-copy="${escape(source)}">${escape(t(source))}</span>`;
  const glyph = (name, fallback) => icon(name) || `<span aria-hidden="true">${fallback}</span>`;
  const setText = (selector, value) => { const node = dialog?.querySelector(selector); if (node) node.textContent = value; };

  function notifyReady() {
    if (!dialog?.open) return;
    const voice = !checking && !pending && statuses.get(selectedId)?.ready === true ? selectedVoice() : null;
    const id = voice?.id || null;
    if (id === notifiedVoiceId) return;
    notifiedVoiceId = id;
    // Speculative preparation must never prevent explicit listening or expose
    // an unhandled rejection when the reader leaves this dialog.
    try { Promise.resolve(onReady(voice || null)).catch(() => {}); } catch { /* Listening can still start normally. */ }
  }

  function renderProgress() {
    if (!dialog) return;
    const region = dialog.querySelector("[data-voice-progress]");
    region.hidden = !pending;
    const meter = region.querySelector("progress");
    if (progress && progress.totalBytes > 0) {
      meter.value = Math.min(100, Math.max(0, progress.percent ?? progress.loadedBytes / progress.totalBytes * 100));
      setText("[data-voice-progress-size]", t("{loaded} sur {total}", { loaded: formatVoiceBytes(progress.loadedBytes), total: formatVoiceBytes(progress.totalBytes) }));
    } else {
      meter.removeAttribute("value");
      setText("[data-voice-progress-size]", "");
    }
  }

  function render() {
    if (!dialog) return;
    const voice = selectedVoice();
    const status = statuses.get(selectedId);
    const ready = status?.ready === true;
    dialog.querySelector("[data-voice-language]").disabled = pending;
    const empty = dialog.querySelector("[data-voice-empty]");
    empty.hidden = Boolean(voice);
    empty.textContent = t(language ? "Aucune voix disponible dans cette langue pour le moment." : "Choisissez la langue du texte pour voir les voix disponibles.");
    for (const row of dialog.querySelectorAll("[data-voice-choice]")) {
      const input = row.querySelector("input");
      const available = statuses.get(input.value)?.ready === true;
      input.disabled = pending;
      input.checked = input.value === selectedId;
      row.classList.toggle("is-selected", input.checked);
      row.querySelector("[data-voice-ready]").textContent = t(available ? "Disponible hors connexion" : checking ? "Vérification…" : "À télécharger");
      row.dataset.ready = String(available);
    }
    const hint = dialog.querySelector("[data-voice-size]");
    hint.hidden = !voice || ready || !status || pending;
    hint.textContent = !status ? "" : status.storedBytes > 0
      ? t("Encore {size} à télécharger. Les fichiers déjà prêts sont conservés.", { size: formatVoiceBytes(status.bytesRemaining ?? status.downloadBytes) })
      : t("Premier téléchargement : environ {size}. Ensuite, cette voix fonctionne hors connexion.", { size: formatVoiceBytes(status.totalBytes) });
    const offline = dialog.querySelector("[data-voice-offline]");
    offline.hidden = online();
    offline.textContent = t(ready ? "Les voix déjà téléchargées restent disponibles hors connexion." : "Connexion nécessaire pour télécharger une voix.");
    const action = dialog.querySelector("[data-voice-start]");
    action.disabled = !voice || checking || pending || (!ready && !online()) || (!ready && !status);
    setText("[data-voice-start-label]", t(ready ? "Lancer l’écoute" : error ? "Réessayer" : interrupted ? "Reprendre le téléchargement" : "Télécharger et écouter"));
    const prepare = dialog.querySelector("[data-voice-prepare]");
    prepare.disabled = action.disabled;
    setText("[data-voice-prepare-label]", t(ready ? "Préparer le livre" : "Télécharger et préparer le livre"));
    const statusRegion = dialog.querySelector("[data-voice-status]");
    statusRegion.textContent = error ? voiceErrorMessage(error) : notice ? t(notice) : "";
    statusRegion.dataset.error = String(Boolean(error));
    dialog.querySelector("[data-voice-list]").setAttribute("aria-busy", String(checking));
    renderProgress();
    notifyReady();
  }

  function renderChoices() {
    if (!dialog) return;
    const choices = VOICES.filter((voice) => voice.language === language);
    if (!choices.some((voice) => voice.id === selectedId)) selectedId = choices[0]?.id || "";
    dialog.querySelector("[data-voice-list]").innerHTML = choices.map((voice) => `<label class="voice-choice" data-voice-choice><input type="radio" name="voice-choice" value="${escape(voice.id)}" ${selectedId === voice.id ? "checked" : ""}><span class="voice-choice-icon" aria-hidden="true">${glyph("volume", "♪")}</span><span class="voice-choice-copy"><strong>${escape(voice.name)}</strong><small data-voice-ready></small></span><span class="voice-choice-check" aria-hidden="true">✓</span></label>`).join("");
    render();
  }

  async function refresh() {
    const token = ++revision;
    checking = true;
    render();
    try {
      const result = await downloads.list();
      if (!dialog || token !== revision) return;
      statuses = new Map(result.map((status) => [status.voiceId, status]));
    } catch (failure) {
      if (!dialog || token !== revision) return;
      error = failure;
    } finally {
      if (dialog && token === revision) { checking = false; render(); }
    }
  }

  function localize() {
    if (!dialog) return;
    for (const node of dialog.querySelectorAll("[data-voice-copy]")) node.textContent = t(node.dataset.voiceCopy);
    dialog.querySelector("[data-voice-close]").setAttribute("aria-label", t("Fermer"));
    dialog.querySelector("progress").setAttribute("aria-label", t("Téléchargement de la voix…"));
    const placeholder = dialog.querySelector('[data-voice-language] option[value=""]');
    if (placeholder) placeholder.textContent = t("Choisir une langue");
    render();
  }

  function close(reason = "cancel") {
    if (!dialog) return;
    controller?.abort();
    controller = null;
    ++revision;
    ++session;
    notifiedVoiceId = null;
    const current = dialog;
    dialog = null;
    window.removeEventListener("online", render);
    window.removeEventListener("offline", render);
    window.removeEventListener("languagechange", localize);
    current.close();
    current.remove();
    if (returnFocus?.isConnected && reason !== "dispose") returnFocus.focus({ preventScroll: true });
    pending = false;
    checking = false;
    onClose({ reason });
  }

  async function start(intent = "listen") {
    const voice = selectedVoice();
    if (!voice || pending || checking) return;
    const currentSession = session;
    // This hook must stay before all awaits so Safari sees a user gesture.
    if (intent === "listen") onActivate();
    error = null;
    notice = "";
    const ready = statuses.get(voice.id)?.ready === true;
    if (!ready) {
      if (!online()) { error = { code: "OFFLINE" }; render(); return; }
      const currentController = new AbortController();
      controller = currentController;
      pending = true;
      progress = null;
      render();
      try {
        await downloads.download(voice.id, { signal: currentController.signal, onProgress(update) {
          if (!dialog || session !== currentSession || currentController.signal.aborted) return;
          progress = update;
          renderProgress();
        } });
        if (!dialog || session !== currentSession || currentController.signal.aborted) return;
      } catch (failure) {
        if (!dialog || session !== currentSession) return;
        if (currentController.signal.aborted || failure?.name === "AbortError") {
          interrupted = true;
          notice = "Téléchargement arrêté. Vous pourrez le reprendre ici.";
        } else error = failure;
        return;
      } finally {
        if (controller === currentController) controller = null;
        if (dialog && session === currentSession) { pending = false; await refresh(); }
      }
      if (!dialog || session !== currentSession || currentController.signal.aborted) return;
    }
    close("chosen");
    await onChoose(voice, { intent });
  }

  function open({ bookLanguage = "", lastVoiceId = "" } = {}) {
    if (dialog) { dialog.querySelector("[data-voice-language]").focus(); return; }
    ++session;
    const normalized = normalizeBookLanguage(bookLanguage);
    language = normalized || "";
    // Never switch an unsupported book language silently to another voice.
    const previous = VOICES.find((voice) => voice.id === lastVoiceId && voice.language === language);
    selectedId = previous?.id || "";
    statuses = new Map();
    error = null;
    notice = "";
    interrupted = false;
    progress = null;
    returnFocus = document.activeElement;
    dialog = document.createElement("dialog");
    dialog.className = "voice-dialog";
    dialog.setAttribute("aria-labelledby", "voice-dialog-title");
    let languageOptions = languages.map(({ code, name }) => `<option value="${code}" ${language === code ? "selected" : ""}>${escape(name)}</option>`).join("");
    if (language && !languages.some(({ code }) => code === language)) {
      let name = language;
      try { name = new Intl.DisplayNames(locale, { type: "language" }).of(language) || language; } catch { /* Preserve an unknown code without changing the text's language. */ }
      languageOptions += `<option value="${escape(language)}" selected>${escape(name)}</option>`;
    }
    dialog.innerHTML = `
      <div class="voice-dialog-heading"><h2 id="voice-dialog-title">${copy("Choisir une voix")}</h2><button class="round-button" data-voice-close aria-label="${escape(t("Fermer"))}">${glyph("close", "×")}</button></div>
      <label class="voice-language-label" for="voice-language">${copy("Langue du livre")}</label>
      <select id="voice-language" data-voice-language><option value="" ${language ? "" : "selected"}>${escape(t("Choisir une langue"))}</option>${languageOptions}</select>
      <fieldset class="voice-options"><legend class="sr-only">${copy("Choisir une voix")}</legend><div class="voice-list" data-voice-list></div></fieldset>
      <p class="voice-empty" data-voice-empty></p><p class="voice-size" data-voice-size></p><p class="voice-offline" data-voice-offline hidden></p>
      <div class="voice-download-progress" data-voice-progress hidden><strong>${copy("Téléchargement de la voix…")}</strong><progress max="100" aria-label="${escape(t("Téléchargement de la voix…"))}"></progress><div class="voice-progress-bottom"><span data-voice-progress-size></span><button class="voice-text-button" data-voice-cancel>${copy("Annuler le téléchargement")}</button></div></div>
      <p class="voice-status" data-voice-status role="status" aria-live="polite" aria-atomic="true"></p>
      <div class="voice-actions"><button class="button primary voice-start" data-voice-start disabled>${glyph("play", "▶")}<span data-voice-start-label></span></button><button class="button secondary voice-start" data-voice-prepare disabled>${glyph("download", "↓")}<span data-voice-prepare-label></span></button></div>
      <button class="voice-text-button voice-storage-link" data-voice-storage>${glyph("storage", "▤")}${copy("Gérer le stockage audio")}</button>`;
    dialog.querySelector("[data-voice-close]").onclick = () => close();
    dialog.querySelector("[data-voice-prepare]").onclick = () => { void start("prepare"); };
    dialog.querySelector("[data-voice-cancel]").onclick = () => controller?.abort();
    dialog.querySelector("[data-voice-start]").onclick = () => { void start(); };
    dialog.querySelector("[data-voice-storage]").onclick = () => { close("storage"); onManageStorage(); };
    dialog.querySelector("[data-voice-language]").onchange = (event) => {
      language = event.target.value;
      selectedId = "";
      error = null;
      notice = "";
      interrupted = false;
      renderChoices();
    };
    dialog.querySelector("[data-voice-list]").onchange = (event) => {
      if (event.target.matches('input[name="voice-choice"]')) { selectedId = event.target.value; error = null; notice = ""; interrupted = false; render(); }
    };
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("close", event => { if (event.currentTarget === dialog) close(); });
    window.addEventListener("online", render);
    window.addEventListener("offline", render);
    window.addEventListener("languagechange", localize);
    document.body.append(dialog);
    renderChoices();
    dialog.showModal();
    void refresh();
  }

  return { open, close, dispose: () => close("dispose") };
}

/** Controls for the reader; the reader owns playback and event delegation. */
export function audioControlsMarkup({ status = "idle", voiceLabel = "", rate = 1, message = "", playing = status === "playing", prepared = false, preparationStatus = "", preparation = null } = {}, { icon = () => "" } = {}) {
  const glyph = (name, fallback) => icon(name) || `<span aria-hidden="true">${fallback}</span>`;
  const busy = ["loading", "preparing", "buffering"].includes(status);
  const label = playing || busy ? "Pause" : status === "paused" ? "Reprendre" : "Lancer l’écoute";
  let defaultMessage = status === "loading" ? "Préparation de la voix…" : status === "preparing" ? "Préparation du passage…" : status === "buffering" ? "Préparation du prochain passage…" : status === "ended" ? "Écoute terminée" : status === "paused" ? "Lecture vocale en pause" : "";
  if (prepared && status === "buffering") {
    defaultMessage = preparationStatus === "unavailable" ? "Fin des passages enregistrés avec cette voix. Ouvrez la file audio pour préparer le livre avec une nouvelle voix."
      : preparationStatus === "paused" ? "La préparation est en pause. Reprenez-la dans la file audio."
      : preparationStatus === "error" ? "La préparation est interrompue. Ouvrez la file audio pour la reprendre."
        : preparationStatus === "queued" ? "Ce livre attend son tour. L’écoute reprendra quand la suite sera prête."
          : "Vous avez rejoint la préparation. L’écoute reprend dès que la suite est prête.";
  } else if (prepared && playing) {
    if (preparationStatus === "preparing") defaultMessage = "La suite du livre se prépare pendant votre écoute.";
    else if (preparationStatus === "queued") defaultMessage = "La suite attend son tour dans la file audio.";
  }
  const loadingVoice = preparation?.phase === "loading" || (!preparation?.phase && status === "loading")
    || preparation?.engineProgress?.stage === "loading" && preparation?.phase !== "ready";
  const stage = loadingVoice ? "Chargement de la voix…" : preparation?.phase === "ready" ? "Démarrage de l’écoute…"
    : preparation?.engineProgress?.stage === "phonemizing" ? "Analyse du texte…" : "Préparation des phrases…";
  if (busy && !prepared) {
    defaultMessage = `${t(stage)} ${t(status === "buffering"
      ? "L’écoute reprend automatiquement dès que le prochain passage est prêt."
      : "L’écoute démarre automatiquement dès que le premier passage est prêt.")}`;
  }
  const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const total = Math.floor(nonnegative(preparation?.total));
  const completed = Math.min(total || Infinity, Math.floor(nonnegative(preparation?.completed)));
  const seconds = Math.floor(nonnegative(preparation?.bufferedSeconds));
  const counts = total > 0 ? t("Phrases prêtes : {count}/{total}", { count: formatNumber(completed), total: formatNumber(total) })
    : completed > 0 ? t("Phrases prêtes : {count}", { count: formatNumber(completed) }) : "";
  const duration = seconds > 0 ? t("{seconds} s d’audio prêts", { seconds: formatNumber(seconds) }) : "";
  const queueStopped = prepared && status === "buffering" && ["paused", "error"].includes(preparationStatus);
  const showProgress = busy && !queueStopped || preparation && ["playing", "paused"].includes(status) && (total > 0 || completed > 0 || seconds > 0);
  const determinate = total > 0 && !loadingVoice;
  const preparationMarkup = showProgress
    ? `<div class="voice-preparation${playing ? " is-playing" : ""}" data-voice-preparation data-phase="${escape(preparation?.phase || (status === "loading" ? "loading" : "generating"))}" aria-live="off"><div class="voice-preparation-details"><span data-voice-prepared-count>${escape(counts)}</span><span data-voice-buffered-seconds>${escape(duration)}</span></div><progress ${determinate ? `max="${total}" value="${completed}"` : 'max="1"'} aria-label="${escape(t("Préparation audio"))}"${counts ? ` aria-valuetext="${escape(counts)}"` : ""}></progress></div>` : "";
  const queueLink = prepared && ["buffering", "error"].includes(status)
    ? `<div class="voice-buffer-actions"><button class="voice-text-button" data-voice-action="queue">${glyph("queue", "☷")}<span>${escape(t("Voir la file audio"))}</span></button></div>` : "";
  const speed = Math.min(1.75, Math.max(0.75, Number(rate) || 1));
  return `<section class="voice-player" aria-label="${escape(t("Lecture vocale"))}"><div class="voice-player-heading"><span class="voice-eyebrow">${escape(t("Écouter"))}</span><button class="voice-text-button" data-voice-action="choose">${glyph("volume", "♪")}<span>${escape(voiceLabel || t("Choisir une voix"))}</span></button></div><div class="voice-player-buttons"><button class="round-button" data-voice-action="previous" aria-label="${escape(t("Phrase précédente"))}">${glyph("skipBack", "↶")}</button><button class="button primary voice-toggle" data-voice-action="toggle" >${glyph(playing || busy ? "pause" : "play", playing || busy ? "Ⅱ" : "▶")}<span>${escape(t(label))}</span></button><button class="round-button" data-voice-action="next" aria-label="${escape(t("Passage suivant"))}">${glyph("skipForward", "↷")}</button></div><label class="voice-rate"><span>${escape(t("Vitesse d’écoute"))}</span><input data-voice-rate type="range" min="0.75" max="1.75" step="0.05" value="${speed}" aria-label="${escape(t("Vitesse d’écoute"))}"><output data-voice-rate-value>${escape(formatNumber(speed, { maximumFractionDigits: 2 }))}×</output></label>${preparationMarkup}<p class="voice-player-status" role="status" aria-live="polite" aria-atomic="true">${escape(message || (defaultMessage ? t(defaultMessage) : ""))}</p>${queueLink}</section>`;
}
