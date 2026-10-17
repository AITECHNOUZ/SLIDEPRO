const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pagePlan,
  normalizeOutlineForPages,
  chapterUserPrompt,
} = require("../src/mustaqil/prompt");
const { resolveDiagramQuotas } = require("../src/mustaqil/media-requirements");
const {
  buildMediaSlots,
  groupMediaSlotsByChapter,
  mergeMediaSlotsIntoContent,
} = require("../src/mustaqil/media-slots");
const {
  mapWithConcurrency,
  mediaSlotPrompt,
  normalizeMediaSlotResult,
  fallbackMediaSlot,
  generateMediaSlot,
} = require("../src/mustaqil/generate");
const { normalizeChartData } = require("../src/mustaqil/chart-data");
const { normalizeFlowchartData } = require("../src/mustaqil/flowchart-data");
const { cleanMediaText } = require("../src/mustaqil/media-captions");
const { FLOWCHART_TEMPLATES } = require("../src/mustaqil/flowchart-templates");

function outlineForPages(pages) {
  return pagePlan(pages);
}

test("default Graphviz soni har 5 qo'shimcha so'ralgan betga bittadan oshadi", () => {
  const expected = [[10, 1], [15, 2], [20, 3], [25, 4]];
  for (const [pages, flowcharts] of expected) {
    const plan = outlineForPages(pages);
    const quotas = resolveDiagramQuotas(plan.mainChapterCount);
    assert.equal(quotas.flowchartCount, flowcharts, `${pages} bet`);
    assert.ok(quotas.chartCount + quotas.flowchartCount >= 3, `${pages} betda jami diagramma minimumi saqlansin`);
    const normalized = normalizeOutlineForPages({ chapters: [] }, { pages, topic: "Sinov" });
    assert.equal(normalized.chapters.reduce((sum, chapter) => sum + chapter.flowchart_count, 0), flowcharts, `${pages} bet outline rejasida`);
  }
  assert.equal(resolveDiagramQuotas(outlineForPages(15).mainChapterCount, { flowchartCount: 0 }).flowchartCount, 0, "aniq foydalanuvchi kvotasi avtomatik defaultni almashtiradi");
});

test("outline media rejalari o'zgarmas slot ID'lari va tegishli turlarni beradi", () => {
  const chapters = [{
    id: "ch1", title: "Tahlil", formula_count: 1,
    formula_plans: [{ latex: "G(s)=1/(s+1)" }],
    chart_count: 2, chart_type: "bar", chart_plans: [{ title: "A" }, { title: "B" }],
    flowchart_count: 1, flowchart_plans: [{ title: "Jarayon" }],
    table_count: 1,
    sections: [{ title: "Birinchi" }, { title: "Ikkinchi" }],
  }];
  const slots = buildMediaSlots(chapters);
  assert.deepEqual(slots.map(slot => slot.slot_id), [
    "ch1:formula:1", "ch1:chart:1", "ch1:chart:2", "ch1:flowchart:1", "ch1:table:1",
  ]);
  assert.deepEqual(slots.map(slot => slot.type), ["formula", "chart", "chart", "flowchart", "table"]);
  assert.deepEqual(groupMediaSlotsByChapter(slots).get("ch1").map(slot => slot.slot_id), slots.map(slot => slot.slot_id));
});

test("Graphviz slotlari mazmunga ko‘ra besh semantik turdan birini deterministik tanlaydi", () => {
  const scenarios = [
    ["Funksional blok-sxema", "Kirish, qayta ishlash va chiqish bloklari", "functional_block_diagram"],
    ["Algoritm blok-sxemasi", "Algoritm amallari va shart tarmoqlari", "algorithm_flowchart"],
    ["PID boshqaruv tizimi", "Sensor teskari aloqali PID konturi", "pid_control_system"],
    ["UML dastur arxitekturasi", "Dastur komponentlari va klasslar", "uml_software_architecture"],
    ["Jarayonlar ketma-ketligi", "Haqiqiy jarayon bosqichlari", "process_sequence"],
  ];
  const chapters = scenarios.map(([title, purpose], index) => ({
    id: `semantic-${index + 1}`, title, flowchart_count: 1, flowchart_plans: [{ title, purpose }],
  }));
  const selected = buildMediaSlots(chapters, { topic: "Mavzuga tegishli chizmalar" }).filter(slot => slot.type === "flowchart");
  assert.equal(FLOWCHART_TEMPLATES.length, 5);
  assert.deepEqual(selected.map(slot => slot.diagram_type), scenarios.map(([, , type]) => type));
  selected.forEach(slot => {
    assert.equal(slot.template_id, slot.diagram_type);
    assert.equal(slot.plan.diagram_type, slot.diagram_type);
    assert.equal(slot.plan.template_name, slot.template_name);
    assert.ok(slot.plan.template_guidance);
  });
});

