const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const {
  generateMustaqilIsh,
  boundedConcurrency,
  mapWithConcurrency,
  WORD_ACCEPTANCE_RATIO,
  evaluateWordTargets,
  buildTextSlotRetryPrompt,
  retryDeficientTextSlots,
} = require("../src/mustaqil/generate");

const references = [
  "Karimov, A. (2020). O‘zbekiston ta’lim tizimi va rivojlanish asoslari. Fan va texnologiya. 248 pp. https://doi.org/10.0000/refs.uz.2020.karimov",
  "Ivanov, I. I. (2019). Основы автоматического управления. Наука. 320 pp. https://doi.org/10.0000/refs.ru.2019.ivanov",
  "Smith, J. (2021). The fundamentals of control systems. Academic Press. 286 pp. https://doi.org/10.0000/refs.en.2021.smith",
  "Rahimov, B. (2018). O‘zbek adabiyoti tarixi va nazariyasi. Sharq. 275 pp. https://doi.org/10.0000/refs.uz.2018.rahimov",
  "Petrov, P. P. (2022). Исследование систем управления. Издательство МГУ. 310 pp. https://doi.org/10.0000/refs.ru.2022.petrov",
  "Brown, R. (2020). Research methods in engineering. Springer. 296 pp. https://doi.org/10.0000/refs.en.2020.brown",
  "Usmonov, D. (2023). O‘quv jarayonini boshqarish va tahlil. Universitet nashriyoti. 264 pp. https://doi.org/10.0000/refs.uz.2023.usmonov",
  "Sidorov, S. S. (2021). Современные методы анализа данных. Научное издательство. 302 pp. https://doi.org/10.0000/refs.ru.2021.sidorov",
];
const incompleteReferences = [
  "Taylor, A. (2020). The control systems study 1. Test Press.",
  "Taylor, A. (2021). The control systems study 2. Test Press.",
  "Taylor, A. (2022). The control systems study 3. Test Press.",
  "Taylor, A. (2023). The control systems study 4. Test Press.",
  "Taylor, A. (2024). The control systems study 5. Test Press.",
  "Taylor, A. (2019). The control systems study 6. Test Press.",
  "Taylor, A. (2018). The control systems study 7. Test Press.",
  "Taylor 2017. The control systems study 8.",
];

function fakeOutline(outlineReferences = incompleteReferences) {
  return {
    meta: { title: "Pipeline sinovi" },
    chapters: [
      { id: "intro", title: "Kirish", role: "introduction" },
      {
        id: "ch1", title: "Nazariy asoslar", role: "theory",
        sections: [{ title: "Tizim modeli" }, { title: "Asosiy parametrlar" }],
        formula_count: 2, formula_plans: [
          { latex: "G(s)=\\frac{1}{s+1}", concept: "Birinchi tartibli tizim modeli" },
          { latex: "y(t)=1-e^{-t}", concept: "O'tkinchi jarayon javobi" },
        ],
        chart_count: 1, chart_type: "bar", chart_plans: [{ title: "Tizim ko'rsatkichlari", variable: "ikki parametr taqqoslanishi" }],
      },
      {
        id: "ch2", title: "Amaliy tahlil", role: "analysis",
        sections: [{ title: "Natijalar tahlili" }, { title: "Amaliy ahamiyat" }],
        chart_count: 1, chart_type: "line", chart_plans: [{ title: "Vaqt bo'yicha javob", variable: "vaqt bo'yicha chiqish qiymati" }],
      },
      {
        id: "ch3", title: "Avtomatik boshqaruv tizimi tarkibi", role: "methodology",
        sections: [{ title: "Datchik va rostlagich aloqasi" }, { title: "Ijro mexanizmi va obyekt" }],
        flowchart_count: 1, flowchart_plans: [{ title: "Boshqaruv tizimining tarkibi", purpose: "avtomatik boshqaruvda datchik o'lchovi, rostlagich, ijro mexanizmi va boshqaruv obyekti aloqasi" }],
      },
      { id: "ch4", title: "Tizim samaradorligi", role: "analysis", sections: [{ title: "Samaradorlik tahlili" }] },
      { id: "conclusion", title: "Xulosa", role: "conclusion" },
    ],
    references: outlineReferences,
  };
}

