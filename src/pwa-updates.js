import { t } from "./i18n.js";
/** Offer updates explicitly. Never replace the reader until its state is saved. */
export async function registerReaderServiceWorker({ url, beforeUpdate, onError, reload = () => location.reload() }) {
  let pendingReload = false;
  let banner;
  window.addEventListener("languagechange", () => {
    if (!banner?.isConnected) return;
    banner.setAttribute("aria-label", t("Mise à jour de l’application"));
    banner.querySelector('[role="status"]').textContent = t("Une nouvelle version est disponible.");
    banner.querySelector(".button").textContent = t("Mettre à jour");
    banner.querySelector(".round-button").setAttribute("aria-label", t("Rappeler à la prochaine ouverture"));
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (pendingReload) reload();
  });
  const registration = await navigator.serviceWorker.register(url);
  function offerUpdate() {
    if (!registration.waiting || !navigator.serviceWorker.controller || banner?.isConnected) return;
    banner = document.createElement("aside");
    banner.className = "pwa-update";
    banner.setAttribute("aria-label", t("Mise à jour de l’application"));
    banner.innerHTML = `<span role="status">${t("Une nouvelle version est disponible.")}</span><button class="button ink">${t("Mettre à jour")}</button><button class="round-button" aria-label="${t("Rappeler à la prochaine ouverture")}">×</button>`;
    document.body.append(banner);
    banner.querySelector(".round-button").onclick = () => banner.remove();
    banner.querySelector(".button").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await beforeUpdate();
        if (!registration.waiting) throw new Error(t("La mise à jour n’est plus disponible. Réessayez à la prochaine ouverture."));
        pendingReload = true;
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      } catch (error) {
        pendingReload = false;
        button.disabled = false;
        onError(error.message || t("Votre lecture n’a pas pu être sauvegardée. La mise à jour attendra."));
      }
    };
  }
  offerUpdate();
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offerUpdate();
    });
  });
  return registration;
}
