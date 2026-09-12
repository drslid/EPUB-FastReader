/** Deployment-only configuration: catalogue entries cannot supply relay URLs. */
export function configuredSourceRelay(env = import.meta.env) {
  const value = env?.VITE_SOURCE_RELAY_URL || env?.VITE_GUTENBERG_RELAY_URL;
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    const rawPath = value.replace(/^https:\/\/[^/]+/u, "");
    if (
      url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^https:\/\/[^\s/?#\\]+(?:\/[A-Za-z0-9_.~-]+)*\/?$/u.test(value) ||
      rawPath.split("/").some((segment) => segment === "." || segment === "..")
    ) return "";
    return `${url.origin}${url.pathname.replace(/\/$/u, "")}`;
  } catch { return ""; }
}

export function sourceRelayUrl(relativePath, env = import.meta.env) {
  if (typeof relativePath !== "string" || !/^api\/(?:books|sources)\/[a-z0-9-]+(?:\/[A-Za-z0-9_.~-]+)+(?:\?[^#\\]*)?$/u.test(relativePath) || relativePath.split(/[/?]/u).some((part) => part === "." || part === "..")) {
    throw new TypeError("Le chemin du service de lecture est invalide.");
  }
  const relay = configuredSourceRelay(env);
  return `${relay ? `${relay}/` : env?.BASE_URL || "/"}${relativePath}`;
}

export function relayAvailable(env = import.meta.env) {
  return env?.MODE !== "pages" || Boolean(configuredSourceRelay(env));
}
