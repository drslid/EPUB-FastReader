// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import JSZip from "jszip";
import { makeEpub } from "./e2e/helpers/fixtures.js";
import { normalizePosition } from "../src/reading-state.js";

let storage;
let backup;
let epub;
let createDemo;

function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

async function imported(title = "Le livre sauvegardé") {
  const bytes = await makeEpub({ title });
  return epub.importEpub(new File([bytes], `${title}.epub`, { type: "application/epub+zip" }));
}

function position(extra = {}) {
  const locator = { version: 1, chapterId: "chapter-1", textOffset: 10, exact: "Une histoire", prefix: "", suffix: " à garder", progression: 0.2 };
  return {
    chapterIndex: 0, scrollRatio: 0.2, wordIndex: 8, progress: 0.1, locator,
    bookmarks: [{ id: "mark-1", chapterIndex: 0, wordIndex: 8, scrollRatio: 0.2, locator, createdAt: 1 }],
    annotations: [{ id: "note-1", chapterIndex: 0, locator, quote: "Une histoire", note: "À retrouver", createdAt: 2 }],
    ...extra,
  };
}

async function rewriteArchive(blob, change) {
  const zip = await JSZip.loadAsync(await readBlob(blob));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  await change(manifest, zip);
  zip.file("manifest.json", JSON.stringify(manifest));
  return new Blob([await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })]);
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  storage = await import("../src/storage.js");
  backup = await import("../src/backup.js");
  epub = await import("../src/epub.js");
  ({ createDemo } = await import("../src/demo.js"));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Full library ZIP backup", () => {
  it("round-trips original EPUB bytes, cover identity, exact location, notes, bookmarks and preferences", async () => {
    const book = await imported();
    book.source = { name: "Gutenberg", providerId: "gutenberg", bookId: "gutenberg-123", canonicalSourceId: "gutenberg:123", url: "https://www.gutenberg.org/ebooks/123", presentation: { version: 1, key: "gutenberg:123", title: "Une couverture stable", author: "Une autrice", image: null } };
    await storage.saveBook(book);
    await storage.savePosition(book.id, position());
    const settings = await storage.writeSettings({ ...storage.defaultSettings, theme: "sepia", speed: 420 });
    await storage.writeSuggestionHistory(["selection-candide"]);
    const saved = await storage.getPosition(book.id);
    const result = await backup.exportBackup();
    expect(result.bookCount).toBe(1);
    expect(result.fileName).toMatch(/^fastreader-sauvegarde-\d{4}-\d{2}-\d{2}\.zip$/);
    await storage.deleteBook(book.id);
    const restored = await backup.restoreBackup(result.blob, { restorePreferences: true });
    expect(restored).toMatchObject({ added: 1, existing: 0, annotationsAdded: 1, bookmarksAdded: 1, preferencesRestored: true });
    const loaded = await storage.getBook(book.id);
    expect(new Uint8Array(loaded.original)).toEqual(new Uint8Array(book.original));
    expect(loaded.chapters).toEqual(book.chapters);
    expect(loaded.source).toEqual(book.source);
    expect(loaded.addedAt).toBe(book.addedAt);
    expect(await storage.getPosition(book.id)).toEqual({ ...normalizePosition(saved, book), id: book.id });
    expect(await storage.readSettings()).toEqual(settings);
    expect(await storage.readSuggestionHistory()).toEqual(["selection-candide"]);
  });

  it("preserves the embedded demo and its annotations without an original EPUB", async () => {
    const demo = createDemo();
    await storage.saveBook(demo);
    await storage.savePosition(demo.id, position());
    const { blob } = await backup.exportBackup();
    await storage.deleteBook(demo.id);
    await backup.restoreBackup(blob);
    const restored = await storage.getBook(demo.id);
    expect(restored.demo).toBe(true);
    expect(restored.title).toBe(demo.title);
    expect(restored.chapters.map((chapter) => chapter.html)).toEqual(demo.chapters.map((chapter) => chapter.html));
    expect((await storage.getPosition(demo.id)).annotations[0].note).toBe("À retrouver");
  });

  it.each(["./books/NOTICE.html", "books/NOTICE.html"])("preserves bundled edition rights at the relative path %s", async (rightsUrl) => {
    const book = await imported();
    book.source = { providerId: "selection", rights: "Édition originale du domaine public", rightsUrl };
    await storage.saveBook(book);
    const { blob } = await backup.exportBackup();
    await storage.deleteBook(book.id);
    await backup.restoreBackup(blob);
    expect((await storage.getBook(book.id)).source).toEqual(book.source);
  });

  it("keeps current progress and conflicting notes while merging missing notes and bookmarks idempotently", async () => {
    const book = await imported();
    await storage.saveBook(book);
    await storage.savePosition(book.id, position());
    const { blob } = await backup.exportBackup();
    await storage.savePosition(book.id, position({ progress: 0.9, annotations: [{ ...position().annotations[0], note: "Ma modification récente" }, { ...position().annotations[0], id: "note-2", note: "Nouvelle note" }], bookmarks: [] }));
    await storage.saveBook({ ...book, title: "Mon titre actuel" });
    const result = await backup.restoreBackup(blob);
    expect(result).toMatchObject({ added: 0, existing: 1, annotationsAdded: 0, bookmarksAdded: 1 });
    const restored = await storage.getPosition(book.id);
    expect(restored.progress).toBe(0.9);
    expect(restored.annotations.map((item) => item.note)).toEqual(["Ma modification récente", "Nouvelle note"]);
    expect(restored.bookmarks).toHaveLength(1);
    expect((await storage.getBook(book.id)).title).toBe("Mon titre actuel");
    expect(await backup.restoreBackup(blob)).toMatchObject({ added: 0, existing: 1, annotationsAdded: 0, bookmarksAdded: 0 });
  });

  it("keeps existing settings unless the reader explicitly chooses replacement", async () => {
    await storage.writeSettings({ ...storage.defaultSettings, theme: "sepia", speed: 475 });
    const { blob } = await backup.exportBackup();
    await storage.writeSettings({ ...storage.defaultSettings, theme: "paper", speed: 200 });
    await backup.restoreBackup(blob);
    expect(await storage.readSettings()).toMatchObject({ theme: "paper", speed: 200 });
    await backup.restoreBackup(blob, { restorePreferences: true });
    expect(await storage.readSettings()).toMatchObject({ theme: "sepia", speed: 475 });
  });

  it("never restores arbitrary imported preferences and strips unsafe source URLs", async () => {
    const book = await imported();
    await storage.saveBook(book);
    const { blob } = await backup.exportBackup();
    const archive = await rewriteArchive(blob, (manifest) => {
      manifest.preferences.push({ id: "arbitrary-setting", html: "<script>bad()</script>" });
      manifest.books[0].source = { url: "javascript:alert(1)", presentation: { version: 1, key: "key", title: "Cover", image: "data:image/svg+xml,<svg onload=alert(1)>" } };
    });
    await storage.deleteBook(book.id);
    await backup.restoreBackup(archive);
    expect(await storage.getPreference("arbitrary-setting")).toBeUndefined();
    expect((await storage.getBook(book.id)).source.url).toBe("");
    expect((await storage.getBook(book.id)).source.presentation.image).toBeNull();
  });

  it("sanitizes a demo's inline HTML instead of trusting a backup document", async () => {
    const demo = createDemo();
    await storage.saveBook(demo);
    const { blob } = await backup.exportBackup();
    const archive = await rewriteArchive(blob, async (manifest, zip) => {
      const path = manifest.books[0].path;
      const inline = JSON.parse(await zip.file(path).async("string"));
      inline.chapters[0].html = '<p onclick="bad()">Texte sûr</p><script>bad()</script><img src="https://tracker.invalid/pixel">';
      zip.file(path, JSON.stringify(inline), { createFolders: false });
    });
    await storage.deleteBook(demo.id);
    await backup.restoreBackup(archive);
    const restored = await storage.getBook(demo.id);
    expect(restored.chapters[0].html).toBe("<p>Texte sûr</p>");
  });
});

