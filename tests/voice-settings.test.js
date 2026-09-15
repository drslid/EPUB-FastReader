// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import JSZip from "jszip";

let storage;

function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  storage = await import("../src/storage.js");
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("voice preferences and backups", () => {
  it("leaves voice optional and does not change the default reading mode", async () => {
    const settings = await storage.readSettings();
    expect(settings).toMatchObject({ mode: "rsvp", voiceId: "", voiceRate: 1 });
    expect(settings).not.toHaveProperty("voiceEnabled");
  });

  it.each(["piper-fr_FR-siwis-medium", "piper-en_US-ljspeech-medium", "piper-es_ES-davefx-medium", "piper-it_IT-paola-medium", "piper-de_DE-thorsten-medium", "piper-pt_BR-faber-medium", "ff_siwis", "af_heart", "ef_dora", "if_sara", "pf_dora"])("persists the supported voice %s and audio mode in IndexedDB", async (voiceId) => {
    const saved = await storage.writeSettings({ ...storage.defaultSettings, mode: "audio", voiceId, voiceRate: 1.25 });
    vi.resetModules();
    const reopened = await import("../src/storage.js");
    expect(await reopened.readSettings()).toEqual(saved);
    expect(saved).toMatchObject({ voiceId, voiceRate: 1.25, mode: "audio" });
    expect(localStorage.getItem("fastreader-settings")).toBeNull();
  });

  it.each([
    [{ voiceId: "de_unknown", voiceRate: 50, mode: "tts" }, { voiceId: "", voiceRate: 1.75, mode: "rsvp" }],
    [{ voiceId: "https://voices.example/custom.bin", voiceRate: -4, mode: "audio" }, { voiceId: "", voiceRate: 0.75, mode: "audio" }],
    [{ voiceId: "ff_siwis", voiceRate: "1.5" }, { voiceId: "ff_siwis", voiceRate: 1.5 }],
    [{ voiceId: ["ff_siwis"], voiceRate: "invalid" }, { voiceId: "", voiceRate: 1 }],
    [{ voiceId: null, voiceRate: null }, { voiceId: "", voiceRate: 1 }],
  ])("validates restored voice settings %j", (input, expected) => {
    expect(storage.normalizeSettings(input)).toMatchObject(expected);
  });

  it("does not persist model bytes, temporary audio, download flags or arbitrary URLs as preferences", async () => {
    await storage.writeSettings({
      ...storage.defaultSettings, voiceId: "ff_siwis", voiceRate: 1.2,
      voiceDownloaded: true, audioUrl: "blob:session-audio", modelUrl: "https://untrusted.example/model.onnx",
      voiceModel: new Uint8Array(64), audioBuffer: new Float32Array(64), voiceCache: { ready: true },
    });
    const preferences = (await storage.readLibrarySnapshot()).preferences;
    const reader = preferences.find(({ id }) => id === "reader");
    expect(reader).toMatchObject({ voiceId: "ff_siwis", voiceRate: 1.2 });
    for (const key of ["voiceDownloaded", "audioUrl", "modelUrl", "voiceModel", "audioBuffer", "voiceCache"]) {
      expect(reader).not.toHaveProperty(key);
    }
  });

  it("round-trips voice preferences through a compact ZIP without reading or exporting the vocal cache", async () => {
    const caches = { open: vi.fn(() => { throw new Error("The vocal cache must not be exported"); }), keys: vi.fn(), delete: vi.fn() };
    vi.stubGlobal("caches", caches);
    const backup = await import("../src/backup.js");
    const settings = await storage.writeSettings({ ...storage.defaultSettings, mode: "audio", voiceId: "piper-it_IT-paola-medium", voiceRate: 1.4 });
    const { blob, bookCount } = await backup.exportBackup();
    expect(bookCount).toBe(0);
    expect(blob.size).toBeLessThan(10000);
    const zip = await JSZip.loadAsync(await readBlob(blob));
    expect(Object.keys(zip.files)).toEqual(["manifest.json"]);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    expect(manifest.preferences.find(({ id }) => id === "reader")).toMatchObject({ voiceId: "piper-it_IT-paola-medium", voiceRate: 1.4, mode: "audio" });
    await storage.writeSettings(storage.defaultSettings);
    await backup.restoreBackup(blob, { restorePreferences: true });
    expect(await storage.readSettings()).toEqual(settings);
    expect(caches.open).not.toHaveBeenCalled();
    expect(caches.keys).not.toHaveBeenCalled();
    expect(caches.delete).not.toHaveBeenCalled();
  });

  it("restores books without changing an existing voice unless preferences restoration is requested", async () => {
    const backup = await import("../src/backup.js");
    await storage.writeSettings({ ...storage.defaultSettings, voiceId: "ff_siwis", voiceRate: 1.25 });
    const { blob } = await backup.exportBackup();
    await storage.writeSettings({ ...storage.defaultSettings, voiceId: "af_heart", voiceRate: 0.9 });
    await backup.restoreBackup(blob);
    expect(await storage.readSettings()).toMatchObject({ voiceId: "af_heart", voiceRate: 0.9 });
  });
});
