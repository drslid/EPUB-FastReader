import { t } from "./i18n.js";
import { normalizePosition } from "./reading-state.js";
import { readingFonts } from "./reading-preferences.js";

const DATABASE = "fastreader";
let connection;

function openDatabase() {
  if (!connection) {
    const pending = new Promise((resolve, reject) => {
      let abandoned = false;
      const request = indexedDB.open(DATABASE, 2);
      request.onupgradeneeded = () => {
        for (const name of ["books", "positions", "preferences"]) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: "id" });
          }
        }
      };
      request.onerror = () => {
        abandoned = true;
        reject(
          request.error ||
            new Error(t("Impossible d’ouvrir le stockage des livres.")),
        );
      };
      request.onblocked = () => {
        abandoned = true;
        reject(
          new Error(t("Fermez les autres onglets FastReader puis réessayez.")),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        // An already rejected open request may still complete after another tab closes.
        if (abandoned) {
          db.close();
          return;
        }
        const clearConnection = () => {
          if (connection === pending) connection = undefined;
        };
        db.onversionchange = () => {
          db.close();
          clearConnection();
        };
        db.onclose = clearConnection;
        resolve(db);
      };
    }).catch((error) => {
      if (connection === pending) connection = undefined;
      throw error;
    });
    connection = pending;
  }
  return connection;
}

async function transaction(stores, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let request;
    let requestError;
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = (event) => {
      requestError = event.target?.error;
    };
    tx.onabort = () =>
      reject(tx.error || requestError || new Error(t("Sauvegarde interrompue.")));
    try {
      request = callback(tx);
    } catch (error) {
      // A synchronous failure must roll back earlier requests in the same transaction.
      tx.abort();
      reject(error);
    }
  });
}

function timestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string" || !value.trim()) return 0;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  return Date.parse(value) || 0;
}

export const getBook = (id) =>
  transaction(["books"], "readonly", (tx) => tx.objectStore("books").get(id));
export const saveBook = (book) =>
  transaction(["books"], "readwrite", (tx) =>
    tx.objectStore("books").put(book),
  );
export const getPosition = (id) =>
  transaction(["positions"], "readonly", (tx) =>
    tx.objectStore("positions").get(id),
  );
export const savePosition = (id, position) =>
  transaction(["positions"], "readwrite", (tx) =>
    tx.objectStore("positions").put({ ...position, id, updatedAt: Date.now() }),
  );

export async function listBooks() {
  // A cursor avoids retaining the original EPUB buffers for every book in the UI.
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const summaries = [];
    const tx = db.transaction(["books", "positions"], "readonly");
    const positions = tx.objectStore("positions").getAll();
    const request = tx.objectStore("books").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const {
        id,
        title,
        author,
        language,
        cover,
        addedAt,
        totalWords,
        source,
        demo,
      } = cursor.value;
      summaries.push({
        id,
        title,
        author,
        language,
        cover,
        addedAt,
        totalWords,
        source,
        demo,
      });
      cursor.continue();
    };
    tx.oncomplete = () => {
      const byId = new Map(
        positions.result.map((position) => [position.id, position]),
      );
      resolve(
        summaries
          .map((book) => ({ ...book, position: byId.get(book.id) }))
          .sort(
            (a, b) =>
              (timestamp(b.position?.updatedAt) || timestamp(b.addedAt)) -
              (timestamp(a.position?.updatedAt) || timestamp(a.addedAt)),
          ),
      );
    };
    tx.onerror = (event) =>
      reject(
        tx.error ||
          event.target?.error ||
          new Error(t("Lecture de la bibliothèque interrompue.")),
      );
    tx.onabort = () =>
      reject(tx.error || new Error(t("Lecture de la bibliothèque interrompue.")));
  });
}

export const deleteBook = (id) =>
  transaction(["books", "positions"], "readwrite", (tx) => {
    tx.objectStore("positions").delete(id);
    return tx.objectStore("books").delete(id);
  });

export const defaultSettings = Object.freeze({
  locale: "fr",
  theme: "sepia",
  fontSize: 20,
  font: "humanist",
  mode: "rsvp",
  speed: 300,
  lineHeight: 1.85,
  columnWidth: 70,
  focusIntensity: 50,
  skipShortWords: false,
  cadence: "gentle",
  wakeLock: true,
  profile: "balanced",
});

