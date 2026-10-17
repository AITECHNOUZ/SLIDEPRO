const CHART_TYPES = new Set(["bar", "line", "pie"]);
const MATH_FUNCTIONS = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "exp", "log", "log10", "sqrt", "abs"]);
const MATH_NAMES = new Set(["x", "pi", "e", ...MATH_FUNCTIONS]);
const MATH_CHARACTERS = /^[0-9a-zA-Z_\s.+*/^()\-]+$/;

function finiteNumber(value, field) {
  if (typeof value === "string" && !value.trim()) throw new Error(`chart: ${field} bo'sh bo'lmasin`);
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`chart: ${field} finite son bo'lishi kerak`);
  return number;
}

function safeMathExpression(value) {
  const expression = String(value || "").trim();
  if (!expression || expression.length > 120 || !MATH_CHARACTERS.test(expression)) return false;
  const names = expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  return names.every(name => MATH_NAMES.has(name.toLowerCase()));
}

function normalizeMathematicalGraph(chart) {
  const rawFunctions = Array.isArray(chart.functions)
    ? chart.functions
    : [{ name: chart.function_name || "f(x)", expression: chart.expression }];
  if (rawFunctions.length < 1 || rawFunctions.length > 5) {
    throw new Error("chart: matematik grafikda 1–5 ta funksiya bo'lishi mumkin");
  }
  const functions = rawFunctions.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`chart: ${index + 1}-funksiya obyekt bo'lishi kerak`);
    const name = String(item.name || `f${index + 1}(x)`).trim();
    const expression = String(item.expression || "").trim();
    if (!name || name.length > 40) throw new Error(`chart: ${index + 1}-funksiya nomi 1–40 belgidan iborat bo'lsin`);
    if (!safeMathExpression(expression)) throw new Error(`chart: ${index + 1}-funksiya xavfsiz matematik ifoda emas`);
    return { name, expression };
  });
  const xMin = finiteNumber(chart.x_min, "x_min");
  const xMax = finiteNumber(chart.x_max, "x_max");
  if (xMax <= xMin || xMax - xMin > 1_000_000 || Math.abs(xMin) > 1_000_000 || Math.abs(xMax) > 1_000_000) {
    throw new Error("chart: matematik grafik x oralig'i yaroqsiz");
  }
  return {
    ...chart,
    diagram_type: "mathematical_graph",
    chartType: "line",
    functions,
    x_min: xMin,
    x_max: xMax,
    x_label: String(chart.x_label || "x").trim(),
    y_label: String(chart.y_label || chart.unit || "f(x)").trim(),
    title: String(chart.title || chart.caption || "").trim(),
    unit: String(chart.unit || "").trim(),
  };
}

function normalizeExperimentResults(chart) {
  const chartType = String(chart.chartType || "bar").trim().toLowerCase();
  if (!["bar", "line"].includes(chartType)) throw new Error(`chart: experiment_results uchun bar yoki line kerak (${chartType})`);
  if (!Array.isArray(chart.labels) || chart.labels.length < 2 || chart.labels.length > 8) {
    throw new Error("chart: tajriba natijasi uchun 2–8 ta label kerak");
  }
  const labels = chart.labels.map((label, index) => {
    const text = String(label == null ? "" : label).trim();
    if (!text) throw new Error(`chart: ${index + 1}-label bo'sh`);
    return text;
  });
  if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) throw new Error("chart: takrorlangan label bor");
  const sourceSeries = Array.isArray(chart.series)
    ? chart.series
    : Array.isArray(chart.values) ? [{ name: chart.series_name || chart.unit || "Natija", values: chart.values }] : [];
  if (sourceSeries.length < 1 || sourceSeries.length > 5) throw new Error("chart: tajriba natijasida 1–5 ta series bo'lishi mumkin");
  const series = sourceSeries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Array.isArray(entry.values) || entry.values.length !== labels.length) {
      throw new Error(`chart: ${index + 1}-series labels bilan teng uzunlikdagi values massiviga ega bo'lsin`);
    }
    const name = String(entry.name || `Seriya ${index + 1}`).trim();
    if (!name || name.length > 48) throw new Error(`chart: ${index + 1}-series nomi 1–48 belgidan iborat bo'lsin`);
    return { name, values: entry.values.map((value, valueIndex) => finiteNumber(value, `${index + 1}-series ${valueIndex + 1}-qiymat`)) };
  });
  const valueRange = Math.max(...series.flatMap(entry => entry.values)) - Math.min(...series.flatMap(entry => entry.values));
  if (!Number.isFinite(valueRange)) throw new Error("chart: qiymatlar oralig'i son diapazonidan oshib ketdi");
  return {
    ...chart,
    diagram_type: "experiment_results",
    chartType,
    labels,
    series,
    values: series.length === 1 ? [...series[0].values] : undefined,
    title: String(chart.title || chart.caption || "").trim(),
    unit: String(chart.unit || "").trim(),
    x_label: String(chart.x_label || "").trim(),
    y_label: String(chart.y_label || chart.unit || "").trim(),
  };
}

