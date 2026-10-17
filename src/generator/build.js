// src/generator/build.js
// Taqdimotni qurish: spec (JSON) -> .pptx fayl. Hamda mavzudan generatsiya.

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const { getPalette } = require("./theme");
const { generateAll, iconPath } = require("./icons");
const { render } = require("./layouts");
const { generateSpec, ensureStructure } = require("./llm");
const { generateSpecParallel } = require("./llm2");

const ICONS_DIR = path.join(__dirname, "..", "..", "icons");

function paletteColors(t) {
  return [...new Set([t.primary, t.secondary, t.accent, t.good, t.bad, t.dark, "FFFFFF"])];
}

async function ensureIcons(t) {
  await generateAll(ICONS_DIR, paletteColors(t));
}

function makeCtx(t) {
  return {
    t,
    icon: (name, color) => {
      const safeColor = (color || t.secondary).replace("#", "");
      const p = iconPath(ICONS_DIR, name, safeColor);
      if (!fs.existsSync(p)) return iconPath(ICONS_DIR, name, t.secondary);
      return p;
    },
  };
}

// spec -> .pptx faylga yozish
async function buildPresentation(spec, outFile) {
  const palName = spec.palette || "ocean";
  const t = getPalette(palName);
  await ensureIcons(t);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Taqdimot Bot";
  pres.title = (spec.slides && spec.slides[0] && spec.slides[0].title) || "Taqdimot";

  const ctx = makeCtx(t);
  spec.slides.forEach((sd, i) => {
    sd.number = i + 1;
    const slide = pres.addSlide();
    render(pres, slide, sd, ctx);
  });

  await pres.writeFile({ fileName: outFile });
  return outFile;
}

// mavzu (+ ixtiyoriy kontent) -> 2-bosqichli PARALLEL LLM -> spec -> .pptx
// Pass1: outline (aniq N slayd), Pass2: har slayd parallel to'liq kontent
async function generatePresentation({ topic, slides, sourceContent, extra, palette, studentName, studentGroup, llm, outFile }) {
  const { spec, usedProvider } = await generateSpecParallel({
    topic, slides, sourceContent, studentName, studentGroup,
    provider: (llm && llm.provider) || "anthropic",
    anthropicKey: llm && llm.anthropicKey,
    anthropicModel: (llm && llm.anthropicModel) || process.env.MODEL || "claude-sonnet-4-6",
    openaiKey: llm && llm.openaiKey,
    openaiModel: (llm && llm.openaiModel) || process.env.OPENAI_MODEL || "gpt-4o",
  });

  // Tuzilma kafolati: titul + reja + xulosa + adabiyotlar qo'shiladi
  ensureStructure(spec, topic);

  if (palette) spec.palette = palette;
  if (!spec.slides || !Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new Error("Yaroqsiz spec: 'slides' massivi topilmadi.");
  }

  // Titul slaydiga joriy yil va talaba ma'lumotlarini majburiy o'rnatish
  const titleSlide = spec.slides.find((s) => s.layout === "title");
  if (titleSlide) {
    titleSlide.date = String(new Date().getFullYear());
    if (studentName || studentGroup) {
      const meta = [];
      if (studentName) meta.push({ label: "Bajardi:", value: studentName });
      if (studentGroup) meta.push({ label: "Guruh:", value: studentGroup });
      titleSlide.meta = meta;
    }
  }

  await buildPresentation(spec, outFile);
  return { outFile, slideCount: spec.slides.length, palette: spec.palette || "ocean", usedProvider };
}

module.exports = { buildPresentation, generatePresentation, ensureIcons, ICONS_DIR };
