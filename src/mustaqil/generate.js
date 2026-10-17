// src/mustaqil/generate.js
// Generatsiya strategiyasi:
//   Pass 1: outline va barqaror media slotlarini rejalashtirish
//   Pass 2: prose-only boblar + alohida, bounded media-slot so'rovlari; ID bo'yicha birlashtirish
//   Pass 3: qisqa matnlarni parallel kengaytirish
//   Media: formula/chart/Graphviz render-verifikatsiyasi
//   Build: DOCX faqat verifikatsiyalangan diagrammalar bilan

const fs   = require("fs");
const path = require("path");
const sharp = require("sharp");
const {
  outlineSystemPrompt, outlineUserPrompt, parseOutline,
  chapterSystemPrompt, chapterUserPrompt, parseChapter,
  pagePlan, normalizeOutlineForPages,
  normalizeFormula, formulaSignature,
  normalizeChartPurpose,
  paragraphSimilarity,
  detectForbiddenIntroConclusion,
} = require("./prompt");
const { renderFormula } = require("./formula");
const { renderChart }   = require("./chart");
const { renderFlowchart } = require("./flowchart");
const { getFlowchartTemplate } = require("./flowchart-templates");
const { classifyGraphvizType } = require("./diagram-types");
const { buildDocument } = require("./builder");
const { renumberMedia } = require("./media-numbering");
const { countWords, chapterMainNumber, normalizeChapterContent, clampChapterContent } = require("./structure");
const { validatePlannedMedia } = require("./media-validation");
const { resolveDiagramQuotas, resolveFormulaQuota } = require("./media-requirements");
const { buildFlowchartCaption, normalizeFlowchartData, isUzbek, isRussian } = require("./flowchart-data");
const { normalizeChartData } = require("./chart-data");
const { normalizeFormulaSource } = require("./formula-data");
const { formulaKey } = require("./media-validation");
const { buildMediaSlots, groupMediaSlotsByChapter, mergeMediaSlotsIntoContent } = require("./media-slots");
const { postJsonWithRetry } = require("./llm-http");
const { cleanMediaText } = require("./media-captions");
const {
  validateBibliography,
  selectBestReferences,
  completeBibliography,
  buildBibliographyRepairPrompt,
} = require("./references");

const DEFAULT_LLM_CONCURRENCY = 3;
const SLOT_RETRY_LIMIT = 2;

function boundedConcurrency() {
  const requested = Number(process.env.SLIDEPRO_LLM_CONCURRENCY);
  return Number.isFinite(requested) && requested > 0
    ? Math.max(1, Math.min(DEFAULT_LLM_CONCURRENCY, Math.floor(requested)))
    : DEFAULT_LLM_CONCURRENCY;
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.min(list.length, DEFAULT_LLM_CONCURRENCY,
    Math.max(1, Math.floor(Number(limit) || DEFAULT_LLM_CONCURRENCY)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex++;
      results[index] = await worker(list[index], index);
    }
  }));
  return results;
}

function parseStructuredJson(text) {
  const clean = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Media javobida JSON obyekt topilmadi");
  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Media javobi JSON obyekt bo'lishi kerak");
  return parsed;
}

function mediaSlotPrompt(slot, { topic, language, sourceContent, chapter }) {
  const planText = JSON.stringify(slot.plan || {});
  const flowchartTemplate = getFlowchartTemplate(slot.diagram_type || slot.template_id || slot.plan?.diagram_type || slot.plan?.template_id);
  const source = sourceContent ? `\nMavzu va taxminlarni yo'naltirish uchun manba konteksti (qiymatlar bu manbada aynan keltirilgan bo'lishi shart emas):\n${String(sourceContent).slice(0, 1800)}` : "";
  const chapterContext = chapter?.title ? ` Bob: ${chapter.title}.${chapter.role ? ` Bob vazifasi: ${chapter.role}.` : ""}` : "";
  const common = `Mavzu: ${topic || "Mavzu"}.${chapterContext} Til: ${language || "o'zbek"}. Slot ID: ${slot.slot_id}. Reja: ${planText}.${source}\nFaqat bitta media obyektini tuz. Slot ID va type qiymatlarini aynan saqla; boshqa izoh yoki markdown bermagin. Sarlavha va caption media mazmunini tabiiy, qisqa ifodalasin; ularga meta-ma'lumot yoki status yorlig'i qo'shma.`;
  const schemas = {
    formula: `Aynan rejalashtirilgan LaTeX formulani qaytar, yangi formula to'qima. JSON: {"slot_id":"${slot.slot_id}","type":"formula","latex":"...","display_text":"...","caption":"..."}`,
    chart: slot.diagram_type === "mathematical_graph"
      ? `Matplotlib matematik grafik uchun JSON qaytar. 1–5 ta mavzuga mos aniq funksiyani yoz; rejadagi functions, x_min va x_max mavjud bo‘lsa ularni aynan saqla, mavzu/rejaga zid funksiya bilan almashtirma. Ifodada faqat x, pi, e, raqamlar, + - * / **, qavs va sin/cos/tan/asin/acos/atan/sinh/cosh/tanh/exp/log/log10/sqrt/abs funksiyalaridan foydalan. x_min < x_max bo‘lsin; render 501 namunaviy nuqtani hisoblab, silliq egri chiziq chizadi — y qiymatlarini qo‘lda sanab kiritma. Oraliq va ifoda mazmuniga mos, sarlavha/birlik/o‘qlarni aniq yoz. Haqiqiy manba promptda bo‘lmasa, manba uydirma qilma va data_source ni bo‘sh qoldir. JSON: {"slot_id":"${slot.slot_id}","type":"chart","diagram_type":"mathematical_graph","chartType":"line","title":"...","functions":[{"name":"f(x)","expression":"x**2"}],"x_min":-5,"x_max":5,"x_label":"x","y_label":"f(x)","unit":"","data_source":"","caption":"..."}`
      : slot.diagram_type === "experiment_results"
        ? `Matplotlib tajriba natijalari diagrammasi uchun JSON qaytar. chartType=${slot.chartType}; labels 2–8 ta tajriba sharti, vaqt nuqtasi yoki guruhni ifodalasin. 1–5 ta nomlangan series ber; har series.values massivida label sonicha finite son, yagona birlik va mavzuga mos diapazon bo‘lsin. Rejada labels/series/values berilgan bo‘lsa ularni aynan saqla; boshqa natija yoki aloqasiz guruh qo‘shma. Natijalar mavzu va reja maqsadiga bevosita bog‘liq bo‘lsin; grafikda o‘qlarning nomi va birliklarini aniq ko‘rsat. Haqiqiy manba promptda aniq berilmagan bo‘lsa, manba nomini to‘qima va data_source ni bo‘sh qoldir. JSON: {"slot_id":"${slot.slot_id}","type":"chart","diagram_type":"experiment_results","chartType":"${slot.chartType}","title":"...","labels":["...","..."],"series":[{"name":"Tajriba 1","values":[1,2]}],"x_label":"...","y_label":"...","unit":"","data_source":"","caption":"..."}`
        : `Faqat grafik ma'lumotini qaytar. chartType=${slot.chartType}. 2–8 qisqa label va ularga mos finite sonli values; pie uchun ko'pi bilan 5 label va manfiy bo'lmagan qiymatlar. Qiymatlar mavzu, reja va kontekstga mos hamda o'zaro izchil bo'lsin; mavzuga aloqasiz ma'lumot yoki manba uydirma qilma. Haqiqiy manba promptda berilmagan bo'lsa, data_source maydonini bo'sh qoldir. Sarlavha/captionda sintetik, AI yoki real emas kabi status yorliqlarini ishlatma. JSON: {"slot_id":"${slot.slot_id}","type":"chart","chartType":"${slot.chartType}","title":"...","labels":["..."],"values":[1,2],"unit":"","data_source":"","caption":"..."}`,
    flowchart: `Faqat Graphviz uchun JSON strukturani qaytar; DOT yoki kod qaytarma. Tanlangan va o‘zgarmas diagram_type: ${flowchartTemplate.id} — ${flowchartTemplate.name}. Grafik yo‘nalishi: ${flowchartTemplate.direction}. ${flowchartTemplate.topologyGuidance} Mavzu, bob va reja maqsadiga bevosita mos, mavzuga xos tugun va aloqalar tanla; generic to‘ldiruvchilar yoki boshqa diagramma turining elementlarini ishlatma. Faqat quyidagi kind qiymatlari mumkin: ${flowchartTemplate.allowedKinds.join(", ")}. Umumiy limit 2–5 node va 1–7 edge; algoritm 3–5 tugunli bo‘lib bitta start/end talab qiladi; PID uchun aynan 5 tugun va sensor→sum yopiq aloqa shart. Label 1–5 so‘z, ID xavfsiz, barcha node'lar bog‘langan bo‘lsin. Sarlavha va label mavzuga mos o‘zbekcha yoki inglizcha bo‘lsin; o‘zbekcha captionni "Izoh:" bilan qisqa yoz. JSON: {"slot_id":"${slot.slot_id}","type":"flowchart","diagram_type":"${flowchartTemplate.id}","title":"...","caption":"Izoh: ...","nodes":[{"id":"item1","label":"...","kind":"${flowchartTemplate.allowedKinds[0]}"},{"id":"item2","label":"...","kind":"${flowchartTemplate.allowedKinds[Math.min(1, flowchartTemplate.allowedKinds.length - 1)]}"}],"edges":[{"from":"item1","to":"item2","label":""}]}`,
    table: `Faqat bitta jadval ma'lumotini qaytar; kamida 3 ustun va 3–6 qator, barcha qatorlarda ustunlar soni teng bo'lsin. Haqiqiy manba yoki o'lchov bo'lishi shart emas: jadvalni mavzuga mos, iloji boricha realistik tafsilotlar va (kerak bo'lsa) ishonarli raqamlar bilan to'ldir. Raqamli qiymatlarning diapazoni, birliklari, aniqlik darajasi va qatorlar orasidagi munosabatlar o'zaro mantiqan izchil bo'lsin. Manba promptda aniq berilmagan bo'lsa, manba nomi yoki havolasini uydirma qilma. Sarlavha/captionda sintetik, AI yoki real emas kabi status yorliqlarini ishlatma; jadval mazmunini tabiiy ifodala. JSON: {"slot_id":"${slot.slot_id}","type":"table","title":"...","caption":"...","headers":["A","B","C"],"rows":[["...","...","..."],["...","...","..."],["...","...","..."]]}`,
  };
  return `${common}\n${schemas[slot.type] || "Noma'lum media turi."}`;
}

