const STRUCTURAL_LABEL = String.raw`(?:bob|bo['’‘ʻʼ]?lim|chapter|section|глава|раздел)`;
const ORDINAL = String.raw`(?:\d+(?:\.\d+)*|[ivxlcdm]+|birinchi|ikkinchi|uchinchi|to['’‘ʻʼ]?rtinchi|beshinchi|oltinchi|yettinchi|sakkizinchi|to['’‘ʻʼ]?qqizinchi|o['’‘ʻʼ]?ninchi)`;

/**
 * Remove structural labels accidentally emitted as part of a title, e.g.
 * "1-bob: Tahlil", "Bob 1 — Tahlil", or "2.1-bo'lim Nazariy asoslar".
 * Plain numbering is preserved by default because section headings use it.
 */
function normalizeHeadingTitle(value, { stripNumbering = false } = {}) {
  let title = String(value || "").replace(/^\s*[•*–—-]+\s*/, "").trim();
  const labelPrefix = new RegExp(
    String.raw`^(?:${ORDINAL}\s*[-.)]?\s*)?${STRUCTURAL_LABEL}(?:\s*(?:№\s*)?${ORDINAL})?\s*[:.)\-–—]*\s*`,
    "i",
  );

  for (let i = 0; i < 6; i++) {
    const before = title;
    title = title.replace(labelPrefix, "").trim();
    if (stripNumbering) {
      title = title.replace(/^\s*(?:\d+(?:\.\d+)*(?:[.)])?|[ivxlcdm]+[.)]?)\s+/, "").trim();
    }
    if (title === before) break;
  }

  return title.replace(/\s+/g, " ").replace(/^[.:;–—-]+\s*/, "").trim();
}

module.exports = { normalizeHeadingTitle };
