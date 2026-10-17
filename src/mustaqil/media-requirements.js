const MIN_DIAGRAM_COUNT = 3;

function normalizeTopic(topic) {
  return String(topic || "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const HIGHLY_QUANTITATIVE_TOPIC = /(?:matematik|mathemat|algebra|geometri|hisoblash|calculus|fizik|physics|kimyo|chemistry|muhandis|engineering|elektr(?:ik|on)?|mexanik|mechanic|avtomatik boshqaruv|control system|uzatish funksi|differensial tenglama|algoritm|algorithm|dasturlash|programming|kompyuter fan|computer science|sun'iy intellekt|artificial intelligence|machine learning|mashinaviy o'rganish|data science|ma'lumotlar tahlil|statistik|statistics|statistika|ekonometr|econometr|iqtisod|econom|moliya|finance|buxgalter|accounting|optimallashtirish|optimization|ehtimollar nazariyasi|probability|regressiya|regression|miqdoriy|quantitative|matematik model|математик|математическ|алгебр|геометр|вычислен|физик|физическ|хими|инженер|электр|механ|автоматическ.{0,20}управлен|передаточн.{0,15}функци|дифференциальн.{0,15}уравнен|алгоритм|программирован|компьютерн наук|искусственн интеллект|машинн обучен|анализ данных|статист|эконом|финанс|бухгалтер|оптимизац|теори вероятност|регресси|количествен|математическ модел)/i;

// Narrow but multilingual signals for interdisciplinary topics that a plain
// keyword list often misses. These are computation/modeling methods or domains
// with inherently quantitative objects, not broad labels such as "biology".
const ADDITIONAL_QUANTITATIVE_TOPIC = /(?:quantum|kvant|квант|robotic|robototex|робототех|bioinformat|биоинформат|biostatistic|biostatistik|биостатист|genomic|genomik|геном|molecular model|molekulyar model|molekulyar dinam|молекулярн.{0,12}модел|pharmacokinetic|farmakokinet|фармакокинет|epidemiolog|эпидемиолог|population dynamic|populyatsion dinamik|популяционн.{0,12}динамик|corpus lingu|korpus ling|korpus tahlil|цифров.{0,12}гуманитар|digital humanities|computational lingu|hisoblash tilshunos|tabiiy tilni qayta ishlash|natural language processing|text mining|matnni avtomatik tahlil|sentiment analys|sentiment tahlil|raqamli filolog|cryptograph|kriptograf|криптограф|game theory|o'yinlar nazariyasi|теори игр|graph theory|graflar nazariyasi|teoriya grafov|aerodynamic|aerodinam|термодинамик|thermodynamic|termodinamik|fluid dynamic|gidrodinamik|гидродинамик|signal processing|signalni qayta ishlash|telecommunication|telekommunik|телекоммуникац)/i;

function inferredFormulaQuota(chapterLimit, topic) {
  const normalizedTopic = normalizeTopic(topic);
  if (chapterLimit === 0 || !(HIGHLY_QUANTITATIVE_TOPIC.test(normalizedTopic) || ADDITIONAL_QUANTITATIVE_TOPIC.test(normalizedTopic))) return 0;
  return Math.min(chapterLimit, Math.max(1, Math.ceil(chapterLimit / 2)));
}

function resolveFormulaQuota(mainChapterCount, { formulaCount = null, topic = "" } = {}) {
  const chapterLimit = Math.max(0, Math.floor(Number(mainChapterCount) || 0));
  const inferred = inferredFormulaQuota(chapterLimit, topic);
  if (formulaCount == null) return inferred;
  const value = Number(formulaCount);
  return Math.max(0, Number.isFinite(value) ? Math.floor(value) : inferred);
}

function resolveDiagramQuotas(mainChapterCount, { flowchartCount = null, chartCount = null } = {}) {
  const chapterLimit = Math.max(0, Math.floor(Number(mainChapterCount) || 0));
  // Default schedule: 10 pages -> 1 flowchart, then +1 for every five-page
  // increase represented by the page plan's additional main chapter.
  const defaultFlowchartCount = chapterLimit === 0 ? 0 : Math.min(chapterLimit, Math.max(1, chapterLimit - 2));
  const flowchartValue = flowchartCount == null ? defaultFlowchartCount : Number(flowchartCount);
  const flowcharts = Math.min(chapterLimit, Math.max(0,
    Number.isFinite(flowchartValue) ? Math.floor(flowchartValue) : defaultFlowchartCount));

  const defaultChartQuota = Math.max(1, Math.ceil(chapterLimit / 2));
  const chartValue = Number(chartCount);
  const requestedCharts = chartCount == null
    ? defaultChartQuota
    : Math.max(0, Number.isFinite(chartValue) ? Math.floor(chartValue) : defaultChartQuota);
  const minimumCharts = Math.max(0, MIN_DIAGRAM_COUNT - flowcharts);
  const charts = Math.min(chapterLimit, Math.max(requestedCharts, minimumCharts));

  return { flowchartCount: flowcharts, chartCount: charts };
}

module.exports = { MIN_DIAGRAM_COUNT, resolveDiagramQuotas, resolveFormulaQuota };