// в”Ђв”Ђ LLM chaqiruv (anthropic в†’ openai failover) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function callLLM({ system, user, llm, maxTokens = 6000 }) {
  const { provider, anthropicKey, anthropicModel, openaiKey, openaiModel } = llm;
  const order = provider === "openai" ? ["openai"]
    : provider === "anthropic" ? ["anthropic"] : ["anthropic","openai"];
  const avail = order.filter(p=>(p==="anthropic"&&anthropicKey)||(p==="openai"&&openaiKey));
  if (!avail.length) throw new Error("LLM kalit topilmadi.");
  const errs = [];
  for (const name of avail) {
    try {
      if (name === "anthropic") {
        const d = await postJsonWithRetry("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{"content-type":"application/json","x-api-key":anthropicKey,"anthropic-version":"2023-06-01"},
          body: JSON.stringify({ model:anthropicModel||"claude-sonnet-4-6", max_tokens:maxTokens,
            system, messages:[{role:"user",content:user}] }),
        }, "Anthropic");
        return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      } else {
        const d = await postJsonWithRetry("https://api.openai.com/v1/chat/completions",{
          method:"POST",
          headers:{"content-type":"application/json","authorization":"Bearer "+openaiKey},
          body: JSON.stringify({ model:openaiModel||"gpt-5-nano", max_completion_tokens:maxTokens,
            temperature:0.7, response_format:{type:"json_object"},
            messages:[{role:"system",content:system},{role:"user",content:user}] }),
        }, "OpenAI");
        return (d.choices?.[0]?.message?.content||"").trim();
      }
    } catch(e) { errs.push(name+": "+e.message); }
  }
  throw new Error(errs.join(" | "));
}

// Outline'dan KONSEPT darajasida ban-list qurish
// formula_plans: [{latex, concept}] вЂ” notation emas, MA'NO darajasida ban
// chart_plans:   [{title, variable}] вЂ” sarlavha emas, MA'LUMOT darajasida ban
function buildBanLists(outline, chapterIdx) {
  const formulas = [], charts = [];
  outline.chapters.forEach((c, j) => {
    if (j === chapterIdx) return;
    // Formula ban: "latex вЂ” concept" formatida в†’ LLM notationni o'zgartirib aldolmaydi
    if (Array.isArray(c.formula_plans)) {
      c.formula_plans.forEach(f => {
        const latex   = typeof f === "string" ? f : (f.latex || "");
        const concept = typeof f === "object" && f.concept ? ` (${f.concept})` : "";
        if (latex) formulas.push(latex + concept);
      });
    } else if (Array.isArray(c.formula_latex)) {
      c.formula_latex.forEach(f => f && formulas.push(f));
    }
    // Chart ban: "title вЂ” variable" formatida в†’ sarlavha o'zgartirib aldolmaydi
    if (Array.isArray(c.chart_plans)) {
      c.chart_plans.forEach(g => {
        const title    = typeof g === "string" ? g : (g.title || "");
        const variable = typeof g === "object" && g.variable ? ` [ma'lumot: ${g.variable}]` : "";
        if (title) charts.push(title + variable);
      });
    } else if (Array.isArray(c.chart_titles)) {
      c.chart_titles.forEach(t => t && charts.push(t));
    }
  });
  return {
    usedFormulas: [...new Set(formulas)],
    usedCharts:   [...new Set(charts)],
  };
}

// Media pre-render (formula + grafik parallel)
async function prerenderMedia(chapters, language = "o'zbek", initialCache = new Map()) {
  const tasks = [];
  const cache = new Map(initialCache instanceof Map ? initialCache : []);
  chapters.forEach((ch, chIdx) => {
    (ch.content || []).forEach(item => {
      // KESH KALITI: faqat raqam (renumberMedia butun hujjat bo'ylab
      // unikal raqam bergan вЂ” chIdx ga hojat yo'q).
      // MUHIM: builder.js ham "f_<number>" / "c_<number>" qidiradi вЂ”
      // kalitlar MOS bo'lishi shart, aks holda rasm hujjatga chiqmaydi.
      if (item.type === "formula") {
        const key = `f_${item.number}`;
        item._mediaKey = key;
        if (!cache.has(key)) tasks.push({
          key, kind: "formula", chapter: ch.title || ch.id, latex: item.latex || item.display_text || "",
          fn: () => renderFormula(item.latex || item.display_text || ""),
        });
      }
      if (item.type === "chart") {
        const key = `c_${item.number}`;
        item._mediaKey = key;
        if (!cache.has(key)) tasks.push({ key, kind: "chart", chapter: ch.title || ch.id, fn: () => renderChart({ ...item, title: cleanMediaText(item.title, "Grafik") }) });
      }
      if (item.type === "flowchart") {
        const key = `d_${item.number}`;
        item._mediaKey = key;
        if (!cache.has(key)) tasks.push({ key, kind: "flowchart", chapter: ch.title || ch.id, fn: () => renderFlowchart({ ...item, title: cleanMediaText(item.title, "Oqim sxemasi"), language }) });
      }
    });
  });
  if (!tasks.length) return cache;
  const res = await mapWithConcurrency(tasks, boundedConcurrency(), async task => {
    try { return { status: "fulfilled", value: await task.fn() }; }
    catch (reason) { return { status: "rejected", reason }; }
  });
  const failedMedia = [];
  tasks.forEach((t, i) => {
    const value = res[i].status === "fulfilled" ? res[i].value : null;
    const validImage = value && Buffer.isBuffer(value.buf) && value.buf.length > 0
      && Number.isFinite(value.width) && value.width > 0
      && Number.isFinite(value.height) && value.height > 0;
    if (validImage) cache.set(t.key, value);
    else {
      const reason = res[i].status === "rejected" ? res[i].reason?.message : "render bo'sh yoki rasm yaroqsiz";
      const detail = t.kind === "formula" ? `: ${String(t.latex).slice(0, 70)}` : "";
      failedMedia.push(`${t.kind} ${t.chapter}${detail} (${reason})`);
    }
  });
  console.log("[mustaqil] render:", cache.size + "/" + tasks.length);
  if (failedMedia.length) {
    console.warn(`[mustaqil] ${failedMedia.length} ta media rasmi chizilmadi; builder mavjud fallback bilan hujjatni davom ettiradi: ${failedMedia.join(" | ")}`);
  }
  return cache;
}

function validChartData(chart, chartType) {
  try {
    return normalizeChartData({ ...chart, chartType }).chartType === chartType;
  } catch {
    return false;
  }
}

function syntheticChartValues(count, seedText) {
  const seed = [...String(seedText || "")].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: count }, (_, index) => 28 + ((seed + index * 17) % 63));
}

function defaultChartLabels() {
  return ["1-bosqich", "2-bosqich", "3-bosqich", "4-bosqich", "5-bosqich"];
}

function fallbackFlowchartLabels(plan, chapter) {
  const stopWords = new Set(["va", "yoki", "uchun", "bo'yicha", "bo‘yicha", "bilan", "ning", "dan", "asosiy", "tarkibiy", "unsur", "element", "jarayon", "bosqich", "bosqichlari", "ketma-ketligi", "aloqa", "aloqalar", "o'zaro", "sodda", "ixcham", "ko'rsatish", "ko'rsatadi"]);
  const chunks = [plan?.title, plan?.purpose, chapter?.title]
    .filter(value => typeof value === "string" && value.trim())
    .flatMap(value => value.split(/[:;,.!?—–]+/u));
  const candidates = [];
  const seen = new Set();
  const add = phrase => {
    const label = phrase.replace(/\s+/g, " ").trim();
    const key = label.toLocaleLowerCase();
    if (label && label.length <= 64 && !seen.has(key)) {
      seen.add(key);
      candidates.push(label);
    }
  };
  const tokenGroups = chunks.map(chunk => (chunk.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [])
    .filter(token => token.length > 2 && !stopWords.has(token.toLocaleLowerCase())));
  for (const tokens of tokenGroups) {
    if (tokens.length >= 2 && tokens.length <= 4) add(tokens.join(" "));
    for (const width of [3, 2]) {
      for (let start = 0; start + width <= tokens.length; start++) add(tokens.slice(start, start + width).join(" "));
    }
  }
  const allTokens = [...new Set(tokenGroups.flat().map(token => token.toLocaleLowerCase()))];
  for (let start = 0; start + 1 < allTokens.length && candidates.length < 12; start++) {
    add(allTokens.slice(start, Math.min(start + 3, allTokens.length)).join(" "));
  }
  const subjectTerm = allTokens[0] || String(chapter?.title || plan?.title || "Mavzu").split(/\s+/)[0];
  const contextualDescriptors = ["tarkibi", "asosiy xususiyati", "amaliy qo'llanishi", "ta'siri", "kutiladigan natijasi"];
  for (const descriptor of contextualDescriptors) {
    if (candidates.length >= 5) break;
    add(`${subjectTerm} ${descriptor}`);
  }
  return candidates.slice(0, 5);
}

