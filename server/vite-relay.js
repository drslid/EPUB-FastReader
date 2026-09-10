import { createGutenbergMiddleware } from "./gutenberg-relay.js";

export function gutenbergRelay() {
  return {
    name: "fastreader-gutenberg-relay",
    configureServer(server) {
      server.middlewares.use(createGutenbergMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createGutenbergMiddleware());
    },
  };
}
