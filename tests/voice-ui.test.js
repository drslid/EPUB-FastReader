import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceUI, audioControlsMarkup, voiceErrorMessage } from "../src/voice-ui.js";
import { VOICES } from "../src/voice-assets.js";
import { setLocale, t } from "../src/i18n.js";
import voiceTranslations from "../src/locales/voice.js";

let downloads;
let ready;
let ui;
let chosen;
let activated;
let warmup;
let closed;
let manageStorage;
const field = (name) => document.querySelector(`[data-voice-${name}]`);
const settled = () => vi.waitFor(() => expect(field("list").getAttribute("aria-busy")).toBe("false"));
const selectLanguage = (value) => { field("language").value = value; field("language").dispatchEvent(new Event("change", { bubbles: true })); };

beforeEach(() => {
  setLocale("fr");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
  document.body.innerHTML = '<button id="trigger">Read aloud</button>';
  document.getElementById("trigger").focus();
  ready = new Set();
  const status = (voiceId) => ({ voiceId, ready: ready.has(voiceId), totalBytes: 117_000_000, downloadBytes: ready.has(voiceId) ? 0 : 117_000_000, bytesRemaining: ready.has(voiceId) ? 0 : 117_000_000, storedBytes: ready.has(voiceId) ? 117_000_000 : 0 });
  downloads = {
    list: vi.fn(async () => VOICES.map(({ id }) => status(id))),
    download: vi.fn(async (id) => { ready.add(id); return status(id); }),
  };
  chosen = vi.fn();
  activated = vi.fn();
  warmup = vi.fn();
  closed = vi.fn();
  manageStorage = vi.fn();
  ui = createVoiceUI({ downloads, onChoose: chosen, onActivate: activated, onReady: warmup, onClose: closed, onManageStorage: manageStorage });
});
afterEach(() => { ui?.dispose(); document.body.innerHTML = ""; setLocale("fr"); vi.restoreAllMocks(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });

describe("optional voice selection", () => {
  it("offers one current voice in each supported language and never downloads from an old preference", async () => {
    for (const [language, id] of [["fr", "piper-fr_FR-siwis-medium"], ["en", "piper-en_US-ljspeech-medium"], ["es", "piper-es_ES-davefx-medium"], ["it", "piper-it_IT-paola-medium"], ["de", "piper-de_DE-thorsten-medium"], ["pt", "piper-pt_BR-faber-medium"]]) {
      ui.open({ bookLanguage: language, lastVoiceId: "ff_siwis" });
      await settled();
      expect(document.querySelectorAll("[data-voice-choice]")).toHaveLength(1);
      expect(document.querySelector('input[name="voice-choice"]:checked').value).toBe(id);
      expect(field("start").disabled).toBe(false);
      ui.close();
    }
    expect(downloads.download).not.toHaveBeenCalled();
    expect(chosen).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
  });

  it("opens audio storage after closing the chooser without starting playback", async () => {
    ready.add("piper-fr_FR-siwis-medium");
    manageStorage.mockImplementation(() => {
      expect(document.querySelector(".voice-dialog")).toBeNull();
      expect(closed).toHaveBeenCalledWith({ reason: "storage" });
    });
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(manageStorage).not.toHaveBeenCalled();
    field("storage").click();
    expect(manageStorage).toHaveBeenCalledExactlyOnceWith();
    expect(downloads.download).not.toHaveBeenCalled();
    expect(chosen).not.toHaveBeenCalled();
    expect(activated).not.toHaveBeenCalled();
  });

  it("cancels a pending download before opening audio storage", async () => {
    let signal;
    downloads.download.mockImplementation((id, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    ui.open({ bookLanguage: "fr" });
    await settled();
    field("start").click();
    field("storage").click();
    expect(signal.aborted).toBe(true);
    expect(manageStorage).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith({ reason: "storage" });
    await Promise.resolve();
    expect(chosen).not.toHaveBeenCalled();
  });

  it("warms only a verified installed selection, once until that selection changes", async () => {
    ready.add("piper-fr_FR-siwis-medium");
    ready.add("piper-en_US-ljspeech-medium");
    let verify;
    downloads.list.mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    ui.open({ bookLanguage: "fr" });
    expect(warmup).not.toHaveBeenCalled();
    verify(VOICES.map(({ id }) => ({ voiceId: id, ready: ready.has(id) })));
    await settled();
    expect(warmup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("languagechange"));
    expect(warmup).toHaveBeenCalledTimes(1);
    selectLanguage("en");
    expect(warmup).toHaveBeenLastCalledWith(expect.objectContaining({ id: "piper-en_US-ljspeech-medium" }));
    selectLanguage("de");
    expect(warmup).toHaveBeenLastCalledWith(null);
    const count = warmup.mock.calls.length;
    window.dispatchEvent(new Event("offline"));
    expect(warmup).toHaveBeenCalledTimes(count);
    selectLanguage("fr");
    expect(warmup).toHaveBeenLastCalledWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }));
    expect(downloads.download).not.toHaveBeenCalled();
    expect(chosen).not.toHaveBeenCalled();
    expect(activated).not.toHaveBeenCalled();
    ui.close();
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(warmup).toHaveBeenCalledTimes(count + 2);
  });

  it("notifies readiness after download verification without awaiting speculative preparation", async () => {
    warmup.mockImplementation(() => new Promise(() => {}));
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(warmup).not.toHaveBeenCalled();
    field("start").click();
    await vi.waitFor(() => expect(chosen).toHaveBeenCalledTimes(1));
    expect(warmup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }));
    expect(warmup.mock.invocationCallOrder[0]).toBeLessThan(chosen.mock.invocationCallOrder[0]);
  });

  it("ignores late cache verification and a native close event from a previous dialog", async () => {
    let verify;
    downloads.list.mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    ui.open({ bookLanguage: "fr" });
    const previous = document.querySelector("dialog");
    ui.close();
    ui.open({ bookLanguage: "en" });
    await settled();
    verify([{ voiceId: "piper-fr_FR-siwis-medium", ready: true }]);
    previous.dispatchEvent(new Event("close"));
    await Promise.resolve();
    expect(document.querySelector(".voice-dialog")).not.toBeNull();
    expect(field("language").value).toBe("en");
    expect(warmup).not.toHaveBeenCalled();
  });

  it("prepares an already downloaded voice offline without unlocking or starting audio", async () => {
    ready.add("piper-fr_FR-siwis-medium");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(field("prepare").disabled).toBe(false);
    field("prepare").click();
    expect(chosen).toHaveBeenCalledWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }), { intent: "prepare" });
    expect(activated).not.toHaveBeenCalled();
    expect(downloads.download).not.toHaveBeenCalled();
  });

  it("only submits preparation after its explicit voice download succeeds", async () => {
    let complete;
    downloads.download.mockImplementation((id, { onProgress }) => new Promise(resolve => {
      onProgress({ loadedBytes: 20_000_000, totalBytes: 117_000_000 });
      complete = () => { ready.add(id); resolve(); };
    }));
    ui.open({ bookLanguage: "fr" });
    await settled();
    field("prepare").click();
    expect(field("prepare").disabled).toBe(true);
    expect(field("start").disabled).toBe(true);
    expect(chosen).not.toHaveBeenCalled();
    expect(activated).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(chosen).toHaveBeenCalledWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }), { intent: "prepare" }));
  });

  it("opens on the book language without downloading or changing it to the interface language", async () => {
    setLocale("en");
    ui.open({ bookLanguage: "fr-FR", lastVoiceId: "piper-en_US-ljspeech-medium" });
    await settled();
    expect(field("language").value).toBe("fr");
    expect(document.querySelector('input[name="voice-choice"]:checked').value).toBe("piper-fr_FR-siwis-medium");
    expect(downloads.download).not.toHaveBeenCalled();
    expect(field("size").textContent).toContain("117 MB");
    expect(field("start").textContent).toContain("Download and listen");
    expect(chosen).not.toHaveBeenCalled();
  });

  it("does not silently substitute a different language for an unsupported or unknown book", async () => {
    ui.open({ bookLanguage: "ja", lastVoiceId: "piper-fr_FR-siwis-medium" });
    await settled();
    expect(field("language").value).toBe("ja");
    expect(field("start").disabled).toBe(true);
    expect(field("empty").textContent).toContain("Aucune voix disponible");
    expect(document.querySelectorAll("[data-voice-choice]")).toHaveLength(0);
    selectLanguage("it");
    expect(field("start").disabled).toBe(false);
    expect(document.querySelector('input[name="voice-choice"]:checked').value).toBe("piper-it_IT-paola-medium");
    ui.close();
    ui.open({ bookLanguage: "" });
    await settled();
    expect(field("language").value).toBe("");
    expect(field("start").disabled).toBe(true);
    expect(field("empty").textContent).toContain("Choisissez la langue du texte");
  });

  it("disables new downloads offline while allowing a downloaded voice immediately", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    ready.add("piper-fr_FR-siwis-medium");
    ui.open({ bookLanguage: "en" });
    await settled();
    expect(field("start").disabled).toBe(true);
    expect(field("offline").textContent).toBe(t("Connexion nécessaire pour télécharger une voix."));
    selectLanguage("fr");
    expect(field("start").disabled).toBe(false);
    expect(field("start").textContent).toContain("Lancer l’écoute");
    field("start").click();
    expect(activated).toHaveBeenCalledTimes(1);
    expect(chosen).toHaveBeenCalledWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }), { intent: "listen" });
    expect(downloads.download).not.toHaveBeenCalled();
    expect(document.querySelector(".voice-dialog")).toBeNull();
  });

  it("unlocks audio in the gesture, shows measured progress and only starts after the download", async () => {
    let complete;
    downloads.download.mockImplementation((id, { onProgress }) => new Promise((resolve) => {
      expect(activated).toHaveBeenCalledTimes(1);
      onProgress({ loadedBytes: 58_500_000, totalBytes: 117_000_000, percent: 50 });
      complete = () => { ready.add(id); resolve({ voiceId: id, ready: true }); };
    }));
    ui.open({ bookLanguage: "fr" });
    await settled();
    field("start").click();
    expect(field("progress").hidden).toBe(false);
    expect(document.querySelector("progress").value).toBe(50);
    expect(field("language").disabled).toBe(true);
    expect(chosen).not.toHaveBeenCalled();
    complete();
    await vi.waitFor(() => expect(chosen).toHaveBeenCalledWith(expect.objectContaining({ id: "piper-fr_FR-siwis-medium" }), { intent: "listen" }));
    expect(document.querySelector(".voice-dialog")).toBeNull();
  });

  it("cancels an active download, keeps the dialog usable, and resumes on explicit action", async () => {
    downloads.download.mockImplementationOnce((id, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    ui.open({ bookLanguage: "fr" });
    await settled();
    field("start").click();
    field("cancel").click();
    await vi.waitFor(() => expect(field("status").textContent).toContain("Téléchargement arrêté"));
    await settled();
    expect(field("start").disabled).toBe(false);
    expect(field("start").textContent).toContain("Reprendre le téléchargement");
    expect(chosen).not.toHaveBeenCalled();
    field("start").click();
    await vi.waitFor(() => expect(chosen).toHaveBeenCalledTimes(1));
    expect(downloads.download).toHaveBeenCalledTimes(2);
  });

  it("handles storage errors and a successful retry without starting playback early", async () => {
    downloads.download.mockRejectedValueOnce({ code: "STORAGE_FULL" });
    ui.open({ bookLanguage: "es" });
    await settled();
    field("start").click();
    await vi.waitFor(() => expect(field("status").textContent).toContain("Espace insuffisant"));
    await settled();
    expect(field("status").dataset.error).toBe("true");
    expect(field("start").textContent).toContain("Réessayer");
    expect(chosen).not.toHaveBeenCalled();
    field("start").click();
    await vi.waitFor(() => expect(chosen).toHaveBeenCalledWith(expect.objectContaining({ language: "es" }), { intent: "listen" }));
  });

  it("refreshes offline availability when reopening after storage management", async () => {
    ready.add("piper-fr_FR-siwis-medium");
    ready.add("piper-en_US-ljspeech-medium");
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(field("start").textContent).toContain("Lancer l’écoute");
    field("storage").click();
    ready.delete("piper-fr_FR-siwis-medium");
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(ready.has("piper-en_US-ljspeech-medium")).toBe(true);
    expect(field("start").textContent).toContain("Télécharger et écouter");
    expect(field("ready").textContent).toBe("À télécharger");
  });

  it("shows the remaining download size and offers storage management for a partial voice", async () => {
    downloads.list.mockResolvedValueOnce(VOICES.map(({ id }) => ({ voiceId: id, ready: false, totalBytes: 117_000_000, downloadBytes: 1_000_000, bytesRemaining: 1_000_000, storedBytes: id === "piper-fr_FR-siwis-medium" ? 116_000_000 : 0 })));
    ui.open({ bookLanguage: "fr" });
    await settled();
    expect(field("size").textContent).toContain("Encore 1");
    field("storage").click();
    expect(manageStorage).toHaveBeenCalledTimes(1);
    expect(downloads.download).not.toHaveBeenCalled();
  });

  it("closes on Escape, aborts the download and restores focus without starting playback", async () => {
    let signal;
    downloads.download.mockImplementation((id, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    ui.open({ bookLanguage: "fr" });
    await settled();
    field("start").click();
    document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(signal.aborted).toBe(true);
    expect(document.querySelector(".voice-dialog")).toBeNull();
    expect(document.activeElement.id).toBe("trigger");
    await Promise.resolve();
    expect(chosen).not.toHaveBeenCalled();
  });

  it("does not let an old canceled operation overwrite a newly opened dialog", async () => {
    let fail;
    downloads.download.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = reject; }));
    ui.open({ bookLanguage: "fr" });
    await settled();
    field("start").click();
    ui.close();
    ui.open({ bookLanguage: "en" });
    await settled();
    fail({ code: "STORAGE_FULL" });
    await Promise.resolve();
    await Promise.resolve();
    expect(field("language").value).toBe("en");
    expect(field("status").textContent).toBe("");
    expect(field("start").disabled).toBe(false);
  });

  it("updates the open dialog after connectivity and interface language changes without losing focus", async () => {
    ui.open({ bookLanguage: "fr" });
    await settled();
    const language = field("language");
    language.focus();
    for (const [code, label] of [["en", "Download and listen"], ["es", "Descargar y escuchar"], ["it", "Scarica e ascolta"], ["de", "Herunterladen und anhören"], ["pt", "Descarregar e ouvir"], ["fr", "Télécharger et écouter"]]) {
      setLocale(code);
      window.dispatchEvent(new Event("languagechange"));
      expect(field("start").textContent).toContain(label);
      expect(field("storage").textContent).toContain(t("Gérer le stockage audio"));
      expect(document.activeElement).toBe(language);
    }
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(field("start").disabled).toBe(true);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(field("start").disabled).toBe(false);
  });
});