function fallbackFlowchart(plan, chapter, language, index) {
  const subject = chapter?.title || plan?.title || "Mavzu";
  const title = cleanMediaText(plan?.title || `${subject}: asosiy tushunchalar va aloqalar${index ? ` (${index + 1})` : ""}`, `${subject}: asosiy tushunchalar va aloqalar`).slice(0, 120);
  const defaultPurpose = isUzbek(language)
    ? `${subject} mavzusidagi asosiy tushunchalar va ularning mazmuniy aloqalari`
    : isRussian(language)
      ? `Основные понятия и содержательные связи по теме «${subject}»`
      : `Key concepts and topic-specific relationships for ${subject}`;
  const labels = fallbackFlowchartLabels(plan, chapter);
  const diagramType = plan?.diagram_type || plan?.template_id || classifyGraphvizType({
    topic: subject,
    chapterTitle: chapter?.title,
    planTitle: plan?.title,
    purpose: plan?.purpose,
  });
  const uniqueLabels = [...new Set(labels.map(label => label.trim()).filter(Boolean))].slice(0, 5);
  if (uniqueLabels.length < 2) {
    for (const candidate of [String(plan?.purpose || "").trim(), String(chapter?.title || "").trim(), String(plan?.title || "").trim()]) {
      if (candidate && !uniqueLabels.some(label => label.toLocaleLowerCase() === candidate.toLocaleLowerCase())) uniqueLabels.push(candidate.split(/\s+/).slice(0, 5).join(" "));
      if (uniqueLabels.length >= 2) break;
    }
  }
  const actionLabel = uniqueLabels.find(label => !/^(boshlash|yakunlash|start|end)$/i.test(label)) || String(plan?.title || subject).split(/\s+/).slice(0, 5).join(" ");
  let nodes;
  let edges;
  if (diagramType === "algorithm_flowchart") {
    const hasDecision = /tekshir|qaror|shart|mezon|threshold|if\b|condition/i.test(`${plan?.title || ""} ${plan?.purpose || ""}`);
    if (hasDecision && uniqueLabels.length >= 2) {
      nodes = [
        { id: "start", label: "Boshlash", kind: "start" },
        { id: "action", label: actionLabel, kind: "process" },
        { id: "decision", label: uniqueLabels.find(label => /tekshir|qaror|shart|mezon/i.test(label)) || "Shartni tekshirish", kind: "decision" },
        { id: "result", label: uniqueLabels.find(label => label !== actionLabel) || actionLabel, kind: "process" },
        { id: "end", label: "Yakunlash", kind: "end" },
      ];
      edges = [
        { from: "start", to: "action", label: "" },
        { from: "action", to: "decision", label: "" },
        { from: "decision", to: "result", label: "Ha" },
        { from: "decision", to: "end", label: "Yo‘q" },
        { from: "result", to: "end", label: "" },
      ];
    } else {
      nodes = [
        { id: "start", label: "Boshlash", kind: "start" },
        { id: "action", label: actionLabel, kind: "process" },
        { id: "end", label: "Yakunlash", kind: "end" },
      ];
      edges = [{ from: "start", to: "action", label: "" }, { from: "action", to: "end", label: "" }];
    }
  } else if (diagramType === "pid_control_system") {
    nodes = [
      { id: "reference", label: "Topshiriq signali", kind: "input" },
      { id: "sum", label: "Σ", kind: "sum" },
      { id: "pid", label: "PID rostlagich", kind: "controller" },
      { id: "plant", label: "Boshqaruv obyekti", kind: "plant" },
      { id: "sensor", label: "O‘lchov datchigi", kind: "sensor" },
    ];
    edges = [
      { from: "reference", to: "sum", label: "" },
      { from: "sum", to: "pid", label: "xatolik" },
      { from: "pid", to: "plant", label: "boshqaruv signali" },
      { from: "plant", to: "sensor", label: "chiqish" },
      { from: "sensor", to: "sum", label: "teskari aloqa" },
    ];
  } else if (diagramType === "functional_block_diagram") {
    const topicContext = `${plan?.title || ""} ${plan?.purpose || ""} ${chapter?.title || ""}`;
    if (/sabab\s*[-–]?\s*oqibat|cause\s*[-–]?\s*effect|fishbone|asosiy\s+muammo/i.test(topicContext)) {
      const explicitCauses = Array.isArray(plan?.causes) ? plan.causes : Array.isArray(plan?.factors) ? plan.factors : [];
      const causeLabels = (explicitCauses.length ? explicitCauses : uniqueLabels)
        .map(label => String(label || "").trim())
        .filter(label => label && !/sabab\s*[-–]?\s*oqibat|cause\s*[-–]?\s*effect|fishbone|tahlil|muammo|oqibat|natija/i.test(label))
        .slice(0, 4);
      if (!causeLabels.length) causeLabels.push(String(plan?.purpose || chapter?.title || subject).split(/[,;:]/)[0].trim().slice(0, 48) || "Mavzu omili");
      const effectText = `${plan?.outcome || ""} ${plan?.effect || ""} ${plan?.title || ""} ${plan?.purpose || ""}`;
      const effectLabel = String(plan?.outcome || plan?.effect || /asosiy\s+muammo|muammo|oqibat|natija/i.exec(effectText)?.[0] || "Asosiy natija")
        .split(/\s+/).slice(0, 5).join(" ");
      nodes = [
        ...causeLabels.map((label, nodeIndex) => ({ id: `cause${nodeIndex + 1}`, label, kind: "input" })),
        { id: "effect", label: effectLabel, kind: "output" },
      ].slice(0, 5);
      edges = nodes.filter(node => node.id !== "effect").map(node => ({ from: node.id, to: "effect", label: "" }));
    } else {
      nodes = uniqueLabels.slice(0, 5).map((label, nodeIndex, all) => ({
        id: `item${nodeIndex + 1}`,
        label,
        kind: nodeIndex === 0 ? "input" : nodeIndex === all.length - 1 ? "output" : "process",
      }));
      edges = nodes.slice(0, -1).map((node, nodeIndex) => ({ from: node.id, to: nodes[nodeIndex + 1].id, label: "" }));
    }
  } else {
    const hierarchicalUml = diagramType === "uml_software_architecture" && /ierarx|hierarch|daraxt|tree/i.test(`${plan?.title || ""} ${plan?.purpose || ""}`);
    const nodeLabels = uniqueLabels.slice(0, 5);
    nodes = nodeLabels.map((label, nodeIndex) => ({
      id: `item${nodeIndex + 1}`,
      label,
      kind: diagramType === "uml_software_architecture" ? "component" : "step",
    }));
    edges = hierarchicalUml
      ? nodes.slice(1).map(node => ({ from: nodes[0].id, to: node.id, label: "contains" }))
      : nodes.slice(0, -1).map((node, nodeIndex) => ({ from: node.id, to: nodes[nodeIndex + 1].id, label: "" }));
  }
  const flowchart = {
    type: "flowchart",
    diagram_type: diagramType,
    template_id: diagramType,
    title,
    nodes,
    edges,
  };
  flowchart.caption = cleanMediaText(buildFlowchartCaption(flowchart, plan?.purpose || defaultPurpose, language), title);
  return flowchart;
}

function alignPlannedChartBlocks(chapter, content) {
  const items = Array.isArray(content) ? content : [];
  const plans = Array.isArray(chapter.chart_plans) ? chapter.chart_plans : [];
  const count = Math.max(0, Math.floor(Number(chapter.chart_count) || 0), plans.length);
  const candidates = items.filter(item => item?.type === "chart");
  const usedCandidates = new Set();
  const charts = Array.from({ length: count }, (_, index) => {
    const plan = plans[index] || {};
    const planWords = [plan.title, plan.variable].filter(Boolean).join(" ").toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 3);
    const preferredType = String(chapter.chart_type || plan.chartType || candidates[0]?.chartType || candidates[0]?.chart_type || "bar").toLowerCase();
    let chartType = preferredType;
    if (!["bar", "line", "pie"].includes(chartType)) chartType = "bar";
    const candidate = candidates.map((item, candidateIndex) => {
      const text = [item.title, item.caption, item.data_source].filter(Boolean).join(" ").toLocaleLowerCase();
      return {
        item,
        candidateIndex,
        score: planWords.reduce((sum, word) => sum + Number(text.includes(word)), 0),
        valid: validChartData(item, chartType),
      };
    }).filter(entry => !usedCandidates.has(entry.item))
      .sort((left, right) => Number(right.valid) - Number(left.valid) || right.score - left.score || left.candidateIndex - right.candidateIndex)[0]?.item || {};
    if (candidates.includes(candidate)) usedCandidates.add(candidate);
    const planChart = { ...plan, ...("chartType" in plan ? { chartType: plan.chartType } : {}) };
    const candidateChart = { ...candidate, chartType };
    const selected = validChartData(planChart, chartType) ? planChart
      : validChartData(candidateChart, chartType) ? candidateChart : null;
    const maxLabels = chartType === "pie" ? 5 : 8;
    let labels = selected?.labels;
    let values = selected?.values;
    let synthetic = false;
    if (!selected) {
      const proposedLabels = Array.isArray(plan.labels) ? plan.labels : Array.isArray(candidate.labels) ? candidate.labels : [];
      labels = proposedLabels.map(value => String(value || "").trim()).filter(Boolean).slice(0, maxLabels);
      if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) labels = [];
      if (labels.length < 2) labels = defaultChartLabels().slice(0, maxLabels);
      values = syntheticChartValues(labels.length, plan.title || candidate.title || chapter.title);
      synthetic = true;
    }
    const title = cleanMediaText(plan.title || candidate.title || `${chapter.title || "Mavzu"}: asosiy ko'rsatkichlar`, `${chapter.title || "Mavzu"}: asosiy ko'rsatkichlar`);
    return {
      ...candidate,
      type: "chart",
      chartType,
      title,
      caption: cleanMediaText(plan.caption || plan.title || candidate.caption || title, title),
      labels,
      values,
      unit: String(plan.unit || candidate.unit || ""),
      data_source: synthetic
        ? "Sintetik illustrativ ma'lumot; real o'lchov emas"
        : String(plan.data_source || candidate.data_source || candidate.source || "Sintetik illustrativ ma'lumot; real o'lchov emas"),
    };
  });
  let chartIndex = 0;
  const aligned = items.flatMap(item => {
    if (item?.type !== "chart") return [item];
    return chartIndex < charts.length ? [charts[chartIndex++]] : [];
  });
  while (chartIndex < charts.length) aligned.push(charts[chartIndex++]);
  return aligned;
}

function alignPlannedFormulaBlocks(chapter, content) {
  const items = Array.isArray(content) ? content : [];
  const plans = Array.isArray(chapter.formula_plans) ? chapter.formula_plans : [];
  let planIndex = 0;
  const aligned = items.flatMap(item => {
    if (item?.type !== "formula") return [item];
    const plan = plans[planIndex++];
    if (!plan) return [];
    const latex = typeof plan === "string" ? plan : String(plan.latex || "").trim();
    if (!latex) return [];
    return [{
      ...item,
      latex,
      display_text: typeof plan === "object" && plan.display_text ? plan.display_text : latex,
      caption: (typeof plan === "object" && (plan.caption || plan.concept)) || item.caption || "",
    }];
  });
  while (planIndex < plans.length) {
    const plan = plans[planIndex++];
    const latex = typeof plan === "string" ? plan : String(plan?.latex || "").trim();
    if (!latex) continue;
    aligned.push({
      type: "formula",
      latex,
      display_text: typeof plan === "object" && plan.display_text ? plan.display_text : latex,
      caption: (typeof plan === "object" && (plan.caption || plan.concept)) || "",
    });
  }
  return aligned;
}

function alignPlannedFlowchartBlocks(chapter, content, language = "o'zbek") {
  const items = Array.isArray(content) ? content : [];
  const plans = Array.isArray(chapter.flowchart_plans) ? chapter.flowchart_plans : [];
  const count = Math.max(0, Math.floor(Number(chapter.flowchart_count) || 0), plans.length);
  const candidates = items.filter(item => item?.type === "flowchart");
  const flowcharts = Array.from({ length: count }, (_, index) => {
    const plan = plans[index] || {};
    let flowchart = candidates[index];
    const diagramType = plan.diagram_type || plan.template_id || flowchart?.diagram_type || flowchart?.template_id || classifyGraphvizType({
      topic: chapter.title,
      chapterTitle: chapter.title,
      planTitle: plan.title,
      purpose: plan.purpose,
    });
    try {
      flowchart = { ...flowchart, ...normalizeFlowchartData({ ...(flowchart || {}), diagram_type: diagramType }, { language, diagramType }) };
    } catch {
      flowchart = fallbackFlowchart({ ...plan, diagram_type: diagramType }, chapter, language, index);
    }
    flowchart.title = cleanMediaText(flowchart.title || plan.title || "Oqim sxemasi", "Oqim sxemasi").slice(0, 180);
    flowchart.diagram_type = diagramType;
    flowchart.template_id = diagramType;
    // Yorliq tili Graphviz renderiga ta'sir qilmaydi; captionda qisqa o'zbekcha izoh qoladi.
    flowchart.caption = cleanMediaText(buildFlowchartCaption(flowchart, plan.purpose, language), flowchart.title);
    return flowchart;
  });
  let flowchartIndex = 0;
  const aligned = items.flatMap(item => {
    if (item?.type !== "flowchart") return [item];
    return flowchartIndex < flowcharts.length ? [flowcharts[flowchartIndex++]] : [];
  });
  while (flowchartIndex < flowcharts.length) aligned.push(flowcharts[flowchartIndex++]);
  return aligned;
}

