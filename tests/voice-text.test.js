import { describe, expect, it, vi } from "vitest";
import { passageAtOffset, splitVoicePassage, voicePassages, VOICE_TEXT_MAXIMUM } from "../src/voice-text.js";

function expectPreserved(text, passages, maximum) {
  expect(passages.map(({ text }) => text.replace(/\s/gu, "")).join("")).toBe(text.replace(/\s/gu, ""));
  for (const [index, passage] of passages.entries()) {
    expect(passage.text).toBe(text.slice(passage.start, passage.end));
    expect(passage.text).toBe(passage.text.trim());
    expect(passage.end - passage.start).toBeLessThanOrEqual(maximum);
    if (index) expect(passage.start).toBeGreaterThanOrEqual(passages[index - 1].end);
    expect(passage.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  }
}

describe("voice passage boundaries", () => {
  it("keeps canonical UTF-16 offsets through accents, curly quotes, emoji and paragraph breaks", () => {
    const text = "  « Où est l’été ? » demanda Zoé.\n\nIl répondit : “Là-bas, près de l’océan 🌊.” Puis ils partirent ensemble…\n  Fin !  ";
    const passages = voicePassages(text, "fr", 50);
    expect(passages.length).toBeGreaterThan(2);
    expectPreserved(text, passages, 50);
    expect(passageAtOffset(passages, text.indexOf("océan"))).toBe(passages.findIndex(({ text }) => text.includes("océan")));
  });

  it.each(["fr", "en", "es", "it", "pt"])("keeps every non-space character when dividing long sentences in %s", (language) => {
    const text = "Première ligne sans pause ".repeat(15) + "! Un deuxième paragraphe avec 3,14 et 2026.\n\n" + "Dernier paragraphe ".repeat(10);
    expectPreserved(text, voicePassages(text, language, 90), 90);
  });

  it("splits exceptionally long tokens without cutting an emoji surrogate pair", () => {
    const text = "x" + "🌞".repeat(90) + "é".repeat(170);
    const passages = voicePassages(text, "fr", 40);
    expect(passages.length).toBeGreaterThan(3);
    expectPreserved(text, passages, 40);
    expect(passages.map(({ text }) => text).join("")).toBe(text);
  });

  it("falls back without losing punctuation or blank-line content when Segmenter is unavailable", () => {
    const original = Intl.Segmenter;
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      const text = "...\n\n Une première phrase ?!\n“Une autre” — sans point final\n\nFin. ";
      expectPreserved(text, voicePassages(text, "fr", 45), 45);
    } finally {
      vi.unstubAllGlobals();
      expect(Intl.Segmenter).toBe(original);
    }
  });

  it.each([undefined, null, "", " \n\t ", 123])("ignores empty or non-text input %s", (input) => {
    expect(voicePassages(input)).toEqual([]);
  });

  it("bounds requested passage size and tolerates invalid locales", () => {
    const text = "mot ".repeat(200);
    expectPreserved(text, voicePassages(text, "invalid locale", 1), 40);
    expectPreserved(text, voicePassages(text, "fr", Infinity), VOICE_TEXT_MAXIMUM);
    expectPreserved(text, voicePassages(text, "fr", NaN), VOICE_TEXT_MAXIMUM);
  });

  it("resumes at the next passage after a boundary or whitespace gap and clamps out-of-range offsets", () => {
    const passages = [{ start: 2, end: 10, text: "première" }, { start: 14, end: 22, text: "suivante" }];
    expect(passageAtOffset(passages, -10)).toBe(0);
    expect(passageAtOffset(passages, 9)).toBe(0);
    expect(passageAtOffset(passages, 10)).toBe(1);
    expect(passageAtOffset(passages, 12)).toBe(1);
    expect(passageAtOffset(passages, "15")).toBe(1);
    expect(passageAtOffset(passages, 100)).toBe(1);
    expect(passageAtOffset(passages, NaN)).toBe(0);
    expect(passageAtOffset([], 100)).toBe(0);
  });

  it("keeps a sentence beyond the former 180-character limit intact for the model's real token check", () => {
    const sentence = "Camille retrouve le plaisir de parcourir une histoire, pendant que les prochaines phrases se préparent tranquillement sur son appareil, et elle prend le temps de comprendre les personnages avant de commencer le chapitre suivant.";
    expect(sentence.length).toBeGreaterThan(180);
    const passages = voicePassages(`${sentence} Une autre phrase commence.`);
    expect(passages.map(passage => passage.text)).toEqual([sentence, "Une autre phrase commence."]);
    expectPreserved(`${sentence} Une autre phrase commence.`, passages, VOICE_TEXT_MAXIMUM);
  });

  it("keeps soft line breaks and paragraph boundaries inside an unfinished sentence", () => {
    const text = "La phrase commence ici\navec une ligne supplémentaire,\r\npuis continue\n\nmalgré les paragraphes\u2028et se termine enfin.\n\nUne nouvelle phrase.";
    const passages = voicePassages(text, "fr");
    expect(passages).toHaveLength(2);
    expect(passages[0].text).toBe(text.slice(0, text.indexOf(".\n\n") + 1));
    expect(passages[1].text).toBe("Une nouvelle phrase.");
    expectPreserved(text, passages, VOICE_TEXT_MAXIMUM);
  });

  it("keeps isolated ornamental lines separate from the neighboring spoken sentences", () => {
    const text = "***\n\nPremière phrase.\n\n...\nDeuxième phrase.\n\n???";
    const passages = voicePassages(text);
    expect(passages.map(passage => passage.text)).toEqual(["***", "Première phrase.", "...", "Deuxième phrase.", "???"]);
    expectPreserved(text, passages, VOICE_TEXT_MAXIMUM);
  });

  it.each([false, true])("handles French abbreviations, initials, decimal numbers, ellipses and quoted speech (fallback=%s)", fallback => {
    if (fallback) vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      const examples = [
        ["M. Dupont rencontre Mme. Martin. Ils saluent le Dr. Bernard.", ["M. Dupont rencontre Mme. Martin.", "Ils saluent le Dr. Bernard."]],
        ["J. R. R. Tolkien a écrit ce livre. Mme. Durand le lit.", ["J. R. R. Tolkien a écrit ce livre.", "Mme. Durand le lit."]],
        ["La valeur est 3.14 et le prix 1.000,50 €. Il arrive à 8 h 30.", ["La valeur est 3.14 et le prix 1.000,50 €.", "Il arrive à 8 h 30."]],
        ["Il hésite... puis reprend son propos… avant de partir. Ensuite, il rentre.", ["Il hésite... puis reprend son propos… avant de partir.", "Ensuite, il rentre."]],
        ["« Où vas-tu ? » demanda Léa. « Je rentre », répondit Paul.", ["« Où vas-tu ? » demanda Léa.", "« Je rentre », répondit Paul."]],
        ["« Bonne journée ! » Elle ferme la porte.", ["« Bonne journée ! »", "Elle ferme la porte."]],
        ["Le résultat est A. Il faut continuer.", ["Le résultat est A.", "Il faut continuer."]],
      ];
      for (const [text, expected] of examples) {
        const passages = voicePassages(text, "fr");
        expect(passages.map(passage => passage.text)).toEqual(expected);
        expectPreserved(text, passages, VOICE_TEXT_MAXIMUM);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("bounds very long run-on input without losing its last words", () => {
    const text = "Une phrase exceptionnellement longue sans fin ".repeat(400) + "et voici les derniers mots.";
    const passages = voicePassages(text);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.at(-1).text.endsWith("et voici les derniers mots.")).toBe(true);
    expectPreserved(text, passages, VOICE_TEXT_MAXIMUM);
  });

  it("retains combining characters and emoji clusters when dividing exceptional long tokens", () => {
    const text = "a\u0301".repeat(55) + "👩🏽‍💻".repeat(12) + "b\u0302".repeat(55);
    const passages = voicePassages(text, "fr", 40);
    expectPreserved(text, passages, 40);
    for (const part of passages) {
      expect(part.text).not.toMatch(/^\p{M}/u);
      expect(part.text.endsWith("\u200d")).toBe(false);
    }
  });
});

describe("natural splitting after the model rejects a sentence", () => {
  it("prefers a complete clause and preserves absolute offsets", () => {
    const text = "Le lecteur poursuit tranquillement sa phrase, puis prend le temps de comprendre chaque mot.";
    const parts = splitVoicePassage({ start: 52, end: 52 + text.length, text });
    expect(parts.map(part => part.text)).toEqual(["Le lecteur poursuit tranquillement sa phrase,", "puis prend le temps de comprendre chaque mot."]);
    for (const part of parts) expect(part.text).toBe(text.slice(part.start - 52, part.end - 52));
    expect(parts[0].start).toBe(52);
    expect(parts.at(-1).end).toBe(52 + text.length);
  });

  it.each([",", ";", ":", " —"])("chooses the %s clause pause before a nearby internal word boundary", punctuation => {
    const text = `Nous suivons le fil du récit${punctuation} puis nous découvrons ensemble la suite de cette histoire`;
    const parts = splitVoicePassage({ text, start: 0 });
    expect(parts[0].text).toBe(`Nous suivons le fil du récit${punctuation}`);
    expectPreserved(text, parts, text.length);
  });

  it("never breaks a decimal number or time at its comma or colon", () => {
    const text = "Nous observons ici la valeur 123,456 et nous partons vers 12:30 demain matin.";
    const parts = splitVoicePassage({ text, start: 0 });
    expectPreserved(text, parts, text.length);
    expect(parts.some(part => part.text.includes("123,456"))).toBe(true);
    expect(parts.some(part => part.text.includes("12:30"))).toBe(true);
  });

  it("falls back to word boundaries and then intact graphemes for a long single token", () => {
    for (const text of ["un très long groupe de mots sans aucun signe de ponctuation", "é\u0301".repeat(70) + "🌞".repeat(3) + "ç".repeat(40)]) {
      const parts = splitVoicePassage({ text, start: 0 });
      expect(parts).toHaveLength(2);
      expectPreserved(text, parts, text.length);
      expect(parts[1].text).not.toMatch(/^\p{M}/u);
    }
  });

  it.each([undefined, {}, { text: "" }, { text: "a" }, { text: "... ?!" }])("reports unsplittable input %s without inventing or dropping words", input => {
    expect(splitVoicePassage(input)).toEqual([]);
  });
});
