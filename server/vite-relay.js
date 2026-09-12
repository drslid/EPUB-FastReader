import { createGutenbergMiddleware } from "./gutenberg-relay.js";
import { createEbooksGratuitsMiddleware } from "./ebooks-gratuits-source.js";
import { createSourceStatusMiddleware } from "./source-status.js";
import { createFadedpageMiddleware } from "./fadedpage-source.js";
import { createEpubbooksMiddleware } from "./epubbooks-source.js";
import { createEbookzyMiddleware } from "./ebookzy-source.js";
import { createLoyalbooksMiddleware } from "./loyalbooks-source.js";

const install = (server) => {
  server.middlewares.use(createGutenbergMiddleware());
  server.middlewares.use(createEbooksGratuitsMiddleware());
  server.middlewares.use(createFadedpageMiddleware());
  server.middlewares.use(createEpubbooksMiddleware());
  server.middlewares.use(createEbookzyMiddleware());
  server.middlewares.use(createLoyalbooksMiddleware());
  server.middlewares.use(createSourceStatusMiddleware());
};

export function gutenbergRelay() {
  return {
    name: "fastreader-sources-relay",
    configureServer: install,
    configurePreviewServer: install,
  };
}
