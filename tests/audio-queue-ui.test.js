import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioQueueErrorMessage, audioQueueJobMarkup, canListenToAudioJob, createAudioQueueUI } from "../src/audio-queue-ui.js";
import { audioControlsMarkup } from "../src/voice-ui.js";
import translations from "../src/locales/audio-queue.js";
import { setLocale, t } from "../src/i18n.js";

const makeJob = (id, status = "queued") => ({ id, bookId: id, title: `Book ${id}`, voice: { id: "ff_siwis", name: "Siwis" }, status, progress: .25, completedSegments: 5, totalSegments: 20, completedChapters: 1, totalChapters: 4, audioBytes: 5_000_000 });
let queue, ui, snapshot, onListen, onBrowse, changed, originalScrollIntoView;
const settled = () => vi.waitFor(() => expect(document.querySelector("[data-audio-queue-list]").getAttribute("aria-busy")).toBe("false"));
const action = (id, verb) => document.querySelector(`[data-audio-job="${id}"] [data-audio-queue-action="${verb}"]`);
beforeEach(() => {
  setLocale("fr");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
  originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  document.body.innerHTML = '<button id="queue-trigger">Audio</button>';
  document.getElementById("queue-trigger").focus();
  snapshot = { jobs: [], activeJobId: null, suspended: [] };
  queue = {
    snapshot: vi.fn(() => snapshot), list: vi.fn(async () => snapshot),
    subscribe: vi.fn(listener => { changed = listener; return vi.fn(); }),
    pause: vi.fn(async id => { snapshot.jobs.find(job => job.id === id).status = "paused"; changed(snapshot); }),
    resume: vi.fn(async id => { snapshot.jobs.find(job => job.id === id).status = "queued"; changed(snapshot); }),
    cancel: vi.fn(async id => { snapshot.jobs = snapshot.jobs.filter(job => job.id !== id); changed(snapshot); }),
    remove: vi.fn(async id => { snapshot.jobs = snapshot.jobs.filter(job => job.id !== id); changed(snapshot); }),
  };
  onListen = vi.fn();
  onBrowse = vi.fn();
  ui = createAudioQueueUI({ queue, onListen, onBrowse });
});
afterEach(() => {
  ui.dispose(); setLocale("fr"); document.body.innerHTML = "";
  delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close;
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else delete Element.prototype.scrollIntoView;
});