function normalizeMediaSlotResult(slot, response, { chapter, language }) {
  const plan = slot.plan || {};
  if (response.slot_id !== slot.slot_id) throw new Error(`slot_id mos emas (${response.slot_id || "bo'sh"})`);
  if (response.type !== slot.type) throw new Error(`media turi mos emas (${response.type || "bo'sh"})`);

  if (slot.type === "formula") {
    const plannedLatex = typeof plan === "string" ? plan : String(plan.latex || chapter?.formula_latex?.[slot.ordinal - 1] || "").trim();
    const responseLatex = normalizeFormulaSource(response.latex || plannedLatex);
    if (!plannedLatex || formulaKey(responseLatex) !== formulaKey(plannedLatex)) {
      throw new Error("formula rejalashtirilgan LaTeX bilan mos emas");
    }
    return {
      type: "formula", slot_id: slot.slot_id, latex: normalizeFormulaSource(plannedLatex),
      display_text: String(response.display_text || plan.display_text || plannedLatex),
      caption: String(response.caption || plan.caption || plan.concept || "Rejalashtirilgan formula"),
    };
  }

  if (slot.type === "chart") {
    const diagramType = slot.diagram_type || plan.diagram_type;
    const chartType = diagramType === "mathematical_graph" ? "line"
      : diagramType === "experiment_results" && !["bar", "line"].includes(slot.chartType) ? "bar"
        : slot.chartType;
    if (!["bar", "line", "pie"].includes(chartType)) throw new Error(`noma'lum chartType (${chartType})`);
    const candidate = { ...plan, ...response, type: "chart", chartType, ...(diagramType ? { diagram_type: diagramType } : {}) };
    candidate.title = cleanMediaText(plan.title || response.title || `${chapter?.title || "Mavzu"}: asosiy ko'rsatkichlar`, `${chapter?.title || "Mavzu"}: asosiy ko'rsatkichlar`);
    const source = String(response.data_source || response.source || plan.data_source || "").trim();
    candidate.data_source = source || "Sintetik illustrativ ma'lumot; real o'lchov emas";
    candidate.caption = cleanMediaText(response.caption || plan.caption || candidate.title, candidate.title);
    return { ...candidate, ...normalizeChartData(candidate), slot_id: slot.slot_id };
  }

  if (slot.type === "flowchart") {
    const diagramType = slot.diagram_type || plan.diagram_type || slot.template_id || plan.template_id || "functional_block_diagram";
    const normalized = normalizeFlowchartData({
      ...response,
      type: "flowchart",
      diagram_type: diagramType,
      title: cleanMediaText(plan.title || response.title || "Oqim sxemasi", "Oqim sxemasi"),
    }, { language, diagramType });
    return {
      type: "flowchart",
      ...normalized,
      diagram_type: diagramType,
      template_id: diagramType,
      slot_id: slot.slot_id,
      caption: cleanMediaText(buildFlowchartCaption({ ...normalized, caption: response.caption }, plan.purpose, language), normalized.title),
    };
  }

  if (slot.type === "table") {
    const headers = Array.isArray(response.headers) ? response.headers.map(value => String(value || "").trim()) : [];
    const rows = Array.isArray(response.rows) ? response.rows.map(row => Array.isArray(row) ? row.map(value => String(value ?? "")) : row) : [];
    if (headers.length < 3 || rows.length < 3 || rows.length > 6 || rows.some(row => !Array.isArray(row) || row.length !== headers.length)) {
      throw new Error("jadval kamida 3 ustun va mos 3–6 qator bo'lishi kerak");
    }
    const title = cleanMediaText(plan.title || response.title || `${chapter?.title || "Mavzu"}: taqqoslash jadvali`, `${chapter?.title || "Mavzu"}: taqqoslash jadvali`);
    const caption = cleanMediaText(response.caption || plan.caption || title, title);
    return { type: "table", slot_id: slot.slot_id, title, caption, headers, rows, data_source: response.data_source || "Sintetik illustrativ ma'lumot; real o'lchov emas", synthetic: true };
  }
  throw new Error(`Noma'lum media turi: ${slot.type}`);
}

function fallbackMediaSlot(slot, { chapter, language }) {
  const plan = slot.plan || {};
  if (slot.type === "formula") {
    const latex = normalizeFormulaSource(typeof plan === "string" ? plan : plan.latex || chapter?.formula_latex?.[slot.ordinal - 1]);
    return {
      type: "formula", slot_id: slot.slot_id, latex,
      display_text: String(plan.display_text || latex),
      caption: String(plan.caption || plan.concept || "Rejalashtirilgan formula"),
      _syntheticFallback: true,
    };
  }
  if (slot.type === "chart") {
    if (slot.diagram_type === "mathematical_graph") {
      const planText = `${plan.title || ""} ${plan.variable || ""} ${chapter?.title || ""}`.toLocaleLowerCase();
      const inferredExpression = /\b(?:sin|sinus|sine)\b/.test(planText) ? "sin(x)"
        : /\b(?:cos|cosinus|cosine)\b/.test(planText) ? "cos(x)"
          : /\b(?:exp|eksponent|exponential)\b/.test(planText) ? "exp(x)"
            : /\b(?:sqrt|ildiz|root)\b/.test(planText) ? "sqrt(x)"
              : /\b(?:parabola|kvadrat|quadratic|square)\b/.test(planText) ? "x**2" : "x";
      const functions = Array.isArray(plan.functions) && plan.functions.length
        ? plan.functions
        : [{ name: plan.function_name || "f(x)", expression: plan.expression || inferredExpression }];
      const chart = normalizeChartData({
        ...plan,
        type: "chart",
        diagram_type: "mathematical_graph",
        chartType: "line",
        title: cleanMediaText(plan.title || `${chapter?.title || "Mavzu"}: matematik funksiya`, "Matematik grafik"),
        functions,
        x_min: Number.isFinite(Number(plan.x_min)) ? Number(plan.x_min) : -5,
        x_max: Number.isFinite(Number(plan.x_max)) ? Number(plan.x_max) : 5,
        x_label: plan.x_label || "x",
        y_label: plan.y_label || plan.unit || "f(x)",
        data_source: plan.data_source || "Matematik funksiya grafigi",
        caption: cleanMediaText(plan.caption || plan.title || chapter?.title, chapter?.title || "Matematik grafik"),
      });
      return { ...chart, slot_id: slot.slot_id, _syntheticFallback: true };
    }
    if (slot.diagram_type === "experiment_results") {
      const proposedLabels = Array.isArray(plan.labels) ? plan.labels.map(value => String(value || "").trim()).filter(Boolean).slice(0, 8) : [];
      const labels = proposedLabels.length >= 2 ? proposedLabels : ["1-sinov", "2-sinov", "3-sinov"];
      const proposedSeries = Array.isArray(plan.series) ? plan.series : [];
      const series = proposedSeries.length
        ? proposedSeries.slice(0, 5)
        : [{ name: plan.variable || "Sinov natijasi", values: syntheticChartValues(labels.length, plan.title || chapter?.title || "tajriba") }];
      const chartType = ["bar", "line"].includes(slot.chartType) ? slot.chartType : "bar";
      const chart = normalizeChartData({
        ...plan,
        type: "chart",
        diagram_type: "experiment_results",
        chartType,
        title: cleanMediaText(plan.title || `${chapter?.title || "Mavzu"}: tajriba natijalari`, "Tajriba natijalari"),
        labels,
        series,
        unit: plan.unit || "",
        data_source: plan.data_source || "Sintetik illustrativ ma'lumot; real o'lchov emas",
        caption: cleanMediaText(plan.caption || plan.title || chapter?.title, chapter?.title || "Tajriba natijalari"),
      });
      return { ...chart, slot_id: slot.slot_id, _syntheticFallback: true };
    }
    const [chart] = alignPlannedChartBlocks({
      ...chapter,
      chart_count: 1,
      chart_type: slot.chartType,
      chart_plans: [typeof plan === "object" && plan ? plan : {}],
    }, []).filter(item => item.type === "chart");
    return { ...chart, slot_id: slot.slot_id, caption: cleanMediaText(chart.caption || chart.title, chart.title), _syntheticFallback: true };
  }
  if (slot.type === "flowchart") {
    return { ...fallbackFlowchart(plan, chapter, language, slot.ordinal - 1), slot_id: slot.slot_id, _syntheticFallback: true };
  }
  if (slot.type === "table") {
    const title = cleanMediaText(plan.title || `${chapter?.title || "Mavzu"}: taqqoslash jadvali`, `${chapter?.title || "Mavzu"}: taqqoslash jadvali`);
    return {
      type: "table", slot_id: slot.slot_id, title,
      caption: title,
      headers: ["Bosqich", "Asosiy amal", "Kutiladigan natija"],
      rows: [
        ["1-bosqich", `${chapter?.title || "Mavzu"} bo'yicha boshlang'ich holatni aniqlash`, "Tahlil mezonlari belgilanadi"],
        ["2-bosqich", "Tanlangan yondashuvni asosiy mezonlar bo'yicha qo'llash", "Taqqoslanadigan natijalar olinadi"],
        ["3-bosqich", "Natijalarni belgilangan mezonlar bilan baholash", "Takomillashtirish yo'nalishi aniqlanadi"],
      ],
      data_source: "Sintetik illustrativ ma'lumot; real o'lchov emas",
      _syntheticFallback: true,
    };
  }
  throw new Error(`Noma'lum media fallback turi: ${slot.type}`);
}

async function renderAndVerifyMedia(item, language) {
  let image = null;
  if (item.type === "formula") image = await renderFormula(item.latex || item.display_text || "");
  else if (item.type === "chart") image = await renderChart({ ...item, title: cleanMediaText(item.title, "Grafik") });
  else if (item.type === "flowchart") image = await renderFlowchart({ ...item, title: cleanMediaText(item.title, "Oqim sxemasi"), caption: cleanMediaText(item.caption), language });
  else return null;
  if (!image || !Buffer.isBuffer(image.buf) || !image.buf.length) throw new Error("render bo'sh yoki rasm yaroqsiz");
  const metadata = await sharp(image.buf).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    throw new Error("render natijasi yaroqli PNG emas");
  }
  return image;
}

