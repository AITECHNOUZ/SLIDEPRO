// src/mustaqil/reference-verify.js
// Adabiyotlarni Crossref (api.crossref.org) orqali tekshirish:
//   • yozuvda DOI bo'lsa — DOI haqiqatan mavjudligi va sarlavhaga mosligi tekshiriladi;
//     mavjud bo'lmasa yoki boshqa asarga tegishli bo'lsa, DOI yozuvdan olib tashlanadi;
//   • DOI bo'lmasa — sarlavha+muallif+yil bo'yicha qidiriladi; aniq mos asar topilsa,
//     uning haqiqiy DOI'si qo'shiladi.
// Crossref'da bo'lmagan asarlar (ko'p rus/o'zbek kitoblari) o'zgarishsiz qoladi.
// Tarmoq xatosi bo'lsa — hech narsa o'zgartirilmaydi (buyurtma to'xtamaydi).

const { parseApaReference } = require("./references");

const CROSSREF = "https://api.crossref.org";
const TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 45000;
const CONCURRENCY = 4;

function referenceVerificationEnabled() {
  const flag = String(process.env.SLIDEPRO_VERIFY_REFS || "").toLowerCase();
  if (["0", "false", "off", "no"].includes(flag)) return false;
  if (["1", "true", "on", "yes"].includes(flag)) return true;
  return process.env.NODE_ENV === "production";
}

function normalizeTitle(text) {
  return String(text || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Sorensen–Dice o'xshashligi (so'z bigrammalari emas, so'zlar to'plami bo'yicha)
function titleSimilarity(left, right) {
  const a = new Set(normalizeTitle(left).split(" ").filter(word => word.length > 2));
  const b = new Set(normalizeTitle(right).split(" ").filter(word => word.length > 2));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return (2 * common) / (a.size + b.size);
}

// Qisqa sarlavha uzunining boshlanishi bo'lsa (Crossref'da sarlavha + qo'shimcha sarlavha)
function titleContainment(left, right) {
  const a = new Set(normalizeTitle(left).split(" ").filter(word => word.length > 2));
  const b = new Set(normalizeTitle(right).split(" ").filter(word => word.length > 2));
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < 4) return 0;
  let common = 0;
  for (const word of small) if (big.has(word)) common++;
  return common / small.size;
}

function firstSurname(author) {
  return normalizeTitle(String(author || "").split(/[,&]/)[0]).split(" ")[0] || "";
}

function extractDoi(reference) {
  const match = String(reference).match(/https?:\/\/doi\.org\/(10\.\d{4,9}\/[^\s]+)|\bdoi\s*:\s*(10\.\d{4,9}\/\S+)/i);
  return match ? (match[1] || match[2]).replace(/[),.;]+$/, "") : null;
}

function stripDoi(reference) {
  return String(reference)
    .replace(/\s*https?:\/\/doi\.org\/10\.\d{4,9}\/[^\s]+/gi, "")
    .replace(/\s*\bdoi\s*:\s*10\.\d{4,9}\/\S+/gi, "")
    .replace(/\s+$/, "")
    .replace(/([^.])$/, "$1.");
}

function appendDoi(reference, doi) {
  const base = String(reference).trim().replace(/\s+$/, "");
  return `${/[.]$/.test(base) ? base : `${base}.`} https://doi.org/${doi}`;
}

async function getJson(url, fetchImpl, signal) {
  const mailto = process.env.CROSSREF_MAILTO ? ` (mailto:${process.env.CROSSREF_MAILTO})` : "";
  const response = await fetchImpl(url, {
    headers: { "user-agent": `SLIDEPRO-bot/1.0${mailto}`, accept: "application/json" },
    signal,
  });
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
  return response.json();
}

function workTitle(work) {
  return Array.isArray(work?.title) ? work.title[0] : work?.title || "";
}

function workYear(work) {
  const parts = work?.issued?.["date-parts"]?.[0] || work?.published?.["date-parts"]?.[0];
  return Array.isArray(parts) ? Number(parts[0]) : null;
}

function workSurnames(work) {
  return (work?.author || []).map(author => normalizeTitle(author.family || author.name || "").split(" ").pop()).filter(Boolean);
}

function isSameWork(parsed, work, { strict }) {
  const title = workTitle(work);
  const similarity = Math.max(titleSimilarity(parsed.title, title), titleContainment(parsed.title, title) >= 0.95 ? 0.85 : 0);
  const year = Number(String(parsed.date).slice(0, 4));
  const crossYear = workYear(work);
  const yearOk = !crossYear || !year || Math.abs(crossYear - year) <= (strict ? 1 : 3);
  const surname = firstSurname(parsed.author);
  const surnames = workSurnames(work);
  const authorOk = !surnames.length || !surname || surnames.includes(surname);
  return similarity >= (strict ? 0.8 : 0.6) && yearOk && authorOk;
}

async function verifyOne(reference, fetchImpl, deadline) {
  const parsed = parseApaReference(reference);
  if (!parsed) return { reference, status: "skipped" };
  const remaining = deadline - Date.now();
  if (remaining <= 500) return { reference, status: "skipped" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(TIMEOUT_MS, remaining));
  try {
    const doi = extractDoi(reference);
    if (doi) {
      const data = await getJson(`${CROSSREF}/works/${encodeURIComponent(doi)}`, fetchImpl, controller.signal);
      if (data.notFound || !isSameWork(parsed, data.message, { strict: false })) {
        return { reference: stripDoi(reference), status: "doi-removed" };
      }
      return { reference, status: "confirmed" };
    }
    // Faqat lotin yozuvli sarlavhalar Crossref'da yaxshi topiladi
    if (!/[A-Za-z]{3,}/.test(parsed.title) || /\p{Script=Cyrillic}/u.test(parsed.title)) {
      return { reference, status: "not-indexed" };
    }
    const query = encodeURIComponent(`${parsed.title} ${parsed.author} ${parsed.date}`.slice(0, 300));
    const data = await getJson(`${CROSSREF}/works?rows=3&select=DOI,title,issued,author&query.bibliographic=${query}`, fetchImpl, controller.signal);
    const match = (data?.message?.items || []).find(work => isSameWork(parsed, work, { strict: true }));
    if (match?.DOI) return { reference: appendDoi(reference, match.DOI), status: "doi-added" };
    return { reference, status: "not-found" };
  } catch (error) {
    return { reference, status: "error", error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string[]} references
 * @param {{fetchImpl?: Function}} [options]
 * @returns {Promise<{references: string[], results: object[], stats: object}>}
 */
async function verifyReferences(references, { fetchImpl } = {}) {
  const fetchFn = fetchImpl || ((...args) => fetch(...args));
  const list = Array.isArray(references) ? references : [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await verifyOne(list[index], fetchFn, deadline);
    }
  });
  await Promise.all(workers);
  const count = status => results.filter(result => result?.status === status).length;
  return {
    references: results.map((result, index) => result?.reference || list[index]),
    results,
    stats: {
      confirmed: count("confirmed") + count("doi-added"),
      doiAdded: count("doi-added"),
      doiRemoved: count("doi-removed"),
      notIndexed: count("not-indexed") + count("not-found"),
      errors: count("error"),
    },
  };
}

module.exports = { verifyReferences, referenceVerificationEnabled, titleSimilarity, stripDoi, extractDoi };
