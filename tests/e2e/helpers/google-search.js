export const GOOGLE_SEARCH_SCRIPT = /^https:\/\/cse\.google\.com\/cse\.js\?/u;

/** Deterministic mock of the documented Search Element. No private transport,
 * real Google request, or catalogue snapshot is involved. */
export function googleSearchSdk({ resultsByQuery = {}, defaultResults = [], manual = false } = {}) {
  function sdk(settings) {
    const controls = new Map();
    const pending = [];
    const state = window.__googleSearchFixture = {
      renders: [], queries: [], completed: [],
      flush() { for (const task of pending.splice(0)) task(); },
    };
    const callbacks = () => window.__gcse?.searchCallbacks?.web || {};
    window.google = { search: { cse: { element: {
      render(configuration) {
        state.renders.push({ name: configuration.gname, tag: configuration.tag, attributes: configuration.attributes });
        const host = document.getElementById(configuration.div);
        const container = document.createElement("div");
        container.className = "gsc-control-cse";
        container.dataset.googleInstance = configuration.gname;
        const advertisement = document.createElement("aside");
        advertisement.className = "gsc-adBlock";
        advertisement.dataset.googleAdvertisement = "";
        advertisement.textContent = "Annonce de test — conservée par le composant Google";
        const resultArea = document.createElement("div");
        resultArea.className = "gsc-results";
        const footer = document.createElement("footer");
        footer.className = "gcsc-find-more-on-google";
        const attribution = document.createElement("a");
        attribution.href = "https://www.google.com/";
        attribution.target = "_blank";
        attribution.textContent = "Enhanced by Google";
        const next = document.createElement("button");
        next.type = "button";
        next.textContent = "Page Google 2";
        footer.append(attribution, next);
        container.append(advertisement, resultArea, footer);
        host.append(container);
        let currentQuery = "";
        const execute = (query) => {
          currentQuery = query;
          state.queries.push(query);
          callbacks().starting?.(configuration.gname, query);
          const complete = () => {
            const entries = settings.resultsByQuery[query.toLowerCase()] || settings.defaultResults;
            const results = entries.map((entry) => {
              const result = document.createElement("div");
              result.className = "gsc-webResult gsc-result";
              const link = document.createElement("a");
              link.className = "gs-title";
              link.href = entry.url;
              link.target = "_blank";
              link.rel = "noopener";
              link.textContent = entry.title;
              const snippet = document.createElement("p");
              snippet.className = "gs-snippet";
              snippet.textContent = "Extrait simulé pour la vérification du lecteur.";
              result.append(link, snippet);
              return result;
            });
            if (results.length) resultArea.replaceChildren(...results);
            else {
              const empty = document.createElement("p");
              empty.className = "gs-no-results-result";
              empty.textContent = "Aucun résultat Google simulé";
              resultArea.replaceChildren(empty);
            }
            state.completed.push(query);
            callbacks().rendered?.(configuration.gname, query, [], results);
          };
          if (settings.manual) pending.push(complete);
          else queueMicrotask(complete);
        };
        next.addEventListener("click", () => execute(currentQuery));
        controls.set(configuration.gname, { execute, clearAllResults() { resultArea.replaceChildren(); } });
      },
      getElement(name) { return controls.get(name); },
    } } } };
    queueMicrotask(() => window.__gcse?.initializationCallback?.());
  }
  return `(${sdk.toString()})(${JSON.stringify({ resultsByQuery, defaultResults, manual })});`;
}

export async function installGoogleSearchFixture(page, options = {}) {
  const counts = { sdkRequests: 0 };
  const body = googleSearchSdk(options);
  await page.route(GOOGLE_SEARCH_SCRIPT, (route) => {
    counts.sdkRequests++;
    return route.fulfill({ contentType: "application/javascript", body });
  });
  return counts;
}
