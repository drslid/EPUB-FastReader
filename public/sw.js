/* The production build replaces the version and asset list below. */
const VERSION = "__BUILD_VERSION__";
const PRECACHE_FILES = /* __PRECACHE_MANIFEST__ */ [];
const DEFERRED_FILES = /* __DEFERRED_MANIFEST__ */ [];
const SCOPE = new URL(self.registration.scope);
// Isolate this app from other GitHub Pages projects on the same origin.
const CACHE_PREFIX = `fastreader:${SCOPE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL_URL = new URL("index.html", SCOPE).href;
const PRECACHE_URLS = new Set(
  PRECACHE_FILES.map((file) => new URL(file, SCOPE).href),
);
const DEFERRED_URLS = new Set(
  DEFERRED_FILES.map((file) => new URL(file, SCOPE).href),
);
const ASSET_URLS = new Set([...PRECACHE_URLS, ...DEFERRED_URLS]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(
          [...PRECACHE_URLS].map(
            (url) => new Request(url, { cache: "reload" }),
          ),
        );
      } catch (error) {
        await caches.delete(CACHE_NAME);
        throw error;
      }
      // An update waits for existing reading tabs to close; never interrupt a book.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The UI may expose an explicit update action after saving reading progress.
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname))
    return;

  if (request.mode === "navigate") {
    // Serve one coherent shell and its matching hashed assets while an update waits.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const documentURL = new URL(url.pathname, SCOPE.origin).href;
        const cached = await cache.match(
          ASSET_URLS.has(documentURL) ? documentURL : SHELL_URL,
          { ignoreVary: true },
        );
        return cached || fetch(request);
      })(),
    );
    return;
  }

  // Only known, hashed catalogue shards can enter the on-demand cache. No remote service is cached.
  if (!ASSET_URLS.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Built public files have one representation. Module requests add an Origin
      // header, unlike precache requests; Vary: Origin must not hide cached assets.
      const cached = await cache.match(url.href, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (
        DEFERRED_URLS.has(url.href) &&
        response.ok &&
        response.headers.get("content-type")?.includes("json")
      ) {
        try {
          await cache.put(url.href, response.clone());
        } catch {
          /* Low storage must not prevent a connected search. */
        }
      }
      return response;
    })(),
  );
});
