import JSZip from "jszip";

export async function makeEpub({
  title = "Un livre pour tester",
  author = "Louise Exemple",
  language = "fr",
  paragraphs = [
    "Une histoire à garder sur cet appareil. Les pages sont toujours disponibles pour reprendre la lecture.",
  ],
  chapters = 2,
} = {}) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    "book.opf",
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>${language}</dc:language></metadata><manifest>${Array.from({ length: chapters }, (_, index) => `<item id="chapter${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${Array.from({ length: chapters }, (_, index) => `<itemref idref="chapter${index}"/>`).join("")}</spine></package>`,
  );
  for (let index = 0; index < chapters; index += 1) {
    zip.file(
      `chapter${index}.xhtml`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapitre ${index + 1}</title></head><body><h1>Chapitre ${index + 1}</h1>${paragraphs.map((text) => `<p>${text}</p>`).join("")}</body></html>`,
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function importEpub(page, buffer, name = "lecture.epub") {
  await page.locator("#epub-file").setInputFiles({
    name,
    mimeType: "application/epub+zip",
    buffer,
  });
}

export async function storedRows(page, storeName) {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("fastreader");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
    storeName,
  );
}
