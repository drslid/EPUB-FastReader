const PROBES = Object.freeze([
  { providerId: "gutenberg", method: "HEAD", url: "https://mirror.cs.odu.edu/gutenberg-epub/11/pg11.epub", contentType: "application/epub+zip" },
  { providerId: "ebooks-gratuits", method: "GET", url: "https://www.ebooksgratuits.com/opds/", contentType: "xml" },
  { providerId: "fadedpage", method: "HEAD", url: "https://www.fadedpage.com/csearch.php", contentType: "html" },
  { providerId: "epubbooks", method: "GET", url: "https://www.epubbooks.com/", contentType: "html" },
  { providerId: "ebookzy", method: "HEAD", url: "https://ebookzy.com/", contentType: "html" },
  { providerId: "loyalbooks", method: "HEAD", url: "https://www.loyalbooks.com/", contentType: "html" },
]);

/** Reachability check only; no book is downloaded and no search term is sent. */
export function createSourceStatusHandler({ fetchImpl = globalThis.fetch, allowOrigin = "", now = Date.now, timeoutMs = 15_000, cacheTtlMs = 300_000, getRestrictions = async () => ({}) } = {}) {
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine de disponibilité invalide.");
  }
  const cache = new Map();
  const pending = new Map();
  async function probe(definition) {
    const controller = new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        fetchImpl(definition.url, { method: definition.method, redirect: "manual", credentials: "omit", signal: controller.signal, headers: { Accept: definition.contentType === "html" ? "text/html" : definition.contentType === "xml" ? "application/atom+xml" : "application/epub+zip" } }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Timeout")); }, Math.min(timeoutMs, 15_000)); timer.unref?.(); }),
      ]);
      const type = response.headers.get("content-type") || "";
      const expected = definition.contentType === "xml" ? /(?:atom\+xml|application\/xml|text\/xml)/iu : definition.contentType === "html" ? /text\/html/iu : /(?:epub\+zip|octet-stream|application\/zip)/iu;
      const available = response.status === 200 && !response.redirected && (!response.url || response.url === definition.url) && expected.test(type);
      // The headers establish endpoint reachability. Cancel the OPDS body;
      // importing a particular edition remains subject to its own validation.
      void response.body?.cancel().catch(() => {});
      return { providerId: definition.providerId, available, checkedAt: new Date(now()).toISOString(), code: available ? "AVAILABLE" : "SOURCE_UNAVAILABLE" };
    } catch {
      return { providerId: definition.providerId, available: false, checkedAt: new Date(now()).toISOString(), code: controller.signal.aborted ? "SOURCE_TIMEOUT" : "SOURCE_UNAVAILABLE" };
    } finally { clearTimeout(timer); }
  }
  async function reachable(definition) {
    const id = definition.providerId;
    const cached = cache.get(id);
    if (cached?.expires > now()) return cached.data;
    if (pending.has(id)) return pending.get(id);
    const task = probe(definition).then((data) => {
      cache.set(id, { data, expires: now() + Math.min(cacheTtlMs, 300_000) });
      return data;
    }).finally(() => { pending.delete(id); });
    pending.set(id, task);
    return task;
  }
  async function results() {
    // A reachable homepage cannot override a known download restriction.
    // Read these on every request, independently of the reachability cache.
    const restrictions = await getRestrictions();
    const sources = await Promise.all(PROBES.map((definition) => {
      const restriction = restrictions?.[definition.providerId];
      if (restriction && ["SOURCE_DAILY_LIMIT", "SOURCE_BUSY", "SOURCE_LOGIN_REQUIRED", "SOURCE_UNAVAILABLE"].includes(restriction.code)) {
        // Do not probe a refused source. Once its restriction expires, a fresh
        // check must replace any green result from before the restriction.
        cache.delete(definition.providerId);
        return {
          providerId: definition.providerId, available: false,
          checkedAt: new Date(now()).toISOString(), code: restriction.code,
          ...(Number.isSafeInteger(restriction.retryAfter) && restriction.retryAfter > 0 ? { retryAfter: restriction.retryAfter } : {}),
        };
      }
      return reachable(definition);
    }));
    return { checkedAt: new Date(now()).toISOString(), sources };
  }
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/api/sources/status") return null;
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (allowOrigin) headers.set("Vary", "Origin");
    const origin = request.headers.get("origin");
    if (origin && origin !== allowOrigin && origin !== url.origin) return new Response('{"error":{"code":"ORIGIN_NOT_ALLOWED"}}', { status: 403, headers });
    if (origin === allowOrigin && origin) headers.set("Access-Control-Allow-Origin", allowOrigin);
    if (request.method !== "GET" || url.search) return new Response('{"error":{"code":"INVALID_REQUEST"}}', { status: 400, headers });
    return new Response(JSON.stringify(await results()), { headers });
  };
}

export function createSourceStatusMiddleware(options = {}) {
  const handler = createSourceStatusHandler(options);
  return async (req, res, next = () => {}) => {
    if (String(req.url).split("?", 1)[0] !== "/api/sources/status") return next();
    const response = await handler(new Request(new URL(req.url, "http://localhost"), { method: req.method, headers: req.headers }));
    if (!response) return next();
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(new Uint8Array(await response.arrayBuffer()));
  };
}
