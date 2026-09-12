import { t, formatNumber } from "./i18n.js";
import JSZip from "jszip";
import DOMPurify from "dompurify";

import { EPUB_MIME, LIMITS, readBytes } from "./epub-archive-core.js";
import { createArchiveReader } from "./epub-archive.js";

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
  return new Error(t(message));
}

function elements(node, name) {
  return [...node.getElementsByTagNameNS("*", name)];
}

function parseXml(source, label) {
  // External entities are unnecessary for EPUB metadata and must never be resolved.
  if (/<!ENTITY\s/i.test(source))
    throw invalid(t("{label} contient des entités XML non prises en charge.", { label: t(label) }));
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (elements(doc, "parsererror").length)
    throw invalid(t("{label} est invalide ou illisible.", { label: t(label) }));
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

async function openArchive(buffer, options) {
  const zip = await createArchiveReader(buffer, options);
  try {
    if (zip.file("META-INF/encryption.xml")) {
      const encryption = parseXml(
        await zip.readText("META-INF/encryption.xml"),
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
      await zip.readText("META-INF/container.xml"),
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
      await zip.readText(opfPath),
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
  } catch (error) {
    zip.dispose();
    throw error;
  }
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

function imageLoader(zip) {
  const cache = new Map();
  return async (path) => {
    if (!path || !zip.file(path)) return "";
    if (!cache.has(path)) cache.set(path, zip.readImage(path));
    return cache.get(path);
  };
}

// Yield between DOM phases and chapters, so input/paint can run on mobile.
// DOMParser and DOMPurify deliberately stay in the document realm.
async function yieldToBrowser() {
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else await new Promise((resolve) => setTimeout(resolve, 0));
}

async function navigationTitles(archive) {
  const titles = new Map();
  const { manifest, zip } = archive;
  const navigation = [...manifest.values()].find((item) =>
    item.properties.includes("nav"),
  );
  if (navigation?.path && zip.file(navigation.path)) {
    const body = sanitizedBody(await zip.readText(navigation.path));
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
      await zip.readText(ncx.path),
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
  await yieldToBrowser();
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
  let processed = 0;
  for (const link of body.querySelectorAll("a[href]")) {
    if (++processed % 256 === 0) await yieldToBrowser();
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
    for (const element of body.querySelectorAll("[id]")) {
      if (++processed % 256 === 0) await yieldToBrowser();
      element.id = readerAnchor(item.chapterId, element.id);
    }
  }
  return body;
}

function focusBody(body, enabled, options = {}) {
  for (const prefix of body.querySelectorAll("strong.focus-prefix"))
    prefix.replaceWith(...prefix.childNodes);
  body.normalize();
  if (!enabled) return;
  const requestedIntensity = Number(options.intensity);
  const intensity = Number.isFinite(requestedIntensity)
    ? Math.min(100, Math.max(0, requestedIntensity)) / 100
    : 0.5;
  if (intensity === 0) return;
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
      if (options.skipShortWords && letters.length <= 3) {
        fragment.append(document.createTextNode(word));
        last = match.index + word.length;
        continue;
      }
      const length = Math.ceil(letters.length * intensity);
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
export function applyFocus(html, enabled = true, options = {}) {
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
  focusBody(body, enabled, options);
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
export async function importEpub(file, { onProgress } = {}) {
  if (!file || file.size > LIMITS.archive)
    throw invalid("Choisissez un fichier EPUB de moins de 30 Mo.");
  const report = (phase, completed, total, percent, message) => {
    if (typeof onProgress === "function")
      onProgress({ phase, completed, total, percent, message: t(message) });
  };
  report("opening", 0, 0, 0, "Ouverture de l’EPUB…");
  await yieldToBrowser();
  const original = await fileBuffer(file);
  const archive = await openArchive(original);
  try {
    const { opf, spine, manifest, zip } = archive;
    const loadImage = imageLoader(zip);
    const titles = await navigationTitles(archive);
    const chapters = [];
    report(
      "chapters", 0, spine.length, 5,
      t("Préparation des {count} chapitres…", { count: formatNumber(spine.length) }),
    );
    for (const item of spine) {
      await yieldToBrowser();
      const body = await prepareBody(
        await zip.readText(item.path),
        item,
        archive,
        loadImage,
      );
      const title =
        titles.get(item.path) ||
        body.querySelector("h1, h2, h3")?.textContent.trim() ||
        `Chapitre ${chapters.length + 1}`;
      await yieldToBrowser();
      const countable = body.cloneNode(true);
      let blocks = 0;
      for (const block of countable.querySelectorAll(
        "p,div,section,article,li,dd,dt,h1,h2,h3,h4,h5,h6,br,td,th,blockquote",
      )) {
        block.append(" ");
        if (++blocks % 256 === 0) await yieldToBrowser();
      }
      chapters.push({
        id: item.chapterId,
        title,
        html: body.innerHTML,
        wordCount: (countable.textContent.match(WORDS) || []).length,
      });
      report(
        "chapters", chapters.length, spine.length,
        Math.round(5 + (chapters.length / spine.length) * 90),
        t("Chapitre {current} sur {total}", { current: formatNumber(chapters.length), total: formatNumber(spine.length) }),
      );
    }
    const coverId = elements(opf, "meta")
      .find((node) => node.getAttribute("name") === "cover")
      ?.getAttribute("content");
    const coverItem =
      [...manifest.values()].find((item) =>
        item.properties.includes("cover-image"),
      ) || manifest.get(coverId);
    const fileName = file.name || "livre.epub";
    const book = {
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
    report("complete", spine.length, spine.length, 100, "EPUB prêt à lire.");
    return book;
  } finally {
    archive.zip.dispose();
  }
}

/** Preserve archive assets and package metadata, replacing only readable XHTML. */
async function exportConvertedEpub(book, enabled, options = {}) {
  if (!book?.original)
    throw invalid(
      "Le fichier EPUB original est nécessaire pour l’export. Réimportez ce livre.",
    );
  const archive = await openArchive(book.original, { worker: false });
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
      await archive.zip.readText(item.path),
      item,
      archive,
      loadImage,
      true,
    );
    focusBody(body, enabled && !item.properties.includes("nav"), options);
    await yieldToBrowser();
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
        replacements.get(entry.name) ?? (await readBytes(entry).catch((error) => { error.message = t(error.message); throw error; })),
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

export function exportFocusedEpub(book, options = {}) {
  return exportConvertedEpub(book, true, options);
}

/** Remove our Focus prefixes while preserving the author's original emphasis. */
export function exportClassicEpub(book) {
  // Some providers require the edition to remain untouched. Its original EPUB
  // is already a classic edition; keep its layout, credits and archive intact.
  if (book?.original && book.source?.canExportClassic === false) {
    return Promise.resolve(new Blob([book.original], { type: EPUB_MIME }));
  }
  return exportConvertedEpub(book, false);
}
