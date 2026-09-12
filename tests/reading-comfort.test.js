import { describe, expect, it, vi } from "vitest";
import { createReadingWakeLock, previousSentenceIndex, wordDuration } from "../src/reading-comfort.js";

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
    const words = "La mer brillait. Une nouvelle phrase. Puis la nuit.".split(" ");
    expect(previousSentenceIndex(words, 5)).toBe(3);
    expect(previousSentenceIndex(words, 3)).toBe(0);
    expect(previousSentenceIndex(words, 8)).toBe(6);
    expect(previousSentenceIndex(words, 0)).toBe(0);
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
