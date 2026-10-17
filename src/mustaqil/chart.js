// src/mustaqil/chart.js
// Grafik ma'lumotlardan SVG → sharp → PNG.
// Native dep yo'q — to'liq custom SVG renderer.

const sharp = require("sharp");
const { normalizeChartData } = require("./chart-data");
const { renderMatplotlibChart } = require("./matplotlib");

const COLORS = ["#2E8AA8", "#E0A444", "#1FA35A", "#C44536", "#73304A", "#16B0A0", "#5E7079", "#B5513F"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tickText = (n) => String(Number(n.toPrecision(3)));

function wrapLabelLines(value, maxChars) {
  const limit = Math.max(4, Math.floor(Number(maxChars) || 12));
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const originalWord of words) {
    let word = originalWord;
    while (word.length > limit) {
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, limit));
      word = word.slice(limit);
    }
    if (!word) continue;
    if (line && `${line} ${word}`.length > limit) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function xLabelSvg(label, x, y, maxChars, fontSize) {
  const lines = wrapLabelLines(label, maxChars);
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fontSize}" fill="#555">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize + 2}">${esc(line)}</tspan>`).join("")}</text>`;
}

function rangeIncludingZero(values, padding = 0.05) {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  const span = max - min || 1;
  min -= span * padding;
  max += span * padding;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(max - min)) {
    throw new Error("chart: ko'lam son diapazonidan oshib ketdi");
  }
  return { min, max };
}

// Figure titles are intentionally omitted; the DOCX caption names each chart.
// --- Bar chart ---
function barSVG({ labels, values, unit = "" }) {
  const W = 600, PL = 65, PR = 20, PT = 50;
  const n = labels.length;
  const step = (W - PL - PR) / n;
  const maxLabelChars = Math.max(4, Math.floor(step * 0.84 / 5.2));
  const labelLines = labels.map(label => wrapLabelLines(label, maxLabelChars));
  const extraLabelHeight = Math.max(0, Math.max(...labelLines.map(lines => lines.length), 1) - 2) * 12;
  const H = 360 + extraLabelHeight, PB = 70 + extraLabelHeight;
  const cW = W - PL - PR, cH = H - PT - PB;
  const { min, max } = rangeIncludingZero(values);
  const yFor = (v) => PT + ((max - v) / (max - min)) * cH;
  const y0 = yFor(0);
  const bw = (cW / n) * 0.6;
  const barStep = cW / n;
  let bars = "", xLabels = "";

  values.forEach((v, i) => {
    const x = PL + i * barStep + barStep * 0.2;
    const yv = yFor(v);
    const bh = Math.abs(y0 - yv);
    const y = Math.min(y0, yv);
    const col = COLORS[i % COLORS.length];
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}" rx="3"/>`;
    const valueY = v < 0 ? y + 14 : y - 6;
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${valueY.toFixed(1)}" text-anchor="middle" font-size="11" fill="#333">${esc(String(v))}</text>`;
    const label = String(labels[i]);
    const x0 = (x + bw / 2).toFixed(1);
    xLabels += xLabelSvg(label, x0, H - PB + 18, maxLabelChars, 9);
  });

  let ticks = "";
  for (let i = 0; i <= 5; i++) {
    const value = min + ((max - min) * i) / 5;
    const y = yFor(value).toFixed(1);
    ticks += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#e8e8e8" stroke-width="0.8"/>`;
    ticks += `<text x="${PL - 8}" y="${y}" dy="4" text-anchor="end" font-size="10" fill="#777">${tickText(value)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:white" font-family="Times New Roman, Liberation Serif, serif">
  ${unit ? `<text x="${PL - 10}" y="${PT - 8}" text-anchor="middle" font-size="10" fill="#999">${esc(unit)}</text>` : ""}
  <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT + cH}" stroke="#999" stroke-width="1.2"/>
  <line x1="${PL}" y1="${y0.toFixed(1)}" x2="${W - PR}" y2="${y0.toFixed(1)}" stroke="#777" stroke-width="1.2"/>
  ${ticks}${bars}${xLabels}
</svg>`;
}

