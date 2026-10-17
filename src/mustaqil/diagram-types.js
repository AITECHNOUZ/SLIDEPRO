const GRAPHVIZ_DIAGRAM_TYPES = Object.freeze([
  "functional_block_diagram",
  "algorithm_flowchart",
  "pid_control_system",
  "uml_software_architecture",
  "process_sequence",
]);

const MATPLOTLIB_DIAGRAM_TYPES = Object.freeze([
  "mathematical_graph",
  "experiment_results",
]);

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
  GRAPHVIZ_DIAGRAM_TYPES,
  MATPLOTLIB_DIAGRAM_TYPES,
  ALL_DIAGRAM_TYPES,
  contextText,
  classifyGraphvizType,
  classifyMatplotlibType,
  isGraphvizDiagramType,
  isMatplotlibDiagramType,
};
