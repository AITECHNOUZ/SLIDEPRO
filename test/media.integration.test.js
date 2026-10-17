const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const sharp = require("sharp");
const { renderFormula } = require("../src/mustaqil/formula");
const { renderChart, wrapLabelLines, barSVG, lineSVG, pieSVG } = require("../src/mustaqil/chart");
const { buildFlowchartDot, renderFlowchart } = require("../src/mustaqil/flowchart");
const { buildDocument } = require("../src/mustaqil/builder");
const { prerenderMedia } = require("../src/mustaqil/generate");

test("MathJax, bar/line/pie va DOCX ichiga rasm qo‘shish integratsiyasi", async () => {
  const imageCache = new Map();
  const formulaCases = [
    { latex: "\\frac{a+b}{c}", key: "f_1" },
    { latex: "\\int_0^1 x^2 \\, dx = \\frac{1}{3}", key: "f_2" },
    { latex: "\\sqrt{x^2+1}", key: "f_3" },
  ];

  for (const { latex, key } of formulaCases) {
    const image = await renderFormula(latex);
    const metadata = await sharp(image.buf).metadata();
    assert.equal(metadata.format, "png", `${latex} PNG bo‘lishi kerak`);
    assert.ok(metadata.width > 0 && metadata.height > 0);
    assert.ok(image.width > 0 && image.width <= 180);
    assert.ok(image.height > 0 && image.height <= 28);
    imageCache.set(key, image);
  }

  for (const [index, chartType] of ["bar", "line", "pie"].entries()) {
    const image = await renderChart({
      chartType,
      title: "Sinov grafik — o‘zbekcha",
      labels: ["A", "B", "C"],
      values: chartType === "pie" ? [2, 3, 5] : [-2, 4, 6],
      data_source: "sintetik sinov ma’lumoti",
    });
    const metadata = await sharp(image.buf).metadata();
    assert.equal(metadata.format, "png", `${chartType} PNG bo‘lishi kerak`);
    assert.ok(metadata.width > 0 && metadata.height > 0);
    assert.ok(image.width > 0 && image.height > 0);
    imageCache.set(index === 0 ? "c_1" : "c_3", image);
  }

  const singleSlicePie = await renderChart({ chartType: "pie", title: "Yagona ulush", labels: ["A", "B"], values: [5, 0] });
  const piePixels = await sharp(singleSlicePie.buf).raw().toBuffer({ resolveWithObject: true });
  const centerOffset = (150 * piePixels.info.width + 180) * piePixels.info.channels;
  assert.notDeepEqual([...piePixels.data.subarray(centerOffset, centerOffset + 3)], [255, 255, 255], "100% li pie bo‘lagi to‘liq doira sifatida chizilishi kerak");

  const flowchartInput = {
    type: "flowchart",
    diagram_type: "process_sequence",
    title: "Ichimlik suvini tozalash tarkibi",
    nodes: [
      { id: "source", label: "Xom suv manbai", kind: "input" },
      { id: "filter", label: "Filtrlash tizimi", kind: "step" },
      { id: "treatment", label: "Dezinfeksiya", kind: "step" },
      { id: "quality", label: "Suv sifati mezoni", kind: "step" },
      { id: "deliver", label: "Ichimlik suvi ta'minoti", kind: "output" },
    ],
    edges: [
      { from: "source", to: "filter" },
      { from: "filter", to: "treatment" },
      { from: "treatment", to: "quality" },
      { from: "quality", to: "deliver" },
    ],
    caption: "Izoh: suv manbai, filtrlash, dezinfeksiya va sifat mezonining o'zaro aloqalari.",
  };
  const baselineDot = buildFlowchartDot(flowchartInput, { wrapLabels: false, ranksepMultiplier: 1 });
  const spacedDot = buildFlowchartDot(flowchartInput, { wrapLabels: false, ranksepMultiplier: 1.5 });
  const baselineRanksep = Number(baselineDot.match(/ranksep="([\d.]+)"/)?.[1]);
  const spacedRanksep = Number(spacedDot.match(/ranksep="([\d.]+)"/)?.[1]);
  assert.ok(Math.abs(spacedRanksep - baselineRanksep * 1.5) < 0.001, "tanlangan qator oralig‘i avvalgisidan 50% kengaysin");

  const flowchart = await renderFlowchart(flowchartInput);
  const flowchartMetadata = await sharp(flowchart.buf).metadata();
  assert.equal(flowchartMetadata.format, "png");
  assert.ok(flowchart.width > 0 && flowchart.width <= 520);
  assert.ok(flowchart.height > 0 && flowchart.height <= 620);
  assert.ok(Math.abs(flowchart.width / flowchart.height - flowchartMetadata.width / flowchartMetadata.height) < 0.01, "qator oralig‘i oshganda rasm proporsiyasi saqlansin");
  imageCache.set("d_2", flowchart);

  const algorithmFlowchartInput = {
    type: "flowchart", diagram_type: "algorithm_flowchart", title: "Suv sifatini tekshirish algoritmi",
    nodes: [
      { id: "start", label: "Boshlash", kind: "start" },
      { id: "sample", label: "Suv namunasini olish", kind: "process" },
      { id: "measure", label: "Suv sifatini o'lchash", kind: "process" },
      { id: "evaluate", label: "Mezon bo'yicha baholash", kind: "process" },
      { id: "end", label: "Yakunlash", kind: "end" },
    ],
    edges: [
      { from: "start", to: "sample" }, { from: "sample", to: "measure" },
      { from: "measure", to: "evaluate" }, { from: "evaluate", to: "end" },
    ],
    caption: "Suv sifatini tekshirish algoritmi. Izoh: namuna olish, o‘lchash va mezon bo‘yicha baholash.",
  };
  const algorithmFlowchart = await renderFlowchart(algorithmFlowchartInput);
  const algorithmMetadata = await sharp(algorithmFlowchart.buf).metadata();
  assert.equal(algorithmMetadata.width, 576);
  assert.equal(algorithmMetadata.height, 1035);
  assert.equal(algorithmFlowchart.width, 1.92 * 96);
  assert.equal(algorithmFlowchart.height, 3.45 * 96);
  assert.ok(Math.abs(algorithmFlowchart.width / algorithmFlowchart.height - algorithmMetadata.width / algorithmMetadata.height) < 0.001,
    "vertikal algoritm rasmi 1.92 × 3.45 dyuymga aynan mos nisbatda saqlansin");
  imageCache.set("d_5", algorithmFlowchart);

  const controllerFlowchart = await renderFlowchart({
    type: "flowchart",
    diagram_type: "pid_control_system",
    title: "PID boshqaruv tizimining tarkibi",
    nodes: [
      { id: "setpoint", label: "Topshiriq signali", kind: "input" },
      { id: "sum", label: "Σ", kind: "sum" },
      { id: "controller", label: "PID rostlagich", kind: "controller" },
      { id: "plant", label: "Boshqaruv obyekti", kind: "plant" },
      { id: "sensor", label: "Datchik o'lchovi", kind: "sensor" },
    ],
    edges: [
      { from: "setpoint", to: "sum" },
      { from: "sum", to: "controller" },
      { from: "controller", to: "plant" },
      { from: "plant", to: "sensor" },
      { from: "sensor", to: "sum", label: "Teskari aloqa" },
    ],
  });
  assert.equal((await sharp(controllerFlowchart.buf).metadata()).format, "png");
  imageCache.set("d_4", controllerFlowchart);

  const docx = await buildDocument({
    meta: { title: "Render sinovi", student_name: "", student_group: "", supervisor: "" },
    chapters: [
      { id: "intro", title: "Kirish", content: [{ type: "paragraph", text: "Kirish sinov matni." }] },
      {
        id: "ch1",
        title: "1-bob: Tahlil",
        sections: [{ title: "1.1. Nazariy asoslar" }],
        content: [
          { type: "heading", level: 2, text: "1.1. Nazariy asoslar" },
          { type: "formula", number: 1, latex: formulaCases[0].latex, caption: "N-formula. Sinov formulasi" },
          {
            type: "chart", number: 1, chartType: "bar", title: "Sinov grafik", caption: "N-rasm. Sinov diagrammasi",
            labels: ["A", "B"], values: [1, 2], data_source: "sintetik sinov ma’lumoti",
          },
          {
            type: "flowchart", number: 2, diagram_type: "process_sequence", title: "Ichimlik suvini tozalash tarkibi",
            caption: "Ichimlik suvini tozalash tarkibi. Izoh: suv manbai, filtrlash, dezinfeksiya va sifat mezonining o'zaro aloqalari.",
            nodes: [{ id: "source", label: "Xom suv manbai", kind: "input" }, { id: "filter", label: "Filtrlash tizimi", kind: "step" }, { id: "treatment", label: "Dezinfeksiya", kind: "step" }, { id: "quality", label: "Suv sifati mezoni", kind: "step" }, { id: "deliver", label: "Ichimlik suvi ta'minoti", kind: "output" }],
            edges: [{ from: "source", to: "filter" }, { from: "filter", to: "treatment" }, { from: "treatment", to: "quality" }, { from: "quality", to: "deliver" }],
          },
          { type: "table", number: 1, title: "Sinov jadvali", caption: "N-jadval. Sinov jadvali", headers: ["A", "B", "C"], rows: [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]] },
        ],
      },
      {
        id: "ch2",
        title: "Ikkinchi tahlil",
        content: [
          { type: "formula", number: 1, latex: formulaCases[1].latex, caption: "1-formula. Ikkinchi formula" },
          {
            type: "chart", number: 1, chartType: "line", title: "Ikkinchi grafik", caption: "N-rasm. Ikkinchi diagramma",
            labels: ["C", "D"], values: [3, 4], data_source: "Official statistical yearbook",
          },
          {
            type: "flowchart", number: 4, diagram_type: "pid_control_system", title: "PID boshqaruv tizimining tarkibi",
            caption: "PID boshqaruv tizimining tarkibi. Izoh: topshiriq va o'lchov signallari rostlagich, ijro mexanizmi hamda boshqaruv obyekti bilan bog'liq.",
            nodes: [{ id: "setpoint", label: "Topshiriq signali", kind: "input" }, { id: "sum", label: "Σ", kind: "sum" }, { id: "controller", label: "PID rostlagich", kind: "controller" }, { id: "plant", label: "Boshqaruv obyekti", kind: "plant" }, { id: "sensor", label: "Datchik o'lchovi", kind: "sensor" }],
            edges: [{ from: "setpoint", to: "sum" }, { from: "sum", to: "controller" }, { from: "controller", to: "plant" }, { from: "plant", to: "sensor" }, { from: "sensor", to: "sum", label: "Teskari aloqa" }],
          },
          { ...algorithmFlowchartInput, number: 5 },
        ],
      },
      { id: "conclusion", title: "Xulosa", content: [] },
    ],
    references: ["Sinov manbasi"],
  }, imageCache);

  assert.ok(Buffer.isBuffer(docx));
  assert.equal(docx.subarray(0, 2).toString("ascii"), "PK", "DOCX ZIP arxivi bo‘lishi kerak");
  assert.ok(docx.length > 5_000, "DOCX matn va render qilingan media bilan mazmunli hajmga ega bo‘lishi kerak");

  const zip = await JSZip.loadAsync(docx);
  const documentXml = await zip.file("word/document.xml").async("string");
  const mediaEntries = Object.entries(zip.files).filter(([name, entry]) => name.startsWith("word/media/") && !entry.dir);
  assert.equal(mediaEntries.length, 7, "formula, chart va uchta Graphviz rasm fayli DOCX ichida bo'lishi kerak");
  const imageParagraphs = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).filter(paragraph => paragraph.includes("<w:drawing>"));
  assert.equal(imageParagraphs.length, 7, "barcha yettita rasm alohida DOCX paragrafida joylashishi kerak");
  assert.ok(imageParagraphs.every(paragraph => /<w:keepNext\b/.test(paragraph)), "har bir rasm ostyozuv paragrafi bilan birga keyingi sahifaga ko'chishi kerak");
  assert.match(documentXml, /1-rasm\. Sinov diagrammasi/);
  assert.match(documentXml, /2-rasm\. Ichimlik suvini tozalash tarkibi/);
  assert.match(documentXml, /3-rasm\. Ikkinchi diagramma/);
  assert.match(documentXml, /5-rasm\. Suv sifatini tekshirish algoritmi/);
  assert.match(documentXml, /<wp:extent cx="1752600" cy="3152775"\/>/, "algoritm rasmi Word hujjatida 1.92 × 3.45 dyuymga mos o‘lchamda qoladi");
  assert.match(documentXml, /Manba\/izoh: Official statistical yearbook/, "haqiqiy manba chart ostyozuvida saqlansin");
  assert.match(documentXml, /4-rasm\. PID boshqaruv tizimining tarkibi/);
  assert.match(documentXml, /\(1-formula\. Sinov formulasi\)/);
  assert.match(documentXml, /\(2-formula\. Ikkinchi formula\)/);
  assert.match(documentXml, /1-jadval\. Sinov jadvali/);
  assert.doesNotMatch(documentXml, /sintetik|synthetic|real o(?:'|&apos;)lchov emas|haqiqiy tajriba o(?:'|&apos;)lchovi emas/i,
    "chart va jadval captionlarida sun'iy ma'lumot statusi ko'rinmasin");
  assert.doesNotMatch(documentXml, /N-(?:rasm|formula|jadval)/i);
  const referenceStart = documentXml.lastIndexOf("Foydalanilgan adabiyotlar");
  const referencesXml = documentXml.slice(referenceStart);
  const referenceNumbers = [...referencesXml.matchAll(/<w:t(?:\s[^>]*)?>(\d+)\.\s/g)].map(match => Number(match[1]));
  assert.deepEqual(referenceNumbers, Array.from({ length: 12 }, (_, index) => index + 1), "builder bevosita chaqirilganda ham 12 ta manbani 1–12 tartibida chiqaradi");
  assert.equal((referencesXml.match(/https:\/\/doi\.org\/10\./g) || []).length, 12);
});

