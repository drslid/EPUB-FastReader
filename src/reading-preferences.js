export const readingProfiles = {
  balanced: { fontSize: 20, font: "serif", lineHeight: 1.85, columnWidth: 70, focusIntensity: 50, skipShortWords: false },
  comfort: { fontSize: 23, font: "humanist", lineHeight: 2, columnWidth: 60, focusIntensity: 40, skipShortWords: true },
  light: { fontSize: 20, font: "sans", lineHeight: 1.8, columnWidth: 65, focusIntensity: 30, skipShortWords: true },
};

export function focusOptions(settings) {
  return { intensity: settings.focusIntensity, skipShortWords: settings.skipShortWords };
}

export function readingFont(font) {
  return font === "humanist" ? 'Verdana, "Trebuchet MS", sans-serif'
    : font === "sans" ? "Arial, Helvetica, sans-serif"
      : 'Georgia, "Times New Roman", serif';
}