export function normalizeSettings(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    locale: ["fr", "en", "es", "it", "de", "pt"].includes(source.locale) ? source.locale : "fr",
    theme: ["paper", "sepia", "night"].includes(source.theme)
      ? source.theme
      : defaultSettings.theme,
    fontSize: Math.round(
      Math.min(32, Math.max(16, Number(source.fontSize) || 20)),
    ),
    font: Object.hasOwn(readingFonts, source.font) ? source.font : defaultSettings.font,
    mode: ["classic", "focus", "rsvp"].includes(source.mode)
      ? source.mode
      : defaultSettings.mode,
    speed: Math.min(800, Math.max(100, Number(source.speed) || 300)),
    lineHeight: Math.min(2.4, Math.max(1.4, Number(source.lineHeight) || 1.85)),
    columnWidth: Math.round(Math.min(85, Math.max(45, Number(source.columnWidth) || 70))),
    focusIntensity: Math.round(Math.min(70, Math.max(20, Number(source.focusIntensity) || 50))),
    skipShortWords: source.skipShortWords === true,
    cadence: source.cadence === "steady" ? "steady" : "gentle",
    wakeLock: source.wakeLock !== false,
    profile: ["balanced", "comfort", "light", "custom"].includes(source.profile) ? source.profile : "balanced",
  };
}

export async function readSettings() {
  const stored = await transaction(["preferences"], "readonly", (tx) =>
    tx.objectStore("preferences").get("reader"),
  );
  if (stored) return normalizeSettings(stored);
  let legacy = {};
  try {
    legacy = JSON.parse(localStorage.getItem("fastreader-settings")) || {};
  } catch {
    /* Old preferences are optional; books never depend on localStorage. */
  }
  // Existing explicit preferences survive migration; fresh installs use the
  // current defaults, with a calmer initial mode when the OS requests it.
  const settings = normalizeSettings({
    ...legacy,
    mode: ["classic", "focus", "rsvp"].includes(legacy.mode) ? legacy.mode
      : globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "classic" : defaultSettings.mode,
  });
  await writeSettings(settings);
  try {
    localStorage.removeItem("fastreader-settings");
  } catch {
    /* The DB already owns the settings. */
  }
  return settings;
}

export async function writeSettings(settings) {
  const normalized = normalizeSettings(settings);
  await transaction(["preferences"], "readwrite", (tx) =>
    tx.objectStore("preferences").put({ ...normalized, id: "reader" }),
  );
  return normalized;
}

function normalizeSuggestionIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || id.length > 120) continue;
    ids.add(id);
    if (ids.size === 9) break;
  }
  return [...ids];
}

/** Keep only the last visible group, in the same local database as the books. */
export async function readSuggestionHistory() {
  const stored = await transaction(["preferences"], "readonly", (tx) =>
    tx.objectStore("preferences").get("suggestions"),
  );
  return normalizeSuggestionIds(stored?.ids);
}

export async function writeSuggestionHistory(ids) {
  const normalized = normalizeSuggestionIds(ids);
  await transaction(["preferences"], "readwrite", (tx) =>
    tx.objectStore("preferences").put({ id: "suggestions", ids: normalized }),
  );
  return normalized;
}

export const getPreference = (id) =>
  transaction(["preferences"], "readonly", (tx) =>
    tx.objectStore("preferences").get(id),
  );

export const savePreference = (id, value) =>
  transaction(["preferences"], "readwrite", (tx) =>
    tx.objectStore("preferences").put({ ...value, id }),
  );

/** One transaction gives the archive a coherent snapshot of books and reading state. */
export async function readLibrarySnapshot() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["books", "positions", "preferences"], "readonly");
    const requests = Object.fromEntries(
      ["books", "positions", "preferences"].map((name) => [
        name,
        tx.objectStore(name).getAll(),
      ]),
    );
    tx.oncomplete = () => resolve(Object.fromEntries(
      Object.entries(requests).map(([name, request]) => [name, request.result]),
    ));
    tx.onabort = () => reject(tx.error || new Error(t("Lecture de la sauvegarde interrompue.")));
    tx.onerror = () => {};
  });
}

