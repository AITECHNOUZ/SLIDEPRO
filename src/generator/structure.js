// src/generator/structure.js
// Taqdimot tuzilmasi kafolati: titul(1) + reja(2) + mazmun + xulosa + adabiyotlar(oxirgi).
// Mazmun slaydlarining tartibi O'ZGARTIRILMAYDI (reja punktlari slaydlar ketma-ketligiga mos bo'lishi shart).

const { labels } = require("./i18n");

const SERVICE_LAYOUTS = new Set(["title", "agenda", "conclusion", "references"]);

function ensureStructure(spec, topic, { language } = {}) {
  const L = labels(language);
  let slides = Array.isArray(spec.slides) ? spec.slides.filter(Boolean) : [];

  // Titul — birinchi
  const ti = slides.findIndex(s => s.layout === "title");
  const titleSlide = ti >= 0 ? slides.splice(ti, 1)[0] : { layout: "title", title: spec.title || topic || "Taqdimot", meta: [] };
  // Adabiyotlar — oxirgi
  const ri = slides.findIndex(s => s.layout === "references");
  const refSlide = ri >= 0 ? slides.splice(ri, 1)[0] : { layout: "references", title: L.references, icon: "book" };
  const realRefs = Array.isArray(spec.references) ? spec.references.filter(Boolean) : [];
  refSlide.title = refSlide.title || L.references;
  refSlide.items = realRefs.length ? realRefs : (Array.isArray(refSlide.items) ? refSlide.items : []);
  refSlide.note = null;
  refSlide.thanks = refSlide.thanks || L.thanks;
  // Xulosa — adabiyotlardan oldin
  const ci = slides.findIndex(s => s.layout === "conclusion");
  const conclusion = ci >= 0 ? slides.splice(ci, 1)[0] : null;
  if (conclusion) conclusion.title = conclusion.title || L.conclusion;
  // Reja — ikkinchi (mazmun slaydlari sarlavhalaridan, ular tartibida)
  slides = slides.filter(s => s.layout !== "agenda");
  const content = slides.filter(s => !SERVICE_LAYOUTS.has(s.layout));
  const agendaItems = content.filter(s => s.title).map(s => ({ title: s.title })).slice(0, 8);
  const agenda = agendaItems.length ? [{ layout: "agenda", title: L.agenda, icon: "list", items: agendaItems }] : [];

  spec.slides = [titleSlide, ...agenda, ...content, ...(conclusion ? [conclusion] : []), refSlide];
  return spec;
}

module.exports = { ensureStructure, SERVICE_LAYOUTS };
