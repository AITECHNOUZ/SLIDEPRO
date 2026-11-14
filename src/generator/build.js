// src/generator/build.js
// Taqdimotni qurish: spec (JSON) -> .pptx fayl. Hamda mavzudan generatsiya.

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const { getPalette, getTheme, pickDesign } = require("./theme");
const { generateAll, iconPath } = require("./icons");
const { render } = require("./layouts");
const { ensureStructure } = require("./structure");
const { generateSpecParallel } = require("./llm2");
const { labels, langKey } = require("./i18n");
const os = require("os");
const { renderGostSchematic } = require("../mustaqil/flowchart");

// "diagram" slaydlaridagi GOST sxemalarini oldindan rasmga aylantirish; chizilmasa — oddiy ro'yxat slaydi
async function prerenderDiagrams(spec) {
  for (const slide of spec.slides || []) {
    if (slide.layout !== "diagram") continue;
    try {
      const image = await renderGostSchematic({ ...slide.diagram, language: spec.language || "" });
      const file = path.join(os.tmpdir(), `slidepro-diagram-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
      fs.writeFileSync(file, image.buf);
      slide._image = { path: file, width: image.width, height: image.height };
    } catch (error) {
      console.warn("[taqdimot] sxema chizilmadi, ro'yxatga almashtirildi:", error.message);
      const labelsList = (slide.diagram?.nodes || []).map(node => node.label).filter(Boolean);
      slide.layout = "bullets";
      slide.intro = (slide.points || []).map(point => point.text).join(" ");
      slide.items = labelsList.slice(0, 5).map(text => ({ text }));
    }
  }
}
const { verifyReferences, referenceVerificationEnabled } = require("../mustaqil/reference-verify");

const ICONS_DIR = path.join(__dirname, "..", "..", "icons");

function paletteColors(t) {
  return [...new Set([t.primary, t.secondary, t.accent, t.good, t.bad, t.dark, "FFFFFF"])];
}

async function ensureIcons(t) {
  await generateAll(ICONS_DIR, paletteColors(t));
}

function makeCtx(t, theme, deckTitle, lang) {
  return {
    t,
    lang,
    theme,
    deckTitle,
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
  // Dizayn: spec.theme/spec.palette berilsa — o'sha, aks holda tasodifiy mavzu va palitra
  const design = pickDesign({ theme: spec.theme, palette: spec.palette, topic: spec.topic || spec.title || "" });
  spec.theme = design.themeKey;
  spec.palette = design.paletteKey;
  const t = design.palette;
  await ensureIcons(t);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Taqdimot Bot";
  pres.title = (spec.slides && spec.slides[0] && spec.slides[0].title) || "Taqdimot";

  const deckTitle = (spec.slides && spec.slides[0] && spec.slides[0].title) || spec.title || "";
  const ctx = makeCtx(t, design.theme, String(deckTitle).replace(/\s+/g, " "), langKey(spec.language));
  await prerenderDiagrams(spec);
  spec.slides.forEach((sd, i) => {
    sd.number = i + 1;
    const slide = pres.addSlide();
    render(pres, slide, sd, ctx);
  });

  await pres.writeFile({ fileName: outFile });
  for (const slide of spec.slides || []) {
    if (slide._image?.path) fs.promises.unlink(slide._image.path).catch(() => {});
  }
  return outFile;
}

// mavzu (+ ixtiyoriy kontent) -> 2 bosqichli LLM -> spec -> .pptx
async function generatePresentation({ topic, slides, sourceContent, palette, theme, language, studentName, studentGroup, university, faculty, department, supervisor, llm, outFile }) {
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
  // LLM tanlagan palitra emas — dizayn mavzusi tasodifiy (yoki admin/foydalanuvchi tanlovi)
  spec.theme = theme || undefined;
  spec.language = language || "";
  spec.topic = topic;
  spec.palette = palette || undefined;

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
  return { outFile, slideCount: spec.slides.length, theme: spec.theme, palette: spec.palette, usedProvider };
}

module.exports = { buildPresentation, generatePresentation, ensureIcons, ICONS_DIR };