function proseResponse(userPrompt) {
  const id = userPrompt.match(/"chapter_id":"([^"]+)"/)?.[1];
  if (!id) throw new Error("Mock prose promptida chapter_id topilmadi");
  const targetMatch = userPrompt.match(/(?:Jami matn|Kirish qismi|Xulosa qismi) (\d+) so'z/);
  const totalWords = Number(targetMatch?.[1]) || (id === "intro" ? 265 : id === "conclusion" ? 220 : 398);
  const sectionCount = [...userPrompt.matchAll(/^\d+\. .*?: aynan 3 paragraf/gm)].length;
  const paragraphCount = id === "intro" || id === "conclusion" ? 3 : Math.max(3, sectionCount * 3);
  const each = Math.floor(totalWords / paragraphCount);
  const counts = Array.from({ length: paragraphCount }, (_, index) => each + (index < totalWords % paragraphCount ? 1 : 0));
  const content = [];
  counts.forEach((count, paragraph) => {
    const tag = id.replace(/[^a-z0-9]/gi, "").slice(-1) || "x";
    const tokens = Array.from({ length: count }, (_, index) => `${tag}${paragraph}${index.toString(36)}`);
    content.push({ type: "paragraph", text: tokens.join(" ") });
  });
  const slotIds = [...new Set([...userPrompt.matchAll(/\{"type":"media_slot","slot_id":"([^"]+)"\}/g)].map(match => match[1]))];
  for (const slot_id of slotIds) content.push({ type: "media_slot", slot_id });
  return { chapter_id: id, content };
}

function mediaResponse(userPrompt, attempts) {
  const slotId = userPrompt.match(/Slot ID: ([^\s.]+)/)?.[1];
  if (!slotId) throw new Error("Mock media promptida Slot ID topilmadi");
  const attempt = (attempts.get(slotId) || 0) + 1;
  attempts.set(slotId, attempt);
  if (slotId === "ch1:formula:1" && attempt === 1) {
    return { slot_id: slotId, type: "formula", latex: "a+b=c", display_text: "a+b=c", caption: "Noto'g'ri" };
  }
  if (slotId === "ch1:formula:1") return { slot_id: slotId, type: "formula", latex: "G(s)=\\frac{1}{s+1}", display_text: "G(s)=1/(s+1)", caption: "Tizim modeli" };
  if (slotId === "ch2:formula:1") return { slot_id: slotId, type: "formula", latex: "y(t)=1-e^{-t}", display_text: "y(t)=1-e^-t", caption: "O'tkinchi javob" };
  if (slotId.endsWith(":chart:1")) {
    const chartType = userPrompt.match(/chartType=(bar|line|pie)/)?.[1] || "bar";
    return { slot_id: slotId, type: "chart", chartType, title: "Ko'rsatkichlar", labels: ["A", "B", "C"], values: [12, 19, 15], unit: "birlik", data_source: "Sintetik illustrativ ma'lumot; real o'lchov emas", caption: "Namunaviy solishtirish" };
  }
  if (slotId.endsWith(":flowchart:1")) {
    const diagramType = userPrompt.match(/Tanlangan va o‘zgarmas diagram_type: ([a-z_]+)/)?.[1] || "functional_block_diagram";
    const examples = {
      functional_block_diagram: {
        nodes: [
          { id: "sensor", label: "Datchik o‘lchovi", kind: "input" },
          { id: "controller", label: "Rostlagich modeli", kind: "process" },
          { id: "signal", label: "Boshqaruv signali", kind: "process" },
          { id: "plant", label: "Boshqaruv obyekti", kind: "process" },
          { id: "output", label: "O‘lchangan javob", kind: "output" },
        ],
        edges: [["sensor", "controller"], ["controller", "signal"], ["signal", "plant"], ["plant", "output"]],
      },
      process_sequence: {
        nodes: [
          { id: "sensor", label: "Datchik o‘lchovi", kind: "step" },
          { id: "compare", label: "Topshiriq bilan taqqoslash", kind: "step" },
          { id: "control", label: "Rostlagich hisoblash", kind: "step" },
          { id: "actuate", label: "Ijro signalini uzatish", kind: "step" },
          { id: "response", label: "Obyekt javobi", kind: "output" },
        ],
        edges: [["sensor", "compare"], ["compare", "control"], ["control", "actuate"], ["actuate", "response"]],
      },
      algorithm_flowchart: {
        nodes: [
          { id: "start", label: "Boshlash", kind: "start" },
          { id: "measure", label: "O‘lchovni olish", kind: "input" },
          { id: "decision", label: "Mezon bajarildimi?", kind: "decision" },
          { id: "adjust", label: "Signalni tuzatish", kind: "process" },
          { id: "end", label: "Natijani qayd etish", kind: "end" },
        ],
        edges: [["start", "measure"], ["measure", "decision"], ["decision", "adjust", "Ha"], ["decision", "end", "Yo‘q"], ["adjust", "end"]],
      },
      pid_control_system: {
        nodes: [
          { id: "reference", label: "Topshiriq signali", kind: "input" },
          { id: "sum", label: "Σ", kind: "sum" },
          { id: "controller", label: "PID rostlagich", kind: "controller" },
          { id: "plant", label: "Boshqaruv obyekti", kind: "plant" },
          { id: "sensor", label: "Datchik o‘lchovi", kind: "sensor" },
        ],
        edges: [["reference", "sum"], ["sum", "controller"], ["controller", "plant"], ["plant", "sensor"], ["sensor", "sum", "Teskari aloqa"]],
      },
      uml_software_architecture: {
        nodes: [
          { id: "control", label: "Boshqaruv komponenti", kind: "component" },
          { id: "service", label: "Rostlash xizmati", kind: "class" },
          { id: "database", label: "O‘lchovlar ombori", kind: "database" },
        ],
        edges: [["control", "service", "calls"], ["service", "database", "reads"]],
      },
    };
    const selected = examples[diagramType] || examples.functional_block_diagram;
    return {
      slot_id: slotId, type: "flowchart", diagram_type: diagramType,
      title: "Avtomatik boshqaruv tizimining tarkibi", nodes: selected.nodes,
      edges: selected.edges.map(([from, to, label = ""]) => ({ from, to, label })),
    };
  }
  throw new Error(`Kutilmagan slot: ${slotId}`);
}

test("16 betlik ish DOCX yaratadi va PDF/layout tekshiruvisiz media slotlarini boshqaradi", async () => {
  const originalFetch = global.fetch;
  let activeRequests = 0;
  let maxRequests = 0;
  const requests = [];
  const progressUpdates = [];
  const mediaAttempts = new Map();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "slidepro-pipeline-"));
  const outFile = path.join(tempDir, "pipeline.docx");
  global.fetch = async (_url, options) => {
    activeRequests++;
    maxRequests = Math.max(maxRequests, activeRequests);
    try {
      await new Promise(resolve => setTimeout(resolve, 8));
      const body = JSON.parse(options.body);
      const userPrompt = body.messages.find(message => message.role === "user")?.content || "";
      requests.push(userPrompt);
      let payload;
      if (userPrompt.includes("BIBLIOGRAFIYANI TUZATISH")) payload = { references };
      else if (userPrompt.includes("Akademik mustaqil ish uchun tuzilma")) payload = fakeOutline(references.slice(0, 7));
      else if (userPrompt.includes("MEDIA AJRATISH QOIDASI")) payload = proseResponse(userPrompt);
      else if (userPrompt.includes("Slot ID:")) payload = mediaResponse(userPrompt, mediaAttempts);
      else throw new Error(`Kutilmagan LLM prompt: ${userPrompt.slice(0, 100)}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } finally {
      activeRequests--;
    }
  };

  try {
    const result = await generateMustaqilIsh({
      topic: "Avtomatik boshqaruv tizimlari", pages: 16, language: "o'zbek", outFile,
      llm: { provider: "openai", openaiKey: "mock-key", openaiModel: "mock-model" },
      onProgress: update => progressUpdates.push(update),
    });
    assert.equal(result.title, "Pipeline sinovi");
    assert.equal(result.pageVerification, "skipped", "DOCX generatsiyasi PDF/layout tekshiruviga bog'liq emas");
    assert.deepEqual(progressUpdates.map(update => update.percent), [12, 60, 85, 97]);
    assert.ok(progressUpdates.every((update, index) => index === 0 || update.percent >= progressUpdates[index - 1].percent));
    assert.equal(result.pageCount, null, "PDF tekshirilmagani uchun haqiqiy bet soni da'vo qilinmaydi");
    assert.equal(result.layoutVerification.status, "skipped");
    assert.equal(result.layoutVerification.actualPageCount, null);
    assert.equal(result.layoutVerification.maxExpectedPages, result.maxExpectedPageCount);
    assert.equal(result.maxExpectedPageCount, result.plannedPageCount + 2);
    assert.deepEqual(result.layoutVerification.errors, []);
    assert.equal(fs.existsSync(outFile), true);
    assert.ok(fs.statSync(outFile).size > 5_000);
    const archive = await JSZip.loadAsync(fs.readFileSync(outFile));
    const mediaFiles = Object.keys(archive.files).filter(name => name.startsWith("word/media/") && !archive.files[name].dir);
    assert.equal(mediaFiles.length, 6, "ikkita formula, ikkita chart va ikkita Graphviz PNG Word fayliga qo'shiladi");
    const documentXml = await archive.file("word/document.xml").async("string");
    assert.equal((documentXml.match(/<w:drawing>/g) || []).length, 6);
    assert.doesNotMatch(documentXml, /sintetik|synthetic|real o(?:'|&apos;)lchov emas|haqiqiy tajriba o(?:'|&apos;)lchovi emas/i,
      "yakuniy hujjatdagi media nomlari va captionlarida sun'iy ma'lumot disclosure'i bo'lmasin");
    assert.match(documentXml, /1-formula\. Tizim modeli/);
    assert.match(documentXml, /2-formula\. O(?:&apos;|')tkinchi javob/);
    assert.match(documentXml, /\d+-rasm\. Izoh:/, "Graphviz sarlavhasi rasm ichidan olib tashlansa ham DOCX captioni saqlansin");
    const bibliographyStart = documentXml.lastIndexOf("Foydalanilgan adabiyotlar");
    assert.notEqual(bibliographyStart, -1, "bibliografiya bo'limi DOCX ichida mavjud");
    const bibliographyXml = documentXml.slice(bibliographyStart);
    const bibliographyNumbers = [...bibliographyXml.matchAll(/<w:t(?:\s[^>]*)?>(\d+)\.\s/g)].map(match => Number(match[1]));
    assert.deepEqual(bibliographyNumbers, Array.from({ length: 12 }, (_, index) => index + 1), "DOCX adabiyotlar sahifasida aynan 12 ta manba 1–12 tartibda raqamlanadi");
    assert.equal((bibliographyXml.match(/https:\/\/doi\.org\/10\./g) || []).length, 12, "har bir adabiyot yozuvida DOI havolasi bo‘ladi");
    assert.match(bibliographyXml, /\d+ pp\./, "kitob yozuvlarida umumiy sahifa soni ko‘rsatiladi");
    assert.doesNotMatch(bibliographyXml, /AI-generated|verify before citation|synthetic|fallback/i, "yakuniy bibliografiyada sintetik yoki fallback belgisi bo'lmaydi");
    assert.ok(bibliographyXml.indexOf("Brown, R.") < bibliographyXml.indexOf("Ivanov, I. I."), "APA manbalari muallif bo'yicha saralanadi");
    assert.match(bibliographyXml, /O‘zbekiston ta’lim tizimi/);
    assert.match(bibliographyXml, /Основы автоматического управления/);
    assert.match(bibliographyXml, /fundamentals of control systems/i, "yakuniy ro'yxatda ingliz tilidagi asl manba ham bor");
    assert.doesNotMatch(bibliographyXml, /<w:numPr>/, "ko‘rinadigan raqamlar DOCX matnining o‘zida tartibli va barqaror bo‘ladi");
    assert.match(bibliographyXml, /<w:i\s*\/>/, "kitob nomi yoki jurnal nomi APA bo'yicha kursiv qilinadi");
    assert.equal(maxRequests, 3, "barcha parallel LLM so'rovlari concurrency=3 chegarasida qoladi");
    assert.equal(requests.filter(prompt => prompt.includes("Akademik mustaqil ish uchun tuzilma")).length, 1, "bibliografiya sifati outline generatsiyasini qayta boshlatmaydi");
    const bibliographyRetries = requests.filter(prompt => prompt.includes("BIBLIOGRAFIYANI TUZATISH"));
    assert.equal(bibliographyRetries.length, 1, "til qamrovi/APA muammosi uchun faqat bitta alohida bibliografiya retry bo'ladi");
    assert.match(bibliographyRetries[0], /references maydonini qaytar/);
    assert.match(bibliographyRetries[0], /AYNAN 12 ta yozuv/);
    assert.match(bibliographyRetries[0], /Hech qanday AI, sintetik, tekshirish yoki boshqa belgi\/yorliq\/izoh qo'shma/);
    assert.doesNotMatch(bibliographyRetries[0], /AI-generated|verify before citation|AI-illustrativ/i);
    assert.doesNotMatch(bibliographyRetries[0], /Nazariy asoslar|Amaliy tahlil/, "retry boblar mazmunini qayta yaratishni so'ramaydi");
    assert.equal(requests.filter(prompt => prompt.includes("MEDIA AJRATISH QOIDASI")).length, 6, "6 ta bobning prose so'rovlari media payloadini generatsiya qilmaydi");
    const slotRequests = requests.filter(prompt => prompt.includes("Slot ID:"));
    assert.equal(slotRequests.length, 7, "6 ta media sloti va faqat bitta yaroqsiz formula slotiga qo'shimcha urinish bo'ladi");
    assert.ok(slotRequests.every(prompt => /status yorlig'i qo'shma|status yorliqlarini ishlatma/i.test(prompt)), "media promptlari captionlarda status/disclosure yorlig'ini taqiqlasin");
    const flowchartRequests = slotRequests.filter(prompt => prompt.includes('"type":"flowchart"'));
    assert.equal(flowchartRequests.length, 2, "har bir rejalashtirilgan Graphviz sloti alohida prompt oladi");
    const selectedTypes = flowchartRequests.map(prompt => prompt.match(/Tanlangan va o‘zgarmas diagram_type: ([A-Za-z0-9_]+)/)?.[1]);
    assert.ok(selectedTypes.every(type => ["functional_block_diagram", "algorithm_flowchart", "pid_control_system", "uml_software_architecture", "process_sequence"].includes(type)), "har bir Graphviz promptida mavzuga mos semantic diagram_type ko'rsatiladi");
    assert.ok(flowchartRequests.every(prompt => /Avtomatik boshqaruv tizimlari/.test(prompt) && /bob|Reja:/i.test(prompt)), "Graphviz so'rovlari hujjat mavzusi va bob rejasi bilan boyitiladi");
    assert.equal(new Set(slotRequests.map(prompt => prompt.match(/Slot ID: ([^\s.]+)/)?.[1])).size, 6);
    assert.equal(mediaAttempts.get("ch1:formula:1"), 2, "yaroqsiz LaTeX rejaga mos kelmagani uchun aynan shu slot qayta olinadi");
    assert.equal(mediaAttempts.get("ch2:formula:1"), 1, "ikkinchi yaroqli formula sloti qayta so'ralmaydi");
    assert.ok([...mediaAttempts].filter(([slotId]) => !slotId.includes(":formula:")).every(([, count]) => count === 1));
    assert.equal(requests.filter(prompt => prompt.includes("Slot ID: ch1:formula:1")).length, 2);
    assert.ok(requests.filter(prompt => prompt.includes("Slot ID:")).every(prompt => !prompt.includes("MEDIA AJRATISH QOIDASI")));
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Graphviz renderlari yiqilsa ham pipeline qolgan media bilan DOCX tayyorlaydi", async () => {
  const originalFetch = global.fetch;
  const originalPath = process.env.PATH;
  const mediaAttempts = new Map();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "slidepro-flowchart-fallback-"));
  const outFile = path.join(tempDir, "fallback.docx");
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const userPrompt = body.messages.find(message => message.role === "user")?.content || "";
    let payload;
    if (userPrompt.includes("BIBLIOGRAFIYANI TUZATISH")) payload = { references };
    else if (userPrompt.includes("Akademik mustaqil ish uchun tuzilma")) payload = fakeOutline(references.slice(0, 7));
    else if (userPrompt.includes("MEDIA AJRATISH QOIDASI")) payload = proseResponse(userPrompt);
    else if (userPrompt.includes("Slot ID:")) payload = mediaResponse(userPrompt, mediaAttempts);
    else throw new Error(`Kutilmagan LLM prompt: ${userPrompt.slice(0, 100)}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  process.env.PATH = "";

  try {
    const result = await generateMustaqilIsh({
      topic: "Avtomatik boshqaruv tizimlari", pages: 16, language: "o'zbek", outFile,
      llm: { provider: "openai", openaiKey: "mock-key", openaiModel: "mock-model" },
    });
    assert.equal(result.title, "Pipeline sinovi");
    assert.equal(fs.existsSync(outFile), true, "bitta Graphviz muammosi hujjatni bekor qilmasin");
    const archive = await JSZip.loadAsync(fs.readFileSync(outFile));
    const mediaFiles = Object.keys(archive.files).filter(name => name.startsWith("word/media/") && !archive.files[name].dir);
    assert.equal(mediaFiles.length, 4, "valid formula/chart rasmlari qoladi, render xatosi bo‘lgan flowchart rasmlari kiritilmaydi");
    const documentXml = await archive.file("word/document.xml").async("string");
    assert.equal((documentXml.match(/<w:drawing>/g) || []).length, 4);
    assert.match(documentXml, /\[Oqim sxemasi:/, "flowchart rasm bo‘lmasa ham uning xavfsiz matnli fallbacki qoladi");
  } finally {
    global.fetch = originalFetch;
    if (originalPath == null) delete process.env.PATH;
    else process.env.PATH = originalPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SLIDEPRO_LLM_CONCURRENCY qiymati hech qachon 3 dan oshmaydi", async () => {
  const original = process.env.SLIDEPRO_LLM_CONCURRENCY;
  process.env.SLIDEPRO_LLM_CONCURRENCY = "6";
  try {
    assert.equal(boundedConcurrency(), 3);
    let active = 0;
    let maximum = 0;
    await mapWithConcurrency(Array.from({ length: 8 }, (_, index) => index), 6, async value => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return value;
    });
    assert.equal(maximum, 3, "helper limit argumenti ham hard capni chetlab o'tmasin");
  } finally {
    if (original == null) delete process.env.SLIDEPRO_LLM_CONCURRENCY;
    else process.env.SLIDEPRO_LLM_CONCURRENCY = original;
  }
});


function countedParagraph(count, word) {
  return { type: "paragraph", text: Array.from({ length: count }, () => word).join(" ") };
}

function sectionRetryFixture(wordCounts = [70, 100]) {
  const sections = [
    { id: "ch1_1", title: "Monitoring mezonlari", word_target: 100 },
    { id: "ch1_2", title: "Xavfni baholash", word_target: 100 },
  ];
  const firstHeading = { type: "heading", level: 2, text: "1.1. Monitoring mezonlari" };
  const secondHeading = { type: "heading", level: 2, text: "1.2. Xavfni baholash" };
  const media = { type: "formula", number: 1, latex: "x=1", slot_id: "ch1:formula:1" };
  const firstParagraph = countedParagraph(wordCounts[0], "monitoring");
  const secondParagraph = countedParagraph(wordCounts[1], "xavfni");
  const chapter = {
    id: "ch1", title: "Aniqlash va monitoring", role: "analysis", word_target: 200,
    sections,
    content: [firstHeading, firstParagraph, media, secondHeading, secondParagraph],
  };
  const outlineChapters = [{
    id: chapter.id, title: chapter.title, role: chapter.role, word_target: chapter.word_target, sections,
  }];
  return { chapters: [chapter], outlineChapters, sections, firstHeading, secondHeading, firstParagraph, secondParagraph, media };
}

test("har bir subsection 85% va 115% chegaralarida qabul qilinadi", () => {
  const fixture = sectionRetryFixture([85, 115]);
  const result = evaluateWordTargets(fixture.chapters, fixture.outlineChapters, 200);
  assert.equal(WORD_ACCEPTANCE_RATIO, 0.85);
  assert.equal(result.totalWords, 200);
  assert.equal(result.totalAccepted, true);
  assert.equal(result.outOfRangeSlots.length, 0);
  assert.equal(result.underfilledSlots.length, 0);
  assert.equal(result.accepted, true);
});

test("subsectionlar 85% dan past yoki 115% dan yuqori bo'lsa diapazondan tashqarida", () => {
  const below = sectionRetryFixture([84, 115]);
  const above = sectionRetryFixture([85, 116]);
  assert.deepEqual(evaluateWordTargets(below.chapters, below.outlineChapters, 200).outOfRangeSlots.map(slot => slot.sectionId), ["ch1_1"]);
  assert.deepEqual(evaluateWordTargets(above.chapters, above.outlineChapters, 200).outOfRangeSlots.map(slot => slot.sectionId), ["ch1_2"]);
});

test("Kirish va Xulosa 60% dan boshlab qabul qilinadi, 60% dan kami yoki 115% dan pasti emas", () => {
  for (const chapter of [
    { id: "intro", title: "Kirish", role: "introduction" },
    { id: "conclusion", title: "Xulosa", role: "conclusion" },
  ]) {
    const planned = { ...chapter, word_target: 100, sections: [] };
    for (const words of [60, 85, 115]) {
      const result = evaluateWordTargets([{ ...planned, content: [countedParagraph(words, "matn")] }], [planned], 100);
      assert.equal(result.totalAccepted, true, `${chapter.title} ${words}% bo'lsa jami qabul qilinishi kerak`);
      assert.equal(result.accepted, true);
      assert.equal(result.outOfRangeSlots.length, 0);
    }
    for (const words of [59, 116]) {
      const result = evaluateWordTargets([{ ...planned, content: [countedParagraph(words, "matn")] }], [planned], 100);
      assert.equal(result.totalAccepted, false, `${chapter.title} ${words}% bo'lsa jami rad etilishi kerak`);
      assert.equal(result.accepted, false);
    }
  }
});

test("Kirishning 60% va boshqa slotning 85% minimumi birgalikda qabul qilinadi", () => {
  const intro = { id: "intro", title: "Kirish", role: "introduction", word_target: 100, sections: [], content: [countedParagraph(60, "kirish")] };
  const chapter = {
    id: "ch1", title: "Tahlil", role: "analysis", word_target: 100,
    sections: [{ id: "ch1_1", title: "Tahlil bo'limi", word_target: 100 }],
    content: [
      { type: "heading", level: 2, text: "1.1. Tahlil bo'limi" },
      countedParagraph(85, "tahlil"),
    ],
  };
  const outline = [
    { id: "intro", title: "Kirish", role: "introduction", word_target: 100, sections: [] },
    { id: "ch1", title: "Tahlil", role: "analysis", word_target: 100, sections: chapter.sections },
  ];
  const result = evaluateWordTargets([intro, chapter], outline, 200);
  assert.equal(result.effectiveMinimumRatio, 0.725);
  assert.equal(result.totalAccepted, true);
  assert.equal(result.accepted, true);
});

test("faqat 85% dan kam bo'lgan aniq kichik bo'lim yetarli hajmgacha qayta so'raladi", async () => {
  const fixture = sectionRetryFixture([70, 100]);
  const calls = [];
  const responses = [countedParagraph(84, "qisqa-monitoring"), countedParagraph(90, "yangi-monitoring")];
  const retried = await retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async slot => {
    calls.push(slot);
    const prompt = buildTextSlotRetryPrompt({
      slot,
      chapter: fixture.chapters[slot.chapterIndex],
      outline: { meta: { title: "Tarakanlarni yo‘qotish" } },
      language: "o'zbek",
    });
    assert.match(prompt, /Monitoring mezonlari/);
    assert.match(prompt, /taxminan 110 so'z/);
    assert.match(prompt, /qabul oralig'i nominal maqsad bo'yicha 85–115 so'zligicha qoladi/i);
    assert.doesNotMatch(prompt, /Xavfni baholash/);
    return [responses.shift()];
  }, 1);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, "section");
  assert.equal(calls[0].sectionId, "ch1_1");
  assert.equal(calls[0].title, "Monitoring mezonlari");
  assert.equal(calls[1].retryAttempt, 2);
  assert.equal(calls[1].actual, 84);
  assert.equal(retried.validation.accepted, true);
  assert.equal(retried.chapters[0].content.includes(fixture.firstHeading), true);
  assert.equal(retried.chapters[0].content.includes(fixture.secondHeading), true);
  assert.equal(retried.chapters[0].content.includes(fixture.secondParagraph), true);
  assert.equal(retried.chapters[0].content.includes(fixture.media), true);
});

test("kam subsection kerakli hajmga yetmaguncha retry qilinadi, skip qilinmaydi va media saqlanadi", async () => {
  const fixture = sectionRetryFixture([70, 100]);
  let attempts = 0;
  const retried = await retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async slot => {
    attempts++;
    assert.equal(slot.sectionId, "ch1_1");
    return [countedParagraph([84, 84, 85][attempts - 1], "qisqa-retry")];
  }, 1);

  assert.equal(attempts, 3);
  assert.deepEqual(retried.skippedSlots, []);
  assert.equal(retried.validation.underfilledSlots.length, 0);
  assert.equal(retried.validation.totalAccepted, true);
  assert.equal(retried.validation.accepted, true);
  assert.equal(retried.validation.totalWords, 185);
  assert.equal(retried.validation.effectiveTotalWords, 185);
  assert.equal(retried.validation.effectiveTotalTarget, 200);
  const content = retried.chapters[0].content;
  assert.equal(content.includes(fixture.firstHeading), true);
  assert.equal(content.includes(fixture.secondHeading), true);
  assert.equal(content.includes(fixture.secondParagraph), true);
  assert.equal(content.includes(fixture.media), true);
  assert.equal(content.some(item => item.type === "paragraph" && item.text.includes("qisqa-retry")), true);
});

test("115% dan yuqori subsection 115% ichiga kirguncha retry qilinadi va skip qilinmaydi", async () => {
  const fixture = sectionRetryFixture([120, 100]);
  let attempts = 0;
  const retried = await retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async slot => {
    attempts++;
    assert.equal(slot.sectionId, "ch1_1");
    return [countedParagraph([116, 115][attempts - 1], "upper-retry")];
  }, 1);

  assert.equal(attempts, 2);
  assert.deepEqual(retried.skippedSlots, []);
  assert.equal(retried.chapters[0].content.some(item => item.type === "paragraph" && item.text.includes("upper-retry")), true,
    "muvaffaqiyatli retry matni qo'llanadi");
  assert.equal(retried.chapters[0].content.includes(fixture.firstHeading), true);
  assert.equal(retried.chapters[0].content.includes(fixture.secondHeading), true);
  assert.equal(retried.chapters[0].content.includes(fixture.secondParagraph), true);
  assert.equal(retried.chapters[0].content.includes(fixture.media), true);
  assert.equal(retried.validation.effectiveTotalWords, 215);
  assert.equal(retried.validation.effectiveTotalTarget, 200);
  assert.equal(retried.validation.totalAccepted, true);
  assert.equal(retried.validation.accepted, true);
});

test("retry natijasi qisqaroq bo'lsa eng yaxshi mavjud prose saqlanib, qabul oralig'igacha qayta so'raladi", async () => {
  const fixture = sectionRetryFixture([70, 100]);
  let attempts = 0;
  const retried = await retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async slot => {
    attempts++;
    if (attempts === 1) return [countedParagraph(60, "bundan-qisqa")];
    assert.equal(slot.actual, 70, "yomonroq retry best-matnni almashtirmasligi kerak");
    return [countedParagraph(90, "yetarli-yangi")];
  }, 1);

  assert.equal(attempts, 2);
  assert.deepEqual(retried.skippedSlots, []);
  assert.equal(retried.chapters[0].content.includes(fixture.firstParagraph), false);
  assert.equal(retried.chapters[0].content.some(item => item.type === "paragraph" && item.text.includes("bundan-qisqa")), false);
  assert.equal(retried.chapters[0].content.some(item => item.type === "paragraph" && item.text.includes("yetarli-yangi")), true);
  assert.equal(retried.chapters[0].content.includes(fixture.secondHeading), true);
  assert.equal(retried.chapters[0].content.includes(fixture.secondParagraph), true);
  assert.equal(retried.chapters[0].content.includes(fixture.media), true);
  assert.equal(retried.validation.accepted, true);
});

test("Kirish va Xulosa 60% dan kam bo'lsa 60% ga yetguncha retry qilinadi", async () => {
  const chapter = { id: "intro", title: "Kirish", role: "introduction", word_target: 100, sections: [], content: [countedParagraph(50, "kirish")] };
  const outlineChapters = [{ id: "intro", title: "Kirish", role: "introduction", word_target: 100, sections: [] }];
  let attempts = 0;
  const retried = await retryDeficientTextSlots([chapter], outlineChapters, async slot => {
    assert.equal(slot.kind, "chapter");
    attempts++;
    assert.equal(slot.retryAttempt, attempts);
    return [countedParagraph(60, "qayta-kirish")];
  }, 1);

  assert.equal(attempts, 1);
  assert.equal(retried.validation.totalWords, 60);
  assert.equal(retried.validation.totalAccepted, true);
  assert.equal(retried.validation.accepted, true);
  assert.deepEqual(retried.skippedSlots, []);
});

test("boshqa bob 85% ga yetguncha qayta so'raladi", async () => {
  const chapter = { id: "analysis", title: "Tahlil", role: "analysis", word_target: 100, sections: [], content: [countedParagraph(70, "tahlil")] };
  const outlineChapters = [{ id: "analysis", title: "Tahlil", role: "analysis", word_target: 100, sections: [] }];
  let attempts = 0;
  const retried = await retryDeficientTextSlots([chapter], outlineChapters, async () => {
    attempts++;
    return [countedParagraph(attempts === 1 ? 84 : 85, "qayta-tahlil")];
  }, 1);

  assert.equal(attempts, 2);
  assert.equal(retried.validation.totalWords, 85);
  assert.equal(retried.validation.totalAccepted, true);
  assert.equal(retried.validation.accepted, true);
});

test("matn sloti so'rovi xato bersa hajm loopi API xatosini yashirmaydi", async () => {
  const fixture = sectionRetryFixture([70, 100]);
  await assert.rejects(
    retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async () => {
      throw new Error("API vaqtincha ishlamadi");
    }, 1),
    /API vaqtincha ishlamadi/,
  );
});

test("slot retry boshqa subsection mazmuni va media obyektlarini o'zgartirmaydi", async () => {
  const fixture = sectionRetryFixture([70, 100]);
  const retried = await retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async () => [countedParagraph(90, "almashtirilgan")], 1);
  const content = retried.chapters[0].content;

  assert.equal(content.includes(fixture.secondHeading), true);
  assert.equal(content.includes(fixture.secondParagraph), true);
  assert.equal(content.includes(fixture.media), true);
  assert.equal(content.includes(fixture.firstParagraph), false);
  assert.notEqual(retried.chapters[0], fixture.chapters[0]);
  assert.deepEqual(content.slice(content.indexOf(fixture.secondHeading)), [fixture.secondHeading, fixture.secondParagraph]);
});

test("oddiy subsectionlar ichida yetishmagan slot ham alohida 85% gacha qayta so'raladi", async () => {
  const fixture = sectionRetryFixture([70, 84]);
  const attempts = new Map();
  const retried = await retryDeficientTextSlots(fixture.chapters, fixture.outlineChapters, async slot => {
    const count = (attempts.get(slot.sectionId) || 0) + 1;
    attempts.set(slot.sectionId, count);
    return [countedParagraph(count === 1 ? 84 : 85, `yetarli-${slot.sectionId}`)];
  }, 1);

  assert.deepEqual(retried.skippedSlots, []);
  assert.deepEqual([...attempts.values()], [2, 2]);
  assert.equal(retried.validation.totalWords, 170);
  assert.equal(retried.validation.effectiveTotalWords, 170);
  assert.equal(retried.validation.effectiveTotalTarget, 200);
  assert.equal(retried.validation.totalAccepted, true);
  assert.equal(retried.validation.accepted, true);
});
