const GRAPHVIZ_DIAGRAM_TYPES = Object.freeze([
  "functional_block_diagram",
  "algorithm_flowchart",
  "pid_control_system",
  "uml_software_architecture",
  "process_sequence",
  // GOST sxema rendereri (gost-schematic.py) qo'shimcha turlari
  "classification_tree",
  "ishikawa_diagram",
  "timeline_diagram",
  "cycle_diagram",
  "swot_matrix",
  "automation_scheme",
]);

// Mavzuga mos sxema turlari (mos kelish darajasi bo'yicha). Har bir ishda shu ro'yxatdan
// takrorlanmaydigan va tasodifiy tanlanadi — ketma-ket buyurtmalarda ham har xil sxemalar chiqadi.
const SCHEMATIC_RULES = [
  { type: "automation_scheme", re: /avtomatlashtir|avtomatizats|automation|автоматизац|texnologik jarayon|rostla|regul|kip\b|o'lchov asbob|datchik|kontroller|plc|scada/ },
  { type: "pid_control_system", re: /\bpid\b|rostlagich|rostlash|regulyator|boshqaruv tizimi|teskari aloqa|control system|feedback/ },
  { type: "algorithm_flowchart", re: /algoritm|algorithm|dastur|programm|hisoblash usuli|qaror qabul/ },
  { type: "uml_software_architecture", re: /dasturiy|software|web|ilova|ma'lumotlar bazasi|database|axborot tizimi|server|arxitektur/ },
  { type: "timeline_diagram", re: /tarix|history|davr|asr|yillar|rivojlanish bosqich|evolyutsiya|xronolog|история/ },
  { type: "classification_tree", re: /turlari|tasnif|klassifik|classification|toifa|sinflar|navlar|xillari|tarkibi|tuzilishi|виды|классификац/ },
  { type: "ishikawa_diagram", re: /sabab|omillar|omil|muammo|sifat|nuqson|xavf|risk|yo'qotish|ta'sir etuvchi|причин|фактор/ },
  { type: "cycle_diagram", re: /sikl|aylan|davriy|hayot sikli|qayta ishlash|ekolog|biolog|cycle|kruговорот|цикл/ },
  { type: "swot_matrix", re: /swot|raqobat|strategiya|biznes|marketing|menejment|iqtisod|tadbirkor|investitsiya|bozor|turizm|стратег|бизнес/ },
  { type: "process_sequence", re: /jarayon|bosqich|texnologiya|ishlab chiqarish|tayyorlash|ketma[\s-]?ket|процесс|этап/ },
  { type: "functional_block_diagram", re: /tizim|qurilma|tarkib|funksional|blok|system|device|устройств/ },
];
// Har qanday mavzuga mos keladigan universal turlar (gumanitar mavzular ham)
const UNIVERSAL_SCHEMATICS = ["classification_tree", "process_sequence", "functional_block_diagram", "ishikawa_diagram", "cycle_diagram"];

function suitableSchematicTypes(context = {}) {
  const text = contextText(context);
  const matched = SCHEMATIC_RULES.filter(rule => rule.re.test(text)).map(rule => rule.type);
  return [...new Set([...matched, ...UNIVERSAL_SCHEMATICS])];
}

const MATPLOTLIB_DIAGRAM_TYPES = Object.freeze([
  "mathematical_graph",
  "experiment_results",
  "scatter_trend",
  "stacked_bar",
  "horizontal_bar",
  "dual_axis",
  "histogram",
]);

// Qo'shimcha grafik turlari: diagram_type → chartType
const EXTRA_CHART_KINDS = Object.freeze({
  scatter_trend: "scatter",
  stacked_bar: "stacked_bar",
  horizontal_bar: "barh",
  dual_axis: "dual_axis",
  histogram: "histogram",
});

const CHART_RULES = [
  { type: "scatter_trend", re: /bog'liqlig|bog‘liqlig|korrelyats|regress|ta'siri|ta‘siri|o'zaro aloqa|dependence|correlat|zависим|корреляц/ },
  { type: "histogram", re: /taqsimot|chastota|statistik|dispersiya|og'ish|xatolik|distribution|histogram|frequency|распредел|частот/ },
  { type: "stacked_bar", re: /tarkib|struktura|ulush|manbalar bo'yicha|composition|share|структур|доля/ },
  { type: "horizontal_bar", re: /reyting|taqqos|solishtir|hudud|viloyat|mamlakat|davlatlar|usullar|ranking|compar|сравн|регион/ },
  { type: "dual_axis", re: /dinamika|samaradorlik|xarajat|sarf|ishlab chiqarish|yillar|oylar|dynamics|динамик|затрат/ },
];

function suitableChartTypes(context = {}) {
  const text = contextText(context);
  const matched = CHART_RULES.filter(rule => rule.re.test(text)).map(rule => rule.type);
  return [...new Set([...matched, "horizontal_bar", "dual_axis", "stacked_bar", "scatter_trend", "histogram"])];
}

const ALL_DIAGRAM_TYPES = new Set([...GRAPHVIZ_DIAGRAM_TYPES, ...MATPLOTLIB_DIAGRAM_TYPES]);

function contextText(context = {}) {
  const plan = context.plan && typeof context.plan === "object" ? context.plan : {};
  const values = [
    context.topic,
    context.chapterTitle,
    context.sectionTitle,
    context.planTitle,
    context.purpose,
    context.caption,
    context.variable,
    context.title,
    plan.title,
    plan.purpose,
    plan.variable,
    plan.caption,
  ];
  return values.filter(value => typeof value === "string" && value.trim())
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’‘`]/g, "'");
}

function explicitType(context, allowed) {
  const plan = context?.plan && typeof context.plan === "object" ? context.plan : {};
  const type = String(context?.diagram_type || context?.diagramType || plan.diagram_type || plan.diagramType || "").trim();
  return allowed.includes(type) ? type : null;
}

function classifyGraphvizType(context = {}) {
  const specified = explicitType(context, GRAPHVIZ_DIAGRAM_TYPES);
  if (specified) return specified;
  const text = contextText(context);

  if (/\b(?:algorithm|algoritm|pseudocode|psevdokod)\b|algoritmik/.test(text)) {
    return "algorithm_flowchart";
  }
  if (/\bpid\b|pid[- ]?rostlagich|pid[- ]?controller|proporsional.{0,24}integral.{0,24}differensial/.test(text)) {
    return "pid_control_system";
  }
  if (/\buml\b|class diagram|klass diagram|software architecture|dasturiy? arxitektur|dastur arxitektur|component diagram|komponent arxitektur/.test(text)) {
    return "uml_software_architecture";
  }
  if (/process sequence|jarayonlar? ketma[\s-]?ket|bosqichlar? ketma[\s-]?ket|bosqichma[\s-]?bosqich|ketma[\s-]?ket|sequence diagram|\bworkflow\b|process flow|jarayon oqimi|jarayonlar oqimi|early warning|early detection|siyosat paketini.{0,32}tanlash/.test(text)) {
    return "process_sequence";
  }
  if (/functional block|funksional blok|block diagram|blok diagram|boshqaruv tizimi|control system|closed[- ]loop|yopiq kontur/.test(text)) {
    return "functional_block_diagram";
  }
  if (/blok[\s-]?sxema|flowchart/.test(text)) return "algorithm_flowchart";
  if (/klassifik|tasnif|turlari|classification|daraxt/.test(text)) return "classification_tree";
  if (/ishikawa|baliq suyagi|fishbone|sabab[\s-]?oqibat/.test(text)) return "ishikawa_diagram";
  if (/timeline|vaqt chizig|xronolog|tarixiy bosqich/.test(text)) return "timeline_diagram";
  if (/\bsikl\b|siklik|aylanma jarayon|cycle/.test(text)) return "cycle_diagram";
  if (/\bswot\b/.test(text)) return "swot_matrix";
  if (/funksional avtomatlashtirish|avtomatlashtirish sxema|kip sxema|p&id|automation scheme/.test(text)) return "automation_scheme";
  return "functional_block_diagram";
}

function classifyMatplotlibType(context = {}) {
  const specified = explicitType(context, MATPLOTLIB_DIAGRAM_TYPES);
  if (specified) return specified;
  const text = contextText(context);
  if (/tajriba|eksperiment|experimental|experiment|laboratoriya|laboratory|lab results|sinov natija|tajriba natija|o'lchov natija|measurement results/.test(text)) {
    return "experiment_results";
  }
  if (/matematik|mathemat|function graph|funksiya grafig|parabola|sinus|cosinus|tenglama grafig|matematik grafik|mathematical graph|plot of|grafik chiz/.test(text)) {
    return "mathematical_graph";
  }
  return null;
}

function isGraphvizDiagramType(value) {
  return GRAPHVIZ_DIAGRAM_TYPES.includes(String(value || ""));
}

function isMatplotlibDiagramType(value) {
  return MATPLOTLIB_DIAGRAM_TYPES.includes(String(value || ""));
}

module.exports = {
  suitableSchematicTypes,
  GRAPHVIZ_DIAGRAM_TYPES,
  MATPLOTLIB_DIAGRAM_TYPES,
  EXTRA_CHART_KINDS,
  suitableChartTypes,
  ALL_DIAGRAM_TYPES,
  contextText,
  classifyGraphvizType,
  classifyMatplotlibType,
  isGraphvizDiagramType,
  isMatplotlibDiagramType,
};
