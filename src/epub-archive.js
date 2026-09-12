import { t } from "./i18n.js";
import { openZip, readText, readImage } from "./epub-archive-core.js";

async function localReader(buffer) {
  const translated = async (task) => { try { return await task(); } catch (error) { error.message = t(error.message); throw error; } };
  const zip = await translated(() => openZip(buffer));
  return {
    file: (path) => zip.file(path),
    files: zip.files,
    readText: (path) => translated(() => readText(zip, path)),
    readImage: (path) => translated(() => readImage(zip, path)),
    dispose() {},
  };
}

function workerUnavailable() {
  const error = new Error(t("Le traitement EPUB en arrière-plan est indisponible."));
  error.code = "WORKER_UNAVAILABLE";
  return error;
}

async function workerReader(buffer) {
  let worker;
  try {
    worker = new Worker(new URL("./epub-archive.worker.js", import.meta.url), {
      type: "module",
      name: "epub-import",
    });
  } catch {
    throw workerUnavailable();
  }
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  const dispose = (error = new Error(t("Le traitement de l’EPUB est terminé."))) => {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(t(data.error)));
    else request.resolve(data.result);
  });
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    dispose(workerUnavailable());
  });
  worker.addEventListener("messageerror", () => dispose(workerUnavailable()));
  const request = (method, payload) => new Promise((resolve, reject) => {
    if (closed) return reject(workerUnavailable());
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    try {
      // Keep the original buffer intact: it is saved with the book for export.
      worker.postMessage({ id, method, payload });
    } catch {
      dispose(workerUnavailable());
    }
  });
  try {
    const entries = await request("open", buffer);
    const files = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    return {
      file: (path) => Object.hasOwn(files, path) && !files[path].dir ? files[path] : null,
      files,
      readText: (path) => request("text", path),
      readImage: (path) => request("image", path),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Same limits and validation with or without worker support. */
export async function createArchiveReader(buffer, { worker = true } = {}) {
  if (worker && typeof Worker === "function") {
    try {
      return await workerReader(buffer);
    } catch (error) {
      // An unavailable Worker can fall back; invalid ZIP/size errors must never
      // trigger a second attempt to decompress hostile or corrupt archives.
      if (error.code !== "WORKER_UNAVAILABLE") throw error;
    }
  }
  return localReader(buffer);
}
