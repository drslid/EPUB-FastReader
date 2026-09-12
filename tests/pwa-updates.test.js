// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerReaderServiceWorker } from "../src/pwa-updates.js";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

function setup({ waiting = true, controller = true } = {}) {
  const registration = new EventTarget();
  registration.waiting = waiting ? { postMessage: vi.fn() } : null;
  const serviceWorker = new EventTarget();
  serviceWorker.controller = controller ? {} : null;
  serviceWorker.register = vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  return { registration, serviceWorker };
}

describe("mise à jour PWA explicite", () => {
  it("attend la sauvegarde avant SKIP_WAITING et recharge seulement après activation", async () => {
    const { registration, serviceWorker } = setup();
    let finish;
    const beforeUpdate = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const reload = vi.fn();
    await registerReaderServiceWorker({ url: "./sw.js", beforeUpdate, onError: vi.fn(), reload });
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    const button = document.querySelector(".pwa-update .button");
    const click = button.onclick({ currentTarget: button });
    expect(button.disabled).toBe(true);
    expect(registration.waiting.postMessage).not.toHaveBeenCalled();
    finish(); await click;
    expect(registration.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledOnce();
  });
  it("garde la version courante si l’enregistrement échoue", async () => {
    const { registration, serviceWorker } = setup();
    const onError = vi.fn(), reload = vi.fn();
    await registerReaderServiceWorker({ url: "./sw.js", beforeUpdate: async () => { throw new Error("Stockage plein"); }, onError, reload });
    const button = document.querySelector(".pwa-update .button");
    await button.onclick({ currentTarget: button });
    expect(onError).toHaveBeenCalledWith("Stockage plein");
    expect(button.disabled).toBe(false);
    expect(registration.waiting.postMessage).not.toHaveBeenCalled();
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });
  it("propose une mise à jour téléchargée ensuite, mais aucun bandeau à la première installation", async () => {
    const first = setup({ controller: false });
    await registerReaderServiceWorker({ url: "./sw.js", beforeUpdate: vi.fn(), onError: vi.fn() });
    expect(document.querySelector(".pwa-update")).toBeNull();
    const { registration } = setup({ waiting: false });
    await registerReaderServiceWorker({ url: "./sw.js", beforeUpdate: vi.fn(), onError: vi.fn() });
    registration.installing = new EventTarget();
    registration.dispatchEvent(new Event("updatefound"));
    registration.waiting = first.registration.waiting;
    registration.installing.state = "installed";
    registration.installing.dispatchEvent(new Event("statechange"));
    expect(document.querySelector(".pwa-update")).not.toBeNull();
    document.querySelector(".pwa-update .round-button").click();
    expect(document.querySelector(".pwa-update")).toBeNull();
    expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  });
});
