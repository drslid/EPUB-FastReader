// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { importEpub } from "../src/epub.js";
import { searchBooks } from "../src/catalog.js";
import { getTextContent } from "../src/reading-location.js";

const bookDirectory = resolve(process.cwd(), "public/books");
const provenance = JSON.parse(
  await readFile(resolve(bookDirectory, "provenance.json"), "utf8"),
);

describe("éditions complètes distribuées avec la sélection", () => {
  it("garde les neuf EPUB sous 3 Mio et leur inventaire cohérent", async () => {
    const { books } = await searchBooks({ provider: "selection" });
    expect(books.map((book) => book.id)).toEqual(
      provenance.books.map((book) => book.id),
    );
    expect(
      provenance.books.reduce((sum, book) => sum + book.bytes, 0),
    ).toBeLessThan(3 * 1024 * 1024);
    const notice = await readFile(
      resolve(bookDirectory, "NOTICE.html"),
      "utf8",
    );
    for (const book of provenance.books)
      expect(notice).toContain(book.sourceUrl);
    expect(notice).toContain("1.E.1.");
  });

  it.each(provenance.books)(
    "ouvre $title et conserve l’original et sa licence",
    async (metadata) => {
      const buffer = await readFile(resolve(bookDirectory, metadata.file));
      expect(buffer.length).toBe(metadata.bytes);
      expect(createHash("sha256").update(buffer).digest("hex")).toBe(
        metadata.sha256,
      );
      const zip = await JSZip.loadAsync(buffer);
      expect(await zip.file("mimetype").async("string")).toBe(
        "application/epub+zip",
      );
      const html = (
        await Promise.all(
          Object.values(zip.files)
            .filter((entry) => /\.x?html?$/.test(entry.name))
            .map((entry) => entry.async("string")),
        )
      ).join("\n");
      expect(html).toContain("THE FULL PROJECT GUTENBERG");
      expect(html).toContain("1.E.1.");
      expect(html).toContain("END OF THE PROJECT GUTENBERG EBOOK");
      const book = await importEpub(
        new File([buffer], metadata.file, { type: "application/epub+zip" }),
      );
      expect(book.author).toBe(metadata.author);
      expect(book.language).toBe("fr");
      expect(book.totalWords).toBeGreaterThan(20000);
      expect(book.chapters.length).toBeGreaterThan(3);
      expect(
        book.chapters.some((chapter) => chapter.html.includes("1.E.1.")),
      ).toBe(true);
      expect(new Uint8Array(book.original)).toEqual(new Uint8Array(buffer));
      const selection = await searchBooks({ provider: "selection" });
      const entry = selection.books.find((entry) => entry.id === metadata.id);
      const chapter = book.chapters.find(
        (chapter) => chapter.id === entry.readingStart.chapterId,
      );
      expect(chapter).toBeDefined();
      const article = document.createElement("article");
      article.innerHTML = chapter.html;
      const text = getTextContent(article);
      expect(text.indexOf(entry.readingStart.exact)).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(entry.readingStart.exact)).toBe(
        text.lastIndexOf(entry.readingStart.exact),
      );
      expect(entry.readingStart.exact).not.toMatch(
        /Project Gutenberg|This eBook/,
      );
    },
  );
});
