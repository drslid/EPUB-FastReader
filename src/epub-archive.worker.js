import { openZip, readText, readImage } from "./epub-archive-core.js";

// Only ZIP bytes and strings cross this boundary. Untrusted HTML is sanitized
// later by DOMPurify in the document, never by a worker-side substitute.
let archive;
self.addEventListener("message", async ({ data }) => {
  const { id, method, payload } = data;
  try {
    let result;
    if (method === "open") {
      archive = await openZip(payload);
      result = Object.values(archive.files).map(({ name, dir }) => ({ name, dir }));
    } else if (!archive) {
      throw new Error("L’archive EPUB n’est pas ouverte.");
    } else if (method === "text") {
      result = await readText(archive, payload);
    } else if (method === "image") {
      result = await readImage(archive, payload);
    } else {
      throw new Error("Cette opération EPUB n’est pas prise en charge.");
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || "L’EPUB n’a pas pu être lu." });
  }
});
