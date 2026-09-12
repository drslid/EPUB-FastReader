import { t } from "./i18n.js";
import standardEbooks from "./sources/standard-ebooks.js";
import { configuredSourceRelay, relayAvailable } from "./sources/relay-config.js";

let cachedStatus;
const CACHE_TTL = 5 * 60_000;

/** Checks catalogue access without downloading books or accessing personal data. */
export async function checkSourceAvailability({ signal, onUpdate = () => {}, force = false } = {}) {
  signal?.throwIfAborted();
  if (!force && cachedStatus && Date.now() - cachedStatus.checkedAt < CACHE_TTL) {
    const sources = structuredClone(cachedStatus.sources);
    onUpdate(sources);
    return structuredClone(sources);
  }
  const sources = {
    selection: { status: "available" },
    gutenberg: { status: "checking" },
    "standard-ebooks": { status: "checking" },
    "ebooks-gratuits": { status: "checking" },
    "z-library": { status: "unavailable", reason: "L’accès automatisé à la recherche et aux EPUB n’a pas pu être vérifié." },
  };
  const publish = () => { if (!signal?.aborted) onUpdate(structuredClone(sources)); };
  publish();
  await Promise.allSettled([
    (async () => {
      try {
        await standardEbooks.search({ query: "Frankenstein", language: "en", page: 1, signal });
        sources["standard-ebooks"] = { status: "available" };
      } catch { sources["standard-ebooks"] = { status: "unavailable" }; }
      publish();
    })(),
    (async () => {
      try {
        if (!relayAvailable()) throw new Error("relay");
        const relay = configuredSourceRelay();
        const response = await fetch(`${relay ? `${relay}/` : import.meta.env.BASE_URL}api/sources/status`, {
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(65_000)]),
          credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        });
        if (!response.ok) throw new Error("status");
        const result = await response.json();
        const entries = Array.isArray(result.sources) ? result.sources : [];
        for (const id of ["gutenberg", "ebooks-gratuits"]) {
          const entry = entries.find((source) => source?.providerId === id);
          sources[id] = { status: entry?.available === true ? "available" : "unavailable" };
        }
      } catch {
        for (const id of ["gutenberg", "ebooks-gratuits"]) sources[id] = { status: "unavailable" };
      }
      publish();
    })(),
  ]);
  signal?.throwIfAborted();
  cachedStatus = { checkedAt: Date.now(), sources: structuredClone(sources) };
  return sources;
}

export function openSourceSettings({ icon, escape, beforeOpen = () => {} }) {
  if (document.querySelector(".source-settings-dialog")) return;
  beforeOpen();
  const controller = new AbortController();
  const returnFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "source-settings-dialog";
  dialog.setAttribute("aria-labelledby", "source-settings-title");
  const definitions = [
    ["selection", "Sélection FastReader", "", "Livres intégrés"],
    ["gutenberg", "Project Gutenberg", "https://www.gutenberg.org/", "Catalogue multilingue"],
    ["standard-ebooks", "Standard Ebooks", "https://standardebooks.org/ebooks", "Livres en anglais"],
    ["ebooks-gratuits", "Ebooks libres et gratuits", "https://www.ebooksgratuits.com/ebooks.php", "Livres en français"],
    ["z-library", "Z-Library", "https://z-library.sk/", "Accès direct non intégré"],
  ];
  const copy = (source) => `<span data-copy="${escape(source)}">${escape(t(source))}</span>`;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="source-settings-title">${copy("Paramètres")}</h2><button class="round-button" data-close aria-label="${escape(t("Fermer"))}">${icon("close")}</button></div><h3>${copy("Sources de livres")}</h3><p>${copy("La pastille indique si la source est accessible depuis FastReader. La disponibilité d’un livre peut varier.")}</p><ul class="source-status-list" aria-label="${escape(t("Disponibilité des sources"))}">${definitions.map(([id, name, url]) => `<li data-source="${id}"><span class="source-status-dot is-checking" aria-hidden="true"></span><div>${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer"><span>${escape(name)}</span> ${icon("external")}</a>` : `<strong>${copy(name)}</strong>`}<small data-detail></small></div><span class="source-status-label"></span></li>`).join("")}</ul><p class="source-checked" role="status"></p><button class="button secondary" data-check>${icon("compass")} ${copy("Vérifier à nouveau")}</button><p class="source-privacy">${copy("Vos livres, notes et repères restent sur cet appareil. Les recherches externes sont transmises aux catalogues concernés et, si nécessaire, à notre service de connexion.")}</p><p class="rights-note">${copy("Les droits varient selon votre pays. Téléchargez uniquement des livres du domaine public ou pour lesquels vous avez l’autorisation requise.")}</p><p class="source-external"><a href="https://open-slum.org/" target="_blank" rel="noopener noreferrer">Open SLUM ${icon("external")}</a><span>${copy("Annuaire externe de disponibilité de bibliothèques. Vérifiez les droits de chaque fichier avant de l’importer.")}</span></p>`;
  let currentSources = {};
  let checking = false;
  const render = (sources = currentSources) => {
    if (!dialog.isConnected) return;
    currentSources = sources;
    for (const [id, , , detail] of definitions) {
      const source = sources[id] || { status: "checking" };
      const row = dialog.querySelector(`[data-source="${id}"]`);
      const label = source.status === "available" ? "Disponible" : source.status === "checking" ? "Vérification…" : "Indisponible";
      row.querySelector(".source-status-dot").className = `source-status-dot is-${source.status}`;
      row.querySelector(".source-status-label").textContent = t(label);
      row.querySelector("[data-detail]").textContent = t(source.reason || detail);
    }
    dialog.querySelector(".source-status-list").setAttribute("aria-busy", String(checking));
    dialog.querySelector(".source-checked").textContent = t(checking ? "Vérification des sources…" : "Vérification terminée. Aucun EPUB n’a été téléchargé.");
  };
  const localize = () => {
    for (const node of dialog.querySelectorAll("[data-copy]")) node.textContent = t(node.dataset.copy);
    dialog.querySelector("[data-close]").setAttribute("aria-label", t("Fermer"));
    dialog.querySelector(".source-status-list").setAttribute("aria-label", t("Disponibilité des sources"));
    render();
  };
  const check = async (force = false) => {
    if (checking || controller.signal.aborted) return;
    const button = dialog.querySelector("[data-check]");
    checking = true;
    button.disabled = true;
    render();
    try {
      await checkSourceAvailability({ signal: controller.signal, onUpdate: render, force });
    } catch { /* Closing the dialog cancels its requests. */ }
    finally {
      checking = false;
      if (dialog.isConnected) { button.disabled = false; render(); }
    }
  };
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.querySelector("[data-check]").onclick = () => void check(true);
  dialog.addEventListener("close", () => {
    controller.abort();
    window.removeEventListener("languagechange", localize);
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog);
  window.addEventListener("languagechange", localize);
  dialog.showModal();
  void check();
}
