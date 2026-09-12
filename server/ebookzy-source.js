import JSZip from "jszip";

const ORIGIN = "https://ebookzy.com";
const SEARCH_PATH = "/api/sources/ebookzy/search";
const BOOK_PATH = "/api/books/ebookzy/";
const COVER_PATH = "/api/sources/ebookzy/cover/";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EPUB = "application/epub+zip";
export const EBOOKZY_LIMITS = Object.freeze({ timeoutMs: 35_000, maxCatalogBytes: 2 * 1024 * 1024, maxBookBytes: 30 * 1024 * 1024, cacheMaxBytes: 512 * 1024, maxCachedSearches: 2, maxCoverBytes: 1024 * 1024, coverTimeoutMs: 4000 });
export class EbookzyError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const unavailable = () => new EbookzyError(502, "SOURCE_UNAVAILABLE", "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.");
const invalid = () => new EbookzyError(502, "INVALID_EPUB", "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.");
function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function readLimited(response, limit, signal) {
  const announced = response.headers.get("content-length");
  const oversized = () => new EbookzyError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
  if (!response.body || (announced && (!/^\d+$/u.test(announced) || Number(announced) > limit))) { void response.body?.cancel().catch(() => {}); throw oversized(); }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw oversized();
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Only advertised links in the source's public download directory are accepted. */
export function ebookzyDownloadPath(html) {
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu)];
  const candidates = [];
  for (const [anchor] of anchors) {
    const tag = /^<a\b[^>]*>/iu.exec(anchor)?.[0] || "";
    const href = /\shref\s*=\s*(["'])(.*?)\1/iu.exec(tag)?.[2];
    const label = anchor.replace(/<[^>]+>/gu, "").trim();
    if (!["EPUB", "EPUB3"].includes(label.toUpperCase()) || !href) continue;
    let url;
    try { url = new URL(href, ORIGIN); } catch { continue; }
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || !/^\/free-ebooks\/[a-z0-9][a-z0-9_.-]*\.epub$/iu.test(url.pathname)) continue;
    candidates.push({ path: url.pathname, priority: label.toUpperCase() === "EPUB" ? 0 : 1 });
  }
  candidates.sort((a, b) => a.priority - b.priority);
  if (!candidates.length) throw new EbookzyError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
  return candidates[0].path;
}