test("Matplotlib slotlari matematik grafik va tajriba natijalarini ajratadi", () => {
  const chapters = [
    { id: "math", title: "Matematik funksiyalar grafigi", chart_count: 1, chart_type: "bar", chart_plans: [{ title: "Parabola", variable: "y = x kvadrat" }] },
    { id: "lab", title: "Tajriba natijalari", chart_count: 1, chart_type: "pie", chart_plans: [{ title: "Harorat bo‘yicha sinov", variable: "Vaqt bo‘yicha o‘lchangan konsentratsiya" }] },
  ];
  const charts = buildMediaSlots(chapters).filter(slot => slot.type === "chart");
  assert.deepEqual(charts.map(slot => slot.diagram_type), ["mathematical_graph", "experiment_results"]);
  assert.deepEqual(charts.map(slot => slot.chartType), ["line", "line"], "Matematik funksiya hamda vaqt bo‘yicha tajriba natijasi chiziqli ko‘rinishda saqlansin");
});

test("prose prompt media payloadini so'ramaydi, markerlarni esa barqaror ID bilan joylashtiradi", () => {
  const chapter = {
    id: "ch1", title: "Tahlil", role: "theory", word_target: 398,
    sections: [{ title: "Asosiy tahlil", word_target: 398 }],
  };
  const outline = { meta: { title: "Sinov" }, chapters: [chapter] };
  const prompt = chapterUserPrompt({
    chapter, outline, language: "o'zbek", chapterIndex: 0, totalChapters: 1,
    proseOnly: true,
    mediaSlots: [{ slot_id: "ch1:chart:1", type: "chart" }],
  });
  assert.match(prompt, /ch1:chart:1/);
  assert.match(prompt, /"type":"media_slot","slot_id":"ch1:chart:1"/);
  assert.match(prompt, /bu javobda yaratma/i);
  assert.doesNotMatch(prompt, /"type":"chart"/);
  assert.doesNotMatch(prompt, /"type":"formula"/);
  assert.doesNotMatch(prompt, /"type":"flowchart"/);
});

test("slot ID orqali media matnga to'g'ri birlashadi va takroriy/noma'lum markerlar e'tiborsiz qoladi", () => {
  const chapter = { id: "ch1", sections: [{ title: "Birinchi" }] };
  const slots = [
    { slot_id: "ch1:chart:1", type: "chart", sectionIndex: 0 },
    { slot_id: "ch1:flowchart:1", type: "flowchart", sectionIndex: 0 },
  ];
  const media = new Map([
    ["ch1:chart:1", { type: "chart", slot_id: "ch1:chart:1", title: "Grafik" }],
    ["ch1:flowchart:1", { type: "flowchart", slot_id: "ch1:flowchart:1", title: "Oqim" }],
  ]);
  const merged = mergeMediaSlotsIntoContent(chapter, [
    { type: "heading", level: 2, text: "Sarlavha" },
    { type: "paragraph", text: "Kirish matni." },
    { type: "media_slot", slot_id: "ch1:flowchart:1" },
    { type: "media_slot", slot_id: "unknown:chart:1" },
    { type: "media_slot", slot_id: "ch1:flowchart:1" },
    { type: "paragraph", text: "Davomi." },
  ], slots, media);
  assert.deepEqual(merged.filter(item => item.type === "chart" || item.type === "flowchart").map(item => item.slot_id), [
    "ch1:chart:1", "ch1:flowchart:1",
  ]);
  assert.equal(merged.filter(item => item.type === "media_slot").length, 0);
});

