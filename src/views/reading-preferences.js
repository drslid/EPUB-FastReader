import { t, formatNumber } from "../i18n.js";
import { focusOptions } from "../reading-preferences.js";

export function readingPreferencesMarkup(settings, { applyFocus }) {
  return `<section class="reading-preview-section" aria-labelledby="preview-heading">
    <label class="setting-label" for="reading-profile">${t("Confort de lecture")}</label>
    <select id="reading-profile">${[["balanced", "Équilibré"], ["comfort", "Confort"], ["light", "Focus léger"], ["custom", "Personnalisé"]].map(([value, label]) => `<option value="${value}" ${settings.profile === value ? "selected" : ""}>${t(label)}</option>`).join("")}</select>
    <h3 id="preview-heading">${t("Aperçu immédiat")}</h3>
    <div id="reading-preview" class="reading-preview" tabindex="0" role="region" aria-labelledby="preview-heading" data-focus="${settings.mode === "focus"}">${previewContent(settings, applyFocus)}</div>
    <p class="setting-hint">${t("Vos réglages s’appliquent à cet extrait et à votre lecture. Votre place est conservée.")}</p>
  </section>`;
}

export function previewContent(settings, applyFocus) {
  return applyFocus(`<p>${t("Le soir venait doucement. Un livre ouvert, quelques instants pour soi, et toute une histoire à découvrir.")}</p>`, settings.mode === "focus", focusOptions(settings));
}

export function advancedReadingMarkup(settings) {
  return `<details class="advanced-reading"><summary>${t("Ajuster la mise en page et Focus")}</summary>
    <label class="setting-label" for="line-height">${t("Interligne")} <output id="line-height-value">${formatNumber(settings.lineHeight)}</output></label><input id="line-height" type="range" min="1.4" max="2.4" step="0.05" value="${settings.lineHeight}">
    <label class="setting-label" for="column-width">${t("Largeur du texte")} <output id="column-width-value">${t("{count} caractères", { count: formatNumber(settings.columnWidth) })}</output></label><input id="column-width" type="range" min="45" max="85" step="5" value="${settings.columnWidth}">
    <label class="setting-label" for="focus-intensity">${t("Intensité Focus")} <output id="focus-intensity-value">${formatNumber(settings.focusIntensity)} %</output></label><input id="focus-intensity" type="range" min="20" max="70" step="5" value="${settings.focusIntensity}">
    <label class="setting-check"><input id="skip-short-words" type="checkbox" ${settings.skipShortWords ? "checked" : ""}>${t("Épargner les mots de 1 à 3 lettres")}</label>
    <p class="setting-hint">${t("L’intensité concerne uniquement Focus. Choisissez ce mode pour comparer l’effet dans l’aperçu.")}</p>
    <button class="button secondary" data-action="reset-reading">${t("Réinitialiser le confort")}</button>
  </details>
  <label class="setting-label" for="reading-cadence">${t("Cadence du mot à mot")}</label><select id="reading-cadence"><option value="gentle" ${settings.cadence === "gentle" ? "selected" : ""}>${t("Souple · pauses de ponctuation")}</option><option value="steady" ${settings.cadence === "steady" ? "selected" : ""}>${t("Régulière")}</option></select>
  <label class="setting-check"><input id="keep-awake" type="checkbox" ${settings.wakeLock ? "checked" : ""}>${t("Garder l’écran allumé pendant le mot à mot")}</label>
  <p class="setting-hint">${t("Selon les possibilités du téléphone. Désactivé à la pause.")}</p>
  <details class="keyboard-shortcuts"><summary>${t("Raccourcis et commandes")}</summary><dl><dt>${t("Espace")}</dt><dd>${t("Démarrer / mettre en pause le mot à mot")}</dd><dt>← / →</dt><dd>${t("Chapitre précédent / suivant")}</dd><dt>${t("Échap")}</dt><dd>${t("Fermer le panneau ouvert")}</dd></dl><p class="setting-hint">${t("Les boutons restent disponibles sur écran tactile. Le mode Classique permet de parcourir le texte avec votre lecteur d’écran.")}</p></details>`;
}
