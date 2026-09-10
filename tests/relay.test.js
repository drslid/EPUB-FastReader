// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import JSZip from "jszip";
import { createGutenbergMiddleware } from "../server/gutenberg-relay.js";

const epub = await new JSZip()
  .file("mimetype", "application/epub+zip", { compression: "STORE" })
  .file("META-INF/container.xml", "<container/>")
  .generateAsync({ type: "nodebuffer" });

function upstream(body = epub, headers = {}, status = 200) {
  return new Response(body, { status, headers: { "content-type": "application/octet-stream", ...headers } });
}

async function request(middleware, url = "/api/books/gutenberg/5711.epub", method = "GET", headers = {}) {
  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(body) { this.body = body; this.writableEnded = true; },
  };
  const next = vi.fn();
  await middleware({ url, method, headers }, res, next);
  return { ...res, next, json: () => JSON.parse(res.body) };
}

afterEach(() => vi.useRealTimers());

describe("relais EPUB à la demande", () => {
  it("renvoie le fichier original sans transmettre cookies, origine ni données du lecteur", async () => {
    const fetchImpl = vi.fn(async () => upstream());
    const middleware = createGutenbergMiddleware({ fetchImpl });
    const result = await request(middleware, undefined, "GET", {
      cookie: "private=session", authorization: "Bearer private", referer: "https://private/reading",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(epub);
    expect(result.headers).toMatchObject({
      "content-type": "application/epub+zip",
      "content-length": String(epub.length),
      "content-disposition": 'inline; filename="gutenberg-5711.epub"',
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=3600",
    });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://mirror.cs.odu.edu/gutenberg-epub/5711/pg5711.epub");
    expect(options).toMatchObject({ method: "GET", redirect: "manual" });
    expect(JSON.stringify(options)).not.toContain("private");
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(result.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("fonctionne comme middleware Node HTTP et HEAD ne renvoie aucun corps", async () => {
    const fetchImpl = vi.fn(async () => upstream());
    const middleware = createGutenbergMiddleware({ fetchImpl });
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(`${address}/api/books/gutenberg/1342.epub`);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(epub);
      const head = await fetch(`${address}/api/books/gutenberg/1342.epub`, { method: "HEAD" });
      expect(head.headers.get("content-length")).toBe(String(epub.length));
      expect(await head.text()).toBe("");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((await fetch(`${address}/library`)).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it.each([
    "/api/books/gutenberg/0.epub",
    "/api/books/gutenberg/-1.epub",
    "/api/books/gutenberg/01.epub",
    "/api/books/gutenberg/1234567890.epub",
    "/api/books/gutenberg/../private.epub",
    "/api/books/gutenberg/%2e%2e%2fprivate.epub",
    "/api/books/gutenberg/5711.epub?url=https://private.invalid/file",
    "/api/books/gutenberg/https://private.invalid/book.epub",
    "/api/books/gutenberg/5711.epub/more",
    "/api/books/gutenberg",
  ])("rejette l’URL invalide %s sans réseau", async (url) => {
    const fetchImpl = vi.fn();
    const result = await request(createGutenbergMiddleware({ fetchImpl }), url);
    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe("INVALID_BOOK_ID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ne prend pas possession des autres routes et refuse les mutations", async () => {
    const fetchImpl = vi.fn();
    const middleware = createGutenbergMiddleware({ fetchImpl });
    expect((await request(middleware, "/catalog/fr-1.json")).next).toHaveBeenCalledOnce();
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const result = await request(middleware, undefined, method);
      expect(result.statusCode).toBe(405);
      expect(result.headers.allow).toBe("GET, HEAD");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("essaie le second miroir officiel si le premier EPUB est absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(upstream("", {}, 404)).mockResolvedValueOnce(upstream());
    expect((await request(createGutenbergMiddleware({ fetchImpl }))).statusCode).toBe(200);
    expect(fetchImpl.mock.calls[1][0]).toBe("https://gutenberg.pglaf.org/cache/epub/5711/pg5711.epub");
  });

  it("utilise l’édition illustrée uniquement si l’édition légère est absente", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(upstream("", {}, 404))
      .mockResolvedValueOnce(upstream("", {}, 404)).mockResolvedValueOnce(upstream());
    expect((await request(createGutenbergMiddleware({ fetchImpl }))).statusCode).toBe(200);
    expect(fetchImpl.mock.calls[2][0]).toBe("https://mirror.cs.odu.edu/gutenberg-epub/5711/pg5711-images.epub");
    const failed = vi.fn(async () => upstream("", {}, 500));
    expect((await request(createGutenbergMiddleware({ fetchImpl: failed }))).statusCode).toBe(502);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429])("respecte le refus %s de la source sans essayer de le contourner", async (status) => {
    const fetchImpl = vi.fn(async () => upstream("", {}, status));
    const result = await request(createGutenbergMiddleware({ fetchImpl }));
    expect(result.statusCode).toBe(503);
    expect(result.headers["retry-after"]).toBe("15");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("respecte aussi le retrait explicite d’un livre de la source", async () => {
    const fetchImpl = vi.fn(async () => upstream("", {}, 410));
    const result = await request(createGutenbergMiddleware({ fetchImpl }));
    expect(result.statusCode).toBe(404);
    expect(result.json().error.code).toBe("BOOK_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["http://127.0.0.1/private", "https://www.gutenberg.org/ebooks/5711", "https://gutenberg.pglaf.org/cache/epub/5711/pg5711.epub"])("ne suit jamais la redirection vers %s", async (location) => {
    const fetchImpl = vi.fn(async () => upstream("", { location }, 302));
    const result = await request(createGutenbergMiddleware({ fetchImpl }));
    expect(result.statusCode).toBe(502);
    expect(result.json().error.code).toBe("UNSAFE_REDIRECT");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuse aussi une redirection déjà suivie par un transport incorrect", async () => {
    const response = upstream();
    Object.defineProperty(response, "redirected", { value: true });
    const result = await request(createGutenbergMiddleware({ fetchImpl: async () => response }));
    expect(result.json().error.code).toBe("UNSAFE_REDIRECT");
  });

  it.each([
    [Buffer.from("<!doctype html>not a book"), "application/epub+zip"],
    [epub, "text/html"],
    [Buffer.alloc(100, 0x50), "application/octet-stream"],
    [Buffer.concat([epub.subarray(0, 38), Buffer.from("application/evil+zip!"), epub.subarray(58)]), "application/zip"],
  ])("vérifie le type HTTP et le véritable mimetype EPUB", async (body, type) => {
    const result = await request(createGutenbergMiddleware({ fetchImpl: async () => upstream(body, { "content-type": type }) }));
    expect(result.statusCode).toBe(502);
    expect(result.json().error.code).toBe("INVALID_EPUB");
  });

  it("refuse la taille annoncée avant de lire le corps et annule le flux", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const result = await request(createGutenbergMiddleware({
      maxBytes: 100,
      fetchImpl: async () => upstream(stream, { "content-length": "101" }),
    }));
    expect(result.statusCode).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([{}, { "content-length": "1" }])("borne aussi les octets réels, même sans taille HTTP fiable", async (headers) => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(epub); }, cancel });
    const result = await request(createGutenbergMiddleware({ maxBytes: 100, fetchImpl: async () => upstream(stream, headers) }));
    expect(result.statusCode).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("expire une connexion bloquée, libère sa place puis permet de réessayer", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(upstream());
    const middleware = createGutenbergMiddleware({ timeoutMs: 100, maxConcurrent: 1, fetchImpl });
    const pending = request(middleware);
    await vi.advanceTimersByTimeAsync(101);
    expect((await pending).statusCode).toBe(504);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect((await request(middleware)).statusCode).toBe(200);
  });

  it("expire et annule aussi un corps qui cesse de répondre après les en-têtes", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(epub.subarray(0, 20)); }, cancel });
    const middleware = createGutenbergMiddleware({ timeoutMs: 100, fetchImpl: async () => upstream(stream) });
    const pending = request(middleware);
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.statusCode).toBe(504);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fusionne les demandes du même livre et borne les téléchargements simultanés", async () => {
    let release;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const middleware = createGutenbergMiddleware({ maxConcurrent: 1, fetchImpl });
    const first = request(middleware);
    const duplicate = request(middleware);
    const refused = await request(middleware, "/api/books/gutenberg/1342.epub");
    expect(refused.statusCode).toBe(429);
    expect(fetchImpl).toHaveBeenCalledOnce();
    release(upstream());
    const results = await Promise.all([first, duplicate]);
    expect(results.every((result) => result.statusCode === 200 && result.body.equals(epub))).toBe(true);
  });

  it("borne le cache public par octets, évince le moins récent et expire les livres", async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => upstream());
    const middleware = createGutenbergMiddleware({ cacheMaxBytes: epub.length * 2, cacheTtlMs: 100, now: () => time, fetchImpl });
    await request(middleware, "/api/books/gutenberg/1.epub");
    await request(middleware, "/api/books/gutenberg/2.epub");
    await request(middleware, "/api/books/gutenberg/1.epub");
    await request(middleware, "/api/books/gutenberg/3.epub");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await request(middleware, "/api/books/gutenberg/1.epub");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await request(middleware, "/api/books/gutenberg/2.epub");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    time = 101;
    await request(middleware, "/api/books/gutenberg/2.epub");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("peut désactiver le cache et ne mémorise jamais les erreurs", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(upstream("", {}, 403)).mockImplementation(async () => upstream());
    const middleware = createGutenbergMiddleware({ fetchImpl, cacheMaxBytes: 0 });
    expect((await request(middleware)).statusCode).toBe(503);
    expect((await request(middleware)).statusCode).toBe(200);
    expect((await request(middleware)).statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retourne un 404 clair si aucun miroir ne propose le livre", async () => {
    const fetchImpl = vi.fn(async () => upstream("", {}, 404));
    const result = await request(createGutenbergMiddleware({ fetchImpl }));
    expect(result.statusCode).toBe(404);
    expect(result.json()).toMatchObject({ error: { code: "BOOK_UNAVAILABLE", message: expect.any(String) } });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
