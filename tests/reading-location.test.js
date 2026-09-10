import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFocus } from "../src/epub.js";
import {
  applyLocatorHighlight,
  createSelectionLocator,
  createTextLocator,
  getTextContent,
  locateTextRange,
  restoreTextLocator,
  wordIndexForLocator,
} from "../src/reading-location.js";

const originalRangeMethods = Object.fromEntries(
  ["getClientRects", "getBoundingClientRect"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Range.prototype, name),
  ]),
);

function chapter(html) {
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  for (const [name, descriptor] of Object.entries(originalRangeMethods)) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else delete Range.prototype[name];
  }
});

describe("text locations", () => {
  it("keeps word offsets through Focus toggles and nested inline emphasis", () => {
    const original =
      "<h1>Chapitre premier</h1><p>Bon<strong>jour</strong> à tous. Une suite à lire.</p>";
    const root = chapter(original);
    const locator = createTextLocator(root, {
      chapterId: "chapter-1",
      wordIndex: 4,
    });
    expect(locator.exact).toBe("tous. Une suite à lire.");
    const before = getTextContent(root);
    root.innerHTML = applyFocus(original);
    expect(getTextContent(root)).toBe(before);
    expect(locateTextRange(root, locator).toString()).toBe(locator.exact);
    expect(wordIndexForLocator(root, locator)).toBe(4);
    root.innerHTML = applyFocus(root.innerHTML, false);
    expect(locateTextRange(root, locator).toString()).toBe(locator.exact);
  });

  it("separates adjacent blocks and line breaks without splitting inline words", () => {
    const root = chapter(
      "<div>Le <em>mon</em>de.<p>Deuxième ligne.</p>Fin<br>Suite</div><p>Encore</p>",
    );
    expect(getTextContent(root)).toBe(
      "Le monde.\nDeuxième ligne.\nFin\nSuite\nEncore",
    );
    expect(createTextLocator(root, { wordIndex: 2 }).exact).toMatch(
      /^Deuxième/,
    );
  });

  it("excludes non-reading content from positions", () => {
    const root = chapter(
      '<p>Lire <span hidden>secret</span><span aria-hidden="true">icone</span><script>bad()</script><style>p{}</style><template>modèle</template>ici.</p>',
    );
    expect(getTextContent(root)).toBe("Lire ici.");
  });

  it("relocates a quote after introductory text and image markup change", () => {
    const root = chapter(
      "<p>Ouverture du texte.</p><p>Le passage mémorisé commence ici.</p>",
    );
    const locator = createTextLocator(root, { wordIndex: 3 });
    root.insertAdjacentHTML(
      "afterbegin",
      '<p>Nouvelle introduction.</p><img alt="Image" width="100" height="900">',
    );
    expect(locateTextRange(root, locator).toString()).toBe(
      "Le passage mémorisé commence ici.",
    );
    expect(wordIndexForLocator(root, locator)).toBe(5);
  });

  it("uses surrounding text to disambiguate repeated quotes after insertions", () => {
    const quote = "Ce passage revient. ".repeat(7);
    const root = chapter(
      `<p>PREMIER CONTEXTE ${quote}PREMIÈRE FIN</p><p>SECOND CONTEXTE ${quote}SECONDE FIN</p>`,
    );
    const start = getTextContent(root).indexOf(
      quote,
      getTextContent(root).indexOf("SECOND CONTEXTE"),
    );
    const locator = createTextLocator(root, { textOffset: start });
    root.insertAdjacentHTML("afterbegin", `<p>${"ajout ".repeat(100)}</p>`);
    const restored = locateTextRange(root, locator);
    expect(restored.startContainer.parentElement.textContent).toMatch(
      /^SECOND CONTEXTE/,
    );
  });

  it("keeps Unicode UTF-16 offsets without splitting surrogate pairs", () => {
    const root = chapter("<p>🌍 éclair, déjà vu. 日本語の文章</p>");
    const locator = createTextLocator(root, { textOffset: 1 });
    expect(locator.textOffset).toBe(0);
    expect(locateTextRange(root, locator).toString()).toBe(
      getTextContent(root),
    );
    const accented = createTextLocator(root, { wordIndex: 1 });
    expect(accented.exact).toMatch(/^éclair/);
    expect(wordIndexForLocator(root, accented)).toBe(1);
  });

  it("returns no range for a deleted quote and keeps a bounded fallback progression", () => {
    const root = chapter("<p>Le texte a été remplacé.</p>");
    Object.defineProperties(root, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
    });
    expect(
      locateTextRange(root, { exact: "introuvable", textOffset: 12 }),
    ).toBeNull();
    expect(
      restoreTextLocator(
        root,
        { exact: "introuvable", progression: 0.4 },
        root,
      ),
    ).toBe(true);
    expect(root.scrollTop).toBe(320);
    restoreTextLocator(root, { exact: "introuvable", progression: 2 }, root);
    expect(root.scrollTop).toBe(800);
    expect(restoreTextLocator(root, { exact: "introuvable" }, root)).toBe(
      false,
    );
  });

  it("handles empty chapters and invalid locations without throwing", () => {
    const root = chapter("<img alt='illustration'>");
    expect(createTextLocator(root, { chapterId: "images" })).toMatchObject({
      textOffset: 0,
      progression: 0,
      exact: "",
      chapterId: "images",
    });
    expect(locateTextRange(root, null)).toBeNull();
    expect(wordIndexForLocator(root, null)).toBe(0);
    expect(restoreTextLocator(root, null)).toBe(false);
  });

  it("captures the visible line inside a long text node instead of the paragraph start", () => {
    const root = chapter(`<p>${"abcdefghij ".repeat(20)}</p>`);
    root.getBoundingClientRect = () => ({ top: 200 });
    const rectangles = function () {
      const top = 100 + Math.floor(this.startOffset / 10) * 20;
      const bottom = 100 + (Math.floor((this.endOffset - 1) / 10) + 1) * 20;
      return [{ top, bottom, width: 100, height: bottom - top }];
    };
    // jsdom does not implement layout; supply glyph positions explicitly.
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: rectangles,
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return rectangles.call(this)[0];
      },
    });
    const locator = createTextLocator(root, { scrollContainer: root });
    expect(locator.textOffset).toBe(50);
  });

  it("restores a glyph position after layout changes rather than multiplying a ratio", () => {
    const root = chapter("<p>Un texte puis le passage à retrouver.</p>");
    root.getBoundingClientRect = () => ({ top: 40 });
    root.scrollTop = 300;
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value() {
        return [{ top: 240, bottom: 260, width: 100, height: 20 }];
      },
    });
    const locator = createTextLocator(root, { wordIndex: 4 });
    expect(restoreTextLocator(root, locator)).toBe(true);
    expect(root.scrollTop).toBe(492);
  });
});

