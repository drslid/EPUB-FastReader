// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { applyFocus, exportFocusedEpub, importEpub } from "../src/epub.js";

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/1cAAAAASUVORK5CYII=",
  ),
  (letter) => letter.charCodeAt(0),
);
const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const packageDocument = `<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">test-book</dc:identifier><dc:title>Un livre &amp; ses images</dc:title><dc:creator>Émile Exemple</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="first" href="text/first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="text/second.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="second"/><itemref idref="first"/></spine></package>`;

function xhtml(body) {
  return `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapitre</title></head><body>${body}</body></html>`;
}

async function fixture(changes = {}) {
  const zip = new JSZip();
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": container,
    "OPS/package.opf": packageDocument,
    "OPS/text/first.xhtml": xhtml(
      '<h1>Premier chapitre</h1><p id="bonjour">Bonjour,  le monde !</p><img src="../images/cover.png" alt="Couverture"/>',
    ),
    "OPS/text/second.xhtml": xhtml(
      '<h1>Deuxième chapitre</h1><p>Lire maintenant.</p><a href="first.xhtml#bonjour">La suite</a>',
    ),
    "OPS/nav.xhtml": xhtml(
      '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="text/first.xhtml">Une première partie</a></li><li><a href="text/second.xhtml">Le début choisi</a></li></ol></nav>',
    ),
    "OPS/images/cover.png": PNG,
    ...changes,
  };
  for (const [path, data] of Object.entries(files))
    if (data !== null) zip.file(path, data);
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  return new File([bytes], "mon-livre.epub", { type: "application/epub+zip" });
}

