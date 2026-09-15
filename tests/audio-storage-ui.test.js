import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioStorageUI } from "../src/audio-storage-ui.js";
import translations from "../src/locales/audio-storage.js";
import { setLocale, t } from "../src/i18n.js";

let ui, state, callbacks;
const action = (name, id) => [...document.querySelectorAll(`[data-storage-action="${name}"]`)].find(button => id === undefined || button.dataset.storageId === id);
const settled = async () => { await vi.waitFor(() => expect(document.querySelector(".audio-storage-dialog").getAttribute("aria-busy")).toBe("false")); };
const recalculate = () => { state.totalBytes = state.books.reduce((sum, book) => sum + book.bytes, 0) + state.voices.reduce((sum, voice) => sum + voice.bytes, 0) + state.sharedBytes + state.unusedBytes; };
const confirm = async () => { action("confirm").click(); await settled(); };

beforeEach(() => {
  setLocale("fr");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
  document.body.innerHTML = '<button id="storage-trigger">Audio</button>';
  document.querySelector("#storage-trigger").focus();
  state = {
    books: [{ id: "alice", title: "Alice au pays des merveilles — édition intégrale", bytes: 120_000_000 }, { id: "oliver", title: "Oliver Twist", bytes: 60_000_000 }],
    voices: [{ id: "siwis", name: "Siwis", language: "fr", bytes: 63_000_000 }, { id: "paola", name: "Paola", language: "it", bytes: 63_000_000 }],
    sharedBytes: 30_000_000, unusedBytes: 117_000_000,
  };
  recalculate();
  callbacks = {
    load: vi.fn(async () => structuredClone(state)),
    removeBook: vi.fn(async id => { state.books = state.books.filter(book => book.id !== id); recalculate(); }),
    removeVoice: vi.fn(async id => { state.voices = state.voices.filter(voice => voice.id !== id); recalculate(); }),
    clearAudio: vi.fn(async () => { state.books = []; recalculate(); }),
    clearAll: vi.fn(async () => { state.books = []; state.voices = []; state.sharedBytes = 0; state.unusedBytes = 0; recalculate(); }),
    cleanup: vi.fn(async () => { state.unusedBytes = 0; recalculate(); }),
  };
  ui = createAudioStorageUI(callbacks);
});

afterEach(() => { ui?.dispose(); setLocale("fr"); document.body.innerHTML = ""; delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });

describe("audio storage management", () => {
  it("shows the measured total, complete book titles, voice languages and unused files without engine details", async () => {
    await ui.open();
    expect(document.querySelector("[data-storage-total]").textContent).toBe("453 Mo utilisés");
    expect(document.querySelector('[data-storage-book="alice"] h4').textContent).toBe(state.books[0].title);
    expect(document.querySelector('[data-storage-voice="paola"]').textContent).toContain("italien · 63 Mo");
    expect(action("cleanup").textContent).toBe("Nettoyer 117 Mo");
    expect(document.querySelector(".audio-storage-dialog").textContent).not.toMatch(/moteur|Kokoro|Piper|environ|engine/i);
    expect(callbacks.load).toHaveBeenCalledOnce();
    for (const operation of ["removeBook", "removeVoice", "clearAudio", "clearAll", "cleanup"]) expect(callbacks[operation]).not.toHaveBeenCalled();
  });

  it("requires a named book confirmation and cancellation restores its delete button without mutation", async () => {
    await ui.open();
    action("book", "alice").click();
    expect(document.querySelector("[data-storage-confirmation]").textContent).toContain(state.books[0].title);
    expect(document.activeElement).toBe(action("cancel"));
    action("cancel").click();
    expect(document.querySelector("[data-storage-confirmation]")).toBeNull();
    expect(document.activeElement).toBe(action("book", "alice"));
    expect(callbacks.removeBook).not.toHaveBeenCalled();
  });

  it("deletes just the selected book audio and refreshes all reported sizes", async () => {
    await ui.open(); action("book", "alice").click(); await confirm();
    expect(callbacks.removeBook).toHaveBeenCalledExactlyOnceWith("alice");
    expect(document.querySelectorAll("[data-storage-book]")).toHaveLength(1);
    expect(document.querySelector("[data-storage-total]").textContent).toBe("333 Mo utilisés");
    expect(document.querySelectorAll("[data-storage-voice]")).toHaveLength(2);
    expect(document.querySelector("[data-storage-notice]").textContent).toBe("Espace libéré.");
    expect(document.activeElement).toBe(action("close"));
  });

  it("explains re-downloading a removed voice and preserves prepared books", async () => {
    await ui.open(); action("voice", "paola").click();
    expect(document.querySelector("[data-storage-confirmation]").textContent).toContain("Supprimer la voix Paola");
    expect(document.querySelector("[data-storage-confirmation]").textContent).toContain("télécharger cette voix à nouveau");
    await confirm();
    expect(callbacks.removeVoice).toHaveBeenCalledExactlyOnceWith("paola");
    expect(document.querySelectorAll("[data-storage-book]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-storage-voice]")).toHaveLength(1);
  });

  it("distinguishes clearing all audio from freeing voices and every audio file", async () => {
    await ui.open(); action("audio").click();
    expect(document.querySelector("[data-storage-confirmation]").textContent).toContain("Les voix téléchargées seront conservées");
    await confirm();
    expect(callbacks.clearAudio).toHaveBeenCalledOnce();
    expect(callbacks.clearAll).not.toHaveBeenCalled();
    expect(action("audio").disabled).toBe(true);
    expect(document.querySelectorAll("[data-storage-voice]")).toHaveLength(2);
    action("all").click();
    expect(document.querySelector("[data-storage-confirmation]").textContent).toContain("tous les audios et les voix téléchargées");
    await confirm();
    expect(callbacks.clearAll).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-storage-total]").textContent).toBe("0 Mo utilisés");
    expect(action("all").disabled).toBe(true);
    expect(action("cleanup")).toBeUndefined();
  });

  it("cleans only unused files after confirmation", async () => {
    await ui.open(); action("cleanup").click(); await confirm();
    expect(callbacks.cleanup).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-storage-total]").textContent).toBe("336 Mo utilisés");
    expect(document.querySelectorAll("[data-storage-book]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-storage-voice]")).toHaveLength(2);
    expect(action("cleanup")).toBeUndefined();
  });

  it("allows only one destructive operation and keeps the view open until it finishes", async () => {
    let finish;
    callbacks.clearAll.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await ui.open(); action("all").click(); action("confirm").click();
    action("confirm").click(); action("voice", "siwis").click(); action("close").click();
    document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    ui.close();
    expect(document.querySelector("dialog").open).toBe(true);
    expect(callbacks.clearAll).toHaveBeenCalledOnce();
    expect(callbacks.removeVoice).not.toHaveBeenCalled();
    expect(action("close").disabled).toBe(true);
    finish(); await settled();
    action("close").click();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement.id).toBe("storage-trigger");
  });

  it("refreshes partial deletion failures and retries only after renewed confirmation", async () => {
    callbacks.clearAll.mockImplementationOnce(async () => { state.books = []; recalculate(); throw new Error("voice cache unavailable"); });
    await ui.open(); action("all").click(); await confirm();
    expect(document.querySelectorAll("[data-storage-book]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-storage-voice]")).toHaveLength(2);
    expect(document.querySelector("[data-storage-total]").textContent).toBe("273 Mo utilisés");
    expect(document.querySelector("[data-storage-notice]").dataset.error).toBe("true");
    expect(document.querySelector("[data-storage-notice]").textContent).toContain("vous pouvez réessayer");
    expect(document.activeElement).toBe(action("cancel"));
    await confirm();
    expect(callbacks.clearAll).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-storage-notice]").dataset.error).toBe("false");
    expect(document.querySelector("[data-storage-total]").textContent).toBe("0 Mo utilisés");
  });

  it("does not keep a stale row confirmation when a failed operation already removed that row", async () => {
    callbacks.removeBook.mockImplementationOnce(async id => { state.books = state.books.filter(book => book.id !== id); recalculate(); throw new Error("late failure"); });
    await ui.open(); action("book", "alice").click(); await confirm();
    expect(document.querySelector('[data-storage-book="alice"]')).toBeNull();
    expect(document.querySelector("[data-storage-confirmation]")).toBeNull();
    expect(document.activeElement).toBe(action("close"));
  });

  it("disables deletion after an unsuccessful refresh and allows a safe read retry", async () => {
    await ui.open();
    callbacks.load.mockRejectedValueOnce(new Error("database blocked"));
    action("book", "alice").click(); await confirm();
    expect(document.querySelector("[data-storage-notice]").textContent).toContain("Suppression terminée");
    expect(document.querySelector("[data-storage-content]").hidden).toBe(true);
    expect(action("reload").disabled).toBe(false);
    action("reload").click(); await settled();
    expect(document.querySelector("[data-storage-content]").hidden).toBe(false);
    expect(document.querySelectorAll("[data-storage-book]")).toHaveLength(1);
    expect(callbacks.removeBook).toHaveBeenCalledOnce();
  });

  it("shows a retryable load error without presenting a false empty library", async () => {
    callbacks.load.mockRejectedValueOnce(new Error("storage unavailable"));
    await ui.open();
    expect(document.querySelector("[data-storage-total]").textContent).toBe("");
    expect(document.querySelector("[data-storage-content]").hidden).toBe(true);
    expect(action("reload").disabled).toBe(false);
    action("reload").click(); await settled();
    expect(document.querySelector("[data-storage-total]").textContent).toBe("453 Mo utilisés");
  });

  it("lets users close during a read and ignores stale results from that dialog", async () => {
    let finish;
    callbacks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const opening = ui.open({ bookId: "alice" });
    action("close").click();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement.id).toBe("storage-trigger");
    await ui.open({ voiceId: "paola" });
    finish({ books: [], voices: [], totalBytes: 0 }); await opening;
    expect(document.querySelectorAll("[data-storage-book]")).toHaveLength(2);
    expect(document.activeElement).toBe(action("voice", "paola"));
  });

  it("uses Escape to dismiss a confirmation first and then returns focus to the trigger", async () => {
    await ui.open(); action("book", "alice").click();
    document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(document.querySelector("dialog").open).toBe(true);
    expect(document.activeElement).toBe(action("book", "alice"));
    document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement.id).toBe("storage-trigger");
  });

  it("can focus the requested book or voice and escapes titles in text and accessible labels", async () => {
    state.books[0].title = '<img src=x onerror="fail()"> & "Alice"';
    await ui.open({ bookId: "alice" });
    expect(document.activeElement).toBe(action("book", "alice"));
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(action("book", "alice").getAttribute("aria-label")).toBe(`Supprimer l’audio de ${state.books[0].title}`);
    action("book", "alice").click();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    ui.close(); await ui.open({ voiceId: "paola" });
    expect(document.activeElement).toBe(action("voice", "paola"));
  });

  it("translates every panel and confirmation string in six languages while keeping focus in the same control", async () => {
    await ui.open(); action("voice", "siwis").click();
    for (const language of ["fr", "en", "es", "it", "de", "pt"]) {
      setLocale(language); window.dispatchEvent(new Event("languagechange"));
      expect(document.querySelector("#audio-storage-title").textContent).toBe(t("Stockage audio"));
      expect(action("all").textContent).toBe(t("Tout libérer"));
      expect(document.activeElement).toBe(action("cancel"));
      expect(document.querySelector("[data-storage-confirmation]").textContent).toContain(t("Supprimer la voix {name} ? Les audios déjà préparés restent disponibles. Il faudra télécharger cette voix à nouveau pour préparer d’autres livres.", { name: "Siwis" }));
      if (language !== "fr") for (const [source, translation] of Object.entries(translations[language])) {
        expect(translation, `${language}: ${source}`).toBeTruthy();
        expect(t(source)).toBe(translation);
        expect([...translation.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()).toEqual([...source.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort());
      }
    }
  });
});
