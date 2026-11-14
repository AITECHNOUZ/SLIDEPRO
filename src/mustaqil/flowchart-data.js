const { isGraphvizDiagramType } = require("./diagram-types");
const { getFlowchartTemplate } = require("./flowchart-templates");
const FLOWCHART_KINDS = new Set(["process", "input", "output", "start", "end", "decision", "sum", "controller", "plant", "sensor", "component", "class", "interface", "database", "actor", "step",
  "root", "category", "item", "effect", "cause", "factor", "event", "stage", "strength", "weakness", "opportunity", "threat", "equipment", "stream", "actuator"]);
// GOST 21.208: birinchi harf — o'lchanadigan kattalik, keyingilari — funksiya
const INSTRUMENT_TAG = /^[TPFLQHSEWMGJKDNU][EIRCSAVTKYZQ]{0,3}$/;
const FLOWCHART_MIN_NODES = 2;
const FLOWCHART_MAX_NODES = 5;
const FLOWCHART_MAX_LABEL_WORDS = 5;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const UZBEK_TRANSLATIONS = [
  ["transfer funksiyani", "uzatish funksiyasini"],
  ["transfer function", "uzatish funksiyasi"],
  ["transfer funksiya", "uzatish funksiyasi"],
  ["overshootni", "ortiqcha o‘tishni"],
  ["overshoot", "ortiqcha o‘tish"],
  ["domenida", "sohasida"],
  ["dizaynni", "loyihani"],
  ["design", "loyiha"],
  ["dizayn", "loyiha"],
  ["transfer", "uzatish"],
  ["domen", "soha"],
  ["frequency-domain", "chastota sohasi"],
  ["time-domain", "vaqt sohasi"],
  ["time domain", "vaqt sohasi"],
  ["anti-windupni", "integral yig'ilishdan himoya vositasini"],
  ["antiwindupni", "integral yig'ilishdan himoya vositasini"],
  ["anti-windup", "integral yig'ilishdan himoya vositasi"],
  ["antiwindup", "integral yig'ilishdan himoya vositasi"],
  ["vaqt-domain", "vaqt sohasi"],
  ["domain", "soha"],
  ["response", "javob"],
  ["closed-loop control system", "yopiq konturli boshqaruv tizimi"],
  ["feedback control system", "teskari aloqali boshqaruv tizimi"],
  ["integrated pest management", "zararkunandalarga qarshi integratsiyalashgan kurash"],
  ["IPM", "zararkunandalarga qarshi integratsiyalashgan kurash"],
  ["risk", "xavf"],
  ["control signal", "boshqaruv signali"],
  ["set point qiymatini", "topshiriq qiymatini"],
  ["setpoint qiymatini", "topshiriq qiymatini"],
  ["set point", "topshiriq qiymati"],
  ["setpoint", "topshiriq qiymati"],
  ["measurement", "o'lchov"],
  ["controller", "rostlagich"],
  ["kontroller", "rostlagich"],
  ["actuator", "ijro mexanizmi"],
  ["feedback", "teskari aloqa"],
  ["reference", "topshiriq"],
  ["sensor", "datchik"],
  ["decision", "qaror"],
  ["process", "jarayon"],
  ["algorithm", "algoritm"],
  ["flowchart", "oqim sxemasi"],
  ["calculate", "hisoblash"],
  ["compute", "hisoblash"],
  ["compare", "taqqoslash"],
  ["measure", "o'lchash"],
  ["control", "boshqaruv"],
  ["signal", "signal"],
  ["system", "tizim"],
  ["output", "chiqish"],
  ["input", "kirish"],
  ["unstable", "beqaror"],
  ["stable", "barqaror"],
  ["adjust", "sozlash"],
  ["evaluate", "baholash"],
  ["continue", "davom etish"],
  ["increase", "oshirish"],
  ["decrease", "kamaytirish"],
  ["threshold", "chegara qiymati"],
  ["restart", "qayta boshlash"],
  ["reset", "qayta o'rnatish"],
  ["desired", "berilgan"],
  ["actual", "haqiqiy"],
  ["target", "maqsad"],
  ["plant", "boshqaruv obyekti"],
  ["result", "natija"],
  ["value", "qiymat"],
  ["check", "tekshirish"],
  ["return", "qaytish"],
  ["repeat", "takrorlash"],
  ["output", "chiqish"],
  ["start", "Boshlash"],
  ["begin", "Boshlash"],
  ["finish", "Yakunlash"],
  ["end", "Yakunlash"],
  ["stop", "To'xtatish"],
  ["yes", "Ha"],
  ["no", "Yo'q"],
  ["true", "Rost"],
  ["false", "Yolg'on"],
  ["if", "agar"],
  ["then", "unda"],
  ["else", "aks holda"],
  ["step", "bosqich"],
  ["time", "vaqt"],
  ["loop", "kontur"],
  ["function", "funksiya"],
  ["open", "ochiq"],
  ["closed", "yopiq"],
  ["wait", "kutish"],
  ["error", "xatolik"],
  ["monitoring", "kuzatish"],
  ["fallback", "zaxira variant"],
  ["pid", "proporsional-integral-differensial rostlagich"],
];
const UZBEK_ENGLISH_WORDS = [...new Set(UZBEK_TRANSLATIONS.map(([word]) => word.split(/\s+/)).flat())].filter(word => word !== "signal");
const UZBEK_COMMON_WORDS = new Set(`o'zbek mavzu asosiy jarayon jarayonlari bosqich bosqichlari suv suvni tozalash tizim tizimi avtomatik boshqaruv natija natijasi qaror qarorlar ketma ketlik ko'rsatish o'lchash ma'lumot ma'lumotni ma'lumotlar qabul amal amalni bajarish keyingi mezon mezonga mosmi yakunlash boshlash tushuntirish tahlil model modeli samara samaradorlik sifat sifatini maqbulmi nazorat oqim oqimi xom manbai ichimlik filtrlash iste'molchi algoritmi rostlagich qurilma qiymat qiymati chiqishi kirish natijani shart belgilangan ifodalash usul usullari qism qismi taqqoslash tezlik tezligi xatolik xatolikni bo'lim yo'nalish ishlash qo'llash baholash natijaga amaliy nazariy ko'rsatkich ko'rsatkichlar`.split(/\s+/));
const UZBEK_EXTRA_WORDS = new Set(`sinov mavzusi yopiq yakun yakuniy nazorati adabiyot adabiyoti qiyosiy she'riyat obrazlar qiymatini o'tkazuvchanlik kontur tarakan`.split(/\s+/));
const UZBEK_SUFFIX = /(?:laridan|larining|larimiz|laringiz|lashtirish|lanish|lar|lari|ning|dagi|dan|ga|ka|qa|ni|mi|si|sini|imiz|ingiz|ligi|lik|chi|ish|lash|masi|moqda|ayotgan|uv|i)$/i;

