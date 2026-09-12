# Atramenta integration audit

**Archived: Atramenta has been removed from FastReader at the reader’s request after the public host could not access it. Its adapter, routes, catalogue tab and availability probes are no longer active. Previously imported EPUBs remain in each reader’s local library. The observations below describe the former integration.**

Implementation and deterministic tests checked on 12 September 2026. Live observations and mocked regression tests are distinguished below.

**Public deployment limitation:** on 12 September 2026 at approximately 19:53 UTC, the deployed Cloudflare service returned HTTP 503 with `SOURCE_BUSY` for its first Flaubert search. Its independent reachability check also reported Atramenta unavailable. The adapter persisted the refusal, no EPUB acquisition was attempted, and no alternative identity or route was tried. The integration remains visible with an unavailable status; direct reading from the public Pages application has **not** been demonstrated. The earlier successful anonymous acquisition from the exploratory environment does not establish access from this host.

## Reader experience

Atramenta adds French works from its **free-reading section**. Results show complete titles, authors, source links and available covers. **Read** requests the EPUB, saves the original archive in the reader's browser and opens the ordinary reader in word-by-word mode. Returning to the local library does not acquire the book again.

The adapter excludes the site's separate paid-book and sample sections. A work must advertise a free download on its result row, and its detail page must explicitly offer EPUB before acquisition. Availability of a work does not establish its legal status in every country: results retain a regional rights notice and link to the [source's licence information](https://www.atramenta.net/help/licences). Source editions and their embedded licence notices are preserved; the ordinary EPUB download returns the original classic edition without inserting Focus markup.

## Public catalogue and acquisition

The [public search form](https://www.atramenta.net/search/?atmt_search=Flaubert&search_encoding=UTF-8) accepts `atmt_search` with `search_encoding=UTF-8`. Responses observed during the initial audit use ISO-8859-1; the relay transcodes their declared encoding to UTF-8 before parsing. Only `.liste_oeuvres .lo_lecture_libre` records with a matching `#telecharger` link are eligible. This adapter exposes the returned records as an approximate count; it does not invent additional source pages.

For the [public edition of *Un cœur simple*](https://www.atramenta.net/lire/un-coeur-simple/15038), the ordinary download sequence is:

1. Visit the edition and retain the anonymous cookies issued by Atramenta.
2. Read the page's `action_sig` and verify the EPUB button.
3. Send the page's normal `get_dl_allowance=1` request.
4. If anonymous downloads remain, request `get_dl_url=1`, `dl_format=epub` and that action signature on the same edition page.
5. Retrieve only the returned, validated `/download_libre/.../un-coeur-simple/15038.epub` address on `www.atramenta.net`.

Only provider-issued `PHPSESSID` and `not_a_bot` cookies are retained. Reader cookies are never forwarded, and provider cookies are never returned to the reader. The relay does not create an account, solve a challenge, switch identity or retry a different domain following a refusal.

## Quota, persistence and cancellation

The relay reserves at most **four acquisition attempts in a rolling 24-hour period**, including failures. The shared Worker stores reservation timestamps and the same anonymous provider session in Durable Object storage. Concurrent readers therefore cannot obtain separate quotas by opening more tabs or by causing the process to restart. A completed EPUB can be served from the bounded cache without making another acquisition.

Provider refusals are also persisted through `loadDownloadBlock()` / `saveDownloadBlock(block)`. The versioned object keeps independent `source` and `downloads` refusal records, each containing `until`, `scope`, `status`, `code` and `message`; it contains no reader identity. A short source cooldown therefore cannot overwrite a full-day download quota. The previous single-record shape remains readable. `Retry-After` supports both seconds and HTTP dates. Subsequent refusals use the remaining delay instead of extending it on each request.

- Exhausted EPUB allowance, an acquisition rate limit or a required login prevents further acquisition. Catalogue search remains usable.
- An origin-level HTTP 401/403 refusal pauses uncached source requests. HTTP 429/503 cooldowns follow the affected scope.
- A timeout or cancellation stops the in-flight request and releases its concurrency slot. It does not reset the anonymous session or erase an already reserved attempt.
- A refused EPUB never becomes a placeholder book in IndexedDB. FastReader displays the known source error and offers the edition's own page and ordinary local import.

The Node handler supports the same persistence callbacks. Without a durable coordinator supplied by its host, session and attempt state remain in memory for that process; the deployed shared Worker supplies durable storage.

## Boundaries

Searches are user initiated, independently cancellable and cached only after completion for five minutes. Two searches and one acquisition may run concurrently per handler; an exhausted download quota does not use either search slot. Catalogue responses are bounded to 2 MiB, EPUBs to 30 MiB, searches to 35 seconds and acquisition to 55 seconds. Search and EPUB caches have explicit byte budgets; the Worker supplies its own smaller shared memory budgets.

Only fixed official paths and validated edition IDs are accepted. Redirects and unrelated download URLs are rejected. Files must have a ZIP signature, the EPUB `mimetype` entry and `META-INF/container.xml`. The compressed `mimetype` entry is limited to 256 bytes before inflation, so a forged uncompressed-size header cannot trigger large decompression. The relay exposes CORS only to its configured Pages origin. Books, positions and notes remain in the reader's browser.

## Evidence and verification limits

The initial exploratory audit recorded one normal anonymous acquisition of *Un cœur simple* (Atramenta edition `15038`): a 102,012-byte EPUB and a 33,803-byte JPEG cover, identical to the embedded cover. Those original temporary artifacts were not available in this verification environment; these measurements are retained as the initial audit record, not presented as a freshly reproduced live acquisition. No additional live EPUB was downloaded while completing this adapter's regression tests, to preserve the provider's quota. Production relay validation is a separate deployment check.

The automated suite uses explicit fixtures and makes no live provider downloads:

- `tests/atramenta.test.js` checks complete metadata, UTF-8 text, cover and source identities, free-download eligibility, invalid responses and bounded request construction.
- `tests/atramenta-server.test.js` checks the normal anonymous session flow, four-attempt budget, persistent refusal after restart, both forms of `Retry-After`, search availability during an EPUB quota, unchanged session on cancellation, URL validation, CORS, invalid/oversized EPUBs and timeouts.
- `tests/e2e/atramenta.spec.js` exercises representative catalogue HTML and an explicitly generated EPUB through the real app: cover before acquisition, **Read**, IndexedDB archive, word-by-word reader, persistent embedded cover, reload and reopening while offline. Its second scenario verifies the visible quota message, no false library entry and continued search.

Verification results: **41 unit tests passed** and **6 browser checks passed** across desktop Chromium, Pixel 7 Chromium and iPad WebKit. Offline reopening was tested after loading the app and reloading the library; this isolated browser suite blocks service workers and does not claim to test a fresh offline PWA launch.
