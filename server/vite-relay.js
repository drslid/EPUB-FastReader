import { createGutenbergMiddleware } from "./gutenberg-relay.js";
import { createEbooksGratuitsMiddleware } from "./ebooks-gratuits-source.js";
import { createSourceStatusMiddleware } from "./source-status.js";

const install = (server) => {
  server.middlewares.use(createGutenbergMiddleware());
  server.middlewares.use(createEbooksGratuitsMiddleware());
  server.middlewares.use(createSourceStatusMiddleware());
};

export function gutenbergRelay() {
  return {
    name: "fastreader-sources-relay",
    configureServer: install,
    configurePreviewServer: install,
  };
}
