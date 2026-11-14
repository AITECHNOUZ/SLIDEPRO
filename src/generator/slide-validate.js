// src/generator/slide-validate.js
// Slayd JSON'ini tekshirish va tozalash. Yaroqsiz javob → xato (LLM qayta so'raladi, kaskadda qimmat modelga o'tadi).
// lenient=true (oxirgi urinish) — kichik kamchiliklar tuzatiladi, faqat jiddiy bo'shliq rad etiladi.

const { ICON_NAMES } = require("./icons");
const { normalizeFlowchartData } = require("../mustaqil/flowchart-data");

// Slaydlarda ishlatiladigan GOST sxema turlari
const SLIDE_DIAGRAM_TYPES = ["process_sequence", "cycle_diagram", "classification_tree", "ishikawa_diagram", "timeline_diagram", "functional_block_diagram", "algorithm_flowchart"];

const ICONS = new Set(ICON_NAMES);
// Namuna matn qolib ketganini aniqlash: <...>, "karta 1", "element 2", "tavsif" va h.k.
const PLACEHOLDER_RE = /<[^>]{0,80}>|^(karta|panel|element|tavsif|kirish|maqsad|qadam|xususiyat|qatlam|band|bosqich|ustun|ko'rsatkich|item|card|step|feature|title|description|desc|text|label)\s*\d*$|^\.{3}$|^(lorem|ipsum)/i;

function str(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : (typeof value === "number" ? String(value) : "");
}
function wordCount(text) {
  return str(text).split(" ").filter(Boolean).length;
}
// Juda uzun matnni so'z chegarasida qisqartirish (dizaynga sig'ishi uchun)
function clip(text, maxWords) {
  const words = str(text).split(" ").filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ").replace(/[,;:–—-]+$/, "") + "…" : words.join(" ");
}

class SlideError extends Error {}

function requireText(value, field, { min = 1, maxWords = 40, lenient = false } = {}) {
  const text = str(value);
  if (!text) throw new SlideError(`${field} bo'sh`);
  if (PLACEHOLDER_RE.test(text)) throw new SlideError(`${field} namuna matn: "${text.slice(0, 40)}"`);
  if (wordCount(text) < min && !lenient) throw new SlideError(`${field} juda qisqa`);
  if (wordCount(text) > maxWords * 1.6 && !lenient) throw new SlideError(`${field} juda uzun (${wordCount(text)} so'z)`);
  return clip(text, maxWords);
}
function optionalText(value, maxWords = 30) {
  const text = str(value);
  if (!text || PLACEHOLDER_RE.test(text)) return "";
  return clip(text, maxWords);
}
function icon(value, fallback = "check") {
  const name = str(value).toLowerCase();
  return ICONS.has(name) ? name : fallback;
}
function list(value, field, { min, max, lenient }) {
  const items = Array.isArray(value) ? value.filter(Boolean) : [];
  const need = lenient ? Math.max(1, min - 1) : min;
  if (items.length < need) throw new SlideError(`${field}: kamida ${min} ta element kerak (${items.length})`);
  return items.slice(0, max);
}
function cards(value, field, { min, max, lenient, descWords = 18, iconDefault = "check" }) {
  return list(value, field, { min, max, lenient }).map((item, index) => ({
    icon: icon(item?.icon, iconDefault),
    title: requireText(item?.title, `${field}[${index + 1}].title`, { maxWords: 6, lenient }),
    desc: requireText(item?.desc, `${field}[${index + 1}].desc`, { min: lenient ? 1 : 4, maxWords: descWords, lenient }),
  }));
}
function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? "").replace(",", ".").replace(/[^\d.+-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const VALIDATORS = {
  "stat-callout": (d, o) => ({
    intro: optionalText(d.intro, 35),
    stat: { label: requireText(d.stat?.label, "stat.label", { maxWords: 6, ...o }), value: requireText(d.stat?.value, "stat.value", { maxWords: 4, ...o }), desc: optionalText(d.stat?.desc, 18) },
    highlight: d.highlight ? { icon: icon(d.highlight.icon, "warning"), label: optionalText(d.highlight.label, 6), text: optionalText(d.highlight.text, 25) } : null,
    items: cards(d.items, "items", { min: 2, max: 3, ...o }),
  }),
  objectives: (d, o) => ({
    banner: { icon: icon(d.banner?.icon, "target"), label: optionalText(d.banner?.label, 6), text: requireText(d.banner?.text, "banner.text", { maxWords: 28, ...o }) },
    items: cards(d.items, "items", { min: 3, max: 4, ...o }),
  }),
  steps: (d, o) => ({
    intro: optionalText(d.intro, 30),
    items: cards(d.items, "items", { min: 3, max: 6, descWords: 14, ...o }),
    note: d.note ? { icon: icon(d.note.icon, "lightbulb"), label: optionalText(d.note.label, 5), text: optionalText(d.note.text, 22) } : null,
  }),
  "feature-grid": (d, o) => ({
    intro: optionalText(d.intro, 30),
    items: cards(d.items, "items", { min: 3, max: 6, ...o }),
    note: d.note ? { label: optionalText(d.note.label, 5), text: optionalText(d.note.text, 22) } : null,
  }),
  layers: (d, o) => ({
    intro: optionalText(d.intro, 30),
    items: cards(d.items, "items", { min: 2, max: 4, ...o }).map((item, index, all) => ({ ...item, num: String(all.length - index) })),
  }),
  "split-list": (d, o) => ({
    intro: optionalText(d.intro, 30),
    listTitle: optionalText(d.listTitle, 6),
    items: list(d.items, "items", { min: 3, max: 7, ...o }).map((item, index) => ({ text: requireText(typeof item === "string" ? item : item?.text, `items[${index + 1}]`, { maxWords: 16, ...o }) })),
    panel: d.panel ? { label: optionalText(d.panel.label, 6), lines: (Array.isArray(d.panel.lines) ? d.panel.lines : []).map(line => optionalText(line, 10)).filter(Boolean).slice(0, 4), foot: optionalText(d.panel.foot, 14) } : null,
    highlight: d.highlight ? { icon: icon(d.highlight.icon, "up"), label: optionalText(d.highlight.label, 6), value: optionalText(d.highlight.value, 4), desc: optionalText(d.highlight.desc, 14) } : null,
  }),
  "dual-column": (d, o) => ({
    leftTitle: requireText(d.leftTitle, "leftTitle", { maxWords: 6, ...o }),
    left: cards(d.left, "left", { min: 2, max: 5, descWords: 14, ...o }),
    rightTitle: requireText(d.rightTitle, "rightTitle", { maxWords: 6, ...o }),
    right: list(d.right, "right", { min: 2, max: 5, ...o }).map((item, index) => ({
      title: requireText(item?.title, `right[${index + 1}].title`, { maxWords: 6, ...o }),
      desc: requireText(item?.desc, `right[${index + 1}].desc`, { maxWords: 14, ...o }),
      color: ["bad", "accent", "secondary", "mute", "primary"].includes(item?.color) ? item.color : ["bad", "accent", "secondary"][index % 3],
    })),
    strip: (Array.isArray(d.strip) ? d.strip : []).map(item => ({ value: optionalText(item?.value, 3), label: optionalText(item?.label, 4) })).filter(item => item.value && item.label).slice(0, 3),
  }),
  metrics: (d, o) => ({
    intro: optionalText(d.intro, 30),
    stats: list(d.stats, "stats", { min: 2, max: 4, ...o }).map((item, index) => ({
      value: requireText(item?.value, `stats[${index + 1}].value`, { maxWords: 3, ...o }),
      unit: optionalText(item?.unit, 2), label: requireText(item?.label, `stats[${index + 1}].label`, { maxWords: 5, ...o }), sub: optionalText(item?.sub, 5),
    })),
    stagesTitle: optionalText(d.stagesTitle, 6),
    stages: (Array.isArray(d.stages) ? d.stages : []).map(item => ({ title: optionalText(item?.title, 5), desc: optionalText(item?.desc, 12) })).filter(item => item.title).slice(0, 3),
  }),
  chart: (d, o) => {
    const chart = d.chart || {};
    const labels = list(chart.labels, "chart.labels", { min: 3, max: 8, ...o }).map(label => optionalText(label, 4)).filter(Boolean);
    const values = (Array.isArray(chart.values) ? chart.values : []).map(number);
    if (values.length !== labels.length || values.some(value => value == null)) throw new SlideError("chart.values labels bilan teng va son bo'lishi kerak");
    const type = ["bar", "line", "pie"].includes(chart.type) ? chart.type : "bar";
    if (type === "pie" && values.some(value => value < 0)) throw new SlideError("pie uchun manfiy qiymat bo'lmaydi");
    return {
      cards: (Array.isArray(d.cards) ? d.cards : []).map(item => ({ value: optionalText(item?.value, 3), unit: optionalText(item?.unit, 2), label: optionalText(item?.label, 4) })).filter(item => item.value && item.label).slice(0, 4),
      chart: { title: optionalText(chart.title, 8), type, seriesName: optionalText(chart.seriesName, 4) || "Qiymat", labels, values },
      panels: (Array.isArray(d.panels) ? d.panels : []).map(item => ({ label: optionalText(item?.label, 5), lines: (Array.isArray(item?.lines) ? item.lines : []).map(line => optionalText(line, 8)).filter(Boolean).slice(0, 3) })).filter(item => item.label && item.lines.length).slice(0, 2),
    };
  },
  conclusion: (d, o) => {
    const summary = optionalText(d.summary, 90);
    const points = (Array.isArray(d.points) ? d.points : Array.isArray(d.items) ? d.items : [])
      .map((item, index) => ({ icon: icon(item?.icon, ["check", "star", "rocket", "layers"][index % 4]), text: optionalText(typeof item === "string" ? item : item?.text, 12) }))
      .filter(item => item.text).slice(0, 4);
    if (wordCount(summary) < (o.lenient ? 10 : 30) && points.length < 3) throw new SlideError("xulosa juda qisqa");
    return { summary, points };
  },
  timeline: (d, o) => ({
    intro: optionalText(d.intro, 25),
    items: list(d.items, "items", { min: 3, max: 6, ...o }).map((item, index) => ({
      date: requireText(item?.date, `items[${index + 1}].date`, { maxWords: 3, ...o }),
      title: requireText(item?.title, `items[${index + 1}].title`, { maxWords: 6, ...o }),
      desc: requireText(item?.desc, `items[${index + 1}].desc`, { min: o.lenient ? 1 : 3, maxWords: 14, ...o }),
    })),
  }),
  process: (d, o) => ({
    intro: optionalText(d.intro, 25),
    items: cards(d.items, "items", { min: 3, max: 5, descWords: 20, ...o }),
  }),
  table: (d, o) => {
    const headers = list(d.headers, "headers", { min: 2, max: 5, ...o }).map((h, index) => requireText(h, `headers[${index + 1}]`, { maxWords: 5, ...o }));
    const rows = list(d.rows, "rows", { min: 2, max: 6, ...o }).map((row, ri) => {
      if (!Array.isArray(row)) throw new SlideError(`rows[${ri + 1}] massiv emas`);
      const cells = headers.map((_, ci) => optionalText(row[ci], 12));
      if (cells.filter(Boolean).length < Math.min(2, headers.length)) throw new SlideError(`rows[${ri + 1}] deyarli bo'sh`);
      return cells;
    });
    return { intro: optionalText(d.intro, 25), headers, rows };
  },
  section: (d, o) => ({ subtitle: optionalText(d.subtitle, 24) }),
  quote: (d, o) => ({
    quote: requireText(d.quote, "quote", { min: 6, maxWords: 50, ...o }),
    author: requireText(d.author, "author", { maxWords: 8, ...o }),
    source: optionalText(d.source, 12),
    points: (Array.isArray(d.points) ? d.points : []).map((p, index) => ({ icon: icon(p?.icon, "check"), text: optionalText(typeof p === "string" ? p : p?.text, 16) })).filter(p => p.text).slice(0, 3),
  }),
  bignumber: (d, o) => ({
    hero: {
      value: requireText(d.hero?.value, "hero.value", { maxWords: 2, ...o }),
      unit: optionalText(d.hero?.unit, 3),
      label: requireText(d.hero?.label, "hero.label", { maxWords: 8, ...o }),
      desc: optionalText(d.hero?.desc, 35),
    },
    items: list(d.items, "items", { min: 2, max: 3, ...o }).map((item, index) => ({
      value: requireText(item?.value, `items[${index + 1}].value`, { maxWords: 3, ...o }),
      label: requireText(item?.label, `items[${index + 1}].label`, { maxWords: 12, ...o }),
    })),
  }),
  swot: (d, o) => {
    const group = (value, field) => list(value, field, { min: 2, max: 3, ...o }).map((item, index) => requireText(typeof item === "string" ? item : item?.text, `${field}[${index + 1}]`, { maxWords: 12, ...o }));
    return { strengths: group(d.strengths, "strengths"), weaknesses: group(d.weaknesses, "weaknesses"), opportunities: group(d.opportunities, "opportunities"), threats: group(d.threats, "threats") };
  },
  diagram: (d, o) => {
    const raw = d.diagram || {};
    const type = SLIDE_DIAGRAM_TYPES.includes(raw.diagram_type) ? raw.diagram_type : null;
    if (!type) throw new SlideError(`diagram.diagram_type quyidagilardan biri bo'lsin: ${SLIDE_DIAGRAM_TYPES.join(", ")}`);
    let normalized;
    try {
      normalized = normalizeFlowchartData({ title: raw.title || "Sxema", ...raw, diagram_type: type }, { diagramType: type });
    } catch (error) {
      throw new SlideError(`diagram: ${error.message}`);
    }
    return {
      diagram: { ...normalized, diagram_type: type },
      points: (Array.isArray(d.points) ? d.points : []).map(p => ({ text: optionalText(typeof p === "string" ? p : p?.text, 18) })).filter(p => p.text).slice(0, 3),
    };
  },
  bullets: (d, o) => ({
    intro: optionalText(d.intro, 45),
    items: list(d.items, "items", { min: 3, max: 5, ...o }).map((item, index) => ({ text: requireText(typeof item === "string" ? item : item?.text, `items[${index + 1}]`, { maxWords: 18, ...o }) })),
  }),
};

// Javobni tekshirib, renderga tayyor toza obyekt qaytaradi
function validateSlide(raw, { layout, title, lenient = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SlideError("slayd JSON obyekt emas");
  const kind = layout || raw.layout;
  const validator = VALIDATORS[kind];
  if (!validator) throw new SlideError(`noma'lum layout: ${kind}`);
  const body = validator(raw, { lenient });
  const slideTitle = optionalText(raw.title, 9) || optionalText(title, 9);
  if (!slideTitle) throw new SlideError("title bo'sh");
  return { layout: kind, title: slideTitle, icon: icon(raw.icon, "star"), ...body };
}

module.exports = { validateSlide, SlideError, PLACEHOLDER_RE, clip, wordCount, VALIDATORS, SLIDE_DIAGRAM_TYPES };
