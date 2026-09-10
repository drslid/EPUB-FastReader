// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getGutenbergReadingStart } from "../src/reading-start.js";
import { getTextContent } from "../src/reading-location.js";

const header = `<div id="chapter-1--pg-header"><h2>The Project Gutenberg eBook of Germinal</h2><p>This eBook is for the use of anyone anywhere.</p><p>Title: Germinal</p><p>Author: Émile Zola</p><p>Language: French</p><div id="chapter-1--pg-start-separator">*** START OF THE PROJECT GUTENBERG EBOOK GERMINAL ***</div></div>`;
const chapter = (id, html) => ({ id, html, title: id });
const book = (...chapters) => ({ chapters });

describe("ouverture après la notice Gutenberg", () => {
  it("passe une couverture vide et une notice séparée, en gardant la préface", () => {
    expect(getGutenbergReadingStart(book(
      chapter("cover", '<img alt="Couverture" />'),
      chapter("notice", header),
      chapter("preface", "<h1>Préface de l’auteur</h1><p>Ce livre commence par une préface à conserver.</p>"),
    ))).toMatchObject({ chapterId: "preface", exact: expect.stringMatching(/^Préface de l’auteur/) });
  });

  it("garde le texte qui suit la notice dans le même chapitre", () => {
    const original = book(chapter("opening", `${header}<h1>Germinal</h1><p>Dans la plaine rase, sous la nuit sans étoiles, un homme avançait.</p>`));
    const before = structuredClone(original);
    const hint = getGutenbergReadingStart(original);
    expect(hint).toMatchObject({ chapterId: "opening", exact: expect.stringMatching(/^Germinal/) });
    const article = document.createElement("article");
    article.innerHTML = original.chapters[0].html;
    expect(getTextContent(article)).toContain(hint.exact);
    expect(original).toEqual(before);
    expect(original.chapters[0].html).toContain("The Project Gutenberg");
  });

  it("reconnaît le marqueur textuel avec l’introduction officielle sans IDs HTML", () => {
    const html = `<p>Project Gutenberg’s Germinal, by Émile Zola</p><pre>*** START OF THIS PROJECT GUTENBERG EBOOK GERMINAL ***</pre><p>Première partie : une histoire commence ici.</p>`;
    expect(getGutenbergReadingStart(book(chapter("single", html))))
      .toMatchObject({ chapterId: "single", exact: "Première partie : une histoire commence ici." });
  });

  it("passe uniquement les anciens crédits structurés confirmés après START", () => {
    const credits = `<p>This eBook was produced by Carlo Traverso.</p><p>Author: Émile Zola</p><p>Title: Germinal</p><p>Remark: n. 13</p><p>Language: French</p><p>Encoding: ISO-8859-1</p><p>We thank the Bibliotheque Nationale de France for image files at gallica.bnf.fr.</p><p>Nous remercions la Bibliothèque Nationale de France pour les images dans gallica.bnf.fr.</p>`;
    const hint = getGutenbergReadingStart(book(chapter("germinal", `${header}${credits}<p>Émile Zola</p><p>Germinal</p><p>Première Partie</p><p>Dans la plaine rase, sous la nuit sans étoiles.</p>`)));
    expect(hint.chapterId).toBe("germinal");
    expect(hint.exact).toMatch(/^Émile Zola/);
    expect(hint.exact).not.toMatch(/produced|Encoding|Language|gallica/);
  });

  it("ne saute pas un crédit isolé ou une dédicace sans métadonnées confirmées", () => {
    const text = "This eBook was produced by my family as a gift for our reader.";
    expect(getGutenbergReadingStart(book(chapter("single", `${header}<p>${text}</p><p>Une dédicace personnelle reste ici.</p>`))).exact).toMatch(/^This eBook was produced by my family/);
  });

  it.each([
    "<h1>Carnet personnel</h1><p>Je lis les livres de Project Gutenberg.</p>",
    "<p>Un carnet qui cite un marqueur :</p><p>*** START OF THE PROJECT GUTENBERG EBOOK TEST ***</p><p>Le carnet doit rester au début.</p>",
    "<p>*** START OF THE PROJECT GUTENBERG EBOOK TEST ***</p><p>Une citation sans introduction officielle ne suffit pas.</p>",
  ])("ne déplace jamais l’ouverture d’un texte ordinaire : %s", (html) => {
    expect(getGutenbergReadingStart(book(chapter("ordinary", html)))).toBeNull();
  });

  it("ne saute pas un texte réel placé avant un élément nommé pg-header", () => {
    expect(getGutenbergReadingStart(book(chapter("ordinary", `<p>Ce passage est le vrai début de mon carnet.</p>${header}`)))).toBeNull();
  });

  it.each([
    book(chapter("notice", header)),
    book(chapter("notice", header), chapter("footer", '<div id="chapter-2--pg-footer">THE FULL PROJECT GUTENBERG LICENSE and terms of use.</div>')),
    book(chapter("single", `${header}<p>*** END OF THE PROJECT GUTENBERG EBOOK GERMINAL ***</p>`)),
    book(),
    {},
  ])("revient au comportement normal s’il ne reste que des notices ou aucun chapitre", (value) => {
    expect(getGutenbergReadingStart(value)).toBeNull();
  });
});
