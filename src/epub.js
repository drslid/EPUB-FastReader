import JSZip from "jszip";
import DOMPurify from "dompurify";

const EPUB_MIME = "application/epub+zip";
const LIMITS = {
  archive: 30 * 1024 * 1024,
  expanded: 160 * 1024 * 1024,
  entry: 16 * 1024 * 1024,
  chapter: 4 * 1024 * 1024,
  files: 5000,
  chapters: 1000,
};
const XHTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const FONT_OBFUSCATION = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);
const SAFE_TAGS = [
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
];
const SAFE_ATTRIBUTES = [
  "alt",
  "class",
  "colspan",
  "dir",
  "height",
  "href",
  "id",
  "lang",
  "role",
  "rowspan",
  "scope",
  "start",
  "title",
  "type",
  "value",
  "width",
  "epub:type",
  "data-epub-src",
];
const WORDS = /\p{L}[\p{L}\p{M}\p{N}'’\-]*/gu;
const RASTER_DATA =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/;

function invalid(message) {
  return new Error(message);
}

function elements(node, name) {
  return [...node.getElementsByTagNameNS("*", name)];
}

function parseXml(source, label) {
  // External entities are unnecessary for EPUB metadata and must never be resolved.
  if (/<!ENTITY\s/i.test(source))
    throw invalid(`${label} contient des entités XML non prises en charge.`);
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (elements(doc, "parsererror").length)
    throw invalid(`${label} est invalide ou illisible.`);
  return doc;
}

function textOf(node, name, fallback = "") {
  return elements(node, name)[0]?.textContent.trim() || fallback;
}

/** Resolve an EPUB URL without allowing protocols or traversal outside its ZIP. */
function archivePath(base, reference) {
  if (typeof reference !== "string" || /[\u0000-\u0020\\]/.test(reference))
    return null;
  const resource = reference.split(/[?#]/, 1)[0];
  if (/^[a-z][a-z\d+.-]*:/i.test(resource) || resource.startsWith("/"))
    return null;
  const parts = resource ? base.split("/").slice(0, -1) : base.split("/");
  if (!resource) return parts.join("/");
  for (const part of resource.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (
      /[\u0000-\u001f\\/]/.test(decoded) ||
      /^[a-z][a-z\d+.-]*:/i.test(decoded)
    )
      return null;
    if (!decoded || decoded === ".") continue;
    if (decoded === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(decoded);
  }
  return parts.join("/");
}

function fragmentOf(href) {
  try {
    return decodeURIComponent(href.split("#").slice(1).join("#"));
  } catch {
    return "";
  }
}

function readerAnchor(chapterId, anchor) {
  return anchor ? `${chapterId}--${encodeURIComponent(anchor)}` : chapterId;
}

// Read ZIP directory sizes before decompression, including entries not in the spine.
function inspectZip(buffer) {
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

async function fileBuffer(file) {
  if (typeof file?.arrayBuffer === "function") return file.arrayBuffer();
  if (!(file instanceof Blob)) throw invalid("Choisissez un fichier EPUB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(invalid("Le fichier n’a pas pu être lu."));
    reader.readAsArrayBuffer(file);
  });
}

// Streaming prevents an entry with forged size metadata from allocating without a bound.
function readBytes(entry, limit = LIMITS.entry) {
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

async function readText(zip, path) {
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

async function openArchive(buffer) {
  if (buffer.byteLength > LIMITS.archive)
    throw invalid("Ce livre est trop volumineux. La limite est de 30 Mo.");
  inspectZip(buffer);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw invalid(
      "Impossible d’ouvrir cet EPUB : archive endommagée ou protégée.",
    );
  }
  for (const entry of Object.values(zip.files)) {
    const original = entry.unsafeOriginalName || entry.name;
    if (
      original.startsWith("/") ||
      original.includes("\\") ||
      original.split("/").includes("..") ||
      /[\u0000-\u001f]/.test(original)
    ) {
      throw invalid("L’archive contient un chemin de fichier non sûr.");
    }
  }
  if (
    !zip.file("mimetype") ||
    (await readText(zip, "mimetype")).trim() !== EPUB_MIME
  )
    throw invalid("Ce fichier n’est pas un livre au format EPUB.");
  if (zip.file("META-INF/encryption.xml")) {
    const encryption = parseXml(
      await readText(zip, "META-INF/encryption.xml"),
      "Le fichier de chiffrement",
    );
    const methods = elements(encryption, "EncryptionMethod");
    if (
      !methods.length ||
      methods.some(
        (method) => !FONT_OBFUSCATION.has(method.getAttribute("Algorithm")),
      )
    ) {
      throw invalid("Ce livre est protégé par DRM. Importez un EPUB sans DRM.");
    }
  }
  const container = parseXml(
    await readText(zip, "META-INF/container.xml"),
    "Le conteneur EPUB",
  );
  const root =
    elements(container, "rootfile").find(
      (node) =>
        node.getAttribute("media-type") === "application/oebps-package+xml",
    ) || elements(container, "rootfile")[0];
  const opfPath = archivePath("", root?.getAttribute("full-path"));
  if (!opfPath) throw invalid("Le catalogue interne du livre est introuvable.");
  const opf = parseXml(
    await readText(zip, opfPath),
    "Le catalogue interne du livre",
  );
  const manifest = new Map();
  for (const item of elements(opf, "item")) {
    const id = item.getAttribute("id");
    if (!id || manifest.has(id))
      throw invalid(
        "Le catalogue du livre contient un identifiant manquant ou dupliqué.",
      );
    manifest.set(id, {
      id,
      path: archivePath(opfPath, item.getAttribute("href")),
      type: item.getAttribute("media-type"),
      properties: (item.getAttribute("properties") || "").split(/\s+/),
    });
  }
  const spineNodes = elements(opf, "itemref");
  if (!spineNodes.length || spineNodes.length > LIMITS.chapters)
    throw invalid(
      "Le livre ne contient aucun chapitre ou dépasse la limite de 1 000 chapitres.",
    );
  const spine = spineNodes.map((node, index) => {
    const item = manifest.get(node.getAttribute("idref"));
    if (!item?.path || !zip.file(item.path))
      throw invalid("Un chapitre référencé dans le livre est introuvable.");
    if (!XHTML_TYPES.has(item.type))
      throw invalid(
        "Ce livre contient un chapitre dans un format non pris en charge (seuls les chapitres XHTML sont acceptés).",
      );
    return { ...item, chapterId: `chapter-${index + 1}` };
  });
  return { zip, opf, manifest, spine };
}

function sanitizedBody(source) {
  // Template contents have no browsing context. Remove fetching attributes before
  // giving the inert tree to the sanitizer, so even remote tracking pixels stay inert.
  const template = document.createElement("template");
  template.innerHTML = source;
  for (const element of template.content.querySelectorAll(
    "script,style,link,iframe,object,embed,svg,math,template,base,meta,title",
  ))
    element.remove();
  for (const element of template.content.querySelectorAll("*")) {
    if (element.tagName === "IMG")
      element.setAttribute("data-epub-src", element.getAttribute("src") || "");
    else element.removeAttribute("data-epub-src");
    for (const attribute of ["src", "srcset", "poster", "background", "style"])
      element.removeAttribute(attribute);
  }
  const body = DOMPurify.sanitize(template.content, {
    ALLOWED_TAGS: SAFE_TAGS,
    ALLOWED_ATTR: SAFE_ATTRIBUTES,
    ADD_URI_SAFE_ATTR: ["data-epub-src"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    FORBID_CONTENTS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
      "template",
    ],
    RETURN_DOM: true,
  });
  for (const element of body.querySelectorAll("[class]")) {
    if (
      element.tagName === "STRONG" &&
      element.classList.contains("focus-prefix")
    )
      element.className = "focus-prefix";
    else element.removeAttribute("class");
  }
  return body;
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

function imageLoader(zip) {
  const cache = new Map();
  return async (path) => {
    if (!path || !zip.file(path)) return "";
    if (!cache.has(path)) {
      cache.set(
        path,
        readBytes(zip.file(path)).then((bytes) => {
          const mime = imageMime(bytes);
          return mime ? `data:${mime};base64,${base64(bytes)}` : "";
        }),
      );
    }
    return cache.get(path);
  };
}

async function navigationTitles(archive) {
  const titles = new Map();
  const { manifest, zip } = archive;
  const navigation = [...manifest.values()].find((item) =>
    item.properties.includes("nav"),
  );
  if (navigation?.path && zip.file(navigation.path)) {
    const body = sanitizedBody(await readText(zip, navigation.path));
    const navs = [...body.querySelectorAll("nav")];
    const toc =
      navs.find((nav) =>
        (nav.getAttribute("epub:type") || "").split(/\s+/).includes("toc"),
      ) ||
      navs[0] ||
      body;
    for (const link of toc.querySelectorAll("a[href]")) {
      const path = archivePath(navigation.path, link.getAttribute("href"));
      if (path && !titles.has(path) && link.textContent.trim())
        titles.set(path, link.textContent.trim());
    }
  }
  const ncx = [...manifest.values()].find(
    (item) => item.type === "application/x-dtbncx+xml",
  );
  if (ncx?.path && zip.file(ncx.path)) {
    const document = parseXml(
      await readText(zip, ncx.path),
      "La table des matières",
    );
    for (const point of elements(document, "navPoint")) {
      const path = archivePath(
        ncx.path,
        elements(point, "content")[0]?.getAttribute("src"),
      );
      const title = textOf(point, "text");
      if (path && title && !titles.has(path)) titles.set(path, title);
    }
  }
  return titles;
}

async function prepareBody(
  source,
  item,
  archive,
  loadImage,
  forExport = false,
) {
  const body = sanitizedBody(source);
  const chapterByPath = new Map(
    archive.spine.map((chapter) => [chapter.path, chapter.chapterId]),
  );
  for (const img of body.querySelectorAll("img")) {
    const originalSrc = img.getAttribute("data-epub-src");
    img.removeAttribute("data-epub-src");
    const path = archivePath(item.path, originalSrc);
    const data = await loadImage(path);
    if (data) {
      img.setAttribute("src", forExport ? originalSrc : data);
      if (!forExport) {
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
      }
    } else {
      const fallback = body.ownerDocument.createElement("span");
      fallback.textContent =
        img.getAttribute("alt") ||
        "Illustration indisponible (format non pris en charge ou image absente).";
      img.replaceWith(fallback);
    }
  }
  for (const link of body.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    const targetPath = archivePath(item.path, href);
    const chapterId = chapterByPath.get(targetPath);
    if (forExport && targetPath && archive.zip.file(targetPath)) continue;
    if (!forExport && chapterId)
      link.setAttribute(
        "href",
        `#${readerAnchor(chapterId, fragmentOf(href))}`,
      );
    else link.removeAttribute("href");
  }
  if (!forExport) {
    for (const element of body.querySelectorAll("[id]"))
      element.id = readerAnchor(item.chapterId, element.id);
  }
  return body;
}

function focusBody(body, enabled) {
  for (const prefix of body.querySelectorAll("strong.focus-prefix"))
    prefix.replaceWith(...prefix.childNodes);
  body.normalize();
  if (!enabled) return;
  const document = body.ownerDocument;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (
      !walker.currentNode.parentElement?.closest(
        "pre, code, kbd, samp, rt, script, style",
      )
    )
      nodes.push(walker.currentNode);
  }
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  for (const node of nodes) {
    const text = node.nodeValue;
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(WORDS)) {
      fragment.append(document.createTextNode(text.slice(last, match.index)));
      const word = match[0];
      const letters = segmenter
        ? [...segmenter.segment(word)].map((part) => part.segment)
        : Array.from(word);
      const length = Math.ceil(letters.length / 2);
      const prefix = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "strong",
      );
      prefix.setAttribute("class", "focus-prefix");
      prefix.textContent = letters.slice(0, length).join("");
      fragment.append(
        prefix,
        document.createTextNode(letters.slice(length).join("")),
      );
      last = match.index + word.length;
    }
    if (last) {
      fragment.append(document.createTextNode(text.slice(last)));
      node.replaceWith(fragment);
    }
  }
}

/** Toggle word-prefix emphasis without rewriting markup or changing whitespace. */
export function applyFocus(html, enabled = true) {
  const body = sanitizedBody(html);
  for (const element of body.querySelectorAll("[href]")) {
    if (!element.getAttribute("href").startsWith("#"))
      element.removeAttribute("href");
  }
  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("data-epub-src") || "";
    img.removeAttribute("data-epub-src");
    if (RASTER_DATA.test(src)) {
      img.setAttribute("src", src);
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
    } else img.remove();
  }
  focusBody(body, enabled);
  return body.innerHTML;
}

async function contentId(buffer) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  // Deterministic identifier on older/non-secure browsers, not a security digest.
  let hash = 2166136261;
  for (const byte of new Uint8Array(buffer))
    hash = Math.imul(hash ^ byte, 16777619);
  return `epub-${buffer.byteLength}-${(hash >>> 0).toString(16)}`;
}

/** Import EPUB 2/3 locally; no book-controlled markup is attached to the live DOM. */
export async function importEpub(file) {
  if (!file || file.size > LIMITS.archive)
    throw invalid("Choisissez un fichier EPUB de moins de 30 Mo.");
  const original = await fileBuffer(file);
  const archive = await openArchive(original);
  const { opf, spine, manifest, zip } = archive;
  const loadImage = imageLoader(zip);
  const titles = await navigationTitles(archive);
  const chapters = [];
  for (const item of spine) {
    const body = await prepareBody(
      await readText(zip, item.path),
      item,
      archive,
      loadImage,
    );
    const title =
      titles.get(item.path) ||
      body.querySelector("h1, h2, h3")?.textContent.trim() ||
      `Chapitre ${chapters.length + 1}`;
    const countable = body.cloneNode(true);
    for (const block of countable.querySelectorAll(
      "p,div,section,article,li,dd,dt,h1,h2,h3,h4,h5,h6,br,td,th,blockquote",
    ))
      block.append(" ");
    chapters.push({
      id: item.chapterId,
      title,
      html: body.innerHTML,
      wordCount: (countable.textContent.match(WORDS) || []).length,
    });
  }
  const coverId = elements(opf, "meta")
    .find((node) => node.getAttribute("name") === "cover")
    ?.getAttribute("content");
  const coverItem =
    [...manifest.values()].find((item) =>
      item.properties.includes("cover-image"),
    ) || manifest.get(coverId);
  const fileName = file.name || "livre.epub";
  return {
    id: await contentId(original),
    title: textOf(opf, "title", fileName.replace(/\.epub$/i, "")),
    author:
      elements(opf, "creator")
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(", ") || "Auteur inconnu",
    language: textOf(opf, "language", "fr"),
    cover: await loadImage(coverItem?.path),
    chapters,
    totalWords: chapters.reduce(
      (total, chapter) => total + chapter.wordCount,
      0,
    ),
    original,
    fileName,
    addedAt: Date.now(),
  };
}

/** Preserve archive assets and package metadata, replacing only readable XHTML. */
export async function exportFocusedEpub(book) {
  if (!book?.original)
    throw invalid(
      "Le fichier EPUB original est nécessaire pour l’export. Réimportez ce livre.",
    );
  const archive = await openArchive(book.original);
  const output = new JSZip();
  // OCF requires the first entry to be the uncompressed, exact mimetype value.
  output.file("mimetype", EPUB_MIME, { compression: "STORE" });
  const loadImage = imageLoader(archive.zip);
  const replacements = new Map();
  for (const item of archive.manifest.values()) {
    if (
      !XHTML_TYPES.has(item.type) ||
      !item.path ||
      !archive.zip.file(item.path)
    )
      continue;
    const body = await prepareBody(
      await readText(archive.zip, item.path),
      item,
      archive,
      loadImage,
      true,
    );
    if (!item.properties.includes("nav")) focusBody(body, true);
    const document = window.document.implementation.createDocument(
      "http://www.w3.org/1999/xhtml",
      "html",
    );
    document.documentElement.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:lang",
      book.language || "fr",
    );
    document.documentElement.setAttributeNS(
      "http://www.w3.org/2000/xmlns/",
      "xmlns:epub",
      "http://www.idpf.org/2007/ops",
    );
    const head = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "head",
    );
    const title = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "title",
    );
    title.textContent = book.title || "Livre";
    head.append(title);
    document.documentElement.append(head, document.importNode(body, true));
    replacements.set(
      item.path,
      `<?xml version="1.0" encoding="UTF-8"?>${new XMLSerializer().serializeToString(document)}`,
    );
  }
  for (const entry of Object.values(archive.zip.files)) {
    // Existing signatures no longer describe the modified book.
    if (entry.name === "mimetype" || entry.name === "META-INF/signatures.xml")
      continue;
    if (entry.dir) output.folder(entry.name);
    else
      output.file(
        entry.name,
        replacements.get(entry.name) ?? (await readBytes(entry)),
        { createFolders: false, compression: "DEFLATE" },
      );
  }
  return output.generateAsync({
    type: "blob",
    mimeType: EPUB_MIME,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
