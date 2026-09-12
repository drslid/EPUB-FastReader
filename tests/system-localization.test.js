// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n.js";
import { importEpub } from "../src/epub.js";
import { restoreBackup } from "../src/backup.js";
import { createArchiveReader } from "../src/epub-archive.js";
import { createDemo } from "../src/demo.js";
import { resolveCover } from "../src/covers.js";
import selection from "../src/sources/selection.js";
import { registerReaderServiceWorker } from "../src/pwa-updates.js";
import { request } from "../src/sources/transport.js";
import { makeEpub } from "./e2e/helpers/fixtures.js";

afterEach(() => {
  setLocale("fr");
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const expected = {
  en: ["Choose an EPUB file smaller than 30 MB.", "Choose a ZIP backup smaller than 250 MB.", "This file is not a valid EPUB archive.", "The art of taking your time", "Unknown author"],
  es: ["Elige un archivo EPUB de menos de 30 MB.", "Elige una copia ZIP de menos de 250 MB.", "Este archivo no es un EPUB válido.", "El arte de tomarse el tiempo", "Autor desconocido"],
  it: ["Scegli un file EPUB di dimensioni inferiori a 30 MB.", "Scegli un backup ZIP di dimensioni inferiori a 250 MB.", "Questo file non è un archivio EPUB valido.", "L’arte di prendersi il tempo", "Autore sconosciuto"],
  de: ["Wähle eine EPUB-Datei unter 30 MB.", "Wähle eine ZIP-Sicherung unter 250 MB.", "Diese Datei ist kein gültiges EPUB-Archiv.", "Die Kunst, sich Zeit zu nehmen", "Unbekannter Autor"],
  pt: ["Escolhe um ficheiro EPUB com menos de 30 MB.", "Escolhe uma cópia ZIP com menos de 250 MB.", "Este ficheiro não é um arquivo EPUB válido.", "A arte de dar tempo ao tempo", "Autor desconhecido"],
};

describe.each(Object.entries(expected))("system localization in %s", (language, messages) => {
  it("translates validation and archive errors before they reach the interface", async () => {
    setLocale(language);
    await expect(importEpub()).rejects.toThrow(messages[0]);
    await expect(restoreBackup({ size: 251 * 1024 ** 2 })).rejects.toThrow(messages[1]);
    await expect(createArchiveReader(new ArrayBuffer(22), { worker: false })).rejects.toThrow(messages[2]);
    expect(resolveCover({}).author).toBe(messages[4]);
  });

  it("provides a translated demo edition without changing the French demo ID", () => {
    setLocale(language);
    const demo = createDemo();
    expect(demo).toMatchObject({ id: `fastreader-demo-v1-${language}`, title: messages[3], language, demo: true });
    expect(demo.chapters).toHaveLength(3);
    expect(demo.chapters.every(({ html, wordCount }) => html.startsWith("<p>") && wordCount > 100)).toBe(true);
    setLocale("fr");
    expect(createDemo()).toMatchObject({ id: "fastreader-demo-v1", title: "L’art de prendre le temps" });
  });

  it("keeps original imported and catalog book text and metadata", async () => {
    setLocale(language);
    const bytes = await makeEpub({ title: "Un livre français à garder tel quel" });
    const book = await importEpub(new File([bytes], "original.epub"));
    expect(book.title).toBe("Un livre français à garder tel quel");
    expect(book.chapters[0].html).toContain("Une histoire");
    const result = await selection.search({ query: "horla", language: "fr", page: 1 });
    expect(result.books[0]).toMatchObject({ title: "Le Horla", author: "Guy de Maupassant", language: "fr" });
    expect(result.books[0].description).not.toBe("Un recueil de quatorze nouvelles, entre quotidien et fantastique.");
  });
});

it("translates worker errors in the document, using the current language", async () => {
  class FakeWorker extends EventTarget {
    terminate = vi.fn();
    postMessage({ id }) {
      queueMicrotask(() => {
        // A locale may change while the worker is busy. Its response is still
        // translated with the current document language, without a worker bundle.
        setLocale("de");
        this.dispatchEvent(new MessageEvent("message", { data: { id, error: "Ce fichier n’est pas une archive EPUB valide." } }));
      });
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  setLocale("en");
  await expect(createArchiveReader(new ArrayBuffer(22))).rejects.toThrow("Diese Datei ist kein gültiges EPUB-Archiv.");
});

it("uses a localized HTTP error instead of exposing the relay’s French body", async () => {
  setLocale("de");
  const response = new Response(JSON.stringify({ error: { code: "SOURCE_UNAVAILABLE", message: "La source du livre est temporairement indisponible." } }), { status: 502, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async () => response));
  await expect(request("https://relay.example/api/books/gutenberg/1.epub", {
    timeout: 1000, maxBytes: 30 * 1024 ** 2, download: true, validateUrl: () => true,
  })).rejects.toThrow("Die Quelle ist nicht verfügbar (HTTP 502). Versuche es später erneut oder öffne ihre Website.");
  expect(response.bodyUsed).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

it("relabels a mounted PWA update without losing the save-before-update action", async () => {
  const registration = new EventTarget();
  registration.waiting = { postMessage: vi.fn() };
  const serviceWorker = new EventTarget();
  serviceWorker.controller = {};
  serviceWorker.register = vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  const beforeUpdate = vi.fn().mockResolvedValue();
  await registerReaderServiceWorker({ url: "./sw.js", beforeUpdate, onError: vi.fn() });
  setLocale("de");
  window.dispatchEvent(new Event("languagechange"));
  const button = document.querySelector(".pwa-update .button");
  expect(button.textContent).toBe("Aktualisieren");
  expect(document.querySelector(".pwa-update").getAttribute("aria-label")).toBe("App-Update");
  await button.onclick({ currentTarget: button });
  expect(beforeUpdate).toHaveBeenCalledOnce();
  expect(registration.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
});
