import { describe, expect, it } from "vitest";
import { sourceRelayUrl } from "../src/sources/relay-config.js";

const env = { VITE_SOURCE_RELAY_URL: "https://relay.example", BASE_URL: "/FastReader/" };

describe("chemins des sources encodés", () => {
  it.each(["Contes-Français", "L'été, l'hiver", "Fables (édition illustrée)!"])("conserve exactement le chemin encodé du titre %s", (slug) => {
    const path = `api/books/loyalbooks/${encodeURIComponent(slug)}.epub`;
    expect(sourceRelayUrl(path, env)).toBe(`https://relay.example/${path}`);
    expect(sourceRelayUrl(path, { BASE_URL: "/FastReader/" })).toBe(`/FastReader/${path}`);
  });

  it("conserve la recherche encodée sans l’interpréter comme un chemin", () => {
    const path = "api/sources/ebookzy/search?q=Romeo%20%26%20Juliet&page=1";
    expect(sourceRelayUrl(path, env)).toBe(`https://relay.example/${path}`);
  });

  it.each([
    "../book", "%2e%2e/book", "%2fbook", "%5cbook", "%00book", "%1fbook", "%7fbook",
    "%252fbook", "%252e%252e", "%3furl=evil", "%23hash", "%GG", "%C3", "book%", "book//other",
  ])("refuse le segment dangereux ou invalide %s", (slug) => {
    expect(() => sourceRelayUrl(`api/books/loyalbooks/${slug}`, env)).toThrow(TypeError);
  });

  it.each(["https://evil.example/api/books/a/book", "//evil.example/book", "/api/books/a/book", "api/books/a/book?x=1\n", "api/books/a/book#x"])("refuse un chemin détourné %s", (path) => {
    expect(() => sourceRelayUrl(path, env)).toThrow(TypeError);
  });
});