function isUzbek(language) {
  return /^(?:uz\b|uzbek\b|o['’]zbek\b)/i.test(String(language || "").trim());
}
function isRussian(language) {
  return /^(?:ru\b|rus\b|рус)/i.test(String(language || "").trim());
}

function isLikelyUzbekWord(value) {
  const word = String(value || "").toLocaleLowerCase().replace(/[’`]/g, "'");
  return word.includes("'") || UZBEK_COMMON_WORDS.has(word) || UZBEK_EXTRA_WORDS.has(word) || UZBEK_SUFFIX.test(word);
}

function localizeUzbekText(value, language) {
  if (!isUzbek(language)) return value;
  let text = value;
  for (const [english, uzbek] of [...UZBEK_TRANSLATIONS].sort((left, right) => right[0].length - left[0].length)) {
    const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\b${escaped}\\b`, "gi"), uzbek);
  }
  // "PID rostlagich" → "...differensial rostlagich rostlagich" kabi takrorlarni olib tashlash
  return text.replace(/\b([\p{L}'’ʻ-]+)(\s+\1\b)+/giu, "$1");
}

function requiredUzbekTranslations(flowchart) {
  const sourceTexts = [
    flowchart?.title,
    ...(Array.isArray(flowchart?.nodes) ? flowchart.nodes.map(node => node?.label) : []),
    ...(Array.isArray(flowchart?.edges) ? flowchart.edges.map(edge => edge?.label) : []),
  ].filter(value => typeof value === "string");
  const matches = new Map();
  const translations = [...UZBEK_TRANSLATIONS].sort((left, right) => right[0].length - left[0].length);
  for (const source of sourceTexts) {
    for (const [english, uzbek] of translations) {
      const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(source)) matches.set(english.toLocaleLowerCase(), { english, uzbek });
    }
    const tokens = String(source).match(/[A-Za-z][A-Za-z’'-]{2,}/g) || [];
    for (const token of tokens) {
      const normalized = token.toLocaleLowerCase().replace(/[’`]/g, "'");
      const acronym = /^[A-Z]{2,}$/.test(token);
      if (UZBEK_ENGLISH_WORDS.includes(normalized) || (!acronym && isLikelyUzbekWord(normalized))) continue;
      if (!matches.has(normalized)) matches.set(normalized, { english: token, uzbek: null });
    }
  }
  return [...matches.values()];
}

function providedCaptionTranslation(caption, english) {
  const normalize = value => String(value || "").toLocaleLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();
  const wanted = normalize(english);
  for (const segment of String(caption || "").split(/[;\n]+/)) {
    const match = segment.trim().match(/^(?:Atamalar:\s*)?(.+?)\s*[—–-]\s*(.+?)\s*\.?$/i);
    if (!match || normalize(match[1]) !== wanted) continue;
    if (normalize(match[2]) && normalize(match[2]) !== wanted) return match[2].trim();
  }
  return "";
}

function buildFlowchartCaption(flowchart, purpose = "", language = "o'zbek") {
  const title = String(flowchart?.title || "Oqim sxemasi").trim();
  const description = String(purpose || "mavzuga oid besh tushuncha va ularning aloqalarini ko'rsatadi").trim();
  if (isUzbek(language)) {
    let conciseDescription = localizeUzbekText(description, language)
      .replace(/\s+/g, " ")
      .replace(/[.!?]+$/g, "");
    if (conciseDescription.split(/\s+/).filter(Boolean).length < 5) {
      conciseDescription = `${conciseDescription} va asosiy tushunchalar o'rtasidagi aloqalarni ko'rsatadi`;
    }
    if (conciseDescription.length > 220) {
      conciseDescription = `${conciseDescription.slice(0, 217).replace(/\s+\S*$/, "")}…`;
    }
    return `Izoh: ${conciseDescription}.`;
  }
  if (isRussian(language)) return `${title}. Пояснение: ${description}.`;
  return `${title}. Explanation: ${description}.`;
}

function captionContainsUzbekEquivalent(caption, equivalent) {
  const normalize = value => String(value || "")
    .toLocaleLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
  const captionWords = normalize(caption).split(/\s+/).filter(Boolean);
  const equivalentWords = normalize(equivalent).split(/\s+/).filter(Boolean);
  return equivalentWords.length > 0 && equivalentWords.every(word => {
    const root = word.length > 5 ? word.slice(0, word.length - 2) : word;
    return captionWords.some(captionWord => captionWord.startsWith(root));
  });
}

function textField(value, field, maxLength, required = true) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new Error(`flowchart: ${field} matn bo'lishi kerak`);
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (required && !text) throw new Error(`flowchart: ${field} bo'sh bo'lmasin`);
  if (text.length > maxLength) throw new Error(`flowchart: ${field} ${maxLength} belgidan oshmasin`);
  return text;
}

function normalizeFlowchartData(flowchart, { language = flowchart?.language, diagramType = flowchart?.diagram_type } = {}) {
  if (!flowchart || typeof flowchart !== "object" || Array.isArray(flowchart)) {
    throw new Error("flowchart: ma'lumot obyekt bo'lishi kerak");
  }
  const normalizedDiagramType = String(diagramType || "functional_block_diagram").trim();
  if (!isGraphvizDiagramType(normalizedDiagramType)) throw new Error(`flowchart: noma'lum diagram_type (${normalizedDiagramType})`);
  const template = getFlowchartTemplate(normalizedDiagramType);
  const title = textField(flowchart.title, "title", 120);
  const limits = template.limits || {};
  const minNodes = limits.minNodes || FLOWCHART_MIN_NODES;
  const maxNodes = limits.maxNodes || FLOWCHART_MAX_NODES;
  const minEdges = limits.minEdges ?? 1;
  const maxEdges = limits.maxEdges ?? 7;
  const maxLabelWords = limits.maxLabelWords || FLOWCHART_MAX_LABEL_WORDS;
  if (!Array.isArray(flowchart.nodes) || flowchart.nodes.length < minNodes || flowchart.nodes.length > maxNodes) {
    throw new Error(`flowchart: ${minNodes}–${maxNodes} ta node bo'lishi kerak`);
  }
  if (normalizedDiagramType === "algorithm_flowchart" && flowchart.nodes.length < 3) {
    throw new Error("flowchart: algoritm uchun kamida 3 ta node (start, amal va end) kerak");
  }
  if (normalizedDiagramType === "pid_control_system" && flowchart.nodes.length !== 5) {
    throw new Error("flowchart: PID yopiq konturi uchun aynan 5 ta node kerak");
  }
  const rawEdges = Array.isArray(flowchart.edges) ? flowchart.edges : (maxEdges === 0 ? [] : null);
  if (!rawEdges || rawEdges.length < minEdges || rawEdges.length > Math.max(maxEdges, minEdges)) {
    throw new Error(`flowchart: edges ${minEdges}–${maxEdges} ta bo'lishi kerak`);
  }

  const ids = new Set();
  const nodes = flowchart.nodes.map((node, index) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(`flowchart: node ${index + 1} obyekt bo'lishi kerak`);
    }
    const id = textField(node.id, `node ${index + 1} id`, 32);
    if (!ID_PATTERN.test(id)) throw new Error(`flowchart: node ${index + 1} id xavfsiz formatda emas`);
    if (ids.has(id)) throw new Error(`flowchart: takrorlangan node id (${id})`);
    ids.add(id);
    const label = textField(node.label, `node ${index + 1} label`, 64);
    const labelWordCount = label.match(/[\p{L}\p{N}]+(?:[’'ʻ-][\p{L}\p{N}]+)*/gu)?.length || 0;
    if (labelWordCount < 1 || labelWordCount > maxLabelWords) {
      throw new Error(`flowchart: node ${index + 1} label 1–${maxLabelWords} ta qisqa so'zdan iborat bo'lishi kerak`);
    }
    const kind = String(node.kind || "process").trim().toLowerCase();
    if (!FLOWCHART_KINDS.has(kind) || !template.allowedKinds.includes(kind)) {
      throw new Error(`flowchart: ${normalizedDiagramType} uchun noma'lum yoki mos bo'lmagan node turi (${kind || "bo'sh"})`);
    }
    const result = { id, label, kind };
    if (normalizedDiagramType === "automation_scheme" && ["sensor", "controller", "actuator"].includes(kind)) {
      const tag = String(node.tag || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
      if (!INSTRUMENT_TAG.test(tag)) throw new Error(`flowchart: node ${index + 1} uchun GOST 21.208 tag (masalan TE, PT, TIC, FV) kerak`);
      result.tag = tag;
    }
    if (normalizedDiagramType === "timeline_diagram") {
      const date = String(node.date || "").trim();
      if (!date || date.length > 24) throw new Error(`flowchart: voqea ${index + 1} uchun date (yil/davr, ≤24 belgi) kerak`);
      result.date = date;
    }
    return result;
  });

  const edgePairs = new Set();
  const edges = rawEdges.map((edge, index) => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      throw new Error(`flowchart: edge ${index + 1} obyekt bo'lishi kerak`);
    }
    const from = textField(edge.from, `edge ${index + 1} from`, 32);
    const to = textField(edge.to, `edge ${index + 1} to`, 32);
    if (!ids.has(from) || !ids.has(to)) throw new Error(`flowchart: edge ${index + 1} mavjud bo'lmagan nodega ulanadi`);
    if (from === to) throw new Error(`flowchart: edge ${index + 1} node o'ziga ulanmasin`);
    const pair = `${from}\u0000${to}`;
    if (edgePairs.has(pair)) throw new Error(`flowchart: takrorlangan aloqa (${from} → ${to})`);
    edgePairs.add(pair);
    const label = textField(edge.label == null ? "" : edge.label, `edge ${index + 1} label`, 32, false);
    return { from, to, label };
  });
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  if (normalizedDiagramType === "process_sequence" && edges.some(edge => nodeOrder.get(edge.from) >= nodeOrder.get(edge.to))) {
    throw new Error("flowchart: jarayon ketma-ketligida qirralar chapdan o'ngga, bajarilish tartibida bo'lsin");
  }
  if (normalizedDiagramType === "process_sequence") {
    const requiredPairs = nodes.slice(0, -1).map((node, index) => `${node.id}\u0000${nodes[index + 1].id}`);
    if (edges.length !== requiredPairs.length || requiredPairs.some(pair => !edgePairs.has(pair))) {
      throw new Error("flowchart: jarayon ketma-ketligida har qadam faqat bevosita keyingi tugunga ulansin");
    }
  }
  if (normalizedDiagramType === "functional_block_diagram") {
    const isLinearFlow = nodes[0].kind === "input" && nodes.at(-1).kind === "output"
      && nodes.slice(1, -1).every(node => node.kind === "process")
      && edges.length === nodes.length - 1
      && nodes.slice(0, -1).every((node, index) => edgePairs.has(`${node.id}\u0000${nodes[index + 1].id}`));
    const effect = nodes.at(-1);
    const isCauseEffect = nodes.length >= 3 && effect.kind === "output"
      && nodes.slice(0, -1).every(node => node.kind === "input")
      && edges.length === nodes.length - 1
      && edges.every(edge => edge.to === effect.id);
    if (!isLinearFlow && !isCauseEffect) {
      throw new Error("flowchart: funksional sxema faqat input→process→output zanjiri yoki sabablar→bitta natija fan-in bo'lsin");
    }
  }

  const outgoing = new Map([...ids].map(id => [id, []]));
  const undirected = new Map([...ids].map(id => [id, []]));
  edges.forEach(edge => {
    outgoing.get(edge.from).push(edge.to);
    undirected.get(edge.from).push(edge.to);
    undirected.get(edge.to).push(edge.from);
  });
  const visited = new Set();
  const visiting = new Set();
  const hasCycle = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of outgoing.get(id)) {
      if (hasCycle(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  const hasDirectedCycle = [...ids].some(hasCycle);
  if (hasDirectedCycle && !template.allowsCycles) throw new Error("flowchart: bu diagramma turida sikl bo'lmasin");
  const connected = new Set();
  const visitConnected = id => {
    if (connected.has(id)) return;
    connected.add(id);
    undirected.get(id).forEach(visitConnected);
  };
  if (!limits.disconnected) {
    visitConnected(nodes[0].id);
    if (connected.size !== nodes.length) throw new Error("flowchart: barcha node'lar bitta bog'langan chizmaga tegishli bo'lsin");
  }

  if (normalizedDiagramType === "algorithm_flowchart") {
    const starts = nodes.filter(node => node.kind === "start");
    const ends = nodes.filter(node => node.kind === "end");
    if (starts.length !== 1 || ends.length !== 1) throw new Error("flowchart: algoritmda bittadan start va end belgisi bo'lishi kerak");
    if (nodes[0].kind !== "start" || nodes.at(-1).kind !== "end") {
      throw new Error("flowchart: algoritm startdan boshlanib end bilan tugasin");
    }
    if (edges.some(edge => edge.to === starts[0].id) || !edges.some(edge => edge.to === ends[0].id)) {
      throw new Error("flowchart: algoritmda startga kiruvchi qirra bo'lmasin va endga kamida bitta kiruvchi qirra bo'lsin");
    }
    const reachableFromStart = new Set([starts[0].id]);
    const fromStartQueue = [starts[0].id];
    while (fromStartQueue.length) {
      for (const next of outgoing.get(fromStartQueue.shift())) {
        if (reachableFromStart.has(next)) continue;
        reachableFromStart.add(next);
        fromStartQueue.push(next);
      }
    }
    const incoming = new Map([...ids].map(id => [id, []]));
    edges.forEach(edge => incoming.get(edge.to).push(edge.from));
    const canReachEnd = new Set([ends[0].id]);
    const toEndQueue = [ends[0].id];
    while (toEndQueue.length) {
      for (const previous of incoming.get(toEndQueue.shift())) {
        if (canReachEnd.has(previous)) continue;
        canReachEnd.add(previous);
        toEndQueue.push(previous);
      }
    }
    if (nodes.some(node => !reachableFromStart.has(node.id) || !canReachEnd.has(node.id))) {
      throw new Error("flowchart: algoritmda barcha tugunlar startdan yetib boriladigan va endga olib boradigan yo'lda bo'lsin");
    }
    const decisions = nodes.filter(node => node.kind === "decision");
    if (decisions.length > 1) throw new Error("flowchart: ixcham algoritmda ko'pi bilan bitta qaror tuguni bo'lsin");
    for (const node of nodes) {
      const successors = edges.filter(edge => edge.from === node.id);
      if (node.kind === "end" ? successors.length !== 0 : node.kind !== "decision" && successors.length !== 1) {
        throw new Error("flowchart: qaror tugunidan tashqari har bir algoritm qadami bitta keyingi qadamga ulansin");
      }
    }
    for (const decision of nodes.filter(node => node.kind === "decision")) {
      const branches = edges.filter(edge => edge.from === decision.id);
      const branchLabels = new Set(branches.map(edge => edge.label.toLocaleLowerCase().replace(/[’‘`]/g, "'")));
      const hasYes = [...branchLabels].some(label => /^(ha|yes|true)$/.test(label));
      const hasNo = [...branchLabels].some(label => /^(yo'q|yo‘q|no|false)$/.test(label.replace(/’/g, "'")));
      if (branches.length !== 2 || !hasYes || !hasNo) throw new Error("flowchart: qaror tugunidan Ha va Yo'q deb belgilangan aynan ikki shox chiqsin");
    }
  }
  if (normalizedDiagramType === "pid_control_system") {
    const requiredKinds = ["input", "sum", "controller", "plant", "sensor"];
    if (requiredKinds.some(kind => nodes.filter(node => node.kind === kind).length !== 1)) {
      throw new Error("flowchart: PID diagrammasida input, sum, controller, plant va sensor bloklaridan bittadan bo'lsin");
    }
    const sumLabel = nodes.find(node => node.kind === "sum").label.replace(/\s+/g, "");
    if (!/^(?:Σ|∑|sum|\+)$/iu.test(sumLabel)) {
      throw new Error("flowchart: PID sum tuguni doirasiga sig'adigan ixcham 'Σ' yoki 'sum' belgisi bilan yozilsin");
    }
    if (!hasDirectedCycle) throw new Error("flowchart: PID tizimida sensorni summatorga qaytaruvchi yopiq teskari aloqa bo'lishi kerak");
    const byKind = new Map(nodes.map(node => [node.kind, node.id]));
    const requiredPairs = [
      ["input", "sum"], ["sum", "controller"], ["controller", "plant"], ["plant", "sensor"], ["sensor", "sum"],
    ];
    if (edges.length !== requiredPairs.length || requiredPairs.some(([fromKind, toKind]) => !edgePairs.has(`${byKind.get(fromKind)}\u0000${byKind.get(toKind)}`))) {
      throw new Error("flowchart: PID signal path input→sum→controller→plant→sensor→sum to'liq va ortiqcha qirrasiz bo'lishi shart");
    }
  }
  if (normalizedDiagramType === "uml_software_architecture") {
    const incomingCount = new Map(nodes.map(node => [node.id, 0]));
    edges.forEach(edge => incomingCount.set(edge.to, incomingCount.get(edge.to) + 1));
    const roots = nodes.filter(node => incomingCount.get(node.id) === 0);
    const isOrderedTree = roots.length === 1 && roots[0].id === nodes[0].id
      && edges.length === nodes.length - 1
      && nodes.slice(1).every(node => incomingCount.get(node.id) === 1)
      && edges.every(edge => nodeOrder.get(edge.from) < nodeOrder.get(edge.to));
    if (!isOrderedTree) throw new Error("flowchart: UML arxitektura bitta ildizli, yuqoridan pastga tartiblangan daraxt bo'lsin");
  }

  const kindCount = kind => nodes.filter(node => node.kind === kind).length;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edgeKinds = edge => `${byId.get(edge.from).kind}>${byId.get(edge.to).kind}`;
  if (normalizedDiagramType === "classification_tree") {
    if (nodes[0].kind !== "root" || kindCount("root") !== 1) throw new Error("flowchart: tasnif sxemasida birinchi tugun yagona root bo'lsin");
    if (kindCount("category") < 2 || kindCount("category") > 5) throw new Error("flowchart: tasnif sxemasida 2–5 ta category bo'lsin");
    const incomingTree = new Map(nodes.map(node => [node.id, 0]));
    edges.forEach(edge => incomingTree.set(edge.to, incomingTree.get(edge.to) + 1));
    if (nodes.slice(1).some(node => incomingTree.get(node.id) !== 1) || edges.some(edge => !["root>category", "category>item"].includes(edgeKinds(edge)))) {
      throw new Error("flowchart: tasnif daraxtida har tugunning bitta otasi bo'lsin (root→category→item)");
    }
    const itemsPerCategory = new Map();
    edges.filter(edge => edgeKinds(edge) === "category>item").forEach(edge => itemsPerCategory.set(edge.from, (itemsPerCategory.get(edge.from) || 0) + 1));
    if ([...itemsPerCategory.values()].some(count => count > 2)) throw new Error("flowchart: har category ostida ko'pi bilan 2 ta item bo'lsin");
  }
  if (normalizedDiagramType === "ishikawa_diagram") {
    if (kindCount("effect") !== 1 || kindCount("cause") < 3 || kindCount("cause") > 6) throw new Error("flowchart: Ishikava diagrammasida 1 effect va 3–6 cause bo'lsin");
    if (edges.some(edge => !["cause>effect", "factor>cause"].includes(edgeKinds(edge)))) throw new Error("flowchart: Ishikava qirralari faqat cause→effect va factor→cause bo'lsin");
    const causeLinks = new Set(edges.filter(edge => edgeKinds(edge) === "cause>effect").map(edge => edge.from));
    if (nodes.some(node => node.kind === "cause" && !causeLinks.has(node.id))) throw new Error("flowchart: har bir cause effect'ga ulansin");
    const factorCount = new Map();
    edges.filter(edge => edgeKinds(edge) === "factor>cause").forEach(edge => factorCount.set(edge.to, (factorCount.get(edge.to) || 0) + 1));
    if ([...factorCount.values()].some(count => count > 2)) throw new Error("flowchart: har cause'ga ko'pi bilan 2 ta factor ulansin");
    if (nodes.some(node => node.kind === "factor" && edges.filter(edge => edge.from === node.id).length !== 1)) throw new Error("flowchart: har factor bitta cause'ga ulansin");
  }
  if (normalizedDiagramType === "timeline_diagram" || normalizedDiagramType === "cycle_diagram") {
    const sequential = nodes.slice(0, -1).map((node, index) => `${node.id}\u0000${nodes[index + 1].id}`);
    const closing = `${nodes.at(-1).id}\u0000${nodes[0].id}`;
    const required = normalizedDiagramType === "cycle_diagram" ? [...sequential, closing] : sequential;
    if (edges.length !== required.length || required.some(pair => !edgePairs.has(pair))) {
      throw new Error(normalizedDiagramType === "cycle_diagram"
        ? "flowchart: sikl bosqichlari ketma-ket ulanib, oxirgisi birinchisiga qaytsin"
        : "flowchart: vaqt chizig'ida voqealar xronologik ketma-ket ulansin");
    }
  }
  if (normalizedDiagramType === "swot_matrix") {
    for (const kind of ["strength", "weakness", "opportunity", "threat"]) {
      if (kindCount(kind) < 1 || kindCount(kind) > 3) throw new Error(`flowchart: SWOT'da ${kind} guruhida 1–3 band bo'lsin`);
    }
  }
  if (normalizedDiagramType === "automation_scheme") {
    if (kindCount("equipment") !== 1 || kindCount("stream") < 1 || kindCount("stream") > 2 || kindCount("sensor") < 1 || kindCount("sensor") > 3
      || kindCount("controller") < 1 || kindCount("controller") > 2 || kindCount("actuator") > 2) {
      throw new Error("flowchart: avtomatlashtirish sxemasida 1 equipment, 1–2 stream, 1–3 sensor, 1–2 controller, 0–2 actuator bo'lsin");
    }
    const allowedLinks = ["stream>equipment", "equipment>stream", "equipment>sensor", "stream>sensor", "sensor>controller", "controller>actuator", "actuator>stream", "controller>controller"];
    if (edges.some(edge => !allowedLinks.includes(edgeKinds(edge)))) throw new Error("flowchart: avtomatlashtirish sxemasida aloqa turi noto'g'ri (stream↔equipment, equipment→sensor, sensor→controller, controller→actuator, actuator→stream)");
    if (nodes.some(node => node.kind === "sensor" && !edges.some(edge => edge.to === node.id))) throw new Error("flowchart: har sensor o'lchov joyiga (equipment yoki stream) ulansin");
    if (nodes.some(node => node.kind === "actuator" && !edges.some(edge => edge.from === node.id && byId.get(edge.to).kind === "stream"))) throw new Error("flowchart: har actuator (klapan) bitta stream quvuriga o'rnatilsin");
  }

  const totalTextLength = title.length + nodes.reduce((sum, node) => sum + node.label.length, 0)
    + edges.reduce((sum, edge) => sum + edge.label.length, 0);
  if (totalTextLength > 1100) throw new Error("flowchart: umumiy matn 1100 belgidan oshmasin");

  return { title, diagram_type: normalizedDiagramType, nodes, edges };
}

module.exports = {
  FLOWCHART_KINDS,
  FLOWCHART_MIN_NODES,
  FLOWCHART_MAX_NODES,
  normalizeFlowchartData,
  isUzbek,
  isRussian,
  localizeUzbekText,
  requiredUzbekTranslations,
  providedCaptionTranslation,
  buildFlowchartCaption,
  captionContainsUzbekEquivalent,
  isLikelyUzbekWord,
};