async function generateMediaSlot(slot, { chapter, topic, language, sourceContent, llm }) {
  const maxTokens = slot.type === "flowchart" ? 1800 : slot.type === "chart" || slot.type === "table" ? 1000 : 500;
  const maxAttempts = slot.type === "chart" || slot.type === "table" ? 1 : SLOT_RETRY_LIMIT;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const text = await callLLM({
        system: "Sen bitta akademik media slotining strukturalangan ma'lumotini tayyorlaysan. Javob faqat yaroqli JSON bo'lsin.",
        user: mediaSlotPrompt(slot, { topic, language, sourceContent, chapter }),
        llm,
        maxTokens,
      });
      const response = parseStructuredJson(text);
      const item = normalizeMediaSlotResult(slot, response, { chapter, language });
      const image = await renderAndVerifyMedia(item, language);
      return { slot, item, image, fallback: false };
    } catch (error) {
      lastError = error;
      console.warn(`[mustaqil] media slot ${slot.slot_id} urinish ${attempt}/${maxAttempts} xato: ${error.message}`);
    }
  }

  const item = fallbackMediaSlot(slot, { chapter, language });
  try {
    const image = await renderAndVerifyMedia(item, language);
    console.warn(`[mustaqil] media slot ${slot.slot_id} sintetik/reja fallback bilan to'ldirildi (${lastError?.message || "xato"})`);
    return { slot, item, image, fallback: true };
  } catch (error) {
    console.warn(`[mustaqil] media slot ${slot.slot_id} fallback rasmi ham yaroqsiz — DOCX’da tasvir o‘rniga xavfsiz matnli fallback ishlatiladi (${error.message})`);
    return { slot, item, image: null, fallback: true, renderError: error };
  }
}

function buildVerifiedImageCache(chapters, mediaResults) {
  const cache = new Map();
  const keyPrefix = { formula: "f", chart: "c", flowchart: "d" };
  for (const chapter of chapters || []) {
    for (const item of chapter.content || []) {
      const prefix = keyPrefix[item?.type];
      if (!prefix || !item.slot_id || !Number.isFinite(Number(item.number))) continue;
      const result = mediaResults.get(item.slot_id);
      if (result?.image) cache.set(`${prefix}_${item.number}`, result.image);
    }
  }
  return cache;
}

const WORD_ACCEPTANCE_RATIO = 0.85;
const WORD_MAX_ACCEPTANCE_RATIO = 1.15;
const INTRO_CONCLUSION_WORD_ACCEPTANCE_RATIO = 0.60;
const RETRY_WORD_BUFFER_RATIO = 1.1;

function isIntroConclusionSlot(slot) {
  const role = String(slot?.chapterRole || "").trim().toLowerCase();
  const id = String(slot?.chapterId || "").trim().toLowerCase();
  const title = String(slot?.chapterTitle || "").trim().toLowerCase();
  return ["introduction", "conclusion"].includes(role)
    || ["intro", "conclusion"].includes(id)
    || /^(kirish|xulosa)$/.test(title);
}

function minimumWordAcceptanceRatio(slot, minimumRatio = WORD_ACCEPTANCE_RATIO) {
  return isIntroConclusionSlot(slot)
    ? Math.min(minimumRatio, INTRO_CONCLUSION_WORD_ACCEPTANCE_RATIO)
    : minimumRatio;
}

function wordRangeDescription(slot, minimumRatio = WORD_ACCEPTANCE_RATIO, maximumRatio = WORD_MAX_ACCEPTANCE_RATIO) {
  const minimum = Math.ceil(slot.target * minimumWordAcceptanceRatio(slot, minimumRatio) - 1e-9);
  const maximum = Math.floor(slot.target * maximumRatio + 1e-9);
  return `${slot.title} (${slot.actual}/${slot.target}; talab ${minimum}–${maximum} so'z)`;
}

function sectionContentGroups(chapter, content, mainNumber) {
  const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
  if (!sections.length) return [];
  let items = Array.isArray(content) ? content : [];
  const headingCount = items.filter(item => item?.type === "heading" && item.level === 2).length;
  if (headingCount !== sections.length) {
    items = normalizeChapterContent(chapter, items, mainNumber);
  }
  const groups = sections.map(() => []);
  let sectionIndex = -1;
  for (const item of items) {
    if (item?.type === "heading" && item.level === 2) {
      sectionIndex++;
      if (sectionIndex < groups.length) groups[sectionIndex].push(item);
    } else if (sectionIndex >= 0 && sectionIndex < groups.length) {
      groups[sectionIndex].push(item);
    }
  }
  return groups;
}

function getTextWordSlots(chapters, outlineChapters) {
  const slots = [];
  (Array.isArray(chapters) ? chapters : []).forEach((chapter, chapterIndex) => {
    const planned = outlineChapters?.[chapterIndex] || chapter || {};
    const sections = Array.isArray(planned.sections) ? planned.sections : [];
    if (sections.length) {
      const groups = sectionContentGroups(chapter, chapter?.content, chapterMainNumber(outlineChapters || chapters, chapterIndex));
      sections.forEach((section, sectionIndex) => {
        const content = groups[sectionIndex] || [];
        slots.push({
          kind: "section",
          chapterIndex,
          sectionIndex,
          chapterRole: planned.role || chapter?.role || "",
          chapterId: planned.id || chapter?.id || "",
          chapterTitle: planned.title || chapter?.title || "",
          sectionId: section.id || `${planned.id || `chapter-${chapterIndex + 1}`}_${sectionIndex + 1}`,
          title: section.title || `Bo'lim ${sectionIndex + 1}`,
          target: Number(section.word_target) || 0,
          actual: countWords(content),
          currentText: content.filter(item => item?.type === "paragraph").map(item => String(item.text || "")).join("\n\n"),
        });
      });
      return;
    }

    const target = Number(planned.word_target) || 0;
    if (target > 0) {
      slots.push({
        kind: "chapter",
        chapterIndex,
        sectionIndex: null,
        chapterRole: planned.role || chapter?.role || "",
        chapterId: planned.id || chapter?.id || "",
        chapterTitle: planned.title || chapter?.title || "",
        sectionId: planned.id || `chapter-${chapterIndex + 1}`,
        title: planned.title || chapter?.title || `Qism ${chapterIndex + 1}`,
        target,
        actual: countWords(chapter?.content),
        currentText: (chapter?.content || []).filter(item => item?.type === "paragraph").map(item => String(item.text || "")).join("\n\n"),
      });
    }
  });
  return slots;
}

function textWordSlotKey(slot) {
  return `${slot.kind}:${slot.chapterIndex}:${slot.sectionIndex == null ? "" : slot.sectionIndex}:${slot.sectionId}`;
}

function evaluateWordTargets(chapters, outlineChapters, totalTarget, minimumRatio = WORD_ACCEPTANCE_RATIO, skippedSlots = [], maximumRatio = WORD_MAX_ACCEPTANCE_RATIO) {
  const totalWords = (chapters || []).reduce((sum, chapter) => sum + countWords(chapter?.content), 0);
  const plannedTotal = Number(totalTarget) || (outlineChapters || []).reduce((sum, chapter) => sum + (Number(chapter?.word_target) || 0), 0);
  const allSlots = getTextWordSlots(chapters, outlineChapters);
  const skippedKeys = new Set((Array.isArray(skippedSlots) ? skippedSlots : []).map(slot => typeof slot === "string" ? slot : textWordSlotKey(slot)));
  const excludedSlots = allSlots.filter(slot => skippedKeys.has(textWordSlotKey(slot)));
  const excludedWords = excludedSlots.reduce((sum, slot) => sum + slot.actual, 0);
  const excludedTarget = excludedSlots.reduce((sum, slot) => sum + slot.target, 0);
  const effectiveTotalWords = Math.max(0, totalWords - excludedWords);
  const effectiveTotalTarget = Math.max(0, plannedTotal - excludedTarget);
  const toleratedShortfall = allSlots
    .filter(slot => !skippedKeys.has(textWordSlotKey(slot)))
    .reduce((sum, slot) => sum + slot.target * (minimumRatio - minimumWordAcceptanceRatio(slot, minimumRatio)), 0);
  const effectiveMinimumRatio = effectiveTotalTarget > 0
    ? Math.max(0, (effectiveTotalTarget * minimumRatio - toleratedShortfall) / effectiveTotalTarget)
    : minimumRatio;
  const outOfRangeSlots = allSlots
    .filter(slot => !skippedKeys.has(textWordSlotKey(slot)) && slot.target > 0
      && (slot.actual / slot.target < minimumWordAcceptanceRatio(slot, minimumRatio) || slot.actual / slot.target > maximumRatio));
  const underfilledSlots = allSlots
    .filter(slot => !skippedKeys.has(textWordSlotKey(slot)) && slot.target > 0
      && slot.actual < slot.target * minimumWordAcceptanceRatio(slot, minimumRatio));
  const effectiveRatio = effectiveTotalTarget > 0 ? effectiveTotalWords / effectiveTotalTarget : 1;
  const totalAccepted = effectiveTotalTarget <= 0 || (effectiveRatio >= effectiveMinimumRatio && effectiveRatio <= maximumRatio);
  return {
    totalWords,
    totalTarget: plannedTotal,
    effectiveTotalWords,
    effectiveTotalTarget,
    minimumRatio,
    effectiveMinimumRatio,
    maximumRatio,
    totalAccepted,
    outOfRangeSlots,
    underfilledSlots,
    skippedSlots: excludedSlots,
    accepted: totalAccepted && underfilledSlots.length === 0,
  };
}

