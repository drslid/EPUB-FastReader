import { createGutenbergHandler } from "./gutenberg-fetch.js";
import { createEbooksGratuitsHandler, EbooksGratuitsError } from "./ebooks-gratuits-source.js";
import { createSourceStatusHandler } from "./source-status.js";
import { createFadedpageHandler } from "./fadedpage-source.js";
import { createEpubbooksHandler } from "./epubbooks-source.js";

const DEFAULT_ORIGIN = "https://drslid.github.io";

/** One shared object: ELG limits survive restarts and are never multiplied by
 * worker region, reader, browser or deployment. Only quota timestamps persist.
 */
export class FastReaderSources {
  constructor(state, env) {
    this.state = state;
    const options = { allowOrigin: env.SOURCE_ALLOWED_ORIGIN || DEFAULT_ORIGIN };
    this.allowedOrigin = options.allowOrigin;
    this.gutenberg = createGutenbergHandler({ ...options, cacheMaxBytes: 4 * 1024 * 1024, maxConcurrent: 1 });
    this.ebooksGratuits = createEbooksGratuitsHandler({
      ...options, cacheMaxBytes: 4 * 1024 * 1024, maxCachedSearches: 2,
      reserveDownload: async ({ signal, now, limits }) => {
        signal.throwIfAborted();
        const timestamps = (await state.storage.get("elg-download-timestamps") || []).filter((time) => Number.isSafeInteger(time) && time > now - 86_400_000);
        if (timestamps.length >= limits.maxDailyDownloads) throw new EbooksGratuitsError(429, "SOURCE_DAILY_LIMIT", "La limite quotidienne de cette source est atteinte. Réessayez demain.", Math.ceil((timestamps[0] + 86_400_000 - now) / 1000));
        const elapsed = now - (timestamps.at(-1) || 0);
        if (elapsed < limits.minDownloadIntervalMs) throw new EbooksGratuitsError(429, "SOURCE_BUSY", "La source demande de patienter. Réessayez dans un instant.", Math.ceil((limits.minDownloadIntervalMs - elapsed) / 1000));
        // Persist the reservation before contacting the provider, including
        // attempts that subsequently fail. No book ID or user data is stored.
        await state.storage.put("elg-download-timestamps", [...timestamps, now]);
      },
    });
    this.status = createSourceStatusHandler(options);
    this.epubbooks = createEpubbooksHandler({ ...options, cacheMaxBytes: 2 * 1024 * 1024, maxCachedSearches: 2 });
    this.fadedpage = createFadedpageHandler({ ...options, cacheMaxBytes: 4 * 1024 * 1024, maxCachedSearches: 2 });
    this.downloadTail = Promise.resolve();
    this.queuedDownloads = 0;
  }

  async dispatch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/sources/status") return this.status(request);
    return await this.gutenberg(request) || await this.ebooksGratuits(request) || await this.fadedpage(request) || await this.epubbooks(request)
      || new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  async fetch(request) {
    // Bound total EPUB buffering within the 128-MB Worker isolate. Catalogue
    // searches and availability probes continue while a book is downloaded.
    if (request.method !== "GET" || !new URL(request.url).pathname.startsWith("/api/books/")) return this.dispatch(request);
    if (this.queuedDownloads >= 1) {
      const response = new Response('{"error":{"code":"RELAY_BUSY","message":"Plusieurs livres sont en cours de téléchargement. Réessayez dans un instant."}}', { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "15" } });
      const origin = request.headers.get("Origin");
      if (origin === this.allowedOrigin) response.headers.set("Access-Control-Allow-Origin", origin);
      return response;
    }
    this.queuedDownloads++;
    const task = this.downloadTail.catch(() => {}).then(() => this.dispatch(request)).finally(() => { this.queuedDownloads--; });
    this.downloadTail = task.catch(() => {});
    return task;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = env.SOURCE_ALLOWED_ORIGIN || DEFAULT_ORIGIN;
    const origin = request.headers.get("Origin");
    if (origin && origin !== allowed) return new Response('{"error":{"code":"ORIGIN_NOT_ALLOWED"}}', { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" } });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) || !/^\/api\/(?:sources|books)\//u.test(url.pathname)) return new Response("Not found", { status: 404 });
    const id = env.SOURCES.idFromName("fastreader-public-sources-v1");
    return env.SOURCES.get(id).fetch(request);
  },
};
