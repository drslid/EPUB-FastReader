import { readFile, writeFile, mkdir, rename, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";

export const LOYALBOOKS_LANGUAGES = Object.freeze({ en: "English", fr: "French", es: "Spanish", it: "Italian", de: "German", pt: "Portuguese" });
const ORIGIN = "https://www.loyalbooks.com";
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.,'()!~-]{0,199}$/u;
const INTERVAL = 60_000;
const MAX_HTML = 2 * 1024 * 1024;

export function parseLoyalbooksListing(html, language, page = 1) {
  const name = LOYALBOOKS_LANGUAGES[language];
  if (!name) throw new Error("Unsupported language");
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const header = [...doc.querySelectorAll("h1")].map((el) => el.textContent.trim()).find((text) => text.startsWith(`${name}:`));
    const totalMatch = new RegExp(`^${name}: ([\\d,]+) free ebooks$`, "u").exec(header || "");
    const pagination = /Page\s+(\d+)\s+of\s+(\d+)/u.exec(doc.body.textContent);
    if (!totalMatch || !pagination || Number(pagination[1]) !== page) throw new Error("Loyal Books did not provide the requested EPUB catalogue page");
    const total = Number(totalMatch[1].replaceAll(",", ""));
    const pages = Number(pagination[2]);
    if (!Number.isSafeInteger(total) || total > 100_000 || pages < 1 || pages > 1000) throw new Error("Invalid Loyal Books catalogue count");
    const books = [];
    const seen = new Set();
    for (const cell of doc.querySelectorAll("td.layout2-blue, td.layout3")) {
      // The catalogue has illustrated cards followed by smaller text-only rows.
      // Ads and the site's unrelated suggestions do not have a book title link.
      const links = [...cell.querySelectorAll('a[href^="/book/"]')].filter((link) => link.querySelector("b") || /^By:/u.test(link.nextSibling?.textContent?.trim() || ""));
      for (const link of links) {
        let slug;
        try { slug = decodeURIComponent(link.getAttribute("href").slice(6)); } catch { continue; }
        if (!SLUG.test(slug) || seen.has(slug)) continue;
        const title = (link.querySelector("b")?.textContent || link.textContent).replace(/\s+/gu, " ").trim();
        if (!title || title.length > 2000) throw new Error("Invalid Loyal Books title");
        const tail = [];
        for (let node = link.nextSibling; node; node = node.nextSibling) {
          if (node.nodeType === 1 && node.nodeName !== "BR") break;
          tail.push(node.textContent || "");
        }
        const author = tail.join(" ").replace(/^\s*By:\s*/u, "").replace(/\s+/gu, " ").trim() || "Unknown";
        if (author.length > 1000) throw new Error("Invalid Loyal Books author");
        const image = [...cell.querySelectorAll("a")].find((candidate) => candidate.getAttribute("href") === link.getAttribute("href") && candidate.querySelector("img"))?.querySelector("img");
        const imagePath = image?.getAttribute("src") || "";
        const cover = /^\/image\/layout2\/[A-Za-z0-9_().-]+\.(?:jpe?g|png)$/iu.test(imagePath) ? `${ORIGIN}${imagePath}` : null;
        seen.add(slug);
        books.push({ slug, title, author, language, cover });
      }
    }
    if (!books.length || books.length > 100) throw new Error("Empty or oversized Loyal Books EPUB catalogue page");
    return { books, total, pages };
  } finally { dom.window.close(); }
}

