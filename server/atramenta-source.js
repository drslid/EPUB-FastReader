import JSZip from "jszip";

const ORIGIN = "https://www.atramenta.net";
const SEARCH_PATH = "/api/sources/atramenta/search";
const BOOK_PATH = "/api/books/atramenta/";
const EPUB = "application/epub+zip";
const DAY = 86_400_000;
const ID = /^([1-9]\d{0,8})-([a-z0-9]+(?:-[a-z0-9]+)*)$/u;
const COOKIE_NAMES = ["PHPSESSID", "not_a_bot"];
export const ATRAMENTA_LIMITS = Object.freeze({ timeoutMs: 55_000, maxCatalogBytes: 2 * 1024 * 1024, maxBookBytes: 30 * 1024 * 1024, maxDailyDownloads: 4, cacheMaxBytes: 4 * 1024 * 1024, searchCacheMaxBytes: 4 * 1024 * 1024, maxCachedSearches: 4 });
export class AtramentaError extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}
const failure = () => new AtramentaError(502, "SOURCE_UNAVAILABLE", "Atramenta est temporairement indisponible. Réessayez plus tard.");
const invalidEpub = () => new AtramentaError(502, "INVALID_EPUB", "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.");
const quotaError = (retryAfter = 86_400) => new AtramentaError(429, "SOURCE_DAILY_LIMIT", "Le quota quotidien partagé d’Atramenta est atteint. Réessayez demain ou consultez la source.", retryAfter);

