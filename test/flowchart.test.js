const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { normalizeFlowchartData } = require("../src/mustaqil/flowchart-data");
const { buildFlowchartCaption } = require("../src/mustaqil/flowchart-data");
const { buildFlowchartDot } = require("../src/mustaqil/flowchart");
const { FLOWCHART_TEMPLATES } = require("../src/mustaqil/flowchart-templates");
const { normalizeOutlineForPages, outlineUserPrompt, chapterUserPrompt } = require("../src/mustaqil/prompt");
const { validatePlannedMedia } = require("../src/mustaqil/media-validation");
const { alignPlannedFlowchartBlocks, alignPlannedChartBlocks, mediaSlotPrompt } = require("../src/mustaqil/generate");
const { normalizeChartData } = require("../src/mustaqil/chart-data");

const validFlowchart = {
  type: "flowchart",
  title: "Suvni tozalash tarkibi va aloqalari",
  caption: "Izoh: sxemada suvni tozalashning asosiy qismlari va o'zaro ta'siri ko'rsatilgan.",
  nodes: [
    { id: "source", label: "Xom suv manbai", kind: "input" },
    { id: "filter", label: 'Filtrlash "; system("x")', kind: "process" },
    { id: "quality", label: "Suv sifati", kind: "process" },
    { id: "treatment", label: "Tozalash usuli", kind: "process" },
    { id: "supply", label: "Toza suv ta'minoti", kind: "output" },
  ],
  edges: [
    { from: "source", to: "filter" },
    { from: "filter", to: "quality" },
    { from: "quality", to: "treatment" },
    { from: "treatment", to: "supply" },
  ],
};

test("Graphviz oqim sxemasi xavfsiz JSON sxemasi va DOT string escaping bilan tuziladi", () => {
  assert.equal(normalizeFlowchartData(validFlowchart).nodes.length, 5);
  const dot = buildFlowchartDot(validFlowchart);
  assert.match(dot, /digraph Flowchart/);
  assert.match(dot, /ranksep="0\.550"/, "gorizontal flowchartda ortiqcha enni oshirmasdan ixcham oraliq ishlatiladi");
  assert.doesNotMatch(dot, /Suvni tozalash tarkibi va aloqalari/, "flowchart sarlavhasi rasm ichiga kiritilmasin");
  const normalized = normalizeFlowchartData(validFlowchart);
  assert.equal(normalized.title, validFlowchart.title, "sarlavha DOCX captioni uchun ma'lumotda saqlansin");
  assert.ok(dot.includes(`Filtrlash ${String.fromCharCode(92)}"`) && dot.includes(`${String.fromCharCode(92)}nsystem`), "o‘ralgan label ichidagi qo‘shtirnoq Graphviz uchun escape qilinsin");
  assert.match(dot, /Suv sifati/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, nodes: validFlowchart.nodes.map((node, index) => index ? node : { ...node, id: 'x; system("bad")' }) }), /xavfsiz format/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, edges: [{ from: "source", to: "missing" }, ...validFlowchart.edges.slice(1)] }), /mavjud bo'lmagan node/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, nodes: validFlowchart.nodes.map((node, index) => index ? node : { ...node, kind: "record" }) }), /noma'lum yoki mos bo'lmagan node turi/);
  assert.equal(normalizeFlowchartData({
    ...validFlowchart,
    nodes: [validFlowchart.nodes[0], validFlowchart.nodes[1], validFlowchart.nodes[2], validFlowchart.nodes[4]],
    edges: [{ from: "source", to: "filter" }, { from: "filter", to: "quality" }, { from: "quality", to: "supply" }],
  }).nodes.length, 4,
    "mazmunan yetarli bo‘lsa 2–5 tugun ishlatish mumkin");
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, nodes: validFlowchart.nodes.slice(0, 1), edges: [] }), /2–5 ta node/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, nodes: [...validFlowchart.nodes, { id: "extra", label: "Qo'shimcha", kind: "process" }] }), /2–5 ta node/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, nodes: validFlowchart.nodes.map((node, index) => index ? node : { ...node, label: "Bir ikki uch to'rt besh olti" }) }), /1–5 ta qisqa so'z/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, edges: [...validFlowchart.edges, { from: "quality", to: "source" }] }), /faqat input→process→output zanjiri/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, edges: [...validFlowchart.edges, { from: "filter", to: "filter" }] }), /o'ziga ulanmasin/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, edges: [...validFlowchart.edges, { from: "source", to: "filter" }] }), /takrorlangan aloqa/);
  assert.throws(() => normalizeFlowchartData({ ...validFlowchart, nodes: validFlowchart.nodes.map((node, index) => index === 2 ? { ...node, kind: "decision" } : node) }), /mos bo'lmagan node turi/);
});