// --- Line chart ---
function lineSVG({ labels, values, unit = "" }) {
  const W = 600, PL = 65, PR = 30, PT = 50;
  const xStep = (W - PL - PR) / (labels.length - 1);
  const maxLabelChars = Math.max(4, Math.floor(xStep * 0.72 / 5.4));
  const labelLines = labels.map(label => wrapLabelLines(label, maxLabelChars));
  const extraLabelHeight = Math.max(0, Math.max(...labelLines.map(lines => lines.length), 1) - 2) * 12;
  const H = 320 + extraLabelHeight, PB = 55 + extraLabelHeight;
  const cW = W - PL - PR, cH = H - PT - PB;
  const { min, max } = rangeIncludingZero(values, 0.08);
  const yFor = (v) => PT + ((max - v) / (max - min)) * cH;
  const points = values.map((value, i) => [(PL + i * xStep).toFixed(1), yFor(value).toFixed(1)]);
  const polyline = points.map(point => point.join(",")).join(" ");
  let dots = "", xLabels = "", ticks = "";

  points.forEach(([x, y], i) => {
    dots += `<circle cx="${x}" cy="${y}" r="4" fill="${COLORS[0]}" stroke="white" stroke-width="1.5"/>`;
    dots += `<text x="${x}" y="${(parseFloat(y) - 10).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${esc(String(values[i]))}</text>`;
    xLabels += xLabelSvg(labels[i], x, H - PB + 18, maxLabelChars, 9);
  });
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    const y = yFor(value).toFixed(1);
    ticks += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#e8e8e8" stroke-width="0.8"/>`;
    ticks += `<text x="${PL - 8}" y="${y}" dy="4" text-anchor="end" font-size="10" fill="#777">${tickText(value)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:white" font-family="Times New Roman, Liberation Serif, serif">
  ${unit ? `<text x="${PL - 10}" y="${PT - 8}" text-anchor="middle" font-size="10" fill="#999">${esc(unit)}</text>` : ""}
  <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT + cH}" stroke="#999" stroke-width="1.2"/>
  <line x1="${PL}" y1="${PT + cH}" x2="${W - PR}" y2="${PT + cH}" stroke="#999" stroke-width="1.2"/>
  ${ticks}<polyline points="${polyline}" fill="none" stroke="${COLORS[0]}" stroke-width="2.5" stroke-linejoin="round"/>${dots}${xLabels}
</svg>`;
}

// --- Pie chart ---
function pieSVG({ labels, values }) {
  const W = 580, H = 300, cx = 180, cy = 150, r = 120;
  const total = values.reduce((sum, value) => sum + value, 0);
  let angle = -Math.PI / 2, slices = "", legend = "";
  values.forEach((value, i) => {
    const delta = (value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + delta), y2 = cy + r * Math.sin(angle + delta);
    const largeArc = delta > Math.PI ? 1 : 0;
    const color = COLORS[i % COLORS.length];
    if (value > 0) {
      if (Math.abs(delta - Math.PI * 2) < 1e-12) {
        slices += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="white" stroke-width="1.5"/>`;
      } else {
        slices += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r},0,${largeArc},1,${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${color}" stroke="white" stroke-width="1.5"/>`;
      }
    }
    const midAngle = angle + delta / 2;
    const labelX = cx + r * 0.65 * Math.cos(midAngle), labelY = cy + r * 0.65 * Math.sin(midAngle);
    const percent = ((value / total) * 100).toFixed(0);
    if (value > 0) slices += `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="12" fill="white" font-weight="bold">${percent}%</text>`;
    const legendY = 50 + i * 26;
    legend += `<rect x="320" y="${legendY - 10}" width="16" height="16" fill="${color}" rx="2"/><text x="343" y="${legendY + 2}" font-size="12" fill="#333">${esc(labels[i])} (${percent}%)</text>`;
    angle += delta;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:white" font-family="Times New Roman, Liberation Serif, serif">
  ${slices}${legend}
</svg>`;
}

async function renderChart(chart) {
  const { chartType, labels, values, title, unit } = normalizeChartData(chart);
  if (["mathematical_graph", "experiment_results"].includes(chart.diagram_type)) {
    return renderMatplotlibChart({ ...chart, chartType, labels, values, title, unit });
  }
  let svg, width, height;
  if (chartType === "line") { svg = lineSVG({ labels, values, unit }); width = 600; height = 320; }
  else if (chartType === "pie") { svg = pieSVG({ labels, values }); width = 580; height = 300; }
  else if (chartType === "bar") { svg = barSVG({ labels, values, unit }); width = 600; height = 360; }
  else throw new Error(`chart: noma'lum tur (${chartType})`);
  width = Number(svg.match(/\bwidth="(\d+)"/)?.[1]) || width;
  height = Number(svg.match(/\bheight="(\d+)"/)?.[1]) || height;

  const buf = await sharp(Buffer.from(svg))
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
  const displayWidth = 440;
  const displayHeight = Math.round(displayWidth * height / width);
  return { buf, width: displayWidth, height: displayHeight };
}

module.exports = { renderChart, wrapLabelLines, barSVG, lineSVG, pieSVG };
