# Faded Page integration audit

Verified on 12 September 2026 against the live publisher website, from Node, a local Cloudflare Workers runtime and Chromium running on the GitHub Pages origin.

## Reader experience

Faded Page adds English title searches to FastReader. Search results include the title, author, source link and the publisher's cover where available. Selecting **Read** retrieves the edition's EPUB and opens it through the normal local library import path.

The collection is based on the **Canadian public domain**. This does not establish permission to download every title elsewhere. FastReader attaches the publisher's [copyright information](https://www.fadedpage.com/copyright.php) to each result and keeps the regional rights notice visible.

## Verified public flow

The official [catalogue search form](https://www.fadedpage.com/csearch.php) submits a normal public POST to `https://www.fadedpage.com/csearc2.php`. The adapter sends only `title`, `plang=en` and `sort=title`. Its JSON includes `rows`, `nrows`, edition IDs, titles, descriptions, language, cover paths and credited authors. FastReader does not use biographies, debug data or facets.

There is no documented stable third-party API. The site's `robots.txt` excludes the form's backend from crawler indexing. The integration performs bounded, reader-initiated title queries; it does not enumerate or mirror the catalogue. Empty searches do not contact the provider. Repeated queries share a five-minute cache, and changing a results page reuses that same response. A provider response can itself be truncated: FastReader marks the count approximate and only paginates records actually returned, rather than inventing further upstream pages.

The [public edition page](https://www.fadedpage.com/showbook.php?pid=20260903) advertises `link.php?file=20260903.epub`. Faded Page requires the anonymous PHP session created by visiting that page. The relay follows this ordinary visit-then-click sequence, validates that the exact EPUB link is present, and passes that newly issued session cookie only to the same provider's file endpoint. No user account, authentication, captcha or mirror is involved. The session is discarded after the acquisition and is never exposed to readers.

The source does not supply CORS headers for catalogue or EPUB requests. A direct browser fetch from `https://drslid.github.io` fails with a CORS error; the configured FastReader relay is necessary. Covers can load directly with `referrerpolicy="no-referrer"`, already used by FastReader.

## Live evidence

| Check | Observed result |
| --- | --- |
| Title query `Jane` via the relay handler | HTTP 200; normalized JSON, 7,896 bytes |
| EPUB `20260903`, *Jane: A Story of Jamaica*, Herbert G. de Lisser | HTTP 200; 296,961 bytes |
| EPUB archive validation | ZIP containing `mimetype=application/epub+zip` and `META-INF/container.xml` |
| Node and local Workers acquisition | Same bytes; SHA-256 `5e4414cfdb40758c4f45403e35c3c41373d7db3dd9dfa22c1d6ffd09b9cf993b` |
| [Catalogue cover](https://www.fadedpage.com/books/20260903/cover.jpg) in Chromium | HTTP 200, JPEG, 350 × 536 pixels, before any EPUB acquisition |
| Catalogue and embedded `cover.jpg` | Same 38,868 bytes; SHA-256 `5c600f6b20fc5cc81d6d8789687c302908e7e779324e05ec577199647cfad31d` |
| Relay CORS | Exact configured Pages origin; session cookie absent from response |

The EPUB and its original licence remain unchanged. Faded Page editions may contain restrictions on modifications or commercial reuse; the adapter marks transformed exports unavailable, while the ordinary original edition remains usable for classic reading and download. See the [source's mission](https://www.fadedpage.com/mission.php) and each edition's own licence.

## Integration contract

- Frontend: `src/sources/fadedpage.js`, provider ID `fadedpage`, source contract v1.
- Search: `GET /api/sources/fadedpage/search?query=Jane&page=1` returns bounded JSON. Browser pagination displays 24 records at a time.
- Acquisition: `GET /api/books/fadedpage/20260903.epub` returns only a validated EPUB.
- Node/Worker: `createFadedpageHandler(options)` accepts Fetch `Request` objects; `createFadedpageMiddleware(options)` provides a Node middleware adapter.
- Availability: `HEAD https://www.fadedpage.com/csearch.php` checks reachability without creating download sessions or acquiring a book.

Only fixed official origins, paths and validated eight-digit IDs are accepted. Upstream redirects, challenge responses and login failures stop the request. Catalogue bytes are limited to 2 MiB, EPUBs to 30 MiB, requests to 45 seconds, simultaneous searches to two and EPUB acquisitions to one per handler. The shared Worker additionally limits total EPUB buffering across providers. The memory cache is bounded to 8 MiB of books and eight searches; no personal reading data reaches it.

Automated tests cover metadata and URLs, credited pen names, pagination, malformed responses, scope-restricted cookies, CORS, HTML disguised as EPUB, oversize bodies, cancellation/timeouts, upstream throttling and concurrent search during an acquisition. The browser test exercises a representative response and valid EPUB through the real import/IndexedDB/reader path, including a reload and offline reopening. Live website probes are separate from deterministic tests.
