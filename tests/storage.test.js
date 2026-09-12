// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore, forceCloseDatabase } from "fake-indexeddb";

let storage;
let factory;

function book(id = "book-1", extra = {}) {
  return {
    id,
    title: `Le livre ${id}`,
    author: "Une autrice",
    cover: "data:image/png;base64,AAAA",
    language: "fr",
    addedAt: 1000,
    totalWords: 42,
    chapters: [
      {
        id: "chapter-1",
        title: "Introduction",
        html: "<p>Bonjour</p>",
        wordCount: 42,
      },
    ],
    original: new Uint8Array([80, 75, 3, 4, 0, 255]).buffer,
    fileName: `${id}.epub`,
    ...extra,
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  vi.resetModules();
  factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  localStorage.clear();
  storage = await import("../src/storage.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Personal library persistence", () => {
  it("round-trips EPUB bytes and chapters using independent structured clones", async () => {
    const original = book();
    await storage.saveBook(original);
    new Uint8Array(original.original)[0] = 0;
    original.chapters[0].html = "changed";
    const loaded = await storage.getBook(original.id);
    expect([...new Uint8Array(loaded.original)]).toEqual([
      80, 75, 3, 4, 0, 255,
    ]);
    expect(loaded.chapters[0].html).toBe("<p>Bonjour</p>");
    loaded.title = "Changed in memory";
    expect((await storage.getBook(original.id)).title).toBe("Le livre book-1");
  });

  it("restores persisted books after the storage module is loaded again", async () => {
    await storage.saveBook(book());
    vi.resetModules();
    const reopened = await import("../src/storage.js");
    expect((await reopened.getBook("book-1")).title).toBe("Le livre book-1");
  });

  it("upserts identical identifiers and lists lightweight book summaries", async () => {
    await storage.saveBook(book());
    await storage.saveBook(book("book-1", { title: "Nouvelle édition" }));
    const books = await storage.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Nouvelle édition");
    expect(books[0].language).toBe("fr");
    expect(books[0]).not.toHaveProperty("original");
    expect(books[0]).not.toHaveProperty("chapters");
    expect(await storage.getBook("missing")).toBeUndefined();
  });

  it("persists independent positions and bookmarks without replacing EPUB data", async () => {
    await storage.saveBook(book());
    const position = {
      chapterIndex: 2,
      scrollRatio: 0.6,
      wordIndex: 120,
      progress: 0.4,
      bookmarks: [{ chapterIndex: 1, scrollRatio: 0.2, wordIndex: 20 }],
    };
    const before = Date.now();
    await storage.savePosition("book-1", position);
    position.bookmarks[0].wordIndex = 999;
    const loaded = await storage.getPosition("book-1");
    expect(loaded).toMatchObject({
      id: "book-1",
      progress: 0.4,
      bookmarks: [{ wordIndex: 20 }],
    });
    expect(loaded.updatedAt).toBeGreaterThanOrEqual(before);
    expect(loaded.updatedAt).toBeLessThanOrEqual(Date.now());
    expect((await storage.getBook("book-1")).original.byteLength).toBe(6);
    expect((await storage.listBooks())[0].position).toEqual(loaded);
  });

  it("sorts the most recent reading first and supports numeric and ISO import dates", async () => {
    await storage.saveBook(book("ancient", { addedAt: 500 }));
    await storage.saveBook(book("numeric", { addedAt: 1600000000000 }));
    await storage.saveBook(
      book("iso", { addedAt: "2024-01-01T00:00:00.000Z" }),
    );
    await storage.saveBook(book("string", { addedAt: "1704067200001" }));
    await storage.saveBook(book("unknown", { addedAt: "not-a-date" }));
    await storage.savePosition("ancient", { chapterIndex: 0, progress: 0.1 });
    expect((await storage.listBooks()).map((item) => item.id)).toEqual([
      "ancient",
      "string",
      "iso",
      "numeric",
      "unknown",
    ]);
  });

  it("deletes a book and its position together without touching other books", async () => {
    await storage.saveBook(book("remove"));
    await storage.savePosition("remove", { progress: 0.5 });
    await storage.saveBook(book("keep"));
    await storage.savePosition("keep", { progress: 0.8 });
    await storage.deleteBook("remove");
    expect(await storage.getBook("remove")).toBeUndefined();
    expect(await storage.getPosition("remove")).toBeUndefined();
    expect(await storage.getBook("keep")).toHaveProperty("id", "keep");
    expect(await storage.getPosition("keep")).toHaveProperty("progress", 0.8);
  });

  it("rolls back position deletion if deleting the book fails synchronously", async () => {
    await storage.saveBook(book());
    await storage.savePosition("book-1", { progress: 0.75 });
    const originalDelete = IDBObjectStore.prototype.delete;
    const fail = vi
      .spyOn(IDBObjectStore.prototype, "delete")
      .mockImplementation(function (key) {
        if (this.name === "books")
          throw new DOMException(
            "Simulated storage failure",
            "InvalidStateError",
          );
        return originalDelete.call(this, key);
      });
    await expect(storage.deleteBook("book-1")).rejects.toHaveProperty(
      "name",
      "InvalidStateError",
    );
    fail.mockRestore();
    expect(await storage.getBook("book-1")).toHaveProperty("id", "book-1");
    expect(await storage.getPosition("book-1")).toHaveProperty(
      "progress",
      0.75,
    );
  });

  it("reports asynchronous request errors and preserves previous stored data", async () => {
    await storage.saveBook(book());
    // Duplicate add raises an asynchronous ConstraintError through the transaction.
    const fail = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(function (value) {
        return this.add(value);
      });
    await expect(
      storage.saveBook(book("book-1", { title: "Must not commit" })),
    ).rejects.toHaveProperty("name", "ConstraintError");
    fail.mockRestore();
    expect((await storage.getBook("book-1")).title).toBe("Le livre book-1");
  });
});

describe("Storage connection recovery", () => {
  it("retries an open request after the browser reports an error", async () => {
    const failedRequest = {
      error: new DOMException(
        "Storage temporarily unavailable",
        "UnknownError",
      ),
    };
    vi.spyOn(factory, "open").mockImplementationOnce(() => {
      queueMicrotask(() => failedRequest.onerror());
      return failedRequest;
    });
    await expect(storage.listBooks()).rejects.toHaveProperty(
      "name",
      "UnknownError",
    );
    await expect(storage.saveBook(book())).resolves.toBe("book-1");
  });

  it("closes a late successful connection after a blocked open was rejected", async () => {
    const blockedRequest = {};
    vi.spyOn(factory, "open").mockImplementationOnce(() => {
      queueMicrotask(() => blockedRequest.onblocked());
      return blockedRequest;
    });
    await expect(storage.listBooks()).rejects.toThrow("autres onglets");
    const orphan = { close: vi.fn() };
    blockedRequest.result = orphan;
    blockedRequest.onsuccess();
    expect(orphan.close).toHaveBeenCalledOnce();
    await expect(storage.saveBook(book())).resolves.toBe("book-1");
  });

  it("reopens when the browser closes an IndexedDB connection unexpectedly", async () => {
    const open = vi.spyOn(factory, "open");
    await storage.saveBook(book());
    const connection = open.mock.results[0].value.result;
    const closed = new Promise((resolve) =>
      connection.addEventListener("close", resolve, { once: true }),
    );
    forceCloseDatabase(connection);
    await closed;
    expect(await storage.getBook("book-1")).toHaveProperty("id", "book-1");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("releases its connection for a database reset and opens a fresh database afterwards", async () => {
    await storage.saveBook(book());
    await requestResult(factory.deleteDatabase("fastreader"));
    expect(await storage.listBooks()).toEqual([]);
    await expect(storage.saveBook(book("new"))).resolves.toBe("new");
  });
});

describe("Reader preferences in IndexedDB", () => {
  it("starts in sepia RSVP with Verdana and restores explicit choices after reload", async () => {
    expect(await storage.readSettings()).toEqual({
      ...storage.defaultSettings,
      theme: "sepia",
      fontSize: 20,
      font: "humanist",
      mode: "rsvp",
      speed: 300,
    });
    const settings = {
      ...storage.defaultSettings,
      theme: "paper",
      font: "sans",
      fontSize: 28,
      mode: "classic",
      speed: 450,
    };
    expect(await storage.writeSettings(settings)).toEqual(settings);
    vi.resetModules();
    const reopened = await import("../src/storage.js");
    expect(await reopened.readSettings()).toEqual(settings);
    expect(localStorage.getItem("fastreader-settings")).toBeNull();
  });

  it.each(["humanist", "sans", "serif", "palatino", "trebuchet", "system"])(
    "retains the selected %s font in IndexedDB",
    async (font) => {
      await storage.writeSettings({ ...storage.defaultSettings, font });
      vi.resetModules();
      const reopened = await import("../src/storage.js");
      expect(await reopened.readSettings()).toHaveProperty("font", font);
    },
  );

  it("validates enum values and clamps numeric preferences", async () => {
    await storage.writeSettings({
      theme: "invalid",
      font: "unsafe",
      mode: "unknown",
      fontSize: 999,
      speed: -10,
    });
    expect(await storage.readSettings()).toEqual({
      ...storage.defaultSettings,
      theme: "sepia",
      font: "humanist",
      mode: "rsvp",
      fontSize: 32,
      speed: 100,
    });
    await storage.writeSettings({ fontSize: "not-a-number", speed: "bad" });
    expect(await storage.readSettings()).toEqual(storage.defaultSettings);
  });

  it.each(["broken JSON", "null", "[]", "42"])(
    "uses defaults for malformed legacy settings: %s",
    async (value) => {
      localStorage.setItem("fastreader-settings", value);
      expect(await storage.readSettings()).toEqual(storage.defaultSettings);
    },
  );

  it("preserves explicit legacy preferences, books and positions during the v1 upgrade", async () => {
    const request = factory.open("fastreader", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("books", { keyPath: "id" });
      request.result.createObjectStore("positions", { keyPath: "id" });
    };
    const db = await requestResult(request);
    const tx = db.transaction(["books", "positions"], "readwrite");
    tx.objectStore("books").put(book());
    tx.objectStore("positions").put({
      id: "book-1",
      progress: 0.6,
      bookmarks: [{ chapterIndex: 0, scrollRatio: 0.4 }],
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = reject;
    });
    db.close();
    localStorage.setItem(
      "fastreader-settings",
      JSON.stringify({
        theme: "paper",
        mode: "focus",
        font: "sans",
        fontSize: 24,
        speed: 475,
      }),
    );
    expect(await storage.readSettings()).toEqual({
      ...storage.defaultSettings,
      theme: "paper",
      mode: "focus",
      font: "sans",
      fontSize: 24,
      speed: 475,
    });
    expect((await storage.getBook("book-1")).original.byteLength).toBe(6);
    expect((await storage.getPosition("book-1")).bookmarks).toHaveLength(1);
    expect(localStorage.getItem("fastreader-settings")).toBeNull();
    await storage.writeSettings({
      ...storage.defaultSettings,
      theme: "sepia",
      mode: "focus",
    });
    expect(await storage.readSettings()).toMatchObject({
      theme: "sepia",
      mode: "focus",
    });
  });

  it("does not depend on localStorage to save new preferences", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Not allowed", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(await storage.readSettings()).toEqual(storage.defaultSettings);
    await storage.writeSettings({ ...storage.defaultSettings, theme: "paper" });
    expect(await storage.readSettings()).toHaveProperty("theme", "paper");
  });

  it("reports a failed preference write without corrupting saved choices", async () => {
    await storage.writeSettings({ ...storage.defaultSettings, theme: "paper" });
    const fail = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Full", "QuotaExceededError");
      });
    await expect(
      storage.writeSettings(storage.defaultSettings),
    ).rejects.toHaveProperty("name", "QuotaExceededError");
    fail.mockRestore();
    expect(await storage.readSettings()).toHaveProperty("theme", "paper");
  });
});

describe("Suggestion rotation history in IndexedDB", () => {
  it("starts empty and restores an independent list after the module is loaded again", async () => {
    expect(await storage.readSuggestionHistory()).toEqual([]);
    const ids = ["selection-horla", "selection-candide"];
    const result = await storage.writeSuggestionHistory(ids);
    expect(result).toEqual(ids);
    ids.push("mutated-input");
    result.push("mutated-result");
    vi.resetModules();
    const reopened = await import("../src/storage.js");
    expect(await reopened.readSuggestionHistory()).toEqual([
      "selection-horla",
      "selection-candide",
    ]);
    const read = await reopened.readSuggestionHistory();
    read.push("mutated-read");
    expect(await reopened.readSuggestionHistory()).toHaveLength(2);
  });

  it("deduplicates, trims, rejects invalid identifiers and limits the group to nine", async () => {
    const ids = Object.freeze([
      "  selection-horla  ",
      "selection-horla",
      "",
      "  ",
      null,
      42,
      {},
      "x".repeat(121),
      ...Array.from({ length: 12 }, (_, index) => `selection-${index}`),
    ]);
    const expected = [
      "selection-horla",
      ...Array.from({ length: 8 }, (_, index) => `selection-${index}`),
    ];
    expect(await storage.writeSuggestionHistory(ids)).toEqual(expected);
    expect(await storage.readSuggestionHistory()).toEqual(expected);
  });

  it("clears invalid input instead of storing a malformed group", async () => {
    for (const value of [undefined, null, "selection-horla", {}, 3]) {
      await storage.writeSuggestionHistory(["selection-horla"]);
      expect(await storage.writeSuggestionHistory(value)).toEqual([]);
      expect(await storage.readSuggestionHistory()).toEqual([]);
    }
  });

  it("validates a malformed stored record when reading", async () => {
    await storage.writeSuggestionHistory([]);
    const db = await requestResult(factory.open("fastreader", 2));
    const tx = db.transaction(["preferences"], "readwrite");
    tx.objectStore("preferences").put({
      id: "suggestions",
      ids: ["valid", "valid", false, "", "x".repeat(121), "second"],
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = reject;
    });
    db.close();
    expect(await storage.readSuggestionHistory()).toEqual(["valid", "second"]);
  });

  it("never changes reader preferences, EPUB bytes, positions or localStorage", async () => {
    await storage.saveBook(book());
    await storage.savePosition("book-1", { progress: 0.42 });
    const settings = await storage.writeSettings({
      ...storage.defaultSettings,
      theme: "sepia",
      mode: "focus",
    });
    const beforeBook = await storage.getBook("book-1");
    const beforePosition = await storage.getPosition("book-1");
    const access = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    await storage.writeSuggestionHistory(["selection-candide"]);
    expect(await storage.readSuggestionHistory()).toEqual([
      "selection-candide",
    ]);
    expect(await storage.readSettings()).toEqual(settings);
    expect(await storage.getBook("book-1")).toEqual(beforeBook);
    expect(await storage.getPosition("book-1")).toEqual(beforePosition);
    expect(access).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports a failed write and keeps the previous visible group", async () => {
    await storage.writeSuggestionHistory(["selection-horla"]);
    const fail = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Full", "QuotaExceededError");
      });
    await expect(
      storage.writeSuggestionHistory(["selection-candide"]),
    ).rejects.toHaveProperty("name", "QuotaExceededError");
    fail.mockRestore();
    expect(await storage.readSuggestionHistory()).toEqual(["selection-horla"]);
  });
});
