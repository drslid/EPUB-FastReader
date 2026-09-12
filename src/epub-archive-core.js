import JSZip from "jszip";

export const EPUB_MIME = "application/epub+zip";
export const LIMITS = {
  archive: 30 * 1024 * 1024,
  expanded: 160 * 1024 * 1024,
  entry: 16 * 1024 * 1024,
  chapter: 4 * 1024 * 1024,
  files: 5000,
  chapters: 1000,
};

function invalid(message) { return new Error(message); }

// Read ZIP directory sizes before decompression, including entries not in the spine.
export function inspectZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw invalid("Ce fichier n’est pas une archive EPUB valide.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const directorySize = view.getUint32(end + 12, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count === 65535 ||
    offset === 0xffffffff
  ) {
    throw invalid(
      "Les archives EPUB multi-volumes ou ZIP64 ne sont pas prises en charge.",
    );
  }
  if (!count || count > LIMITS.files || offset + directorySize > end)
    throw invalid(
      "Cette archive EPUB contient trop de fichiers ou un index invalide.",
    );
  const directoryEnd = offset + directorySize;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > directoryEnd ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw invalid("L’index de cette archive EPUB est endommagé.");
    if (view.getUint16(offset + 8, true) & 1)
      throw invalid(
        "Ce livre est chiffré ou protégé par DRM. Importez un EPUB sans DRM.",
      );
    const size = view.getUint32(offset + 24, true);
    total += size;
    if (size > LIMITS.entry || total > LIMITS.expanded)
      throw invalid(
        "Ce livre dépasse la limite de décompression (16 Mo par fichier, 160 Mo au total).",
      );
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (offset > directoryEnd)
      throw invalid("L’index de cette archive EPUB est endommagé.");
  }
  if (offset !== directoryEnd)
    throw invalid("L’index de cette archive EPUB est invalide.");
}

// Streaming prevents an entry with forged size metadata from allocating without a bound.
export function readBytes(entry, limit = LIMITS.entry) {
  if (!entry)
    throw invalid("Un fichier nécessaire au livre est absent de l’archive.");
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks = [];
    const stream = entry.internalStream("uint8array");
    stream.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        stream.pause();
        reject(invalid("Un fichier du livre dépasse la taille autorisée."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => {
      failed = true;
      reject(invalid("Un fichier de l’EPUB est corrompu ou illisible."));
    });
    stream.on("end", () => {
      if (failed) return;
      const result = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        result.set(chunk, at);
        at += chunk.length;
      }
      resolve(result);
    });
    stream.resume();
  });
}

export async function readText(zip, path) {
  const bytes = await readBytes(zip.file(path), LIMITS.chapter);
  // EPUB XML is usually UTF-8; UTF-16 BOMs are also valid.
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? "utf-16le"
      : bytes[0] === 254 && bytes[1] === 255
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}

function imageMime(bytes) {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    new TextDecoder().decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/)
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function openZip(buffer) {
  if (buffer.byteLength > LIMITS.archive)
    throw invalid("Ce livre est trop volumineux. La limite est de 30 Mo.");
  inspectZip(buffer);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw invalid("Impossible d’ouvrir cet EPUB : archive endommagée ou protégée.");
  }
  for (const entry of Object.values(zip.files)) {
    const original = entry.unsafeOriginalName || entry.name;
    if (
      original.startsWith("/") || original.includes("\\") ||
      original.split("/").includes("..") || /[\u0000-\u001f]/.test(original)
    ) throw invalid("L’archive contient un chemin de fichier non sûr.");
  }
  if (!zip.file("mimetype") || (await readText(zip, "mimetype")).trim() !== EPUB_MIME)
    throw invalid("Ce fichier n’est pas un livre au format EPUB.");
  return zip;
}

export async function readImage(zip, path) {
  if (!path || !zip.file(path)) return "";
  const bytes = await readBytes(zip.file(path));
  const mime = imageMime(bytes);
  return mime ? `data:${mime};base64,${base64(bytes)}` : "";
}
