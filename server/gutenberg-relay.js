import { Buffer } from "node:buffer";
// Public files only: no account, uploads, cookies, reading history or database.
// These mirrors are explicitly listed at https://www.gutenberg.org/MIRRORS.ALL.
// Keep source credits and the original EPUB licence when displaying these files.
const PREFIX = "/api/books/gutenberg";
const EPUB_TYPE = "application/epub+zip";
const ACCEPTED_TYPES = new Set([
  EPUB_TYPE,
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
]);
const MIRRORS = Object.freeze([
  "https://mirror.cs.odu.edu/gutenberg-epub",
  "https://gutenberg.pglaf.org/cache/epub",
]);

export const GUTENBERG_RELAY_LIMITS = Object.freeze({
  maxBytes: 30 * 1024 * 1024,
  timeoutMs: 20_000,
  maxConcurrent: 4,
  cacheMaxBytes: 64 * 1024 * 1024,
  cacheTtlMs: 6 * 60 * 60 * 1000,
});

class RelayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function unavailable() {
  return new RelayError(
    502,
    "SOURCE_UNAVAILABLE",
    "La source du livre est temporairement indisponible. Réessayez dans un instant.",
  );
}

function tooLarge() {
  return new RelayError(
    413,
    "BOOK_TOO_LARGE",
    "Ce fichier EPUB dépasse la taille autorisée de 30 Mo.",
  );
}

function invalidEpub() {
  return new RelayError(
    502,
    "INVALID_EPUB",
    "La source n’a pas fourni un fichier EPUB valide. Réessayez plus tard.",
  );
}

function cancelBody(body) {
  // Cancellation must not keep a failed or timed-out request alive.
  try {
    Promise.resolve(body?.cancel()).catch(() => {});
  } catch {
    // A body already owned by a reader cannot be cancelled here.
  }
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function readEpub(response, maxBytes, signal) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(contentType) || !response.body) {
    cancelBody(response.body);
    throw invalidEpub();
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    cancelBody(response.body);
    throw tooLarge();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    // In particular, enforce a limit on actual bytes even when Content-Length
    // is absent, dishonest or describes a compressed HTTP response.
    cancelBody(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks, size);

  // EPUB's first ZIP entry must be the uncompressed "mimetype" file. This
  // distinguishes an EPUB from an HTML response, arbitrary ZIP or empty file.
  if (
    buffer.length < 58 ||
    buffer.readUInt32LE(0) !== 0x04034b50 ||
    (buffer.readUInt16LE(6) & 1) !== 0 ||
    buffer.readUInt16LE(8) !== 0 ||
    buffer.readUInt32LE(18) !== 20 ||
    buffer.readUInt32LE(22) !== 20 ||
    buffer.readUInt16LE(26) !== 8 ||
    buffer.readUInt16LE(28) !== 0 ||
    buffer.toString("ascii", 30, 38) !== "mimetype" ||
    buffer.toString("ascii", 38, 58) !== EPUB_TYPE
  ) throw invalidEpub();
  return buffer;
}

async function retrieveBook(id, { fetchImpl, timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new RelayError(
    504,
    "SOURCE_TIMEOUT",
    "Le téléchargement prend trop de temps. Réessayez dans un instant.",
  )), timeoutMs);
  timeout.unref?.();

  let lastError = unavailable();
  try {
    let lightweightMissing = false;
    // The original text-first EPUB is much smaller on mobile. Keep its
    // contents/licence unchanged; the illustrated edition is only a 404 fallback.
    for (const variant of ["", "-images"]) {
      if (variant && !lightweightMissing) break;
      for (const mirror of MIRRORS) {
        const url = `${mirror}/${id}/pg${id}${variant}.epub`;
        let response;
        try {
          response = await abortable(fetchImpl(url, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              Accept: `${EPUB_TYPE}, application/octet-stream;q=0.9`,
              "User-Agent": "FastReader/1.0 (EPUB reader; individual user-requested downloads)",
            },
          }), controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          lastError = unavailable();
          continue;
        }

        // Redirects are never followed, including redirects to another trusted
        // mirror: the only permitted URLs are constructed above from the ID.
        if ((response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== url)) {
          cancelBody(response.body);
          throw new RelayError(502, "UNSAFE_REDIRECT", "La source du livre a changé d’adresse. Réessayez plus tard.");
        }
        if (response.status !== 200) {
          cancelBody(response.body);
          if (response.status === 404) {
            if (!variant) lightweightMissing = true;
            lastError = new RelayError(404, "BOOK_UNAVAILABLE", "Ce livre n’est pas disponible au format EPUB pour le moment.");
            continue;
          }
          if (response.status === 410) {
            throw new RelayError(404, "BOOK_UNAVAILABLE", "Ce livre n’est plus proposé par la source.");
          }
          // Respect source access restrictions rather than retrying elsewhere.
          if (response.status === 401 || response.status === 403 || response.status === 429) {
            throw new RelayError(503, "SOURCE_BUSY", "La source est occupée. Réessayez dans quelques minutes.");
          }
          lastError = unavailable();
          continue;
        }
        return await readEpub(response, maxBytes, controller.signal);
      }
    }
    throw lastError;
  } finally {
    clearTimeout(timeout);
  }
}