function mergeReadingPosition(current, incoming, book) {
  const restored = normalizePosition(incoming, book);
  if (!current) return { ...restored, id: book.id };
  const merged = { ...normalizePosition(current, book), id: book.id };
  for (const kind of ["bookmarks", "annotations"]) {
    const ids = new Set(merged[kind].map((item) => item.id));
    for (const item of restored[kind]) {
      if (!ids.has(item.id) && merged[kind].length < 1000) {
        merged[kind].push(item);
        ids.add(item.id);
      }
    }
  }
  return merged;
}

/** All parsing must finish before this call. A failed write rolls the entire merge back. */
export async function mergeLibrarySnapshot(snapshot, { restorePreferences = false } = {}) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["books", "positions", "preferences"], "readwrite");
    const books = tx.objectStore("books");
    const positions = tx.objectStore("positions");
    const preferences = tx.objectStore("preferences");
    const byId = new Map(snapshot.positions.map((position) => [position.id, position]));
    const result = { added: 0, existing: 0, annotationsAdded: 0, bookmarksAdded: 0, preferencesRestored: false };
    let failure;
    const guarded = (callback) => () => {
      try { callback(); } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = (event) => { failure ||= event.target?.error; };
    tx.onabort = () => reject(failure || tx.error || new Error(t("Restauration interrompue. Vos données sont inchangées.")));
    try {
      for (const book of snapshot.books) {
        const request = books.get(book.id);
        request.onsuccess = guarded(() => {
          const currentBook = request.result;
          if (currentBook) result.existing += 1;
          else { books.add(book); result.added += 1; }
          const incoming = byId.get(book.id);
          if (!incoming) return;
          const positionRequest = positions.get(book.id);
          positionRequest.onsuccess = guarded(() => {
            const current = positionRequest.result;
            const merged = mergeReadingPosition(current, incoming, currentBook || book);
            result.annotationsAdded += merged.annotations.length - (current ? normalizePosition(current, currentBook || book).annotations.length : 0);
            result.bookmarksAdded += merged.bookmarks.length - (current ? normalizePosition(current, currentBook || book).bookmarks.length : 0);
            positions.put(merged);
          });
        });
      }
      for (const preference of snapshot.preferences) {
        const request = preferences.get(preference.id);
        request.onsuccess = guarded(() => {
          if (!request.result || (restorePreferences && preference.id === "reader")) {
            preferences.put(preference);
            if (preference.id === "reader") result.preferencesRestored = true;
          }
        });
      }
    } catch (error) { failure = error; tx.abort(); }
  });
}

/** Browser estimates are approximate and optional; they never guarantee a later write. */
export async function getStorageStatus() {
  const manager = globalThis.navigator?.storage;
  let estimate = {};
  let persistent = null;
  try { estimate = await manager?.estimate?.() || {}; } catch { /* Optional browser capability. */ }
  try { persistent = typeof manager?.persisted === "function" ? await manager.persisted() : null; } catch { /* Unavailable in some private contexts. */ }
  const usage = Number.isFinite(estimate.usage) && estimate.usage >= 0 ? estimate.usage : null;
  const quota = Number.isFinite(estimate.quota) && estimate.quota > 0 ? estimate.quota : null;
  return { usage, quota, available: usage !== null && quota !== null ? Math.max(0, quota - usage) : null, persistent, canPersist: typeof manager?.persist === "function" };
}

export async function requestPersistentStorage() {
  try { return await globalThis.navigator?.storage?.persist?.() === true; }
  catch { return false; }
}

export async function assessImportStorage(byteLength) {
  const status = await getStorageStatus();
  // EPUBs are compressed; the reader also keeps prepared text and images.
  const estimatedRequired = Math.max(0, Number(byteLength) || 0) * 4;
  const tight = status.available !== null && status.available < estimatedRequired;
  const warning = tight
    ? t("L’espace disponible semble faible pour ce livre. Exportez une sauvegarde et libérez de la place si l’import échoue.")
    : status.quota !== null && status.usage / status.quota > 0.85
      ? t("Le stockage de ce site est presque plein. Pensez à exporter une sauvegarde.")
      : "";
  return { ...status, estimatedRequired, warning };
}
