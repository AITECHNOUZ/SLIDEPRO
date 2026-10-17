// src/mustaqil/prompt.js
// Mustaqil ish uchun LLM strategiyasi:
//   1) outline вЂ” tuzilma + so'z maqsadlari + media slot rejalari
//   2) chapter prose-only matni; media payloadlari alohida, type-specific promptlarda yaratiladi
//
// TAKRORLANISHNI OLDINI OLISH MEXANIZMI:
//   Outline'dagi formula/chart/flowchart rejalari har bir media so'roviga stable slot ID beradi.
//   Payloadlar natijadan qat'i nazar shu ID bo'yicha birlashtiriladi; parallel workerlar concurrency bilan cheklanadi.

// Calibrated against the DOCX layout (A4, Times New Roman 14pt, 1.5 spacing).
const { normalizeHeadingTitle } = require("./headings");
const { MIN_DIAGRAM_COUNT, resolveDiagramQuotas, resolveFormulaQuota } = require("./media-requirements");
const { buildFlowchartCaption } = require("./flowchart-data");
const { classifyGraphvizType, classifyMatplotlibType } = require("./diagram-types");
const { getFlowchartTemplate } = require("./flowchart-templates");
// The final rendered DOCX measured 274.9 words/page (median 281) across seven full image-free pages.
// Use 265 as a conservative target after excluding cover, outline, media pages, and spill pages.
const WORDS_PER_PAGE = 265;
// Leave vertical margin for the conclusion heading, three paragraphs, and DOCX spacing.
const CONCLUSION_WORD_TARGET = 220;
const FIXED_PAGE_COUNT = 5; // muqova, reja, kirish, xulosa, adabiyotlar — har biri 1 bet
const SECTION_PAGES = 1.5;
const MEDIA_PAGE_ALLOWANCE = 2; // formula/rasm/grafik/jadval sababli ruxsat etilgan qo'shimcha betlar
const SECTION_WORD_TARGET = Math.round(WORDS_PER_PAGE * SECTION_PAGES);

function pagePlan(pages) {
  const numericPages = Number(pages);
  const requestedPages = Number.isFinite(numericPages) ? Math.max(10, Math.floor(numericPages)) : 10;
  const mainChapterCount = 3 + Math.floor((requestedPages - 10) / 5);
  let subsectionCount = mainChapterCount;
  let sectionCounts;
  let mainPageBudget;
  let plannedPages;
  do {
    sectionCounts = Array(mainChapterCount).fill(Math.floor(subsectionCount / mainChapterCount));
    for (let i = 0; i < subsectionCount % mainChapterCount; i++) sectionCounts[i]++;
    // Each main section starts on a fresh page; media overage is budgeted separately.
    mainPageBudget = sectionCounts.reduce((sum, count) => sum + Math.ceil(SECTION_PAGES * count), 0);
    plannedPages = FIXED_PAGE_COUNT + mainPageBudget;
    if (plannedPages < requestedPages) subsectionCount++;
  } while (plannedPages < requestedPages);

  return {
    requestedPages,
    pages: plannedPages,
    mediaPageAllowancePages: MEDIA_PAGE_ALLOWANCE,
    maxExpectedPages: plannedPages + MEDIA_PAGE_ALLOWANCE,
    addedPages: plannedPages - requestedPages,
    mainChapterCount,
    mainPageBudget,
    subsectionCount,
    sectionCounts,
    introWordTarget: WORDS_PER_PAGE,
    conclusionWordTarget: CONCLUSION_WORD_TARGET,
    sectionWordTarget: SECTION_WORD_TARGET,
    totalWords: WORDS_PER_PAGE + CONCLUSION_WORD_TARGET + subsectionCount * SECTION_WORD_TARGET,
  };
}

function wordsForPages(pages) {
  return pagePlan(pages).totalWords;
}

const MAIN_ASPECTS = [
  "nazariy asoslari va asosiy tushunchalari",
  "tarkibiy qismlari va ishlash mexanizmlari",
  "amaliy qo'llanilishi va tahlili",
  "muammolari va ularni hal etish yo'llari",
  "rivojlanish istiqbollari va samaradorligi",
];
const SECTION_ASPECTS = [
  "nazariy asoslari va asosiy tushunchalar",
  "tarkibiy qismlari va muhim omillar",
  "amaliy qo'llanilishi",
  "tahlil usullari va natijalari",
  "muammolar va rivojlanish istiqbollari",
];

function cleanPlanTitle(title) {
  return normalizeHeadingTitle(title, { stripNumbering: true });
}

function uniquePlanTitle(title, used, fallback) {
  const base = cleanPlanTitle(title);
  let candidate = base && !used.has(base.toLocaleLowerCase()) ? base : cleanPlanTitle(fallback);
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${cleanPlanTitle(fallback)} — ${suffix++}`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function fallbackMainTitle(topic, index) {
  return `${String(topic || "Mavzu").trim()}: ${MAIN_ASPECTS[index % MAIN_ASPECTS.length]}`;
}

function defaultFlowchartPlan(topic, ordinal, language = "o'zbek", chapterTitle = "") {
  const subject = String(topic || "Mavzu").trim();
  let plan;
  if (ordinal === 0) {
    plan = {
      title: `${subject}: besh asosiy tarkibiy unsur`,
      purpose: `${subject} mavzusidagi besh asosiy tushuncha va ularning o'zaro bog'lanishini ixcham ko'rsatish`,
    };
  } else {
    plan = {
      title: `${subject}: omillar va natijalar bog'lanishi`,
      purpose: `${subject} bo'yicha asosiy omillar, tarkibiy qismlar va natijalar orasidagi sodda aloqalarni ko'rsatish`,
    };
  }
  plan.diagram_type = classifyGraphvizType({ topic: subject, chapterTitle, planTitle: plan.title, purpose: plan.purpose });
  plan.caption = buildFlowchartCaption(plan, plan.purpose, language);
  return plan;
}

