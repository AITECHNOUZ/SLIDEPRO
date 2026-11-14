const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BIBLIOGRAPHY_TARGET,
  apaReferenceProblems,
  referenceLanguage,
  validateBibliography,
  selectBestReferences,
  completeBibliography,
  buildBibliographyRepairPrompt,
  parseApaPartsForDisplay,
  sortReferencesAPA,
} = require("../src/mustaqil/references");

const mixedLanguageReferences = [
  "Karimov, A. (2020). O‘zbekiston ta’lim tizimi va rivojlanish asoslari. Fan va texnologiya. 248 pp.",
  "Ivanov, I. I. (2019). Основы автоматического управления. Наука. 320 pp.",
  "Smith, J. (2021). The fundamentals of control systems. Academic Press. 286 pp.",
  "Rahimov, B. (2018). O‘zbek adabiyoti tarixi va nazariyasi. Sharq. 275 pp.",
  "Petrov, P. P. (2022). Исследование систем управления. Издательство МГУ. 310 pp.",
  "Brown, R. (2020). Research methods in engineering. Springer. 296 pp.",
  "Usmonov, D. (2023). O‘quv jarayonini boshqarish va tahlil. Universitet nashriyoti. 264 pp.",
  "Sidorov, S. S. (2021). Современные методы анализа данных. Научное издательство. 302 pp.",
];

test("APA 7 tekshiruvi muallif-yil-sarlavha-nashrni talab qiladi; DOI ixtiyoriy, lekin soxta DOI rad etiladi", () => {
  assert.deepEqual(apaReferenceProblems(mixedLanguageReferences[0]), []);
  assert.deepEqual(apaReferenceProblems("Esram, T., & Chapman, P. L. (2007). Comparison of photovoltaic array maximum power point tracking techniques. IEEE Transactions on Energy Conversion, 22(2), 439–449. https://doi.org/10.1109/TEC.2006.874230"), []);
  assert.deepEqual(apaReferenceProblems("Ogata, K. (2010). Modern control engineering (5th ed.). Prentice Hall."), [], "DOI'siz kitob to'liq yozuv hisoblanadi");
  assert.ok(apaReferenceProblems("Lee, J. (2020). Journal article.").length > 0, "nashriyot/jurnal ma'lumoti yo'q yozuv to'liq deb hisoblanmasin");
  assert.ok(apaReferenceProblems("Lee, J. (2020). Journal article. Journal of Methods.").some(problem => problem.includes("jild")), "jurnal manbasida jild maydoni bo'lmasa to'liq deb hisoblanmasin");
  assert.ok(apaReferenceProblems("Lee, J. (2020). Article. Journal, 12(2), 30–45. https://doi.org/not-a-doi").some(problem => problem.includes("DOI")));
  assert.ok(apaReferenceProblems("Lee, J. (2020). The control systems handbook. Test Press. https://doi.org/10.0000/slidepro.en.01").some(problem => problem.includes("soxta")), "10.0000 namunaviy DOI rad etiladi");
  assert.ok(apaReferenceProblems("Olimov, A. A. (2020). Mavzu: nazariy asoslar. Universitet nashriyoti.").some(problem => problem.includes("placeholder")), "namunaviy muallif rad etiladi");
  assert.ok(apaReferenceProblems(`Lee, J. (${new Date().getFullYear() + 1}). Future book. Test Press.`).some(problem => problem.includes("yil")), "kelajakdagi yil rad etiladi");
  assert.ok(apaReferenceProblems("Lee, J. (n.d.). The control systems handbook. Test Press. 280 pp.").length > 0, "yil o‘rnida n.d. bo‘lishi to‘liq bibliography talabiga mos emas");
});

test("bibliografiya asl sarlavhadan o'zbek, rus va ingliz tilidagi manbalarni alohida aniqlaydi", () => {
  assert.equal(referenceLanguage(mixedLanguageReferences[0]), "uz");
  assert.equal(referenceLanguage(mixedLanguageReferences[1]), "ru");
  assert.equal(referenceLanguage(mixedLanguageReferences[2]), "en");
  assert.equal(validateBibliography(mixedLanguageReferences, { minimumCount: 8 }).valid, true);
});

