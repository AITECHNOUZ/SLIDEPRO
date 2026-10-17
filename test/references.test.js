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
  "Karimov, A. (2020). O‘zbekiston ta’lim tizimi va rivojlanish asoslari. Fan va texnologiya. 248 pp. https://doi.org/10.0000/refs.uz.2020.karimov",
  "Ivanov, I. I. (2019). Основы автоматического управления. Наука. 320 pp. https://doi.org/10.0000/refs.ru.2019.ivanov",
  "Smith, J. (2021). The fundamentals of control systems. Academic Press. 286 pp. https://doi.org/10.0000/refs.en.2021.smith",
  "Rahimov, B. (2018). O‘zbek adabiyoti tarixi va nazariyasi. Sharq. 275 pp. https://doi.org/10.0000/refs.uz.2018.rahimov",
  "Petrov, P. P. (2022). Исследование систем управления. Издательство МГУ. 310 pp. https://doi.org/10.0000/refs.ru.2022.petrov",
  "Brown, R. (2020). Research methods in engineering. Springer. 296 pp. https://doi.org/10.0000/refs.en.2020.brown",
  "Usmonov, D. (2023). O‘quv jarayonini boshqarish va tahlil. Universitet nashriyoti. 264 pp. https://doi.org/10.0000/refs.uz.2023.usmonov",
  "Sidorov, S. S. (2021). Современные методы анализа данных. Научное издательство. 302 pp. https://doi.org/10.0000/refs.ru.2021.sidorov",
];

test("APA 7 tekshiruvi muallif-yil-sarlavha-nashr, sahifa va DOI havolasini talab qiladi", () => {
  assert.deepEqual(apaReferenceProblems(mixedLanguageReferences[0]), []);
  assert.deepEqual(apaReferenceProblems("Lee, J. (2020). Journal article. Journal of Methods, 12(2), 30–45. https://doi.org/10.1234/example"), []);
  assert.ok(apaReferenceProblems("Lee, J. (2020). Journal article.").length > 0, "nashriyot/jurnal ma'lumoti yo'q yozuv to'liq deb hisoblanmasin");
  assert.ok(apaReferenceProblems("Lee, J. (2020). Journal article. Journal of Methods.").some(problem => problem.includes("jild")), "jurnal manbasida jild maydoni bo'lmasa to'liq deb hisoblanmasin");
  assert.ok(apaReferenceProblems("Lee, J. (2020). Article. Journal, 12(2), 30–45. https://doi.org/not-a-doi").some(problem => problem.includes("DOI")));
  assert.ok(apaReferenceProblems("Lee, J. (2020). The control systems handbook. Test Press.").some(problem => problem.includes("DOI")));
  assert.ok(apaReferenceProblems("Lee, J. (2020). The control systems handbook. Test Press. https://doi.org/10.1234/example").some(problem => problem.includes("sahifa")));
  assert.ok(apaReferenceProblems("Lee, J. (2020). The control systems handbook. Test Press. 280 pp.").some(problem => problem.includes("DOI")));
  assert.ok(apaReferenceProblems("Lee, J. (n.d.). The control systems handbook. Test Press. 280 pp. https://doi.org/10.1234/example").length > 0, "yil o‘rnida n.d. bo‘lishi to‘liq bibliography talabiga mos emas");
});

test("bibliografiya asl sarlavhadan o'zbek, rus va ingliz tilidagi manbalarni alohida aniqlaydi", () => {
  assert.equal(referenceLanguage(mixedLanguageReferences[0]), "uz");
  assert.equal(referenceLanguage(mixedLanguageReferences[1]), "ru");
  assert.equal(referenceLanguage(mixedLanguageReferences[2]), "en");
  assert.equal(validateBibliography(mixedLanguageReferences, { minimumCount: 8 }).valid, true);
});

test("til yorlig'i yoki tarjima manbasi asl tildagi manba qamrovini sun'iy to'ldirmaydi", () => {
  const labeledEnglish = "Doe, J. (2020). The Uzbek source list and its uses. Publisher. 220 pp. https://doi.org/10.1234/labels";
  const translatedRussian = "Иванов, И. И. (2020). Основы автоматического управления. Наука. 250 pp. https://doi.org/10.1234/translation [English translation]";
  assert.equal(referenceLanguage(labeledEnglish), "en", "til yorlig'i emas, sarlavha tili hisoblanadi");
  assert.equal(referenceLanguage(translatedRussian), null, "tarjima deb belgilangan manba til qamroviga kirmaydi");
  const result = validateBibliography([labeledEnglish, translatedRussian], { minimumCount: 1 });
  assert.deepEqual(result.missingLanguages.sort(), ["ru", "uz"]);
});