test("DOCX’dagi barcha diagrammalar sahifa eni/balandligining 60 foizidan oshmaydi va nisbatini saqlaydi", async () => {
  const widePng = await sharp({
    create: { width: 2000, height: 1000, channels: 4, background: { r: 230, g: 240, b: 250, alpha: 1 } },
  }).png().toBuffer();
  const tallPng = await sharp({
    create: { width: 1000, height: 2000, channels: 4, background: { r: 240, g: 230, b: 250, alpha: 1 } },
  }).png().toBuffer();
  const docx = await buildDocument({
    meta: { title: "Suvni tozalash", student_name: "", student_group: "", supervisor: "" },
    chapters: [{
      id: "ch1", title: "Suvni tozalash tarkibi",
      content: [{
        type: "chart", number: 1, chartType: "bar", title: "Suv ko‘rsatkichlari", labels: ["A", "B"], values: [1, 2],
      }, {
        type: "flowchart", number: 2, title: "Suvni tozalash tarkibi", caption: "Izoh: suvni filtrlash va sifat nazorati.",
        nodes: [
          { id: "source", label: "Xom suv manbai", kind: "step" },
          { id: "filter", label: "Filtrlash tizimi", kind: "step" },
          { id: "treatment", label: "Dezinfeksiya", kind: "step" },
          { id: "quality", label: "Suv sifati", kind: "step" },
          { id: "supply", label: "Ichimlik suvi", kind: "output" },
        ],
        diagram_type: "process_sequence",
        edges: [{ from: "source", to: "filter" }, { from: "filter", to: "treatment" }, { from: "treatment", to: "quality" }, { from: "quality", to: "supply" }],
      }],
    }],
    references: [],
  }, new Map([
    ["c_1", { buf: widePng, width: 2000, height: 1000 }],
    ["d_2", { buf: tallPng, width: 1000, height: 2000 }],
  ]));
  const archive = await JSZip.loadAsync(docx);
  const documentXml = await archive.file("word/document.xml").async("string");
  const drawings = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).filter(paragraph => paragraph.includes("<w:drawing>"));
  assert.equal(drawings.length, 2, "chart va flowchart alohida rasm sifatida joylashadi");
  const extents = drawings.map(paragraph => {
    const extent = paragraph.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    assert.ok(extent, "DOCX rasmning real EMU o‘lchamini saqlasin");
    return { width: Number(extent[1]), height: Number(extent[2]) };
  });
  extents.forEach(({ width, height }) => {
    assert.ok(width <= 210 * 36_000 * 0.6, "rasm eni sahifa enining 60 foizidan oshmasin");
    assert.ok(height <= 297 * 36_000 * 0.6, "rasm bo‘yi sahifa balandligining 60 foizidan oshmasin");
  });
  assert.ok(Math.abs(extents[0].width / extents[0].height - 2) < 0.01, "keng rasm proporsiyasi o‘zgarmasin");
  assert.ok(Math.abs(extents[1].width / extents[1].height - 0.5) < 0.01, "baland rasm proporsiyasi o‘zgarmasin");
  assert.ok(Math.abs(extents[0].width - 210 * 36_000 * 0.6) < 9_525, "keng tasvir 60 foizlik en limitiga qisqartirilsin");
  assert.ok(Math.abs(extents[1].height - 297 * 36_000 * 0.6) < 9_525, "baland tasvir 60 foizlik balandlik limitiga qisqartirilsin");
});

