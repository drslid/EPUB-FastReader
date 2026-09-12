import { test as base, expect } from "@playwright/test";

export const emptyStandardSearch = '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Browse Standard Ebooks</title></head><body><main class="ebooks"><form role="search"></form><p class="no-results">No ebooks matched your filters.</p></main></body></html>';
export const emptyEbooksGratuitsSearch = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><id>https://www.ebooksgratuits.com/opds/feed.php</id><title>Recherche</title><opensearch:totalResults>0</opensearch:totalResults></feed>';

// Deterministic CI never searches or downloads from a real remote book source.
// Provider-specific tests override these context routes using page.route().
// Real bundled EPUBs, our catalogue shards and the service worker remain intact.
export const test = base.extend({
  remoteSourceFixtures: [async ({ context }, use) => {
    await context.route(/^https:\/\/standardebooks\.org\//u, (route) => {
      if (new URL(route.request().url()).pathname === "/ebooks") {
        return route.fulfill({ status: 200, contentType: "application/xhtml+xml", headers: { "access-control-allow-origin": "*" }, body: emptyStandardSearch });
      }
      return route.abort("blockedbyclient");
    });
    await context.route(/\/api\/sources\/ebooks-gratuits\/search(?:\?|$)/u, (route) => route.fulfill({
      status: 200, contentType: "application/atom+xml", body: emptyEbooksGratuitsSearch,
    }));
    await context.route(/\/api\/books\/ebooks-gratuits\/[^/?]+\.epub(?:\?|$)/u, (route) => route.fulfill({ status: 503, body: "No EPUB fixture installed for this test." }));
    await context.route(/^https:\/\/(?:www\.)?ebooksgratuits\.com\//u, (route) => route.abort("blockedbyclient"));
    await use();
  }, { auto: true }],
});

export { expect };
