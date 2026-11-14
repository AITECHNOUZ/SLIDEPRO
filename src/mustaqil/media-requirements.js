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

const HIGHLY_QUANTITATIVE_TOPIC = /(?:matematik|mathemat|algebra|geometri|hisoblash|calculus|fizik|physics|kimyo|chemistry|muhandis|engineering|elektr(?:ik|on)?|mexanik|mechanic|avtomatik boshqaruv|avtomatlashtir|avtomatizats|automation|rostlagich|rostlash|texnologik jarayon|control system|uzatish funksi|differensial tenglama|algoritm|algorithm|dasturlash|programming|kompyuter fan|computer science|sun'iy intellekt|artificial intelligence|machine learning|mashinaviy o'rganish|data science|ma'lumotlar tahlil|statistik|statistics|statistika|ekonometr|econometr|iqtisod|econom|moliya|finance|buxgalter|accounting|optimallashtirish|optimization|ehtimollar nazariyasi|probability|regressiya|regression|miqdoriy|quantitative|matematik model|математик|математическ|алгебр|геометр|вычислен|физик|физическ|хими|инженер|электр|механ|автоматическ.{0,20}управлен|автоматизац|регулятор|передаточн.{0,15}функци|дифференциальн.{0,15}уравнен|алгоритм|программирован|компьютерн наук|искусственн интеллект|машинн обучен|анализ данных|статист|эконом|финанс|бухгалтер|оптимизац|теори вероятност|регресси|количествен|математическ модел)/i;

// Narrow but multilingual signals for interdisciplinary topics that a plain
// keyword list often misses. These are computation/modeling methods or domains
// with inherently quantitative objects, not broad labels such as "biology".
const ADDITIONAL_QUANTITATIVE_TOPIC = /(?:quantum|kvant|квант|robotic|robototex|робототех|bioinformat|биоинформат|biostatistic|biostatistik|биостатист|genomic|genomik|геном|molecular model|molekulyar model|molekulyar dinam|молекулярн.{0,12}модел|pharmacokinetic|farmakokinet|фармакокинет|epidemiolog|эпидемиолог|population dynamic|populyatsion dinamik|популяционн.{0,12}динамик|corpus lingu|korpus ling|korpus tahlil|цифров.{0,12}гуманитар|digital humanities|computational lingu|hisoblash tilshunos|tabiiy tilni qayta ishlash|natural language processing|text mining|matnni avtomatik tahlil|sentiment analys|sentiment tahlil|raqamli filolog|cryptograph|kriptograf|криптограф|game theory|o'yinlar nazariyasi|теори игр|graph theory|graflar nazariyasi|teoriya grafov|aerodynamic|aerodinam|термодинамик|thermodynamic|termodinamik|fluid dynamic|gidrodinamik|гидродинамик|signal processing|signalni qayta ishlash|telecommunication|telekommunik|телекоммуникац)/i;

// Gumanitar mavzular: formulani sun'iy tiqish matnni buzadi — bu yerda formula 0.
const HUMANITIES_TOPIC = /(?:adabiyot|she'r|she\'riyat|roman|hikoya|doston|g'azal|poeziya|nasr|folklor|tarix|tarixiy|arxeolog|falsafa|philosoph|din\b|diniy|islom|teolog|huquq|qonunchilik|konstitutsiya|siyosat|siyosiy|madaniyat|san'at|musiqa|teatr|kino|rassom|etika|axloq|ma'naviyat|tilshunoslik|grammatika|leksika|frazeolog|imlo|literature|poetry|history|historical|religion|law\b|legal|politic|culture|art\b|music|linguistic|grammar|литератур|поэзи|истори|философ|религи|право|политик|культур|искусств|музык|лингвист|граммат)/i;

function isHumanitiesTopic(topic) {
  const normalized = normalizeTopic(topic);
  if (HIGHLY_QUANTITATIVE_TOPIC.test(normalized) || ADDITIONAL_QUANTITATIVE_TOPIC.test(normalized)) return false;
  return HUMANITIES_TOPIC.test(normalized);
}

// Bitta asosiy bo'limga bir turdan ko'pi bilan 2 ta media (matn siqilib qolmasligi uchun).
const MAX_PER_CHAPTER_PER_TYPE = 2;

function mediaCapacity(chapterLimit) {
  return Math.max(0, chapterLimit) * MAX_PER_CHAPTER_PER_TYPE;
}

function pagesFromChapters(chapterLimit) {
  // pagePlan: mainChapterCount = 3 + floor((pages - 10) / 5)
  return 10 + Math.max(0, chapterLimit - 3) * 5;
}

/**
 * Standart formula soni: gumanitar bo'lmagan har qanday mavzuda kamida 3 ta,
 * 15+ betda 4 ta, 25+ betda 5 ta. Gumanitar mavzularda 0 (foydalanuvchi aniq so'ramasa).
 */
function inferredFormulaQuota(chapterLimit, topic, pages) {
  if (chapterLimit === 0 || isHumanitiesTopic(topic)) return 0;
  const p = Number(pages) || pagesFromChapters(chapterLimit);
  const target = p >= 25 ? 5 : p >= 15 ? 4 : 3;
  return Math.min(mediaCapacity(chapterLimit), target);
}

function resolveFormulaQuota(mainChapterCount, { formulaCount = null, topic = "", pages = null } = {}) {
  const chapterLimit = Math.max(0, Math.floor(Number(mainChapterCount) || 0));
  const inferred = inferredFormulaQuota(chapterLimit, topic, pages);
  if (formulaCount == null) return inferred;
  const value = Number(formulaCount);
  return Math.min(mediaCapacity(chapterLimit), Math.max(0, Number.isFinite(value) ? Math.floor(value) : inferred));
}

/**
 * Standart chizmalar (grafik + blok-sxema) soni: <12 bet — 3 ta, 12–19 bet — 4 ta, 20+ bet — 5 ta.
 * Blok-sxemalar: 12+ betda 2 ta (har xil turdagi), aks holda 1 ta; qolgani grafik.
 */
function resolveDiagramQuotas(mainChapterCount, { flowchartCount = null, chartCount = null, pages = null } = {}) {
  const chapterLimit = Math.max(0, Math.floor(Number(mainChapterCount) || 0));
  const capacity = mediaCapacity(chapterLimit);
  const p = Number(pages) || pagesFromChapters(chapterLimit);
  // Blok-sxemalar: 12+ betda kamida 2 ta; har qo'shimcha 5 bet (asosiy bo'lim) uchun yana bittadan.
  const defaultFlowchartCount = chapterLimit === 0 ? 0 : Math.min(capacity, Math.max(p >= 12 ? 2 : 1, chapterLimit - 2));
  const baseTotal = chapterLimit === 0 ? 0 : (p >= 20 ? 5 : p >= 12 ? 4 : MIN_DIAGRAM_COUNT);
  const totalTarget = chapterLimit === 0 ? 0 : Math.max(baseTotal, defaultFlowchartCount + 2);
  const flowchartValue = flowchartCount == null ? defaultFlowchartCount : Number(flowchartCount);
  const flowcharts = Math.min(capacity, Math.max(0,
    Number.isFinite(flowchartValue) ? Math.floor(flowchartValue) : defaultFlowchartCount));

  const defaultChartQuota = Math.max(1, totalTarget - flowcharts);
  const chartValue = Number(chartCount);
  const requestedCharts = chartCount == null
    ? defaultChartQuota
    : Math.max(0, Number.isFinite(chartValue) ? Math.floor(chartValue) : defaultChartQuota);
  const minimumCharts = Math.max(0, MIN_DIAGRAM_COUNT - flowcharts);
  const charts = Math.min(capacity, Math.max(requestedCharts, minimumCharts));

  return { flowchartCount: flowcharts, chartCount: charts };
}

module.exports = { MIN_DIAGRAM_COUNT, MAX_PER_CHAPTER_PER_TYPE, resolveDiagramQuotas, resolveFormulaQuota, isHumanitiesTopic, mediaCapacity };
