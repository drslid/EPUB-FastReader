import { captureCatalogPresentation } from "./covers.js";
import { downloadEpubbooksCover } from "./sources/epubbooks.js";
import { downloadEbookzyCover } from "./sources/ebookzy.js";
import { downloadLoyalbooksCover } from "./sources/loyalbooks.js";

const coverDownloaders = { epubbooks: downloadEpubbooksCover, ebookzy: downloadEbookzyCover, loyalbooks: downloadLoyalbooksCover };

/** Some sources' catalogue artwork differs from the EPUB's embedded cover.
 * Cache that exact image during import; an unavailable image must never stop
 * the book from opening. Other sources embed their catalogue artwork already.
 */
export async function captureOfflinePresentation(book, { signal } = {}) {
  const presentation = captureCatalogPresentation(book);
  const download = coverDownloaders[book.providerId];
  if (!download || !presentation.image) return presentation;
  try {
    const blob = await download(book, { signal });
    signal?.throwIfAborted();
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    signal?.throwIfAborted();
    return { ...presentation, remoteImage: presentation.image, image };
  } catch {
    signal?.throwIfAborted();
    return presentation;
  }
}
