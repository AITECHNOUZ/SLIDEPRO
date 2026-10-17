const { normalizeFlowchartData } = require("./flowchart-data");
const { isUzbek } = require("./flowchart-data");
const { MIN_DIAGRAM_COUNT } = require("./media-requirements");
const { normalizeChartData } = require("./chart-data");

function formulaKey(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/^\\\(|^\\\[|^\$\$?/, "")
    .replace(/\\\)|\\\]|\$\$?$/, "")
    .replace(/\s+/g, "");
}

function plannedFormulaLatex(chapter) {
  if (Array.isArray(chapter.formula_plans)) {
    return chapter.formula_plans
      .map(plan => typeof plan === "string" ? plan : plan?.latex)
      .filter(value => typeof value === "string" && value.trim());
  }
  return Array.isArray(chapter.formula_latex)
    ? chapter.formula_latex.filter(value => typeof value === "string" && value.trim())
    : [];
}

function validatePlannedMedia(generatedChapters, plannedChapters, { language, minimumDiagramCount = MIN_DIAGRAM_COUNT } = {}) {
  const errors = [];
  const totalDiagramCount = (generatedChapters || []).reduce((sum, chapter) => sum
    + (Array.isArray(chapter?.content) ? chapter.content.filter(item => item?.type === "chart" || item?.type === "flowchart").length : 0), 0);
  if (totalDiagramCount < minimumDiagramCount) {
    errors.push(`Umumiy diagrammalar soni ${totalDiagramCount}/${minimumDiagramCount}; kamida ${minimumDiagramCount} ta miqdoriy grafik yoki Graphviz oqim sxemasi bo'lishi shart`);
  }
  for (const [index, planned] of (plannedChapters || []).entries()) {
    const generated = generatedChapters?.[index] || {};
    const content = Array.isArray(generated.content) ? generated.content : [];
    const isMain = planned.id !== "intro" && planned.id !== "conclusion";
    const actualCharts = content.filter(item => item?.type === "chart");
    const actualFormulas = content.filter(item => item?.type === "formula");
    const actualFlowcharts = content.filter(item => item?.type === "flowchart");
    const actualTables = content.filter(item => item?.type === "table");
    const chartPlans = Array.isArray(planned.chart_plans) ? planned.chart_plans : [];
    const flowchartPlans = Array.isArray(planned.flowchart_plans) ? planned.flowchart_plans : [];
    const expectedChartCount = isMain
      ? Math.max(Number(planned.chart_count) || 0, chartPlans.length)
      : 0;
    const formulaPlans = plannedFormulaLatex(planned);
    const expectedFormulaCount = isMain
      ? Math.max(Number(planned.formula_count) || 0, formulaPlans.length)
      : 0;
    const expectedFlowchartCount = isMain
      ? Math.max(Number(planned.flowchart_count) || 0, flowchartPlans.length)
      : 0;
    const expectedTableCount = isMain ? Number(planned.table_count) || 0 : 0;
    const chapterName = planned.title || planned.id || `chapter-${index + 1}`;

    if (expectedFormulaCount > formulaPlans.length) {
      errors.push(`${chapterName}: ${expectedFormulaCount} ta formula rejalashtirilgan, lekin formula_plans latex yetarli emas`);
    }
    if (actualCharts.length !== expectedChartCount) {
      errors.push(`${chapterName}: chart ${actualCharts.length}/${expectedChartCount}`);
    }
    if (actualFlowcharts.length !== expectedFlowchartCount) {
      errors.push(`${chapterName}: flowchart ${actualFlowcharts.length}/${expectedFlowchartCount}`);
    }
    if (actualTables.length !== expectedTableCount) {
      errors.push(`${chapterName}: table ${actualTables.length}/${expectedTableCount}`);
    }
    actualTables.forEach((table, tableIndex) => {
      const headers = Array.isArray(table.headers) ? table.headers : [];
      const rows = Array.isArray(table.rows) ? table.rows : [];
      if (headers.length < 3 || rows.length < 3 || rows.length > 6 || rows.some(row => !Array.isArray(row) || row.length !== headers.length)) {
        errors.push(`${chapterName}: table ${tableIndex + 1} kamida 3 ustun, 3–6 qator va mos kataklar bilan berilishi kerak`);
      }
    });
    actualFlowcharts.forEach((flowchart, flowchartIndex) => {
      try {
        const expectedType = flowchartPlans[flowchartIndex]?.diagram_type || flowchart.diagram_type || flowchart.template_id;
        normalizeFlowchartData(flowchart, { language, diagramType: expectedType });
      } catch (error) {
        errors.push(`${chapterName}: flowchart ${flowchartIndex + 1} yaroqsiz (${error.message})`);
      }
      const expectedType = flowchartPlans[flowchartIndex]?.diagram_type;
      if (expectedType && flowchart.diagram_type !== expectedType) {
        errors.push(`${chapterName}: flowchart ${flowchartIndex + 1} diagram_type ${flowchart.diagram_type || "bo'sh"}/${expectedType}`);
      }
      const caption = String(flowchart.caption || "").trim();
      const captionWordCount = caption.split(/\s+/).filter(Boolean).length;
      if (!caption) {
        errors.push(`${chapterName}: flowchart ${flowchartIndex + 1} caption bo'sh`);
      } else if (captionWordCount < 6 || (isUzbek(language) && !/\bizoh\s*:/i.test(caption))) {
        errors.push(`${chapterName}: flowchart ${flowchartIndex + 1} captionda qisqa izoh bo'lishi kerak`);
      }
    });
    actualCharts.forEach((chart, chartIndex) => {
      try {
        normalizeChartData(chart);
      } catch (error) {
        errors.push(`${chapterName}: chart ${chartIndex + 1} yaroqsiz (${error.message})`);
      }
      if (!String(chart.data_source || chart.source || "").trim()) {
        errors.push(`${chapterName}: chart ${chartIndex + 1} data_source ko'rsatilmagan`);
      }
      const actualType = String(chart.chartType || chart.chart_type || "").toLowerCase();
      const plannedChart = chartPlans[chartIndex] || {};
      const expectedChartType = plannedChart.diagram_type === "mathematical_graph" ? "line"
        : plannedChart.diagram_type === "experiment_results"
          ? (plannedChart.chartType || plannedChart.chart_type || (planned.chart_type === "line" ? "line" : "bar"))
          : plannedChart.chartType || plannedChart.chart_type || planned.chart_type;
      if (expectedChartType && actualType !== expectedChartType) {
        errors.push(`${chapterName}: chart ${chartIndex + 1} turi ${actualType || "bo'sh"}/${expectedChartType}`);
      }
      const expectedDiagramType = chartPlans[chartIndex]?.diagram_type;
      if (expectedDiagramType && chart.diagram_type !== expectedDiagramType) {
        errors.push(`${chapterName}: chart ${chartIndex + 1} diagram_type ${chart.diagram_type || "bo'sh"}/${expectedDiagramType}`);
      }
    });
    if (actualFormulas.length !== expectedFormulaCount) {
      errors.push(`${chapterName}: formula ${actualFormulas.length}/${expectedFormulaCount}`);
      continue;
    }
    if (formulaPlans.length) {
      const expected = formulaPlans.map(formulaKey).sort();
      const actual = actualFormulas.map(item => formulaKey(item.latex)).sort();
      if (expected.some((formula, i) => formula !== actual[i])) {
        errors.push(`${chapterName}: rejalashtirilgan formulalar bilan yaratilgan formulalar mos emas`);
      }
    }
  }
  if (errors.length) throw new Error(`Rejalashtirilgan media tekshiruvi o'tmadi: ${errors.join(" | ")}`);
  return true;
}

module.exports = { formulaKey, plannedFormulaLatex, validatePlannedMedia };
