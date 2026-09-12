import JSZip from "jszip";
import { applyFocus, importEpub } from "./epub.js";
import { isReadingPosition, normalizePosition } from "./reading-state.js";
import { mergeLibrarySnapshot, normalizeSettings, readLibrarySnapshot } from "./storage.js";

export const BACKUP_LIMITS = Object.freeze({ archive: 250 * 1024 ** 2, expanded: 300 * 1024 ** 2, epub: 30 * 1024 ** 2, manifest: 16 * 1024 ** 2, inline: 4 * 1024 ** 2, books: 500 });
const FORMAT = "fastreader-backup";
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const string = (value, limit = 2000) => typeof value === "string" ? value.slice(0, limit) : "";
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value);
const error = (message = "Cette archive n’est pas une sauvegarde FastReader valide.") => new Error(message);
const bytesOf = async (value) => {
  if (typeof value?.arrayBuffer === "function") return value.arrayBuffer();
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value).slice().buffer;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(error("Impossible de lire ce fichier de sauvegarde."));
    reader.readAsArrayBuffer(value);
  });
};
const textBytes = (value) => new TextEncoder().encode(JSON.stringify(value));

function safeUrl(value, image = false) {
  const text = string(value, image ? 4 * 1024 ** 2 : 4000);
  if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/u.test(text)) return text;
  if (/^\/(?!\/)/u.test(text)) return text;
  if (/^(?:\.\/)?books\/[A-Za-z0-9_./-]+$/u.test(text) && !text.split("/").includes("..")) return text;
  try { const url = new URL(text); return url.protocol === "https:" || url.protocol === "http:" ? url.href : ""; }
  catch { return ""; }
}

function sourceMetadata(value) {
  if (!record(value)) return undefined;
  const result = {};
  for (const key of ["name", "providerId", "bookId", "rights", "canonicalSourceId", "selection"])
    if (typeof value[key] === "string") result[key] = string(value[key]);
  for (const key of ["url", "rightsUrl"]) if (value[key]) result[key] = safeUrl(value[key]);
  if (record(value.readingStart)) result.readingStart = { chapterId: string(value.readingStart.chapterId, 512), exact: string(value.readingStart.exact, 2000) };
  if (record(value.presentation) && value.presentation.version === 1) result.presentation = {
    version: 1, key: string(value.presentation.key), title: string(value.presentation.title), author: string(value.presentation.author), image: safeUrl(value.presentation.image, true) || null,
  };
  return result;
}

function preferencesOf(values) {
  if (!Array.isArray(values) || values.length > 50) throw error();
  const seen = new Set();
  return values.flatMap((value) => {
    if (!record(value) || typeof value.id !== "string" || seen.has(value.id)) throw error();
    seen.add(value.id);
    if (value.id === "reader") return [{ id: "reader", ...normalizeSettings(value) }];
    if (value.id === "suggestions") return [{ id: "suggestions", ids: Array.isArray(value.ids) ? [...new Set(value.ids.filter((id) => typeof id === "string" && id.length <= 120))].slice(0, 9) : [] }];
    // Explicitly allow the optional onboarding flag, never arbitrary imported state.
    if (value.id === "onboarding") return [{ id: "onboarding", completed: value.completed === true }];
    return [];
  });
}

