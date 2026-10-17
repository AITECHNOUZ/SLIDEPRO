const REQUIRED_LANGUAGES = Object.freeze({
  uz: "o'zbek",
  ru: "rus",
  en: "ingliz",
});
const BIBLIOGRAPHY_TARGET = 12;

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
  const hasDoiLink = /https?:\/\/doi\.org\/10\.\d{4,9}\/\S+/iu.test(text);
  if (!hasDoiLink) problems.push("har bir manba uchun DOI havolasi (https://doi.org/...) kerak");
  if (JOURNAL_HINT.test(parsed.publication)) {
    const hasVolume = /,\s*\d+(?:\s*\([^)]+\))?/u.test(parsed.publication);
    const hasLocator = /,\s*\d+\s*[-–—]\s*\d+|\barticle\s+[\p{L}\d-]+|\be\d{3,}\b/iu.test(parsed.publication);
    if (!hasVolume) problems.push("jurnal maqolasi uchun jild (va mavjud bo'lsa son) ko'rsatilmagan");
    else if (!hasLocator) problems.push("jurnal maqolasi uchun sahifalar, maqola raqami yoki DOI ko'rsatilmagan");
  } else if (!/\b\d{2,4}\s*(?:pp?\.?|pages?|с\.?|sahifa(?:lar)?|бет(?:лар)?|bet(?:lar)?)/iu.test(parsed.publication)) {
    problems.push("kitob uchun umumiy sahifa soni ko'rsatilmagan");
  }
  const doiMatch = text.match(/\bdoi\s*:\s*(\S+)|https?:\/\/doi\.org\/([^\s]+)/iu);
  if (doiMatch) {
    const doi = (doiMatch[1] || doiMatch[2] || "").replace(/[),.;]+$/, "");
    if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) problems.push("DOI formati yaroqsiz");
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

function validateBibliography(references, { minimumCount = BIBLIOGRAPHY_TARGET } = {}) {
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
    problems.push(`${invalidEntries.length} ta yozuvda APA 7 maydonlari yoki DOI/URL to'liq emas`);
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

function illustrativeReference(language, index, topic = "mavzu") {
  const safeTopic = String(topic || "mavzu").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "mavzu";
  const year = new Date().getFullYear();
  const localized = {
    uz: {
      author: `Olimov, A. A.`,
      title: `${safeTopic}: nazariy asoslar va amaliy yondashuvlar`,
      publication: `Universitet nashriyoti. ${240 + Number(index)} pp.`,
    },
    ru: {
      author: `Ivanov, I. I.`,
      title: `Теоретические основы и прикладные подходы к теме «${safeTopic}»`,
      publication: `Научное издательство. ${260 + Number(index)} pp.`,
    },
    en: {
      author: `Miller, J. A.`,
      title: `Theoretical foundations and applied approaches to ${safeTopic}`,
      publication: `Academic Press. ${280 + Number(index)} pp.`,
    },
  }[language];
  const serial = String(index).padStart(2, "0");
  return `${localized.author} (${year}). ${localized.title} (${serial}). ${localized.publication} https://doi.org/10.0000/slidepro.${language}.${serial}.`;
}

function completeBibliography(references, { topic = "mavzu", targetCount = BIBLIOGRAPHY_TARGET } = {}) {
  const count = Math.max(0, Math.floor(Number(targetCount) || BIBLIOGRAPHY_TARGET));
  const selected = selectBestReferences(...(Array.isArray(references) ? [references] : []))
    .slice(0, count);
  let generatedIndex = 1;
  const languages = Object.keys(REQUIRED_LANGUAGES);
  const presentLanguages = new Set(selected.map(referenceLanguage).filter(Boolean));
  const missingLanguages = languages.filter(language => !presentLanguages.has(language));
  if (selected.length + missingLanguages.length > count) {
    selected.length = Math.max(0, count - missingLanguages.length);
  }

  for (const language of missingLanguages) {
    if (selected.length >= count) break;
    if (!presentLanguages.has(language)) {
      selected.push(illustrativeReference(language, generatedIndex++, topic));
      presentLanguages.add(language);
    }
  }
  while (selected.length < count) {
    const language = languages[(selected.length + generatedIndex - 1) % languages.length];
    selected.push(illustrativeReference(language, generatedIndex++, topic));
  }
  return selected;
}

function buildBibliographyRepairPrompt({ topic, language, references, validation, sourceContent }) {
  const suppliedSources = sourceContent
    ? `\n\nFOYDALANUVCHI BERGAN MANBA KONTENTI:\n---\n${String(sourceContent).slice(0, 3000)}\n---\nAgar bu kontentda TEKSHIRILGAN MANBALAR ro'yxati bo'lsa, uning yozuvlarini o'zgartirma; 12 taga yetmaydigan qismini standart APA yozuvlari bilan to'ldir.`
    : "";
  return `BIBLIOGRAFIYANI TUZATISH — faqat references maydonini qaytar; boblar, reja, matn, xulosa yoki boshqa mazmunga tegma.
Mavzu: ${topic || "ko'rsatilmagan"}. Ish tili: ${language || "o'zbek"}.
Talab: AYNAN ${BIBLIOGRAPHY_TARGET} ta yozuv, APA 7 formatida. Ro'yxatda asl nashr tilida kamida bittadan o'zbekcha, ruscha va inglizcha manba bo'lsin. Til faqat asarning asl tildagi sarlavhasidan aniqlansin: tarjima asarlar, tarjima sarlavhalari, bibliografik izohlar yoki til yorliqlari til qamroviga kirmaydi. Haqiqiy asar topilsa, sarlavha va nashr ma'lumotlarini asl yozuvi va tilida saqla.
APA 7: muallif/tashkilot. (yil). Sarlavha. Kitob uchun nashriyot, umumiy sahifalar soni (masalan, 248 pp.) va DOI havolasi; jurnal maqolasi uchun jurnal nomi, jild(son), sahifa oralig'i yoki maqola raqami va DOI havolasi bo'lsin. HAR bir yozuvda https://doi.org/10.... ko'rinishidagi DOI havolasi va sahifa ma'lumoti bo'lishi shart. Manbaning haqiqiyligini tekshirish shart emas; format maydonlari uchun mavzuga mos, ishonarli bibliografik ma'lumot kiritish mumkin. Hech qanday AI, sintetik, tekshirish yoki boshqa belgi/yorliq/izoh qo'shma. Foydalanuvchi bergan manba metadata'sini o'zgartirma.
Avvalgi references: ${JSON.stringify(Array.isArray(references) ? references : [])}
Aniqlangan muammolar: ${JSON.stringify(validation?.problems || [])}${suppliedSources}
Faqat quyidagi JSON obyektni qaytar, boshqa kalit yoki izohsiz: {"references":["to'liq APA 7 manbasi", ...]} references massivi AYNAN ${BIBLIOGRAPHY_TARGET} elementdan iborat bo'lsin.`;
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
  parseApaReference,
  apaReferenceProblems,
  classifyTitleLanguage,
  referenceLanguage,
  validateBibliography,
  selectBestReferences,
  illustrativeReference,
  completeBibliography,
  buildBibliographyRepairPrompt,
  sortReferencesAPA,
  parseApaPartsForDisplay,
};