function retrySeconds(value, timestamp, fallback = 300) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const seconds = /^\d+$/u.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - timestamp) / 1000);
  return Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(timestamp + seconds * 1000) ? seconds : fallback;
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function readLimited(response, limit, signal) {
  const length = response.headers.get("content-length");
  const tooLarge = () => new AtramentaError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
  if (!response.body || length && (!/^\d+$/u.test(length) || Number(length) > limit)) { void response.body?.cancel().catch(() => {}); throw tooLarge(); }
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
function decode(bytes, headers) {
  const charset = headers.get("content-type") || "";
  return new TextDecoder(/charset\s*=\s*["']?(?:iso-8859-1|windows-1252)/iu.test(charset) ? "windows-1252" : "utf-8").decode(bytes);
}
function attribute(tag, name) { return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "iu").exec(tag)?.[2]; }
function actionToken(html) {
  const tags = html.match(/<meta\b[^>]*>/giu) || [];
  const tag = tags.find((value) => attribute(value, "name") === "action_sig");
  const value = tag && attribute(tag, "content");
  if (!value || !/^[a-zA-Z0-9_-]{6,128}$/u.test(value)) throw failure();
  return value;
}
function cleanSession(value) {
  return Object.fromEntries(COOKIE_NAMES.filter((name) => typeof value?.[name] === "string" && /^[A-Za-z0-9,._~-]{1,256}$/u.test(value[name])).map((name) => [name, value[name]]));
}
async function validateEpub(bytes) {
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw invalidEpub();
  try {
    const zip = await JSZip.loadAsync(bytes);
    const mime = zip.file("mimetype"), container = zip.file("META-INF/container.xml");
    if (!mime || !container || mime._data.compressedSize > 256 || mime._data.uncompressedSize > 50 || container._data.uncompressedSize > 1_048_576 || await mime.async("string") !== EPUB) throw invalidEpub();
  } catch { throw invalidEpub(); }
}

/** The upstream's anonymous download session stays stable. Persist it and the
 * four-attempt daily budget in a shared coordinator for multi-instance hosting.
 * A quota, authentication requirement or challenge never creates a new session.
 */
export function createAtramentaHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const allowOrigin = options.allowOrigin || "";
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine du relais invalide.");
  }
  const limits = Object.fromEntries(Object.entries(ATRAMENTA_LIMITS).map(([key, limit]) => [key, Number.isSafeInteger(options[key]) && options[key] >= (key.endsWith("MaxBytes") ? 0 : 1) ? Math.min(limit, options[key]) : limit]));
  const searches = new Map(), books = new Map();
  let searchBytes = 0, bookBytes = 0, activeSearches = 0, activeDownloads = 0;
  const attempts = [];
  let session;
  let sessionLoaded = false;
  const blocks = { version: 1, source: null, downloads: null };
  let blockLoading, blockSaving = Promise.resolve();
  const evict = (cache, key) => { const entry = cache.get(key); if (!entry) return; if (cache === searches) searchBytes -= entry.bytes.byteLength; else bookBytes -= entry.bytes.byteLength; cache.delete(key); };

  async function loadBlock() {
    blockLoading ||= Promise.resolve().then(async () => {
      const saved = await options.loadDownloadBlock?.();
      const records = saved?.version === 1 ? [saved.source, saved.downloads] : [saved];
      for (const record of records) {
        if (record && Number.isSafeInteger(record.until) && record.until > 0 && ["source", "downloads"].includes(record.scope) && [403, 429, 503].includes(record.status) && ["SOURCE_BUSY", "SOURCE_DAILY_LIMIT", "SOURCE_LOGIN_REQUIRED"].includes(record.code) && typeof record.message === "string" && record.message.length <= 500) blocks[record.scope] = record;
      }
    });
    await blockLoading;
    return blocks;
  }
  async function checkBlock(download, signal) {
    const saved = await abortable(loadBlock(), signal);
    const current = [saved.source, download && saved.downloads].filter((value) => value?.until > now()).sort((left, right) => right.until - left.until)[0];
    if (current) {
      const error = new AtramentaError(current.status, current.code, current.message, Math.ceil((current.until - now()) / 1000));
      error.persistedBlock = true;
      throw error;
    }
  }
  async function saveBlock(error, scope) {
    await loadBlock();
    const until = now() + (error.retryAfter || 86_400) * 1000;
    if (blocks[scope]?.until >= until) return;
    const next = { until, scope, status: error.status, code: error.code, message: error.message };
    // Set the in-memory refusal before awaiting durable storage: another request
    // must not slip through while the provider's cooldown is being persisted.
    blocks[scope] = next;
    const snapshot = { ...blocks };
    blockSaving = blockSaving.then(() => options.saveDownloadBlock?.(snapshot));
    await blockSaving;
  }

  async function loadSession() {
    if (!sessionLoaded) { session = cleanSession(await options.loadSession?.()); sessionLoaded = true; }
    return session;
  }
  async function retainSession(headers) {
    const previous = await loadSession();
    const next = { ...previous };
    const cookies = headers.getSetCookie?.() || [headers.get("set-cookie") || ""];
    for (const value of cookies) {
      for (const name of COOKIE_NAMES) {
        const cookie = new RegExp(`(?:^|,\\s*)${name}=([A-Za-z0-9,._~-]{1,256})(?:;|$)`, "u").exec(value)?.[1];
        if (cookie) next[name] = cookie;
      }
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) { await options.saveSession?.(next); session = next; }
  }
  async function upstream(path, signal, { body, useSession = false, epub = false } = {}) {
    signal.throwIfAborted();
    await checkBlock(useSession, signal);
    const headers = { Accept: epub ? EPUB : body ? "application/json" : "text/html", "User-Agent": "FastReader/1.0 (+https://github.com/drslid/EPUB-FastReader; user-requested reading)" };
    if (body) { headers["Content-Type"] = "application/x-www-form-urlencoded"; headers["X-Requested-With"] = "XMLHttpRequest"; }
    if (useSession) {
      const saved = await loadSession();
      const cookie = COOKIE_NAMES.filter((name) => saved[name]).map((name) => `${name}=${saved[name]}`).join("; ");
      if (cookie) headers.Cookie = cookie;
    }
    const url = `${ORIGIN}${path}`;
    let response;
    signal.throwIfAborted();
    try { response = await abortable(fetchImpl(url, { method: body ? "POST" : "GET", body, headers, credentials: "omit", redirect: "manual", signal }), signal); }
    catch { signal.throwIfAborted(); throw failure(); }
    if (response.redirected || response.url && response.url !== url || response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new AtramentaError(502, "UNSAFE_REDIRECT", "Cette édition utilise une adresse de téléchargement non prise en charge.");
    }
    if ([401, 403, 429, 503].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const error = new AtramentaError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", retrySeconds(response.headers.get("retry-after"), now()));
      await saveBlock(error, useSession && [429, 503].includes(response.status) ? "downloads" : "source");
      throw error;
    }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw failure(); }
    if (useSession) await retainSession(response.headers);
    return response;
  }
  async function timed(action, signal, timeoutMs = limits.timeoutMs) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new AtramentaError(504, "SOURCE_TIMEOUT", "Atramenta met trop de temps à répondre. Réessayez plus tard.")), timeoutMs);
    timer.unref?.();
    try { return await abortable(action(controller.signal), controller.signal); }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }
  async function search(query, signal) {
    const cached = searches.get(query);
    if (cached?.expires > now()) return cached.bytes;
    evict(searches, query);
    if (activeSearches >= 2) throw new AtramentaError(429, "SOURCE_BUSY", "Deux recherches sont déjà en cours sur cette source. Réessayez dans un instant.", 5);
    activeSearches++;
    try {
      return await timed(async (searchSignal) => {
        const response = await upstream(`/search/?${new URLSearchParams({ atmt_search: query, search_encoding: "UTF-8" })}`, searchSignal);
        const html = decode(await readLimited(response, limits.maxCatalogBytes, searchSignal), response.headers);
        if (!/\bid=["']main_content_wrapper["']/u.test(html) || !/\baction=["']\/search\/["']/u.test(html)) throw failure();
        const bytes = new TextEncoder().encode(html);
        if (bytes.byteLength > limits.maxCatalogBytes) throw new AtramentaError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
        evict(searches, query);
        if (bytes.byteLength <= limits.searchCacheMaxBytes) {
          while (searches.size && (searches.size >= limits.maxCachedSearches || searchBytes + bytes.byteLength > limits.searchCacheMaxBytes)) evict(searches, searches.keys().next().value);
          searches.set(query, { bytes, expires: now() + 300_000 }); searchBytes += bytes.byteLength;
        }
        return bytes;
      }, signal, Math.min(limits.timeoutMs, 35_000));
    } finally { activeSearches--; }
  }
  async function reserve(signal) {
    signal.throwIfAborted();
    while (attempts.length && attempts[0] <= now() - DAY) attempts.shift();
    if (attempts.length >= limits.maxDailyDownloads) throw quotaError(Math.ceil((attempts[0] + DAY - now()) / 1000));
    if (options.reserveDownload) await abortable(options.reserveDownload({ signal, now: now(), limits }), signal);
    attempts.push(now());
  }
  async function json(response, signal) {
    try { return JSON.parse(decode(await readLimited(response, 32 * 1024, signal), response.headers)); }
    catch (error) { signal.throwIfAborted(); if (error instanceof AtramentaError) throw error; throw failure(); }
  }
  async function book(id, signal) {
    const cached = books.get(id);
    if (cached?.expires > now()) return cached.bytes;
    evict(books, id);
    if (activeDownloads >= 1) throw new AtramentaError(429, "SOURCE_BUSY", "Un livre est déjà en cours de téléchargement. Réessayez dans un instant.", 10);
    activeDownloads++;
    try {
      return await timed(async (bookSignal) => {
        await checkBlock(true, bookSignal);
        await reserve(bookSignal);
        const [, number, slug] = ID.exec(id);
        const path = `/lire/${slug}/${number}`;
        const detail = await upstream(path, bookSignal, { useSession: true });
        const html = decode(await readLimited(detail, limits.maxCatalogBytes, bookSignal), detail.headers);
        if (!(html.match(/<button\b[^>]*>/giu) || []).some((tag) => attribute(tag, "id") === "epubDownload" && attribute(tag, "data-dl-format") === "epub")) throw new AtramentaError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
        const sig = actionToken(html);
        if (!(await loadSession()).PHPSESSID) throw failure();
        const allowance = await json(await upstream(path, bookSignal, { body: "get_dl_allowance=1", useSession: true }), bookSignal);
        if (allowance.must_log_in) throw new AtramentaError(403, "SOURCE_LOGIN_REQUIRED", "Atramenta demande une connexion sur son site pour ce téléchargement.");
        if (!Number.isSafeInteger(allowance.dl_allowance) || allowance.dl_allowance < 0) throw failure();
        if (allowance.dl_allowance === 0) throw quotaError();
        const offer = await json(await upstream(path, bookSignal, { body: new URLSearchParams({ get_dl_url: "1", dl_format: "epub", sig }).toString(), useSession: true }), bookSignal);
        if (offer.must_log_in) throw new AtramentaError(403, "SOURCE_LOGIN_REQUIRED", "Atramenta demande une connexion sur son site pour ce téléchargement.");
        let target;
        try { target = new URL(offer.dl_url, ORIGIN); } catch { throw failure(); }
        if (typeof offer.dl_url !== "string" || target.origin !== ORIGIN || target.username || target.password || target.search || target.hash || !new RegExp(`^/download_libre/[a-f0-9]{10,64}/${slug}/${number}\\.epub$`, "u").test(target.pathname)) throw new AtramentaError(502, "UNSAFE_DOWNLOAD", "Cette édition utilise une adresse de téléchargement non prise en charge.");
        const response = await upstream(target.pathname, bookSignal, { useSession: true, epub: true });
        const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        if (![EPUB, "application/octet-stream", "application/zip", "application/force-download"].includes(type)) { void response.body?.cancel().catch(() => {}); throw invalidEpub(); }
        const bytes = await readLimited(response, limits.maxBookBytes, bookSignal);
        await validateEpub(bytes);
        if (bytes.byteLength <= limits.cacheMaxBytes) {
          while (books.size && bookBytes + bytes.byteLength > limits.cacheMaxBytes) evict(books, books.keys().next().value);
          books.set(id, { bytes, expires: now() + 3_600_000 }); bookBytes += bytes.byteLength;
        }
        return bytes;
      }, signal);
    } catch (error) {
      if (!error?.persistedBlock && ["SOURCE_DAILY_LIMIT", "SOURCE_LOGIN_REQUIRED"].includes(error?.code)) await saveBlock(error, "downloads");
      throw error;
    } finally { activeDownloads--; }
  }
  return async function atramentaHandler(request) {
    const url = new URL(request.url);
    if (url.pathname !== SEARCH_PATH && !url.pathname.startsWith(BOOK_PATH)) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (allowOrigin) headers.set("Vary", "Origin");
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== allowOrigin && origin !== url.origin) throw new AtramentaError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (origin === allowOrigin && origin) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Access-Control-Expose-Headers", "Content-Disposition, Retry-After"); }
      const isSearch = url.pathname === SEARCH_PATH;
      const id = url.pathname.slice(BOOK_PATH.length).replace(/\.epub$/u, "");
      if (!isSearch && (!url.pathname.endsWith(".epub") || !ID.test(id) || id.length > 190 || url.search)) throw new AtramentaError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      const query = url.searchParams.get("query")?.trim() || "";
      if (isSearch && (!query || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || ![null, "1"].includes(url.searchParams.get("page")) || [...url.searchParams.keys()].some((key) => !["query", "page"].includes(key)) || url.searchParams.getAll("query").length > 1 || url.searchParams.getAll("page").length > 1)) throw new AtramentaError(400, "INVALID_QUERY", "Cette recherche n’est pas valide.");
      if (request.method === "OPTIONS" && origin === allowOrigin && origin) {
        const requested = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
        if (request.headers.get("access-control-request-method") !== "GET" || requested.some((value) => value !== "accept")) throw new AtramentaError(403, "PREFLIGHT_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées.");
        headers.set("Access-Control-Allow-Methods", "GET"); headers.set("Access-Control-Allow-Headers", "Accept"); headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") { headers.set("Allow", "GET, OPTIONS"); throw new AtramentaError(405, "METHOD_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées."); }
      const bytes = isSearch ? await search(query, request.signal) : await book(id, request.signal);
      headers.set("Content-Type", isSearch ? "text/html; charset=utf-8" : EPUB);
      headers.set("Content-Length", String(bytes.byteLength));
      if (!isSearch) headers.set("Content-Disposition", `inline; filename="atramenta-${id}.epub"`);
      return new Response(bytes, { headers });
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      const problem = error instanceof AtramentaError ? error : failure();
      headers.set("Content-Type", "application/json; charset=utf-8");
      if (problem.retryAfter) headers.set("Retry-After", String(problem.retryAfter));
      return new Response(JSON.stringify({ error: { code: problem.code, message: problem.message } }), { status: problem.status, headers });
    }
  };
}

export function createAtramentaMiddleware(options = {}) {
  const handler = createAtramentaHandler(options);
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
      if (!res.destroyed && !res.writableEnded) { res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: { code: "SOURCE_UNAVAILABLE", message: failure().message } })); }
    } finally { res.removeListener("close", abort); }
  };
}