test("til yorlig'i yoki tarjima manbasi asl tildagi manba qamrovini sun'iy to'ldirmaydi", () => {
  const labeledEnglish = "Doe, J. (2020). The Uzbek source list and its uses. Publisher. 220 pp.";
  const translatedRussian = "Иванов, И. И. (2020). Основы автоматического управления. Наука. 250 pp. [English translation]";
  assert.equal(referenceLanguage(labeledEnglish), "en", "til yorlig'i emas, sarlavha tili hisoblanadi");
  assert.equal(referenceLanguage(translatedRussian), null, "tarjima deb belgilangan manba til qamroviga kirmaydi");
  const result = validateBibliography([labeledEnglish, translatedRussian], { minimumCount: 1 });
  assert.deepEqual(result.missingLanguages.sort(), ["ru", "uz"]);
});

test("APA ro'yxati muallif nomi bo'yicha saralanadi va kitob/jurnal kursiv qismlari ajratiladi", () => {
  const sorted = sortReferencesAPA([
    mixedLanguageReferences[0],
    mixedLanguageReferences[2],
    "Lee, J. (2020). Journal article. Journal of Methods, 12(2), 30–45. https://doi.org/10.5555/methods.2020",
  ]);
  assert.match(sorted[0], /^Karimov/);
  assert.match(sorted[1], /^Lee/);
  assert.match(sorted[2], /^Smith/);
  assert.deepEqual(parseApaPartsForDisplay(mixedLanguageReferences[0]), {
    authorDate: "Karimov, A. (2020).",
    title: "O‘zbekiston ta’lim tizimi va rivojlanish asoslari",
    kind: "book",
    publication: "Fan va texnologiya. 248 pp.",
  });
  const journal = parseApaPartsForDisplay("Lee, J. (2020). Journal article. Journal of Methods, 12(2), 30–45. https://doi.org/10.5555/methods.2020");
  assert.equal(journal.kind, "journal");
  assert.equal(journal.journal, "Journal of Methods");
  assert.equal(journal.volume, "12");
  assert.equal(journal.issue, "2");
});

test("12 tadan ortiq yozuv bo'lsa, kesishdan oldin uch tildagi manbalar saqlanadi", () => {
  const manyEnglish = Array.from({ length: 12 }, (_, index) => `Taylor, A. (2020). The control systems study ${index + 1}. Test Press. ${240 + index} pp.`);
  const selected = selectBestReferences(manyEnglish.concat(mixedLanguageReferences.slice(0, 2)));
  assert.equal(selected.length, BIBLIOGRAPHY_TARGET);
  const result = validateBibliography(selected);
  assert.equal(result.valid, true);
  assert.deepEqual(result.missingLanguages, []);
});

test("manbalar yetishmasa, ro'yxat soxta yozuv bilan to'ldirilmaydi", () => {
  assert.deepEqual(completeBibliography([]), [], "bo'sh ro'yxatga uydirma manba qo'shilmaydi");
  const fakeAndReal = [
    ...mixedLanguageReferences.slice(0, 3),
    "Ivanov, I. I. (2026). Теоретические основы. Научное издательство. 262 pp. https://doi.org/10.0000/slidepro.ru.02",
    "Miller, J. A. (2026). Theoretical foundations. Academic Press. 283 pp. https://doi.org/10.0000/slidepro.en.03",
  ];
  const completed = completeBibliography(fakeAndReal);
  assert.equal(completed.length, 3, "faqat haqiqiy ko'rinishdagi yozuvlar qoladi");
  assert.ok(completed.every(reference => !/10\.0000|slidepro/.test(reference)));

  const onlyEnglish = Array.from({ length: 14 }, (_, index) => `Taylor, A. (2020). The control systems study ${index + 1}. Test Press. ${240 + index} pp.`);
  assert.equal(completeBibliography(onlyEnglish).length, BIBLIOGRAPHY_TARGET, "12 tadan ortig'i kesiladi");
});

test("bibliography retry faqat haqiqiy manbalarni so'raydi va DOI to'qishni taqiqlaydi", () => {
  const prompt = buildBibliographyRepairPrompt({ topic: "sinov", references: [], validation: { problems: [] } });
  assert.match(prompt, /FAQAT HAQIQIY MANBALAR/);
  assert.match(prompt, /o'zbekcha, ruscha va inglizcha/);
  assert.match(prompt, /APA 7/);
  assert.match(prompt, /DOI faqat aniq bilsang/);
  assert.match(prompt, /soxta yozuv bilan to'ldirma/);
  assert.doesNotMatch(prompt, /haqiqiyligini tekshirish shart emas|ishonarli bibliografik/i);
  assert.match(prompt, /Hech qanday AI, sintetik, tekshirish yoki boshqa belgi\/yorliq\/izoh qo'shma/);
});
