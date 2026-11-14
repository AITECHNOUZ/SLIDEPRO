const REQUIRED_LANGUAGES = Object.freeze({
  uz: "o'zbek",
  ru: "rus",
  en: "ingliz",
});
const BIBLIOGRAPHY_TARGET = 12;
// Haqiqiy manba yetishmasa ro'yxat qisqaroq bo'ladi — lekin hech qachon uydirma yozuv qo'shilmaydi.
const BIBLIOGRAPHY_MINIMUM = 8;
// Namuna/placeholder DOI'lar (10.0000/..., .../example, slidepro) — soxta deb hisoblanadi.
const PLACEHOLDER_DOI = /10\.0{4,}\/|10\.1234\/(?:example|test|labels|translation|methods)\b|slidepro|\bexample\b/i;
const PLACEHOLDER_AUTHOR = /^(?:Olimov, A\. A\.|Author|Muallif|Автор|Familiya, I\. O\.)$/i;

const UZBEK_TERMS = new Set(`
  o'zbekiston oʻzbekiston o‘zbekiston o'zbek oʻzbek o‘zbek ta'lim таълим iqtisodiyot иқтисодиёт
  rivojlanish ривожланиш tadqiqot тадқиқот davlat давлат boshqaruv бошқарув qo'llanma қўлланма
  fan фан ilmiy илмий o'quv ўқув назарий nazariy амалий amaliy bo'yicha бўйича учун uchun
  асослари asoslari таҳлил tahlil тизими tizimi тарихи tarixi адабиёти adabiyoti машғулот
  методика педагогика ўқитиш ўқитиш халқ республикаси муаммолари ечимлари хусусиятлари
  maktab мактаб darslik дарслик universitet университет ўзбекистон республикаси
`.trim().split(/\s+/));

const RUSSIAN_TERMS = new Set(`
  основы система системы управление образования исследование исследования развитие теория практика
  метод методы анализ проблемы вопросы экономика экономики технологии технология язык литература
  учебник пособие государственный проектирование автоматическое программирование современные научный
  для как при из от над под и на по с в к о об без между
`.trim().split(/\s+/));

const ENGLISH_TERMS = new Set(`
  the of and for in to with on from a an by about system systems control research theory foundations
  engineering analysis education technology technologies methods design development management principles
  introduction model models science learning practice handbook study applications
`.trim().split(/\s+/));

const TRANSLATION_MARKER = /\b(?:translated\s+(?:from|by|into)|translation\s+of|english\s+translation|russian\s+translation|uzbek\s+translation|original\s+work\s+published)\b|таржима(?:си)?|перевод(?:\s+(?:с|на))?/iu;
const JOURNAL_HINT = /\b(?:journal|review|quarterly|proceedings|magazine|jurnal(?:i)?|журнал|вестник|труды)\b/iu;
const APA_REFERENCE = /^\s*(.+?)\s+\((\d{4}[a-z]?)\)\.\s+(.+?)\.\s+(.+?)\s*$/iu;

function parseApaReference(reference) {
  const text = typeof reference === "string" ? reference.trim() : "";
  const match = APA_REFERENCE.exec(text);
  if (!match) return null;
  const author = match[1].trim();
  const date = match[2].trim();
  const title = match[3].trim();
  const publication = match[4].trim().replace(/\s+$/, "");
  if (!author || !/[\p{L}\p{N}]/u.test(author) || title.length < 2 || !/[\p{L}\p{N}]/u.test(publication)) return null;
  return { author, date, title, publication };
}

function apaReferenceProblems(reference) {
  const text = typeof reference === "string" ? reference.trim() : "";
  if (!text) return ["manba yozuvi bo'sh"];
  const parsed = parseApaReference(text);
  if (!parsed) return ["APA 7 ketma-ketligi to'liq emas: muallif, (yil). sarlavha. nashr/nashriyot kerak"];

  const problems = [];
  const year = Number(String(parsed.date).slice(0, 4));
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < 1800 || year > currentYear) problems.push("nashr yili yaroqsiz (kelajakdagi yoki noaniq yil)");
  if (PLACEHOLDER_AUTHOR.test(parsed.author.trim())) problems.push("muallif nomi namunaviy (placeholder)");
  if (JOURNAL_HINT.test(parsed.publication)) {
    const hasVolume = /,\s*\d+(?:\s*\([^)]+\))?/u.test(parsed.publication);
    const hasLocator = /,\s*\d+\s*[-–—]\s*\d+|\barticle\s+[\p{L}\d-]+|\be\d{3,}\b|https?:\/\/doi\.org\//iu.test(parsed.publication);
    if (!hasVolume) problems.push("jurnal maqolasi uchun jild (va mavjud bo'lsa son) ko'rsatilmagan");
    else if (!hasLocator) problems.push("jurnal maqolasi uchun sahifalar, maqola raqami yoki DOI ko'rsatilmagan");
  }
  // DOI ixtiyoriy (ko'p kitoblarda, ayniqsa rus va o'zbek nashrlarida DOI yo'q), lekin bo'lsa — haqiqiy formatda.
  const doiMatch = text.match(/\bdoi\s*:\s*(\S+)|https?:\/\/doi\.org\/([^\s]+)/iu);
  if (doiMatch) {
    const doi = (doiMatch[1] || doiMatch[2] || "").replace(/[),.;]+$/, "");
    if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) problems.push("DOI formati yaroqsiz");
    else if (PLACEHOLDER_DOI.test(doi)) problems.push("DOI namunaviy/soxta (placeholder)");
  }
  const urlMatches = text.match(/https?:\/\/\S+/giu) || [];
  for (const rawUrl of urlMatches) {
    try {
      const url = new URL(rawUrl.replace(/[),.;]+$/, ""));
      if (!url.hostname.includes(".")) problems.push("URL hosti to'liq emas");
    } catch {
      problems.push("URL formati yaroqsiz");
    }
  }
  return problems;
}

