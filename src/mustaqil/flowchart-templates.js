const { GRAPHVIZ_DIAGRAM_TYPES, classifyGraphvizType, suitableSchematicTypes } = require("./diagram-types");

// GOST 19.701 (ISO 5807) shartli belgilari, GOST chizma qoidasi uslubida:
//   terminator (boshlash/tugatish) — yumaloq burchakli to'rtburchak, jarayon — to'rtburchak,
//   qaror — romb, ma'lumot (kiritish/chiqarish) — parallelogramm (och ko'k #bcd9ee maydon);
//   konturlar qora 1,8 pt, oqim strelkalari to'q ko'k #1f5fa6, soya/3D/bezaksiz.
const FLOWCHART_TEMPLATES = Object.freeze([
  {
    id: "functional_block_diagram",
    name: "Funksional blok-sxema",
    description: "Tizimning haqiqiy kirishlari, funksional bloklari va chiqishlarini chapdan o‘ngga ko‘rsatadi.",
    diagramType: "functional_block_diagram",
    direction: "chapdan o‘ngga, signal yoki axborot oqimi bo‘yicha",
    topologyGuidance: "Faqat mavzuda bor, aniq nomlangan funksional bloklarni tuz. Ikki ko‘rinishdan birini tanla: IPO/ishlash oqimi bo‘lsa input → 1–3 process → output tarzida bitta chapdan o‘ngga zanjir; sabab–oqibat bo‘lsa 2–4 haqiqiy input-sababni bitta output-natijaga bevosita ulab fan-in tuzilma qil. Sabab tugunlarini bir ustunga, natijani alohida ustunga joyla; teskari, sakrab o‘tuvchi, parallel yoki qo‘shimcha chirmashgan qirralarni qo‘shma. Jami 2–5 tugun; algoritmga xos start/end/qaror belgilarini ishlatma.",
    allowedKinds: ["input", "process", "output"],
    nodeAttrs: {
      input: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
      process: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      output: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
    },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=LR', 'splines=polyline', 'nodesep="0.30"', 'ranksep="0.55"', 'ordering=out', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: false,
  },
  {
    id: "algorithm_flowchart",
    name: "Algoritm blok-sxemasi",
    description: "Standart boshlash/tugatish, amal va zarur qaror belgilariga ega yuqoridan pastga algoritm.",
    diagramType: "algorithm_flowchart",
    direction: "yuqoridan pastga, bajarilish tartibi bo‘yicha",
    topologyGuidance: "Algoritmning mavzuga oid haqiqiy bajarilish amallarini qisqa yoz. Start node birinchi, end node oxirgi bo‘lsin; kiritish/chiqarish bo‘lsa parallelogram, hisoblash/amal bo‘lsa to‘rtburchak, shart faqat haqiqatan kerak bo‘lsa romb ishlat. Ixcham chizmada ko‘pi bilan bitta qaror tuguni bo‘lsin; undan chiqadigan aynan ikki shoxni Ha/Yo‘q yoki true/false deb belgila, keyingi amallarni qaror shoxlaridan tartibli pastga joyla. Ortiqcha, sakrab o‘tuvchi yoki bir-birini kesadigan qirralarni qo‘shma. Ko‘pi bilan 5 tugun; o‘qish yo‘nalishi yuqoridan pastga bo‘lsin. Word sahifasidagi yakuniy tasvirni 1.92 × 3.45 dyuymga mosla; matnlar shu ixcham maydonga sig‘sin va faqat mavzuga oid bo‘lsin.",
    allowedKinds: ["start", "end", "process", "decision", "input", "output"],
    nodeAttrs: {
      start: 'shape=box, style="rounded,filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      end: 'shape=box, style="rounded,filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      process: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      decision: 'shape=diamond, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8, margin="0.06,0.04"',
      input: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
      output: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
    },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=TB', 'splines=polyline', 'nodesep="0.28"', 'ranksep="0.48"', 'ordering=out', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: true,
  },
  {
    id: "pid_control_system",
    name: "PID boshqaruv tizimi",
    description: "Topshiriq, jamlash nuqtasi, PID rostlagich, boshqaruv obyekti va sensor teskari aloqasidan iborat yopiq kontur.",
    diagramType: "pid_control_system",
    direction: "chapdan o‘ngga, teskari aloqa konturi bilan",
    topologyGuidance: "Aynan 5 ta mavzuga oid blok tuz: topshiriq signali (input), xatolikni hisoblovchi jamlash nuqtasi (sum), PID rostlagich (controller), boshqaruv obyekti (plant), o‘lchov beruvchi sensor (sensor). Doira shaklidagi sum tuguni ichiga faqat bitta ixcham Σ belgisini yoz; uzun matnni doiraga joylama. Oldinga signalni input → sum → controller → plant → sensor bo‘yicha bitta gorizontal qatorda joyla; sensorning teskari aloqa qirrasini tugunlar ostidan alohida qaytarib sum ga ulang. Bevosita qo‘shimcha qirra, keraksiz blok, umumiy yorliq yoki algoritm qaror belgisi qo‘shma.",
    allowedKinds: ["input", "sum", "controller", "plant", "sensor"],
    nodeAttrs: {
      input: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
      sum: 'shape=circle, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8, width=0.62, height=0.62, fixedsize=true',
      controller: 'shape=box, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
      plant: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      sensor: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
    },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=LR', 'splines=curved', 'nodesep="0.34"', 'ranksep="0.58"', 'ordering=out', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: true,
  },
  {
    id: "uml_software_architecture",
    name: "UML va dastur arxitekturasi",
    description: "Dastur komponentlari, klasslari, interfeyslari va ma’lumotlar ombori orasidagi nomlangan bog‘lanishlar.",
    diagramType: "uml_software_architecture",
    direction: "yuqoridan pastga, tizim qatlamlari va meros/qaramlik munosabatlari bo‘yicha",
    topologyGuidance: "Faqat mavzudagi haqiqiy dasturiy komponent, klass, interfeys, ishtirokchi yoki ma’lumotlar ombori elementlarini ko‘rsat. UML munosabatlarini depends on, implements, calls, reads, writes kabi qisqa nom bilan ber. Chizma bitta ildizli, yuqoridan pastga yo‘nalgan daraxt bo‘lsin; aka-uka modullarni bir qatorda joyla, har tugun faqat bitta yuqori modulga ulangan bo‘lsin. Kesishuvchi, qaytuvchi yoki mavzuga aloqasiz qirralarni qo‘shma; jami 2–5 element. Dastur arxitekturasi bo‘lmagan mavzuda bu turdan foydalanma.",
    allowedKinds: ["component", "class", "interface", "database", "actor"],
    nodeAttrs: {
      component: 'shape=component, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      class: 'shape=record, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      interface: 'shape=box, style="dashed", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      database: 'shape=cylinder, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
      actor: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
    },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=TB', 'splines=polyline', 'nodesep="0.34"', 'ranksep="0.58"', 'compound=true', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: false,
  },
  {
    id: "process_sequence",
    name: "Jarayonlar ketma-ketligi",
    description: "Mavzuga xos jarayon qadamlari va ularning chapdan o‘ngga bajarilish tartibi.",
    diagramType: "process_sequence",
    direction: "chapdan o‘ngga, vaqt yoki bajarilish tartibi bo‘yicha",
    topologyGuidance: "Haqiqiy jarayon qadamlarini vaqt/bajarilish tartibida chapdan o‘ngga joyla. Har tugun bitta mazmunli, mavzuga xos qadam yoki ishtirokchini ifodalasin; har qirra faqat bevosita keyingi tugunga ulansin va barcha qadamlar bitta sodda zanjir hosil qilsin. Qadamlarni sakrab bog‘laydigan, teskari, parallel yoki qo‘shimcha qaytuvchi qirralarni qo‘shma — ular o‘qlarni chirmashtiradi. Algoritm bo‘lmasa start/end/decision belgilarini ishlatma; bosqich nomlarini takrorlama va ortiqcha qadam to‘qima. 2–5 ta element yetarli.",
    allowedKinds: ["step", "input", "output"],
    nodeAttrs: {
      step: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8',
      input: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
      output: 'shape=parallelogram, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8',
    },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=LR', 'splines=polyline', 'nodesep="0.30"', 'ranksep="0.55"', 'ordering=out', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: false,
  },
  // ── Qo'shimcha GOST sxema turlari (gost-schematic.py chizadi; Graphviz — faqat zaxira) ──
  {
    id: "classification_tree",
    name: "Klassifikatsiya (tasnif) sxemasi",
    description: "Tushuncha yoki obyektning turlari/tarkibiy qismlarini ierarxik daraxt ko'rinishida ko'rsatadi.",
    diagramType: "classification_tree",
    direction: "yuqoridan pastga yoki chapdan o'ngga, umumiydan xususiyga",
    topologyGuidance: "Bitta root (tasniflanayotgan tushuncha) birinchi tugun bo'lsin; undan 2–5 ta category (asosiy turlar/belgilar) chiqsin; har category ostida 0–2 ta item (aniq misol yoki kichik tur) bo'lishi mumkin. Qirralar faqat ota → bola (root→category, category→item). Turlar mavzuga xos, haqiqiy tasnif bo'lsin.",
    allowedKinds: ["root", "category", "item"],
    limits: { minNodes: 4, maxNodes: 12, minEdges: 3, maxEdges: 11, maxLabelWords: 5 },
    limitsText: "4–12 tugun (1 root, 2–5 category, har category ostida 0–2 item), qirralar faqat ota→bola",
    example: {"nodes": [{"id": "root", "label": "...", "kind": "root"}, {"id": "c1", "label": "...", "kind": "category"}, {"id": "c2", "label": "...", "kind": "category"}, {"id": "i1", "label": "...", "kind": "item"}, {"id": "i2", "label": "...", "kind": "item"}], "edges": [{"from": "root", "to": "c1", "label": ""}, {"from": "root", "to": "c2", "label": ""}, {"from": "c1", "to": "i1", "label": ""}, {"from": "c2", "to": "i2", "label": ""}]},
    nodeAttrs: { root: 'shape=box, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8', category: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8', item: 'shape=box, style="rounded,filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8' },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=TB', 'splines=ortho', 'nodesep="0.25"', 'ranksep="0.45"', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.4', 'arrowsize=0.7', 'arrowhead=normal'],
    allowsCycles: false,
  },
  {
    id: "ishikawa_diagram",
    name: "Sabab-oqibat (Ishikava) diagrammasi",
    description: "Natija/muammoga ta'sir etuvchi sabablar guruhlari va ularning omillarini \"baliq suyagi\" shaklida ko'rsatadi.",
    diagramType: "ishikawa_diagram",
    direction: "chapdan o'ngga, sabablardan natijaga",
    topologyGuidance: "Bitta effect (natija yoki muammo) bo'lsin; 3–6 ta cause (sabablar guruhi: masalan, uskuna, usul, material, inson, muhit, o'lchash) har biri effect'ga ulansin; har cause'ga 0–2 ta factor (aniq omil) ulanishi mumkin (factor→cause). Faqat mavzuga xos sabab va omillarni yoz.",
    allowedKinds: ["effect", "cause", "factor"],
    limits: { minNodes: 4, maxNodes: 15, minEdges: 3, maxEdges: 14, maxLabelWords: 5 },
    limitsText: "1 effect, 3–6 cause (cause→effect), har cause'ga 0–2 factor (factor→cause), jami ≤15 tugun",
    example: {"nodes": [{"id": "effect", "label": "...", "kind": "effect"}, {"id": "c1", "label": "...", "kind": "cause"}, {"id": "c2", "label": "...", "kind": "cause"}, {"id": "c3", "label": "...", "kind": "cause"}, {"id": "f1", "label": "...", "kind": "factor"}], "edges": [{"from": "c1", "to": "effect", "label": ""}, {"from": "c2", "to": "effect", "label": ""}, {"from": "c3", "to": "effect", "label": ""}, {"from": "f1", "to": "c1", "label": ""}]},
    nodeAttrs: { effect: 'shape=box, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8', cause: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8', factor: 'shape=plaintext' },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=LR', 'splines=polyline', 'nodesep="0.2"', 'ranksep="0.5"', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.4', 'arrowsize=0.7', 'arrowhead=normal'],
    allowsCycles: false,
  },
  {
    id: "timeline_diagram",
    name: "Vaqt chizig'i (xronologiya)",
    description: "Voqealar, rivojlanish bosqichlari yoki davrlarni xronologik tartibda ko'rsatadi.",
    diagramType: "timeline_diagram",
    direction: "chapdan o'ngga yoki yuqoridan pastga, vaqt bo'yicha",
    topologyGuidance: "3–7 ta event tugun xronologik tartibda; har birida \"date\" maydoni (yil, davr yoki sana: \"1991\", \"XIV asr\", \"2010–2015\") va qisqa label (voqea/bosqich mazmuni). Qirralar ketma-ket: 1→2→3... Sanalar va voqealar faqat ishonchli, umumma'lum bo'lsin.",
    allowedKinds: ["event"],
    limits: { minNodes: 3, maxNodes: 7, minEdges: 2, maxEdges: 6, maxLabelWords: 6 },
    limitsText: "3–7 event, har birida date maydoni, qirralar ketma-ket",
    example: {"nodes": [{"id": "e1", "label": "...", "kind": "event", "date": "1991-y."}, {"id": "e2", "label": "...", "kind": "event", "date": "2005-y."}, {"id": "e3", "label": "...", "kind": "event", "date": "2020-y."}], "edges": [{"from": "e1", "to": "e2", "label": ""}, {"from": "e2", "to": "e3", "label": ""}]},
    nodeAttrs: { event: 'shape=box, style="filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8' },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=LR', 'splines=polyline', 'nodesep="0.25"', 'ranksep="0.4"', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: false,
  },
  {
    id: "cycle_diagram",
    name: "Siklik jarayon diagrammasi",
    description: "Qaytariladigan (davriy) jarayon bosqichlarini yopiq aylana ko'rinishida ko'rsatadi.",
    diagramType: "cycle_diagram",
    direction: "soat mili bo'yicha aylana",
    topologyGuidance: "3–6 ta stage tugun jarayon tartibida; qirralar ketma-ket (1→2→…→n) va oxirgisidan birinchisiga qaytuvchi (n→1). Faqat haqiqatan davriy takrorlanadigan jarayon uchun tanla (masalan, moddalar aylanishi, ishlab chiqarish sikli, PDCA).",
    allowedKinds: ["stage"],
    limits: { minNodes: 3, maxNodes: 6, minEdges: 3, maxEdges: 6, maxLabelWords: 4 },
    limitsText: "3–6 stage, ketma-ket qirralar va oxirgisidan birinchisiga qaytish",
    example: {"nodes": [{"id": "s1", "label": "...", "kind": "stage"}, {"id": "s2", "label": "...", "kind": "stage"}, {"id": "s3", "label": "...", "kind": "stage"}, {"id": "s4", "label": "...", "kind": "stage"}], "edges": [{"from": "s1", "to": "s2", "label": ""}, {"from": "s2", "to": "s3", "label": ""}, {"from": "s3", "to": "s4", "label": ""}, {"from": "s4", "to": "s1", "label": ""}]},
    nodeAttrs: { stage: 'shape=box, style="rounded,filled", fillcolor="#FFFFFF", color="#000000", penwidth=1.8' },
    layoutEngine: "circo",
    graphAttrs: ['splines=curved', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.6', 'arrowsize=0.8', 'arrowhead=normal'],
    allowsCycles: true,
  },
  {
    id: "swot_matrix",
    name: "SWOT tahlil matritsasi",
    description: "Kuchli va kuchsiz tomonlar, imkoniyatlar va tahdidlarni 2×2 matritsada ko'rsatadi.",
    diagramType: "swot_matrix",
    direction: "2×2 matritsa",
    topologyGuidance: "To'rt guruh: strength (kuchli tomonlar), weakness (kuchsiz tomonlar), opportunity (imkoniyatlar), threat (tahdidlar); har guruhda 1–3 ta qisqa band. Qirralar kerak emas (edges: []). Bandlar mavzuga xos, aniq bo'lsin.",
    allowedKinds: ["strength", "weakness", "opportunity", "threat"],
    limits: { minNodes: 4, maxNodes: 12, minEdges: 0, maxEdges: 0, maxLabelWords: 6, disconnected: true },
    limitsText: "har guruhda (strength, weakness, opportunity, threat) 1–3 band, edges bo'sh massiv",
    example: {"nodes": [{"id": "s1", "label": "...", "kind": "strength"}, {"id": "w1", "label": "...", "kind": "weakness"}, {"id": "o1", "label": "...", "kind": "opportunity"}, {"id": "t1", "label": "...", "kind": "threat"}], "edges": []},
    nodeAttrs: { strength: 'shape=box', weakness: 'shape=box', opportunity: 'shape=box', threat: 'shape=box' },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=TB', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"'],
    allowsCycles: false,
  },
  {
    id: "automation_scheme",
    name: "Funksional avtomatlashtirish sxemasi (GOST 21.208)",
    description: "Texnologik obyekt, oqimlar, o'lchov asboblari, rostlagichlar va ijro mexanizmlarini GOST 21.208 shartli belgilari bilan ko'rsatadi.",
    diagramType: "automation_scheme",
    direction: "pastda texnologik obyekt va quvurlar, yuqorida boshqaruv shiti",
    topologyGuidance: "1 ta equipment (texnologik apparat: pech, qozon, rezervuar, nasos...), 1–2 ta stream (kiruvchi/chiquvchi oqim: \"Tabiiy gaz\", \"Suv\"), 1–3 ta sensor, 1–2 ta controller, 0–2 ta actuator. sensor, controller va actuator uchun \"tag\" maydoni majburiy — GOST 21.208 harfli belgisi: birinchi harf o'lchanadigan kattalik (T harorat, P bosim, F sarf, L sath, Q tarkib/sifat, H qo'lda), keyingilari funksiya (E datchik, I ko'rsatish, R qayd, C rostlash, S ulash, A signal, V klapan/ijro); masalan TE, PT, TIC, FIC, LV. Qirralar: stream→equipment yoki equipment→stream (texnologik oqim), equipment→sensor (o'lchov olinadigan joy), sensor→controller (signal), controller→actuator (boshqaruv signali), actuator→stream (klapan shu quvurda).",
    allowedKinds: ["equipment", "stream", "sensor", "controller", "actuator"],
    limits: { minNodes: 4, maxNodes: 10, minEdges: 3, maxEdges: 12, maxLabelWords: 4 },
    limitsText: "1 equipment, 1–2 stream, 1–3 sensor, 1–2 controller, 0–2 actuator; sensor/controller/actuator uchun tag (TE, PT, TIC, FV...) majburiy",
    example: {"nodes": [{"id": "in", "label": "...", "kind": "stream"}, {"id": "eq", "label": "...", "kind": "equipment"}, {"id": "out", "label": "...", "kind": "stream"}, {"id": "te", "label": "...", "kind": "sensor", "tag": "TE"}, {"id": "tic", "label": "...", "kind": "controller", "tag": "TIC"}, {"id": "tv", "label": "...", "kind": "actuator", "tag": "TV"}], "edges": [{"from": "in", "to": "eq", "label": ""}, {"from": "eq", "to": "out", "label": ""}, {"from": "eq", "to": "te", "label": ""}, {"from": "te", "to": "tic", "label": ""}, {"from": "tic", "to": "tv", "label": ""}, {"from": "tv", "to": "in", "label": ""}]},
    nodeAttrs: { equipment: 'shape=box, style="filled", fillcolor="#bcd9ee", color="#000000", penwidth=1.8', stream: 'shape=plaintext', sensor: 'shape=circle, color="#000000", penwidth=1.8', controller: 'shape=circle, color="#000000", penwidth=1.8', actuator: 'shape=invtriangle, color="#000000", penwidth=1.8' },
    layoutEngine: "dot",
    graphAttrs: ['rankdir=BT', 'splines=ortho', 'nodesep="0.35"', 'ranksep="0.5"', 'bgcolor="white"'],
    edgeAttrs: ['color="#1f5fa6"', 'penwidth=1.2', 'arrowsize=0.7', 'arrowhead=normal'],
    allowsCycles: true,
  },
]);

const FLOWCHART_TEMPLATE_BY_ID = new Map(FLOWCHART_TEMPLATES.map(template => [template.id, template]));

function getFlowchartTemplate(templateId) {
  return FLOWCHART_TEMPLATE_BY_ID.get(String(templateId || "")) || FLOWCHART_TEMPLATE_BY_ID.get("functional_block_diagram");
}

/**
 * Har bir sxema sloti uchun tur tanlash:
 *   1) rejada (LLM) aniq ko'rsatilgan tur — agar shu ishda hali ishlatilmagan bo'lsa;
 *   2) aks holda mavzuga mos turlar ro'yxatidan (suitableSchematicTypes) ishlatilmaganlari
 *      orasidan TASODIFIY (eng mos 3 tasi ustuvor) — ketma-ket buyurtmalarda ham har xil chiqadi.
 */
function selectFlowchartTemplates(contextsOrCount, random = Math.random) {
  const contexts = Array.isArray(contextsOrCount)
    ? contextsOrCount
    : Array.from({ length: Math.max(0, Math.floor(Number(contextsOrCount) || 0)) }, () => ({}));
  const rand = typeof random === "function" ? random : Math.random;
  const used = new Set();
  return contexts.map(context => {
    const plan = context?.plan && typeof context.plan === "object" ? context.plan : {};
    const explicit = (plan.auto_type || context?.auto_type ? [] : [context?.diagram_type, context?.diagramType, plan.diagram_type, plan.diagramType])
      .map(value => String(value || "").trim()).find(value => FLOWCHART_TEMPLATE_BY_ID.has(value));
    let type = explicit && !used.has(explicit) ? explicit : null;
    if (!type) {
      const classified = classifyGraphvizType(context);
      const suitable = suitableSchematicTypes(context).filter(candidate => !used.has(candidate) && candidate !== classified);
      if (!used.has(classified)) suitable.unshift(classified);
      const top = suitable.slice(0, 3);
      type = top.length ? top[Math.floor(rand() * top.length) % top.length] : classified;
    }
    used.add(type);
    return getFlowchartTemplate(type);
  });
}

module.exports = {
  FLOWCHART_TEMPLATES,
  FLOWCHART_TEMPLATE_BY_ID,
  GRAPHVIZ_DIAGRAM_TYPES,
  getFlowchartTemplate,
  selectFlowchartTemplates,
};
