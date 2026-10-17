const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WORDS_PER_PAGE,
  pagePlan,
  wordsForPages,
  outlineUserPrompt,
  chapterUserPrompt,
  normalizeOutlineForPages,
  parseOutline,
} = require("../src/mustaqil/prompt");
const {
  countWords,
  countSectionWords,
  chapterMainNumber,
  normalizeChapterContent,
  clampChapterContent,
} = require("../src/mustaqil/structure");
const { normalizeHeadingTitle } = require("../src/mustaqil/headings");
const { normalizeChartData } = require("../src/mustaqil/chart-data");
const { normalizeFormulaSource } = require("../src/mustaqil/formula-data");
const { validatePlannedMedia } = require("../src/mustaqil/media-validation");
const { buildRejaItems } = require("../src/mustaqil/builder");
const { alignPlannedChartBlocks, alignPlannedFormulaBlocks } = require("../src/mustaqil/generate");
const { resolveFormulaQuota } = require("../src/mustaqil/media-requirements");

test("bob/bo'lim yorliqlari tozalanadi, lekin mazmuniy sarlavha raqami saqlanadi", () => {
  assert.equal(normalizeHeadingTitle("1-bob: Tahlil", { stripNumbering: true }), "Tahlil");
  assert.equal(normalizeHeadingTitle("Bob 1 — Natijalar", { stripNumbering: true }), "Natijalar");
  assert.equal(normalizeHeadingTitle("2.1-bo‘lim: Nazariy asoslar", { stripNumbering: true }), "Nazariy asoslar");
  assert.equal(normalizeHeadingTitle("Chapter 2: Data analysis", { stripNumbering: true }), "Data analysis");
  assert.equal(normalizeHeadingTitle("1.1. Nazariy asoslar"), "1.1. Nazariy asoslar");
});

