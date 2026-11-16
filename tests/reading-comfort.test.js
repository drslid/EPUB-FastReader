import { describe, expect, it, vi } from "vitest";
import { createReadingWakeLock, wordDuration } from "../src/reading-comfort.js";
import { readingUnits, readingUnitAtOffset, previousReadingSentence } from "../src/reading-units.js";
import { offsetForLocator, offsetForWord } from "../src/reading-location.js";

describe("cadence et retour à la phrase", () => {
  it("laisse davantage de temps aux ponctuations et mots longs, aussi avant un guillemet", () => {
    expect(wordDuration("mot", 300)).toBe(200);
    expect(wordDuration("mot,", 300)).toBeGreaterThan(wordDuration("mot", 300));
    expect(wordDuration("mot.»", 300)).toBeGreaterThan(wordDuration("mot,", 300));
    expect(wordDuration("anticonstitutionnellement", 300)).toBeGreaterThan(wordDuration("mot", 300));
    expect(wordDuration("mot!", 300, "steady")).toBe(200);
    expect(wordDuration("mot", 800)).toBeLessThan(wordDuration("mot", 100));
  });
  it("retourne au début de la phrase puis à la précédente sans sortir du chapitre", () => {
    const units = readingUnits("La mer brillait. Une nouvelle phrase. Puis la nuit.", "fr");
    expect(previousReadingSentence(units, 5)).toBe(3);
    expect(previousReadingSentence(units, 3)).toBe(0);
    expect(previousReadingSentence(units, 8)).toBe(6);
    expect(previousReadingSentence(units, 0)).toBe(0);
  });
  it.each([
    ["en-GB", "Dr. Smith can’t re-enter. They stopped.", ["can’t", "re-enter."], ["re-enter.", "stopped."]],
    ["spa", "La Dra. Ruiz preguntó: ¿ Qué tal ? ¡ Bien ! Luego salió.", ["¿Qué", "tal?", "¡Bien!"], ["tal?", "¡Bien!", "salió."]],
    ["fr", "M. Dupont dit : « L’homme arrive ! » Puis il repart.", ["«L’homme", "arrive!»"], ["arrive!»", "repart."]],
    ["it", "La dott.ssa Rossi vide l’acqua. Poi uscì.", ["dott.ssa", "l’acqua."], ["l’acqua.", "uscì."]],
    ["de", "Dr. Weber nennt z. B. die Donaudampfschifffahrt. Er erklärt.", ["z.", "B."], ["Donaudampfschifffahrt.", "erklärt."]],
    ["pt-BR", "A Dra. Silva viu um guarda-chuva de 3,14 euros. Depois saiu.", ["guarda-chuva", "3,14"], ["euros.", "saiu."]],
  ])("adapts %s punctuation and sentence boundaries to the book", (language, text, words, endings) => {
    const units = readingUnits(text, language);
    expect(units.map(unit => unit.text)).toEqual(expect.arrayContaining(words));
    expect(units.filter(unit => unit.endsSentence).map(unit => unit.text)).toEqual(endings);
  });
  it("uses the same canonical position for both a legacy index and a split word locator", () => {
    const text = "  One—two. Visit https://example.org/one—two. ";
    const units = readingUnits(text, "en");
    expect(units.map(unit => unit.text)).toEqual(["One—", "two.", "Visit", "https://example.org/one—two."]);
    expect(units.slice(0, 2).map(unit => unit.sourceIndex)).toEqual([0, 0]);
    expect(readingUnitAtOffset(units, offsetForWord(text, 0))).toBe(0);
    const locator = { exact: "two. Visit", textOffset: 0, prefix: "  One—" };
    expect(readingUnitAtOffset(units, offsetForLocator(text, locator))).toBe(1);
    expect(wordDuration("Dr.", 300, "gentle", false)).toBe(200);
  });
});

describe("écran allumé uniquement pendant la lecture", () => {
  it("libère un verrou reçu après une pause et ne l’affiche jamais actif", async () => {
    let resolve;
    const request = vi.fn(() => new Promise((done) => { resolve = done; }));
    const onChange = vi.fn();
    const controller = createReadingWakeLock({ navigator: { wakeLock: { request } }, isVisible: () => true, onChange });
    const pending = controller.setActive(true);
    await controller.setActive(false);
    const lock = { release: vi.fn().mockResolvedValue(), addEventListener: vi.fn() };
    resolve(lock);
    await pending;
    expect(lock.release).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalledWith(true);
  });
  it("supporte les refus système et libère à la pause sans requêtes répétées", async () => {
    const lock = { release: vi.fn().mockResolvedValue(), addEventListener: vi.fn() };
    const request = vi.fn().mockRejectedValueOnce(new Error("Battery low")).mockResolvedValue(lock);
    const controller = createReadingWakeLock({ navigator: { wakeLock: { request } }, isVisible: () => true });
    await expect(controller.setActive(true)).resolves.toBeUndefined();
    await controller.setActive(true);
    await controller.setActive(true);
    expect(request).toHaveBeenCalledTimes(2);
    await controller.setActive(false);
    expect(lock.release).toHaveBeenCalledOnce();
  });
  it("ignore le refus tardif d’une ancienne session quand une nouvelle session a son verrou", async () => {
    let rejectFirst;
    const lock = { release: vi.fn().mockResolvedValue(), addEventListener: vi.fn() };
    const request = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; })).mockResolvedValue(lock);
    const onChange = vi.fn();
    const controller = createReadingWakeLock({ navigator: { wakeLock: { request } }, isVisible: () => true, onChange });
    const first = controller.setActive(true);
    await controller.setActive(false);
    await controller.setActive(true);
    rejectFirst(new Error("Ancienne session annulée"));
    await first;
    expect(onChange).toHaveBeenLastCalledWith(true);
    await controller.setActive(false);
    expect(lock.release).toHaveBeenCalledOnce();
  });
  it("n’acquiert aucun verrou sans API ou quand l’onglet est masqué", async () => {
    const request = vi.fn();
    const controller = createReadingWakeLock({ navigator: { wakeLock: { request } }, isVisible: () => false });
    await controller.setActive(true);
    expect(request).not.toHaveBeenCalled();
    await expect(createReadingWakeLock({ navigator: {}, isVisible: () => true }).setActive(true)).resolves.toBeUndefined();
  });
});