async function jsonFile(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

async function readHtml(response, signal) {
  if (response.status !== 200 || response.redirected || !response.headers.get("content-type")?.includes("text/html")) throw new Error(`Loyal Books refused the catalogue request (HTTP ${response.status}); collection stopped`);
  if (Number(response.headers.get("content-length")) > MAX_HTML) throw new Error("Loyal Books response exceeds 2 MiB");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML) throw new Error("Loyal Books response exceeds 2 MiB");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function updateLoyalbooks({
  output = resolve("public/catalog/loyalbooks.json"), checkpoint = resolve(".cache/loyalbooks-index.json"),
  // The public English list currently has a count but no cards. Keep it
  // explicitly excluded until that provider page becomes usable again.
  languages = ["fr", "es", "it", "de", "pt"], pagesPerLanguage = 1,
  refresh = false, fetchImpl = globalThis.fetch, now = Date.now, wait = delay, signal, log = console.log,
} = {}) {
  if (!languages.length || languages.some((code) => !LOYALBOOKS_LANGUAGES[code]) || new Set(languages).size !== languages.length || !Number.isSafeInteger(pagesPerLanguage) || pagesPerLanguage < 1 || pagesPerLanguage > 1000) throw new Error("Invalid catalogue collection options");
  await mkdir(dirname(checkpoint), { recursive: true });
  const lockPath = `${checkpoint}.lock`;
  const lock = await open(lockPath, "wx");
  try {
    await lock.writeFile(`${process.pid}\n`);
    const state = await jsonFile(checkpoint, { version: 1, nextAllowedAt: 0, pages: {} });
    if (state.version !== 1 || !state.pages || !Number.isFinite(state.nextAllowedAt)) throw new Error("Invalid Loyal Books checkpoint; previous snapshot preserved");
    // A refresh creates a new staged generation. Existing public data remains
    // untouched until collection succeeds; restarting resumes this generation.
    if (refresh && !state.refreshing) { state.pages = {}; state.refreshing = true; await atomicJson(checkpoint, state); }
    for (let page = 1; page <= pagesPerLanguage; page++) {
      for (const language of languages) {
        signal?.throwIfAborted();
        const key = `${language}:${page}`;
        if (state.pages[key] || state.pages[`${language}:1`]?.pages < page) continue;
        const remaining = Math.max(0, state.nextAllowedAt - now());
        if (remaining) { log(`Loyal Books: respecting crawl delay (${Math.ceil(remaining / 1000)} s)`); await wait(remaining, undefined, { signal }); }
        // Persist BEFORE the request: retries and process restarts cannot reset
        // the provider's crawl delay, even after a timeout or a refused response.
        state.nextAllowedAt = now() + INTERVAL;
        await atomicJson(checkpoint, state);
        const url = `${ORIGIN}/language/${LOYALBOOKS_LANGUAGES[language]}?type=ebook&results=100${page > 1 ? `&page=${page}` : ""}`;
        log(`Loyal Books: ${language}, page ${page} (metadata only)`);
        const timeout = AbortSignal.timeout(25_000);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetchImpl(url, { redirect: "manual", credentials: "omit", signal: combined, headers: { Accept: "text/html", "User-Agent": "FastReader/1.0 (+https://github.com/drslid/EPUB-FastReader; public catalogue index)" } });
        const parsed = parseLoyalbooksListing(await readHtml(response, combined), language, page);
        state.pages[key] = { ...parsed, fetchedAt: new Date(now()).toISOString() };
        await atomicJson(checkpoint, state);
      }
    }
    const books = [];
    const coverage = {};
    const seen = new Set();
    const dates = [];
    for (const language of languages) {
      let indexed = 0;
      let collected = 0;
      const first = state.pages[`${language}:1`];
      if (!first) throw new Error("Incomplete first-page collection; previous snapshot preserved");
      for (let page = 1; page <= Math.min(pagesPerLanguage, first.pages); page++) {
        const result = state.pages[`${language}:${page}`];
        if (!result) throw new Error("Incomplete catalogue collection; previous snapshot preserved");
        collected++; dates.push(result.fetchedAt);
        for (const book of result.books) {
          const key = `${book.language}:${book.slug}`;
          if (seen.has(key)) continue;
          seen.add(key); books.push(book); indexed++;
        }
      }
      coverage[language] = { indexed, total: first.total, pages: collected, complete: collected === first.pages && indexed >= first.total };
    }
    const excludedLanguages = Object.keys(LOYALBOOKS_LANGUAGES).filter((language) => !languages.includes(language));
    const snapshot = { version: 1, updatedAt: dates.sort().at(-1), coverage: !excludedLanguages.length && Object.values(coverage).every((item) => item.complete) ? "complete" : "selection", languages: coverage, excludedLanguages, books };
    // Publication is atomic and happens only after every requested page passed
    // validation. A refused/changed page never erases a working public snapshot.
    if (Buffer.byteLength(`${JSON.stringify(snapshot, null, 2)}\n`) > MAX_HTML) throw new Error("Loyal Books snapshot exceeds the client's 2 MiB limit; reduce --pages-per-language or split the catalogue before publishing. Previous snapshot preserved.");
    await atomicJson(output, snapshot);
    if (state.refreshing) { delete state.refreshing; await atomicJson(checkpoint, state); }
    log(`Loyal Books: published ${books.length} EPUB catalogue entries (${snapshot.coverage})`);
    if (excludedLanguages.length) log(`Loyal Books: languages not indexed in this snapshot: ${excludedLanguages.join(", ")}`);
    return snapshot;
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]; const value = args[i + 1];
    if (flag === "--refresh") { options.refresh = true; i--; continue; }
    if (!value || !["--output", "--checkpoint", "--languages", "--pages-per-language"].includes(flag)) throw new Error("Usage: node scripts/update-loyalbooks.mjs [--refresh] [--pages-per-language 1] [--languages fr,es,it,de,pt] [--checkpoint .cache/loyalbooks-index.json] [--output public/catalog/loyalbooks.json]");
    if (flag === "--languages") options.languages = value.split(",");
    else if (flag === "--pages-per-language") options.pagesPerLanguage = Number(value);
    else options[flag.slice(2)] = resolve(value);
  }
  await updateLoyalbooks(options);
}