function dom(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

describe("EPUB import", () => {
  it("reads metadata, embedded covers, navigation titles and the spine order", async () => {
    const book = await importEpub(await fixture());
    expect(book.title).toBe("Un livre & ses images");
    expect(book.author).toBe("Émile Exemple");
    expect(book.language).toBe("fr");
    expect(book.cover).toMatch(/^data:image\/png;base64,/);
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Le début choisi",
      "Une première partie",
    ]);
    expect(book.chapters.map((chapter) => chapter.id)).toEqual([
      "chapter-1",
      "chapter-2",
    ]);
    expect(book.chapters[0].html).toContain("Deuxième chapitre");
    expect(book.totalWords).toBeGreaterThan(0);
    expect(book.fileName).toBe("mon-livre.epub");
    expect(book.original.byteLength).toBeGreaterThan(0);
    expect(book.addedAt).toBeGreaterThan(0);
  });

  it("deduplicates identical bytes using a stable content identifier", async () => {
    const file = await fixture();
    const first = await importEpub(file);
    const second = await importEpub(file);
    expect(first.id).toBe(second.id);
  });

  it("counts separate paragraphs as separate words without splitting inline emphasis", async () => {
    const book = await importEpub(
      await fixture({
        "OPS/text/first.xhtml": xhtml(
          "<h1>Lire</h1><p>Bon<strong>jour</strong> monde.</p>",
        ),
      }),
    );
    expect(book.chapters[1].wordCount).toBe(3);
  });

  it("resolves nested image references and chapter anchors inside the archive", async () => {
    const book = await importEpub(await fixture());
    expect(
      dom(book.chapters[0].html).querySelector("a").getAttribute("href"),
    ).toBe("#chapter-2--bonjour");
    const first = dom(book.chapters[1].html);
    expect(first.querySelector("p").id).toBe("chapter-2--bonjour");
    expect(first.querySelector("img").getAttribute("src")).toBe(book.cover);
  });

  it("supports percent-encoded archive references", async () => {
    const book = await importEpub(
      await fixture({
        "OPS/text/first.xhtml": xhtml(
          '<p>Une image</p><img src="../images/une%20image.png"/>',
        ),
        "OPS/images/une image.png": PNG,
      }),
    );
    expect(dom(book.chapters[1].html).querySelector("img").src).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("removes active content, publisher CSS, remote resources and application classes", async () => {
    const book = await importEpub(
      await fixture({
        "OPS/text/first.xhtml": xhtml(
          `<script>window.attacked=true</script><style>body{display:none}</style><link rel="stylesheet" href="https://tracker.example/style.css"/><p id="safe" class="modal" style="background:url(https://tracker.example)" onclick="alert(1)">Texte sûr</p><iframe src="https://tracker.example"></iframe><svg onload="alert(1)"><script>alert(1)</script></svg><form><input autofocus onfocus="alert(1)"/></form><img src="https://tracker.example/pixel" onerror="alert(1)"/><img src="data:image/svg+xml,%3Csvg/onload=alert(1)%3E"/><a href="javascript:alert(1)">Danger</a><a href="https://tracker.example">Externe</a><a href="//tracker.example">Réseau</a>`,
        ),
      }),
    );
    const content = dom(book.chapters[1].html);
    expect(
      content.querySelector("script,style,link,iframe,svg,form,input,img"),
    ).toBeNull();
    expect(
      content.querySelector("[onclick],[onload],[onerror],[style],[class]"),
    ).toBeNull();
    expect(content.querySelectorAll("a[href]")).toHaveLength(0);
    expect(content.textContent).toContain("Texte sûr");
    expect(window.attacked).toBeUndefined();
  });

  it("rejects resource traversal and replaces unsupported image formats with readable text", async () => {
    const book = await importEpub(
      await fixture({
        "OPS/text/first.xhtml": xhtml(
          '<p>Images</p><img src="../../../outside.png"/><img src="../images/cover.svg" alt="Illustration vectorielle"/><img src="..%2fimages/cover.png"/>',
        ),
        "OPS/images/cover.svg":
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      }),
    );
    const content = dom(book.chapters[1].html);
    expect(content.querySelector("img,svg,script")).toBeNull();
    expect(content.textContent).toContain("Illustration vectorielle");
  });

  it("does not trust declared image media types or extensions", async () => {
    const book = await importEpub(
      await fixture({
        "OPS/images/cover.png": '<svg onload="alert(1)"></svg>',
      }),
    );
    expect(book.cover).toBe("");
    expect(dom(book.chapters[1].html).querySelector("img")).toBeNull();
  });

  it("supports EPUB 2 NCX navigation and cover metadata", async () => {
    const opf = packageDocument
      .replace('properties="cover-image"', "")
      .replace(
        "<dc:language>",
        '<meta name="cover" content="cover"/><dc:language>',
      )
      .replace(
        '<item id="nav"',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="nav"',
      )
      .replace(' properties="nav"', "");
    const book = await importEpub(
      await fixture({
        "OPS/package.opf": opf,
        "OPS/toc.ncx":
          '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="p"><navLabel><text>Début EPUB 2</text></navLabel><content src="text/second.xhtml"/></navPoint></navMap></ncx>',
      }),
    );
    expect(book.chapters[0].title).toBe("Début EPUB 2");
    expect(book.cover).toMatch(/^data:image\/png/);
  });

  it("rejects a non-ZIP file with a French error", async () => {
    await expect(
      importEpub(new File(["ceci n’est pas un ZIP"], "fake.epub")),
    ).rejects.toThrow("archive EPUB valide");
  });

  it.each([
    [{ mimetype: "application/zip" }, "format EPUB"],
    [{ "META-INF/container.xml": null }, "absent"],
    [{ "OPS/package.opf": "<package>broken" }, "invalide"],
    [{ "OPS/text/second.xhtml": null }, "introuvable"],
    [
      {
        "OPS/package.opf": packageDocument.replace(
          'href="text/second.xhtml"',
          'href="../../../outside.xhtml"',
        ),
      },
      "introuvable",
    ],
    [
      {
        "OPS/package.opf": packageDocument.replace(
          'id="second" href="text/second.xhtml" media-type="application/xhtml+xml"',
          'id="second" href="text/second.xhtml" media-type="image/svg+xml"',
        ),
      },
      "format non pris en charge",
    ],
  ])("rejects invalid EPUB structure (%j)", async (changes, message) => {
    await expect(importEpub(await fixture(changes))).rejects.toThrow(message);
  });

  it("rejects DRM but accepts standard font obfuscation", async () => {
    const encryption = (algorithm) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="OPS/font.otf"/></CipherData></EncryptedData></encryption>`;
    await expect(
      importEpub(
        await fixture({
          "META-INF/encryption.xml": encryption(
            "http://www.w3.org/2001/04/xmlenc#aes256-cbc",
          ),
        }),
      ),
    ).rejects.toThrow("DRM");
    await expect(
      importEpub(
        await fixture({
          "META-INF/encryption.xml": encryption(
            "http://www.idpf.org/2008/embedding",
          ),
        }),
      ),
    ).resolves.toHaveProperty("title");
  });

  it("rejects oversized input before reading its data", async () => {
    await expect(importEpub({ size: 31 * 1024 * 1024 })).rejects.toThrow(
      "30 Mo",
    );
  });

  it("checks declared uncompressed sizes before expanding a ZIP", async () => {
    const bytes = new Uint8Array(await readBlob(await fixture()));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 17 * 1024 * 1024, true);
        break;
      }
    }
    await expect(
      importEpub(new File([bytes], "oversized.epub")),
    ).rejects.toThrow("décompression");
  });

  it("rejects unsafe names even when JSZip would normalize them", async () => {
    await expect(
      importEpub(await fixture({ "../outside.txt": "oops" })),
    ).rejects.toThrow("chemin de fichier non sûr");
  });
});

describe("Word-prefix focus", () => {
  it("preserves whitespace, accents, punctuation, links and existing emphasis", () => {
    const original =
      '<p>Éléphant,  café\n éclair ! <em>déjà</em> <a href="#chapter-1">Lire</a></p>';
    const focused = dom(applyFocus(original));
    expect(focused.textContent).toBe(dom(original).textContent);
    expect(focused.querySelector("strong").textContent).toBe("Élép");
    expect(focused.querySelector("em strong").textContent).toBe("dé");
    expect(focused.querySelector("a").getAttribute("href")).toBe("#chapter-1");
    expect(focused.querySelectorAll("strong")).toHaveLength(5);
  });

  it("is reversible and idempotent without removing author bold text", () => {
    const original = "<p>Bonjour  <strong>monde</strong> !</p>";
    const once = applyFocus(original);
    expect(applyFocus(once)).toBe(once);
    expect(applyFocus(once, false)).toBe(original);
    expect(applyFocus(original, false)).toBe(original);
  });

  it("leaves code and ruby pronunciation intact and cannot inject markup from text", () => {
    const original =
      "<p>&lt;img onerror=alert&gt; &amp; hello</p><pre>const secret = 1;</pre><ruby>漢字<rt>かんじ</rt></ruby>";
    const focused = dom(applyFocus(original));
    expect(focused.textContent).toBe(dom(original).textContent);
    expect(focused.querySelector("img")).toBeNull();
    expect(focused.querySelector("pre strong, rt strong")).toBeNull();
  });

  it("sanitizes unsafe standalone input and only retains local anchors or raster data images", () => {
    const focused = dom(
      applyFocus(
        '<script>alert(1)</script><a href="https://example.com">Lien</a><img src="https://example.com/pixel"/><p style="color:red" onclick="alert(1)">Texte</p>',
      ),
    );
    expect(
      focused.querySelector("script,img,[onclick],[style],[href]"),
    ).toBeNull();
  });

  it("keeps embedded illustrations across focus toggles without leaking intermediary attributes", async () => {
    const book = await importEpub(await fixture());
    const focused = applyFocus(book.chapters[1].html);
    expect(dom(focused).querySelector("img").getAttribute("src")).toBe(
      book.cover,
    );
    expect(applyFocus(focused)).toBe(focused);
    expect(
      dom(applyFocus(focused, false)).querySelector("img").getAttribute("src"),
    ).toBe(book.cover);
    expect(focused).not.toContain("data-epub-src");
  });
});

describe("Focused EPUB export", () => {
  it("preserves metadata and images, writes parseable XHTML and keeps mimetype first without compression", async () => {
    const book = await importEpub(await fixture());
    const blob = await exportFocusedEpub(book);
    expect(blob.type).toBe("application/epub+zip");
    const original = await readBlob(blob);
    const header = new DataView(original);
    expect(header.getUint32(0, true)).toBe(0x04034b50);
    expect(header.getUint16(8, true)).toBe(0);
    expect(new TextDecoder().decode(new Uint8Array(original, 30, 8))).toBe(
      "mimetype",
    );
    const zip = await JSZip.loadAsync(original);
    expect(await zip.file("mimetype").async("string")).toBe(
      "application/epub+zip",
    );
    expect(await zip.file("OPS/package.opf").async("string")).toBe(
      packageDocument,
    );
    expect(await zip.file("OPS/images/cover.png").async("uint8array")).toEqual(
      PNG,
    );
    const source = await zip.file("OPS/text/first.xhtml").async("string");
    const xml = new DOMParser().parseFromString(source, "application/xml");
    expect(xml.querySelector("parsererror")).toBeNull();
    expect(xml.querySelector("strong.focus-prefix")).not.toBeNull();
    expect(xml.querySelector("img").getAttribute("src")).toBe(
      "../images/cover.png",
    );
    expect(xml.querySelector("p").id).toBe("bonjour");
    const reimported = await importEpub(new File([original], "focused.epub"));
    expect(reimported.chapters).toHaveLength(2);
    expect(dom(reimported.chapters[1].html).textContent).toBe(
      dom(book.chapters[1].html).textContent,
    );
  });

  it("retains valid navigation and local links and removes active chapter content", async () => {
    const book = await importEpub(
      await fixture({
        "OPS/text/first.xhtml": xhtml(
          '<p onclick="alert(1)">Bonjour</p><script>alert(1)</script><img src="https://example.com/pixel"/>',
        ),
      }),
    );
    const zip = await JSZip.loadAsync(
      await readBlob(await exportFocusedEpub(book)),
    );
    const first = await zip.file("OPS/text/first.xhtml").async("string");
    expect(first).not.toMatch(/<script|onclick=|https:\/\/example/);
    const second = new DOMParser().parseFromString(
      await zip.file("OPS/text/second.xhtml").async("string"),
      "application/xml",
    );
    expect(second.querySelector("a").getAttribute("href")).toBe(
      "first.xhtml#bonjour",
    );
    const nav = new DOMParser().parseFromString(
      await zip.file("OPS/nav.xhtml").async("string"),
      "application/xml",
    );
    expect(nav.querySelector("parsererror")).toBeNull();
    expect(nav.querySelector("nav").getAttribute("epub:type")).toBe("toc");
    expect(nav.querySelector("strong")).toBeNull();
  });

  it("explains why export cannot work without the original file", async () => {
    await expect(exportFocusedEpub({ title: "Missing" })).rejects.toThrow(
      "original",
    );
  });
});