test("chart validator noto'g'ri shakl va matematik jihatdan chizib bo'lmaydigan pie qiymatlarini rad etadi", () => {
  const valid = normalizeChartData({ chartType: "bar", labels: ["A", "B"], values: [-4, 6] });
  assert.deepEqual(valid.values, [-4, 6]);
  assert.throws(() => normalizeChartData({ chartType: "line", labels: ["A", "B"], values: [1] }), /uzunligi teng emas/);
  assert.throws(() => normalizeChartData({ chartType: "pie", labels: ["A", "B"], values: [2, -1] }), /manfiy qiymat/);
  assert.throws(() => normalizeChartData({ chartType: "pie", labels: ["A", "B"], values: [0, 0] }), /yig'indisi/);
  assert.throws(() => normalizeChartData({ chartType: "line", labels: ["A", "B"], values: [1, "NaN"] }), /finite emas/);
  assert.throws(() => normalizeChartData({ chartType: "bar", labels: ["A", "B"], values: [-1e308, 1e308] }), /qiymatlar oralig'i/);
  assert.throws(() => normalizeChartData({ chartType: "pie", labels: ["A", "B"], values: [1e308, 1e308] }), /yig'indisi son diapazonidan/);
  assert.throws(() => normalizeChartData({ chartType: "bar", labels: ["A", "a"], values: [1, 2] }), /takrorlangan label/);
});

test("formula source bo'sh yoki qavs balansi xato bo'lsa rad etiladi", () => {
  assert.equal(normalizeFormulaSource(" \\frac{a}{b} "), "\\frac{a}{b}");
  assert.throws(() => normalizeFormulaSource(""), /bo'sh/);
  assert.throws(() => normalizeFormulaSource("\\frac{a}{"), /qavslar balansi/);
  assert.throws(() => normalizeFormulaSource("x}"), /qavslar balansi/);
});

test("chiqarishdan oldin yaratilgan chart/formula soni va formula ifodasi rejaga mos bo'lishi shart", () => {
  const planned = [
    { id: "intro", title: "Kirish", chart_count: 0, formula_count: 0 },
    {
      id: "ch1", title: "Tahlil", chart_count: 1, chart_plans: [{ title: "Trend" }],
      formula_count: 1, formula_plans: [{ latex: "\\frac{a}{b}" }],
    },
    { id: "conclusion", title: "Xulosa", chart_count: 0, formula_count: 0 },
  ];
  const generated = [
    { content: [] },
    { content: [
      { type: "chart", chartType: "bar", labels: ["A", "B"], values: [1, 2], data_source: "namunaviy sintetik ma'lumot" },
      { type: "formula", latex: "\\frac{a}{ b }" },
    ] },
    { content: [] },
  ];
  assert.equal(validatePlannedMedia(generated, planned, { minimumDiagramCount: 0 }), true);
  const missingChart = generated.map((chapter, index) => index === 1
    ? { content: chapter.content.filter(item => item.type !== "chart") }
    : chapter);
  assert.throws(() => validatePlannedMedia(missingChart, planned), /chart 0\/1/);
  const extraChart = generated.map((chapter, index) => index === 1
    ? { content: [...chapter.content, { type: "chart", chartType: "bar", labels: ["C", "D"], values: [2, 3], data_source: "qo'shimcha sintetik ma'lumot" }] }
    : chapter);
  assert.throws(() => validatePlannedMedia(extraChart, planned), /chart 2\/1/);
  assert.throws(() => validatePlannedMedia(generated.map((chapter, index) => index === 1
    ? { content: [...chapter.content.filter(item => item.type !== "formula"), { type: "formula", latex: "x" }] }
    : chapter), planned), /formulalar bilan.*mos emas/);
});

test("jadval soni va 3–6 qatorli kataklar DOCX chiqarishdan oldin tekshiriladi", () => {
  const planned = [{ id: "ch1", title: "Tahlil", table_count: 1 }];
  const table = { type: "table", headers: ["A", "B", "C"], rows: [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]] };
  assert.equal(validatePlannedMedia([{ content: [table] }], planned, { minimumDiagramCount: 0 }), true);
  assert.throws(() => validatePlannedMedia([{ content: [] }], planned, { minimumDiagramCount: 0 }), /table 0\/1/);
  assert.throws(() => validatePlannedMedia([{ content: [{ ...table, rows: [["1", "2", "3"]] }] }], planned, { minimumDiagramCount: 0 }), /3–6 qator/);
});

test("1.5 sahifalik kichik bo'limlar butun bet rejasiga yuqoriga moslanadi", () => {
  for (let requested = 10; requested <= 40; requested++) {
    const plan = pagePlan(requested);
    assert.ok(plan.pages >= requested, `${requested} bet so'rovi kamaymasin`);
    const mainPages = plan.sectionCounts.reduce((sum, count) => sum + Math.ceil(1.5 * count), 0);
    assert.equal(plan.mainPageBudget, mainPages);
    assert.equal(plan.pages, 5 + mainPages);
    assert.equal(plan.mediaPageAllowancePages, 2);
    assert.equal(plan.maxExpectedPages, plan.pages + 2);
    assert.equal(plan.subsectionCount, plan.sectionCounts.reduce((sum, count) => sum + count, 0));
    assert.ok(plan.subsectionCount >= plan.mainChapterCount);
    assert.ok(plan.sectionCounts.every(count => Number.isInteger(count) && count >= 1));
    assert.equal(plan.addedPages, plan.pages - plan.requestedPages);
    assert.equal(plan.totalWords, plan.introWordTarget + plan.conclusionWordTarget + plan.subsectionCount * plan.sectionWordTarget);
    assert.equal(wordsForPages(requested), plan.totalWords);
  }
});

test("mos bo'lmagan so'rov uchun eng kichik yuqori sahifa targeti tanlanadi", () => {
  for (const [requested, expected] of [[10, 11], [11, 11], [12, 12], [13, 13], [14, 14], [15, 15], [18, 19], [21, 22], [40, 40]]) {
    const plan = pagePlan(requested);
    assert.equal(plan.pages, expected);
    assert.equal(plan.addedPages, expected - requested);
  }
});

test("outline normalization exact structure yaratadi va legitimate adabiyot topicni yo'qotmaydi", () => {
  const outline = normalizeOutlineForPages({
    chapters: [
      { title: "Kirish" },
      { title: "1-bob: Adabiyotlar tahlili", formula_count: 2, formula_plans: [{ latex: "x" }, { latex: "y" }], table_count: 1, sections: [{ title: "1.1-bo'lim: Manbalar tahlili" }] },
      { title: "Metodologiya", formula_count: 1, formula_plans: [{ latex: "z" }], table_count: 1, sections: [{ title: "Nazariy qism" }, { title: "Nazariy qism" }] },
      { title: "Metodologiya", sections: [{ title: "Amaliy qism" }] },
      { title: "Xulosa" },
      { title: "Foydalanilgan adabiyotlar" },
    ],
    references: [" Manba A ", null, { title: "noto'g'ri tip" }, " ", "Manba B"],
  }, { pages: 12, topic: "Sinov mavzusi", language: "o'zbek", studentName: "Talaba", formulaCount: 2 });

  const plan = pagePlan(12);
  assert.equal(outline.chapters.length, plan.mainChapterCount + 2);
  assert.equal(outline.chapters[0].id, "intro");
  assert.equal(outline.chapters.at(-1).id, "conclusion");
  const main = outline.chapters.slice(1, -1);
  assert.ok(main.some(chapter => chapter.title === "Adabiyotlar tahlili"));
  assert.equal(main[0].sections[0].title, "Manbalar tahlili");
  assert.equal(main.reduce((sum, chapter) => sum + chapter.sections.length, 0), plan.subsectionCount);
  assert.equal(new Set(main.map(chapter => chapter.title.toLowerCase())).size, main.length);
  for (const chapter of main) {
    assert.equal(new Set(chapter.sections.map(section => section.title.toLowerCase())).size, chapter.sections.length);
    assert.ok(chapter.sections.every(section => section.word_target === 398));
    assert.ok(chapter.chart_count === 0 || chapter.chart_count === 1);
    assert.equal(chapter.chart_count, chapter.chart_plans.length);
    assert.ok(chapter.formula_count === 0 || chapter.formula_count === 1);
  }
  assert.equal(main.reduce((sum, chapter) => sum + chapter.chart_count, 0), 2);
  assert.ok(main.filter(chapter => chapter.chart_count > 0).length <= 2);
  assert.equal(main.reduce((sum, chapter) => sum + chapter.formula_count, 0), 2);
  assert.ok(main.every(chapter => chapter.formula_count <= 1));
  assert.equal(main.reduce((sum, chapter) => sum + chapter.table_count, 0), 1);
  assert.equal(outline.meta.student_name, "Talaba");
  assert.equal(outline.meta.title, "Sinov mavzusi");
  assert.deepEqual(outline.references, ["Manba A", "Manba B"]);
});

test("formula kvotasi mavzuning miqdoriy xususiyatiga mos, override esa ustuvor", () => {
  const chapterLimit = pagePlan(16).mainChapterCount;
  assert.equal(chapterLimit, 4);
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Avtomatik boshqaruv tizimlari" }), 2);
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Математическое моделирование физических систем" }), 2);
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "O'zbek adabiyotida realizm" }), 0);
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Iqtisodiy o'sish va statistik tahlil" }), 2);
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Quantum error correction in hybrid computing" }), 2,
    "kvant hisoblash mavzusi eski tor kalit so'zlar ro'yxatisiz ham miqdoriy deb topilsin");
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Raqamli filologiyada korpus va sentiment tahlili" }), 2,
    "aralash gumanitar-hisoblash mavzusi hisoblash usullari aniq bo'lganda tanilsin");
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Markaziy Osiyo she'riyatidagi qiyosiy obrazlar" }), 0,
    "miqdoriy dalilsiz tavsifiy mavzuga filler formula qo'shilmasin");
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Avtomatik boshqaruv tizimlari", formulaCount: 0 }), 0);
  assert.equal(resolveFormulaQuota(chapterLimit, { topic: "Adabiyotshunoslik", formulaCount: 3 }), 3);

  const planned = normalizeOutlineForPages({ chapters: [
    { title: "Model va jarayonlar", formula_count: 2, formula_plans: [
      { latex: "G(s)=\\frac{1}{s+1}", concept: "Uzatish funksiyasi" },
      { latex: "y(t)=1-e^{-t}", concept: "O'tkinchi javob" },
    ] },
    { title: "Tahlil" }, { title: "Natijalar" }, { title: "Qo'llanish" },
  ] }, { pages: 16, topic: "Avtomatik boshqaruv tizimlari" });
  const main = planned.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  assert.equal(main.reduce((sum, chapter) => sum + chapter.formula_count, 0), 2,
    "bir bobga tushib qolgan 2 reja formulasi normallashtirishda yo'qolmasin");
  assert.deepEqual(main.map(chapter => chapter.formula_count), [1, 1, 0, 0]);
  assert.deepEqual(main.slice(0, 2).flatMap(chapter => chapter.formula_plans.map(plan => plan.latex)), [
    "G(s)=\\frac{1}{s+1}", "y(t)=1-e^{-t}",
  ]);

  const forced = normalizeOutlineForPages({ chapters: [
    { title: "Badiiy tahlil" }, { title: "Tarixiy kontekst" }, { title: "Uslub" }, { title: "Qabul" },
  ] }, {
    pages: 16, topic: "O'zbek adabiyoti", formulaCount: 2,
    formulaPlans: [{ latex: "a+b=c" }, { latex: "x+y=z" }],
  });
  assert.equal(forced.chapters.reduce((sum, chapter) => sum + chapter.formula_count, 0), 2,
    "aniq formula override tavsifiy mavzuda ham avtomatik qisqartirilmasin");
  assert.match(outlineUserPrompt({ topic: "O'zbek adabiyoti", pages: 16 }), /aynan 0 ta formula/);
  assert.match(outlineUserPrompt({ topic: "Avtomatik boshqaruv tizimlari", pages: 16 }), /aynan 2 ta formula/);
});