describe("voice controls and translations", () => {
  it("keeps every translated placeholder and labels all six locales", () => {
    const placeholders = (value) => [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
    for (const language of ["en", "es", "it", "de", "pt"]) {
      expect(Object.keys(voiceTranslations[language])).toEqual(Object.keys(voiceTranslations.en));
      for (const [source, translated] of Object.entries(voiceTranslations[language])) {
        expect(translated.trim()).not.toBe("");
        expect(placeholders(translated), `${language}: ${source}`).toEqual(placeholders(source));
      }
    }
    for (const [language, label] of [["fr", "Lancer l’écoute"], ["en", "Start listening"], ["es", "Empezar a escuchar"], ["it", "Avvia l’ascolto"], ["de", "Wiedergabe starten"], ["pt", "Começar a ouvir"]]) {
      setLocale(language);
      document.body.innerHTML = audioControlsMarkup({ voiceLabel: '<img src=x onerror="x">' });
      expect(document.querySelector('[data-voice-action="toggle"]').textContent).toContain(label);
      expect(document.querySelector("img")).toBeNull();
      expect(document.querySelector('[data-voice-action="previous"]').getAttribute("aria-label")).toBe(t("Phrase précédente"));
    }
  });

  it("exposes preparation, paused and completed states and clamps playback rate", () => {
    document.body.innerHTML = audioControlsMarkup({ status: "preparing", rate: 99 });
    expect(document.querySelector('[data-voice-action="toggle"]').disabled).toBe(false);
    expect(field("rate").value).toBe("1.75");
    expect(document.querySelector('[role="status"]').textContent).toContain("Préparation des phrases");
    document.body.innerHTML = audioControlsMarkup({ status: "paused" });
    expect(document.querySelector('[data-voice-action="toggle"]').textContent).toContain("Reprendre");
    document.body.innerHTML = audioControlsMarkup({ status: "ended" });
    expect(document.querySelector('[role="status"]').textContent).toBe("Écoute terminée");
  });

  it("shows real sentence and buffered audio progress without inventing a loading percentage", () => {
    document.body.innerHTML = audioControlsMarkup({ status: "loading", preparation: { phase: "loading", completed: 0, total: 6 } });
    expect(document.querySelector("progress").hasAttribute("value")).toBe(false);
    expect(document.querySelector('[role="status"]').textContent).toContain("Chargement de la voix");
    expect(document.querySelector('[role="status"]').textContent).toContain("démarre automatiquement");
    expect(document.querySelector('[data-voice-action="toggle"]').disabled).toBe(false);
    document.body.innerHTML = audioControlsMarkup({ status: "loading", preparation: { phase: "ready", completed: 1, total: 6, bufferedSeconds: 8 } });
    expect(document.querySelector("progress").value).toBe(1);
    expect(document.querySelector('[role="status"]').textContent).toContain("Démarrage de l’écoute");
    document.body.innerHTML = audioControlsMarkup({ status: "preparing", preparation: {
      phase: "generating", completed: 2, total: 6, bufferedSeconds: 12.8, engineProgress: { stage: "phonemizing" },
    } });
    expect(document.querySelector("progress").value).toBe(2);
    expect(document.querySelector("progress").max).toBe(6);
    expect(field("prepared-count").textContent).toBe("Phrases prêtes : 2/6");
    expect(field("buffered-seconds").textContent).toBe("12 s d’audio prêts");
    expect(field("preparation").getAttribute("aria-live")).toBe("off");
    expect(document.querySelector('[role="status"]').textContent).toContain("Analyse du texte");
    document.body.innerHTML = audioControlsMarkup({ status: "playing", preparation: { phase: "ready", completed: 3, total: 6, bufferedSeconds: 19 } });
    expect(field("preparation").classList.contains("is-playing")).toBe(true);
    expect(document.querySelector('[role="status"]').textContent).toBe("");
    expect(document.querySelector("progress").value).toBe(3);
  });

  it("keeps unknown progress indeterminate and avoids suggesting paused queue work is running", () => {
    document.body.innerHTML = audioControlsMarkup({ status: "buffering", preparation: { phase: "waiting", completed: 1, bufferedSeconds: 3 } });
    expect(document.querySelector("progress").hasAttribute("value")).toBe(false);
    expect(field("prepared-count").textContent).toBe("Phrases prêtes : 1");
    expect(document.querySelector('[role="status"]').textContent).toContain("reprend automatiquement");
    document.body.innerHTML = audioControlsMarkup({ status: "paused", preparation: { phase: "waiting", completed: 1, total: 4, bufferedSeconds: 3 } });
    expect(document.querySelector('[role="status"]').textContent).toBe("Lecture vocale en pause");
    document.body.innerHTML = audioControlsMarkup({ status: "buffering", prepared: true, preparationStatus: "paused" });
    expect(field("preparation")).toBeNull();
    expect(document.querySelector('[data-voice-action="queue"]')).not.toBeNull();
  });

  it("uses friendly messages without exposing provider errors", () => {
    expect(voiceErrorMessage({ code: "BROWSER_UNSUPPORTED" })).toContain("navigateur récent");
    expect(voiceErrorMessage({ code: "HTTP", message: "Internal details" })).not.toContain("Internal details");
  });
});
