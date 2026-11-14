// Formula murakkabligi siyosati:
//   • har ishda BITTA formula murakkab (integral/yig'indi/hosila/ko'p qavatli kasr),
//   • qolganlari o'rtacha (bitta kasr yoki daraja, 3–5 belgi),
//   • eng yomon holatda (LLM javob bermasa) — universal, har doim to'g'ri sodda/o'rtacha formulalar banki.

const COMPLEX_MIN_SCORE = 7;
const MEDIUM_MIN_SCORE = 2;

// LaTeX tuzilmasiga qarab taxminiy murakkablik bali
function formulaComplexity(latex) {
  const text = String(latex || "");
  if (!text.trim()) return 0;
  const count = re => (text.match(re) || []).length;
  let score = 0;
  score += 2 * count(/\\[dt]?frac\b/g);
  score += 3 * count(/\\(?:int|iint|oint|sum|prod|lim)\b/g);
  score += 2 * count(/\\partial\b|\\frac\{d\^?\{?\d?\}?\s*[a-zA-Z]/g);
  score += 1.5 * count(/\\sqrt\b/g);
  score += 1 * count(/\^/g);
  score += 0.5 * count(/_/g);
  score += 1 * count(/\\left\b/g);
  score += 1 * count(/\\(?:exp|ln|log|sin|cos|tan|arctan|sinh|cosh)\b/g);
  score += 2 * count(/\\begin\{(?:pmatrix|bmatrix|matrix|cases)\}/g);
  // Turli o'zgaruvchilar soni
  const symbols = new Set((text.replace(/\\[a-zA-Z]+/g, " ").match(/[A-Za-z]/g) || []));
  score += Math.max(0, symbols.size - 2) * 0.5;
  return Number(score.toFixed(2));
}

function complexityLevel(latex) {
  const score = formulaComplexity(latex);
  return score >= COMPLEX_MIN_SCORE ? "complex" : score >= MEDIUM_MIN_SCORE ? "medium" : "simple";
}

// Formula slotlariga daraja beriladi: bittasi "complex", qolgani "medium".
function assignFormulaComplexity(formulaSlots = []) {
  if (!formulaSlots.length) return;
  const plannedLatex = slot => (typeof slot.plan === "string" ? slot.plan : slot.plan?.latex) || "";
  const scored = formulaSlots.map(slot => ({ slot, score: formulaComplexity(plannedLatex(slot)), concept: !String(plannedLatex(slot)).trim() }));
  let chosen = scored.filter(item => !item.concept && item.score >= COMPLEX_MIN_SCORE).sort((a, b) => b.score - a.score)[0];
  if (!chosen) {
    // Konsept-slot (formulani LLM yozadi) bo'lsa — o'rtadagi bobdagisini murakkab qilamiz (odatda nazariy/model bob)
    const concepts = scored.filter(item => item.concept);
    chosen = concepts[Math.floor((concepts.length - 1) / 2)] || scored.sort((a, b) => b.score - a.score)[0];
  }
  formulaSlots.forEach((slot, index) => {
    slot.complexity = slot === chosen.slot ? "complex" : "medium";
    slot.formulaIndex = index;
  });
}

function complexityGuidance(level) {
  return level === "complex"
    ? "MURAKKABLIK: bu ishdagi yagona MURAKKAB formula — integral, hosila (differensial tenglama), yig'indi (\\sum) yoki ko'p qavatli kasrdan kamida bittasini o'z ichiga olsin, 5 va undan ortiq turli belgi bo'lsin (masalan, issiqlik balansi differensial tenglamasi, uzatish funksiyasi, integral ko'rsatkich). Formula mavzuda haqiqatan qo'llaniladigan, darsliklardagi ko'rinishda bo'lsin."
    : "MURAKKABLIK: O'RTACHA formula — bitta kasr yoki daraja, 3–5 ta belgi; integral va hosila ishlatma. Mavzuga mos amaliy hisob formulasi bo'lsin.";
}

// Universal formulalar banki: har qanday miqdoriy mavzuda to'g'ri (statistik/hisob ko'rsatkichlari).
const FALLBACK_FORMULAS = [
  {
    level: "complex",
    latex: "\\sigma=\\sqrt{\\frac{1}{n-1}\\sum_{i=1}^{n}\\left(x_i-\\bar{x}\\right)^2}",
    caption: { uz: "O'lchov natijalarining o'rtacha kvadratik og'ishi", ru: "Среднеквадратическое отклонение результатов измерений", en: "Standard deviation of measurement results" },
    where: {
      uz: "$\\sigma$ — o'rtacha kvadratik og'ish, kattalik birligida; $n$ — o'lchovlar soni; $x_i$ — $i$-o'lchov natijasi; $\\bar{x}$ — o'rtacha qiymat",
      ru: "$\\sigma$ — среднеквадратическое отклонение; $n$ — число измерений; $x_i$ — результат $i$-го измерения; $\\bar{x}$ — среднее значение",
      en: "$\\sigma$ — standard deviation; $n$ — number of measurements; $x_i$ — result of the $i$-th measurement; $\\bar{x}$ — mean value",
    },
  },
  {
    level: "medium",
    latex: "\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i",
    caption: { uz: "Ko'rsatkichning o'rtacha arifmetik qiymati", ru: "Среднее арифметическое значение показателя", en: "Arithmetic mean of the indicator" },
    where: {
      uz: "$\\bar{x}$ — o'rtacha qiymat; $n$ — kuzatuvlar soni; $x_i$ — $i$-kuzatuv qiymati",
      ru: "$\\bar{x}$ — среднее значение; $n$ — число наблюдений; $x_i$ — значение $i$-го наблюдения",
      en: "$\\bar{x}$ — mean value; $n$ — number of observations; $x_i$ — value of the $i$-th observation",
    },
  },
  {
    level: "medium",
    latex: "\\delta=\\frac{\\left|x-x_0\\right|}{x_0}\\cdot 100\\%",
    caption: { uz: "Nisbiy xatolik (og'ish)", ru: "Относительная погрешность (отклонение)", en: "Relative error (deviation)" },
    where: {
      uz: "$\\delta$ — nisbiy xatolik, %; $x$ — o'lchangan qiymat; $x_0$ — haqiqiy (talab etilgan) qiymat",
      ru: "$\\delta$ — относительная погрешность, %; $x$ — измеренное значение; $x_0$ — действительное (заданное) значение",
      en: "$\\delta$ — relative error, %; $x$ — measured value; $x_0$ — true (required) value",
    },
  },
  {
    level: "medium",
    latex: "\\eta=\\frac{W_{f}}{W_{s}}\\cdot 100\\%",
    caption: { uz: "Foydali ish koeffitsienti", ru: "Коэффициент полезного действия", en: "Efficiency" },
    where: {
      uz: "$\\eta$ — foydali ish koeffitsienti, %; $W_f$ — foydali natija (energiya, mahsulot); $W_s$ — sarflangan resurs",
      ru: "$\\eta$ — коэффициент полезного действия, %; $W_f$ — полезный результат; $W_s$ — затраченный ресурс",
      en: "$\\eta$ — efficiency, %; $W_f$ — useful output; $W_s$ — consumed resource",
    },
  },
  {
    level: "medium",
    latex: "\\Delta=\\frac{x_1-x_0}{x_0}\\cdot 100\\%",
    caption: { uz: "Ko'rsatkichning nisbiy o'zgarishi", ru: "Относительное изменение показателя", en: "Relative change of the indicator" },
    where: {
      uz: "$\\Delta$ — nisbiy o'zgarish, %; $x_1$ — yangi qiymat; $x_0$ — boshlang'ich qiymat",
      ru: "$\\Delta$ — относительное изменение, %; $x_1$ — новое значение; $x_0$ — исходное значение",
      en: "$\\Delta$ — relative change, %; $x_1$ — new value; $x_0$ — initial value",
    },
  },
  {
    level: "medium",
    latex: "w_i=\\frac{x_i}{\\sum_{j=1}^{m}x_j}\\cdot 100\\%",
    caption: { uz: "Tarkibiy qismning ulushi", ru: "Доля составной части", en: "Share of a component" },
    where: {
      uz: "$w_i$ — $i$-qism ulushi, %; $x_i$ — $i$-qism qiymati; $m$ — qismlar soni",
      ru: "$w_i$ — доля $i$-й части, %; $x_i$ — значение $i$-й части; $m$ — число частей",
      en: "$w_i$ — share of the $i$-th part, %; $x_i$ — value of the $i$-th part; $m$ — number of parts",
    },
  },
];

function langKey(language) {
  const value = String(language || "").toLowerCase();
  if (/^(ru|рус)/.test(value)) return "ru";
  if (/^(en|ing)/.test(value)) return "en";
  return "uz";
}

// Bankdan slot darajasiga mos, hujjatda takrorlanmaydigan formula
function fallbackFormula(slot, language) {
  const level = slot?.complexity === "complex" ? "complex" : "medium";
  const pool = FALLBACK_FORMULAS.filter(item => item.level === level);
  const index = Math.max(0, Number(slot?.formulaIndex) || 0);
  const item = level === "complex" ? pool[0] : pool[index % pool.length];
  const key = langKey(language);
  return { latex: item.latex, caption: item.caption[key], where: item.where[key], level: item.level };
}

module.exports = {
  COMPLEX_MIN_SCORE,
  MEDIUM_MIN_SCORE,
  FALLBACK_FORMULAS,
  formulaComplexity,
  complexityLevel,
  assignFormulaComplexity,
  complexityGuidance,
  fallbackFormula,
};