test("aniq kvota 4 formula, 2 klassik grafik va 2 flowchartni toza boblarga taqsimlaydi", () => {
  const formulaPlans = [
    { latex: "G_p(s)=\\frac{K}{Ts+1}", concept: "birinchi tartibli obyektning uzatish funksiyasi" },
    { latex: "T(s)=\\frac{G(s)}{1+G(s)H(s)}", concept: "manfiy teskari aloqali yopiq tizimning uzatish funksiyasi" },
    { latex: "C(s)=K_p+\\frac{K_i}{s}+K_d s", concept: "PID rostlagichning uzluksiz boshqaruv qonuni" },
    { latex: "M_p=100e^{-\\zeta\\pi/\\sqrt{1-\\zeta^2}}", concept: "ikkinchi tartibli tizimda ortiqcha o‘tish va so‘nish koeffitsiyenti orasidagi bog‘lanish" },
  ];
  const chartPlans = [
    { title: "P, PI va PID rostlagichlarning shartli ortiqcha o‘tishi", variable: "sintetik simulyatsiya bo‘yicha ortiqcha o‘tish foizi" },
    { title: "Birinchi tartibli obyektning birlik pog‘onali javobi", variable: "G(s)=1/(2s+1) modeli uchun vaqt bo‘yicha nisbiy chiqish" },
  ];
  const outline = normalizeOutlineForPages({
    chapters: [
      { title: "Kirish" },
      { title: "Tizim modellari" },
      { title: "Teskari aloqa" },
      { title: "Rostlagichlar" },
      { title: "Sifat ko‘rsatkichlari" },
      { title: "Xulosa" },
    ],
    references: Array.from({ length: 8 }, (_, index) => `Manba ${index + 1}`),
  }, {
    pages: 15, topic: "Avtomatik boshqaruv tizimlari", formulaCount: 4, formulaPlans,
    chartCount: 2, chartPlans, flowchartCount: 2,
  });
  const main = outline.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  assert.equal(main.length, 4);
  assert.equal(outline.chapters.at(-1).word_target, 220);
  assert.equal(main.reduce((sum, chapter) => sum + chapter.formula_count, 0), 4);
  assert.ok(main.every(chapter => chapter.formula_count === 1));
  assert.equal(main.reduce((sum, chapter) => sum + chapter.chart_count, 0), 2);
  assert.deepEqual(main.filter(chapter => chapter.chart_count).map(chapter => chapter.chart_type), ["bar", "line"]);
  assert.deepEqual(main.filter(chapter => chapter.chart_count).map(chapter => chapter.chart_plans[0].title), chartPlans.map(chart => chart.title));
  assert.equal(main.reduce((sum, chapter) => sum + chapter.flowchart_count, 0), 2);
  assert.ok(main.every(chapter => !(chapter.chart_count && chapter.flowchart_count)));

  const prompt = outlineUserPrompt({ topic: "Avtomatik boshqaruv tizimlari", pages: 15, formulaCount: 4, chartCount: 2, flowchartCount: 2 });
  assert.match(prompt, /aynan 4 ta formula/);
  assert.match(prompt, /aynan 2 miqdoriy grafik/);
  assert.match(prompt, /bitta "bar" va bitta "line"/);
});

