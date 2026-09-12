export const readingProfiles = {
  balanced: { fontSize: 20, font: "humanist", lineHeight: 1.85, columnWidth: 70, focusIntensity: 50, skipShortWords: false },
  comfort: { fontSize: 23, font: "humanist", lineHeight: 2, columnWidth: 60, focusIntensity: 40, skipShortWords: true },
  light: { fontSize: 20, font: "sans", lineHeight: 1.8, columnWidth: 65, focusIntensity: 30, skipShortWords: true },
};

export function focusOptions(settings) {
  return { intensity: settings.focusIntensity, skipShortWords: settings.skipShortWords };
}

// System fonts keep reading available offline without downloading font files.
// Keep the existing IDs so saved libraries retain their explicit font choice.
export const readingFonts = Object.freeze({
  humanist: { label: "Verdana", family: 'Verdana, "Trebuchet MS", sans-serif' },
  sans: { label: "Arial", family: "Arial, Helvetica, sans-serif" },
  serif: { label: "Georgia", family: 'Georgia, "Times New Roman", serif' },
  palatino: { label: "Palatino", family: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif' },
  trebuchet: { label: "Trebuchet MS", family: '"Trebuchet MS", Verdana, sans-serif' },
  system: { label: "Police de l’appareil", family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
});

export function readingFont(font) {
  return readingFonts[font]?.family || readingFonts.humanist.family;
}
