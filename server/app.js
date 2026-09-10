import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGutenbergMiddleware } from "./gutenberg-relay.js";

const defaultRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".epub": "application/epub+zip",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

export function createAppServer({ root = defaultRoot, relayOptions } = {}) {
  const directory = path.resolve(root);
  const relay = createGutenbergMiddleware(relayOptions);
  return createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const fail = (status, message) => {
      res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(message);
    };
    const staticFile = async () => {
      if (!["GET", "HEAD"].includes(req.method)) {
        res.setHeader("Allow", "GET, HEAD");
        return fail(405, "Méthode non autorisée.");
      }
      let pathname;
      try {
        pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
      } catch {
        return fail(400, "Adresse invalide.");
      }
      if (pathname === "/api/health") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(req.method === "HEAD" ? undefined : '{"status":"ok"}');
      }
      // Serve only public build files. No SPA fallback for missing APIs/assets.
      if (
        pathname.includes("\\") ||
        pathname.includes("\0") ||
        pathname.split("/").some((segment) => segment.startsWith("."))
      ) {
        return fail(404, "Fichier introuvable.");
      }
      const filename = path.resolve(
        directory,
        `.${pathname === "/" ? "/index.html" : pathname}`,
      );
      if (!filename.startsWith(`${directory}${path.sep}`))
        return fail(404, "Fichier introuvable.");
      let info;
      try {
        const [publicRoot, target] = await Promise.all([
          realpath(directory),
          realpath(filename),
        ]);
        if (!target.startsWith(`${publicRoot}${path.sep}`))
          return fail(404, "Fichier introuvable.");
        info = await stat(filename);
      } catch {
        return fail(404, "Fichier introuvable.");
      }
      if (!info.isFile()) return fail(404, "Fichier introuvable.");
      const immutable = /^\/assets\/|^\/catalog\/.*-[a-f0-9]{12}\.json$/.test(
        pathname,
      );
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] || "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": immutable
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      if (req.method === "HEAD") return res.end();
      const stream = createReadStream(filename);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    };
    try {
      Promise.resolve(
        relay(req, res, () =>
          staticFile().catch(() => {
            if (!res.headersSent) fail(500, "Lecture du fichier impossible.");
            else res.destroy();
          }),
        ),
      ).catch(() => {
        if (!res.headersSent)
          fail(502, "Téléchargement temporairement indisponible.");
        else res.destroy();
      });
    } catch {
      fail(500, "Requête impossible.");
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT invalide.");
  const server = createAppServer();
  server.listen(port, process.env.HOST || "0.0.0.0", () =>
    console.log(`FastReader disponible sur le port ${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