function inlineBook(value, id) {
  if (!record(value) || value.demo !== true || !id.startsWith("fastreader-demo-") || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 1000) throw error("Un livre sans EPUB original ne peut pas être restauré depuis cette archive.");
  const ids = new Set();
  const chapters = value.chapters.map((chapter) => {
    if (!record(chapter) || !validId(chapter.id) || ids.has(chapter.id) || typeof chapter.html !== "string" || chapter.html.length > BACKUP_LIMITS.inline) throw error();
    ids.add(chapter.id);
    const html = applyFocus(chapter.html, false);
    const content = document.createElement("template");
    content.innerHTML = html;
    const wordCount = (content.content.textContent.match(/\p{L}[\p{L}\p{M}\p{N}'’\-]*/gu) || []).length;
    return { id: chapter.id, title: string(chapter.title), html, wordCount };
  });
  return { id, title: string(value.title) || "Livre de démonstration", author: string(value.author), language: string(value.language, 32), cover: safeUrl(value.cover, true), chapters, totalWords: chapters.reduce((total, chapter) => total + chapter.wordCount, 0), demo: true };
}

/** Inspect central-directory sizes before JSZip sees compressed content. ZIP64 is deliberately excluded. */
function inspectArchive(buffer) {
  if (buffer.byteLength > BACKUP_LIMITS.archive || buffer.byteLength < 22) throw error("Choisissez une sauvegarde ZIP de moins de 250 Mo.");
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === buffer.byteLength) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw error();
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (!count || count > BACKUP_LIMITS.books + 1 || count !== view.getUint16(end + 8, true) || start + size !== end) throw error();
  const entries = new Map();
  let offset = start;
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw error();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const unpacked = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (flags & 1 || ![0, 8].includes(method) || next > end || local + 30 > start || view.getUint32(local, true) !== 0x04034b50) throw error();
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLength));
    if (!/^(?:manifest\.json|books\/[0-9]{4}\.(?:epub|json))$/u.test(name) || entries.has(name)) throw error();
    const limit = name === "manifest.json" ? BACKUP_LIMITS.manifest : name.endsWith(".epub") ? BACKUP_LIMITS.epub : BACKUP_LIMITS.inline;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (unpacked > limit || compressed > BACKUP_LIMITS.archive || dataStart + compressed > start) throw error("La sauvegarde contient un fichier trop volumineux ou endommagé.");
    expanded += unpacked;
    if (expanded > BACKUP_LIMITS.expanded) throw error("Cette sauvegarde est trop volumineuse pour être restaurée en une fois.");
    entries.set(name, { size: unpacked, crc: view.getUint32(offset + 16, true), limit });
    offset = next;
  }
  if (offset !== end || !entries.has("manifest.json")) throw error();
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

/** Stop decompression as soon as a forged directory understates the true size. */
function readEntry(zip, name, metadata) {
  return new Promise((resolve, reject) => {
    const entry = zip.file(name);
    if (!entry || !metadata) { reject(error()); return; }
    let size = 0;
    let crc = 0xffffffff;
    const chunks = [];
    let failed = false;
    const stream = entry.internalStream("uint8array");
    stream.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > metadata.size || size > metadata.limit) {
        failed = true;
        stream.pause();
        reject(error("La taille réelle d’un fichier dépasse celle annoncée par la sauvegarde."));
        return;
      }
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
      chunks.push(chunk);
    });
    stream.on("error", () => { failed = true; reject(error("La sauvegarde est endommagée.")); });
    stream.on("end", () => {
      if (failed) return;
      if (size !== metadata.size || ((crc ^ 0xffffffff) >>> 0) !== metadata.crc) { reject(error("La sauvegarde est endommagée.")); return; }
      const output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      resolve(output);
    });
    stream.resume();
  });
}

export async function exportBackup({ onProgress } = {}) {
  const snapshot = await readLibrarySnapshot();
  if (snapshot.books.length > BACKUP_LIMITS.books) throw error("Cette bibliothèque dépasse la limite de 500 livres par sauvegarde.");
  const zip = new JSZip();
  const manifest = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), books: [], positions: [], preferences: preferencesOf(snapshot.preferences) };
  const positions = new Map(snapshot.positions.map((item) => [item.id, item]));
  let expanded = 0;
  for (const [index, book] of snapshot.books.entries()) {
    if (!validId(book.id)) throw error("Un identifiant de livre est invalide. Aucun fichier n’a été exporté.");
    const kind = book.original ? "epub" : "inline";
    const path = `books/${String(index).padStart(4, "0")}.${kind === "epub" ? "epub" : "json"}`;
    const bytes = kind === "epub" ? new Uint8Array(await bytesOf(book.original)) : textBytes(inlineBook(book, book.id));
    if (bytes.length > (kind === "epub" ? BACKUP_LIMITS.epub : BACKUP_LIMITS.inline)) throw error("Un livre dépasse la taille autorisée pour la sauvegarde.");
    expanded += bytes.length;
    if (expanded > BACKUP_LIMITS.archive - BACKUP_LIMITS.manifest) throw error("Cette bibliothèque dépasse la limite de 250 Mo par sauvegarde.");
    zip.file(path, bytes, { createFolders: false, compression: "STORE" });
    manifest.books.push({ id: book.id, kind, path, fileName: string(book.fileName, 240), addedAt: book.addedAt, source: sourceMetadata(book.source) });
    if (positions.has(book.id)) manifest.positions.push({ ...normalizePosition(positions.get(book.id), book), id: book.id });
    onProgress?.({ completed: index + 1, total: snapshot.books.length, message: `Préparation : ${index + 1} / ${snapshot.books.length} livres` });
  }
  const metadata = textBytes(manifest);
  if (metadata.length > BACKUP_LIMITS.manifest) throw error("Les notes et métadonnées dépassent la taille autorisée pour une sauvegarde.");
  zip.file("manifest.json", metadata, { compression: "DEFLATE" });
  const bytes = await zip.generateAsync({ type: "uint8array" }, ({ percent }) => onProgress?.({ percent, message: `Création du ZIP : ${Math.round(percent)} %` }));
  if (bytes.length > BACKUP_LIMITS.archive) throw error("La sauvegarde dépasse la limite de 250 Mo.");
  return { blob: new Blob([bytes], { type: "application/zip" }), fileName: `fastreader-sauvegarde-${manifest.createdAt.slice(0, 10)}.zip`, bookCount: snapshot.books.length };
}