test("beshta Graphviz semantik turi to‘g‘ri shakl va yo‘nalishda yaroqli PNG render beradi", () => {
  assert.equal(FLOWCHART_TEMPLATES.length, 5);
  assert.equal(new Set(FLOWCHART_TEMPLATES.map(template => template.id)).size, FLOWCHART_TEMPLATES.length);
  assert.ok(FLOWCHART_TEMPLATES.every(template => template.name && template.description && template.direction && template.topologyGuidance));
  const examples = {
    functional_block_diagram: validFlowchart,
    algorithm_flowchart: {
      diagram_type: "algorithm_flowchart", title: "Suv sifatini tekshirish algoritmi",
      nodes: [{ id: "start", label: "Boshlash", kind: "start" }, { id: "measure", label: "Suvni o'lchash", kind: "process" }, { id: "decision", label: "Mezonni tekshirish", kind: "decision" }, { id: "treat", label: "Suvni tozalash", kind: "process" }, { id: "end", label: "Tugatish", kind: "end" }],
      edges: [{ from: "start", to: "measure" }, { from: "measure", to: "decision" }, { from: "decision", to: "treat", label: "Ha" }, { from: "decision", to: "end", label: "Yo'q" }, { from: "treat", to: "end" }],
    },
    pid_control_system: {
      diagram_type: "pid_control_system", title: "PID boshqaruv konturi",
      nodes: [{ id: "ref", label: "Topshiriq signali", kind: "input" }, { id: "sum", label: "Σ", kind: "sum" }, { id: "pid", label: "PID rostlagich", kind: "controller" }, { id: "plant", label: "Boshqaruv obyekti", kind: "plant" }, { id: "sensor", label: "O'lchov datchigi", kind: "sensor" }],
      edges: [{ from: "ref", to: "sum" }, { from: "sum", to: "pid" }, { from: "pid", to: "plant" }, { from: "plant", to: "sensor" }, { from: "sensor", to: "sum", label: "Teskari aloqa" }],
    },
    uml_software_architecture: {
      diagram_type: "uml_software_architecture", title: "Ilova komponentlari",
      nodes: [{ id: "api", label: "API komponenti", kind: "component" }, { id: "service", label: "Domen klassi", kind: "class" }, { id: "db", label: "Ma'lumotlar bazasi", kind: "database" }],
      edges: [{ from: "api", to: "service", label: "calls" }, { from: "service", to: "db", label: "reads" }],
    },
    process_sequence: {
      diagram_type: "process_sequence", title: "Suvni tozalash bosqichlari",
      nodes: [{ id: "input", label: "Xom suv olish", kind: "input" }, { id: "filter", label: "Suvni filtrlash", kind: "step" }, { id: "output", label: "Toza suv uzatish", kind: "output" }],
      edges: [{ from: "input", to: "filter" }, { from: "filter", to: "output" }],
    },
  };
  const byId = Object.fromEntries(FLOWCHART_TEMPLATES.map(template => [template.id, template]));
  const dots = FLOWCHART_TEMPLATES.map(template => buildFlowchartDot({ ...examples[template.id], diagram_type: template.id }));
  for (const [index, template] of FLOWCHART_TEMPLATES.entries()) {
    const dot = dots[index];
    assert.match(dot, /fontname="Times New Roman"/, `${template.id}: matn Times New Roman deb belgilansin`);
    if (template.id === "algorithm_flowchart") {
      assert.match(dot, /rankdir=TB/);
      assert.match(dot, /shape=diamond/);
      assert.match(dot, /shape=ellipse/);
    }
    if (["functional_block_diagram", "pid_control_system", "process_sequence"].includes(template.id)) assert.match(dot, /rankdir=LR/);
    if (template.id === "pid_control_system") assert.match(dot, /constraint=false/);
    if (template.id === "uml_software_architecture") {
      assert.match(dot, /rankdir=TB/);
      assert.match(dot, /shape=component/);
    }
    if (template.id === "process_sequence") assert.match(dot, /rankdir=LR/);
    const nodeCount = (dot.match(/^    [A-Za-z][A-Za-z0-9_]* \[label=/gm) || []).length;
    assert.ok(nodeCount >= 2 && nodeCount <= 5, `${template.id}: 2–5 ta node bo‘lsin`);
    const rendered = spawnSync("dot", [`-K${template.layoutEngine}`, "-Tpng"], { input: dot, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(rendered.status, 0, `${template.id}: ${rendered.stderr?.toString("utf8") || "Graphviz render xatosi"}`);
    assert.equal(rendered.stdout.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${template.id} PNG chiqarsin`);
  }
  assert.deepEqual(byId.algorithm_flowchart.allowedKinds, ["start", "end", "process", "decision", "input", "output"]);
});

test("o‘zbekcha ishda Graphviz ichidagi inglizcha title, tugun va qirra matni saqlanadi", () => {
  const englishLabels = {
    language: "o'zbek",
    diagram_type: "pid_control_system",
    title: "Feedback control system",
    nodes: [
      { id: "reference", label: "Reference input", kind: "input" },
      { id: "sum", label: "Σ", kind: "sum" },
      { id: "controller", label: "Controller model", kind: "controller" },
      { id: "plant", label: "Control plant", kind: "plant" },
      { id: "sensor", label: "Output feedback sensor", kind: "sensor" },
    ],
    edges: [
      { from: "reference", to: "sum", label: "" },
      { from: "sum", to: "controller", label: "" },
      { from: "controller", to: "plant", label: "" },
      { from: "plant", to: "sensor", label: "" },
      { from: "sensor", to: "sum", label: "Feedback" },
    ],
  };
  const normalized = normalizeFlowchartData(englishLabels, { language: "o'zbek" });
  assert.equal(normalized.title, "Feedback control system");
  assert.deepEqual(normalized.nodes.map(node => node.label), ["Reference input", "Σ", "Controller model", "Control plant", "Output feedback sensor"]);
  assert.deepEqual(normalized.edges.map(edge => edge.label), ["", "", "", "", "Feedback"]);
  const visibleText = [normalized.title, ...normalized.nodes.map(node => node.label), ...normalized.edges.map(edge => edge.label)].join(" ");
  assert.match(visibleText, /\b(?:start|end|sensor|controller|input|output|yes|no|feedback|control|system)\b/i);
  assert.doesNotMatch(buildFlowchartDot(englishLabels), /Feedback control system/, "inglizcha sarlavha ham rasmga chiqarilmasin");

  const mixedLanguage = normalizeFlowchartData({ ...englishLabels, title: "Modeldan vaqt-domain javobigacha" }, { language: "o'zbek" });
  assert.equal(mixedLanguage.title, "Modeldan vaqt-domain javobigacha");
  assert.match(mixedLanguage.title, /\bdomain\b/i);

  const kontroller = normalizeFlowchartData({ ...englishLabels, title: "Kontroller parametrlari", nodes: englishLabels.nodes.map((node, index) => index === 2 ? { ...node, label: "Kontroller chiqishi" } : node) }, { language: "o'zbek" });
  assert.equal(kontroller.nodes[2].label, "Kontroller chiqishi");

  const antiWindup = normalizeFlowchartData({ ...englishLabels, nodes: englishLabels.nodes.map((node, index) => index === 2 ? { ...node, label: "Barqarorlikni tekshirish va antiwindupni faollashtirish" } : node) }, { language: "o'zbek" });
  assert.equal(antiWindup.nodes[2].label, "Barqarorlikni tekshirish va antiwindupni faollashtirish");
  assert.match(antiWindup.nodes[2].label, /anti-?windup\w*/i);

  const transferTitle = normalizeFlowchartData({ ...englishLabels, title: "Modeldan javobgacha: transfer funksiya asosida tahlil oqimi" }, { language: "o'zbek" });
  assert.equal(transferTitle.title, "Modeldan javobgacha: transfer funksiya asosida tahlil oqimi");
  assert.match(transferTitle.title, /\btransfer\b/i);

  const overshoot = normalizeFlowchartData({ ...englishLabels, nodes: englishLabels.nodes.map((node, index) => index === 2 ? { ...node, label: "Shartli tekshiruv: overshoot va o'rnatilish" } : node) }, { language: "o'zbek" });
  assert.equal(overshoot.nodes[2].label, "Shartli tekshiruv: overshoot va o'rnatilish");
  assert.match(overshoot.nodes[2].label, /\bovershoot\w*/i);
});

test("outline bir ishda ko'pi bilan bitta flowchart rejalashtiradi", () => {
  const outline = normalizeOutlineForPages({
    chapters: [
      { id: "intro", title: "Kirish" },
      { title: "Birinchi jarayon", flowchart_count: 1, flowchart_plans: [{ title: "Birinchi oqim", purpose: "Birinchi" }] },
      { title: "Ikkinchi jarayon", flowchart_count: 1, flowchart_plans: [{ title: "Ikkinchi oqim", purpose: "Ikkinchi" }] },
      { title: "Uchinchi jarayon", flowchart_count: 1, flowchart_plans: [{ title: "Uchinchi oqim", purpose: "Uchinchi" }] },
      { id: "conclusion", title: "Xulosa" },
    ],
    references: Array.from({ length: 8 }, (_, index) => `Manba ${index + 1}`),
  }, { pages: 10, topic: "Jarayonlar" });
  const main = outline.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  assert.equal(main.reduce((sum, chapter) => sum + chapter.flowchart_count, 0), 1);
  assert.equal(main.reduce((sum, chapter) => sum + chapter.flowchart_plans.length, 0), 1);
  assert.equal(outline.chapters[0].flowchart_count, 0);
  assert.equal(outline.chapters.at(-1).flowchart_count, 0);
});

test("flowchartCount=2 ikki farqli sxemani mos asosiy bo'limlarga joylaydi", () => {
  const outline = normalizeOutlineForPages({
    chapters: [
      { id: "intro", title: "Kirish" },
      { title: "Tizimning tarkibiy tuzilishi", flowchart_count: 1, flowchart_plans: [{ title: "Yopiq kontur sxemasi", purpose: "Topshiriqdan teskari aloqagacha bo'lgan uzluksiz boshqaruv konturi" }] },
      { title: "Rostlagich parametrlari va tizim aloqalari" },
      { title: "Amaliy qo'llanish" },
      { id: "conclusion", title: "Xulosa" },
    ],
    references: Array.from({ length: 8 }, (_, index) => `Manba ${index + 1}`),
  }, { pages: 10, topic: "Avtomatik boshqaruv tizimi", flowchartCount: 2 });

  const main = outline.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  const planned = main.filter(chapter => chapter.flowchart_count === 1);
  assert.equal(planned.length, 2);
  assert.deepEqual(planned.map(chapter => chapter.flowchart_plans[0].title), [
    "Yopiq kontur sxemasi",
    "Avtomatik boshqaruv tizimi: omillar va natijalar bog'lanishi",
  ]);
  assert.equal(new Set(planned.map(chapter => chapter.id)).size, 2);
});

test("chartCount=0 bo'lsa ham diagrammalar jami kamida uchtaga yetkaziladi", () => {
  const outline = normalizeOutlineForPages({ chapters: [], references: [] }, {
    pages: 10, topic: "Avtomatik boshqaruv tizimi", chartCount: 0, flowchartCount: 2,
  });
  const main = outline.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  assert.equal(main.reduce((sum, chapter) => sum + chapter.chart_count, 0), 1);
  assert.equal(main.reduce((sum, chapter) => sum + chapter.flowchart_count, 0), 2);
  const prompt = outlineUserPrompt({ topic: "Avtomatik boshqaruv tizimi", pages: 10, chartCount: 0, flowchartCount: 2 });
  assert.match(prompt, /1 miqdoriy grafik/);
  assert.match(prompt, /2 ta Graphviz oqim sxemasi/);
  assert.match(prompt, /jami kamida 3 ta/);
});

test("oddiy ish kamida uchta diagramma oladi, katta ish esa uchdan ko'pini rejalashtiradi", () => {
  const standard = normalizeOutlineForPages({ chapters: [] }, { pages: 10, topic: "Suvni tozalash" });
  const standardMain = standard.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  assert.equal(standardMain.reduce((sum, chapter) => sum + chapter.chart_count + chapter.flowchart_count, 0), 3);

  const longer = normalizeOutlineForPages({ chapters: [] }, { pages: 20, topic: "Suvni tozalash" });
  const longerMain = longer.chapters.filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion");
  assert.ok(longerMain.reduce((sum, chapter) => sum + chapter.chart_count + chapter.flowchart_count, 0) > 3);
  const fallback = standardMain.flatMap(chapter => chapter.flowchart_plans || []);
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].title, /Suvni tozalash: besh asosiy tarkibiy unsur/);
  assert.doesNotMatch(fallback[0].purpose, /rostlagich|teskari aloqa|boshqaruv obyekti/i);
});

test("outline va bob promptlari Graphviz flowchartni JSON media sifatida so'raydi", () => {
  assert.match(outlineUserPrompt({ topic: "Suvni tozalash", pages: 10 }), /Graphviz oqim sxemasi/);
  assert.match(outlineUserPrompt({ topic: "Boshqaruv", pages: 10, flowchartCount: 2 }), /aynan 2 ta Graphviz oqim sxemasi/);
  const chapter = {
    id: "ch1", title: "Jarayon bosqichlari", role: "theory", word_target: 398,
    sections: [{ title: "Asosiy bosqichlar", word_target: 398 }],
    flowchart_count: 1,
    flowchart_plans: [{ title: "Tozalash oqimi", purpose: "suv tozalash ketma-ketligi" }],
  };
  const prompt = chapterUserPrompt({
    chapter,
    outline: { meta: { title: "Suvni tozalash" }, chapters: [chapter] },
    language: "o'zbek", chapterIndex: 0, totalChapters: 1,
  });
  assert.match(prompt, /Graphviz diagramma rejasi/);
  assert.match(prompt, /Umumiy limit 2–5 tugun/);
  assert.match(prompt, /process_sequence/);
  assert.match(prompt, /mavzu, bob va reja maqsadiga bevosita mos/);
  assert.match(prompt, /jarayon qadamlarini chapdan o‘ngga/);
  assert.match(prompt, /faqat bevosita keyingi tugunga/);
  assert.match(prompt, /Algoritm bo‘lmasa start\/end\/decision belgilarini ishlatma/);
  assert.match(prompt, /O‘zbekcha captionni "Izoh:"/);
  assert.match(prompt, /diagram_type="process_sequence"/);
  assert.match(prompt, /Graphviz DOT yoki kodni JSONga kiritma/);
  const mediaPrompt = mediaSlotPrompt({ type: "flowchart", slot_id: "ch1:flowchart:1", diagram_type: "process_sequence", template_id: "process_sequence", plan: chapter.flowchart_plans[0] }, {
    topic: "Suvni tozalash", language: "o'zbek",
  });
  assert.match(mediaPrompt, /o‘zbekcha yoki inglizcha/);
  assert.match(mediaPrompt, /2–5 node/);
  assert.match(mediaPrompt, /Mavzu, bob va reja maqsadiga bevosita mos/);
  assert.match(mediaPrompt, /Grafik yo‘nalishi: chapdan o‘ngga/);
  assert.match(mediaPrompt, /bajarilish tartibida chapdan o‘ngga/);
  assert.match(mediaPrompt, /faqat bevosita keyingi tugunga/);
  assert.match(mediaPrompt, /Faqat quyidagi kind qiymatlari/);
});

test("jarayon sxemasidagi sakrab o‘tuvchi o‘qlar mavzuga mos sodda zanjir bilan almashtiriladi", () => {
  const plan = {
    id: "ch1", title: "Iqtisodiy inqirozni erta aniqlash", flowchart_count: 1,
    flowchart_plans: [{ diagram_type: "process_sequence", title: "Inqirozni erta aniqlash va javob choralarini tanlash", purpose: "indikatorlarni baholab siyosat choralarini tanlash" }],
  };
  const generated = {
    type: "flowchart", diagram_type: "process_sequence", title: plan.flowchart_plans[0].title,
    nodes: [
      { id: "indicators", label: "Indikatorlar", kind: "step" },
      { id: "risk", label: "Risk baholash", kind: "step" },
      { id: "policy", label: "Siyosat tanlash", kind: "step" },
      { id: "action", label: "Boshqaruv chorasi", kind: "step" },
      { id: "monitoring", label: "Monitoring", kind: "step" },
    ],
    edges: [
      { from: "indicators", to: "risk" }, { from: "risk", to: "policy" },
      { from: "policy", to: "action" }, { from: "action", to: "monitoring" },
      { from: "indicators", to: "policy" }, { from: "risk", to: "action" },
    ],
  };
  const [repaired] = alignPlannedFlowchartBlocks(plan, [generated], "o'zbek");
  assert.equal(repaired.diagram_type, "process_sequence");
  assert.equal(repaired.edges.length, repaired.nodes.length - 1);
  assert.deepEqual(repaired.edges.map(edge => [edge.from, edge.to]), repaired.nodes.slice(0, -1).map((node, index) => [node.id, repaired.nodes[index + 1].id]));
  assert.match(repaired.nodes.map(node => node.label).join(" "), /inqiroz|indikator|siyosat/i, "zaxira chizma reja mavzusini saqlaydi");
  assert.doesNotThrow(() => normalizeFlowchartData(repaired));
});

test("rejalashtirilgan flowchartning yo‘qligi yoki yaroqsiz JSON’i renderdan oldin rad etiladi", () => {
  const planned = [{ id: "ch1", title: "Jarayon", flowchart_count: 1, flowchart_plans: [{ title: "Oqim" }] }];
  assert.throws(() => validatePlannedMedia([{ content: [] }], planned, { minimumDiagramCount: 0 }), /flowchart 0\/1/);
  assert.throws(() => validatePlannedMedia([{ content: [{ ...validFlowchart, nodes: [{ id: "bad id", label: "X", kind: "process" }] }] }], planned, { minimumDiagramCount: 0 }), /flowchart 1 yaroqsiz/);
  assert.equal(validatePlannedMedia([{ content: [validFlowchart] }], planned, { minimumDiagramCount: 0 }), true);
});

test("ikki bobda rejalashtirilgan ikkita flowchart ikkalasi ham bo'lishi shart", () => {
  const planned = [
    { id: "ch1", title: "Tarkib", flowchart_count: 1, flowchart_plans: [{ title: "Yopiq kontur" }] },
    { id: "ch2", title: "Algoritm", flowchart_count: 1, flowchart_plans: [{ title: "Boshqaruv algoritmi" }] },
  ];
  assert.equal(validatePlannedMedia([{ content: [validFlowchart] }, { content: [validFlowchart] }], planned, { minimumDiagramCount: 0 }), true);
  assert.throws(() => validatePlannedMedia([{ content: [validFlowchart] }, { content: [] }], planned, { minimumDiagramCount: 0 }), /Algoritm: flowchart 0\/1/);
});

test("yakuniy media tekshiruvi uchta diagrammadan kamini rad etadi va to'rtta diagrammani qabul qiladi", () => {
  const chart = { type: "chart", chartType: "bar", labels: ["A", "B"], values: [1, 2], data_source: "sintetik sinov ma'lumoti" };
  const plannedTwo = [
    { id: "ch1", title: "Birinchi", chart_count: 1, chart_plans: [{ title: "A" }], flowchart_count: 1, flowchart_plans: [{ title: "Oqim" }] },
  ];
  assert.throws(() => validatePlannedMedia([{ content: [chart, validFlowchart] }], plannedTwo), /Umumiy diagrammalar soni 2\/3/);

  const plannedFour = [
    { id: "ch1", title: "Birinchi", chart_count: 1, chart_plans: [{ title: "A" }], flowchart_count: 1, flowchart_plans: [{ title: "Oqim 1" }] },
    { id: "ch2", title: "Ikkinchi", chart_count: 1, chart_plans: [{ title: "B" }], flowchart_count: 1, flowchart_plans: [{ title: "Oqim 2" }] },
  ];
  const generatedFour = [
    { content: [chart, validFlowchart] },
    { content: [chart, validFlowchart] },
  ];
  assert.equal(validatePlannedMedia(generatedFour, plannedFour), true);
});

test("model diagrammalarni tashlab ketsa, reja asosida sintetik grafik va oqim sxemalari to'ldiriladi", () => {
  const planned = {
    id: "ch1",
    title: "Nazariy asoslar va hisobiy yondashuv",
    chart_count: 2,
    chart_type: "bar",
    chart_plans: [
      { title: "Birinchi tahliliy ko'rsatkich" },
      { title: "Ikkinchi tahliliy ko'rsatkich" },
    ],
    flowchart_count: 1,
    flowchart_plans: [{ title: "Setpoint nazorati", purpose: "setpoint qiymatini tekshirish va jarayon qarorini tanlash" }],
  };
  let content = alignPlannedChartBlocks(planned, [{ type: "paragraph", text: "Nazariy tahlil." }]);
  content = alignPlannedFlowchartBlocks(planned, content, "o'zbek");
  const charts = content.filter(item => item.type === "chart");
  const flowcharts = content.filter(item => item.type === "flowchart");

  assert.equal(charts.length, 2);
  charts.forEach(chart => {
    assert.equal(normalizeChartData(chart).values.length, 5);
    assert.match(chart.data_source, /sintetik illustrativ ma'lumot; real o'lchov emas/i);
    assert.doesNotMatch(`${chart.title} ${chart.caption}`, /sintetik|real o'lchov emas/i);
  });
  assert.equal(flowcharts.length, 1);
  assert.match(flowcharts[0].caption, /Izoh:.*topshiriq qiymati/i);
  assert.doesNotMatch(`${flowcharts[0].title} ${flowcharts[0].caption}`, /sintetik|real o'lchov emas/i);
  assert.equal(validatePlannedMedia([{ content }], [planned], { language: "o'zbek" }), true);
});

test("model captionida topshiriq qiymati bo'lmasa, mavjud flowchart captioni avtomatik qayta tuziladi", () => {
  const chart = {
    ...validFlowchart,
    title: "Setpoint monitoring",
    caption: "Izoh: setpoint monitoring jarayoni.",
  };
  const planned = {
    id: "ch1", title: "Nazorat", flowchart_count: 1,
    flowchart_plans: [{ title: chart.title, purpose: "setpoint qiymatini nazorat qilish bosqichlari" }],
  };
  const [aligned] = alignPlannedFlowchartBlocks(planned, [chart], "o'zbek");
  assert.match(aligned.caption, /Izoh:.*topshiriq qiymati/i);
  assert.equal(validatePlannedMedia([{ content: [aligned] }], [planned], { language: "o'zbek", minimumDiagramCount: 0 }), true);
});

test("Graphviz caption inglizcha yorliqlarni tarjimasiz qabul qilib, qisqa o'zbekcha izoh beradi", () => {
  const english = {
    ...validFlowchart,
    diagram_type: "pid_control_system",
    title: "Feedback control system",
    nodes: [
      { id: "reference", label: "Reference input", kind: "input" },
      { id: "sum", label: "Σ", kind: "sum" },
      { id: "controller", label: "Controller model", kind: "controller" },
      { id: "plant", label: "Control plant", kind: "plant" },
      { id: "sensor", label: "Output feedback sensor", kind: "sensor" },
    ],
    edges: [
      { from: "reference", to: "sum", label: "" }, { from: "sum", to: "controller", label: "" },
      { from: "controller", to: "plant", label: "" }, { from: "plant", to: "sensor", label: "" },
      { from: "sensor", to: "sum", label: "Feedback" },
    ],
  };
  english.caption = buildFlowchartCaption(english, "O'lchovga qarab boshqaruv qarorini yangilash jarayoni", "o'zbek");
  const planned = [{ id: "ch1", title: "Tizim", flowchart_count: 1, flowchart_plans: [{ title: english.title, diagram_type: "pid_control_system" }] }];
  assert.equal(validatePlannedMedia([{ content: [english] }], planned, { language: "o'zbek", minimumDiagramCount: 0 }), true);
  assert.match(english.caption, /^Izoh:/);
  const noGlossary = { ...english, caption: "Izoh: sxemada o'lchovga qarab boshqaruv qarorini yangilash bosqichlari ko'rsatiladi." };
  assert.equal(validatePlannedMedia([{ content: [noGlossary] }], planned, { language: "o'zbek", minimumDiagramCount: 0 }), true);

  const withoutCaption = alignPlannedFlowchartBlocks({
    flowchart_plans: [{ title: english.title, purpose: "O'lchovga qarab boshqaruv qarorini yangilash jarayoni", diagram_type: "pid_control_system" }],
  }, [{ ...english, caption: "" }], "o'zbek");
  assert.match(withoutCaption[0].caption, /Izoh:/);
  assert.match(withoutCaption[0].caption, /o'lchovga qarab boshqaruv qarorini/i);
});

test("lug'atda yo'q inglizcha Graphviz atamasi ham kodni to'xtatmaydi", () => {
  const throughput = {
    ...validFlowchart,
    title: "Throughput API",
    nodes: validFlowchart.nodes.map((node, index) => index === 1 ? { ...node, label: "Throughput API" } : node),
    caption: "Izoh: o'tkazuvchanlik ko'rsatkichini baholash bosqichlari ko'rsatiladi.",
  };
  const caption = buildFlowchartCaption(throughput, "o'tkazuvchanlik ko'rsatkichini baholash bosqichlari", "o'zbek");
  assert.match(caption, /^Izoh:.*o'tkazuvchanlik/i);
  const aligned = alignPlannedFlowchartBlocks({
    flowchart_count: 1,
    flowchart_plans: [{ title: "Throughput", purpose: "O'tkazuvchanlik qiymatini baholash" }],
  }, [{ ...throughput, caption }], "o'zbek")[0];
  assert.match(aligned.title, /Throughput API/);
  assert.match(aligned.nodes[1].label, /Throughput API/);
  assert.match(buildFlowchartDot(aligned), /Throughput API/);
  assert.match(aligned.caption, /Izoh:/);
  assert.doesNotMatch(aligned.caption, /Atamalar:/);
  assert.equal(validatePlannedMedia([{ content: [aligned] }], [{
    id: "ch1", title: "Tahlil", flowchart_count: 1,
    flowchart_plans: [{ title: "Throughput API" }],
  }], { language: "o'zbek", minimumDiagramCount: 0 }), true);
});

test("ruscha flowchart fallback captionida ruscha izoh belgisi ishlatiladi", () => {
  assert.equal(buildFlowchartCaption({ title: "Схема" }, "Порядок обработки", "rus"), "Схема. Пояснение: Порядок обработки.");
});

test("tarakan nazorati fallbackida o‘zbekcha Tarakan, Risk va IPM terminlari ishlaydi", () => {
  const planned = {
    id: "ch1",
    title: "Tarakanlarni yo‘qotish",
    flowchart_count: 1,
    flowchart_plans: [{
      title: "Tarakanlarni yo‘qotish: IPM va Risk baholash",
      purpose: "zararkunandalarga qarshi usullarni baholash",
    }],
  };
  const [fallback] = alignPlannedFlowchartBlocks(planned, [], "o'zbek");
  assert.match(fallback.caption, /^Izoh:/);
  assert.match(fallback.caption, /zararkunandalarga qarshi usullarni baholash/i);
  assert.doesNotMatch(fallback.caption, /Atamalar:/);
  assert.equal(validatePlannedMedia([{ content: [fallback] }], [planned], {
    language: "o'zbek", minimumDiagramCount: 0,
  }), true);
});
