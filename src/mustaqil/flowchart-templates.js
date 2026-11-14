const { GRAPHVIZ_DIAGRAM_TYPES, classifyGraphvizType } = require("./diagram-types");

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
]);

const FLOWCHART_TEMPLATE_BY_ID = new Map(FLOWCHART_TEMPLATES.map(template => [template.id, template]));

function getFlowchartTemplate(templateId) {
  return FLOWCHART_TEMPLATE_BY_ID.get(String(templateId || "")) || FLOWCHART_TEMPLATE_BY_ID.get("functional_block_diagram");
}

function selectFlowchartTemplates(contextsOrCount) {
  const contexts = Array.isArray(contextsOrCount)
    ? contextsOrCount
    : Array.from({ length: Math.max(0, Math.floor(Number(contextsOrCount) || 0)) }, () => ({}));
  // Bir ishda bir xil sxema turi takrorlanmasin: takror bo'lsa, ishlatilmagan mos turga almashtiriladi.
  const ALTERNATIVES = ["process_sequence", "algorithm_flowchart", "functional_block_diagram", "pid_control_system", "uml_software_architecture"];
  const used = new Set();
  return contexts.map(context => {
    let type = classifyGraphvizType(context);
    if (used.has(type)) {
      const control = /rostla|boshqar|regul|control|pid|avtomat/i.test(`${context.topic || ""} ${context.chapterTitle || ""} ${context.planTitle || ""}`);
      const software = /dastur|software|tizim arxitektura|server|ma'lumotlar bazasi|database|web|ilova/i.test(`${context.topic || ""} ${context.chapterTitle || ""}`);
      const alternative = ALTERNATIVES
        .filter(candidate => (candidate !== "pid_control_system" || control) && (candidate !== "uml_software_architecture" || software))
        .find(candidate => !used.has(candidate));
      if (alternative) type = alternative;
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
