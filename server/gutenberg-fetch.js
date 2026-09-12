import { createGutenbergMiddleware } from "./gutenberg-relay.js";

/** Preserve the reviewed Gutenberg retrieval logic when hosting it in Workers. */
export function createGutenbergHandler(options = {}) {
  const middleware = createGutenbergMiddleware(options);
  return (request) => new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const headers = new Headers();
    const response = {
      statusCode: 200,
      writableEnded: false,
      destroyed: false,
      setHeader(name, value) { headers.set(name, String(value)); },
      end(bytes) { this.writableEnded = true; resolve(new Response(bytes, { status: this.statusCode, headers })); },
    };
    Promise.resolve(middleware({ method: request.method, url: `${url.pathname}${url.search}`, headers: Object.fromEntries(request.headers) }, response, () => resolve(null))).catch(reject);
  });
}
