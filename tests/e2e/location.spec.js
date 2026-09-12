import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";

// Exercise the location engine with real text layout on all browser projects.
// Loading the pure module here keeps this test independent of the app's build.
const engineSource = await readFile(
  new URL("../../src/reading-location.js", import.meta.url),
  "utf8",
);
const engineUrl = `data:text/javascript;base64,${Buffer.from(engineSource).toString("base64")}`;

async function prepareReader(page) {
  await page.setContent(`<style>
    body { margin: 20px; }
    #scroll { height: 65vh; width: min(80vw, 480px); overflow: auto; border: 1px solid #bbb; }
    article { font: 20px/1.6 Georgia, serif; margin: 14px; }
    p { margin: 0 0 1em; }
  </style><div id="scroll"><article id="chapter"></article></div>`);
  await page.evaluate(async (url) => {
    window.locationEngine = await import(url);
    const root = document.querySelector("#chapter");
    root.innerHTML = Array.from(
      { length: 30 },
      (_, index) =>
        `<p>Paragraphe ${index}. ${"Nous avançons dans cette histoire avec une ancre fiable. ".repeat(6)}</p>`,
    ).join("");
    window.addFocusMarkup = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const fragment = document.createDocumentFragment();
        for (const part of node.nodeValue.split(/(\s+)/u)) {
          if (!part.trim()) fragment.append(part);
          else {
            const strong = document.createElement("strong");
            strong.className = "focus-prefix";
            strong.textContent = part.slice(0, 2);
            fragment.append(strong, part.slice(2));
          }
        }
        node.replaceWith(fragment);
      }
    };
  }, engineUrl);
}

test("restores the same passage after font, width and Focus changes", async ({
  page,
}) => {
  await prepareReader(page);
  const result = await page.evaluate(() => {
    const root = document.querySelector("#chapter");
    const scroll = document.querySelector("#scroll");
    const engine = window.locationEngine;
    scroll.scrollTop = 1600;
    const locator = engine.createTextLocator(root, {
      chapterId: "chapter-1",
      scrollContainer: scroll,
    });
    const originalWord = engine.wordIndexForLocator(root, locator);
    const originalText = engine.getTextContent(root);
    root.style.fontSize = "28px";
    scroll.style.width = "min(65vw, 350px)";
    window.addFocusMarkup();
    const restored = engine.restoreTextLocator(root, locator, scroll);
    const range = engine.locateTextRange(root, locator);
    const rect = Array.from(range.getClientRects()).find(
      (item) => item.width > 0 && item.height > 0,
    );
    return {
      restored,
      offset: locator.textOffset,
      distanceFromTop:
        rect.top - scroll.getBoundingClientRect().top - scroll.clientTop,
      sameText: engine.getTextContent(root) === originalText,
      sameWord: engine.wordIndexForLocator(root, locator) === originalWord,
      sameQuote: range.toString() === locator.exact.replace(/\n/g, ""),
    };
  });
  expect(result.restored).toBe(true);
  expect(result.offset).toBeGreaterThan(100);
  expect(result.distanceFromTop).toBeGreaterThanOrEqual(7);
  expect(result.distanceFromTop).toBeLessThanOrEqual(9);
  expect(result.sameText).toBe(true);
  expect(result.sameWord).toBe(true);
  expect(result.sameQuote).toBe(true);
});

test("keeps multi-paragraph annotations intact across Focus and text highlighting", async ({
  page,
}) => {
  await prepareReader(page);
  const result = await page.evaluate(() => {
    const root = document.querySelector("#chapter");
    const engine = window.locationEngine;
    window.addFocusMarkup();
    const paragraphs = root.querySelectorAll("p");
    const selection = document.createRange();
    selection.setStart(paragraphs[1].querySelector("strong").firstChild, 1);
    selection.setEnd(paragraphs[2].querySelectorAll("strong")[3].firstChild, 1);
    const selectedText = selection.toString();
    const locator = engine.createSelectionLocator(root, selection, {
      chapterId: "chapter-1",
    });
    const before = engine.getTextContent(root);
    const marks = engine.applyLocatorHighlight(root, locator, {
      id: "annotation-1",
    });
    const highlighted = engine.locateTextRange(root, locator).toString();
    for (const strong of root.querySelectorAll("strong.focus-prefix"))
      strong.replaceWith(...strong.childNodes);
    return {
      marks: marks.length,
      paragraphs: root.querySelectorAll("p").length,
      unchanged: engine.getTextContent(root) === before,
      highlightMatches: highlighted === selectedText,
      classicMatches:
        engine.locateTextRange(root, locator).toString() === selectedText,
      ids: marks.every((mark) => mark.dataset.annotationId === "annotation-1"),
    };
  });
  expect(result.marks).toBeGreaterThan(3);
  expect(result.paragraphs).toBe(30);
  expect(result.unchanged).toBe(true);
  expect(result.highlightMatches).toBe(true);
  expect(result.classicMatches).toBe(true);
  expect(result.ids).toBe(true);
});