export function ebookzyCoverPath(html) {
  const image = /<img\b(?=[^>]*\sclass=["'][^"']*\bwp-post-image\b[^"']*["'])[^>]*>/iu.exec(html)?.[0] || "";
  const src = /\ssrc\s*=\s*(["'])(.*?)\1/iu.exec(image)?.[2];
  let url;
  try { url = new URL(src || "", ORIGIN); } catch { throw unavailable(); }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || !/^\/wp-content\/uploads\/\d{4}\/\d{2}\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/iu.test(url.pathname)) throw new EbookzyError(502, "INVALID_COVER", "La couverture n’est pas disponible.");
  return url.pathname;
}
export function ebookzyImageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if ([82, 73, 70, 70].every((value, index) => bytes[index] === value) && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value)) return "image/webp";
  throw new EbookzyError(502, "INVALID_COVER", "La couverture n’est pas disponible.");
}

/** Public GET requests only; no cookies, accounts, challenge solving or retries. */
export function createEbookzyHandler(options = {}) {
  const { fetchImpl = globalThis.fetch, allowOrigin = "", now = Date.now } = options;
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine du relais invalide.");
  }
  const limits = Object.fromEntries(Object.entries(EBOOKZY_LIMITS).map(([key, maximum]) => [key,
    Number.isSafeInteger(options[key]) && options[key] >= (key === "cacheMaxBytes" ? 0 : 1) ? Math.min(options[key], maximum) : maximum,
  ]));
  const cache = new Map();
  let cacheBytes = 0;
  let activeSearches = 0;
  let activeDownloads = 0;
  let activeCovers = 0;
  let cooldownUntil = 0;
  function evict(key) {
    const entry = cache.get(key);
    if (entry) { cacheBytes -= entry.bytes.byteLength; cache.delete(key); }
  }
  async function upstream(path, signal, download = false) {
    signal.throwIfAborted();
    if (now() < cooldownUntil) throw new EbookzyError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.");
    const url = `${ORIGIN}${path}`;
    let response;
    try { response = await abortable(fetchImpl(url, { method: "GET", redirect: "manual", credentials: "omit", signal, headers: { Accept: download ? EPUB : "text/html" } }), signal); }
    catch { signal.throwIfAborted(); throw unavailable(); }
    if (response.redirected || response.url && response.url !== url || response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new EbookzyError(502, "UNSAFE_REDIRECT", "Cette édition utilise une adresse de téléchargement non prise en charge.");
    }
    if ([401, 403, 429].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const seconds = Number(response.headers.get("retry-after"));
      cooldownUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.max(60_000, Math.min(seconds * 1000, 86_400_000)) : 300_000);
      throw new EbookzyError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.");
    }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
    return response;
  }
  async function search(query, page, signal) {
    const key = `${page}:${query}`;
    const entry = cache.get(key);
    if (entry && entry.expires > now()) return entry.bytes;
    evict(key);
    const path = `${page === 1 ? "/" : `/page/${page}/`}?${new URLSearchParams({ s: query })}`;
    const response = await upstream(path, signal);
    const bytes = await readLimited(response, limits.maxCatalogBytes, signal);
    const html = new TextDecoder().decode(bytes);
    if (!/Search results for:/iu.test(html) || !/\bid=["']content["']/iu.test(html) || !/\bname=["']s["']/iu.test(html)) throw unavailable();
    if (bytes.byteLength <= limits.cacheMaxBytes) {
      while (cache.size && (cache.size >= limits.maxCachedSearches || cacheBytes + bytes.byteLength > limits.cacheMaxBytes)) evict(cache.keys().next().value);
      cache.set(key, { bytes, expires: now() + 300_000 }); cacheBytes += bytes.byteLength;
    }
    return bytes;
  }
  async function book(slug, signal) {
    const detail = await upstream(`/${slug}/`, signal);
    const path = ebookzyDownloadPath(new TextDecoder().decode(await readLimited(detail, limits.maxCatalogBytes, signal)));
    const response = await upstream(path, signal, true);
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (![EPUB, "application/zip", "application/octet-stream"].includes(type)) { void response.body?.cancel().catch(() => {}); throw invalid(); }
    const bytes = await readLimited(response, limits.maxBookBytes, signal);
    if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw invalid();
    try {
      const zip = await JSZip.loadAsync(bytes);
      const mime = zip.file("mimetype"), container = zip.file("META-INF/container.xml");
      if (!mime || !container || mime._data.uncompressedSize > 50 || mime._data.compressedSize > 256 || container._data.uncompressedSize > 1_048_576 || await mime.async("string") !== EPUB) throw invalid();
    } catch { throw invalid(); }
    return bytes;
  }
  async function cover(slug, signal) {
    const detail = await upstream(`/${slug}/`, signal);
    const path = ebookzyCoverPath(new TextDecoder().decode(await readLimited(detail, limits.maxCatalogBytes, signal)));
    const response = await upstream(path, signal);
    const bytes = await readLimited(response, limits.maxCoverBytes, signal);
    ebookzyImageType(bytes);
    return bytes;
  }
  return async function ebookzyHandler(request) {
    const url = new URL(request.url);
    if (url.pathname !== SEARCH_PATH && !url.pathname.startsWith(BOOK_PATH) && !url.pathname.startsWith(COVER_PATH)) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (allowOrigin) headers.set("Vary", "Origin");
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    let timer, searchSlot = false, downloadSlot = false, coverSlot = false;
    try {
      request.signal.throwIfAborted();
      const origin = request.headers.get("origin");
      if (origin && origin !== allowOrigin && origin !== url.origin) throw new EbookzyError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (origin && origin === allowOrigin) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Access-Control-Expose-Headers", "Content-Disposition, Retry-After"); }
      const isSearch = url.pathname === SEARCH_PATH;
      const isCover = url.pathname.startsWith(COVER_PATH);
      const suffix = isCover ? ".png" : ".epub";
      const slug = url.pathname.slice((isCover ? COVER_PATH : BOOK_PATH).length, -suffix.length);
      if (!isSearch && (!url.pathname.endsWith(suffix) || !SLUG.test(slug) || slug.length > 180 || url.search)) throw new EbookzyError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      const query = url.searchParams.get("query")?.trim() || "";
      const page = url.searchParams.get("page") || "1";
      if (isSearch && (!query || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || !/^[1-9]\d{0,2}$/u.test(page) || Number(page) > 100 || [...url.searchParams.keys()].some((key) => !["query", "page"].includes(key)) || url.searchParams.getAll("query").length > 1 || url.searchParams.getAll("page").length > 1)) throw new EbookzyError(400, "INVALID_QUERY", "Cette recherche n’est pas valide.");
      if (request.method === "OPTIONS" && origin === allowOrigin && allowOrigin) {
        const requested = (request.headers.get("access-control-request-headers") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
        if (request.headers.get("access-control-request-method") !== "GET" || requested.some((value) => value !== "accept")) throw new EbookzyError(403, "PREFLIGHT_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées.");
        headers.set("Access-Control-Allow-Methods", "GET"); headers.set("Access-Control-Allow-Headers", "Accept"); headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") { headers.set("Allow", "GET, OPTIONS"); throw new EbookzyError(405, "METHOD_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées."); }
      if (isSearch ? activeSearches >= 2 : isCover ? activeCovers >= 1 : activeDownloads >= 1) throw new EbookzyError(429, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.");
      if (isSearch) { activeSearches++; searchSlot = true; } else if (isCover) { activeCovers++; coverSlot = true; } else { activeDownloads++; downloadSlot = true; }
      timer = setTimeout(() => controller.abort(new EbookzyError(504, "SOURCE_TIMEOUT", "La source met trop de temps à répondre. Réessayez ou ouvrez sa fiche.")), isCover ? limits.coverTimeoutMs : limits.timeoutMs);
      timer.unref?.();
      const bytes = await abortable(isSearch ? search(query, Number(page), controller.signal) : isCover ? cover(slug, controller.signal) : book(slug, controller.signal), controller.signal);
      headers.set("Content-Type", isSearch ? "text/html; charset=utf-8" : isCover ? ebookzyImageType(bytes) : EPUB);
      headers.set("Content-Length", String(bytes.byteLength));
      if (!isSearch && !isCover) headers.set("Content-Disposition", `inline; filename="ebookzy-${slug}.epub"`);
      return new Response(bytes, { headers });
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      const failure = error instanceof EbookzyError ? error : unavailable();
      headers.set("Content-Type", "application/json; charset=utf-8");
      if (failure.code === "SOURCE_BUSY") headers.set("Retry-After", String(Math.max(5, Math.ceil((cooldownUntil - now()) / 1000))));
      return new Response(JSON.stringify({ error: { code: failure.code, message: failure.message } }), { status: failure.status, headers });
    } finally {
      clearTimeout(timer); request.signal.removeEventListener("abort", abort);
      if (searchSlot) activeSearches--;
      if (downloadSlot) activeDownloads--;
      if (coverSlot) activeCovers--;
    }
  };
}
export function createEbookzyMiddleware(options = {}) {
  const handler = createEbookzyHandler(options);
  return async (req, res, next = () => {}) => {
    if (!String(req.url).startsWith(SEARCH_PATH) && !String(req.url).startsWith(BOOK_PATH) && !String(req.url).startsWith(COVER_PATH)) return next();
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
      if (!res.destroyed && !res.writableEnded) { res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end('{"error":{"code":"SOURCE_UNAVAILABLE"}}'); }
    } finally { res.removeListener("close", abort); }
  };
}