test("media LLM so'rovlari formula, grafik, Graphviz va jadval uchun qisqa strukturali JSON talab qiladi", () => {
  for (const type of ["formula", "chart", "flowchart", "table"]) {
    const prompt = mediaSlotPrompt({ slot_id: `ch1:${type}:1`, type, plan: { title: "Sinov", latex: "x=1" }, chartType: "bar" }, { topic: "Sinov", language: "uz" });
    assert.match(prompt, new RegExp(`ch1:${type}:1`));
    assert.match(prompt, new RegExp(`"type":"${type}"`));
  }
  const flowPrompt = mediaSlotPrompt({
    slot_id: "ch1:flowchart:1", type: "flowchart", diagram_type: "uml_software_architecture", template_id: "uml_software_architecture",
    plan: { title: "Suvni tozalash dasturiy modullari", purpose: "Tizim komponentlari va ma'lumotlar bazasi aloqalari", diagram_type: "uml_software_architecture" },
  }, {
    topic: "Suvni tozalash", language: "o'zbek",
    chapter: { title: "Filtrlash va sifat nazorati", role: "methodology" },
  });
  assert.match(flowPrompt, /DOT yoki kod qaytarma/);
  assert.match(flowPrompt, /Tanlangan va o‘zgarmas diagram_type: uml_software_architecture/);
  assert.match(flowPrompt, /haqiqiy dasturiy komponent, klass, interfeys/);
  assert.match(flowPrompt, /Graphviz/i);
  assert.match(flowPrompt, /Suvni tozalash/);
  assert.match(flowPrompt, /Dastur arxitekturasi bo‘lmagan mavzuda bu turdan foydalanma/);
  assert.match(flowPrompt, /generic to‘ldiruvchilar/);
  assert.match(flowPrompt, /Mavzu, bob va reja maqsadiga bevosita mos/);
  assert.match(flowPrompt, /2–5 node/);
  const algorithmPrompt = mediaSlotPrompt({
    slot_id: "ch1:flowchart:algorithm", type: "flowchart", diagram_type: "algorithm_flowchart", template_id: "algorithm_flowchart",
    plan: { title: "Suv sifatini tekshirish", purpose: "Mezonni o‘lchash va zarur bo‘lsa tozalash" },
  }, { topic: "Suv sifatini nazorat qilish", language: "o‘zbek" });
  assert.match(algorithmPrompt, /1\.92 × 3\.45 dyuym/);
  assert.match(algorithmPrompt, /yuqoridan pastga/);
  const chartPrompt = mediaSlotPrompt({ slot_id: "ch1:chart:1", type: "chart", chartType: "bar", plan: {} }, { topic: "Sinov", language: "uz" });
  assert.match(chartPrompt, /data_source maydonini bo'sh qoldir/i);
  assert.match(chartPrompt, /mavzu, reja va kontekstga mos hamda o'zaro izchil/);
  assert.match(chartPrompt, /mavzuga aloqasiz ma'lumot yoki manba uydirma qilma/);
  assert.match(chartPrompt, /manba uydirma qilma/i);
  assert.match(chartPrompt, /pie uchun ko'pi bilan 5 label va manfiy bo'lmagan qiymatlar/i);
  assert.match(chartPrompt, /Sarlavha\/captionda sintetik, AI yoki real emas kabi status yorliqlarini ishlatma/i);
  const mathPrompt = mediaSlotPrompt({ slot_id: "ch1:chart:2", type: "chart", diagram_type: "mathematical_graph", chartType: "line", plan: { title: "Parabola" } }, { topic: "Matematik funksiya", language: "uz" });
  assert.match(mathPrompt, /Matplotlib matematik grafik/);
  assert.match(mathPrompt, /501 namunaviy nuqtani hisoblab/);
  const experimentalPrompt = mediaSlotPrompt({ slot_id: "ch1:chart:3", type: "chart", diagram_type: "experiment_results", chartType: "bar", plan: { title: "Tajriba" } }, { topic: "Tajriba natijalari", language: "uz" });
  assert.match(experimentalPrompt, /Matplotlib tajriba natijalari diagrammasi/);
  assert.match(experimentalPrompt, /1–5 ta nomlangan series/);
  const tablePrompt = mediaSlotPrompt({ slot_id: "ch1:table:1", type: "table", plan: {} }, { topic: "Sinov", language: "uz" });
  assert.match(tablePrompt, /Haqiqiy manba yoki o'lchov bo'lishi shart emas/i);
  assert.match(tablePrompt, /realistik tafsilotlar va.*ishonarli raqamlar/i);
  assert.match(tablePrompt, /diapazoni, birliklari, aniqlik darajasi.*mantiqan izchil/i);
  assert.match(tablePrompt, /manba nomi yoki havolasini uydirma qilma/i);
  assert.match(tablePrompt, /kamida 3 ustun va 3–6 qator/i);
  assert.match(tablePrompt, /Sarlavha\/captionda sintetik, AI yoki real emas kabi status yorliqlarini ishlatma/i);

  const legacyChapter = {
    id: "ch1", title: "Tahlil", role: "theory", word_target: 398,
    sections: [{ title: "Asosiy tahlil", word_target: 398 }],
    chart_count: 1, chart_type: "bar", chart_plans: [{ title: "Trend" }], table_count: 1,
  };
  const legacyPrompt = chapterUserPrompt({
    chapter: legacyChapter, outline: { meta: { title: "Sinov" }, chapters: [legacyChapter] },
    language: "o'zbek", chapterIndex: 0, totalChapters: 1,
  });
  assert.match(legacyPrompt, /sarlavha\/captionlarida faqat media mazmunini tasvirla/i);
  assert.doesNotMatch(legacyPrompt, /data_source va captionda aniq yoz/i);
  assert.match(legacyPrompt, /Haqiqiy manba yoki o'lchov bo'lishi shart emas/i);
  assert.match(legacyPrompt, /iloji boricha realistik qiymat/i);
  assert.match(legacyPrompt, /Manba aniq berilmagan bo'lsa, manba nomini uydirma qilma/i);
});

test("media nomi va captionidan disclosure iboralari olinadi, oddiy izoh saqlanadi", () => {
  assert.equal(cleanMediaText("Grafik sarlavhasi. Sintetik illustrativ ma'lumot; real o'lchov emas."), "Grafik sarlavhasi");
  assert.equal(cleanMediaText("Ko'rsatkichlar (synthetic sample data; not a real measurement)"), "Ko'rsatkichlar");
  assert.equal(cleanMediaText("Sintetik simulyatsiya; haqiqiy tajriba o'lchovi emas"), "");
  assert.equal(cleanMediaText("Tahlil natijalari. For illustration only."), "Tahlil natijalari");
});

test("chart fallback haqiqiy o'lchov sifatida ko'rsatilmaydi, strukturasi renderga yaroqli", () => {
  const slot = { slot_id: "ch1:chart:1", type: "chart", chapterId: "ch1", ordinal: 1, chartType: "bar", plan: { title: "Sinov ko'rsatkichlari" } };
  const fallback = fallbackMediaSlot(slot, { chapter: { id: "ch1", title: "Tahlil" }, language: "o'zbek" });
  assert.equal(fallback.slot_id, slot.slot_id);
  assert.match(fallback.data_source, /sintetik illustrativ ma'lumot; real o'lchov emas/i);
  assert.doesNotMatch(fallback.caption, /sintetik|real o'lchov emas/i);
  assert.equal(normalizeChartData(fallback).values.length, 5);
});

test("Matplotlib fallback rejalashtirilgan funksiya va tajriba qiymatlarini saqlaydi", () => {
  const math = fallbackMediaSlot({
    slot_id: "ch1:chart:math", type: "chart", diagram_type: "mathematical_graph", chartType: "line",
    plan: { title: "Parabola", functions: [{ name: "f(x)", expression: "x**2" }], x_min: -3, x_max: 3 },
  }, { chapter: { id: "ch1", title: "Matematik tahlil" }, language: "o'zbek" });
  assert.equal(math.diagram_type, "mathematical_graph");
  assert.equal(math.chartType, "line");
  assert.deepEqual(math.functions, [{ name: "f(x)", expression: "x**2" }]);
  assert.equal(math.x_min, -3);
  assert.equal(math.x_max, 3);

  const experiment = fallbackMediaSlot({
    slot_id: "ch1:chart:experiment", type: "chart", diagram_type: "experiment_results", chartType: "bar",
    plan: { title: "Harorat sinovi", labels: ["20 °C", "30 °C"], series: [{ name: "Nazorat", values: [4.2, 3.8] }], unit: "mg/L" },
  }, { chapter: { id: "ch1", title: "Tajriba natijalari" }, language: "o'zbek" });
  assert.equal(experiment.diagram_type, "experiment_results");
  assert.deepEqual(experiment.labels, ["20 °C", "30 °C"]);
  assert.deepEqual(experiment.series, [{ name: "Nazorat", values: [4.2, 3.8] }]);
});

test("sabab–oqibat va UML ierarxik fallbacklari besh tugun limitini va yo‘nalishini saqlaydi", () => {
  const causeEffect = fallbackMediaSlot({
    slot_id: "ch1:flowchart:causes", type: "flowchart", diagram_type: "functional_block_diagram",
    plan: {
      title: "Sabab–oqibat tahlili", purpose: "Omillarning asosiy muammoga ta'siri",
      causes: ["Inson omili", "Usul", "Vositalar", "Ma'lumotlar"], outcome: "Asosiy muammo",
    },
  }, { chapter: { id: "ch1", title: "Sifat muammosining omillari" }, language: "o'zbek" });
  const normalizedCauseEffect = normalizeFlowchartData(causeEffect);
  assert.equal(normalizedCauseEffect.nodes.length, 5);
  assert.ok(normalizedCauseEffect.nodes.slice(0, 4).every(node => node.kind === "input"));
  assert.equal(normalizedCauseEffect.nodes.at(-1).kind, "output");
  assert.ok(normalizedCauseEffect.edges.every(edge => edge.to === normalizedCauseEffect.nodes.at(-1).id));

  const hierarchy = fallbackMediaSlot({
    slot_id: "ch1:flowchart:hierarchy", type: "flowchart", diagram_type: "uml_software_architecture",
    plan: { title: "Dastur arxitekturasi ierarxiyasi", purpose: "Yuqori modul va quyi komponentlar" },
  }, { chapter: { id: "ch1", title: "Tizim arxitekturasi" }, language: "o'zbek" });
  const normalizedHierarchy = normalizeFlowchartData(hierarchy);
  assert.ok(normalizedHierarchy.nodes.length >= 2 && normalizedHierarchy.nodes.length <= 5);
  assert.ok(normalizedHierarchy.edges.every(edge => edge.from === normalizedHierarchy.nodes[0].id));
});

test("media chart natijasi va formula reja bo'yicha normallashtiriladi", () => {
  const chartSlot = { slot_id: "ch1:chart:1", type: "chart", chartType: "line", plan: { title: "Vaqt bo'yicha trend" } };
  const chart = normalizeMediaSlotResult(chartSlot, {
    slot_id: chartSlot.slot_id, type: "chart", chartType: "line", title: "Boshqa sarlavha",
    labels: ["1-yil", "2-yil"], values: [1, 2], data_source: "Sintetik namunaviy ma'lumot", caption: "Trend",
  }, { chapter: { title: "Tahlil" }, language: "o'zbek" });
  assert.equal(chart.title, "Vaqt bo'yicha trend");
  assert.equal(chart.caption, "Trend");
  assert.equal(normalizeChartData(chart).chartType, "line");

  const markedChart = normalizeMediaSlotResult({ slot_id: "ch1:chart:2", type: "chart", chartType: "bar", plan: {} }, {
    slot_id: "ch1:chart:2", type: "chart", chartType: "bar", title: "Ko'rsatkichlar. Sintetik ma'lumot; real o'lchov emas",
    labels: ["A", "B"], values: [1, 2], caption: "Trend. Sintetik illustrativ ma'lumot; real o'lchov emas",
  }, { chapter: { title: "Tahlil" }, language: "o'zbek" });
  assert.equal(markedChart.title, "Ko'rsatkichlar");
  assert.equal(markedChart.caption, "Trend");

  const formulaSlot = { slot_id: "ch1:formula:1", type: "formula", ordinal: 1, plan: { latex: "G(s)=\\frac{1}{s+1}", concept: "Uzatish funksiyasi" } };
  const formula = normalizeMediaSlotResult(formulaSlot, {
    slot_id: formulaSlot.slot_id, type: "formula", latex: "G(s)=\\frac{1}{s+1}", display_text: "G(s)", caption: "Formula",
  }, { chapter: { title: "Model" }, language: "o'zbek" });
  assert.equal(formula.latex, formulaSlot.plan.latex);

  const tableSlot = { slot_id: "ch1:table:1", type: "table", ordinal: 1, plan: {} };
  const table = normalizeMediaSlotResult(tableSlot, {
    slot_id: tableSlot.slot_id, type: "table", title: "Jadval. Sintetik ma'lumot; real o'lchov emas", caption: "Bosqichlar taqqoslanishi. Sintetik ma'lumot; real o'lchov emas",
    headers: ["Bosqich", "Amal", "Natija"],
    rows: [["1", "A", "B"], ["2", "C", "D"], ["3", "E", "F"]],
  }, { chapter: { title: "Jarayon" }, language: "o'zbek" });
  assert.equal(table.synthetic, true);
  assert.equal(table.title, "Jadval");
  assert.equal(table.caption, "Bosqichlar taqqoslanishi");
  assert.doesNotMatch(table.title, /sintetik|real o'lchov emas/i);
});

test("chart va jadval bitta AI so'rovi bilan yakunlanadi, bo'sh javob non-empty deterministic fallback oladi", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages.find(message => message.role === "user")?.content || "";
    requests.push(prompt);
    const content = prompt.includes("Slot ID: ch1:chart:1")
      ? JSON.stringify({
        slot_id: "ch1:chart:1", type: "chart", chartType: "bar", title: "Sinov trendi",
        labels: ["A", "B", "C"], values: [42, 53, 61], unit: "%", data_source: "", caption: "Ko'rsatkichlar taqqoslanishi",
      })
      : "";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const llm = { provider: "openai", openaiKey: "mock-key", openaiModel: "mock-model" };
  try {
    const accepted = await generateMediaSlot({
      slot_id: "ch1:chart:1", type: "chart", ordinal: 1, chartType: "bar", plan: { title: "Sinov trendi" },
    }, { chapter: { id: "ch1", title: "Tahlil" }, topic: "Sinov", language: "o'zbek", llm });
    assert.equal(accepted.fallback, false);
    assert.deepEqual(accepted.item.values, [42, 53, 61]);
    assert.equal(requests.length, 1, "yaroqli AI qiymatlari bitta javobdayoq qabul qilinadi");

    const blankResponse = await generateMediaSlot({
      slot_id: "ch1:table:1", type: "table", ordinal: 1, plan: { title: "Sinov jadvali" },
    }, { chapter: { id: "ch1", title: "Tahlil" }, topic: "Sinov", language: "o'zbek", llm });
    assert.equal(blankResponse.fallback, true);
    assert.ok(blankResponse.item.headers.length >= 3);
    assert.ok(blankResponse.item.rows.length >= 3);
    assert.ok(blankResponse.item.rows.every(row => row.length === blankResponse.item.headers.length));
    assert.ok(blankResponse.item.rows.flat().every(value => String(value).trim()));
    assert.doesNotMatch(
      [blankResponse.item.title, blankResponse.item.caption, ...blankResponse.item.headers, ...blankResponse.item.rows.flat()].join(" "),
      /synthetic|illustrative|illustrativ|sintetik|real o'lchov emas|AI-generated/i,
    );
    assert.equal(requests.length, 2, "bo'sh javobdan keyin yana AI so'rovi berilmaydi");
    assert.deepEqual(blankResponse.item.rows, fallbackMediaSlot({
      slot_id: "ch1:table:1", type: "table", ordinal: 1, plan: { title: "Sinov jadvali" },
    }, { chapter: { id: "ch1", title: "Tahlil" }, language: "o'zbek" }).rows);
    assert.match(requests[0], /mavzu, reja va kontekstga mos hamda o'zaro izchil/);
    assert.match(requests[0], /data_source maydonini bo'sh qoldir/);
    assert.match(requests[1], /Haqiqiy manba yoki o'lchov bo'lishi shart emas/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("yaroqsiz Graphviz ma'lumoti retryda bir xil shablonni saqlab, render qilinadigan fallback oladi", async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages.find(message => message.role === "user")?.content || "";
    prompts.push(prompt);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      slot_id: "ch1:flowchart:1", type: "flowchart", title: "Noto‘g‘ri sxema", nodes: [], edges: [],
    }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const template = FLOWCHART_TEMPLATES.find(item => item.id === "functional_block_diagram");
  const slot = {
    slot_id: "ch1:flowchart:1", type: "flowchart", ordinal: 1,
    diagram_type: template.id,
    template_id: template.id,
    plan: {
      title: "Suvni tozalash: filtrlash oqimi",
      purpose: "Suvni filtrlash va sifat mezonini tekshirish bosqichlari",
      template_id: template.id,
      template_name: template.name,
      template_description: template.description,
      template_guidance: template.topologyGuidance,
    },
  };

  try {
    const generated = await generateMediaSlot(slot, {
      chapter: { id: "ch1", title: "Suvni tozalash", role: "methodology" },
      topic: "Suvni tozalash", language: "o'zbek",
      llm: { provider: "openai", openaiKey: "mock-key", openaiModel: "mock-model" },
    });
    assert.equal(generated.fallback, true);
    assert.equal(generated.item.template_id, template.id);
    assert.equal(generated.item.title, slot.plan.title);
    assert.equal(generated.item.nodes.length, 5);
    assert.ok(generated.item.nodes.every(node => node.label.trim()));
    assert.ok(generated.item.nodes.every(node => ["input", "process", "output"].includes(node.kind)));
    assert.equal(generated.item.nodes[0].kind, "input");
    assert.equal(generated.item.nodes.at(-1).kind, "output");
    assert.match(generated.item.nodes.map(node => node.label).join(" "), /Suvni|filtrlash|sifat/i, "fallback tugunlari reja va bo‘limdagi mavzu atamalaridan tuzilsin");
    assert.doesNotMatch(generated.item.nodes.map(node => node.label).join(" "), /Boshlash|Yakunlash|Start|Finish/i);
    assert.ok(Buffer.isBuffer(generated.image.buf) && generated.image.buf.length > 0);
    assert.equal(prompts.length, 2, "yaroqsiz data retry qilinadi");
    assert.equal(prompts[0], prompts[1], "retry paytida shablon assignmenti o‘zgarmaydi");
    assert.match(prompts[0], /Tanlangan va o‘zgarmas diagram_type: functional_block_diagram/);
    assert.match(prompts[0], /Suvni tozalash/);
    assert.match(prompts[0], /filtrlash va sifat mezonini tekshirish/i);
    assert.match(prompts[0], /Mavzu, bob va reja maqsadiga bevosita mos/);
    assert.match(prompts[0], /generic to‘ldiruvchilar/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Graphviz va fallback renderi ishlamasa, media xatosi butun hujjatni to‘xtatmaydigan rasmsiz natija qaytaradi", async () => {
  const originalFetch = global.fetch;
  const originalPath = process.env.PATH;
  let requests = 0;
  global.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      slot_id: "ch1:flowchart:1", type: "flowchart", title: "Yaroqsiz sxema", nodes: [], edges: [],
    }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  process.env.PATH = "";

  try {
    const slot = {
      slot_id: "ch1:flowchart:1", type: "flowchart", ordinal: 1,
      plan: { title: "Suvni tozalash tarkibi", purpose: "suvni filtrlash va sifat nazoratini tushuntirish" },
    };
    const result = await generateMediaSlot(slot, {
      chapter: { id: "ch1", title: "Suvni tozalash", role: "methodology" },
      topic: "Suvni tozalash", language: "o‘zbek",
      llm: { provider: "openai", openaiKey: "mock-key", openaiModel: "mock-model" },
    });
    assert.equal(result.fallback, true);
    assert.equal(result.image, null, "yiqilgan Graphviz renderidan rasm keshga uzatilmasin");
    assert.ok(result.renderError);
    assert.equal(result.item.nodes.length, 5, "xato ma’lumot reja asosida valid fallback bilan almashtirilsin");
    assert.equal(requests, 2, "xato JSON ikki urinishdan so‘ng xavfsiz fallbackga o‘tsin");
  } finally {
    global.fetch = originalFetch;
    if (originalPath == null) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test("parallel worker'lar berilgan concurrency chegarasidan oshmaydi va natija tartibini saqlaydi", async () => {
  let active = 0;
  let maximum = 0;
  const values = await mapWithConcurrency(Array.from({ length: 11 }, (_, index) => index), 3, async value => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active--;
    return value * 2;
  });
  assert.ok(maximum <= 3);
  assert.equal(maximum, 3);
  assert.deepEqual(values, Array.from({ length: 11 }, (_, index) => index * 2));
});
