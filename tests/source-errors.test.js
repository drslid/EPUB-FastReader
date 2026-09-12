// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { request } from "../src/sources/transport.js";
import { setLocale } from "../src/i18n.js";

const url = "https://relay.example/api/books/atramenta/15038-un-coeur-simple.epub";
const options = { timeout: 1000, maxBytes: 30 * 1024 * 1024, download: true, validateUrl: (value) => value === url };
afterEach(() => { vi.unstubAllGlobals(); setLocale("fr"); });

it.each([
  [429, "SOURCE_DAILY_LIMIT", "limite de téléchargement"],
  [403, "SOURCE_LOGIN_REQUIRED", "connexion sur son site"],
  [503, "SOURCE_BUSY", "patienter"],
])("explains provider restriction %s / %s without retrying or showing upstream text", async (status, code, message) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code, message: "<script>untrusted provider message</script>" } }), { status, headers: { "Content-Type": "application/json", "Retry-After": "86400" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(request(url, options)).rejects.toMatchObject({ code, message: expect.stringContaining(message), retryAfter: 86400 });
  expect(fetch).toHaveBeenCalledOnce();
});

it("keeps an unknown or oversized error response generic", async () => {
  for (const body of ['{"error":{"code":"toString","message":"Do this instead"}}', JSON.stringify({ text: "x".repeat(9000) })]) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 502, headers: { "Content-Type": "application/json" } })));
    await expect(request(url, options)).rejects.toMatchObject({ code: "HTTP", message: expect.stringContaining("502") });
  }
});

it("localizes a rate limit even when the upstream returned HTML", async () => {
  setLocale("en");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<h1>Daily limit</h1>", { status: 429, headers: { "Content-Type": "text/html" } })));
  await expect(request(url, options)).rejects.toMatchObject({ code: "SOURCE_BUSY", message: "The source asks you to wait. Try again later." });
});

it("rejects a redirected error before reading its body", async () => {
  const response = new Response('{"error":{"code":"SOURCE_DAILY_LIMIT"}}', { status: 429, headers: { "Content-Type": "application/json" } });
  Object.defineProperty(response, "url", { value: "https://untrusted.example/" });
  vi.stubGlobal("fetch", vi.fn(async () => response));
  await expect(request(url, options)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});