test("APA ro'yxati muallif nomi bo'yicha saralanadi va kitob/jurnal kursiv qismlari ajratiladi", () => {
  const sorted = sortReferencesAPA([
    mixedLanguageReferences[0],
    mixedLanguageReferences[2],
    "Lee, J. (2020). Journal article. Journal of Methods, 12(2), 30–45. https://doi.org/10.1234/methods",
  ]);
  assert.match(sorted[0], /^Karimov/);
  assert.match(sorted[1], /^Lee/);
  assert.match(sorted[2], /^Smith/);
  assert.deepEqual(parseApaPartsForDisplay(mixedLanguageReferences[0]), {
    authorDate: "Karimov, A. (2020).",
    title: "O‘zbekiston ta’lim tizimi va rivojlanish asoslari",
    kind: "book",
    publication: "Fan va texnologiya. 248 pp. https://doi.org/10.0000/refs.uz.2020.karimov",
  });
  const journal = parseApaPartsForDisplay("Lee, J. (2020). Journal article. Journal of Methods, 12(2), 30–45. https://doi.org/10.1234/methods");
  assert.equal(journal.kind, "journal");
  assert.equal(journal.journal, "Journal of Methods");
  assert.equal(journal.volume, "12");
  assert.equal(journal.issue, "2");
});

test("12 tadan ortiq yozuv bo'lsa, kesishdan oldin uch tildagi manbalar saqlanadi", () => {
  const manyEnglish = Array.from({ length: 12 }, (_, index) => `Taylor, A. (2020). The control systems study ${index + 1}. Test Press. ${240 + index} pp. https://doi.org/10.0000/taylor.${index + 1}`);
  const selected = selectBestReferences(manyEnglish.concat(mixedLanguageReferences.slice(0, 2)));
  assert.equal(selected.length, BIBLIOGRAPHY_TARGET);
  const result = validateBibliography(selected);
  assert.equal(result.valid, true);
  assert.deepEqual(result.missingLanguages, []);
});

test("manbalar yetishmasa, ro'yxat aynan 12 ta to'liq APA yozuvni uch tilda to'ldiradi", () => {
  const completed = completeBibliography([], { topic: "Avtomatik boshqaruv tizimlari" });
  assert.equal(completed.length, BIBLIOGRAPHY_TARGET);
  assert.equal(validateBibliography(completed).valid, true);
  assert.deepEqual(new Set(completed.map(referenceLanguage)), new Set(["uz", "ru", "en"]));
  assert.ok(completed.every(reference => /https:\/\/doi\.org\/10\./.test(reference) && /\d+ pp\./.test(reference)));
  assert.ok(completed.every(reference => !/AI-generated|verify before citation|synthetic|fallback/i.test(reference)));

  const onlyEnglish = Array.from({ length: 12 }, (_, index) => `Taylor, A. (2020). The control systems study ${index + 1}. Test Press. ${240 + index} pp. https://doi.org/10.0000/taylor.${index + 1}`);
  const mixed = completeBibliography(onlyEnglish, { topic: "control systems" });
  assert.equal(mixed.length, BIBLIOGRAPHY_TARGET);
  assert.equal(validateBibliography(mixed).valid, true);
  assert.deepEqual(new Set(mixed.map(referenceLanguage)), new Set(["uz", "ru", "en"]));
  assert.equal(mixed.filter(reference => /AI-generated|verify before citation|synthetic|fallback/i.test(reference)).length, 0);
});

test("bibliography retry aynan 12 to'liq yozuv, sahifa va DOI havolasini so'raydi", () => {
  const prompt = buildBibliographyRepairPrompt({ topic: "sinov", references: [], validation: { problems: [] } });
  assert.match(prompt, /AYNAN 12 ta yozuv/);
  assert.match(prompt, /o'zbekcha, ruscha va inglizcha/);
  assert.match(prompt, /APA 7/);
  assert.match(prompt, /har bir yozuvda.*DOI havolasi va sahifa ma'lumoti bo'lishi shart/i);
  assert.match(prompt, /Hech qanday AI, sintetik, tekshirish yoki boshqa belgi\/yorliq\/izoh qo'shma/);
  assert.doesNotMatch(prompt, /AI-generated|verify before citation|AI-illustrativ/i);
  assert.match(prompt, /AYNAN 12 elementdan iborat/);
});
