import { focusOptions } from "../reading-preferences.js";

export function readingPreferencesMarkup(settings, { applyFocus }) {
  return `<section class="reading-preview-section" aria-labelledby="preview-heading">
    <label class="setting-label" for="reading-profile">Confort de lecture</label>
    <select id="reading-profile">${[["balanced", "Équilibré"], ["comfort", "Confort"], ["light", "Focus léger"], ["custom", "Personnalisé"]].map(([value, label]) => `<option value="${value}" ${settings.profile === value ? "selected" : ""}>${label}</option>`).join("")}</select>
    <h3 id="preview-heading">Aperçu immédiat</h3>
    <div id="reading-preview" class="reading-preview" tabindex="0" role="region" aria-labelledby="preview-heading" data-focus="${settings.mode === "focus"}">${previewContent(settings, applyFocus)}</div>
    <p class="setting-hint">Vos réglages s’appliquent à cet extrait et à votre lecture. Votre place est conservée.</p>
  </section>`;
}

export function previewContent(settings, applyFocus) {
  return applyFocus("<p>Le soir venait doucement. Un livre ouvert, quelques instants pour soi, et toute une histoire à découvrir.</p>", settings.mode === "focus", focusOptions(settings));
}

export function advancedReadingMarkup(settings) {
  return `<details class="advanced-reading"><summary>Ajuster la mise en page et Focus</summary>
    <label class="setting-label" for="line-height">Interligne <output id="line-height-value">${settings.lineHeight}</output></label><input id="line-height" type="range" min="1.4" max="2.4" step="0.05" value="${settings.lineHeight}">
    <label class="setting-label" for="column-width">Largeur du texte <output id="column-width-value">${settings.columnWidth} caractères</output></label><input id="column-width" type="range" min="45" max="85" step="5" value="${settings.columnWidth}">
    <label class="setting-label" for="focus-intensity">Intensité Focus <output id="focus-intensity-value">${settings.focusIntensity} %</output></label><input id="focus-intensity" type="range" min="20" max="70" step="5" value="${settings.focusIntensity}">
    <label class="setting-check"><input id="skip-short-words" type="checkbox" ${settings.skipShortWords ? "checked" : ""}>Épargner les mots de 1 à 3 lettres</label>
    <p class="setting-hint">L’intensité concerne uniquement Focus. Choisissez ce mode pour comparer l’effet dans l’aperçu.</p>
    <button class="button secondary" data-action="reset-reading">Réinitialiser le confort</button>
  </details>
  <label class="setting-label" for="reading-cadence">Cadence du mot à mot</label><select id="reading-cadence"><option value="gentle" ${settings.cadence === "gentle" ? "selected" : ""}>Souple · pauses de ponctuation</option><option value="steady" ${settings.cadence === "steady" ? "selected" : ""}>Régulière</option></select>
  <label class="setting-check"><input id="keep-awake" type="checkbox" ${settings.wakeLock ? "checked" : ""}>Garder l’écran allumé pendant le mot à mot</label>
  <p class="setting-hint">Selon les possibilités du téléphone. Désactivé à la pause.</p>
  <details class="keyboard-shortcuts"><summary>Raccourcis et commandes</summary><dl><dt>Espace</dt><dd>Démarrer / mettre en pause le mot à mot</dd><dt>← / →</dt><dd>Chapitre précédent / suivant</dd><dt>Échap</dt><dd>Fermer le panneau ouvert</dd></dl><p class="setting-hint">Les boutons restent disponibles sur écran tactile. Le mode Classique permet de parcourir le texte avec votre lecteur d’écran.</p></details>`;
}
