import { t, formatNumber } from "./i18n.js";
import { exportBackup, restoreBackup } from "./backup.js";
import { getStorageStatus, requestPersistentStorage } from "./storage.js";
import "./backup.css";

const formatSize = (bytes) => t("{size} Mo", { size: formatNumber(bytes / 1024 ** 2, { maximumFractionDigits: 1 }) });

/** A native modal owns keyboard focus; all imported labels are rendered as text. */
export function createBackupController({ beforeExport = async () => {}, afterRestore = async () => {}, onError } = {}) {
  let dialog;
  let busy = false;
  let trigger;
  let storageStatus;
  let lastReport;

  const renderReport = () => {
    if (!dialog || !lastReport) return;
    const status = dialog.querySelector("#backup-status");
    const parameters = Object.fromEntries(Object.entries(lastReport.parameters).map(([key, value]) => [key, typeof value === "number" ? formatNumber(value) : value]));
    status.textContent = t(lastReport.message, parameters);
    status.dataset.error = String(lastReport.failed);
  };
  const report = (message, failed = false, parameters = {}) => {
    lastReport = { message, failed, parameters };
    renderReport();
  };
  const setBusy = (value) => {
    busy = value;
    if (!dialog) return;
    dialog.setAttribute("aria-busy", String(value));
    for (const element of dialog.querySelectorAll("button, input")) element.disabled = value;
    if (!value) dialog.querySelector("#backup-restore").disabled = !dialog.querySelector("#backup-file").files.length;
  };
  const showError = (cause) => {
    const message = cause?.name === "QuotaExceededError"
      ? "Le stockage est plein. La restauration a été annulée : vos livres actuels sont inchangés. Libérez de la place puis réessayez."
      : cause?.message || "L’opération n’a pas pu aboutir. Réessayez.";
    report(message, true);
    onError?.(cause);
  };
  const renderStorage = () => {
    if (!dialog) return;
    if (!storageStatus) {
      dialog.querySelector("#backup-storage").textContent = t("Estimation de l’espace utilisé…");
      return;
    }
    const status = storageStatus;
    dialog.querySelector("#backup-storage").textContent = status.usage === null
      ? t("Ce navigateur ne communique pas l’espace utilisé.")
      : status.quota === null
        ? t("Environ {usage} utilisés par ce site.", { usage: formatSize(status.usage) })
        : t("Environ {usage} utilisés par ce site sur une limite estimée de {quota}.", { usage: formatSize(status.usage), quota: formatSize(status.quota) });
    dialog.querySelector("#backup-persistence").textContent = status.persistent
      ? t("Le navigateur protège actuellement ce stockage contre l’effacement automatique.")
      : t("Le navigateur peut effacer le stockage local. Une sauvegarde ZIP permet de retrouver vos livres.");
    const protect = dialog.querySelector("#backup-protect");
    protect.hidden = !status.canPersist || status.persistent === true;
  };
  const refreshStorage = async () => {
    const current = dialog;
    const status = await getStorageStatus();
    if (!current || current !== dialog) return;
    storageStatus = status;
    renderStorage();
  };
  // A restored preference can change the language while this modal is open.
  // Relabel existing nodes so file selection, checked state, focus and handlers
  // survive. Do not rebuild the dialog or relax its busy/cancel guard.
  const localize = () => {
    if (!dialog) return;
    const labels = [
      [".eyebrow", "SUR VOTRE APPAREIL"],
      ["#backup-title", "Sauvegarde et stockage"],
      [".backup-intro", "Gardez une copie de vos livres, positions, signets, notes et réglages. Vous pourrez la restaurer ici ou sur un autre appareil, sans compte."],
      ["#backup-export-title", "Tout sauvegarder"],
      ["#backup-export-title + p", "Un fichier ZIP à conserver dans vos fichiers personnels. Jusqu’à 500 livres et 250 Mo par sauvegarde."],
      ["#backup-export", "Exporter ma sauvegarde"],
      ["#backup-restore-title", "Retrouver une sauvegarde"],
      ["#backup-restore-title + p", "Les livres manquants et les nouveaux signets et notes sont ajoutés. Vos livres, positions et notes déjà présents sont conservés."],
      [".backup-file-label", "Choisir une sauvegarde FastReader (.zip)"],
      ["#backup-restore", "Restaurer la sauvegarde"],
      ["#backup-storage-title", "Espace sur cet appareil"],
      ["#backup-protect", "Protéger le stockage local"],
      [".backup-hint", "Effacer les données du site supprime aussi les livres. Gardez votre fichier ZIP en dehors du navigateur."],
    ];
    for (const [selector, source] of labels) dialog.querySelector(selector).textContent = t(source);
    dialog.querySelector("#backup-close").setAttribute("aria-label", t("Fermer la sauvegarde"));
    dialog.querySelector(".backup-check").lastChild.textContent = t("Remplacer aussi mes réglages de lecture par ceux de la sauvegarde");
    renderStorage();
    renderReport();
  };
  const close = () => { if (!busy) dialog?.close(); };

  async function open() {
    if (dialog) { dialog.focus(); return; }
    storageStatus = undefined;
    lastReport = undefined;
    trigger = document.activeElement;
    dialog = document.createElement("dialog");
    dialog.className = "backup-dialog";
    dialog.setAttribute("aria-labelledby", "backup-title");
    dialog.innerHTML = `<div class="backup-heading"><div><span class="eyebrow">${t("SUR VOTRE APPAREIL")}</span><h2 id="backup-title">${t("Sauvegarde et stockage")}</h2></div><button type="button" class="round-button" id="backup-close" aria-label="${t("Fermer la sauvegarde")}">×</button></div>
      <p class="backup-intro">${t("Gardez une copie de vos livres, positions, signets, notes et réglages. Vous pourrez la restaurer ici ou sur un autre appareil, sans compte.")}</p>
      <section class="backup-section" aria-labelledby="backup-export-title"><h3 id="backup-export-title">${t("Tout sauvegarder")}</h3><p>${t("Un fichier ZIP à conserver dans vos fichiers personnels. Jusqu’à 500 livres et 250 Mo par sauvegarde.")}</p><button type="button" class="button ink" id="backup-export">${t("Exporter ma sauvegarde")}</button></section>
      <section class="backup-section" aria-labelledby="backup-restore-title"><h3 id="backup-restore-title">${t("Retrouver une sauvegarde")}</h3><p>${t("Les livres manquants et les nouveaux signets et notes sont ajoutés. Vos livres, positions et notes déjà présents sont conservés.")}</p><label for="backup-file" class="backup-file-label">${t("Choisir une sauvegarde FastReader (.zip)")}</label><input type="file" id="backup-file" accept=".zip,application/zip"><label class="backup-check"><input type="checkbox" id="backup-settings">${t("Remplacer aussi mes réglages de lecture par ceux de la sauvegarde")}</label><button type="button" class="button secondary" id="backup-restore" disabled>${t("Restaurer la sauvegarde")}</button></section>
      <section class="backup-section" aria-labelledby="backup-storage-title"><h3 id="backup-storage-title">${t("Espace sur cet appareil")}</h3><p id="backup-storage">${t("Estimation de l’espace utilisé…")}</p><p id="backup-persistence"></p><button type="button" class="button secondary" id="backup-protect" hidden>${t("Protéger le stockage local")}</button><p class="backup-hint">${t("Effacer les données du site supprime aussi les livres. Gardez votre fichier ZIP en dehors du navigateur.")}</p></section>
      <p id="backup-status" role="status" aria-live="polite" aria-atomic="true"></p>`;
    document.body.append(dialog);
    window.addEventListener("languagechange", localize);
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      window.removeEventListener("languagechange", localize);
      dialog?.remove(); dialog = undefined;
      if (trigger?.isConnected) trigger.focus();
    });
    dialog.querySelector("#backup-close").onclick = close;
    dialog.querySelector("#backup-file").onchange = () => {
      dialog.querySelector("#backup-restore").disabled = !dialog.querySelector("#backup-file").files.length;
      report("");
    };
    dialog.querySelector("#backup-export").onclick = async () => {
      setBusy(true); report("Préparation de votre sauvegarde…");
      try {
        await beforeExport();
        const result = await exportBackup({ onProgress: ({ message }) => report(message) });
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = url; link.download = result.fileName;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        report(result.bookCount > 1 ? "Sauvegarde prête : {count} livres. Conservez le fichier ZIP téléchargé." : "Sauvegarde prête : {count} livre. Conservez le fichier ZIP téléchargé.", false, { count: result.bookCount });
      } catch (cause) { showError(cause); }
      finally { setBusy(false); }
    };
    dialog.querySelector("#backup-restore").onclick = async () => {
      const file = dialog.querySelector("#backup-file").files[0];
      if (!file) return;
      const restorePreferences = dialog.querySelector("#backup-settings").checked;
      setBusy(true); report("Vérification de votre sauvegarde…");
      try {
        await beforeExport();
        const result = await restoreBackup(file, { restorePreferences, onProgress: ({ message }) => report(message) });
        await afterRestore(result);
        report("Restauration terminée. Livres ajoutés : {added} ; déjà présents : {existing}. Notes ajoutées : {notes} ; signets ajoutés : {bookmarks}.", false, { added: result.added, existing: result.existing, notes: result.annotationsAdded, bookmarks: result.bookmarksAdded });
        dialog.querySelector("#backup-file").value = "";
        await refreshStorage();
      } catch (cause) { showError(cause); }
      finally { setBusy(false); }
    };
    dialog.querySelector("#backup-protect").onclick = async () => {
      setBusy(true);
      try {
        const granted = await requestPersistentStorage();
        await refreshStorage();
        report(granted ? "Protection du stockage activée. Conservez également une sauvegarde ZIP." : "Le navigateur n’a pas accordé la protection. Vos livres restent disponibles ; conservez une sauvegarde ZIP.");
      } catch (cause) { showError(cause); }
      finally { setBusy(false); }
    };
    dialog.showModal();
    setBusy(true);
    try { await beforeExport(); await refreshStorage(); }
    catch (cause) { showError(cause); }
    finally { setBusy(false); dialog?.querySelector("#backup-export").focus(); }
  }
  return { open, close, destroy() { window.removeEventListener("languagechange", localize); if (dialog) { dialog.remove(); dialog = undefined; } } };
}