function buildTextSlotRetryPrompt({ slot, chapter, outline, language, sourceContent }) {
  const source = sourceContent
    ? `\nFoydalanuvchi bergan manba konteksti:\n${String(sourceContent).slice(0, 2000)}`
    : "";
  const current = String(slot.currentText || "").slice(0, 7000);
  const slotName = slot.kind === "section" ? "ichki reja bandi" : "mustaqil matn qismi";
  const retryTarget = Math.ceil(slot.target * RETRY_WORD_BUFFER_RATIO - 1e-9);
  const minimumAccepted = Math.ceil(slot.target * minimumWordAcceptanceRatio(slot) - 1e-9);
  const maximumAccepted = Math.floor(slot.target * WORD_MAX_ACCEPTANCE_RATIO + 1e-9);
  return `Faqat bitta matn slotini to'liq qayta yoz: boshqa bob, bo'lim yoki media yaratma.
Ish: "${outline?.meta?.title || chapter?.title || "Mavzu"}". Til: ${language || "o'zbek"}.
Bob: "${chapter?.title || "Qism"}". Qayta yoziladigan ${slotName}: "${slot.title}".
Nominal maqsad: ${slot.target} so'z. Ushbu qayta so'rovda 10% zaxira bilan taxminan ${retryTarget} so'z yoz. Qabul oralig'i nominal maqsad bo'yicha ${minimumAccepted}–${maximumAccepted} so'zligicha qoladi; matnni ravon va mazmunli yoz, sarlavhani JSON content ichiga kiritma.
Bu javob avvalgi aynan shu slot matnining TO'LIQ O'RNINI BOSADI. Hozirgi matnni takrorlamasdan uning muhim fikrlarini saqla, yetishmayotgan jihatlarni to'ldir. Boshqa slotlar va media o'zgarmaydi.
Faqat paragraf bloklari qaytar; formula, jadval, grafik, rasm, media_slot markerlari yoki heading yaratma.
Hozirgi slot matni:\n${current}${source}
FAQAT JSON: {"chapter_id":"${chapter?.id || ""}","slot_id":"${slot.sectionId}","content":[{"type":"paragraph","text":"..."}]}`;
}

function replaceTextSlot(chapters, slot, replacement) {
  const paragraphs = (Array.isArray(replacement) ? replacement : [])
    .filter(item => item?.type === "paragraph" && String(item.text || "").trim())
    .map(item => ({ type: "paragraph", text: String(item.text).trim() }));
  if (!paragraphs.length || !chapters?.[slot.chapterIndex]) return chapters;

  const next = [...chapters];
  const chapter = next[slot.chapterIndex];
  const content = Array.isArray(chapter.content) ? chapter.content : [];
  const replaceParagraphBlocks = blocks => {
    const updated = [];
    let replacementIndex = 0;
    let lastParagraphPosition = -1;
    for (const item of blocks) {
      if (item?.type === "paragraph") {
        if (replacementIndex < paragraphs.length) {
          updated.push(paragraphs[replacementIndex++]);
          lastParagraphPosition = updated.length;
        }
      } else {
        updated.push(item);
      }
    }
    if (replacementIndex < paragraphs.length) {
      updated.splice(Math.max(0, lastParagraphPosition), 0, ...paragraphs.slice(replacementIndex));
    }
    return updated;
  };
  if (slot.kind === "chapter") {
    next[slot.chapterIndex] = { ...chapter, content: replaceParagraphBlocks(content) };
    return next;
  }

  const headings = content
    .map((item, index) => item?.type === "heading" && item.level === 2 ? index : -1)
    .filter(index => index >= 0);
  const headingIndex = headings[slot.sectionIndex];
  if (headingIndex == null) return chapters;
  const endIndex = headings[slot.sectionIndex + 1] ?? content.length;
  const heading = content[headingIndex];
  const updatedSlot = replaceParagraphBlocks(content.slice(headingIndex + 1, endIndex)
    .filter(item => !(item?.type === "heading" && item.level === 2)));
  const updated = [
    ...content.slice(0, headingIndex),
    heading,
    ...updatedSlot,
    ...content.slice(endIndex),
  ];
  next[slot.chapterIndex] = { ...chapter, content: updated };
  return next;
}