describe("local audio queue dialog", () => {
  it("does not let a delayed native close event dismiss a newly reopened queue", async () => {
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
    snapshot.jobs = [makeJob("a"), makeJob("b")];
    ui.open({ bookId: "a" });
    await settled();
    const previousDialog = document.querySelector("dialog");
    ui.close();
    ui.open({ bookId: "b" });
    await settled();
    previousDialog.dispatchEvent(new Event("close"));
    expect(document.querySelector("dialog").open).toBe(true);
    expect(document.activeElement).toBe(action("b", "listen"));
  });

  it("highlights every preparation for the requested book while keeping the whole queue visible", async () => {
    snapshot.jobs = [makeJob("a", "preparing"), makeJob("b", "ready"), { ...makeJob("b-second"), bookId: "b" }];
    ui.open({ bookId: "b" });
    await settled();
    expect(document.querySelectorAll(".audio-queue-job")).toHaveLength(3);
    expect(document.querySelectorAll(".audio-queue-job.is-current-book")).toHaveLength(2);
    expect(document.activeElement).toBe(action("b", "listen"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(queue.pause).not.toHaveBeenCalled();
    snapshot.jobs[1].audioBytes += 100;
    changed(snapshot);
    expect(document.activeElement).toBe(action("b", "listen"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("focuses the status before audio is ready and can target another book in an open dialog", async () => {
    snapshot.jobs = [{ ...makeJob("a", "preparing"), canListen: false }, { ...makeJob("b", "paused"), canListen: false }];
    ui.open({ bookId: "a" });
    await settled();
    const status = document.querySelector('[data-audio-job="a"] .audio-job-status');
    expect(document.activeElement).toBe(status);
    expect(status.textContent).toContain("Book a");
    expect(status.textContent).toContain("Préparation en cours");
    changed(snapshot);
    expect(document.activeElement.matches('.audio-job-status')).toBe(true);
    ui.open({ bookId: "b" });
    expect(document.activeElement).toBe(action("b", "resume"));
    expect(document.querySelector('[data-audio-job="a"]').classList.contains("is-current-book")).toBe(false);
    ui.open();
    expect(document.querySelectorAll(".is-current-book")).toHaveLength(0);
    expect(document.activeElement).toBe(document.querySelector("[data-audio-queue-close]"));
  });

  it("focuses a matching preparation persisted after opening, unless the user already moved elsewhere", async () => {
    ui.open({ bookId: "late" });
    await settled();
    snapshot.jobs = [{ ...makeJob("late", "preparing"), canListen: false }];
    changed(snapshot);
    expect(document.activeElement).toBe(document.querySelector('[data-audio-job="late"] .audio-job-status'));
    ui.close();
    snapshot.jobs = [];
    ui.open({ bookId: "another" });
    await settled();
    const browse = document.querySelector("[data-audio-queue-browse]");
    browse.focus();
    browse.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    snapshot.jobs = [makeJob("another", "preparing")];
    changed(snapshot);
    expect(document.activeElement).toBe(browse);
    expect(document.querySelector('[data-audio-job="another"]').classList.contains("is-current-book")).toBe(true);
  });

  it("offers another voice only with a callback, closes the queue, and preserves existing preparation", async () => {
    const job = makeJob("a", "preparing");
    snapshot.jobs = [job];
    ui.open({ bookId: "a" });
    await settled();
    expect(action("a", "choose-voice")).toBeNull();
    ui.dispose();
    const onChooseVoice = vi.fn();
    ui = createAudioQueueUI({ queue, onChooseVoice });
    ui.open({ bookId: "a" });
    await settled();
    expect(action("a", "choose-voice").textContent).toContain("Préparer avec une autre voix");
    action("a", "choose-voice").click();
    expect(document.querySelector("dialog")).toBeNull();
    expect(onChooseVoice).toHaveBeenCalledWith(job);
    expect(snapshot.jobs).toEqual([job]);
    expect(queue.pause).not.toHaveBeenCalled();
    expect(queue.cancel).not.toHaveBeenCalled();
    expect(queue.remove).not.toHaveBeenCalled();
  });

  it("recovers if opening another voice fails without removing the saved audio", async () => {
    const job = makeJob("a", "ready");
    snapshot.jobs = [job];
    ui.dispose();
    ui = createAudioQueueUI({ queue, onChooseVoice: vi.fn().mockRejectedValue(new Error("missing book")) });
    ui.open({ bookId: "a" });
    await settled();
    action("a", "choose-voice").click();
    await vi.waitFor(() => expect(document.querySelector("[data-audio-queue-notice]")?.textContent).toContain("Réessayez"));
    expect(document.querySelector('[data-audio-job="a"]').classList.contains("is-current-book")).toBe(true);
    expect(queue.remove).not.toHaveBeenCalled();
  });

  it("lets the user browse more books while keeping preparation running", async () => {
    snapshot.jobs = [makeJob("first", "preparing")];
    ui.open();
    await settled();
    expect(document.querySelector(".audio-queue-browse").textContent).toContain("La préparation continue si vous fermez");
    document.querySelector("[data-audio-queue-browse]").click();
    expect(document.querySelector("dialog")).toBeNull();
    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(queue.pause).not.toHaveBeenCalled();
    expect(queue.cancel).not.toHaveBeenCalled();
    expect(snapshot.jobs[0].status).toBe("preparing");
  });

  it("offers partial listening only once the contiguous beginning is ready", async () => {
    const job = { ...makeJob("first", "preparing"), canListen: false, readySegments: 0 };
    snapshot.jobs = [job];
    ui.open();
    await settled();
    expect(action("first", "listen")).toBeNull();
    job.canListen = true;
    job.readySegments = 1;
    changed(snapshot);
    expect(action("first", "listen").textContent).toContain("Écouter le début");
    expect(action("first", "pause")).not.toBeNull();
    expect(action("first", "cancel")).not.toBeNull();
    expect(document.querySelector(".audio-job-partial").textContent).toContain("Une attente est possible");
    action("first", "listen").click();
    expect(onListen).toHaveBeenCalledWith(job, { fromStart: true });
    expect(queue.pause).not.toHaveBeenCalled();
  });

  it("keeps partial listening available for paused or interrupted preparations", () => {
    for (const status of ["queued", "preparing", "paused", "error"]) {
      const job = { ...makeJob("first", status), canListen: true, readySegments: 1 };
      document.body.innerHTML = audioQueueJobMarkup(job);
      expect(action("first", "listen")).not.toBeNull();
      expect(action("first", "cancel")).not.toBeNull();
      if (["paused", "error"].includes(status)) expect(action("first", "resume")).not.toBeNull();
    }
    expect(canListenToAudioJob({ completedSegments: 3 })).toBe(true);
    expect(canListenToAudioJob({ completedSegments: 3, readySegments: 0 })).toBe(false);
    expect(canListenToAudioJob({ completedSegments: 3, canListen: false })).toBe(false);
  });

  it("explains foreground preparation and starts nothing when empty", async () => {
    ui.open();
    await settled();
    expect(document.querySelector("[data-audio-queue-empty]").hidden).toBe(false);
    expect(document.querySelector("dialog").textContent).toContain("Après fermeture, relancez-la ici");
    expect(queue.resume).not.toHaveBeenCalled();
    expect(onListen).not.toHaveBeenCalled();
    ui.close();
    expect(document.activeElement.id).toBe("queue-trigger");
    expect(queue.pause).not.toHaveBeenCalled();
  });

  it("shows measured progress, storage and ready playback independently", async () => {
    snapshot.jobs = [makeJob("active", "preparing"), { ...makeJob("next"), readySegments: 0 }, makeJob("ready", "ready")];
    ui.open();
    await settled();
    expect(document.querySelector('[data-audio-job="active"] progress').value).toBe(25);
    expect(document.querySelector('[data-audio-job="active"]').textContent).toContain("5 sur 20 passages");
    expect(document.querySelector('[data-audio-job="active"]').textContent).toContain("Audio conservé");
    expect(action("active", "listen").textContent).toContain("Écouter le début");
    expect(action("next", "listen")).toBeNull();
    action("ready", "listen").click();
    expect(onListen).toHaveBeenCalledWith(expect.objectContaining({ id: "ready", status: "ready" }), { fromStart: false });
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("pauses, resumes and removes only the chosen job, preserving focus on progress updates", async () => {
    snapshot.jobs = [makeJob("a", "preparing"), makeJob("b", "ready")];
    ui.open();
    await settled();
    action("a", "pause").focus();
    snapshot.jobs[0].progress = .4;
    changed(snapshot);
    expect(document.activeElement).toBe(action("a", "pause"));
    action("a", "pause").click();
    await vi.waitFor(() => expect(action("a", "resume")).not.toBeNull());
    expect(queue.pause).toHaveBeenCalledWith("a");
    expect(document.activeElement).toBe(action("a", "resume"));
    action("a", "resume").click();
    await vi.waitFor(() => expect(queue.resume).toHaveBeenCalledWith("a"));
    action("b", "remove").click();
    await vi.waitFor(() => expect(document.querySelector('[data-audio-job="b"]')).toBeNull());
    expect(queue.remove).toHaveBeenCalledWith("b");
    expect(document.querySelector('[data-audio-job="a"]')).not.toBeNull();
  });

  it("blocks duplicate actions while persisting and recovers from an action failure", async () => {
    snapshot.jobs = [makeJob("a", "paused")];
    let reject;
    queue.resume.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail; }));
    ui.open();
    await settled();
    action("a", "resume").click();
    expect(action("a", "resume").getAttribute("aria-disabled")).toBe("true");
    action("a", "resume").click();
    expect(queue.resume).toHaveBeenCalledTimes(1);
    reject(new Error("storage failed"));
    await vi.waitFor(() => expect(document.querySelector("[data-audio-queue-notice]").textContent).toContain("Réessayez"));
    expect(action("a", "resume").getAttribute("aria-disabled")).toBeNull();
  });

  it("supports cancellation and closes on Escape without pausing other jobs", async () => {
    snapshot.jobs = [makeJob("a"), makeJob("b")];
    ui.open();
    await settled();
    action("a", "cancel").click();
    await vi.waitFor(() => expect(queue.cancel).toHaveBeenCalledWith("a"));
    const unsubscribe = queue.subscribe.mock.results[0].value;
    document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(queue.pause).not.toHaveBeenCalled();
    expect(document.activeElement.id).toBe("queue-trigger");
  });

  it("shows storage recovery and never injects book metadata or errors as HTML", async () => {
    const job = makeJob("a", "error");
    job.title = '<img src=x onerror="alert(1)">';
    job.error = { code: "STORAGE_FULL", message: "private technical details" };
    snapshot.jobs = [job];
    ui.open();
    await settled();
    expect(document.querySelector("dialog img")).toBeNull();
    expect(document.querySelector(".audio-job-error").textContent).toContain("stockage");
    expect(document.querySelector("dialog").textContent).not.toContain("private technical details");
    expect(action("a", "resume").textContent).toContain("Réessayer");
  });

  it("localizes an open queue without changing book titles or losing the selected control", async () => {
    snapshot.jobs = [makeJob("a", "paused")];
    ui.open();
    await settled();
    action("a", "resume").focus();
    setLocale("de");
    window.dispatchEvent(new Event("languagechange"));
    expect(document.querySelector("#audio-queue-title").textContent).toBe("Audio vorbereiten");
    expect(document.querySelector(".audio-job-heading h3").textContent).toBe("Book a");
    expect(document.activeElement).toBe(action("a", "resume"));
    expect(action("a", "resume").textContent).toContain("Fortsetzen");
  });
});

describe("audio queue translations", () => {
  it("explains buffering and links to the queue for each preparation state", () => {
    for (const [state, source] of [
      ["preparing", "Vous avez rejoint la préparation. L’écoute reprend dès que la suite est prête."],
      ["queued", "Ce livre attend son tour. L’écoute reprendra quand la suite sera prête."],
      ["paused", "La préparation est en pause. Reprenez-la dans la file audio."],
      ["error", "La préparation est interrompue. Ouvrez la file audio pour la reprendre."],
    ]) {
      for (const language of ["fr", "en", "es", "it", "de", "pt"]) {
        setLocale(language);
        document.body.innerHTML = audioControlsMarkup({ status: "buffering", prepared: true, preparationStatus: state });
        expect(document.querySelector(".voice-player-status").textContent).toBe(t(source));
        expect(document.querySelector('[data-voice-action="queue"]').textContent).toContain(t("Voir la file audio"));
        expect(document.querySelector('[data-voice-action="toggle"]').textContent).toContain(t("Pause"));
      }
    }
    document.body.innerHTML = audioControlsMarkup({ status: "paused", prepared: true, preparationStatus: "preparing" });
    expect(document.querySelector(".voice-player-status").textContent).toBe(t("Lecture vocale en pause"));
    expect(document.querySelector('[data-voice-action="queue"]')).toBeNull();
  });

  it("explains continuing preparation during listening without claiming a paused job is running", () => {
    document.body.innerHTML = audioControlsMarkup({ status: "playing", prepared: true, preparationStatus: "preparing" });
    expect(document.querySelector(".voice-player-status").textContent).toBe(t("La suite du livre se prépare pendant votre écoute."));
    document.body.innerHTML = audioControlsMarkup({ status: "playing", prepared: true, preparationStatus: "paused" });
    expect(document.querySelector(".voice-player-status").textContent).toBe("");
  });

  it("keeps placeholder parity and provides translated controls in six languages", () => {
    const placeholders = value => [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
    for (const language of ["en", "es", "it", "de", "pt"]) {
      expect(Object.keys(translations[language])).toEqual(Object.keys(translations.en));
      for (const [source, translated] of Object.entries(translations[language])) {
        expect(translated.trim()).not.toBe("");
        expect(placeholders(translated)).toEqual(placeholders(source));
      }
    }
    for (const language of ["fr", "en", "es", "it", "de", "pt"]) {
      setLocale(language);
      document.body.innerHTML = audioQueueJobMarkup(makeJob("a", "ready"));
      expect(action("a", "remove").textContent).toContain(t("Supprimer l’audio"));
      expect(audioQueueErrorMessage({ code: "COORDINATION_UNAVAILABLE" })).toBe(t("Ce navigateur ne permet pas de préparer les livres en audio. Essayez un navigateur récent."));
    }
  });
});