export async function restoreBackup(file, { restorePreferences = false, onProgress } = {}) {
  if (typeof file?.size === "number" && file.size > BACKUP_LIMITS.archive) throw error("Choisissez une sauvegarde ZIP de moins de 250 Mo.");
  const buffer = await bytesOf(file);
  const entries = inspectArchive(buffer);
  let zip;
  let manifest;
  try {
    zip = await JSZip.loadAsync(buffer);
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEntry(zip, "manifest.json", entries.get("manifest.json"))));
  } catch (cause) { throw error(cause?.message?.includes("sauvegarde") ? cause.message : undefined); }
  if (!record(manifest) || manifest.format !== FORMAT || manifest.version !== 1 || !Array.isArray(manifest.books) || manifest.books.length > BACKUP_LIMITS.books || !Array.isArray(manifest.positions) || manifest.positions.length > manifest.books.length) throw error();
  const snapshot = { books: [], positions: [], preferences: preferencesOf(manifest.preferences) };
  const ids = new Set();
  const paths = new Set(["manifest.json"]);
  for (const item of manifest.books) {
    if (!record(item) || !validId(item.id) || ids.has(item.id) || !["epub", "inline"].includes(item.kind) || typeof item.path !== "string" || paths.has(item.path) || !entries.has(item.path) || !item.path.endsWith(item.kind === "epub" ? ".epub" : ".json")) throw error();
    ids.add(item.id); paths.add(item.path);
  }
  if (entries.size !== paths.size) throw error("La sauvegarde contient des fichiers inattendus.");
  const positions = new Map();
  for (const position of manifest.positions) {
    if (!isReadingPosition(position) || !ids.has(position.id) || positions.has(position.id)) throw error();
    positions.set(position.id, position);
  }
  const importedIds = new Set();
  let preparedBytes = 0;
  for (const [index, item] of manifest.books.entries()) {
    onProgress?.({ completed: index, total: manifest.books.length, message: `Vérification : ${index + 1} / ${manifest.books.length} livres` });
    const bytes = await readEntry(zip, item.path, entries.get(item.path));
    let book;
    if (item.kind === "epub") {
      book = await importEpub(new File([bytes], string(item.fileName, 240) || "livre.epub", { type: "application/epub+zip" }));
    } else {
      try { book = inlineBook(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), item.id); }
      catch { throw error("Le livre de démonstration de cette sauvegarde est invalide."); }
    }
    if (importedIds.has(book.id)) throw error("La sauvegarde contient deux copies du même EPUB.");
    importedIds.add(book.id);
    preparedBytes += (book.original?.byteLength || 0) + (book.cover?.length || 0) * 2;
    for (const chapter of book.chapters) preparedBytes += chapter.html.length * 2;
    if (preparedBytes > BACKUP_LIMITS.expanded) throw error("Les livres décompressés dépassent la limite de 300 Mo pour cette restauration. Aucune donnée n’a été modifiée.");
    const addedAt = typeof item.addedAt === "number" || (typeof item.addedAt === "string" && /^\d+$/u.test(item.addedAt)) ? Number(item.addedAt) : Date.parse(item.addedAt);
    book.addedAt = Number.isFinite(addedAt) && addedAt > 0 ? addedAt : Date.now();
    const source = sourceMetadata(item.source);
    if (source) book.source = source;
    snapshot.books.push(book);
    if (positions.has(item.id)) snapshot.positions.push({ ...normalizePosition(positions.get(item.id), book), id: book.id });
  }
  onProgress?.({ completed: manifest.books.length, total: manifest.books.length, message: "Enregistrement de la bibliothèque…" });
  return mergeLibrarySnapshot(snapshot, { restorePreferences });
}