test("uzun chart X-o'qi yorliqlari satrlarga o'raladi va to'liq matnni saqlaydi", async () => {
  const longLabel = "Northern regional manufacturing throughput efficiency index by quarter and projected baseline";
  assert.equal(wrapLabelLines(longLabel, 18).join(" "), longLabel);
  assert.equal(wrapLabelLines("supercalifragilisticexpialidocious", 8).join(""), "supercalifragilisticexpialidocious",
    "bo'shliqsiz uzun token ham kesilmasin");

  const labels = [longLabel, "Current system response"];
  const barSvg = barSVG({ labels, values: [12, 16], title: "Bar labels" });
  const lineSvg = lineSVG({ labels: [longLabel, "Middle response", "Final output"], values: [12, 16, 18], title: "Line labels" });
  const pie = pieSVG({ labels: ["A", "B"], values: [2, 3], title: "Pie labels" });
  assert.match(barSvg, /<tspan/);
  assert.match(lineSvg, /<tspan/);
  assert.doesNotMatch(barSvg, /Bar labels/, "bar nomi DOCX captionida qoladi, rasm ichida takrorlanmaydi");
  assert.doesNotMatch(lineSvg, /Line labels/, "line nomi DOCX captionida qoladi, rasm ichida takrorlanmaydi");
  assert.doesNotMatch(pie, /Pie labels/, "pie nomi DOCX captionida qoladi, rasm ichida takrorlanmaydi");
  for (const word of longLabel.split(/\s+/)) {
    assert.ok(barSvg.includes(word), `bar SVG yo'riq yorlig'idagi ${word} so'zini saqlasin`);
    assert.ok(lineSvg.includes(word), `line SVG yo'riq yorlig'idagi ${word} so'zini saqlasin`);
  }
  assert.ok(Number(barSvg.match(/height="(\d+)"/)?.[1]) > 360, "bar chart balandligi qo'shimcha yorliq satrlariga mos kengaysin");
  assert.ok(Number(lineSvg.match(/height="(\d+)"/)?.[1]) > 320, "line chart balandligi qo'shimcha yorliq satrlariga mos kengaysin");
  const veryLongLabel = Array(4).fill(longLabel).join(" ");
  const image = await renderChart({ chartType: "line", labels: [veryLongLabel, "Current response"], values: [12, 16], title: "Uzoq yorliqlar" });
  assert.ok(image.height > Math.round(440 * 320 / 600), "PNG renderi o'ralgan yorliqlar uchun vertikal joy ajratsin");
});

