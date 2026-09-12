import { t } from "../i18n.js";
import gutenberg from "./gutenberg.js";
import selection from "./selection.js";
import publicDomainLibrary from "./public-domain-library.js";
import all from "./all.js";

// Explicit imports are the allowlist. A catalog response cannot install code.
const sources = [selection, all, gutenberg, publicDomainLibrary];
const registry = new Map();
for (const source of sources) {
  if (registry.has(source.manifest.id)) {
    throw new TypeError(
      t("Identifiant de source dupliqué : {id}", { id: source.manifest.id }),
    );
  }
  registry.set(source.manifest.id, source);
}

export const sourceManifests = Object.freeze(
  sources.map((source) => source.manifest),
);

export function getSource(id) {
  return registry.get(id);
}
