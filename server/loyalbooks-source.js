import JSZip from "jszip";

const ORIGIN = "https://www.loyalbooks.com";
const BOOK_PATH = "/api/books/loyalbooks/";
const COVER_PATH = "/api/sources/loyalbooks/cover/";
const EPUB = "application/epub+zip";
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.,'()!~-]{0,199}$/u;
export const LOYALBOOKS_LIMITS = Object.freeze({ timeoutMs: 35_000, coverTimeoutMs: 4000, maxCatalogBytes: 1024 * 1024, maxBookBytes: 30 * 1024 * 1024, maxCoverBytes: 1024 * 1024 });
class SourceError extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}
const unavailable = () => new SourceError(502, "SOURCE_UNAVAILABLE", "Loyal Books est temporairement indisponible. Réessayez plus tard.");
const invalidEpub = () => new SourceError(502, "INVALID_EPUB", "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.");

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function limitedBytes(response, maxBytes, signal) {
  const length = response.headers.get("content-length");
  const tooLarge = () => new SourceError(413, "RESPONSE_TOO_LARGE", "La réponse de la source dépasse la taille autorisée.");
  if (!response.body || length && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) { void response.body?.cancel().catch(() => {}); throw tooLarge(); }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return bytes;
}
function attribute(tag, name) {
  const value = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "isu").exec(tag)?.[2];
  return value?.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}
function officialAsset(value, prefix, extension) {
  if (!value) return null;
  try {
    const url = new URL(value, ORIGIN);
    const filename = decodeURIComponent(url.pathname.slice(prefix.length));
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix) || !SLUG.test(filename) || !extension.test(filename)) return null;
    return url.href;
  } catch { return null; }
}
export function parseLoyalbooksDetail(html) {
  let epub = null;
  let cover = null;
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu)) {
    if (!/\bepub\b/iu.test(match[1])) continue;
    epub = officialAsset(attribute(match[0], "href"), "/download/epub/", /\.epub$/iu);
    if (epub) break;
  }
  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    cover = officialAsset(attribute(match[0], "src"), "/image/detail/", /\.(?:jpe?g|png)$/iu);
    if (cover) break;
  }
  return { epub, cover };
}
function imageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  return null;
}
async function validateEpub(bytes) {
  if (![80, 75, 3, 4].every((byte, index) => bytes[index] === byte)) throw invalidEpub();
  try {
    const zip = await JSZip.loadAsync(bytes);
    const mime = zip.file("mimetype");
    const container = zip.file("META-INF/container.xml");
    // Both sizes are checked before inflating even this tiny metadata entry.
    // A forged uncompressed-size field must not cause unbounded decompression.
    if (!mime || !container || mime._data.compressedSize > 256 || mime._data.uncompressedSize > 50 || container._data.uncompressedSize > 1_048_576 || await mime.async("string") !== EPUB) throw invalidEpub();
  } catch { throw invalidEpub(); }
}

/** Resolve only the selected edition's public EPUB and cover. No cookies,
 * account, arbitrary URL, search-engine request or EPUB server cache is used. */
