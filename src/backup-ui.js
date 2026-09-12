import { exportBackup, restoreBackup } from "./backup.js";
import { getStorageStatus, requestPersistentStorage } from "./storage.js";
import "./backup.css";

const formatSize = (bytes) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 2) + " Mo";

/** A native modal owns keyboard focus; all imported labels are rendered as text. */
export function createBackupController({ beforeExport = async () => {}, afterRestore = async () => {}, onError } = {}) {
  let dialog;
  let busy = false;
  let trigger;

  const report = (message, failed = false) => {
    if (!dialog) return;
    const status = dialog.querySelector("#backup-status");
    status.textContent = message;
    status.dataset.error = String(failed);
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
  const refreshStorage = async () => {
    const current = dialog;
    const status = await getStorageStatus();
    if (!current || current !== dialog) return;
    current.querySelector("#backup-storage").textContent = status.usage === null
      ? "Ce navigateur ne communique pas l’espace utilisé."
      : `Environ ${formatSize(status.usage)} utilisés par ce site${status.quota !== null ? ` sur une limite estimée de ${formatSize(status.quota)}` : ""}.`;
    current.querySelector("#backup-persistence").textContent = status.persistent
      ? "Le navigateur protège actuellement ce stockage contre l’effacement automatique."
      : "Le navigateur peut effacer le stockage local. Une sauvegarde ZIP permet de retrouver vos livres.";
    const protect = current.querySelector("#backup-protect");
    protect.hidden = !status.canPersist || status.persistent === true;
  };
  const close = () => { if (!busy) dialog?.close(); };

  async function open() {
    if (dialog) { dialog.focus(); return; }
    trigger = document.activeElement;
    dialog = document.createElement("dialog");
    dialog.className = "backup-dialog";
    dialog.setAttribute("aria-labelledby", "backup-title");
    dialog.innerHTML = `<div class="backup-heading"><div><span class="eyebrow">SUR VOTRE APPAREIL</span><h2 id="backup-title">Sauvegarde et stockage</h2></div><button type="button" class="round-button" id="backup-close" aria-label="Fermer la sauvegarde">×</button></div>
      <p class="backup-intro">Gardez une copie de vos livres, positions, signets, notes et réglages. Vous pourrez la restaurer ici ou sur un autre appareil, sans compte.</p>
      <section class="backup-section" aria-labelledby="backup-export-title"><h3 id="backup-export-title">Tout sauvegarder</h3><p>Un fichier ZIP à conserver dans vos fichiers personnels. Jusqu’à 500 livres et 250 Mo par sauvegarde.</p><button type="button" class="button ink" id="backup-export">Exporter ma sauvegarde</button></section>
      <section class="backup-section" aria-labelledby="backup-restore-title"><h3 id="backup-restore-title">Retrouver une sauvegarde</h3><p>Les livres manquants et les nouveaux signets et notes sont ajoutés. Vos livres, positions et notes déjà présents sont conservés.</p><label for="backup-file" class="backup-file-label">Choisir une sauvegarde FastReader (.zip)</label><input type="file" id="backup-file" accept=".zip,application/zip"><label class="backup-check"><input type="checkbox" id="backup-settings">Remplacer aussi mes réglages de lecture par ceux de la sauvegarde</label><button type="button" class="button secondary" id="backup-restore" disabled>Restaurer la sauvegarde</button></section>
      <section class="backup-section" aria-labelledby="backup-storage-title"><h3 id="backup-storage-title">Espace sur cet appareil</h3><p id="backup-storage">Estimation de l’espace utilisé…</p><p id="backup-persistence"></p><button type="button" class="button secondary" id="backup-protect" hidden>Protéger le stockage local</button><p class="backup-hint">Effacer les données du site supprime aussi les livres. Gardez votre fichier ZIP en dehors du navigateur.</p></section>
      <p id="backup-status" role="status" aria-live="polite" aria-atomic="true"></p>`;
    document.body.append(dialog);
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
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
        report(`Sauvegarde prête : ${result.bookCount} livre${result.bookCount > 1 ? "s" : ""}. Conservez le fichier ZIP téléchargé.`);
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
        report(`Restauration terminée : ${result.added} livre${result.added > 1 ? "s" : ""} ajouté${result.added > 1 ? "s" : ""}, ${result.existing} déjà présent${result.existing > 1 ? "s" : ""}. ${result.annotationsAdded} note${result.annotationsAdded > 1 ? "s" : ""} et ${result.bookmarksAdded} signet${result.bookmarksAdded > 1 ? "s" : ""} ajouté${result.annotationsAdded + result.bookmarksAdded > 1 ? "s" : ""}.`);
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
  return { open, close, destroy() { if (dialog) { dialog.remove(); dialog = undefined; } } };
}