function words(text) {
  return String(text || "")
    .toLocaleLowerCase()
    .replace(/[’‘ʻ`´]/g, "'")
    .match(/[\p{L}\p{M}']+/gu) || [];
}

function classifyTitleLanguage(title) {
  const tokens = words(title);
  if (!tokens.length) return null;
  const tokenSet = new Set(tokens);
  const cyrillic = /\p{Script=Cyrillic}/u.test(title);
  const cyrillicTokenCount = tokens.filter(token => /\p{Script=Cyrillic}/u.test(token)).length;
  const latinTokenCount = tokens.length - cyrillicTokenCount;
  const uzbekMatches = tokens.filter(token => UZBEK_TERMS.has(token)).length;
  const russianMatches = tokens.filter(token => RUSSIAN_TERMS.has(token)).length;
  if (cyrillic && russianMatches > 0 && cyrillicTokenCount >= latinTokenCount) return "ru";
  const englishMatches = tokens.filter(token => ENGLISH_TERMS.has(token)).length;
  if (englishMatches > uzbekMatches) return "en";
  if (uzbekMatches > 0) return "uz";
  if (cyrillic) return russianMatches > 0 ? "ru" : null;
  return englishMatches > 0 ? "en" : null;
}

function referenceLanguage(reference) {
  const parsed = parseApaReference(reference);
  if (!parsed || apaReferenceProblems(reference).length || TRANSLATION_MARKER.test(reference)) return null;
  return classifyTitleLanguage(parsed.title);
}

function validateBibliography(references, { minimumCount = BIBLIOGRAPHY_MINIMUM } = {}) {
  const entries = Array.isArray(references) ? references.filter(item => typeof item === "string" && item.trim()) : [];
  const problems = [];
  const validEntries = [];
  const invalidEntries = [];

  if (entries.length < minimumCount) {
    problems.push(`manbalar soni ${entries.length}/${minimumCount}`);
  }

  entries.forEach((entry, index) => {
    const reasons = apaReferenceProblems(entry);
    if (reasons.length) {
      invalidEntries.push({ index, reference: entry, reasons });
    } else {
      validEntries.push(entry.trim());
    }
  });

  const foundLanguages = new Set(validEntries
    .map(reference => referenceLanguage(reference))
    .filter(Boolean));
  const missingLanguages = Object.keys(REQUIRED_LANGUAGES).filter(language => !foundLanguages.has(language));
  if (missingLanguages.length) {
    problems.push(`asl nashr tili aniqlangan manbalar yetishmaydi: ${missingLanguages.map(language => REQUIRED_LANGUAGES[language]).join(", ")}`);
  }
  if (invalidEntries.length) {
    problems.push(`${invalidEntries.length} ta yozuv APA 7 talabiga javob bermaydi yoki namunaviy/soxta`);
  }

  return {
    valid: problems.length === 0,
    count: entries.length,
    completeCount: validEntries.length,
    missingLanguages,
    invalidEntries,
    problems,
  };
}

function selectBestReferences(...lists) {
  const candidates = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const reference = raw.trim();
      const key = reference.toLocaleLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(reference);
    }
  }

  const complete = candidates.filter(reference => apaReferenceProblems(reference).length === 0);
  const selected = [];
  for (const language of Object.keys(REQUIRED_LANGUAGES)) {
    const source = complete.find(reference => referenceLanguage(reference) === language);
    if (source && !selected.includes(source)) selected.push(source);
  }
  for (const reference of complete) {
    if (selected.length >= BIBLIOGRAPHY_TARGET) break;
    if (!selected.includes(reference)) selected.push(reference);
  }
  return selected;
}

/**
 * Yakuniy ro'yxat: faqat to'liq va haqiqiy ko'rinishdagi yozuvlar (uch til ustuvorligi bilan),
 * ko'pi bilan targetCount ta. Yetishmasa — UYDIRMA YOZUV QO'SHILMAYDI, ro'yxat qisqa qoladi.
 */
function completeBibliography(references, { targetCount = BIBLIOGRAPHY_TARGET } = {}) {
  const count = Math.max(0, Math.floor(Number(targetCount) || BIBLIOGRAPHY_TARGET));
  return selectBestReferences(...(Array.isArray(references) ? [references] : [])).slice(0, count);
}

function buildBibliographyRepairPrompt({ topic, language, references, validation, sourceContent }) {
  const suppliedSources = sourceContent
    ? `\n\nFOYDALANUVCHI BERGAN MANBA KONTENTI:\n---\n${String(sourceContent).slice(0, 3000)}\n---\nAgar bu kontentda manbalar ro'yxati bo'lsa, ularni o'zgartirmasdan birinchi o'ringa qo'y.`
    : "";
  return `BIBLIOGRAFIYANI TUZATISH — faqat references maydonini qaytar; boblar, reja, matn, xulosa yoki boshqa mazmunga tegma.
Mavzu: ${topic || "ko'rsatilmagan"}. Ish tili: ${language || "o'zbek"}.
ENG MUHIM TALAB — FAQAT HAQIQIY MANBALAR: har bir yozuv haqiqatan nashr etilgan, aniq bilganing asar bo'lsin (mavzu bo'yicha klassik darsliklar, ko'p iqtibos qilingan monografiyalar va maqolalar, standartlar). Mavjudligiga ishonching komil bo'lmagan asarni YOZMA — o'rniga boshqa, aniq bilgan asaringni yoz. Muallif, sarlavha, yil yoki nashriyotni to'qima.
Soni: ${BIBLIOGRAPHY_TARGET} tagacha (kamida ${BIBLIOGRAPHY_MINIMUM} ta); haqiqiy manba yetmasa, kamroq yoz — soxta yozuv bilan to'ldirma.
Til: imkon qadar o'zbekcha, ruscha va inglizcha manbalar aralash bo'lsin; har bir asar asl tilidagi sarlavhasi bilan yozilsin (tarjima sarlavha emas).
APA 7: Muallif, A. A. (yil). Sarlavha. Nashriyot. — jurnal maqolasi uchun: Jurnal nomi, jild(son), sahifalar. DOI faqat aniq bilsang qo'sh (https://doi.org/10....); taxminiy, namunaviy yoki 10.0000 kabi DOI yozma. Sahifa sonini bilmasang yozma.
Hech qanday AI, sintetik, tekshirish yoki boshqa belgi/yorliq/izoh qo'shma.
Avvalgi references: ${JSON.stringify(Array.isArray(references) ? references : [])}
Aniqlangan muammolar: ${JSON.stringify(validation?.problems || [])}${suppliedSources}
Faqat quyidagi JSON obyektni qaytar, boshqa kalit yoki izohsiz: {"references":["to'liq APA 7 manbasi", ...]}`;
}

function sortReferencesAPA(references) {
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  return (Array.isArray(references) ? references.slice() : [])
    .filter(reference => typeof reference === "string" && reference.trim())
    .sort((left, right) => {
      const leftParts = parseApaReference(left);
      const rightParts = parseApaReference(right);
      return collator.compare(leftParts?.author || left, rightParts?.author || right);
    });
}

function parseApaPartsForDisplay(reference) {
  const parsed = parseApaReference(reference);
  if (!parsed) return null;
  const authorDate = `${parsed.author} (${parsed.date}).`;
  const journal = /^(.+?),\s*(\d+)(?:\(([^)]+)\))?(,.*)$/u.exec(parsed.publication);
  if (journal) {
    return {
      authorDate,
      title: parsed.title,
      kind: "journal",
      journal: journal[1],
      volume: journal[2],
      issue: journal[3] || "",
      suffix: journal[4],
    };
  }
  return { authorDate, title: parsed.title, kind: "book", publication: parsed.publication };
}

module.exports = {
  REQUIRED_LANGUAGES,
  BIBLIOGRAPHY_TARGET,
  BIBLIOGRAPHY_MINIMUM,
  PLACEHOLDER_DOI,
  parseApaReference,
  apaReferenceProblems,
  classifyTitleLanguage,
  referenceLanguage,
  validateBibliography,
  selectBestReferences,
  completeBibliography,
  buildBibliographyRepairPrompt,
  sortReferencesAPA,
  parseApaPartsForDisplay,
};