export function createLoyalbooksHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const allowOrigin = options.allowOrigin || "";
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine du relais invalide.");
  }
  const limits = Object.fromEntries(Object.entries(LOYALBOOKS_LIMITS).map(([key, max]) => [key, Number.isSafeInteger(options[key]) && options[key] > 0 ? Math.min(options[key], max) : max]));
  let pendingBooks = 0;
  let pendingCovers = 0;
  let cooldownUntil = 0;
  // Only two validated URLs per entry: 16 entries, with filenames bounded by
  // the 200-character allowlist above (including Unicode before URI encoding).
  // The cache never retains HTML, cookies, EPUB archives or image bytes.
  const details = new Map();

  async function upstream(url, signal) {
    signal.throwIfAborted();
    if (now() < cooldownUntil) throw new SourceError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", Math.ceil((cooldownUntil - now()) / 1000));
    let response;
    try { response = await abortable(fetchImpl(url, { redirect: "manual", credentials: "omit", signal, headers: { Accept: "text/html, application/epub+zip, image/jpeg, image/png", "User-Agent": "FastReader/1.0 (+https://github.com/drslid/EPUB-FastReader; user-requested reading)" } }), signal); }
    catch { signal.throwIfAborted(); throw unavailable(); }
    if (response.redirected || response.url && response.url !== url || response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); throw new SourceError(502, "UNSAFE_REDIRECT", "Cette édition utilise une adresse de téléchargement non prise en charge."); }
    if ([401, 403, 429].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      const seconds = Number(response.headers.get("retry-after"));
      cooldownUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.max(60_000, Math.min(86_400_000, seconds * 1000)) : 300_000);
      throw new SourceError(503, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", Math.ceil((cooldownUntil - now()) / 1000));
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if ([404, 410].includes(response.status)) throw new SourceError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
      throw unavailable();
    }
    return response;
  }
  async function getDetail(slug, signal) {
    const cached = details.get(slug);
    if (cached?.expires > now()) return cached.data;
    details.delete(slug);
    const response = await upstream(`${ORIGIN}/book/${encodeURIComponent(slug)}`, signal);
    if (!response.headers.get("content-type")?.includes("text/html")) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
    const data = parseLoyalbooksDetail(new TextDecoder().decode(await limitedBytes(response, limits.maxCatalogBytes, signal)));
    if (!data.epub) throw new SourceError(404, "BOOK_UNAVAILABLE", "Cette édition n’est plus disponible en EPUB.");
    if (details.size >= 16) details.delete(details.keys().next().value);
    details.set(slug, { data, expires: now() + 300_000 });
    return data;
  }
  async function acquire(slug, cover, signal) {
    if (cover ? pendingCovers >= 2 : pendingBooks >= 1) throw new SourceError(429, "SOURCE_BUSY", "La source demande de patienter. Réessayez plus tard.", 5);
    if (cover) pendingCovers++; else pendingBooks++;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new SourceError(504, "SOURCE_TIMEOUT", "Loyal Books met trop de temps à répondre. Réessayez plus tard.")), cover ? limits.coverTimeoutMs : limits.timeoutMs);
    timer.unref?.();
    try {
      return await abortable((async () => {
        const detail = await getDetail(slug, controller.signal);
        const url = cover ? detail.cover : detail.epub;
        if (!url) throw new SourceError(404, "COVER_UNAVAILABLE", "La couverture n’est pas disponible.");
        const response = await upstream(url, controller.signal);
        const bytes = await limitedBytes(response, cover ? limits.maxCoverBytes : limits.maxBookBytes, controller.signal);
        if (cover) {
          const type = imageType(bytes);
          if (!type) throw new SourceError(502, "INVALID_COVER", "La couverture n’est pas disponible.");
          return { bytes, type };
        }
        await validateEpub(bytes);
        controller.signal.throwIfAborted();
        return { bytes, type: EPUB };
      })(), controller.signal);
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); if (cover) pendingCovers--; else pendingBooks--; }
  }

  return async function loyalbooksHandler(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(BOOK_PATH) && !url.pathname.startsWith(COVER_PATH)) return null;
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (allowOrigin) headers.set("Vary", "Origin");
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== allowOrigin && origin !== url.origin) throw new SourceError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (origin === allowOrigin && origin) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Access-Control-Expose-Headers", "Content-Disposition, Retry-After"); }
      const cover = url.pathname.startsWith(COVER_PATH);
      const match = (cover ? /^\/api\/sources\/loyalbooks\/cover\/([^/]+)\.jpg$/u : /^\/api\/books\/loyalbooks\/([^/]+)\.epub$/u).exec(url.pathname);
      let slug;
      try { slug = match && decodeURIComponent(match[1]); } catch { /* rejected below */ }
      if (!slug || !SLUG.test(slug) || url.search) throw new SourceError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      if (request.method === "OPTIONS" && origin === allowOrigin && origin) {
        const requested = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
        if (request.headers.get("access-control-request-method") !== "GET" || requested.some((value) => value !== "accept")) throw new SourceError(403, "PREFLIGHT_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées.");
        headers.set("Access-Control-Allow-Methods", "GET"); headers.set("Access-Control-Allow-Headers", "Accept"); headers.set("Access-Control-Max-Age", "600");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") { headers.set("Allow", "GET, OPTIONS"); throw new SourceError(405, "METHOD_NOT_ALLOWED", "Seules les requêtes publiques de lecture sont acceptées."); }
      const { bytes, type } = await acquire(slug, cover, request.signal);
      headers.set("Content-Type", type); headers.set("Content-Length", String(bytes.byteLength));
      if (!cover) headers.set("Content-Disposition", "inline; filename=\"loyalbooks.epub\"");
      return new Response(bytes, { headers });
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      const failure = error instanceof SourceError ? error : unavailable();
      if (failure.retryAfter) headers.set("Retry-After", String(failure.retryAfter));
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ error: { code: failure.code, message: failure.message } }), { status: failure.status, headers });
    }
  };
}

export function createLoyalbooksMiddleware(options = {}) {
  const handler = createLoyalbooksHandler(options);
  return async (req, res, next = () => {}) => {
    if (!String(req.url).startsWith(BOOK_PATH) && !String(req.url).startsWith(COVER_PATH)) return next();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", abort);
    try {
      const response = await handler(new Request(new URL(req.url, "http://localhost"), { method: req.method, headers: req.headers, signal: controller.signal }));
      if (!response) return next();
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch { if (!res.destroyed && !res.writableEnded) { res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: { code: "SOURCE_UNAVAILABLE", message: unavailable().message } })); } }
    finally { res.removeListener("close", abort); }
  };
}
