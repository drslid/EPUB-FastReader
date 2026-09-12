import { catalogError, plainText, EPUB_TYPE } from "./sources/transport.js";
import { getSource, sourceManifests } from "./sources/registry.js";

export { sourceManifests };

/** Public source metadata; source code is bundled and reviewed at deployment. */
export const providers = Object.freeze(
  sourceManifests.map((manifest) =>
    Object.freeze({
      ...manifest,
      searchable: manifest.capabilities.search,
    }),
  ),
);

/** Count is the provider total; entries with unusable metadata are omitted locally. */
export async function searchBooks({
  query = "",
  language = "",
  page = 1,
  provider = "all",
  signal,
  onUpdate,
} = {}) {
  const adapter = getSource(provider);
  if (!adapter?.manifest.capabilities.search)
    throw catalogError(
      "UNSUPPORTED_PROVIDER",
      "Cette source se consulte sur son site. Téléchargez un EPUB puis importez-le ici.",
    );
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    typeof language !== "string" ||
    (language !== "" && language !== "all" && !/^[a-z]{2}$/.test(language)) ||
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    throw catalogError(
      "INVALID_QUERY",
      "Recherche invalide : utilisez un titre ou un auteur, une langue et un numéro de page positif.",
    );
  }
  const options = {
    query: plainText(query, 200),
    language,
    page,
    signal,
  };
  if (provider === "all") return adapter.search({ ...options, onUpdate });
  signal?.throwIfAborted();
  const publish = (result) => {
    if (!signal?.aborted && typeof onUpdate === "function") onUpdate(result);
  };
  publish({
    books: [], count: 0, countIsApproximate: true, hasNext: false, warnings: [],
    pendingSources: [provider],
    sourceStatuses: { [provider]: { status: "pending", checkedAt: null } },
  });
  try {
    const result = await adapter.search(options);
    signal?.throwIfAborted();
    const complete = {
      ...result, warnings: result.warnings || [], pendingSources: [],
      sourceStatuses: { [provider]: { status: "available", checkedAt: Date.now() } },
    };
    publish(complete);
    return complete;
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.name === "AbortError") throw error;
    publish({
      books: [], count: 0, countIsApproximate: false, hasNext: false,
      warnings: [{ providerId: provider, code: error?.code || "NETWORK", message: error?.message || "" }],
      pendingSources: [],
      sourceStatuses: { [provider]: { status: "unavailable", checkedAt: Date.now(), code: error?.code || "NETWORK", message: error?.message || "" } },
    });
    throw error;
  }
}

/** Keep legacy Gutenberg records usable; new records name their source explicitly. */
export async function downloadBook(book, { signal } = {}) {
  const providerId =
    book?.providerId ||
    (/^gutenberg-\d+$/.test(book?.id || "") ? "gutenberg" : null);
  const source = getSource(providerId);
  if (!source?.manifest.capabilities.download) {
    throw catalogError(
      "INVALID_BOOK",
      "L’adresse de téléchargement de ce livre n’est pas autorisée.",
    );
  }
  const blob = await source.download(book, { signal });
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (
    signature.length !== 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 0x03 ||
    signature[3] !== 0x04
  ) {
    throw catalogError(
      "INVALID_RESPONSE",
      "La source n’a pas renvoyé un fichier EPUB. Téléchargez-le depuis sa fiche source.",
    );
  }
  const name =
    plainText(book.title, 100)
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/, "") || book.id;
  return new File([blob], `${name}.epub`, { type: EPUB_TYPE });
}
