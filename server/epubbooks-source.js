import JSZip from "jszip";

const ORIGIN = "https://www.epubbooks.com";
const SEARCH_PATH = "/api/sources/epubbooks/search";
const BOOK_PATH = "/api/books/epubbooks/";
const COVER_PATH = "/api/sources/epubbooks/cover/";
const EPUB = "application/epub+zip";
const ID = /^[1-9]\d{0,8}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const EPUBBOOKS_LIMITS = Object.freeze({ timeoutMs: 35_000, maxCatalogBytes: 2 * 1024 * 1024, maxBookBytes: 30 * 1024 * 1024, maxCoverBytes: 1024 * 1024, coverTimeoutMs: 4000, maxCachedSearches: 4, cacheMaxBytes: 4 * 1024 * 1024 });

export class EpubbooksError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const unavailable = () => new EpubbooksError(502, "SOURCE_UNAVAILABLE", "epubBooks est temporairement indisponible. Réessayez plus tard.");
const invalid = () => new EpubbooksError(502, "INVALID_EPUB", "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.");

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function limitedBytes(response, limit, signal) {
  const announced = response.headers.get("content-length");
  if (!response.body || (announced && (!/^\d+$/u.test(announced) || Number(announced) > limit))) {
    void response.body?.cancel().catch(() => {});
    throw new EpubbooksError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new EpubbooksError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function epubbooksDownloadId(html) {
  const offers = html.match(/<li\b[^>]*\bitemprop=["']offers["'][^>]*>[\s\S]*?<\/li>/giu) || [];
  for (const offer of offers) {
    if (!/<h4\b[^>]*>\s*EPUB(?:\s|<)/iu.test(offer)) continue;
    const id = /<button\b[^>]*\bdata-dlid=["']([1-9]\d{0,8})["']/iu.exec(offer)?.[1];
    if (id) return id;
  }
  throw new EpubbooksError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
}

export function anonymousDownloadCookie(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = /(?:^|,\s*)download=([A-Za-z0-9._~+/=-]{1,1024})(?:;|$)/u.exec(value);
    if (match) return `download=${match[1]}`;
  }
  throw unavailable();
}

export function epubbooksImageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  throw new EpubbooksError(502, "INVALID_COVER", "La couverture n’est pas disponible.");
}

function coverPath(html) {
  const image = /<img\b[^>]*\bitemprop=["']image["'][^>]*>/iu.exec(html)?.[0] || "";
  const src = /\bsrc=(["'])(.*?)\1/iu.exec(image)?.[2];
  let url;
  try { url = new URL(src || "", ORIGIN); } catch { throw unavailable(); }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || !/^\/images\/covers\/[A-Za-z0-9_-]+\.(?:jpe?g|png)$/iu.test(url.pathname)) throw new EpubbooksError(502, "INVALID_COVER", "La couverture n’est pas disponible.");
  return url.pathname;
}

/** Public-site workflow only: no account, user cookies, challenges or alternate mirrors. */
export function createEpubbooksHandler({ fetchImpl = globalThis.fetch, allowOrigin = "", timeoutMs = EPUBBOOKS_LIMITS.timeoutMs, now = Date.now, cacheMaxBytes = EPUBBOOKS_LIMITS.cacheMaxBytes, maxCachedSearches = EPUBBOOKS_LIMITS.maxCachedSearches } = {}) {
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine du relais invalide.");
  }
  let activeSearches = 0;
  let activeDownloads = 0;
  let activeCovers = 0;
  let cooldownUntil = 0;
  const searchCache = new Map();
  const cacheLimit = Number.isSafeInteger(cacheMaxBytes) && cacheMaxBytes >= 0 ? Math.min(cacheMaxBytes, EPUBBOOKS_LIMITS.cacheMaxBytes) : EPUBBOOKS_LIMITS.cacheMaxBytes;
  const entryLimit = Number.isSafeInteger(maxCachedSearches) && maxCachedSearches >= 0 ? Math.min(maxCachedSearches, EPUBBOOKS_LIMITS.maxCachedSearches) : EPUBBOOKS_LIMITS.maxCachedSearches;
  let cachedBytes = 0;
  const evictSearch = (key) => {
    const entry = searchCache.get(key);
    if (entry) { cachedBytes -= entry.bytes.byteLength; searchCache.delete(key); }
  };

  async function upstream(path, signal, options = {}) {
    signal.throwIfAborted();
    if (cooldownUntil > now()) throw new EpubbooksError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.");
    const url = `${ORIGIN}${path}`;
    let response;
    try {
      response = await abortable(fetchImpl(url, { method: "GET", redirect: "manual", credentials: "omit", ...options, signal }), signal);
    } catch (error) { signal.throwIfAborted(); throw unavailable(); }
    if (response.redirected || (response.url && response.url !== url) || [301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      throw new EpubbooksError(502, "UNSAFE_REDIRECT", "La source a redirigé vers une adresse non autorisée.");
    }
    if ([401, 403, 429].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      cooldownUntil = now() + 300_000;
      throw new EpubbooksError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.");
    }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
    return response;
  }

  async function search(query, signal) {
    const cached = searchCache.get(query);
    if (cached?.expires > now()) return cached.bytes;
    evictSearch(query);
    const response = await upstream(`/search?${new URLSearchParams({ q: query })}`, signal, { headers: { Accept: "text/html" } });
    const bytes = await limitedBytes(response, EPUBBOOKS_LIMITS.maxCatalogBytes, signal);
    const html = new TextDecoder().decode(bytes);
    if (!/Top Search Results for/iu.test(html) || !/<form\b[^>]*role=["']search["']/iu.test(html)) throw unavailable();
    // Concurrent requests for the same term must not double-count a replaced entry.
    evictSearch(query);
    if (entryLimit > 0 && bytes.byteLength <= cacheLimit) {
      while (searchCache.size >= entryLimit || cachedBytes + bytes.byteLength > cacheLimit) evictSearch(searchCache.keys().next().value);
      searchCache.set(query, { bytes, expires: now() + 300_000 });
      cachedBytes += bytes.byteLength;
    }
    return bytes;
  }

  async function download(id, signal) {
    const detail = await upstream(`/book/${id}`, signal, { headers: { Accept: "text/html" } });
    const html = new TextDecoder().decode(await limitedBytes(detail, EPUBBOOKS_LIMITS.maxCatalogBytes, signal));
    const downloadId = epubbooksDownloadId(html);
    const tokenResponse = await upstream("/downloads", signal, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Accept: "text/plain, application/json" },
      body: JSON.stringify({ id: Number(downloadId) }),
    });
    // This cookie is created by the source for one anonymous download. It never
    // comes from a FastReader user and never leaves this request's local scope.
    let cookie;
    try { cookie = anonymousDownloadCookie(tokenResponse.headers); }
    catch (error) { void tokenResponse.body?.cancel().catch(() => {}); throw error; }
    let token;
    try { token = JSON.parse(new TextDecoder().decode(await limitedBytes(tokenResponse, 4096, signal))).id; }
    catch (error) { if (error instanceof EpubbooksError || signal.aborted) throw error; throw unavailable(); }
    if (typeof token !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(token)) throw unavailable();
    const response = await upstream(`/downloads/${token}/file`, signal, { headers: { Cookie: cookie, Accept: EPUB } });
    const bytes = await limitedBytes(response, EPUBBOOKS_LIMITS.maxBookBytes, signal);
    if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw invalid();
    try {
      const zip = await JSZip.loadAsync(bytes);
      const mime = zip.file("mimetype");
      const container = zip.file("META-INF/container.xml");
      if (!mime || !container || mime._data.uncompressedSize > 50 || container._data.uncompressedSize > 1_048_576 || await mime.async("string") !== EPUB) throw invalid();
    } catch { throw invalid(); }
    return bytes;
  }

  async function cover(id, signal) {
    const detail = await upstream(`/book/${id}`, signal, { headers: { Accept: "text/html" } });
    const html = new TextDecoder().decode(await limitedBytes(detail, EPUBBOOKS_LIMITS.maxCatalogBytes, signal));
    const response = await upstream(coverPath(html), signal, { headers: { Accept: "image/jpeg, image/png" } });
    const bytes = await limitedBytes(response, EPUBBOOKS_LIMITS.maxCoverBytes, signal);
    epubbooksImageType(bytes);
    return bytes;
  }

  return async function epubbooksHandler(request) {
    const url = new URL(request.url);
    if (url.pathname !== SEARCH_PATH && !url.pathname.startsWith(BOOK_PATH) && !url.pathname.startsWith(COVER_PATH)) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (allowOrigin) headers.set("Vary", "Origin");
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    let timer;
    let searchSlot = false;
    let downloadSlot = false;
    let coverSlot = false;
    try {
      request.signal.throwIfAborted();
      const origin = request.headers.get("origin");
      if (origin && origin !== allowOrigin && origin !== url.origin) throw new EpubbooksError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (origin && origin === allowOrigin) { headers.set("Access-Control-Allow-Origin", allowOrigin); headers.set("Access-Control-Expose-Headers", "Content-Disposition"); }
      const isSearch = url.pathname === SEARCH_PATH;
      const isCover = url.pathname.startsWith(COVER_PATH);
      const suffix = isCover ? ".jpg" : ".epub";
      const id = url.pathname.slice((isCover ? COVER_PATH : BOOK_PATH).length, -suffix.length);
      if (!isSearch && (!url.pathname.endsWith(suffix) || id.length > 200 || !ID.test(id) || url.search)) throw new EpubbooksError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      const query = url.searchParams.get("query")?.trim() || "";
      const page = url.searchParams.get("page") || "1";
      if (isSearch && (!query || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || page !== "1" || [...url.searchParams.keys()].some((key) => !["query", "page"].includes(key)) || url.searchParams.getAll("query").length > 1 || url.searchParams.getAll("page").length > 1)) throw new EpubbooksError(400, "INVALID_QUERY", "Cette recherche n’est pas valide.");
      if (request.method === "OPTIONS" && origin === allowOrigin && allowOrigin) {
        const requested = (request.headers.get("access-control-request-headers") || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
        if (request.headers.get("access-control-request-method") !== "GET" || requested.some((item) => item !== "accept")) throw new EpubbooksError(403, "PREFLIGHT_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées.");
        headers.set("Access-Control-Allow-Methods", "GET"); headers.set("Access-Control-Allow-Headers", "Accept"); headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") { headers.set("Allow", "GET, OPTIONS"); throw new EpubbooksError(405, "METHOD_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées."); }
      if ((isSearch && activeSearches >= 2) || (isCover && activeCovers >= 2) || (!isSearch && !isCover && activeDownloads >= 1)) throw new EpubbooksError(429, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.");
      if (isSearch) { activeSearches++; searchSlot = true; }
      else if (isCover) { activeCovers++; coverSlot = true; }
      else { activeDownloads++; downloadSlot = true; }
      timer = setTimeout(() => controller.abort(new EpubbooksError(504, "SOURCE_TIMEOUT", "epubBooks met trop de temps à répondre. Réessayez plus tard.")), Math.min(timeoutMs, isCover ? EPUBBOOKS_LIMITS.coverTimeoutMs : EPUBBOOKS_LIMITS.timeoutMs));
      timer.unref?.();
      const bytes = await abortable(isSearch ? search(query, controller.signal) : isCover ? cover(id, controller.signal) : download(id, controller.signal), controller.signal);
      headers.set("Content-Type", isSearch ? "text/html; charset=utf-8" : isCover ? epubbooksImageType(bytes) : EPUB);
      headers.set("Content-Length", String(bytes.byteLength));
      if (!isSearch && !isCover) headers.set("Content-Disposition", `inline; filename="epubbooks-${id}.epub"`);
      return new Response(bytes, { headers });
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      const failure = error instanceof EpubbooksError ? error : unavailable();
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ error: { code: failure.code, message: failure.message } }), { status: failure.status, headers });
    } finally {
      clearTimeout(timer); request.signal.removeEventListener("abort", abort);
      if (searchSlot) activeSearches--;
      if (downloadSlot) activeDownloads--;
      if (coverSlot) activeCovers--;
    }
  };
}

export function createEpubbooksMiddleware(options = {}) {
  const handler = createEpubbooksHandler(options);
  return async (req, res, next = () => {}) => {
    if (!String(req.url).startsWith(BOOK_PATH) && !String(req.url).startsWith(SEARCH_PATH) && !String(req.url).startsWith(COVER_PATH)) return next();
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
      if (!res.destroyed && !res.writableEnded) { res.writeHead(502, { "Content-Type": "application/json" }); res.end('{"error":{"code":"SOURCE_UNAVAILABLE"}}'); }
    } finally { res.removeListener("close", abort); }
  };
}
