const PROBES = Object.freeze([
  { providerId: "gutenberg", method: "HEAD", url: "https://mirror.cs.odu.edu/gutenberg-epub/11/pg11.epub", contentType: "application/epub+zip" },
  { providerId: "ebooks-gratuits", method: "GET", url: "https://www.ebooksgratuits.com/opds/", contentType: "xml" },
  { providerId: "fadedpage", method: "HEAD", url: "https://www.fadedpage.com/csearch.php", contentType: "html" },
  { providerId: "epubbooks", method: "GET", url: "https://www.epubbooks.com/", contentType: "html" },
]);

/** Reachability check only; no book is downloaded and no search term is sent. */
export function createSourceStatusHandler({ fetchImpl = globalThis.fetch, allowOrigin = "", now = Date.now, timeoutMs = 15_000, cacheTtlMs = 300_000 } = {}) {
  if (allowOrigin) {
    const url = new URL(allowOrigin);
    if (url.protocol !== "https:" || url.origin !== allowOrigin || url.username || url.password) throw new TypeError("Origine de disponibilité invalide.");
  }
  let cache;
  let pending;
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
  async function results() {
    if (cache && cache.expires > now()) return cache.data;
    if (pending) return pending;
    pending = Promise.all(PROBES.map(probe)).then((sources) => {
      const data = { checkedAt: new Date(now()).toISOString(), sources };
      cache = { data, expires: now() + Math.min(cacheTtlMs, 300_000) };
      return data;
    }).finally(() => { pending = undefined; });
    return pending;
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
