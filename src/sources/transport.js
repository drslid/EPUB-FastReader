export const EPUB_TYPE = "application/epub+zip";
export const MAX_BOOK_BYTES = 30 * 1024 * 1024;
export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

export function catalogError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), {
    code,
  });
}

export function plainText(value, maxLength = 300) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength)
    : "";
}

async function cancelBody(body) {
  try {
    await body?.cancel();
  } catch {
    /* The body may already be closed or aborted. */
  }
}

async function readLimited(response, maxBytes, signal) {
  const limitError = () =>
    catalogError(
      "TOO_LARGE",
      maxBytes === MAX_BOOK_BYTES
        ? "Ce livre dépasse la limite de 30 Mio. Téléchargez-le depuis sa fiche source."
        : "La réponse du catalogue est trop volumineuse.",
    );
  const advertisedSize = Number(response.headers.get("content-length"));
  if (advertisedSize > maxBytes) {
    await cancelBody(response.body);
    throw limitError();
  }
  // Streaming enforces the limit even when Content-Length is absent or incorrect.
  if (!response.body?.getReader) {
    throw catalogError(
      "INVALID_RESPONSE",
      "Votre navigateur ne permet pas ce téléchargement. Ouvrez la fiche source et importez son EPUB.",
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw limitError();
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* Preserve the original error. */
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
}

export async function request(
  url,
  { signal, timeout, maxBytes, download = false, validateUrl },
) {
  if (signal?.aborted) throw new DOMException("Requête annulée.", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: download ? EPUB_TYPE : "application/json" },
    });
    if (!response.ok) {
      await cancelBody(response.body);
      throw catalogError(
        "HTTP",
        `La source est indisponible (HTTP ${response.status}). Réessayez plus tard ou ouvrez son site.`,
      );
    }
    if (response.url && !validateUrl(response.url)) {
      await cancelBody(response.body);
      throw catalogError(
        "INVALID_RESPONSE",
        "La source a redirigé vers une adresse non autorisée. Ouvrez sa fiche pour continuer.",
      );
    }
    return await readLimited(response, maxBytes, controller.signal);
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Requête annulée.", "AbortError");
    if (timedOut)
      throw catalogError(
        "TIMEOUT",
        "La source met trop de temps à répondre. Réessayez ou ouvrez sa fiche.",
        error,
      );
    if (error?.code || error?.name === "AbortError") throw error;
    throw catalogError(
      "NETWORK",
      download
        ? "Téléchargement inaccessible : connexion interrompue ou accès bloqué par le navigateur (CORS). Ouvrez la fiche source, téléchargez l’EPUB puis importez-le ici."
        : "Le catalogue est inaccessible. Vérifiez votre connexion ou réessayez plus tard.",
      error,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
