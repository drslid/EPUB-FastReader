/** Versioned, build-time contract for first-party source plugins. */
export function defineSource({ manifest, search, download }) {
  if (
    !manifest ||
    !/^[a-z][a-z0-9-]*$/.test(manifest.id) ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    manifest.apiVersion !== 1 ||
    !manifest.name ||
    !manifest.description ||
    !manifest.capabilities ||
    ["search", "download", "bundled"].some(
      (key) => typeof manifest.capabilities[key] !== "boolean",
    ) ||
    (manifest.capabilities.search && typeof search !== "function") ||
    (manifest.capabilities.download && typeof download !== "function")
  ) {
    throw new TypeError("Le plugin source ne respecte pas le contrat v1.");
  }
  for (const field of ["website", "policy"]) {
    const url = new URL(manifest[field]);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new TypeError(`Adresse ${field} invalide pour la source.`);
    }
  }
  return Object.freeze({
    manifest: Object.freeze({
      ...manifest,
      capabilities: Object.freeze({ ...manifest.capabilities }),
    }),
    search,
    download,
  });
}