async function retryDeficientTextSlots(chapters, outlineChapters, retry, concurrency = boundedConcurrency()) {
  const deficient = evaluateWordTargets(chapters, outlineChapters, 0).outOfRangeSlots;
  const results = await mapWithConcurrency(deficient, concurrency, async slot => {
    let bestContent = null;
    let bestWords = slot.actual;
    let bestText = slot.currentText;
    let attempt = 0;
    const distanceFromAcceptanceRange = words => {
      const minimumRatio = minimumWordAcceptanceRatio(slot);
      const ratio = words / slot.target;
      const minimum = slot.target * minimumRatio;
      const maximum = slot.target * WORD_MAX_ACCEPTANCE_RATIO;
      return ratio < minimumRatio ? minimum - words : ratio > WORD_MAX_ACCEPTANCE_RATIO ? words - maximum : 0;
    };

    while (distanceFromAcceptanceRange(bestWords) > 0) {
      attempt++;
      let content;
      try {
        content = await retry({ ...slot, actual: bestWords, currentText: bestText, retryAttempt: attempt });
      } catch (error) {
        console.warn(`[mustaqil] matn slot ${slot.sectionId} qayta urinish ${attempt} xato: ${error.message}`);
        throw error;
      }

      const retryWords = countWords(content);
      if (retryWords > 0 && distanceFromAcceptanceRange(retryWords) < distanceFromAcceptanceRange(bestWords)) {
        bestContent = content;
        bestWords = retryWords;
        bestText = (content || []).filter(item => item?.type === "paragraph")
          .map(item => String(item.text || "")).join("\n\n");
      } else {
        const delay = Math.min(1000 * (2 ** Math.min(attempt - 1, 5)), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return { slot, content: bestContent };
  });
  let merged = chapters;
  for (const result of results) {
    if (result.content?.length) merged = replaceTextSlot(merged, result.slot, result.content);
  }
  const skippedSlots = [];
  return {
    chapters: merged,
    attemptedSlots: deficient,
    skippedSlots,
    validation: evaluateWordTargets(merged, outlineChapters, 0, WORD_ACCEPTANCE_RATIO, skippedSlots),
  };
}

// в”Ђв”Ђ ASOSIY GENERATSIYA в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function generateMustaqilIsh({ topic, pages, language, studentName, studentGroup, org, supervisor, sourceContent, llm, outFile, flowchartCount = null, chartCount, chartPlans, formulaCount, formulaPlans, onProgress }) {
  const reportProgress = async (percent, phase) => {
    if (typeof onProgress !== "function") return;
    try { await onProgress({ percent, phase }); }
    catch (error) { console.warn("[mustaqil] progress yangilashda xato:", error.message); }
  };
  console.log("[mustaqil] boshlandi:", topic, pages+"bet");
  const lang    = language || "o'zbek";
  const pagePlanForWork = pagePlan(pages);
  const rawRequestedFlowchartCount = flowchartCount == null ? null : Math.max(0, Math.floor(Number(flowchartCount) || 0));
  const rawRequestedChartCount = chartCount == null ? undefined : Math.max(0, Math.floor(Number(chartCount) || 0));
  const effectiveFormulaCount = formulaCount == null && Array.isArray(formulaPlans) ? formulaPlans.length : formulaCount;
  const requestedFormulaCount = resolveFormulaQuota(pagePlanForWork.mainChapterCount, { formulaCount: effectiveFormulaCount, topic });
  const diagramQuotas = resolveDiagramQuotas(pagePlanForWork.mainChapterCount, {
    flowchartCount: rawRequestedFlowchartCount,
    chartCount: rawRequestedChartCount,
  });
  const requestedFlowchartCount = diagramQuotas.flowchartCount;
  const requestedChartCount = diagramQuotas.chartCount;
  for (const [name, count] of [["formula", requestedFormulaCount], ["chart", requestedChartCount], ["flowchart", requestedFlowchartCount]]) {
    if (count != null && count > pagePlanForWork.mainChapterCount) {
      throw new Error(`${count} ta ${name} uchun kamida ${count} ta asosiy bo'lim kerak; sahifa rejasi esa ${pagePlanForWork.mainChapterCount} ta bo'lim beradi.`);
    }
  }
  if (requestedFormulaCount != null && Array.isArray(formulaPlans) && formulaPlans.length !== requestedFormulaCount) {
    throw new Error(`Formula kvotasi ${requestedFormulaCount}, lekin formulaPlans ro'yxatida ${formulaPlans.length} ta reja bor.`);
  }
  if (rawRequestedChartCount != null && Array.isArray(chartPlans) && chartPlans.length !== rawRequestedChartCount) {
    throw new Error(`Grafik kvotasi ${rawRequestedChartCount}, lekin chartPlans ro'yxatida ${chartPlans.length} ta reja bor.`);
  }
  const plannedPages = pagePlanForWork.pages;
  const totalWt = pagePlanForWork.totalWords;
  if (pagePlanForWork.addedPages) {
    console.log(`[mustaqil] sahifa rejasi: ${pagePlanForWork.requestedPages} → ${plannedPages} bet (+${pagePlanForWork.addedPages}), 1.5 betlik bo'lim/grafik hisob modeliga mos`);
  }

  // в”Ђв”Ђ PASS 1: OUTLINE в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  console.log("[mustaqil] 1-pass: outline...");
  let outline = parseOutline(await callLLM({
    system: outlineSystemPrompt(),
    user:   outlineUserPrompt({ topic, pages, language:lang, studentName, studentGroup, org, supervisor, sourceContent, flowchartCount: requestedFlowchartCount, chartCount: requestedChartCount, formulaCount: requestedFormulaCount }),
    llm, maxTokens: 6000, // S2-T4: outline keng budget (JSON uzilishi oldini oladi)
  }));
  if (outline.meta) outline.meta.year = String(new Date().getFullYear());
  outline.total_words_target = outline.total_words_target || totalWt;

  // Tuzilma tekshiruvi вЂ” soxta qo'shish yo'q, zarur bo'lsa qayta so'rash
  const expectedPlan = pagePlanForWork;
  const isIntro = (c) => c && (c.id === "intro" || c.role === "introduction" || /^kirish$/i.test(String(c.title || "").trim()));
  const isConclusion = (c) => c && (c.id === "conclusion" || c.role === "conclusion" || /^xulosa$/i.test(String(c.title || "").trim()));
  const isReferences = (c) => c && (/reference|bibliography/i.test(`${c.id || ""} ${c.role || ""}`) || /^(foydalanilgan adabiyotlar(?: ro'yxati)?|adabiyotlar(?: ro'yxati)?|references|bibliography)$/i.test(String(c.title || "").trim()));
  const matchesExpectedStructure = (candidate) => {
    const candidateChapters = Array.isArray(candidate?.chapters) ? candidate.chapters : [];
    const hasIntro = candidateChapters.some(isIntro);
    const hasConclusion = candidateChapters.some(isConclusion);
    const mainChapters = candidateChapters.filter(c => !isIntro(c) && !isConclusion(c) && !isReferences(c));
    const subsectionCount = mainChapters.reduce((sum, c) => sum + (Array.isArray(c.sections) ? c.sections.length : 0), 0);
    return hasIntro && hasConclusion && mainChapters.length === expectedPlan.mainChapterCount && subsectionCount === expectedPlan.subsectionCount;
  };
  if (!matchesExpectedStructure(outline)) {
    console.log("[mustaqil] outline tuzilmasi talabga mos emas, qayta so'ralmoqda...");
    const retry = parseOutline(await callLLM({
      system: outlineSystemPrompt(),
      user:   outlineUserPrompt({ topic, pages, language:lang, studentName, studentGroup, org, supervisor, sourceContent, flowchartCount: requestedFlowchartCount, chartCount: requestedChartCount, formulaCount: requestedFormulaCount }),
      llm, maxTokens: 6000, // S2-T4: outline keng budget (JSON uzilishi oldini oladi)
    }));
    if (matchesExpectedStructure(retry)) {
      if (retry.meta) retry.meta.year = String(new Date().getFullYear());
      outline = retry;
      console.log("[mustaqil] outline qayta olindi вњ…");
    } else {
      console.warn("[mustaqil] ikkinchi urinishda ham bob tuzilmasi noto'g'ri — mavjud outline bilan davom");
    }
  }

  const generatedReferences = Array.isArray(outline.references) ? outline.references : [];
  outline.references = selectBestReferences(generatedReferences);
  let bibliographyCheck = validateBibliography(outline.references);
  if (!bibliographyCheck.valid) {
    console.warn("[mustaqil] bibliografiyada til qamrovi yoki APA 7 maydonlari yetishmaydi; faqat manbalar qayta so'ralmoqda:", bibliographyCheck.problems.join("; "));
    try {
      const repaired = parseOutline(await callLLM({
        system: outlineSystemPrompt(),
        user: buildBibliographyRepairPrompt({ topic, language: lang, references: generatedReferences, validation: bibliographyCheck, sourceContent }),
        llm,
        maxTokens: 3500,
      }));
      const repairedReferences = Array.isArray(repaired.references) ? repaired.references : [];
      const repairedCheck = validateBibliography(repairedReferences);
      if (repairedCheck.valid) {
        outline.references = selectBestReferences(repairedReferences);
        console.log("[mustaqil] bibliografiya APA 7 va uch til qamrovi bo'yicha tuzatildi");
      } else {
        outline.references = selectBestReferences(generatedReferences, repairedReferences);
        console.warn("[mustaqil] bibliografiya retry to'liq talabga yetmadi; eng yaxshi manbalar bilan hujjat davom etadi:", repairedCheck.problems.join("; "));
      }
    } catch (error) {
      outline.references = selectBestReferences(generatedReferences);
      console.warn("[mustaqil] bibliografiya retry bajarilmadi; mavjud manbalar bilan hujjat davom etadi:", error.message);
    }
    bibliographyCheck = validateBibliography(outline.references);
  }
  outline.references = completeBibliography(outline.references, { topic });
  bibliographyCheck = validateBibliography(outline.references);
  if (!bibliographyCheck.valid) {
    console.warn("[mustaqil] ogohlantirish: yakuniy bibliografiya baribir APA 7/uch til talablarining barchasini qanoatlantirmaydi; DOCX generatsiyasi to'xtatilmaydi:", bibliographyCheck.problems.join("; "));
  }

  // Bir nechta intro/conclusion bo'lsa, ortiqchasini olib tashlash
  let seenI=false, seenC=false;
  outline.chapters = (Array.isArray(outline.chapters) ? outline.chapters : []).filter(c=>{
    if(c.id==="intro")      { if(seenI) return false; seenI=true; }
    if(c.id==="conclusion") { if(seenC) return false; seenC=true; }
    return true;
  });
  outline = normalizeOutlineForPages(outline, { pages, topic, language: lang, studentName, studentGroup, org, supervisor, flowchartCount: requestedFlowchartCount, chartCount: requestedChartCount, chartPlans, formulaCount: requestedFormulaCount, formulaPlans });

  const plannedMediaCounts = outline.chapters.reduce((counts, chapter) => ({
    formula: counts.formula + (chapter.formula_plans || []).length,
    chart: counts.chart + (chapter.chart_plans || []).length,
    flowchart: counts.flowchart + (chapter.flowchart_plans || []).length,
  }), { formula: 0, chart: 0, flowchart: 0 });
  for (const [name, requested] of [["formula", requestedFormulaCount], ["chart", requestedChartCount], ["flowchart", requestedFlowchartCount]]) {
    if (requested != null && plannedMediaCounts[name] !== requested) {
      throw new Error(`Outline media rejasida ${plannedMediaCounts[name]}/${requested} ta ${name} bor; to'liq media rejasi tuzilmagani uchun hujjat chiqarilmadi.`);
    }
  }

  // Formula va grafik rejalashtirishini loglash
  const fLog = outline.chapters
    .filter(c=>(c.formula_plans||c.formula_latex||[]).length>0)
    .map(c=>{
      const plans = c.formula_plans || (c.formula_latex||[]).map(l=>({latex:l}));
      return `'${c.title}': [${plans.map(f=>(f.concept||f.latex||f)).join(", ")} ]`;
    });
  const gLog = outline.chapters
    .filter(c=>(c.chart_plans||c.chart_titles||[]).length>0)
    .map(c=>{
      const plans = c.chart_plans || (c.chart_titles||[]).map(t=>({title:t}));
      return `'${c.title}' (${c.chart_type}): [${plans.map(g=>(g.variable||g.title||g)).join(", ")} ]`;
    });
  if(fLog.length) console.log("[mustaqil] formulalar:", fLog.join(" | "));
  if(gLog.length) console.log("[mustaqil] grafiklar:", gLog.join(" | "));
  console.log("[mustaqil] outline:", outline.chapters.length+" bob, target="+outline.total_words_target+" so'z");

  // Slot IDs come from the normalized outline and remain stable through generation and assembly.
  const mediaSlots = buildMediaSlots(outline.chapters, { topic });
  const slotsByChapter = groupMediaSlotsByChapter(mediaSlots);
  console.log(`[mustaqil] media slotlari: ${mediaSlots.length} ta (${mediaSlots.map(slot => slot.slot_id).join(", ") || "yo'q"})`);
  await reportProgress(12, "Reja va manbalar tayyor");

  // Prose and type-specific media requests share one bounded queue.
  console.log(`[mustaqil] 2-pass: matn va media slotlari parallel (concurrency=${boundedConcurrency()})...`);
  const proseTasks = outline.chapters.map((chapter, index) => ({ kind: "prose", chapter, index }));
  const generationTasks = [...proseTasks, ...mediaSlots.map(slot => ({ kind: "media", slot }))];
  const generationResults = await mapWithConcurrency(generationTasks, boundedConcurrency(), async task => {
    if (task.kind === "prose") {
      const { chapter, index } = task;
      let lastError;
      for (let attempt = 1; attempt <= SLOT_RETRY_LIMIT; attempt++) {
        try {
          const text = await callLLM({
            system: chapterSystemPrompt(),
            user: chapterUserPrompt({
              chapter, outline, language: lang, sourceContent,
              chapterIndex: index, totalChapters: outline.chapters.length,
              mediaSlots: slotsByChapter.get(chapter.id) || [], proseOnly: true,
            }),
            llm, maxTokens: 6000,
          });
          const parsed = parseChapter(text);
          const content = normalizeChapterContent(chapter, parsed.content || [], chapterMainNumber(outline.chapters, index));
          return { kind: "prose", index, chapter: { ...chapter, content } };
        } catch (error) {
          lastError = error;
          console.warn(`[mustaqil] matn bob #${index} urinish ${attempt}/${SLOT_RETRY_LIMIT} xato: ${error.message}`);
        }
      }
      return { kind: "prose", index, chapter: { ...chapter, content: [] }, error: lastError };
    }
    return { kind: "media", ...(await generateMediaSlot(task.slot, {
      chapter: outline.chapters[task.slot.chapterIndex], topic, language: lang, sourceContent, llm,
    })) };
  });

  let chapters = outline.chapters.map(chapter => ({ ...chapter, content: [] }));
  const mediaResults = new Map();
  for (const result of generationResults) {
    if (result.kind === "prose") chapters[result.index] = result.chapter;
    else mediaResults.set(result.slot.slot_id, result);
  }
  const mediaItems = new Map([...mediaResults].map(([slotId, result]) => [slotId, result.item]));
  chapters.forEach((chapter, index) => {
    chapter.content = mergeMediaSlotsIntoContent(
      chapter, chapter.content, slotsByChapter.get(chapter.id) || [], mediaItems,
      chapterMainNumber(outline.chapters, index),
    );
  });
  await reportProgress(60, "Boblar matni va media tayyor");

  // в”Ђв”Ђ VALIDATSIYA: takror formula/grafik, asosiy bobda kirish/xulosa в”Ђв”Ђ
  // State tracking (faqat shu generatsiya uchun):
  const state = {
    usedFormulaSigs:  new Map(),  // signature в†’ {chIdx, latex}
    usedChartKeys:    new Map(),  // purpose key в†’ {chIdx, title}
    paragraphPool:    [],          // {chIdx, text}
    violations:       [],
  };

  function scanChapter(ch, chIdx) {
    const issues = [];
    (ch.content || []).forEach((item, i) => {
      if (item.type === "formula" && item.latex) {
        const sig = normalizeFormula(item.latex);
        if (sig && state.usedFormulaSigs.has(sig)) {
          const prev = state.usedFormulaSigs.get(sig);
          issues.push({ kind: "formula_dup", item, prev, idx: i });
        } else if (sig) {
          state.usedFormulaSigs.set(sig, { chIdx, latex: item.latex });
        }
      }
      if (item.type === "chart") {
        const purpose = normalizeChartPurpose(item);
        if (purpose && state.usedChartKeys.has(purpose)) {
          const prev = state.usedChartKeys.get(purpose);
          issues.push({ kind: "chart_dup", item, prev, idx: i });
        } else if (purpose) {
          state.usedChartKeys.set(purpose, { chIdx, title: item.title });
        }
      }
      if (item.type === "paragraph" && item.text) {
        // Boshqa bob paragraflari bilan o'xshashlik
        for (const p of state.paragraphPool) {
          if (p.chIdx !== chIdx) {
            const sim = paragraphSimilarity(item.text, p.text);
            if (sim > 0.55) {  // 55%+ o'xshashlik = takror
              issues.push({ kind: "paragraph_dup", item, prev: p, similarity: sim, idx: i });
              break;
            }
          }
        }
        state.paragraphPool.push({ chIdx, text: item.text });
      }
    });
    // Forbidden intro/conclusion in main chapter
    const role = ch.role || (ch.id==="intro"?"introduction":ch.id==="conclusion"?"conclusion":"theory");
    const forbidden = detectForbiddenIntroConclusion(ch.content, role);
    forbidden.forEach(v => issues.push({ kind: "forbidden_intro_conclusion", item: v, role }));
    return issues;
  }

  // 1-VALIDATSIYA: barcha boblarni skanlash
  chapters.forEach((ch, idx) => {
    const issues = scanChapter(ch, idx);
    if (issues.length > 0) {
      state.violations.push({ chIdx: idx, title: ch.title, issues });
    }
  });

  // QAYTA GENERATSIYA: faqat muammoli boblarni
  if (state.violations.length > 0) {
    console.log("[mustaqil] validatsiya:", state.violations.length, "ta bobda muammo topildi");
    state.violations.forEach(v => {
      const types = v.issues.map(i => i.kind).join(", ");
      console.log(`  - '${v.title}': ${v.issues.length} ta muammo (${types})`);
    });

    // Faqat takrorli formula/chart bo'lgan boblarni qayta so'rash (forbidden intro/conclusion filterlanadi)
    const needRegen = state.violations.filter(v =>
      v.issues.some(i => i.kind === "formula_dup" || i.kind === "chart_dup" || i.kind === "paragraph_dup")
    );

    if (needRegen.length > 0) {
      console.log("[mustaqil] qayta generatsiya:", needRegen.length, "ta bob");

      const regenRes = await mapWithConcurrency(needRegen, boundedConcurrency(), async ({ chIdx }) => {
          const ch = chapters[chIdx];
          // Matnni qayta so'rash media slotlarining avvalgi natijasini o'zgartirmaydi.
          try {
            const t = await callLLM({
              system: chapterSystemPrompt(),
              user: chapterUserPrompt({
                chapter: ch, outline, language: lang, sourceContent,
                chapterIndex: chIdx, totalChapters: outline.chapters.length,
                mediaSlots: slotsByChapter.get(ch.id) || [], proseOnly: true,
              }),
              llm, maxTokens: 6000,
            });
            const p = parseChapter(t);
            const normalizedContent = normalizeChapterContent(ch, p.content || [], chapterMainNumber(outline.chapters, chIdx));
            const content = mergeMediaSlotsIntoContent(ch, normalizedContent, slotsByChapter.get(ch.id) || [], mediaItems, chapterMainNumber(outline.chapters, chIdx));
            return { chIdx, content };
          } catch (e) {
            console.warn("[mustaqil] qayta gen #"+chIdx+" xato:", e.message);
            return { chIdx, content: null };
          }
        });

      // Natijalarni qo'llash
      regenRes.forEach(r => {
        if (r?.content) {
          chapters[r.chIdx] = { ...chapters[r.chIdx], content: r.content };
        }
      });

      // State'ni qayta qurish (qayta gen'dan keyin)
      state.usedFormulaSigs.clear();
      state.usedChartKeys.clear();
      state.paragraphPool.length = 0;
      state.violations.length = 0;
      chapters.forEach((ch, idx) => {
        const issues = scanChapter(ch, idx);
        if (issues.length > 0) state.violations.push({ chIdx: idx, title: ch.title, issues });
      });

      if (state.violations.length > 0) {
        console.warn("[mustaqil] qayta gen'dan keyin ham", state.violations.length, "ta bobda muammo qoldi (davom etilmoqda)");
      } else {
        console.log("[mustaqil] qayta gen muvaffaqiyatli вЂ” takrorlar yo'q вњ…");
      }
    }

    // Forbidden intro/conclusion'ni har holda filtrlash (regen bo'lmasa ham)
    chapters.forEach(ch => {
      const role = ch.role || (ch.id==="intro"?"introduction":ch.id==="conclusion"?"conclusion":"theory");
      if (role !== "introduction" && role !== "conclusion" && Array.isArray(ch.content)) {
        ch.content = ch.content.filter(item => {
          if (item.type === "heading") {
            const t = String(item.text||"").replace(/^\d+(\.\d+)?\.\s*/, "");
            if (/^(kirish|xulosa|yakun|umumlashtirish)\b/i.test(t)) {
              console.log(`[mustaqil] '${ch.title}'dan "${item.text}" sarlavhasi olib tashlandi`);
              return false;
            }
          }
          return true;
        });
      }
    });
  } else {
    console.log("[mustaqil] validatsiya: takror yo'q вњ…");
  }

  // Retry only deficient prose slots; media requests and unrelated sections remain untouched.
  let skippedTextSlots = [];
  const initialWordValidation = evaluateWordTargets(chapters, outline.chapters, totalWt);
  const initialFillPct = totalWt > 0 ? initialWordValidation.totalWords / totalWt : 1;
  console.log("[mustaqil] so'z:", `${initialWordValidation.totalWords}/${totalWt} (${Math.round(initialFillPct * 100)}%)`);
  if (initialWordValidation.outOfRangeSlots.length) {
    console.log("[mustaqil] Qabul oralig'idan tashqaridagi matn slotlari qayta so'raladi:", initialWordValidation.outOfRangeSlots.map(slot => wordRangeDescription(slot)).join(" | "));
    const retryResult = await retryDeficientTextSlots(chapters, outline.chapters, async slot => {
      const chapter = chapters[slot.chapterIndex];
      const text = await callLLM({
        system: chapterSystemPrompt(),
        user: buildTextSlotRetryPrompt({ slot, chapter, outline, language: lang, sourceContent }),
        llm,
        maxTokens: 4000,
      });
      const parsed = parseChapter(text);
      if (parsed.slot_id && parsed.slot_id !== slot.sectionId) {
        throw new Error(`kutilmagan slot_id: ${parsed.slot_id}; kutilgan ${slot.sectionId}`);
      }
      return parsed.content || [];
    });
    chapters = retryResult.chapters;
    skippedTextSlots = retryResult.skippedSlots;
    console.log("[mustaqil] slot retry yakuni:", `${retryResult.validation.effectiveTotalWords}/${retryResult.validation.effectiveTotalTarget} samarali so'z`, `(${retryResult.skippedSlots.length} ta slot skip qilindi; ${retryResult.validation.outOfRangeSlots.length} ta slot qabul oralig'idan tashqarida)`);
  }

  const finalWordValidation = evaluateWordTargets(chapters, outline.chapters, totalWt, WORD_ACCEPTANCE_RATIO, skippedTextSlots);
  const finalWords = finalWordValidation.totalWords;
  if (!finalWordValidation.accepted) {
    const deficient = finalWordValidation.outOfRangeSlots.map(slot => wordRangeDescription(slot));
    if (!finalWordValidation.totalAccepted) deficient.unshift(`umumiy matn ${finalWordValidation.effectiveTotalWords}/${finalWordValidation.effectiveTotalTarget} samarali so'z (aslida ${finalWords}/${totalWt})`);
    throw new Error(`Mustaqil ish matni qabul oralig'idan tashqarida (oddiy slotlar 85–115%, Kirish/Xulosa 60–115%; ${finalWords}/${totalWt} so'z; muammoli slotlar: ${deficient.join(", ") || "umumiy kontent"}).`);
  }

  chapters = chapters.map((ch, i) => ({
    ...ch,
    content: clampChapterContent(ch, ch.content || [], chapterMainNumber(outline.chapters, i), WORD_MAX_ACCEPTANCE_RATIO),
  }));
  const postClampWordValidation = evaluateWordTargets(chapters, outline.chapters, totalWt, WORD_ACCEPTANCE_RATIO, skippedTextSlots);
  if (!postClampWordValidation.accepted) {
    const details = postClampWordValidation.outOfRangeSlots.map(slot => wordRangeDescription(slot));
    if (!postClampWordValidation.totalAccepted) details.unshift(`umumiy matn ${postClampWordValidation.effectiveTotalWords}/${postClampWordValidation.effectiveTotalTarget} samarali so'z`);
    throw new Error(`DOCX oldidan matn qabul oralig'idan chiqib ketdi (oddiy slotlar 85–115%, Kirish/Xulosa 60–115%): ${details.join(", ") || "umumiy kontent"}.`);
  }
  const budgetedWords = chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0);
  console.log("[mustaqil] Word matn byudjeti:", budgetedWords + "/" + totalWt);
  validatePlannedMedia(chapters, outline.chapters, { language: lang });
  await reportProgress(85, "Matn va reja tekshirildi");

  // Render and build the final document.
  console.log("[mustaqil] render + docx...");
  renumberMedia(chapters);  // formula/chart/table raqamlari butun hujjat bo'ylab unikal bo'ladi
  const verifiedCache = buildVerifiedImageCache(chapters, mediaResults);
  const diagrams = chapters.flatMap(chapter => chapter.content || []).filter(item => ["formula", "chart", "flowchart"].includes(item?.type));
  const unverified = diagrams.filter(item => !verifiedCache.has(`${item.type === "formula" ? "f" : item.type === "chart" ? "c" : "d"}_${item.number}`));
  if (unverified.length) {
    console.warn(`[mustaqil] ${unverified.length} ta media rasmi render-verifikatsiyasidan o'tmadi; hujjat yaroqsiz tasvirsiz davom etadi: ${unverified.map(item => item.slot_id || `${item.type} ${item.number}`).join(", ")}`);
  }
  const pngCache = await prerenderMedia(chapters, lang, verifiedCache);
  const spec = { meta:outline.meta, chapters, references:outline.references||[] };
  const buf  = await buildDocument(spec, pngCache);
  const dir  = path.dirname(outFile);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  const layoutVerification = {
    status: "skipped",
    actualPageCount: null,
    maxExpectedPages: pagePlanForWork.maxExpectedPages,
    errors: [],
    reason: "PDF/layout tekshiruvi generatsiya sharti emas.",
  };
  fs.writeFileSync(outFile, buf);
  console.log("[mustaqil] tayyor:", outFile, Math.round(buf.length/1024)+"KB");
  await reportProgress(97, "DOCX tayyor, yuborilmoqda");

  // CLEANUP: state ma'lumotlari faqat shu generatsiya uchun ishlatildi
  // DB'ga saqlanmaydi, har generatsiya mustaqil
  state.usedFormulaSigs.clear();
  state.usedChartKeys.clear();
  state.paragraphPool.length = 0;
  state.violations.length = 0;

  return {
    outFile,
    pageCount: null,
    plannedPageCount: plannedPages,
    maxExpectedPageCount: pagePlanForWork.maxExpectedPages,
    pageVerification: layoutVerification.status,
    layoutVerification,
    requestedPageCount: pagePlanForWork.requestedPages,
    addedPages: pagePlanForWork.addedPages,
    title: outline.meta?.title || topic,
  };
}

module.exports = {
  generateMustaqilIsh,
  generateMediaSlot,
  alignPlannedChartBlocks,
  alignPlannedFormulaBlocks,
  alignPlannedFlowchartBlocks,
  prerenderMedia,
  mapWithConcurrency,
  mediaSlotPrompt,
  normalizeMediaSlotResult,
  fallbackMediaSlot,
  buildVerifiedImageCache,
  boundedConcurrency,
  WORD_ACCEPTANCE_RATIO,
  getTextWordSlots,
  evaluateWordTargets,
  buildTextSlotRetryPrompt,
  replaceTextSlot,
  retryDeficientTextSlots,
};
