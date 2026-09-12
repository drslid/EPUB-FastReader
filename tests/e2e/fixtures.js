import { test as base, expect } from "@playwright/test";
import { GOOGLE_SEARCH_SCRIPT, googleSearchSdk } from "./helpers/google-search.js";

export const emptyStandardSearch = '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Browse Standard Ebooks</title></head><body><main class="ebooks"><form role="search"></form><p class="no-results">No ebooks matched your filters.</p></main></body></html>';
export const emptyEpubbooksSearch = '<!doctype html><html><body><form role="search"></form><h1>Top Search Results for "absent"</h1><h3>No results found.</h3></body></html>';
export const emptyEbooksGratuitsSearch = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><id>https://www.ebooksgratuits.com/opds/feed.php</id><title>Recherche</title><opensearch:totalResults>0</opensearch:totalResults></feed>';
export const emptyEbookzySearch = '<!doctype html><html><body><div id="content"><h1 class="page-title">Search results for: absent</h1><section class="no-results"></section></div></body></html>';

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
    await context.route(/\/api\/sources\/fadedpage\/search(?:\?|$)/u, (route) => route.fulfill({ json: { nrows: 0, rows: [] } }));
    await context.route(/\/api\/books\/fadedpage\/[^/?]+\.epub(?:\?|$)/u, (route) => route.fulfill({ status: 503, body: "No EPUB fixture installed for this test." }));
    await context.route(/^https:\/\/www\.fadedpage\.com\//u, (route) => route.abort("blockedbyclient"));
    await context.route(/\/api\/sources\/epubbooks\/search(?:\?|$)/u, (route) => route.fulfill({ contentType: "text/html", body: emptyEpubbooksSearch }));
    await context.route(/\/api\/(?:books\/epubbooks\/|sources\/epubbooks\/cover\/)/u, (route) => route.fulfill({ status: 503, body: "No epubBooks fixture installed for this test." }));
    await context.route(/^https:\/\/www\.epubbooks\.com\//u, (route) => route.abort("blockedbyclient"));
    await context.route(/\/api\/sources\/ebookzy\/search(?:\?|$)/u, (route) => route.fulfill({ contentType: "text/html", body: emptyEbookzySearch }));
    await context.route(/\/api\/(?:books\/ebookzy\/|sources\/ebookzy\/cover\/)/u, (route) => route.fulfill({ status: 503, body: "No Ebookzy download fixture installed for this test." }));
    await context.route(/^https:\/\/ebookzy\.com\//u, (route) => route.abort("blockedbyclient"));
    await context.route(/\/api\/(?:books\/loyalbooks\/|sources\/loyalbooks\/(?:cover|detail)\/)/u, (route) => route.fulfill({ status: 503, body: "No Loyal Books edition fixture installed for this test." }));
    await context.route(/^https?:\/\/(?:www\.)?loyalbooks\.com\//u, (route) => route.abort("blockedbyclient"));
    // Generic filter tests receive an empty public SDK fixture; no Google
    // endpoint, advertisement, or real source is contacted by the browser.
    await context.route(/^https?:\/\/(?:[^/]+\.)?(?:google\.com|googleapis\.com|gstatic\.com|googlesyndication\.com|doubleclick\.net)\//u, (route) => route.abort("blockedbyclient"));
    await context.route(GOOGLE_SEARCH_SCRIPT, (route) => route.fulfill({ contentType: "application/javascript", body: googleSearchSdk() }));
    await use();
  }, { auto: true }],
});

export { expect };
