import JSZip from "jszip";

const ORIGIN = "https://www.ebooksgratuits.com";
const SEARCH_PATH = "/api/sources/ebooks-gratuits/search";
const BOOK_PATH = "/api/books/ebooks-gratuits/";
const EPUB_TYPE = "application/epub+zip";
const DAY = 86_400_000;
export const EBOOKS_GRATUITS_LIMITS = Object.freeze({
  timeoutMs: 60_000,
  maxCatalogBytes: 2 * 1024 * 1024,
  maxBookBytes: 30 * 1024 * 1024,
  maxDailyDownloads: 50,
  minDownloadIntervalMs: 12_100,
  maxQueuedDownloads: 3,
  cacheMaxBytes: 64 * 1024 * 1024,
  cacheTtlMs: 6 * 60 * 60 * 1000,
  searchCacheTtlMs: 5 * 60 * 1000,
  maxCachedSearches: 50,
});

class SourceError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    Object.assign(this, { status, code, retryAfter });
  }
}
export { SourceError as EbooksGratuitsError };
const unavailable = () => new SourceError(502, "SOURCE_UNAVAILABLE", "Ebooks libres et gratuits est temporairement indisponible. Réessayez plus tard.");
const invalid = () => new SourceError(502, "INVALID_EPUB", "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.");
const aborted = (signal) => { if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError"); };

function raceAbort(promise, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function limitedBytes(response, maxBytes, signal) {
  const size = response.headers.get("content-length");
  if ((size && (!/^\d+$/u.test(size) || Number(size) > maxBytes)) || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new SourceError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new SourceError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function validateEpub(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw invalid();
  try {
    const zip = await JSZip.loadAsync(bytes);
    const mime = zip.file("mimetype");
    const container = zip.file("META-INF/container.xml");
    // Some genuine ELG EPUBs put META-INF before mimetype. Validate their ZIP
    // entries rather than demanding mimetype at byte zero, without rewriting it.
    if (!mime || !container || mime._data.uncompressedSize > 50 || container._data.uncompressedSize > 1_048_576 || await mime.async("string") !== EPUB_TYPE) throw invalid();
  } catch { throw invalid(); }
}

function allowedOrigin(value) {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) throw new TypeError("Le relais doit autoriser une origine HTTPS exacte.");
  return value;
}

function configuredLimits(options) {
  return Object.fromEntries(Object.entries(EBOOKS_GRATUITS_LIMITS).map(([key, fallback]) => {
    const value = options[key];
    // Deployments may tighten upstream limits, never increase traffic allowances.
    const valid = Number.isSafeInteger(value) && value >= (key === "cacheMaxBytes" ? 0 : 1);
    return [key, valid ? key === "minDownloadIntervalMs" ? Math.max(value, fallback) : Math.min(value, fallback) : fallback];
  }));
}

/** Fetch-standard handler, reusable in an edge worker. Instantiate once per server.
 * Multi-instance deployments must provide a shared reserveDownload callback that
 * enforces the same global rate/rolling-day quota; in-memory state is process-local.
 */
export function createEbooksGratuitsHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const allowOrigin = allowedOrigin(options.allowOrigin);
  const limits = configuredLimits(options);
  const bookCache = new Map();
  const searchCache = new Map();
  const pendingBooks = new Map();
  const pendingSearches = new Map();
  const downloads = [];
  let cacheBytes = 0;
  let queueTail = Promise.resolve();
  let lastDownloadStarted = -Infinity;
  let cooldownUntil = 0;

  function evictBook(id) {
    const entry = bookCache.get(id);
    if (entry) { cacheBytes -= entry.bytes.byteLength; bookCache.delete(id); }
  }
  async function upstream(url, signal, epub = false) {
    aborted(signal);
    if (cooldownUntil > now()) throw new SourceError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", Math.ceil((cooldownUntil - now()) / 1000));
    let response;
    try {
      response = await raceAbort(fetchImpl(url, {
        method: "GET", redirect: "manual", credentials: "omit", signal,
        headers: {
          Accept: epub ? EPUB_TYPE : "application/atom+xml, application/xml;q=0.9",
          "User-Agent": "FastReader/1.0 (+https://github.com/drslid/EPUB-FastReader; individual OPDS requests)",
        },
      }), signal);
    } catch (error) { aborted(signal); throw unavailable(); }
    if (response.redirected || (response.url && response.url !== url)) {
      void response.body?.cancel().catch(() => {});
      throw new SourceError(502, "UNSAFE_REDIRECT", "La source a redirigé vers une adresse non autorisée.");
    }
    if ([401, 403, 429].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const delay = Number(response.headers.get("retry-after"));
      cooldownUntil = now() + (Number.isFinite(delay) && delay > 0 ? Math.max(delay * 1000, 60_000) : 300_000);
      throw new SourceError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", Math.ceil((cooldownUntil - now()) / 1000));
    }
    return response;
  }

  async function timed(action, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new SourceError(504, "SOURCE_TIMEOUT", "Ebooks libres et gratuits met trop de temps à répondre. Réessayez plus tard.")), limits.timeoutMs);
    timer.unref?.();
    try { return await raceAbort(action(controller.signal), controller.signal); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }

  async function search(query, page, signal) {
    const key = `${page}:${query}`;
    const cached = searchCache.get(key);
    if (cached && cached.expires > now()) return cached.bytes;
    if (pendingSearches.has(key)) return raceAbort(pendingSearches.get(key), signal);
    if (pendingSearches.size >= 2) throw new SourceError(429, "SOURCE_BUSY", "Deux recherches sont déjà en cours sur cette source. Réessayez dans un instant.", 5);
    const task = timed(async (timeoutSignal) => {
      const url = new URL(`${ORIGIN}/opds/feed.php`);
      url.search = new URLSearchParams({ mode: "search", query, page: String(page - 1) }).toString();
      const response = await upstream(url.href, timeoutSignal);
      if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
      const bytes = await limitedBytes(response, limits.maxCatalogBytes, timeoutSignal);
      const text = new TextDecoder().decode(bytes);
      if (!/<(?:\w+:)?feed\b/u.test(text) || /<!DOCTYPE|<!ENTITY/iu.test(text)) throw unavailable();
      while (searchCache.size >= limits.maxCachedSearches) searchCache.delete(searchCache.keys().next().value);
      searchCache.set(key, { bytes, expires: now() + limits.searchCacheTtlMs });
      return bytes;
    }, signal).finally(() => pendingSearches.delete(key));
    pendingSearches.set(key, task);
    return task;
  }

  async function reserve(signal) {
    aborted(signal);
    while (downloads.length && downloads[0] <= now() - DAY) downloads.shift();
    if (downloads.length >= limits.maxDailyDownloads) throw new SourceError(429, "SOURCE_DAILY_LIMIT", "La limite quotidienne de cette source est atteinte. Réessayez demain.", Math.ceil((downloads[0] + DAY - now()) / 1000));
    const wait = Math.max(0, lastDownloadStarted + limits.minDownloadIntervalMs - now());
    if (wait) {
      let timer;
      try { await raceAbort(new Promise((resolve) => { timer = setTimeout(resolve, wait); }), signal); }
      finally { clearTimeout(timer); }
    }
    // Optional deployment coordinator persists limits across restarts/instances.
    if (options.reserveDownload) await raceAbort(options.reserveDownload({ signal, now: now(), limits }), signal);
    lastDownloadStarted = now();
    downloads.push(now());
  }

  async function book(id, signal) {
    const cached = bookCache.get(id);
    if (cached && cached.expires > now()) return cached.bytes;
    evictBook(id);
    if (pendingBooks.has(id)) return raceAbort(pendingBooks.get(id), signal);
    if (pendingBooks.size >= limits.maxQueuedDownloads) throw new SourceError(429, "SOURCE_BUSY", "Des livres sont déjà en attente sur cette source. Réessayez dans un instant.", 15);
    const task = queueTail.catch(() => {}).then(() => timed(async (timeoutSignal) => {
      await reserve(timeoutSignal);
      let url = `${ORIGIN}/newsendbook.php?id=${id}&format=epub`;
      let response = await upstream(url, timeoutSignal, true);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        void response.body?.cancel().catch(() => {});
        let target;
        try { target = new URL(location, url); } catch { throw unavailable(); }
        if (!location || target.origin !== ORIGIN || target.username || target.password || target.search || target.hash || !/^\/epub\/[A-Za-z0-9_-]+\.epub$/u.test(target.pathname)) {
          throw new SourceError(502, "UNSAFE_REDIRECT", "Cette édition utilise une adresse de téléchargement non prise en charge.");
        }
        url = target.href;
        response = await upstream(url, timeoutSignal, true);
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        if ([404, 410].includes(response.status)) throw new SourceError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
        throw unavailable();
      }
      const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (![EPUB_TYPE, "application/octet-stream", "application/zip", "application/x-zip-compressed", "application/force-download"].includes(type)) { void response.body?.cancel().catch(() => {}); throw invalid(); }
      const bytes = await limitedBytes(response, limits.maxBookBytes, timeoutSignal);
      await validateEpub(bytes);
      if (bytes.byteLength <= limits.cacheMaxBytes) {
        while (cacheBytes + bytes.byteLength > limits.cacheMaxBytes && bookCache.size) evictBook(bookCache.keys().next().value);
        bookCache.set(id, { bytes, expires: now() + limits.cacheTtlMs });
        cacheBytes += bytes.byteLength;
      }
      return bytes;
    }, signal)).finally(() => pendingBooks.delete(id));
    pendingBooks.set(id, task);
    queueTail = task.catch(() => {});
    return task;
  }

  return async function ebooksGratuitsHandler(request) {
    const url = new URL(request.url);
    if (url.pathname !== SEARCH_PATH && !url.pathname.startsWith(BOOK_PATH)) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (allowOrigin) headers.set("Vary", "Origin");
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== allowOrigin && origin !== url.origin) throw new SourceError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (origin === allowOrigin) {
        headers.set("Access-Control-Allow-Origin", allowOrigin);
        headers.set("Access-Control-Expose-Headers", "Content-Disposition, Retry-After");
      }
      const isSearch = url.pathname === SEARCH_PATH;
      const match = /^\/api\/books\/ebooks-gratuits\/([1-9]\d{0,8})\.epub$/u.exec(url.pathname);
      if (!isSearch && (!match || url.search)) throw new SourceError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      const query = url.searchParams.get("query")?.trim() || "";
      const pageText = url.searchParams.get("page") || "1";
      if (isSearch && (query.length < 1 || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || !/^[1-9]\d{0,2}$|^1000$/u.test(pageText) || [...url.searchParams.keys()].some((key) => !["query", "page"].includes(key)) || url.searchParams.getAll("query").length > 1 || url.searchParams.getAll("page").length > 1)) throw new SourceError(400, "INVALID_QUERY", "Cette recherche n’est pas valide.");
      if (request.method === "OPTIONS" && origin === allowOrigin && allowOrigin) {
        const requestedHeaders = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
        if (request.headers.get("access-control-request-method") !== "GET" || requestedHeaders.some((value) => value !== "accept")) throw new SourceError(403, "PREFLIGHT_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées.");
        headers.set("Access-Control-Allow-Methods", "GET"); headers.set("Access-Control-Allow-Headers", "Accept"); headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") { headers.set("Allow", "GET, OPTIONS"); throw new SourceError(405, "METHOD_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées."); }
      const bytes = isSearch ? await search(query, Number(pageText), request.signal) : await book(match[1], request.signal);
      headers.set("Content-Type", isSearch ? "application/atom+xml; charset=utf-8" : EPUB_TYPE);
      headers.set("Content-Length", String(bytes.byteLength));
      if (!isSearch) headers.set("Content-Disposition", `inline; filename="ebooks-gratuits-${match[1]}.epub"`);
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

/** Minimal Node adapter. The core above only uses Fetch APIs and Uint8Array. */
export function createEbooksGratuitsMiddleware(options = {}) {
  const handler = createEbooksGratuitsHandler(options);
  return async (req, res, next = () => {}) => {
    if (!String(req.url).startsWith(BOOK_PATH) && !String(req.url).startsWith(SEARCH_PATH)) return next();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", abort);
    try {
      const request = new Request(new URL(req.url, "http://localhost"), { method: req.method, headers: req.headers, signal: controller.signal });
      const response = await handler(request);
      if (!response) return next();
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) { res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: { code: "SOURCE_UNAVAILABLE", message: unavailable().message } })); }
    } finally { res.removeListener("close", abort); }
  };
}
