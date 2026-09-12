import JSZip from "jszip";

const ORIGIN = "https://www.fadedpage.com";
const SEARCH_PATH = "/api/sources/fadedpage/search";
const BOOK_PATH = "/api/books/fadedpage/";
const EPUB_TYPE = "application/epub+zip";
export const FADEDPAGE_LIMITS = Object.freeze({ timeoutMs: 45_000, maxCatalogBytes: 2 * 1024 * 1024, maxBookBytes: 30 * 1024 * 1024, cacheMaxBytes: 8 * 1024 * 1024, maxCachedSearches: 8, searchCacheTtlMs: 300_000 });
class SourceError extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}
const unavailable = () => new SourceError(502, "SOURCE_UNAVAILABLE", "Faded Page est temporairement indisponible. Réessayez plus tard.");
const invalid = () => new SourceError(502, "INVALID_EPUB", "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.");
const aborted = (signal) => signal.throwIfAborted();

function abortable(promise, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readLimited(response, limit, signal) {
  const length = response.headers.get("content-length");
  const tooLarge = () => new SourceError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
  if (!response.body || (length && (!/^\d+$/u.test(length) || Number(length) > limit))) {
    void response.body?.cancel().catch(() => {}); throw tooLarge();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function validateEpub(bytes) {
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw invalid();
  try {
    const zip = await JSZip.loadAsync(bytes);
    const mime = zip.file("mimetype");
    const container = zip.file("META-INF/container.xml");
    if (!mime || !container || mime._data.uncompressedSize > 50 || container._data.uncompressedSize > 1_048_576 || await mime.async("string") !== EPUB_TYPE) throw invalid();
  } catch { throw invalid(); }
}

/** Public title searches only. An anonymous PHP session is scoped to one book
 * acquisition and is never retained, logged, forwarded to the reader or reused.
 * No arbitrary host, file path, cookie or upstream URL is accepted from clients.
 */
export function createFadedpageHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const allowOrigin = options.allowOrigin || "";
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine du relais invalide.");
  }
  const limits = Object.fromEntries(Object.entries(FADEDPAGE_LIMITS).map(([key, limit]) => [key, Number.isSafeInteger(options[key]) && options[key] >= (key === "cacheMaxBytes" ? 0 : 1) ? Math.min(limit, options[key]) : limit]));
  const searches = new Map();
  const books = new Map();
  const pendingSearches = new Set();
  const pendingBooks = new Set();
  let cacheBytes = 0;
  let cooldownUntil = 0;

  async function upstream(url, signal, { method = "GET", body, cookie, epub = false } = {}) {
    aborted(signal);
    if (now() < cooldownUntil) throw new SourceError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", Math.ceil((cooldownUntil - now()) / 1000));
    const headers = { Accept: epub ? EPUB_TYPE : "application/json, text/html;q=0.9", "User-Agent": "FastReader/1.0 (+https://github.com/drslid/EPUB-FastReader; user-requested reading)" };
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    if (cookie) headers.Cookie = cookie;
    let response;
    try { response = await abortable(fetchImpl(url, { method, body, headers, redirect: "manual", credentials: "omit", signal }), signal); }
    catch { aborted(signal); throw unavailable(); }
    if (response.redirected || response.url && response.url !== url || response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new SourceError(502, "UNSAFE_REDIRECT", "Cette édition utilise une adresse de téléchargement non prise en charge.");
    }
    if ([401, 403, 429].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const seconds = Number(response.headers.get("retry-after"));
      cooldownUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.max(60_000, Math.min(seconds * 1000, 86_400_000)) : 300_000);
      throw new SourceError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", Math.ceil((cooldownUntil - now()) / 1000));
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if ([404, 410].includes(response.status)) throw new SourceError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
      throw unavailable();
    }
    return response;
  }

  async function timed(action, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new SourceError(504, "SOURCE_TIMEOUT", "Faded Page met trop de temps à répondre. Réessayez plus tard.")), limits.timeoutMs);
    timer.unref?.();
    try { return await abortable(action(controller.signal), controller.signal); }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }

  async function search(query, signal) {
    const cached = searches.get(query);
    if (cached && cached.expires > now()) return cached.bytes;
    if (pendingSearches.size >= 2) throw new SourceError(429, "SOURCE_BUSY", "Deux recherches sont déjà en cours sur cette source. Réessayez dans un instant.", 5);
    // Only completed responses are shared. An in-flight query belongs to its
    // reader, whose cancellation must never abort another reader's search.
    const slot = {};
    pendingSearches.add(slot);
    const task = timed(async (searchSignal) => {
      const response = await upstream(`${ORIGIN}/csearc2.php`, searchSignal, { method: "POST", body: new URLSearchParams({ title: query, plang: "en", sort: "title" }).toString() });
      const bytes = await readLimited(response, limits.maxCatalogBytes, searchSignal);
      let data;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw unavailable(); }
      if (!data || !Array.isArray(data.rows) || data.rows.length > 2000 || !Number.isSafeInteger(data.nrows) || data.nrows < data.rows.length || data.nrows > 1_000_000) throw unavailable();
      // Exclude unused biographies, debug output and facets from the relay cache.
      const clean = { nrows: data.nrows, rows: data.rows.map((row) => ({
        pid: row?.pid, title: row?.title, lang: row?.lang, description: row?.description, cover: row?.cover,
        authors: Array.isArray(row?.authors) ? row.authors.map((author) => ({ realname: author?.realname, pseudoname: author?.pseudoname, type: author?.type })) : [],
      })) };
      const result = new TextEncoder().encode(JSON.stringify(clean));
      while (searches.size >= limits.maxCachedSearches) searches.delete(searches.keys().next().value);
      searches.set(query, { bytes: result, expires: now() + limits.searchCacheTtlMs });
      return result;
    }, signal).finally(() => pendingSearches.delete(slot));
    return task;
  }

  function evict(id) {
    const cached = books.get(id);
    if (cached) { cacheBytes -= cached.bytes.byteLength; books.delete(id); }
  }

  async function book(id, signal) {
    const cached = books.get(id);
    if (cached && cached.expires > now()) return cached.bytes;
    evict(id);
    if (pendingBooks.size >= 1) throw new SourceError(429, "SOURCE_BUSY", "Un livre est déjà en cours de téléchargement. Réessayez dans un instant.", 10);
    const slot = {};
    pendingBooks.add(slot);
    const task = timed(async (bookSignal) => {
      const detail = await upstream(`${ORIGIN}/showbook.php?pid=${id}`, bookSignal);
      const html = new TextDecoder().decode(await readLimited(detail, limits.maxCatalogBytes, bookSignal));
      // Follow only the EPUB actually advertised on this edition's public page.
      const link = new RegExp(`\\bhref\\s*=\\s*(["'])(?:${ORIGIN.replaceAll(".", "\\.")}/|/)?link\\.php\\?file=${id}\\.epub\\1`, "u");
      if (!link.test(html)) throw new SourceError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
      const cookies = detail.headers.getSetCookie?.() || [detail.headers.get("set-cookie") || ""];
      const cookie = cookies.map((value) => /(?:^|,\s*)PHPSESSID=([A-Za-z0-9,-]{1,128})(?:;|$)/u.exec(value)?.[1]).find(Boolean);
      if (!cookie) throw unavailable();
      const response = await upstream(`${ORIGIN}/link.php?file=${id}.epub`, bookSignal, { cookie: `PHPSESSID=${cookie}`, epub: true });
      const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (![EPUB_TYPE, "application/octet-stream", "application/zip"].includes(type)) { void response.body?.cancel().catch(() => {}); throw invalid(); }
      const bytes = await readLimited(response, limits.maxBookBytes, bookSignal);
      await validateEpub(bytes);
      if (bytes.byteLength <= limits.cacheMaxBytes) {
        while (cacheBytes + bytes.byteLength > limits.cacheMaxBytes && books.size) evict(books.keys().next().value);
        books.set(id, { bytes, expires: now() + 3_600_000 });
        cacheBytes += bytes.byteLength;
      }
      return bytes;
    }, signal).finally(() => pendingBooks.delete(slot));
    return task;
  }

  return async function fadedpageHandler(request) {
    const url = new URL(request.url);
    if (url.pathname !== SEARCH_PATH && !url.pathname.startsWith(BOOK_PATH)) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (allowOrigin) headers.set("Vary", "Origin");
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== allowOrigin && origin !== url.origin) throw new SourceError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (origin === allowOrigin && origin) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Access-Control-Expose-Headers", "Content-Disposition, Retry-After"); }
      const isSearch = url.pathname === SEARCH_PATH;
      const match = /^\/api\/books\/fadedpage\/([12]\d{7})\.epub$/u.exec(url.pathname);
      if (!isSearch && (!match || url.search)) throw new SourceError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      const query = url.searchParams.get("query")?.trim() || "";
      const page = url.searchParams.get("page") || "1";
      if (isSearch && (!query || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || !/^[1-9]\d?$/u.test(page) || Number(page) > 84 || [...url.searchParams.keys()].some((key) => !["query", "page"].includes(key)) || url.searchParams.getAll("query").length > 1 || url.searchParams.getAll("page").length > 1)) throw new SourceError(400, "INVALID_QUERY", "Cette recherche n’est pas valide.");
      if (request.method === "OPTIONS" && origin === allowOrigin && origin) {
        const requested = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
        if (request.headers.get("access-control-request-method") !== "GET" || requested.some((value) => value !== "accept")) throw new SourceError(403, "PREFLIGHT_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées.");
        headers.set("Access-Control-Allow-Methods", "GET"); headers.set("Access-Control-Allow-Headers", "Accept"); headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") { headers.set("Allow", "GET, OPTIONS"); throw new SourceError(405, "METHOD_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées."); }
      const bytes = isSearch ? await search(query, request.signal) : await book(match[1], request.signal);
      headers.set("Content-Type", isSearch ? "application/json; charset=utf-8" : EPUB_TYPE);
      headers.set("Content-Length", String(bytes.byteLength));
      if (!isSearch) headers.set("Content-Disposition", `inline; filename="fadedpage-${match[1]}.epub"`);
      return new Response(bytes, { headers });
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      const failure = error instanceof SourceError ? error : unavailable();
      headers.set("Content-Type", "application/json; charset=utf-8");
      if (failure.retryAfter) headers.set("Retry-After", String(failure.retryAfter));
      return new Response(JSON.stringify({ error: { code: failure.code, message: failure.message } }), { status: failure.status, headers });
    }
  };
}

export function createFadedpageMiddleware(options = {}) {
  const handler = createFadedpageHandler(options);
  return async (req, res, next = () => {}) => {
    if (!String(req.url).startsWith(BOOK_PATH) && !String(req.url).startsWith(SEARCH_PATH)) return next();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", abort);
    try {
      const response = await handler(new Request(new URL(req.url, "http://localhost"), { method: req.method, headers: req.headers, signal: controller.signal }));
      if (!response) return next();
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch {
      if (!res.destroyed && !res.writableEnded) { res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: { code: "SOURCE_UNAVAILABLE", message: unavailable().message } })); }
    } finally { res.removeListener("close", abort); }
  };
}
