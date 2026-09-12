// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppServer } from "../server/app.js";

let temporary;
let server;
let port;
const fetchSource = vi.fn(async () => new Response("Une réponse HTML incorrecte", {
  status: 200,
  headers: { "content-type": "text/html" },
}));

function request(pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    // Passing the raw path preserves traversal cases which fetch normalizes.
    const req = httpRequest({ hostname: "127.0.0.1", port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("HTTP test timed out")));
    req.end();
  });
}

beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "fastreader-server-"));
  const root = path.join(temporary, "public");
  for (const directory of [root, "assets", "catalog", "books"].map((name, index) => index ? path.join(root, name) : name))
    await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "index.html"), "<!doctype html><title>FastReader fixture</title>"),
    writeFile(path.join(root, "assets/main-abcdef12.js"), "export const reader = true;"),
    writeFile(path.join(root, "assets/main-abcdef12.css"), "body { color: #eee; }"),
    writeFile(path.join(root, "catalog/fr-1-abcdef123456.json"), '[{"title":"Candide"}]'),
    writeFile(path.join(root, "books/candide.epub"), Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2, 3])),
    writeFile(path.join(root, "sw.js"), 'self.addEventListener("fetch", () => {});'),
    writeFile(path.join(root, "manifest.webmanifest"), '{"name":"FastReader"}'),
    writeFile(path.join(root, ".private"), "not public"),
    writeFile(path.join(temporary, "outside.txt"), "must remain outside the public build"),
  ]);
  await symlink(path.join(temporary, "outside.txt"), path.join(root, "outside-link.txt"));
  server = createAppServer({ root, relayOptions: { fetchImpl: fetchSource, cacheMaxBytes: 0 } });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;
});

beforeEach(() => fetchSource.mockClear());

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

describe("production HTTP server", () => {
  it("serves the application and its explicit index with safe response headers", async () => {
    const home = await request("/");
    const index = await request("/index.html");
    expect(home.status).toBe(200);
    expect(home.body.toString()).toContain("FastReader fixture");
    expect(index.body).toEqual(home.body);
    expect(home.headers["content-type"]).toContain("text/html");
    expect(home.headers["x-content-type-options"]).toBe("nosniff");
    expect(home.headers["referrer-policy"]).toBe("no-referrer");
    expect(home.headers["set-cookie"]).toBeUndefined();
    expect(home.headers["cache-control"]).toBe("no-cache");
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it.each([
    ["/assets/main-abcdef12.js", "text/javascript"],
    ["/assets/main-abcdef12.css", "text/css"],
    ["/catalog/fr-1-abcdef123456.json", "application/json"],
    ["/books/candide.epub", "application/epub+zip"],
    ["/manifest.webmanifest", "application/manifest+json"],
  ])("serves %s with its actual MIME type and equivalent HEAD metadata", async (pathname, type) => {
    const get = await request(pathname);
    const head = await request(pathname, "HEAD");
    expect(get.status).toBe(200);
    expect(get.headers["content-type"]).toContain(type);
    expect(Number(get.headers["content-length"])).toBe(get.body.length);
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
    expect(head.body.length).toBe(0);
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("caches hashed assets indefinitely while allowing service-worker updates", async () => {
    for (const pathname of ["/assets/main-abcdef12.js", "/catalog/fr-1-abcdef123456.json"])
      expect((await request(pathname)).headers["cache-control"]).toContain("immutable");
    expect((await request("/sw.js")).headers["cache-control"]).toBe("no-cache");
  });

  it("answers health probes without calling the remote book source", async () => {
    const health = await request("/api/health");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body.toString())).toEqual({ status: "ok" });
    expect(health.headers["content-type"]).toContain("application/json");
    expect(health.headers["cache-control"]).toBe("no-store");
    expect((await request("/api/health", "HEAD")).body.length).toBe(0);
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it.each(["/api/missing", "/api/sources/atramenta/search?query=Flaubert&page=1", "/api/books/atramenta/15038-un-coeur-simple.epub", "/assets/missing.js", "/unknown-page", "/books", "/assets/"])("returns 404 instead of the app shell for %s", async (pathname) => {
    const response = await request(pathname);
    expect(response.status).toBe(404);
    expect(response.body.toString()).not.toContain("FastReader fixture");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it.each(["/..%2foutside.txt", "/%2e%2e%2foutside.txt", "/..%5coutside.txt", "/%00outside.txt", "/.private"])("does not serve private paths: %s", async (pathname) => {
    const response = await request(pathname);
    expect(response.status).toBe(404);
    expect(response.body.toString()).not.toContain("must remain outside");
    expect(response.body.toString()).not.toContain("not public");
  });

  it("rejects malformed URL encoding with 400", async () => {
    const response = await request("/%E0%A4%A");
    expect(response.status).toBe(400);
    expect(response.body.toString()).not.toContain("FastReader fixture");
  });

  it("refuses a public symlink pointing outside the build directory", async () => {
    const response = await request("/outside-link.txt");
    expect(response.status).toBe(404);
    expect(response.body.toString()).not.toContain("must remain outside");
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it.each(["/", "/api/health", "/api/books/gutenberg/4650.epub"])("rejects uploads to %s before contacting a source", async (pathname) => {
    const response = await request(pathname, "POST");
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("routes book downloads through the relay and propagates a typed source failure", async () => {
    const response = await request("/api/books/gutenberg/4650.epub");
    expect(response.status).toBe(502);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.body.toString()).error.code).toBe("INVALID_EPUB");
    expect(response.body.toString()).not.toContain("FastReader fixture");
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource.mock.calls[0][0]).toMatch(/^https:\/\/[^/]+\/.*\/4650\/pg4650\.epub$/);
  });
});