test("bob media bloklari model xatosini aniq formula/chart rejasi bilan normallashtiradi", () => {
  const formulaChapter = {
    formula_plans: [{ latex: "G_p(s)=\\frac{K}{Ts+1}", concept: "Birinchi tartibli obyektning uzatish funksiyasi" }],
  };
  const formulaItems = alignPlannedFormulaBlocks(formulaChapter, [
    { type: "paragraph", text: "Obyektning dinamikasi matematik model bilan ifodalanadi." },
    { type: "formula", latex: "x^2+y^2=z^2", caption: "Noto'g'ri formula" },
    { type: "formula", latex: "a+b=c" },
  ]);
  const formulas = formulaItems.filter(item => item.type === "formula");
  assert.equal(formulas.length, 1);
  assert.equal(formulas[0].latex, formulaChapter.formula_plans[0].latex);
  assert.equal(formulas[0].caption, formulaChapter.formula_plans[0].concept);

  const missingFormula = alignPlannedFormulaBlocks(formulaChapter, [
    { type: "paragraph", text: "Birinchi tartibli obyekt ko'rib chiqiladi." },
  ]);
  assert.equal(missingFormula.filter(item => item.type === "formula").length, 1);
  assert.equal(missingFormula.at(-1).latex, formulaChapter.formula_plans[0].latex);

  const chartPlan = {
    title: "Shartli ortiqcha o'tish ko'rsatkichlari",
    variable: "P, PI va PID foizlari",
    caption: "Sintetik simulyatsiya; haqiqiy tajriba o'lchovi emas",
    data_source: "Sintetik simulyatsiya, haqiqiy tajriba o'lchovi emas",
    labels: ["P", "PI", "PID"],
    values: [28, 18, 7],
    unit: "%",
  };
  const chartItems = alignPlannedChartBlocks({ chart_count: 1, chart_type: "bar", chart_plans: [chartPlan] }, [
    { type: "chart", title: "Shartli ortiqcha o'tish", chartType: "pie", values: [1, 2] },
    { type: "chart", title: "Aloqasiz harorat trendi", chartType: "line", values: [9, 8] },
  ]);
  const charts = chartItems.filter(item => item.type === "chart");
  assert.equal(charts.length, 1);
  assert.equal(charts[0].chartType, "bar");
  assert.equal(charts[0].title, chartPlan.title);
  assert.equal(charts[0].caption, chartPlan.title);
  assert.doesNotMatch(`${charts[0].title} ${charts[0].caption}`, /sintetik|haqiqiy tajriba o'lchovi emas/i);
  assert.equal(charts[0].data_source, chartPlan.data_source);
  assert.deepEqual(charts[0].labels, chartPlan.labels);
  assert.deepEqual(charts[0].values, chartPlan.values);
  assert.equal(charts[0].unit, chartPlan.unit);

  const fallbackChart = alignPlannedChartBlocks({ chart_count: 1, chart_type: "bar", chart_plans: [chartPlan] }, []);
  assert.equal(fallbackChart.length, 1);
  assert.deepEqual(fallbackChart[0].values, chartPlan.values);
});

test("bo'sh yoki noto'g'ri outline xavfsiz fallback bilan normalize bo'ladi", () => {
  const normalized = normalizeOutlineForPages(null, { pages: 10, topic: "Fallback" });
  assert.equal(normalized.chapters.length, pagePlan(10).mainChapterCount + 2);
  assert.equal(normalized.meta.title, "Fallback");
  assert.throws(() => parseOutline("null"));
  assert.throws(() => parseOutline("[]"));
  assert.throws(() => parseOutline("not json"));
  assert.deepEqual(parseOutline("```json\n{\"chapters\":[]}\n```"), { chapters: [] });
});

test("outline prompt o'lchangan so'z sig'imi, media ruxsati va toza reja qoidasini aks ettiradi", () => {
  const prompt = outlineUserPrompt({ topic: "Sinov", pages: 13 });
  assert.equal(WORDS_PER_PAGE, 265);
  assert.match(prompt, /13 bet so'ralgan/);
  assert.match(prompt, /matn rejasi 13 bet/);
  assert.match(prompt, /265 so'z\/bet/);
  assert.match(prompt, /Kirish 265, Xulosa 220 so'zdan oshmasin/);
  assert.match(prompt, /ko'pi bilan 15 bet/);
  assert.match(prompt, /REJA sahifasida hech qachon chiqarilmaydi/);
  assert.match(prompt, /1\.5 sahifa \/ 398 so'z/);
});

test("Kirish prompti bir betlik 265 so'zli qat'iy limitni beradi va Bob yorlig'ini ishlatmaydi", () => {
  const outline = { meta: { title: "Sinov" }, chapters: [{ id: "intro", title: "Kirish" }] };
  const prompt = chapterUserPrompt({
    chapter: { id: "intro", title: "Kirish", role: "introduction", word_target: 265 },
    outline, language: "o'zbek", chapterIndex: 0, totalChapters: 1,
  });
  assert.match(prompt, /Kirish qismi 265 so'zdan oshmasin/);
  assert.match(prompt, /QAT'IY 3 ta: har biri 84-89 so'z/);
  assert.match(prompt, /Qism: "Kirish"/);
  assert.doesNotMatch(prompt, /Bob:/);
});

test("asosiy reja bandi qat'iy uch paragraf va 398 so'zdan oshmaydi", () => {
  const outline = { meta: { title: "Sinov" }, chapters: [
    { id: "intro", title: "Kirish" },
    { id: "ch1", title: "Tuzilish", sections: [{ title: "Orbital qonunlar", word_target: 398 }] },
    { id: "conclusion", title: "Xulosa" },
  ] };
  const prompt = chapterUserPrompt({
    chapter: { id: "ch1", title: "Tuzilish", role: "theory", word_target: 398, sections: [{ title: "Orbital qonunlar", word_target: 398 }] },
    outline, language: "o'zbek", chapterIndex: 1, totalChapters: 3,
  });
  assert.match(prompt, /Jami matn 398 so'zdan oshmasin/);
  assert.match(prompt, /aynan 3 paragraf/);
  assert.match(prompt, /128-133 so'z/);
  assert.match(prompt, /Qism: "Tuzilish"/);
  assert.doesNotMatch(prompt, /Bob:/);
});

test("Kirish 265, Xulosa 220 so'zdan va har biri uch paragrafdan oshmaydi", () => {
  const sentence = "Quyosh tizimi orbital harakat qonunlari bilan tavsiflanadi.";
  const longParagraph = Array(10).fill(sentence).join(" ");
  const content = Array.from({ length: 5 }, () => ({ type: "paragraph", text: longParagraph }));
  const introCapped = clampChapterContent({ id: "intro", word_target: 265 }, content, 0);
  const conclusionCapped = clampChapterContent({ id: "conclusion", word_target: 220 }, content, 0);
  assert.ok(countWords(introCapped) <= 265);
  assert.equal(introCapped.filter(item => item.type === "paragraph").length, 3);
  assert.ok(countWords(conclusionCapped) <= 220);
  assert.equal(conclusionCapped.filter(item => item.type === "paragraph").length, 3);

  const conclusionPrompt = chapterUserPrompt({
    chapter: { id: "conclusion", title: "Xulosa", role: "conclusion", word_target: 220 },
    outline: { meta: { title: "Sinov" }, chapters: [{ id: "intro", title: "Kirish" }, { id: "conclusion", title: "Xulosa" }] },
    language: "o'zbek", chapterIndex: 1, totalChapters: 2,
  });
  assert.match(conclusionPrompt, /Xulosa qismi 220 so'zdan oshmasin/);
});

test("asosiy rejaning har bir ichki bandi 398 so'z va uch paragraf bilan cheklanadi", () => {
  const sentence = "Asteroidlar orbitasi kuzatuvlar asosida izchil tahlil qilinadi.";
  const longParagraph = Array(10).fill(sentence).join(" ");
  const content = Array.from({ length: 12 }, () => ({ type: "paragraph", text: longParagraph }));
  const chapter = {
    id: "ch1", word_target: 796,
    sections: [{ title: "Orbital xususiyatlar", word_target: 398 }, { title: "Kuzatuv dalillari", word_target: 398 }],
  };
  const capped = clampChapterContent(chapter, content, 1);
  const actuals = countSectionWords({ content: capped });
  assert.equal(actuals.length, 2);
  assert.ok(actuals.every(words => words <= 398));
  assert.ok(capped.filter(item => item.type === "heading" && item.level === 2).length === 2);
  let paragraphCount = 0;
  for (const item of capped) {
    if (item.type === "heading" && item.level === 2) paragraphCount = 0;
    else if (item.type === "paragraph") {
      paragraphCount++;
      assert.ok(paragraphCount <= 3);
    }
  }
});

test("yakuniy clamp qabul qilingan subsection taqsimotini saqlab, faqat 115% dan oshganini cheklaydi", () => {
  const chapter = {
    id: "ch1", word_target: 200,
    sections: [{ title: "Birinchi", word_target: 100 }, { title: "Ikkinchi", word_target: 100 }],
  };
  const content = [
    { type: "heading", level: 2, text: "noto'g'ri sarlavha" },
    { type: "paragraph", text: Array(115).fill("birinchi").join(" ") },
    { type: "formula", number: 1, latex: "x=1" },
    { type: "heading", level: 2, text: "yana noto'g'ri" },
    { type: "paragraph", text: Array(85).fill("ikkinchi").join(" ") },
  ];

  assert.deepEqual(countSectionWords({ content }), [115, 85]);
  const clamped = clampChapterContent(chapter, content, 1, 1.15);
  assert.deepEqual(countSectionWords({ content: clamped }), [115, 85]);
  assert.equal(countWords(clamped), 200);
  assert.deepEqual(clamped.filter(item => item.type === "heading").map(item => item.text), ["1.1. Birinchi", "1.2. Ikkinchi"]);
  assert.equal(clamped.some(item => item.type === "formula"), true);

  const overLimit = clampChapterContent(chapter, [
    { type: "heading", level: 2, text: "1.1. Birinchi" },
    { type: "paragraph", text: Array(120).fill("uzun").join(" ") },
    { type: "heading", level: 2, text: "1.2. Ikkinchi" },
    { type: "paragraph", text: Array(85).fill("ikkinchi").join(" ") },
  ], 1, 1.15);
  assert.deepEqual(countSectionWords({ content: overLimit }), [115, 85]);
});

test("REJA sahifasida faqat Kirish, asosiy sarlavhalar, Xulosa va adabiyotlar chiqadi", () => {
  const items = buildRejaItems([
    { id: "intro", title: "Kirish" },
    { id: "ch1", title: "Tuzilish", sections: [{ title: "Ichki band 1" }, { title: "Ichki band 2" }] },
    { id: "ch2", title: "Atmosferalar", sections: [{ title: "Ichki band 3" }] },
    { id: "conclusion", title: "Xulosa" },
  ]);
  assert.deepEqual(items.map(item => item.num ? `${item.num}. ${item.text}` : item.text), [
    "Kirish", "1. Tuzilish", "2. Atmosferalar", "Xulosa", "Foydalanilgan adabiyotlar",
  ]);
  assert.ok(items.every(item => item.level === 1));
});

test("chapter normalization subsection headinglarni yagona rejaga moslab, matnni yo'qotmaydi", () => {
  const chapter = {
    id: "ch1",
    sections: [
      { title: "1.1. Nazariy asoslar", word_target: 405 },
      { title: "Tahlil", word_target: 405 },
      { title: "Xulosa qilmaydigan yangi jihat", word_target: 405 },
    ],
  };
  const words = Array.from({ length: 9 }, (_, i) => ({
    type: "paragraph",
    text: Array(135).fill(`matn${i}`).join(" "),
  }));
  const generated = [
    { type: "heading", level: 2, text: "wrong title" },
    ...words.slice(0, 3),
    { type: "heading", level: 2, text: "another wrong title" },
    ...words.slice(3, 6),
    ...words.slice(6),
  ];
  const normalized = normalizeChapterContent(chapter, generated, 1);
  const sectionHeadings = normalized.filter(item => item.type === "heading");
  assert.deepEqual(sectionHeadings.map(item => item.text), [
    "1.1. Nazariy asoslar",
    "1.2. Tahlil",
    "1.3. Xulosa qilmaydigan yangi jihat",
  ]);
  assert.deepEqual(countSectionWords({ content: normalized }), [405, 405, 405]);
  assert.equal(countWords(normalized), 1215);
  assert.equal(chapterMainNumber([{ id: "intro" }, { id: "ch1" }, { id: "ch2" }], 2), 2);
});

test("bo'sh section body kontent bloklarini xato tarzda oxirgi bo'limga yig'maydi", () => {
  const normalized = normalizeChapterContent({
    id: "ch1",
    sections: [{ title: "Birinchi" }, { title: "Ikkinchi" }, { title: "Uchinchi" }],
  }, [], 1);
  assert.deepEqual(countSectionWords({ content: normalized }), [0, 0, 0]);
  assert.equal(normalized.filter(item => item.type === "heading").length, 3);
});
