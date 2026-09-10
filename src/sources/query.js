export function normalizeCatalogQuery(value) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