describe("annotation locations", () => {
  it("captures a selection across Focus nodes and restores it in classic text", () => {
    const root = chapter(applyFocus("<p>Bonjour à toutes et tous.</p>"));
    const starts = root.querySelectorAll("strong");
    const range = document.createRange();
    range.setStart(starts[0].firstChild, 0);
    range.setEnd(starts[2].nextSibling, starts[2].nextSibling.length);
    const locator = createSelectionLocator(root, range, {
      chapterId: "chapter-2",
    });
    const selected = range.toString();
    expect(locator.exact).toBe(selected);
    expect(locator.chapterId).toBe("chapter-2");
    root.innerHTML = "<p>Bonjour à toutes et tous.</p>";
    expect(locateTextRange(root, locator).toString()).toBe(selected);
  });

  it("captures a selection using element boundaries across multiple paragraphs", () => {
    const root = chapter(
      "<p>Premier 🌍.</p><p>Deuxième <em>passage</em>.</p><p>Non sélectionné.</p>",
    );
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(root, 2);
    const locator = createSelectionLocator(root, range);
    expect(locator.exact).toBe("Premier 🌍.\nDeuxième passage.");
    expect(locateTextRange(root, locator).toString()).toBe(
      "Premier 🌍.Deuxième passage.",
    );
  });

  it("limits annotation length without cutting an emoji in half", () => {
    const root = chapter(`<p>${"a".repeat(1999)}🌍${"b".repeat(100)}</p>`);
    const range = document.createRange();
    range.selectNodeContents(root);
    const locator = createSelectionLocator(root, range);
    expect(locator.exact).toHaveLength(1999);
    expect(locator.suffix.startsWith("🌍")).toBe(true);
  });

  it("ignores collapsed, outside, and whitespace-only selections", () => {
    const root = chapter("<p>    </p>");
    const other = chapter("<p>Ailleurs.</p>");
    const range = document.createRange();
    range.selectNodeContents(root);
    expect(createSelectionLocator(root, range)).toBeNull();
    range.selectNodeContents(other);
    expect(createSelectionLocator(root, range)).toBeNull();
    range.collapse();
    expect(createSelectionLocator(other, range)).toBeNull();
  });

  it("highlights selected fragments without flattening paragraphs, emphasis, or links", () => {
    const root = chapter(
      '<p>Voici <em>un passage</em>.</p><p>Et <a href="#chapter-2">sa suite</a>.</p>',
    );
    const range = document.createRange();
    range.setStart(root.querySelector("em").firstChild, 3);
    range.setEnd(root.querySelector("a").firstChild, 2);
    const locator = createSelectionLocator(root, range);
    const before = getTextContent(root);
    const marks = applyLocatorHighlight(root, locator, {
      className: "saved-highlight",
      id: "note-1",
    });
    expect(marks).toHaveLength(4);
    expect(root.querySelectorAll("p")).toHaveLength(2);
    expect(root.querySelector("em mark").textContent).toBe("passage");
    expect(root.querySelector("a").getAttribute("href")).toBe("#chapter-2");
    expect(root.querySelector("a mark").textContent).toBe("sa");
    expect(marks.every((mark) => mark.dataset.annotationId === "note-1")).toBe(
      true,
    );
    expect(getTextContent(root)).toBe(before);
    expect(locateTextRange(root, locator).toString()).toBe("passage.Et sa");
  });
});