function positiveOption(value, fallback, { zero = false } = {}) {
  return Number.isSafeInteger(value) && (zero ? value >= 0 : value > 0) ? value : fallback;
}

function allowedOrigin(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    const url = new URL(value);
    if (typeof value === "string" && url.protocol === "https:" && url.origin === value && !url.username && !url.password) return value;
  } catch { /* Reject a deployment typo before opening a public listener. */ }
  throw new TypeError("GUTENBERG_ALLOWED_ORIGIN doit être une origine HTTPS exacte, sans chemin ni barre finale.");
}

export function createGutenbergMiddleware(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const allowOrigin = allowedOrigin(options.allowOrigin);
  const now = options.now ?? Date.now;
  const limits = Object.fromEntries(Object.entries(GUTENBERG_RELAY_LIMITS).map(([key, fallback]) => [
    key,
    // Options may lower hard limits for deployment or tests, never raise them.
    Math.min(positiveOption(options[key], fallback, { zero: key === "cacheMaxBytes" }), fallback),
  ]));
  const cache = new Map();
  const pending = new Map();
  let cachedBytes = 0;

  function evict(id) {
    const entry = cache.get(id);
    if (!entry) return;
    cachedBytes -= entry.buffer.length;
    cache.delete(id);
  }

  async function getBook(id) {
    const entry = cache.get(id);
    if (entry && entry.expiresAt > now()) {
      cache.delete(id);
      cache.set(id, entry);
      return entry.buffer;
    }
    evict(id);
    if (pending.has(id)) return pending.get(id);
    if (pending.size >= limits.maxConcurrent) {
      throw new RelayError(429, "RELAY_BUSY", "Plusieurs livres sont en cours de téléchargement. Réessayez dans un instant.");
    }

    const download = retrieveBook(id, { fetchImpl, ...limits }).then((buffer) => {
      if (buffer.length <= limits.cacheMaxBytes) {
        for (const [key, value] of cache) {
          if (value.expiresAt <= now()) evict(key);
        }
        while (cachedBytes + buffer.length > limits.cacheMaxBytes && cache.size) evict(cache.keys().next().value);
        cache.set(id, { buffer, expiresAt: now() + limits.cacheTtlMs });
        cachedBytes += buffer.length;
      }
      return buffer;
    }).finally(() => pending.delete(id));
    pending.set(id, download);
    return download;
  }

  return async function gutenbergMiddleware(req, res, next = () => {}) {
    const requestUrl = String(req.url ?? "");
    if (requestUrl !== PREFIX && !requestUrl.startsWith(`${PREFIX}/`) && !requestUrl.startsWith(`${PREFIX}?`)) return next();

    try {
      if (allowOrigin) res.setHeader("Vary", "Origin");
      const origin = req.headers?.origin;
      if (origin && origin !== allowOrigin) throw new RelayError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
      if (allowOrigin && origin === allowOrigin) {
        res.setHeader("Access-Control-Allow-Origin", allowOrigin);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Retry-After");
      }
      if (req.method === "OPTIONS" && allowOrigin) {
        if (origin !== allowOrigin) throw new RelayError(403, "ORIGIN_NOT_ALLOWED", "Ce site n’est pas autorisé à utiliser ce relais.");
        if (!/^\/api\/books\/gutenberg\/[1-9]\d{0,8}\.epub$/.test(requestUrl)) throw new RelayError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
        const requestedMethod = req.headers?.["access-control-request-method"];
        const requestedHeaders = String(req.headers?.["access-control-request-headers"] || "").toLowerCase().split(",").map((name) => name.trim()).filter(Boolean);
        if (!["GET", "HEAD"].includes(requestedMethod) || requestedHeaders.some((name) => name !== "accept")) throw new RelayError(403, "PREFLIGHT_NOT_ALLOWED", "Seuls les téléchargements EPUB sans authentification sont acceptés.");
        res.statusCode = 204;
        res.setHeader("Allow", "GET, HEAD, OPTIONS");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD");
        res.setHeader("Access-Control-Allow-Headers", "Accept");
        res.setHeader("Access-Control-Max-Age", "600");
        res.setHeader("Cache-Control", "no-store");
        return res.end();
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", allowOrigin ? "GET, HEAD, OPTIONS" : "GET, HEAD");
        throw new RelayError(405, "METHOD_NOT_ALLOWED", "Seuls les téléchargements de livres sont acceptés.");
      }
      const match = /^\/api\/books\/gutenberg\/([1-9]\d{0,8})\.epub$/.exec(requestUrl);
      if (!match) throw new RelayError(400, "INVALID_BOOK_ID", "L’identifiant du livre est invalide.");
      const id = match[1];
      const buffer = await getBook(id);
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = 200;
      res.setHeader("Content-Type", EPUB_TYPE);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Content-Disposition", `inline; filename="gutenberg-${id}.epub"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.end(req.method === "HEAD" ? undefined : buffer);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const failure = error instanceof RelayError ? error : unavailable();
      res.statusCode = failure.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (failure.status === 429 || failure.status === 503) res.setHeader("Retry-After", "15");
      const body = JSON.stringify({ error: { code: failure.code, message: failure.message } });
      res.setHeader("Content-Length", Buffer.byteLength(body));
      res.end(req.method === "HEAD" ? undefined : body);
    }
  };
}