function normalizeChartData(chart) {
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) {
    throw new Error("chart: ma'lumot obyekt bo'lishi kerak");
  }
  if (chart.diagram_type === "mathematical_graph") return normalizeMathematicalGraph(chart);
  if (chart.diagram_type === "experiment_results") return normalizeExperimentResults(chart);
  if (chart.diagram_type) throw new Error(`chart: noma'lum diagram_type (${chart.diagram_type})`);

  const chartType = String(chart.chartType || "").trim().toLowerCase();
  if (!CHART_TYPES.has(chartType)) throw new Error(`chart: noma'lum tur (${chart.chartType || "bo'sh"})`);
  if (!Array.isArray(chart.labels) || !Array.isArray(chart.values)) {
    throw new Error("chart: labels va values massiv bo'lishi kerak");
  }
  if (chart.labels.length < 2 || chart.labels.length > 8) {
    throw new Error("chart: 2–8 ta label talab qilinadi");
  }
  if (chart.labels.length !== chart.values.length) {
    throw new Error("chart: labels va values uzunligi teng emas");
  }

  const labels = chart.labels.map((label, index) => {
    const normalized = String(label == null ? "" : label).trim();
    if (!normalized) throw new Error(`chart: ${index + 1}-label bo'sh`);
    return normalized;
  });
  if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) {
    throw new Error("chart: takrorlangan label bor");
  }
  const values = chart.values.map((value, index) => {
    const number = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
    if (!Number.isFinite(number)) throw new Error(`chart: ${index + 1}-qiymat son emas yoki finite emas`);
    return number;
  });
  const valueRange = Math.max(...values) - Math.min(...values);
  if (!Number.isFinite(valueRange)) throw new Error("chart: qiymatlar oralig'i son diapazonidan oshib ketdi");

  if (chartType === "pie") {
    if (labels.length > 5) throw new Error("chart: pie grafik ko'pi bilan 5 bo'lakka ega bo'lishi mumkin");
    if (values.some(value => value < 0)) throw new Error("chart: pie grafikda manfiy qiymat mumkin emas");
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total)) throw new Error("chart: pie grafik qiymatlari yig'indisi son diapazonidan oshib ketdi");
    if (total <= 0) throw new Error("chart: pie grafik qiymatlari yig'indisi noldan katta bo'lishi kerak");
  }

  return {
    ...chart,
    chartType,
    labels,
    values,
    title: String(chart.title || chart.caption || "").trim(),
    unit: String(chart.unit || "").trim(),
  };
}

module.exports = {
  CHART_TYPES,
  MATH_FUNCTIONS,
  safeMathExpression,
  normalizeMathematicalGraph,
  normalizeExperimentResults,
  normalizeChartData,
};