describe("Restore validation and atomicity", () => {
  it("rejects a non-ZIP file and unsupported versions without writing anything", async () => {
    const demo = createDemo();
    await storage.saveBook(demo);
    const before = await storage.readLibrarySnapshot();
    await expect(backup.restoreBackup(new Blob(["not a zip"]))).rejects.toThrow();
    const { blob } = await backup.exportBackup();
    const archive = await rewriteArchive(blob, (manifest) => { manifest.version = 999; });
    await expect(backup.restoreBackup(archive)).rejects.toThrow();
    expect(await storage.readLibrarySnapshot()).toEqual(before);
  });

  it("validates every EPUB before starting any database mutation", async () => {
    const first = await imported("Livre A");
    const second = await imported("Livre B");
    await storage.saveBook(first); await storage.saveBook(second);
    const { blob } = await backup.exportBackup();
    await storage.deleteBook(first.id); await storage.deleteBook(second.id);
    const archive = await rewriteArchive(blob, (manifest, zip) => { zip.file(manifest.books[1].path, "not an EPUB", { createFolders: false }); });
    await expect(backup.restoreBackup(archive)).rejects.toThrow();
    expect(await storage.listBooks()).toEqual([]);
  });

  it("rolls back books, positions and preferences together on quota failure", async () => {
    const book = await imported();
    await storage.saveBook(book); await storage.savePosition(book.id, position());
    await storage.writeSettings({ ...storage.defaultSettings, theme: "sepia" });
    const { blob } = await backup.exportBackup();
    await storage.deleteBook(book.id);
    await storage.writeSettings({ ...storage.defaultSettings, theme: "paper" });
    const before = await storage.readLibrarySnapshot();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (value) {
      if (this.name === "positions") throw new DOMException("Storage full", "QuotaExceededError");
      return put.call(this, value);
    });
    await expect(backup.restoreBackup(blob, { restorePreferences: true })).rejects.toHaveProperty("name", "QuotaExceededError");
    expect(await storage.readLibrarySnapshot()).toEqual(before);
  });

  it("rejects duplicated IDs, foreign positions and unlisted archive entries", async () => {
    await storage.saveBook(createDemo());
    const { blob } = await backup.exportBackup();
    for (const change of [
      (manifest) => { manifest.books.push(manifest.books[0]); },
      (manifest) => { manifest.positions = [{ id: "foreign-book", ...position() }]; },
      (_, zip) => { zip.file("tracking.txt", "unexpected"); },
    ]) {
      const archive = await rewriteArchive(blob, change);
      await expect(backup.restoreBackup(archive)).rejects.toThrow();
    }
    expect(await storage.listBooks()).toHaveLength(1);
  });

  it("checks CRC integrity and declared expanded sizes before accepting content", async () => {
    await storage.saveBook(createDemo());
    const { blob } = await backup.exportBackup();
    const original = await readBlob(blob);
    const forged = original.slice(0);
    const bytes = new Uint8Array(forged);
    const view = new DataView(forged);
    let central = -1;
    for (let index = 0; index < bytes.length - 46; index += 1)
      if (view.getUint32(index, true) === 0x02014b50) { central = index; break; }
    view.setUint32(central + 16, 0, true);
    await expect(backup.restoreBackup(forged)).rejects.toThrow("endommagée");
    const oversized = original.slice(0);
    new DataView(oversized).setUint32(central + 24, 500 * 1024 ** 2, true);
    await expect(backup.restoreBackup(oversized)).rejects.toThrow("volumineux");
  });

  it("stops decompression when forged uncompressed sizes are smaller than the contents", async () => {
    await storage.saveBook(createDemo());
    const { blob } = await backup.exportBackup();
    const forged = await readBlob(blob);
    const view = new DataView(forged);
    for (let index = 0; index < forged.byteLength - 46; index += 1) {
      if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 24, 1, true); break; }
    }
    await expect(backup.restoreBackup(forged)).rejects.toThrow("taille réelle");
  });
});

describe("Storage estimates and persistence", () => {
  it("warns before importing when the browser's estimate is tight", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 80, quota: 100 }), persisted: async () => false, persist: async () => true } });
    expect(await storage.assessImportStorage(10)).toMatchObject({ available: 20, estimatedRequired: 40, persistent: false, canPersist: true });
    expect((await storage.assessImportStorage(10)).warning).toContain("espace disponible");
    expect(await storage.requestPersistentStorage()).toBe(true);
  });

  it("does not prevent imports when storage APIs are unavailable or rejected", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: async () => { throw new Error("Denied"); }, persisted: async () => { throw new Error("Denied"); }, persist: async () => { throw new Error("Denied"); } } });
    expect(await storage.assessImportStorage(100)).toMatchObject({ available: null, warning: "", persistent: null });
    expect(await storage.requestPersistentStorage()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await storage.getStorageStatus()).toEqual({ usage: null, quota: null, available: null, persistent: null, canPersist: false });
  });
});
