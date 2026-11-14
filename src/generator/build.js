// src/generator/build.js
// Taqdimotni qurish: spec (JSON) -> .pptx fayl. Hamda mavzudan generatsiya.

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const { getPalette } = require("./theme");
const { generateAll, iconPath } = require("./icons");
const { render } = require("./layouts");
const { ensureStructure } = require("./structure");
const { generateSpecParallel } = require("./llm2");
const { labels } = require("./i18n");
const { verifyReferences, referenceVerificationEnabled } = require("../mustaqil/reference-verify");

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

// mavzu (+ ixtiyoriy kontent) -> 2 bosqichli LLM -> spec -> .pptx
async function generatePresentation({ topic, slides, sourceContent, palette, language, studentName, studentGroup, university, faculty, department, supervisor, llm, outFile }) {
  const L = labels(language);
  const { spec, usedProvider } = await generateSpecParallel({ topic, slides, sourceContent, language, llm: llm || {} });

  // Adabiyotlar: Crossref orqali tekshiruv (noto'g'ri DOI olib tashlanadi, haqiqiysi qo'shiladi)
  if (referenceVerificationEnabled() && spec.references.length) {
    try {
      const verified = await verifyReferences(spec.references);
      spec.references = verified.references;
    } catch (error) {
      console.warn("[taqdimot] adabiyotlar tekshiruvi o'tkazib yuborildi:", error.message);
    }
  }

  // Tuzilma kafolati: titul + reja + ... + xulosa + adabiyotlar
  ensureStructure(spec, topic, { language });
  if (palette) spec.palette = palette;

  // Titul: universitet, fakultet/kafedra, talaba va tekshiruvchi — foydalanuvchi kiritganidan
  const titleSlide = spec.slides.find((s) => s.layout === "title");
  if (titleSlide) {
    titleSlide.title = titleSlide.title || spec.title || topic;
    titleSlide.kicker = L.kicker;
    titleSlide.date = String(new Date().getFullYear());
    titleSlide.org = String(university || "").trim().toUpperCase() || undefined;
    titleSlide.faculty = [faculty, department].map(value => String(value || "").trim()).filter(Boolean).join(" · ") || undefined;
    const meta = [];
    if (studentName) meta.push({ label: L.by, value: studentName });
    if (studentGroup) meta.push({ label: L.group, value: studentGroup });
    if (supervisor) meta.push({ label: L.supervisor, value: supervisor });
    titleSlide.meta = meta;
  }

  await buildPresentation(spec, outFile);
  return { outFile, slideCount: spec.slides.length, palette: spec.palette || "ocean", usedProvider };
}

module.exports = { buildPresentation, generatePresentation, ensureIcons, ICONS_DIR };