function flowchartChapterPriority(chapter, ordinal, index) {
  const sectionTitles = Array.isArray(chapter.sections) ? chapter.sections.map(section => section?.title || "") : [];
  const text = [chapter.title || "", chapter.role || "", ...sectionTitles].join(" ").toLocaleLowerCase();
  const patterns = ordinal === 0
    ? [/tarkib|tuzil|struktur|arxitekt|model|asos|prinsip|blok/]
    : [/ishlash|boshqar|rostla|amaliy|jarayon|tarkib|aloqa|omil|qo'llan|qo‘llan|metod|loyih/];
  return (patterns.some(pattern => pattern.test(text)) ? 10 : 0) - index / 100;
}

function normalizeOutlineForPages(outline, { pages, topic, language, studentName, studentGroup, org, supervisor, flowchartCount = null, chartCount, formulaCount, formulaPlans = [], chartPlans = [] } = {}) {
  const plan = pagePlan(pages);
  const diagramQuotas = resolveDiagramQuotas(plan.mainChapterCount, { flowchartCount, chartCount });
  const formulaQuota = resolveFormulaQuota(plan.mainChapterCount, { formulaCount, topic });
  if (formulaQuota > plan.mainChapterCount) {
    throw new Error(`${formulaQuota} ta formula uchun kamida ${formulaQuota} ta asosiy bo'lim kerak; sahifa rejasi esa ${plan.mainChapterCount} ta bo'lim beradi.`);
  }
  const chartQuota = diagramQuotas.chartCount;
  const safeOutline = outline && typeof outline === "object" && !Array.isArray(outline) ? outline : {};
  const sourceChapters = Array.isArray(safeOutline.chapters)
    ? safeOutline.chapters.filter(chapter => chapter && typeof chapter === "object")
    : [];
  const isIntro = (chapter) => chapter.id === "intro" || chapter.role === "introduction" || /^kirish$/i.test(String(chapter.title || "").trim());
  const isConclusion = (chapter) => chapter.id === "conclusion" || chapter.role === "conclusion" || /^xulosa$/i.test(String(chapter.title || "").trim());
  const isReferences = (chapter) => /reference|bibliography/i.test(`${chapter.id || ""} ${chapter.role || ""}`) || /^(foydalanilgan adabiyotlar(?: ro'yxati)?|adabiyotlar(?: ro'yxati)?|references|bibliography)$/i.test(String(chapter.title || "").trim());
  const introSource = sourceChapters.find(isIntro) || {};
  const conclusionSource = sourceChapters.find(isConclusion) || {};
  const mainSources = sourceChapters.filter((chapter) => !isIntro(chapter) && !isConclusion(chapter) && !isReferences(chapter));
  const mainChapters = mainSources.slice(0, plan.mainChapterCount);
  while (mainChapters.length < plan.mainChapterCount) {
    const index = mainChapters.length;
    mainChapters.push({ title: fallbackMainTitle(topic, index), role: ["theory", "analysis", "application", "comparison", "methodology"][index % 5] });
  }
  const desiredFlowchartCount = diagramQuotas.flowchartCount;
  const flowchartAssignments = new Map();
  mainChapters.forEach((chapter, index) => {
    if (flowchartAssignments.size >= desiredFlowchartCount) return;
    const sourcePlans = Array.isArray(chapter.flowchart_plans) ? chapter.flowchart_plans : [];
    const requested = Math.max(Number(chapter.flowchart_count) || 0, sourcePlans.length);
    if (requested <= 0) return;
    const sourcePlan = sourcePlans.find(flowchart => flowchart && typeof flowchart === "object" && flowchart.title);
    const selectedPlan = sourcePlan || defaultFlowchartPlan(topic || chapter.title, flowchartAssignments.size, language, chapter.title);
    flowchartAssignments.set(index, {
      ...selectedPlan,
      diagram_type: selectedPlan.diagram_type || classifyGraphvizType({ topic, chapterTitle: chapter.title, planTitle: selectedPlan.title, purpose: selectedPlan.purpose }),
      caption: selectedPlan.caption || buildFlowchartCaption(selectedPlan, selectedPlan.purpose, language),
    });
  });
  while (flowchartAssignments.size < desiredFlowchartCount) {
    const ordinal = flowchartAssignments.size;
    const candidates = mainChapters
      .map((chapter, index) => ({ chapter, index, score: flowchartChapterPriority(chapter, ordinal, index) }))
      .filter(candidate => !flowchartAssignments.has(candidate.index))
      .sort((left, right) => right.score - left.score);
    if (!candidates.length) break;
    const { chapter, index } = candidates[0];
    flowchartAssignments.set(index, defaultFlowchartPlan(topic || chapter.title, ordinal, language, chapter.title));
  }
  const fixedFormulaPlans = (Array.isArray(formulaPlans) ? formulaPlans : [])
    .filter(formula => (typeof formula === "string" ? formula : formula?.latex)?.trim())
    .slice(0, formulaQuota);
  const sourceFormulaPlans = mainChapters.flatMap((chapter, sourceIndex) => {
    const plans = Array.isArray(chapter.formula_plans)
      ? chapter.formula_plans
      : Array.isArray(chapter.formula_latex) ? chapter.formula_latex : [];
    return plans
      .filter(formula => (typeof formula === "string" ? formula : formula?.latex)?.trim())
      .map(plan => ({ plan, sourceIndex }));
  });
  const formulaCandidates = [
    ...fixedFormulaPlans.map(plan => ({ plan, sourceIndex: null })),
    ...sourceFormulaPlans,
  ].slice(0, formulaQuota);
  const formulaAssignments = new Map();
  for (const candidate of formulaCandidates) {
    const targetIndex = Number.isInteger(candidate.sourceIndex) && !formulaAssignments.has(candidate.sourceIndex)
      ? candidate.sourceIndex
      : mainChapters.findIndex((_chapter, index) => !formulaAssignments.has(index));
    if (targetIndex >= 0) formulaAssignments.set(targetIndex, candidate.plan);
  }
  const fixedChartPlans = (Array.isArray(chartPlans) ? chartPlans : [])
    .filter(chart => chart && typeof chart === "object" && chart.title)
    .slice(0, chartQuota);
  const chartAssignments = new Map();
  const chartCandidates = mainChapters
    .map((chapter, index) => ({ chapter, index }))
    .sort((left, right) => Number(flowchartAssignments.has(left.index)) - Number(flowchartAssignments.has(right.index)) || left.index - right.index);
  const explicitClassicTypes = chartCount != null && chartQuota === 2 ? ["bar", "line"] : null;
  for (const candidate of chartCandidates) {
    if (chartAssignments.size >= chartQuota) break;
    const sourceChart = Array.isArray(candidate.chapter.chart_plans)
      ? candidate.chapter.chart_plans.find(chart => chart && typeof chart === "object" && chart.title)
      : null;
    const ordinal = chartAssignments.size;
    const fallbackTypes = ["line", "bar", "pie"];
    const chartType = explicitClassicTypes
      ? explicitClassicTypes[ordinal]
      : (["bar", "line", "pie"].includes(candidate.chapter.chart_type) ? candidate.chapter.chart_type : fallbackTypes[ordinal % fallbackTypes.length]);
    const chartPlan = fixedChartPlans[ordinal] || sourceChart || {
        title: `${candidate.chapter.title || fallbackMainTitle(topic, candidate.index)}: asosiy ko'rsatkichlar`,
        variable: `${topic || candidate.chapter.title || "Mavzu"} bo'yicha tahliliy ko'rsatkichlar`,
      };
    const diagramType = classifyMatplotlibType({
      topic,
      chapterTitle: candidate.chapter.title,
      planTitle: chartPlan.title,
      variable: chartPlan.variable,
      diagram_type: chartPlan.diagram_type,
    });
    const resolvedChartType = diagramType === "mathematical_graph" ? "line"
      : diagramType === "experiment_results" && !["bar", "line"].includes(chartType) ? "bar"
        : chartType;
    chartAssignments.set(candidate.index, {
      plan: diagramType ? { ...chartPlan, diagram_type: diagramType, chartType: resolvedChartType } : chartPlan,
      chartType: resolvedChartType,
      diagramType,
    });
  }
  const usedMainTitles = new Set();
  let tableSlotAvailable = true;

  const intro = {
    ...introSource,
    id: "intro", title: "Kirish", role: "introduction", level: 1,
    word_target: plan.introWordTarget,
    formula_count: 0, formula_plans: [], formula_latex: [],
    chart_count: 0, chart_type: null, chart_plans: [], flowchart_count: 0, flowchart_plans: [], table_count: 0, sections: [],
  };
  const normalizedMain = mainChapters.map((chapter, index) => {
    const desiredCount = plan.sectionCounts[index];
    const existingSections = Array.isArray(chapter.sections) ? chapter.sections : [];
    const usedTitles = new Set();
    const mainTitle = uniquePlanTitle(chapter.title, usedMainTitles, fallbackMainTitle(topic, index));
    const assignedFormula = formulaAssignments.get(index);
    const formulaPlans = assignedFormula ? [assignedFormula] : [];
    const assignedChart = chartAssignments.get(index);
    const chartCount = assignedChart ? 1 : 0;
    const assignedFlowchart = flowchartAssignments.get(index);
    const flowchartCount = assignedFlowchart ? 1 : 0;
    const flowchartPlans = assignedFlowchart ? [assignedFlowchart] : [];
    const tableCount = tableSlotAvailable && Number(chapter.table_count) > 0 ? 1 : 0;
    if (tableCount) tableSlotAvailable = false;
    const sections = Array.from({ length: desiredCount }, (_, sectionIndex) => {
      const fallback = `${mainTitle}: ${SECTION_ASPECTS[sectionIndex % SECTION_ASPECTS.length]} (${sectionIndex + 1})`;
      const title = uniquePlanTitle(existingSections[sectionIndex]?.title, usedTitles, fallback);
      return {
        ...(existingSections[sectionIndex] || {}),
        id: `ch${index + 1}_${sectionIndex + 1}`,
        title,
        level: 2,
        word_target: plan.sectionWordTarget,
      };
    });
    return {
      ...chapter,
      id: `ch${index + 1}`,
      title: mainTitle,
      role: chapter.role || ["theory", "analysis", "application", "comparison", "methodology"][index % 5],
      level: 1,
      sections,
      formula_count: formulaPlans.length,
      formula_plans: formulaPlans,
      formula_latex: formulaPlans.map(formula => typeof formula === "string" ? formula : formula.latex),
      chart_count: chartCount,
      chart_type: chartCount ? assignedChart.chartType : null,
      chart_plans: chartCount ? [assignedChart.plan] : [],
      flowchart_count: flowchartCount,
      flowchart_plans: flowchartPlans,
      table_count: tableCount,
      word_target: desiredCount * plan.sectionWordTarget,
    };
  });
  const conclusion = {
    ...conclusionSource,
    id: "conclusion", title: "Xulosa", role: "conclusion", level: 1,
    word_target: plan.conclusionWordTarget,
    formula_count: 0, formula_plans: [], formula_latex: [],
    chart_count: 0, chart_type: null, chart_plans: [], flowchart_count: 0, flowchart_plans: [], table_count: 0, sections: [],
  };

  return {
    ...safeOutline,
    meta: {
      ...(safeOutline.meta && typeof safeOutline.meta === "object" ? safeOutline.meta : {}),
      title: safeOutline.meta?.title || topic || "Mustaqil ish",
      type: safeOutline.meta?.type || "MUSTAQIL ISH",
      org: org || "O'quv muassasasi",
      department: safeOutline.meta?.department || "Tegishli bo'lim",
      student_name: studentName || "F.I.Sh.",
      student_group: studentGroup || "—",
      supervisor: supervisor || "O'qituvchi",
      city: safeOutline.meta?.city || "Shahar",
      year: String(new Date().getFullYear()),
      language: safeOutline.meta?.language || language || "o'zbek",
    },
    total_words_target: plan.totalWords,
    chapters: [intro, ...normalizedMain, conclusion],
    references: Array.isArray(safeOutline.references)
      ? safeOutline.references.filter(reference => typeof reference === "string" && reference.trim()).map(reference => reference.trim()).slice(0, 12)
      : [],
  };
}

// ===================== 1-BOSQICH: OUTLINE =====================
function outlineSystemPrompt() {
  return `Sen akademik mustaqil ish tuzilmasini yaratuvchi mutaxassissan. FAQAT to'g'ri JSON qaytarasan — hech qanday izoh, markdown, backtick yo'q.`;
}

function outlineUserPrompt({ topic, pages, language, studentName, studentGroup, org, supervisor, sourceContent, flowchartCount = null, chartCount = null, formulaCount = null }) {
  const plan = pagePlan(pages);
  const diagramQuotas = resolveDiagramQuotas(plan.mainChapterCount, { flowchartCount, chartCount });
  const requestedFlowcharts = diagramQuotas.flowchartCount;
  const totalWords = plan.totalWords;
  const sectionDistribution = plan.sectionCounts.map((count, index) => `asosiy bo'lim ${index + 1}: ${count}`).join(", ");
  const mediaPerTypeLimit = Math.max(1, Math.ceil(plan.mainChapterCount / 2));
  const requestedFormulas = resolveFormulaQuota(plan.mainChapterCount, { formulaCount, topic });
  if (requestedFormulas > plan.mainChapterCount) {
    throw new Error(`${requestedFormulas} ta formula uchun kamida ${requestedFormulas} ta asosiy bo'lim kerak; sahifa rejasi esa ${plan.mainChapterCount} ta bo'lim beradi.`);
  }
  const requestedCharts = diagramQuotas.chartCount;
  const mediaSectionLimit = Math.min(plan.mainChapterCount, Math.max(mediaPerTypeLimit, requestedFormulas, requestedCharts, requestedFlowcharts));
  const formulaQuotaText = `aynan ${requestedFormulas}`;
  const chartQuotaText = chartCount == null ? `kamida ${requestedCharts}` : `aynan ${requestedCharts}`;
  const lang = language || "o'zbek";
  const contentNote = sourceContent
    ? `\n\nFoydalanuvchi quyidagi manba kontentini berdi — asosiy g'oyalar va faktlar SHUNGA asoslansin. Agar unda TEKSHIRILGAN MANBALAR ro'yxati bo'lsa, adabiyotlar bo'limida faqat shu manbalarni aynan ko'chir; muallif, yil, nashr yoki sarlavhani o'zgartirma va yangi manba qo'shma:\n---\n${sourceContent.slice(0,3000)}\n---`
    : "";

  return `Akademik mustaqil ish uchun tuzilma (outline) yarat.

Talablar:
- Mavzu: "${topic}"
- Til: ${lang}
- Sahifalar: ${plan.requestedPages} bet so'ralgan; A4/14pt/1.5 spacing va amalda o'lchangan ${WORDS_PER_PAGE} so'z/bet xavfsiz me'yorida matn rejasi ${plan.pages} bet${plan.addedPages ? ` (+${plan.addedPages} bet)` : ""} (jami ≈ ${totalWords} so'z). Formula, rasm, grafik yoki jadval sabab yakuniy Word ${plan.mediaPageAllowancePages} betgacha qo'shimcha, ko'pi bilan ${plan.maxExpectedPages} bet bo'lishi mumkin.
- Talaba: ${studentName || "F.I.Sh."}, guruh: ${studentGroup || "—"}
- Muassasa: ${org || "O'quv muassasasi"}
- Rahbar: ${supervisor || "O'qituvchi"}${contentNote}

JSON strukturasida qaytargin:
{
  "meta": {
    "title": "ish nomi (mavzu asosida, aniq va qisqa)",
    "type": "MUSTAQIL ISH",
    "org": "${org || "O'quv muassasasi"}",
    "department": "tegishli kafedra yoki bo'lim",
    "student_name": "${studentName || "F.I.Sh."}",
    "student_group": "${studentGroup || "—"}",
    "supervisor": "${supervisor || "O'qituvchi"}",
    "city": "shahar",
    "year": "${new Date().getFullYear()}",
    "language": "${lang}"
  },
  "total_words_target": ${totalWords},
  "chapters": [
    {
      "id": "intro",
      "title": "Kirish",
      "role": "introduction",
      "level": 1,
      "word_target": ${plan.introWordTarget},
      "formula_count": 0,
      "formula_plans": [],
      "chart_count": 0,
      "chart_type": null,
      "chart_plans": [],
      "flowchart_count": 0,
      "flowchart_plans": [],
      "table_count": 0,
      "sections": []
    },
    {
      "id": "ch1",
      "title": "<asosiy mazmunni ifodalovchi qisqa sarlavha, raqam/prefikssiz>",
      "role": "<theory|analysis|application|comparison|methodology>",
      "level": 1,
      "word_target": <raqam>,
      "formula_count": <0 yoki 1>,
      "formula_plans": [
        {"latex": "<to\'g\'ri LaTeX>", "concept": "<bu formula nimani ifodalaydi вЂ” boshqa asosiy bo'limda xuddi shu konsept ISHLATILMASIN>"}
      ],
      "chart_count": <0 yoki 1>,
      "chart_type": "<bar|line|pie>",
      "chart_plans": [
        {"diagram_type": "<mathematical_graph yoki experiment_results, faqat mazmunan mos bo'lsa>", "title": "<grafik sarlavhasi>", "variable": "<qaysi o'zgaruvchi/ma'lumot ko'rsatiladi вЂ” boshqa asosiy bo'limda xuddi shu ma'lumot ISHLATILMASIN>", "functions": [{"name":"f(x)","expression":"<matematik grafik uchun aniq funksiya>"}], "x_min": -5, "x_max": 5, "labels": ["<sinov sharti>"], "series": [{"name":"<seriya>","values":[<qiymatlar>]}], "unit": "<birlik>"}
      ],
      "flowchart_count": <0 yoki 1>,
      "flowchart_plans": [
        {"diagram_type": "<functional_block_diagram|algorithm_flowchart|pid_control_system|uml_software_architecture|process_sequence>", "title": "<mazmunga mos sarlavha>", "purpose": "<sxema nimani tushuntiradi>", "caption": "<sxema haqida qisqa o'zbekcha izoh>"}
      ],
      "table_count": <0 yoki 1>,
      "sections": [
        {"id":"ch1_1","title":"<kichik bo'lim>","level":2,"word_target":${plan.sectionWordTarget}}
      ]
    },
    {
      "id": "conclusion",
      "title": "Xulosa",
      "role": "conclusion",
      "level": 1,
      "word_target": ${plan.conclusionWordTarget},
      "formula_count": 0,
      "formula_plans": [],
      "chart_count": 0,
      "chart_type": null,
      "chart_plans": [],
      "flowchart_count": 0,
      "flowchart_plans": [],
      "table_count": 0,
      "sections": []
    }
  ],
  "references": [
    "<APA: Muallif, A. A. (yil). Asar nomi. Nashriyot.>",
    ...
  ]
}

TUZILMA QOIDALARI:
- DAIM: 1 ta Kirish (id="intro") в†’ asosiy bo'limlar в†’ 1 ta Xulosa (id="conclusion")
- Asosiy bo'limlar soni ANIQLIK BILAN ${plan.mainChapterCount} ta bo'lsin.
- JSON ichidagi sections — asosiy matnning ichki reja bandlari; ular asosiy matnda ishlatiladi, ammo REJA sahifasida hech qachon chiqarilmaydi.
- Ichki reja bandlari jami ANIQLIK BILAN ${plan.subsectionCount} ta; asosiy bo'limlar bo'yicha taqsimot: ${sectionDistribution}.
- Har bir ichki reja bandi ${SECTION_PAGES} sahifa / ${plan.sectionWordTarget} so'zga mo'ljallansin; bo'lim word_target qiymati ichki reja bandlari yig'indisiga teng.
- Kirish ${plan.introWordTarget}, Xulosa ${plan.conclusionWordTarget} so'zdan oshmasin; ikkalasida ham ichki sarlavha bo'lmasin.
- Matnli sahifa hisobi fixed 5 sahifa va har bir ichki reja bandiga 1,5 sahifa asosida tuziladi; media sababli 2 betlik ortiqcha joy alohida ruxsat etilgan.
- Mavzuning matematik/miqdoriy darajasi bo'yicha butun ishga aynan ${requestedFormulas} ta formula, ${chartQuotaText} miqdoriy grafik, aynan ${requestedFlowcharts} ta Graphviz oqim sxemasi va ko'pi bilan 1 jadval rejalashtir; har bir asosiy bo'limga ko'pi bilan bittadan formula, grafik va oqim sxemasi ber. Formula sonini ushbu kvotaga mos to'liq rejalashtir, kamaytirma va tavsifiy mavzuga filler formula qo'shma.
- Miqdoriy grafiklar va Graphviz oqim sxemalarining jami kamida ${MIN_DIAGRAM_COUNT} ta bo'lsin; bu uchta bilan cheklanadigan yuqori limit emas — mavzu va sahifa rejasi imkon bersa, undan ko'proq diagramma rejalashtir va chiqar.
- Media bandlarini ko'pi bilan ${mediaSectionLimit} ta asosiy bo'limda jamla; formula va grafiklarni bir-biriga yaqin joylashtir, Kirish va Xulosada media ishlatma.
- Jami aynan ${requestedFlowcharts} ta Graphviz sxemasi rejalashtir; har biriga mavzu va bo'lim mazmuniga mos diagram_type ber: functional_block_diagram, algorithm_flowchart, pid_control_system, uml_software_architecture yoki process_sequence. Algoritm bo'lsa standart start/end/qaror belgilarini, PID bo'lsa yopiq teskari aloqani, UML bo'lsa haqiqiy komponent/klass munosabatlarini, jarayon ketma-ketligi bo'lsa chapdan o'ngga qadamlarni tanla; boshqa mavzuga mos bo'lmagan tur yoki generic chizma qo'llama. Har bir sxemada ko'pi bilan 5 ta tugun bo'lsin; Kirish va Xulosada sxema bo'lmasin.
- Har asosiy bo'lim BOSHQA JIHATNI yoritsin: nazariy / amaliy / taqqoslov / prognoz
- Sarlavhalarga strukturaviy yorliq yoki raqam prefiksi yozma — dastur raqamlarni o'zi qo'shadi.
- Asosiy va ichki sarlavhalar lo'nda, faqat mazmunni ifodalovchi bo'lsin (odatda 3–10 so'z); kirish so'zlari, takroriy mavzu nomi va izohlarni sarlavhaga qo'shma.
- word_target yig'indisi aynan ${totalWords} bo'lsin. Faqat belgilangan ichki bo'limlarni yarat; ortiqcha sarlavha qo'shma.

FORMULALAR (mavzuning matematik/miqdoriy xususiyatiga qarab):
- ANIQ FANLAR (matematika, fizika, kimyo, muhandislik, iqtisodiyot, CS, biologiya):
  * Butun ish bo'yicha ${formulaQuotaText} ta formula; bir asosiy bo'limda ko'pi bilan 1 ta. ${requestedFormulas === plan.mainChapterCount ? "Har bir asosiy bo'limga aynan bittadan rejalashtir." : "Rejalashtirilgan formulalar soni umumiy kvotaga aynan teng bo'lsin."}
  * formula_plans[] da har formula uchun "latex" VA "concept" ko'rsatilsin
  * concept: shu formulaning qanday fizikaviy/matematik hodisani ifodalashini aniq yoz

  вљ пёЏ MUHIM вЂ” FORMULALAR MURAKKAB VA MAVZUGA AYNAN MOS BO'LSIN:
  - Maktabdagi sodda formulalar (F=ma, E=mcВІ, s=vt) YETARLI EMAS
  - Mavzu darajasiga mos professional formulalar kerak:
    * Differensial tenglamalar (dy/dt = f(x,y), в€‚ВІu/в€‚tВІ = cВІв€‡ВІu)
    * Integrallar (в€«f(x)dx, в€®FВ·dr)
    * Matritsalar va vektorlar (AВ·x = b, det(A))
    * Transfer funksiyalari (G(s) = K/(Ts+1), PID rostlash uchun)
    * Statistik formulalar (regressiya, dispersiya, korrelyatsiya)
    * Soha-spetsifik (Reynolds, Nusselt, Arrhenius, Bernoulli va h.k.)
  - Faqat mavzuga AYNAN mos formula вЂ” umumiy "klassik" formulalar emas
  - Misol "Texnologik jarayonlarda rostlash qonuni" в†’ PID rostlagich G(s)=Kp+Ki/s+KdВ·s,
    Laplace tenglamasi, transfer funksiyasi вЂ” sodda F=ma EMAS

  * KONSEPT DARAJASIDA TAKRORLANMAYDI вЂ” notation farq qilsa ham, bir xil hodisa BO'LMASIN
  * Misol ch1: concept="PID rostlagichning uzluksiz vaqt domeni transfer funksiyasi"
            ch2: concept="Laplace tenglamasidan diskret raqamli rostlash algoritmiga o'tish"
- Sof tavsifiy, gumanitar yoki umumiy mavzularda (aniq miqdoriy tahlil bo'lmasa): formula_count:0, formula_plans:[]

GRAFIKLAR (butun ish bo'yicha ${chartQuotaText} ta; har asosiy bo'limda 0 yoki 1 ta):
- Aynan 2 ta grafik so'ralganda, klassik statistik ko'rinishlar sifatida bitta "bar" va bitta "line" tanla; har birining ma'lumoti boshqa bo'lsin.
- "line"  в†’ vaqt dinamikasi, o'zgarish tendensiyasi (X=yillar/oylar)
- "bar"   в†’ kategoriyalar taqqoslash, miqdoriy farqlar
- "pie"   в†’ ulush, foiz taqsimot (max 5 bo'lak)
- Har bir chart_count va chart_plans soni o'zaro mos bo'lsin; diagrammalarni mavzu va sahifa rejasi imkon berganicha ko'proq rejalashtirish mumkin.
- Grafik turlarini mavjud chartlar orasida xilma-xil tanla; ma'lumot/variable takrorlanmasin.
- chart_plans[] da har grafik uchun "title" VA "variable" ko\'rsatilsin
  * variable: bu grafikda qaysi ma\'lumot/o\'zgaruvchi tahlil qilinadi
  * VARIABLE DARAJASIDA TAKRORLANMAYDI вЂ” sarlavha farq qilsa ham, bir xil ma\'lumot BO\'LMASIN
  * Misol ch1: variable="yillar bo\'yicha harorat o\'zgarishi (В°C, 1990-2020)"
            ch2: variable="mintaqalar bo\'yicha yog\'ingarchilik miqdori (mm, 2023)"
  * Bu ikki variable hech qachon bir biriga o\'xshamaydi
- Grafik matematik funksiya/equation bo'lsa diagram_type="mathematical_graph" deb belgila: Matplotlib chizadigan aniq funksiyalar va chegaralar keyingi media so'rovida beriladi.
- Grafik tajriba, laboratoriya yoki kuzatuv natijasi bo'lsa diagram_type="experiment_results" deb belgila; Matplotlib bilan ko'pi bilan 5 ta taqqoslanadigan seriya chiziladi.
- mathematical_graph uchun chart_plans'da kamida bitta aniq funksiya ifodasi va x_min/x_max ko'rsat; experiment_results uchun mazmunga oid label, birlik va nomlangan series'larni rejalashtir.
- Matematik yoki tajriba mazmuni bo'lmasa, bu ikki diagram_type'dan birini sun'iy ravishda yozma; chartni faqat mavzu mazmuni haqiqiy miqdoriy taqqoslashga asos bersa rejalashtir.

JADVALLAR: butun ish bo'yicha ko'pi bilan 1 ta, ixtiyoriy asosiy bo'lim uchun

ADABIYOTLAR (references): AYNAN 12 ta yozuv, APA 7 formatida va to'liq bibliografik maydonlari bilan:
- 12 ta yozuv ichida asl nashr tili o'zbek, rus va ingliz bo'lgan kamida bittadan manba bo'lsin. Tilni faqat manbaning ASL TILDAGI SARLAVHASI bo'yicha hisobla; tarjima asarlar, tarjima sarlavhalari, izohlar yoki "o'zbekcha/ruscha/inglizcha" yorliqlari til qamrovi hisoblanmaydi.
- Sarlavha va nashr ma'lumotlarini asl yozuvi va asl tilida saqla; o'zbek manbasi o'zbekcha, rus manbasi ruscha, ingliz manbasi inglizcha bo'lsin. Tarjima qilingan nom bilan asl til manbasi sifatida ko'rsatma.
- Kitob/hisobot: Muallif yoki tashkilot. (yil). Asar nomi. Nashriyot.
- Jurnal maqolasi: Muallif, A. A. (yil). Maqola nomi. Jurnal nomi, jild(son), sahifalar yoki maqola raqami. DOI/URL.
- Haqiqiy va mavzuga mos manbalarni topa olmasang, yetishmayotgan o'rinlarni mavzuga mos, mantiqan realistik APA yozuvlari bilan to'ldir. Bibliografiya yozuvlariga AI, sintetik, tekshirish yoki boshqa belgi, yorliq yoxud izoh qo'shma; soxta DOI/URL yoki tekshirilmagan jild, son, sahifa ham qo'shma.
- Foydalanuvchi bergan tekshirilgan manbalarning metadata'sini o'zgartirma; ular 12 taga yoki uch til qamroviga yetmasa, qolgan o'rinlarni yuqoridagi standart APA yozuvlari bilan to'ldir.
- Noaniq umumiy yozuvlarni haqiqiy manba sifatida ko'rsatma. Har bir yozuv APA 7 muallif, yil, sarlavha va nashriyot/jurnal maydonlari tartibida bo'lsin.

Faqat JSON qaytar`;
}

function repairTruncatedJson(s) {
  // S2-T4: token limitiga urilib kesilgan JSON ni yopish
  let inStr = false, esc = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  out = out.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  if (inStr) out += '"';
  while (stack.length) out += stack.pop();
  return out;
}
function parseOutline(text) {
  const clean = text.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
  try {
    const value = JSON.parse(clean);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON root object bo'lishi kerak");
    return value;
  }
  catch(e) {
    const s=clean.indexOf("{"), end=clean.lastIndexOf("}");
    if(s>=0&&end>s) {
      try {
        const value = JSON.parse(clean.slice(s,end+1));
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch(_) {}
    }
    // S2-T4: kesilgan JSON tiklovchi (token limit)
    if (s>=0) {
      try {
        const value = JSON.parse(repairTruncatedJson(clean.slice(s)));
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch(_) {}
    }
    throw new Error("Outline JSON o'qilmadi: "+clean.slice(0,200));
  }
}

// ===================== 2-BOSQICH: CHAPTER CONTENT =====================
function chapterSystemPrompt() {
  return `Sen akademik mustaqil ish yozuvchisi mutaxassissan. FAQAT to'g'ri JSON qaytarasan вЂ” hech qanday izoh, markdown, backtick yo'q. Akademik, rasmiy, chuqur tahliliy uslubda yoz. Tuzilma nomlari uchun faqat "asosiy bo'lim" yoki "reja bandi" iboralarini tanla. So'zlashuv/sleng, ma'nosiz yoki noilmiy iboralar va birinchi shaxsdagi ("men") bayondan qoch; aniq texnik atamani ishlat. Manbasiz real statistika yoki aniq o'lchov natijasini uydirma.`;
}

function chapterProseUserPrompt({ chapter, outline, language, sourceContent, chapterIndex, totalChapters, mediaSlots = [] }) {
  const lang = language || "o'zbek";
  const wt = Number(chapter?.word_target) || 400;
  const isIntro = chapter?.id === "intro" || chapter?.role === "introduction";
  const isConclusion = chapter?.id === "conclusion" || chapter?.role === "conclusion";
  const isMain = !isIntro && !isConclusion;
  const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
  const sourceNote = sourceContent
    ? `\nFoydalanuvchi bergan manba kontenti (asosiy g'oyalar shunga asoslansin):\n---\n${String(sourceContent).slice(0, 2000)}\n---`
    : "";
  const headings = outline.chapters.map((item, index) => `${index + 1}. ${item.title}`).join("\n");
  const totalParagraphs = isMain ? Math.max(3, sections.length * 3) : 3;
  const perSection = sections.map((section, index) => {
    const target = Number(section.word_target) || 398;
    return `${index + 1}. ${section.title}: aynan 3 paragraf, har biri ${Math.max(1, Math.ceil(target / 3) - 5)}-${Math.ceil(target / 3)} so'z`;
  });
  const slots = Array.isArray(mediaSlots) ? mediaSlots : [];
  const slotInstructions = slots.length
    ? `\n\nMEDIA JOYLASHUV SLOT'LARI (faqat marker; media ma'lumotini generatsiya qilma):\n${slots.map(slot => `- ${slot.slot_id} (${slot.type}): mazmunan mos joyga aynan bir marta {"type":"media_slot","slot_id":"${slot.slot_id}"} markerini qo'y`).join("\n")}\nMarkerlar word countga kirmaydi; har birini faqat bir marta qaytar.`
    : "";
  const sectionGuide = isMain && sections.length
    ? `\nICHKI REJA BANDLARI — faqat matnni shu yo'nalishlarda yoz; sarlavhalarni dastur o'zi qo'shadi:\n${perSection.join("\n")}`
    : "";
  const roleGuide = isIntro
    ? "Kirish: dolzarblik, obyekt/predmet, maqsad-vazifalar, metod va ish tuzilmasini bayon qil; media marker bo'lmasin."
    : isConclusion
      ? "Xulosa: faqat ishda asoslangan natijalar, qisqa xulosalar, amaliy tavsiya va istiqbol; yangi nazariya yoki media marker bo'lmasin."
      : "Asosiy qism: mazkur reja bandining o'ziga xos jihatini dalilga asoslangan akademik matn bilan tahlil qil; faqat ko'rsatilgan media markerlarini joylashtir.";
  const paragraphGuide = isMain
    ? `Jami matn ${wt} so'zdan oshmasin; ${sections.length} ta ichki bo'lim uchun aynan ${totalParagraphs} paragraf (har bir bo'limda 3 tadan).`
    : `${chapter.title} qismi ${wt} so'zdan oshmasin va aynan 3 paragraf bo'lsin.`;

  return `Mustaqil ishning faqat matn qismini yarat. Matn ${lang} tilida, rasmiy akademik uslubda bo'lsin.
Ish: "${outline.meta?.title || "Mavzu"}". Qism: "${chapter.title}" (${chapterIndex + 1}/${totalChapters}).
${paragraphGuide}${sectionGuide}${slotInstructions}${sourceNote}

${roleGuide}
Faqat berilgan manbalarga tayangan fakt/statistikani keltir; manbasiz aniq o'lchov yoki statistikani uydirma. Birinchi shaxsda yozma, takroriy iboralarni chekla.
Umumiy reja:\n${headings}

MEDIA AJRATISH QOIDASI: formula, chart, flowchart yoki table obyektlarini, ularning qiymatlarini yoki kodini bu javobda yaratma. Ular alohida so'rovda yaratiladi. Matn oqimida faqat yuqoridagi media_slot markerlaridan foydalan.
Faqat JSON qaytar: {"chapter_id":"${chapter.id}","content":[{"type":"paragraph","text":"..."}${slots.length ? `,{"type":"media_slot","slot_id":"${slots[0].slot_id}"}` : ""}]}`;
}

function chapterUserPrompt(options) {
  if (options?.proseOnly) return chapterProseUserPrompt(options);
  const { chapter, outline, language, sourceContent, chapterIndex, totalChapters, usedFormulas = [], usedCharts = [] } = options;
  const lang = language || "o'zbek";
  const wt = chapter.word_target || 400;
  const role = chapter.role || (chapter.id === "intro" ? "introduction" : chapter.id === "conclusion" ? "conclusion" : "theory");
  const isIntro = role === "introduction";
  const isConclusion = role === "conclusion";
  const isMain = !isIntro && !isConclusion;
  const sections = Array.isArray(chapter.sections) ? chapter.sections : [];
  const sectionTarget = sections[0]?.word_target || SECTION_WORD_TARGET;
  const paraCount = isMain ? Math.max(3, sections.length * 3) : 3;
  const wordsPerParagraph = isMain ? Math.ceil(sectionTarget / 3) : Math.ceil(wt / 3);
  const minWordsPerParagraph = Math.max(1, wordsPerParagraph - 5);
  const maxWordsPerParagraph = wordsPerParagraph;
  const contentNote = sourceContent
    ? `\nManba kontent (asosiy g'oyalar shunga asoslansin):\n---\n${sourceContent.slice(0,2000)}\n---`
    : "";
  const allTitles = outline.chapters.map((c,i) => `${i+1}. ${c.title}`).join("\n");

  const mainNumber = isMain
    ? outline.chapters.slice(0, chapterIndex + 1).filter(c => c.id !== "intro" && c.id !== "conclusion").length
    : 0;
  const sectionGuide = isMain
    ? `\n\nICHKI REJA BANDLARI — aynan quyidagilarni ishlat, boshqa sarlavha qo'shma:\n${sections.map((s, i) => `${mainNumber}.${i + 1}. ${s.title} — qat'iy ${s.word_target || SECTION_WORD_TARGET} so'zdan oshmasin; aynan 3 ta paragraf, har biri ${Math.ceil((s.word_target || SECTION_WORD_TARGET) / 3) - 5}-${Math.ceil((s.word_target || SECTION_WORD_TARGET) / 3)} so'z`).join("\n")}\nMedia (formula/rasm/grafik/jadval) matn so'z limitini oshirishga asos bo'lmaydi.`
    : "";

  // BAN LIST: boshqa asosiy bo'limlarda allaqachon rejalashtirilgan + generatsiya qilingan
  // Ban-list: string + konsept/variable darajasida tekshiruv
  // Bu boshqa notation bilan bir xil konseptni oldini oladi
  const formulaBan = usedFormulas.length > 0
    ? `\n\nрџљ« TAKRORLANISHI MUMKIN BO'LMAGAN FORMULALAR (boshqa asosiy bo'limlarda allaqachon qoplangan):\n${usedFormulas.map((f,i)=>`  ${i+1}. ${f}`).join("\n")}\n\nвљ пёЏ MUHIM: Yuqoridagi formulalarni VA shu KONSEPTLARGA YAQIN formulalarni ISHLATMA.\nNotatsiya o'zgartirib ham bo'lmaydi вЂ” matematik ma'no bir xil bo'lsa TAQIQLANADi.`
    : "";

  const chartBan = usedCharts.length > 0
    ? `\n\nрџљ« TAKRORLANISHI MUMKIN BO'LMAGAN GRAFIK MA'LUMOTLAR (boshqa asosiy bo'limlarda allaqachon ko'rsatilgan):\n${usedCharts.map((c,i)=>`  ${i+1}. ${c}`).join("\n")}\n\nвљ пёЏ MUHIM: Yuqoridagi VARIABLE/MA'LUMOT TURINI ham ishlatma вЂ” sarlavha o'zgartirib ham bo'lmaydi.\nBIR XIL MA'LUMOTNI boshqa sarlavha bilan ko'rsatish ham TAKROR hisoblanadi.`
    : "";

  const chartPlan = Array.isArray(chapter.chart_plans) ? chapter.chart_plans[0] : null;
  const chartDiagramType = classifyMatplotlibType({
    topic: outline.meta?.title,
    chapterTitle: chapter.title,
    planTitle: chartPlan?.title,
    variable: chartPlan?.variable,
    diagram_type: chartPlan?.diagram_type,
  });
  const chartTypeGuide = chapter.chart_type
    ? `\nGrafik turi: "${chapter.chart_type}" (outline'da belgilangan, o'zgartirma). Diagramma semantik turi: "${chartDiagramType || "topic_specific_quantitative_chart"}".${chartDiagramType === "mathematical_graph" ? " Matplotlib uchun matematik funksiyani ifodalovchi aniq expression va x chegaralarini ko'rsat; x bo'yicha chiziq silliq, uzluksiz funksiya grafigi bo'lsin." : chartDiagramType === "experiment_results" ? " Matplotlib uchun tajriba natijalarini, birlik va guruhlarni ko'rsat; ko'pi bilan 5 ta alohida series ishlat." : " Grafik shakli mazmun va ma'lumot turiga mos bo'lsin; mazmunsiz rasm yoki uydirma tajriba natijasi qo'shma."}\n- "line": vaqt/davr yoki uzluksiz trend\n- "bar": kategoriyalarni taqqoslash\n- "pie": ulush/foiz taqsimot, ko'pi bilan 5 bo'lak`
    : "";

  const flowchartPlan = Array.isArray(chapter.flowchart_plans) ? chapter.flowchart_plans[0] : null;
  const flowchartType = classifyGraphvizType({
    topic: outline.meta?.title,
    chapterTitle: chapter.title,
    planTitle: flowchartPlan?.title,
    purpose: flowchartPlan?.purpose,
    diagram_type: flowchartPlan?.diagram_type,
  });
  const flowchartTemplate = getFlowchartTemplate(flowchartType);
  const flowchartSpecificGuide = flowchartType === "algorithm_flowchart"
    ? "Algoritm uchun 3–5 tugun ishlat: aynan bitta start va end; amal to‘rtburchak, shart romb. Qaror bo‘lsa, chiqish qirralarini Ha/Yo‘q deb belgila; sikl faqat mazmunan zarur bo‘lsa."
    : flowchartType === "pid_control_system"
      ? "PID uchun aynan 5 tugun va yopiq kontur: input → sum → controller → plant → sensor → sum. Sensorning teskari aloqasini aniq chiz."
      : flowchartType === "uml_software_architecture"
        ? "Faqat mavzudagi haqiqiy software component/class/interface/database/actor elementlari va UML munosabatlarini ishlat; dasturiy arxitektura bo‘lmagan mavzuda UML to‘qima."
        : flowchartType === "process_sequence"
          ? "Haqiqiy jarayon qadamlarini chapdan o‘ngga bajarilish/vaqt tartibida joyla; start/end/decision faqat bu aynan algoritm bo‘lsa ishlatiladi."
          : "Haqiqiy funksional kirish, qayta ishlash bloklari va chiqishni chapdan o‘ngga ko‘rsat; algoritm yoki boshqaruv konturi bo‘lmagan mavzuga shartli belgilar to‘qima.";
  const flowchartGuide = chapter.flowchart_count > 0
    ? `\nGraphviz diagramma rejasi: "${flowchartPlan?.title || chapter.title}" — ${flowchartPlan?.purpose || "bo‘lim mazmuniga mos aniq tizim yoki jarayon"}. Tanlangan o‘zgarmas tur: ${flowchartTemplate.id} (${flowchartTemplate.name}); yo‘nalish: ${flowchartTemplate.direction}. ${flowchartTemplate.topologyGuidance} ${flowchartSpecificGuide} Umumiy limit 2–5 tugun (PID aynan 5); barcha tugun, qirra va izoh mavzu, bob va reja maqsadiga bevosita mos bo‘lsin; generic yoki mavzuga aloqasiz to‘ldiruvchilarni ishlatma. Faqat ${flowchartTemplate.allowedKinds.join(", ")} kind qiymatlaridan tanla. Har tugun yorlig‘i 1–5 qisqa so‘z; qirralar 1–7 ta, tugunlar bog‘langan bo‘lsin. JSON ichida diagram_type="${flowchartTemplate.id}" yoz; matnni mavzuga mos o‘zbekcha/inglizcha ber. O‘zbekcha captionni "Izoh:" bilan yozib, mazmuniy aloqalarni 1–2 jumlada izohla. Graphviz DOT yoki kodni JSONga kiritma.`
    : "";

  // Chapter type instructions
  let typeGuide = "";
  if (isIntro) {
    typeGuide = `\n\n=== QISM: KIRISH ===
Yozish kerak:
- Mavzuning dolzarbligi va ahamiyati (aniq faktlar, statistika bilan)
- Tadqiqot ob'ekti va predmeti
- Maqsad va vazifalar (3-5 ta, ro'yxat shaklida)
- Tadqiqot uslubi
- Ishning tuzilmasi
KIRISH DA BO'LMAYDI: formula, grafik, jadval, xulosa, tavsiya`;
  } else if (isConclusion) {
    typeGuide = `\n\n=== QISM: XULOSA ===
Yozish kerak:
- Asosiy natijalar (3-5 ta, ro'yxat shaklida)
- Tadqiqot xulosasi (qisqa, aniq, isbotlangan)
- Amaliy tavsiyalar
- Kelajakdagi rivojlanish istiqbollari
XULOSA DA BO'LMAYDI: formula, grafik, jadval, yangi nazariy ma'lumotlar, ta'riflar`;
  } else {
    typeGuide = `\n\n=== ASOSIY REJA BANDI ===
Yozish kerak:
- Ushbu reja bandining o'ziga xos jihatini chuqur tahlil qilish
- Aniq faktlar, statistika, ilmiy ma'lumotlar
- Formulalar, grafiklar, jadvallar (rejaga ko'ra)
- Boshqa asosiy bo'limlardan FARQLI yangi kontent

рџљ« ASOSIY REJA BANDI ICHIDA QAT'IY TA'QIQLANGAN:
- "Kirish", "Xulosa", "Yakun", "Umumlashtirish" kabi kichik bo'limlar BO'LMASIN
- "Kirishda aytilganidek", "xulosa qilib aytganda", "yakunda" iboralar BO'LMASIN
- 1.1., 1.2., 1.3. nomli bo'limlar bevosita MAVZUNI yoritsin вЂ”
  ularda "kirish" yoki "xulosa" so'zi sarlavhada ham, matnda ham ISHLATILMAYDI
- Bu alohida mustaqil hujjat emas — Kirish va Xulosa alohida qismlar; ularni takrorlash kerak emas`;
  }

  // Outline-planned formulas + chart_plans for this chapter
  const plans = Array.isArray(chapter.formula_plans) ? chapter.formula_plans
    : (Array.isArray(chapter.formula_latex) ? chapter.formula_latex.map(l=>({latex:l,concept:""})) : []);
  const plannedFormulas = plans.length > 0
    ? `\nUshbu reja bandi uchun rejalashtirilgan formulalar (AYNAN SHULARNI ishlatgin):\n${plans.map((f,i)=>{const l=typeof f==="string"?f:f.latex; const c=typeof f==="object"&&f.concept?` вЂ” ${f.concept}`:""; return `  ${i+1}. ${l}${c}`;}).join("\n")}`
    : "";

  const lengthLimit = isMain
    ? `Jami matn ${wt} so'zdan oshmasin; har bir ichki reja bandi word_targetidan oshmasin.`
    : `${chapter.title} qismi ${wt} so'zdan oshmasin (maqsad ${wt} so'z; 3 paragraf).`;
  const paragraphLimit = isMain
    ? `Paragraflar soni taxminiy emas, QAT'IY ${paraCount} ta: har biri ${minWordsPerParagraph}-${maxWordsPerParagraph} so'z. Har bir ichki reja bandi aynan 3 paragraf, jami ko'pi bilan ${sectionTarget} so'z.`
    : `Paragraflar soni taxminiy emas, QAT'IY 3 ta: har biri ${minWordsPerParagraph}-${maxWordsPerParagraph} so'z.`;

  return `Mustaqil ishning mazkur qismini yarat.

Ish: "${outline.meta?.title || "Mavzu"}" (${lang} tilida)
Qism: "${chapter.title}" (${chapterIndex+1}/${totalChapters})
QAT'IY SO'Z CHEGARASI (matn paragrafi bo'yicha): ${lengthLimit}
${paragraphLimit} Rasm/formula/jadval/oqim sxemasi bu limitdan tashqari, lekin ularni sabab qilib matnni uzaytirma.

Formulalar: ${chapter.formula_count || 0} ta${plannedFormulas}
Grafiklar: ${chapter.chart_count || 0} ta${chartTypeGuide}
Oqim sxemalari: ${chapter.flowchart_count || 0} ta${flowchartGuide}
Jadvallar: ${chapter.table_count || 0} ta

ILMIY USLUB VA MANBA INTIZOMI:
- Rasmiy, ravon ${lang} tilida yoz; so'zlashuv, sleng, tushunarsiz yoki noilmiy iboralarni ishlatma. Masalan, "boshqaruv telbalashadi" kabi ifodalar taqiqlanadi; o'rniga texnik jihatdan aniq atama ishlat.
- Birinchi shaxsda ("men kuzatdim", "menimcha") yozma; tahlilni betaraf ilmiy bayon qil.
- Berilgan manbalar ro'yxatidan chetga chiqma; tekshirilmagan real statistika, yil, foiz yoki o'lchov natijasini keltirma.
- Graphviz ichidagi title, node va edge matnini model bergandek saqla; inglizcha so'zlar qolishi mumkin. O'zbekcha captionda sxemaning qisqa o'zbekcha izohini ber; har bir labelni alohida tarjima qilish shart emas.
- Grafik, jadval va oqim sxemasi sarlavha/captionlarida faqat media mazmunini tasvirla; meta-ma'lumot yoki status yorlig'i kiritma.

Umumiy tuzilma:
${allTitles}
${sectionGuide}${contentNote}${formulaBan}${chartBan}${typeGuide}

JSON qaytargin:
{
  "chapter_id": "${chapter.id}",
  "title": "${chapter.title}",
  "content": [ <content bloklari> ]
}

CONTENT BLOKLARI:
1. Paragraf: {"type":"paragraph","text":"..."}
   - FAKT/STATISTIKA в†’ TAHLIL в†’ XULOSA (har paragraf 3 qism)
   - Misol: "2023-yil NASA ma'lumotiga ko'ra, COв‚‚ 421 ppm ga yetdi вЂ” bu 800 ming yil ichidagi eng yuqori..."
   - Har paragraf YANGI g'oya вЂ” avvalgini boshqacha aytib yurish TA'QIQLANGAN

2. Sarlavha: {"type":"heading","level":2,"text":"1.1. ..."}

3. Formula (formula_count > 0, faqat aniq fan mavzusi):
   {"type":"formula","latex":"<yuqorida rejalashtirilgan latex>","display_text":"<inson o'qiydigan>","caption":"<nomi va mazmuni>"}
   - Formuladan OLDIN 2-3 jumla kontekst, KEYIN 2-3 jumla tahlil
   - FAQAT rejalashtirilgan formulalar — o'zboshimchalik bilan boshqa formula qo'shma
   - Formula va grafik captionlarida raqam yozma; DOCX raqamlarni hujjat bo'ylab o'zi ketma-ket qo'yadi.

4. Grafik (chart_count > 0):
   {"type":"chart","chartType":"${chapter.chart_type || "bar"}","title":"<yangi sarlavha>","labels":["..."],"values":[...],"unit":"","data_source":"<tekshiriladigan manba yoki bo'sh>","caption":"<nomi va izohi>"}
   - labels va values soni teng bo'lsin; barcha qiymatlar son, finite va shu birlikda bo'lsin; pie qiymatlari manfiy bo'lmasin.
   - Qiymatlar haqiqiy o'lchov yoki manbadan olingan bo'lishi shart emas: mavzuga mos, iloji boricha realistik diapazon, birlik va naqshlardan foydalanib, ishonarli hamda o'zaro izchil qiymatlar tuz; vaqt tendensiyasi yoki taqqoslash mazmunan mantiqli bo'lsin.
   - Haqiqiy manba promptda aniq berilmagan bo'lsa, data_source maydonini bo'sh qoldir va manba uydirma qilma. Sarlavha/captionda sintetik, AI yoki real emas kabi status yorliqlarini ishlatma; odatiy mazmuniy nom va izoh yoz.
   - labels: 4-6 ta, qisqa (1-3 so'z)
   - GRAFIKDAN OLDIN 1-2 jumla, KEYIN 1-2 jumla tahlil

5. Jadval (table_count > 0):
   {"type":"table","caption":"N-jadval. <jadval mazmunining oddiy izohi>","number":1,"headers":["..."],"rows":[["..."]]}
   - Kamida 3 ustun, 3-6 qator
   - Haqiqiy manba yoki o'lchov bo'lishi shart emas: mavzuga mos, iloji boricha realistik qiymat va tafsilotlar tuz; raqamlar diapazoni, birliklari va qatorlar orasidagi munosabatlar mantiqan izchil bo'lsin.
   - Manba aniq berilmagan bo'lsa, manba nomini uydirma qilma; sarlavha/captionda sintetik, AI yoki real emas kabi status yorliqlarini yozma.

6. Rejalashtirilgan Graphviz sxemasi (flowchart_count > 0): alohida media slot prompti bu mazmunni JSONga aylantiradi; Graphviz DOT hech qachon qaytarma.
   - diagram_type faqat functional_block_diagram, algorithm_flowchart, pid_control_system, uml_software_architecture yoki process_sequence bo‘lsin.
   - Ko‘pi bilan 5 tugun (umumiy 2–5; algoritm 3–5; PID aynan 5); har bir label qisqa va mavzuga xos. Standart shakllarni semantik turga mos ishlat; algoritmga ruxsat berilgan, lekin boshqa sxemaga algoritm belgilari qo‘shma.
   - Barcha qirralar mazmuniy aloqani ko‘rsatsin; jarayon ketma-ketligi chapdan o‘ngga, algoritm yuqoridan pastga, PID teskari aloqa konturi bilan joylashadi.
   - Bitta rejali sxemani aynan bir marta, asosiy bo'limda qaytar; tugun id'lari lotin harfi bilan boshlansin. Model inglizcha so'z yoki atama qaytarsa, Graphviz ichida aynan o'sha matn qolsin. O'zbekcha captionda butun sxemaga qisqa o'zbekcha izoh bo'lsin; har bir atamaning tarjimasi talab qilinmaydi.
   - Diagrammadan oldin va keyin 1-2 jumla izoh ber; Graphviz DOT manbasini hech qachon JSON ichida yozma.

SIFAT QOIDALARI:
- ${lang} tilida, rasmiy akademik uslub
- Mavzuning asosiy atamasi HADDAN ORTIQ TAKRORLANMASIN
- TO'LDIRUVCHI IBORALAR minimal: "shuningdek", "shu bilan birga", "muhim rol o'ynaydi", "hisoblanadi" вЂ” har biridan max 1 ta
- Muallif ovozi: kuzatuv, taqqoslash, tanqidiy baho
- Paragraf matni: LaTeX VA PASTKI CHIZIQ (_) BO'LMASIN
- Faqat JSON qaytar`;
}

function parseChapter(text) {
  const clean = text.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
  try { return JSON.parse(clean); }
  catch(e) {
    const s=clean.indexOf("{"), end=clean.lastIndexOf("}");
    if(s>=0&&end>s) { try { return JSON.parse(clean.slice(s,end+1)); } catch(_) {} }
    // S2-T4: kesilgan JSON tiklovchi (token limit)
    if (s>=0) { try { return JSON.parse(repairTruncatedJson(clean.slice(s))); } catch(_) {} }
    throw new Error("Chapter JSON o'qilmadi: "+e.message+" | "+clean.slice(0,200));
  }
}

// ===================== YORDAMCHI FUNKSIYALAR =====================
function extractFormulasFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(b => b.type === "formula" && b.latex).map(b => b.latex);
}

function extractChartTitlesFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(b => b.type === "chart" && b.title).map(b => b.title);
}

function collectUsedFormulasAndCharts(chapters) {
  const usedFormulas = [], usedCharts = [];
  for (const ch of chapters) {
    usedFormulas.push(...extractFormulasFromContent(ch.content));
    usedCharts.push(...extractChartTitlesFromContent(ch.content));
  }
  return {
    usedFormulas: [...new Set(usedFormulas)],
    usedCharts:   [...new Set(usedCharts)],
  };
}

module.exports = {
  outlineSystemPrompt, outlineUserPrompt, parseOutline,
  chapterSystemPrompt, chapterUserPrompt, parseChapter,
  WORDS_PER_PAGE, pagePlan, normalizeOutlineForPages,
  wordsForPages,
  extractFormulasFromContent, extractChartTitlesFromContent, collectUsedFormulasAndCharts,
  // Yangi: normalizatsiya va o'xshashlik tekshiruvi
  normalizeFormula, formulaSignature,
  normalizeChartPurpose,
  normalizeParagraph, paragraphSimilarity,
  detectForbiddenIntroConclusion,
};

// в”Ђв”Ђв”Ђ FORMULA NORMALIZATSIYASI в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// LaTeX o'zgaruvchi nomlari va format'idan qat'i nazar bir xil formulani aniqlash
function normalizeFormula(latex) {
  if (!latex) return "";
  let n = String(latex).toLowerCase();
  // LaTeX buyruqlarini olib tashlash
  n = n.replace(/\\(frac|cdot|times|sum|int|partial|nabla|sqrt|left|right|bigl|bigr|mathbf|mathrm|text|operatorname)\b/g, "");
  n = n.replace(/\\[a-z]+/g, "");          // boshqa buyruqlar
  // Unicode matematik operatorlar (В· Г— в‹… Г·)
  n = n.replace(/[В·Г—в‹…Г·в€—]/g, "");
  n = n.replace(/[{}\\,;:\s]/g, "");        // qavslar, bo'shliqlar
  n = n.replace(/[_^]/g, "");                // sub/super indekslar
  return n;
}

// Formula "imzosi" вЂ” konsept tushib qolsa ham operatorlar to'plami
function formulaSignature(latex) {
  if (!latex) return "";
  const n = normalizeFormula(latex);
  // Operatorlar va son turi (= + - * / ^ в€« ОЈ)
  const ops = (n.match(/[=+\-*/^]/g) || []).sort().join("");
  const nums = (n.match(/\d+/g) || []).length;
  return `ops:${ops}|n:${nums}|len:${n.length}`;
}

// в”Ђв”Ђв”Ђ CHART MAQSADI NORMALIZATSIYASI в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Grafik MA'NOSI bo'yicha tekshirish вЂ” sarlavhasi farq qilsa ham
function normalizeChartPurpose(chart) {
  if (!chart) return "";
  // Variable + chart type + labels + values diapazoni
  const labels = (chart.labels || []).map(l => String(l).toLowerCase().trim()).sort().join("|");
  const values = chart.values || [];
  const valRange = values.length ? `${Math.min(...values)}-${Math.max(...values)}` : "";
  const title = String(chart.title || "").toLowerCase().replace(/[^a-z0-9Р°-СЏСћТ“Ті\s]/gi, "").trim();
  // 5 ta birinchi muhim so'z
  const titleWords = title.split(/\s+/).filter(w => w.length > 3).slice(0, 5).sort().join("|");
  return `t:${titleWords}|lbl:${labels}|rng:${valRange}|type:${chart.chartType||"bar"}`;
}

// в”Ђв”Ђв”Ђ PARAGRAF O'XSHASHLIGI (mazmun darajasida) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function normalizeParagraph(text) {
  if (!text) return "";
  return String(text).toLowerCase()
    .replace(/[.,;:!?"'`В«В»()\[\]{}вЂ”вЂ“-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Jaccard koeffitsienti (so'z to'plamlari bo'yicha)
function paragraphSimilarity(textA, textB) {
  const a = new Set(normalizeParagraph(textA).split(" ").filter(w => w.length > 4));
  const b = new Set(normalizeParagraph(textB).split(" ").filter(w => w.length > 4));
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const w of a) if (b.has(w)) intersect++;
  const union = a.size + b.size - intersect;
  return union > 0 ? intersect / union : 0;
}

// в”Ђв”Ђв”Ђ ASOSIY REJA BANDI ICHIDA KIRISH/XULOSA ANIQLASH в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function detectForbiddenIntroConclusion(content, role) {
  if (role === "introduction" || role === "conclusion") return [];
  if (!Array.isArray(content)) return [];
  const violations = [];
  const forbidden = /^(kirish|xulosa|yakun|umumlashtirish|introduction|conclusion)\b/i;
  content.forEach((item, i) => {
    if (item.type === "heading") {
      const t = String(item.text || "").replace(/^\d+(\.\d+)?\.\s*/, "").trim();
      if (forbidden.test(t)) violations.push({ idx: i, type: "heading", text: item.text });
    }
    if (item.type === "paragraph") {
      const txt = String(item.text || "");
      // Asosiy bob ichida "xulosa qilib aytganda" kabi iboralar
      if (/^(xulosa qilib aytganda|demak,? umuman olganda|umuman olganda|yakunda|xulosa o'rnida)/i.test(txt.trim())) {
        violations.push({ idx: i, type: "paragraph_conclusion_phrase", text: txt.slice(0, 80) });
      }
      // Kirish darajasidagi iboralar asosiy bob boshida
      if (i < 2 && /^(ushbu bo'lim|bu bo'limda biz|mavzuning dolzarbligi|ushbu ishning maqsadi)/i.test(txt.trim())) {
        violations.push({ idx: i, type: "paragraph_intro_phrase", text: txt.slice(0, 80) });
      }
    }
  });
  return violations;
}
