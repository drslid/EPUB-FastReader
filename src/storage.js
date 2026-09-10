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
            new Error("Impossible d’ouvrir le stockage des livres."),
        );
      };
      request.onblocked = () => {
        abandoned = true;
        reject(
          new Error("Fermez les autres onglets FastReader puis réessayez."),
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
      reject(tx.error || requestError || new Error("Sauvegarde interrompue."));
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
          new Error("Lecture de la bibliothèque interrompue."),
      );
    tx.onabort = () =>
      reject(tx.error || new Error("Lecture de la bibliothèque interrompue."));
  });
}

export const deleteBook = (id) =>
  transaction(["books", "positions"], "readwrite", (tx) => {
    tx.objectStore("positions").delete(id);
    return tx.objectStore("books").delete(id);
  });

export const defaultSettings = Object.freeze({
  theme: "night",
  fontSize: 20,
  font: "serif",
  mode: "rsvp",
  speed: 300,
});

function normalizeSettings(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    theme: ["paper", "sepia", "night"].includes(source.theme)
      ? source.theme
      : defaultSettings.theme,
    fontSize: Math.round(
      Math.min(32, Math.max(16, Number(source.fontSize) || 20)),
    ),
    font: source.font === "sans" ? "sans" : "serif",
    mode: ["classic", "focus", "rsvp"].includes(source.mode)
      ? source.mode
      : defaultSettings.mode,
    speed: Math.min(800, Math.max(100, Number(source.speed) || 300)),
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
  // The mobile reader starts with its new defaults once. Keep existing font and cadence.
  const settings = normalizeSettings({
    ...legacy,
    theme: defaultSettings.theme,
    mode: defaultSettings.mode,
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
