// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n.js";
import { createBackupController } from "../src/backup-ui.js";
import { restoreBackup } from "../src/backup.js";

vi.mock("../src/backup.js", () => ({ exportBackup: vi.fn(), restoreBackup: vi.fn() }));
vi.mock("../src/storage.js", () => ({
  getStorageStatus: vi.fn(async () => ({ usage: 1.5 * 1024 ** 2, quota: 250 * 1024 ** 2, persistent: false, canPersist: true })),
  requestPersistentStorage: vi.fn(async () => true),
}));

let controller;
const restored = { added: 2, existing: 1, annotationsAdded: 4, bookmarksAdded: 3 };
beforeEach(() => {
  setLocale("fr");
  vi.mocked(restoreBackup).mockResolvedValue(restored);
  // JSDOM does not implement the native dialog API. Browser tests separately
  // cover modal focus containment; here we verify preserved DOM controls.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
});
afterEach(() => {
  controller?.destroy();
  delete HTMLDialogElement.prototype.showModal;
  setLocale("fr"); document.body.innerHTML = ""; vi.clearAllMocks();
});

function chooseBackup() {
  const file = new File(["backup fixture"], "backup.zip", { type: "application/zip" });
  const input = document.querySelector("#backup-file");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change"));
  document.querySelector("#backup-settings").checked = true;
  return { file, input };
}

it("relabels the open dialog and result when restored preferences change language", async () => {
  controller = createBackupController({ afterRestore: async () => {
    setLocale("de");
    window.dispatchEvent(new Event("languagechange"));
  } });
  await controller.open();
  const dialog = document.querySelector(".backup-dialog");
  const { file, input } = chooseBackup();
  const checkbox = document.querySelector("#backup-settings");
  const restore = document.querySelector("#backup-restore");
  await restore.onclick();

  expect(restoreBackup).toHaveBeenCalledWith(file, expect.objectContaining({ restorePreferences: true }));
  expect(document.querySelector(".backup-dialog")).toBe(dialog);
  expect(document.querySelector("#backup-file")).toBe(input);
  expect(document.querySelector("#backup-settings")).toBe(checkbox);
  expect(checkbox.checked).toBe(true);
  expect(dialog.getAttribute("aria-busy")).toBe("false");
  expect(document.querySelector("#backup-title").textContent).toBe("Sicherung");
  expect(document.querySelector("#backup-status").textContent).toContain("Hinzugefügte Bücher: 2; bereits vorhanden: 1");
  expect(document.querySelector("#backup-storage").textContent).toContain("1,5 MB");

  // A later change preserves the focused control and reuses raw result counts.
  const close = document.querySelector("#backup-close");
  close.focus();
  setLocale("en");
  window.dispatchEvent(new Event("languagechange"));
  expect(document.activeElement).toBe(close);
  expect(close.getAttribute("aria-label")).toBe("Close backup");
  expect(document.querySelector("#backup-status").textContent).toContain("Books added: 2; already present: 1");
  expect(document.querySelector("#backup-storage").textContent).toContain("1.5 MB");
});

it("keeps the selected file, busy guard and failure status through a language change", async () => {
  let finish;
  vi.mocked(restoreBackup).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  controller = createBackupController();
  await controller.open();
  const { input, file } = chooseBackup();
  const dialog = document.querySelector(".backup-dialog");
  const restore = document.querySelector("#backup-restore");
  const pending = restore.onclick();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  setLocale("es");
  window.dispatchEvent(new Event("languagechange"));

  expect(document.querySelector("#backup-file")).toBe(input);
  expect(input.files[0]).toBe(file);
  expect(restore.disabled).toBe(true);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector("#backup-status").textContent).toBe("Comprobando tu copia de seguridad…");
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(document.querySelector(".backup-dialog")).toBe(dialog);
  finish(restored);
  await pending;

  vi.mocked(restoreBackup).mockRejectedValue({ name: "QuotaExceededError" });
  await restore.onclick();
  expect(document.querySelector("#backup-status").dataset.error).toBe("true");
  setLocale("it");
  window.dispatchEvent(new Event("languagechange"));
  expect(document.querySelector("#backup-status").dataset.error).toBe("true");
  expect(document.querySelector("#backup-status").textContent).toContain("Lo spazio di archiviazione è pieno.");
  expect(dialog.getAttribute("aria-busy")).toBe("false");
});