test("media renderi xato bo'lsa ham DOCX matnli fallback bilan tayyorlanadi", async () => {
  const chapter = {
    id: "ch1",
    title: "Media fallback sinovi",
    level: 1,
    content: [
      { type: "chart", number: 1, title: "Fallback grafik", caption: "Grafik captioni", chartType: "invalid", labels: ["A", "B"], values: [1, 2], data_source: "Sintetik illustrativ ma'lumot; real o'lchov emas" },
      { type: "flowchart", number: 2, title: "Fallback oqim sxemasi", caption: "Izoh: jarayonning asosiy bosqichlari ketma-ket ko'rsatilgan.", nodes: [], edges: [] },
      { type: "flowchart", number: 3, diagram_type: "process_sequence", title: "Buzilgan PNG sinovi", caption: "Izoh: jarayonning asosiy bosqichlari ketma-ket ko'rsatilgan.", nodes: [{ id: "a", label: "Birinchi bosqich", kind: "step" }, { id: "b", label: "Ikkinchi bosqich", kind: "step" }, { id: "c", label: "Uchinchi bosqich", kind: "step" }, { id: "d", label: "To‘rtinchi bosqich", kind: "step" }, { id: "e", label: "Beshinchi bosqich", kind: "output" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "e" }] },
    ],
  };
  const cache = await prerenderMedia([chapter]);
  assert.equal(cache.size, 1, "faqat valid flowchart PNG keshga kirishi kerak");
  assert.ok(cache.has("d_3"));
  const validPng = await sharp({ create: { width: 100, height: 100, channels: 4, background: "white" } }).png().toBuffer();
  cache.set("c_1", { buf: validPng, width: 100, height: 100 });
  cache.set("d_2", { buf: validPng, width: 100, height: 100 });
  cache.set("d_3", { buf: Buffer.from("not a PNG"), width: 100, height: 100 });

  const docx = await buildDocument({
    meta: { title: "Media fallback sinovi", student_name: "", student_group: "", supervisor: "" },
    chapters: [
      { id: "intro", title: "Kirish", content: [{ type: "paragraph", text: "Kirish matni." }] },
      chapter,
      { id: "conclusion", title: "Xulosa", content: [] },
    ],
    references: ["Sinov manbasi"],
  }, cache);
  assert.equal(docx.subarray(0, 2).toString("ascii"), "PK");
  const zip = await JSZip.loadAsync(docx);
  const documentXml = await zip.file("word/document.xml").async("string");
  const mediaEntries = Object.keys(zip.files).filter(name => name.startsWith("word/media/") && !zip.files[name].dir);
  assert.equal(mediaEntries.length, 0, "noto‘g‘ri diagramma data yoki buzilgan PNG DOCX media ichiga kirmasin");
  assert.doesNotMatch(documentXml, /<w:drawing>/, "xato yoki tekshirilmagan diagramma rasmi DOCX’da bo‘lmasin");
  assert.match(documentXml, /Fallback grafik/);
  assert.doesNotMatch(documentXml, /sintetik|synthetic|real o(?:'|&apos;)lchov emas/i);
  assert.match(documentXml, /Fallback oqim sxemasi/);
});
