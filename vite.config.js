import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { gutenbergRelay } from "./server/vite-relay.js";
import { localizedSeoPlugin, writeLocalizedPages } from "./scripts/localized-pages.mjs";
import { DEFAULT_SITE_URL, normalizeSiteUrl } from "./src/seo-data.js";

const root = path.dirname(fileURLToPath(import.meta.url));

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? listFiles(path.join(directory, entry.name), relative)
        : [relative];
    }),
  );
  return files.flat().sort();
}

// Precache every UI language, the French catalogue and selected EPUBs;
// other catalogue languages load on demand.
function offlineShell(siteUrl) {
  let outputDirectory;
  let buildFailed = false;
  return {
    name: "fastreader-offline-shell",
    apply: "build",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    buildEnd(error) {
      buildFailed = Boolean(error);
    },
    async closeBundle() {
      if (buildFailed) return;
      // Generate real language documents before hashing so every locale works
      // offline and shares the same service-worker version as its JS and CSS.
      await writeLocalizedPages(outputDirectory, siteUrl);
      const files = (await listFiles(outputDirectory)).filter(
        (file) =>
          file !== "sw.js" &&
          file !== "CNAME" &&
          !file.endsWith(".map") &&
          !file.split("/").some((segment) => segment.startsWith(".")),
      );
      const template = await readFile(path.join(root, "public/sw.js"), "utf8");
      const hash = createHash("sha256").update(template);
      for (const file of files) {
        hash
          .update(file)
          .update(await readFile(path.join(outputDirectory, file)));
      }
      const deferred = files.filter(
        (file) => file.startsWith("catalog/") && !/^catalog\/fr-/.test(file),
      );
      const precache = files.filter((file) => !deferred.includes(file));
      const serviceWorker = template
        .replace("__BUILD_VERSION__", hash.digest("hex").slice(0, 16))
        .replace("/* __PRECACHE_MANIFEST__ */ []", JSON.stringify(precache))
        .replace("/* __DEFERRED_MANIFEST__ */ []", JSON.stringify(deferred));
      await writeFile(path.join(outputDirectory, "sw.js"), serviceWorker);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "VITE_");
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL || DEFAULT_SITE_URL);
  return {
    // Relative URLs work at /EPUB-FastReader/ and on a custom domain.
    base: "./",
    input: {
      main: path.join(root, "index.html"),
      viewer: path.join(root, "viewer.html"),
    },
    build: {
      rolldownOptions: {
        output: {
          // A separately cached translation bundle keeps reader-code changes
          // from invalidating the six offline dictionaries and demo editions.
          codeSplitting: { groups: [{ name: "translations", test: /[\\/]src[\\/]locales[\\/]/ }] },
        },
      },
    },
    plugins: [gutenbergRelay(), localizedSeoPlugin(siteUrl), offlineShell(siteUrl)],
  };
});
