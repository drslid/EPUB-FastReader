import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: vi.fn(), relayAvailable: vi.fn(), configuredSourceRelay: vi.fn() }));
vi.mock("../src/sources/standard-ebooks.js", () => ({ default: { search: mocks.search } }));
vi.mock("../src/sources/relay-config.js", () => ({ relayAvailable: mocks.relayAvailable, configuredSourceRelay: mocks.configuredSourceRelay }));
let settings;
let fetchMock;
const response = (sources = [{ providerId: "gutenberg", available: true }, { providerId: "ebooks-gratuits", available: true }]) => ({ ok: true, json: async () => ({ sources }) });
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

beforeEach(async () => {
  vi.resetModules();
  mocks.search.mockReset().mockResolvedValue({ books: [], count: 0 });
  mocks.relayAvailable.mockReset().mockReturnValue(true);
  mocks.configuredSourceRelay.mockReset().mockReturnValue("");
  fetchMock = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
  settings = await import("../src/source-settings.js");
});
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("source availability", () => {
  it("publishes quick source results while the relay is pending, then reads its actual array contract", async () => {
    let finish;
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const updates = [];
    const pending = settings.checkSourceAvailability({ onUpdate: (sources) => updates.push(sources) });
    await vi.waitFor(() => expect(updates.some((sources) => sources["standard-ebooks"].status === "available")).toBe(true));
    expect(updates.at(-1).gutenberg.status).toBe("checking");
    finish(response([{ providerId: "gutenberg", available: true }, { providerId: "ebooks-gratuits", available: false }]));
    const result = await pending;
    expect(result.gutenberg.status).toBe("available");
    expect(result["ebooks-gratuits"].status).toBe("unavailable");
    expect(result["z-library"].status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledWith("/api/sources/status", expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" }));
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ language: "en", query: "Frankenstein" }));
  });

  it("reuses a private cache for five minutes and allows an explicit recheck", async () => {
    const first = await settings.checkSourceAvailability();
    first.gutenberg.status = "unavailable";
    expect((await settings.checkSourceAvailability()).gutenberg.status).toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(response([{ providerId: "gutenberg", available: false }]));
    expect((await settings.checkSourceAvailability({ force: true })).gutenberg.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 301_000);
    await settings.checkSourceAvailability();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("marks failing sources unavailable without hiding included books", async () => {
    mocks.search.mockRejectedValue(new Error("CORS"));
    fetchMock.mockRejectedValue(new Error("Offline"));
    const sources = await settings.checkSourceAvailability();
    expect(sources.selection.status).toBe("available");
    for (const id of ["standard-ebooks", "gutenberg", "ebooks-gratuits", "z-library"]) expect(sources[id].status).toBe("unavailable");
  });

  it("does not request a nonexistent API on Pages without a configured relay", async () => {
    mocks.relayAvailable.mockReturnValue(false);
    const sources = await settings.checkSourceAvailability();
    expect(sources["standard-ebooks"].status).toBe("available");
    expect(sources["ebooks-gratuits"].status).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only a deployment-configured relay and requires a strict availability boolean", async () => {
    mocks.configuredSourceRelay.mockReturnValue("https://relay.example/reader");
    fetchMock.mockResolvedValue(response([{ providerId: "gutenberg", available: "true" }, { providerId: "ebooks-gratuits", available: true }]));
    const sources = await settings.checkSourceAvailability();
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example/reader/api/sources/status");
    expect(sources.gutenberg.status).toBe("unavailable");
    expect(sources["ebooks-gratuits"].status).toBe("available");
  });

  it("cancels requests, avoids publishing or caching an aborted result, and ignores no aborted cache reads", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const onUpdate = vi.fn();
    const pending = settings.checkSourceAvailability({ signal: controller.signal, onUpdate });
    controller.abort();
    const updates = onUpdate.mock.calls.length;
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(onUpdate).toHaveBeenCalledTimes(updates);
    await settings.checkSourceAvailability();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(settings.checkSourceAvailability({ signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it("relabels the open dialog in six languages without replacing focused source links", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.dispatchEvent(new Event("close")); } });
  const { setLocale } = await import("../src/i18n.js");
  document.body.innerHTML = '<button id="trigger">Settings</button>';
  const trigger = document.getElementById("trigger"); trigger.focus();
  settings.openSourceSettings({ icon: () => "", escape });
  await vi.waitFor(() => expect(document.querySelector("[data-check]").disabled).toBe(false));
  const link = document.querySelector('[data-source="gutenberg"] a');
  link.focus();
  for (const [language, title, available] of [["en", "Settings", "Available"], ["es", "Ajustes", "Disponible"], ["it", "Impostazioni", "Disponibile"], ["de", "Einstellungen", "Verfügbar"], ["pt", "Definições", "Disponível"], ["fr", "Paramètres", "Disponible"]]) {
    setLocale(language); window.dispatchEvent(new Event("languagechange"));
    expect(document.getElementById("source-settings-title").textContent).toBe(title);
    expect(document.querySelector('[data-source="gutenberg"] .source-status-label').textContent).toBe(available);
    expect(document.querySelector('[data-source="gutenberg"] a')).toBe(link);
    expect(document.activeElement).toBe(link);
  }
  document.querySelector("[data-close]").click();
  expect(document.querySelector(".source-settings-dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  delete HTMLDialogElement.prototype.showModal;
  delete HTMLDialogElement.prototype.close;
});
