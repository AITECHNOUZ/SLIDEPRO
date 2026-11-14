const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSlide } = require("../src/generator/slide-validate");
const { normalizeOutlineSlides } = require("../src/generator/llm2");
const { ensureStructure } = require("../src/generator/structure");

test("slayd tekshiruvi: namuna matn va bo'sh kartochka rad etiladi, uzun matn qisqartiriladi", () => {
  const good = { layout: "feature-grid", title: "Tizim imkoniyatlari", icon: "nomalum", items: [1, 2, 3, 4].map(i => ({ icon: "bolt", title: `Imkoniyat ${i} nomi`, desc: "Harorat aniq ushlanadi va gaz sarfi sezilarli darajada kamayadi" })) };
  const result = validateSlide(good, { layout: "feature-grid" });
  assert.equal(result.icon, "star", "noma'lum ikonka almashtiriladi");
  assert.equal(result.items.length, 4);
  assert.throws(() => validateSlide({ ...good, items: [{ title: "<1-xususiyat>", desc: "<tavsif>" }, ...good.items.slice(1)] }, { layout: "feature-grid" }), /namuna matn/);
  assert.throws(() => validateSlide({ ...good, items: good.items.slice(0, 1) }, { layout: "feature-grid" }), /kamida/);
  const long = validateSlide({ ...good, items: good.items.map(item => ({ ...item, desc: Array(24).fill("so'z").join(" ") })) }, { layout: "feature-grid" });
  assert.ok(long.items[0].desc.endsWith("…"));
  assert.throws(() => validateSlide({ layout: "chart", title: "Grafik", chart: { labels: ["A", "B", "C"], values: [1, "x", 3] } }, { layout: "chart" }), /chart.values/);
});

test("reja aniq songa keltiriladi, xulosa oxirida, ketma-ket bir xil layout bo'lmaydi", () => {
  const slides = normalizeOutlineSlides([
    { title: "A", layout: "steps" }, { title: "B", layout: "steps" }, { title: "Xulosa", layout: "conclusion" }, { title: "C", layout: "nomalum" },
  ], 6, "Mavzu", "o'zbek");
  assert.equal(slides.length, 6);
  assert.equal(slides.at(-1).layout, "conclusion");
  slides.slice(0, -1).forEach((slide, index, all) => {
    assert.notEqual(slide.layout, "conclusion");
    if (index) assert.notEqual(slide.layout, all[index - 1].layout);
  });
});

test("tuzilma: titul, reja, mazmun tartibi saqlanadi, xulosa va adabiyotlar oxirida, til bo'yicha nomlar", () => {
  const spec = { title: "Mavzu", references: ["Ogata, K. (2010). Modern control engineering. Prentice Hall."], slides: [
    { layout: "steps", title: "Birinchi" }, { layout: "conclusion", title: "" }, { layout: "steps", title: "Ikkinchi" }, { layout: "feature-grid", title: "Uchinchi" },
  ] };
  ensureStructure(spec, "Mavzu", { language: "rus" });
  assert.deepEqual(spec.slides.map(slide => slide.layout), ["title", "agenda", "steps", "steps", "feature-grid", "conclusion", "references"]);
  assert.deepEqual(spec.slides[1].items.map(item => item.title), ["Birinchi", "Ikkinchi", "Uchinchi"]);
  assert.equal(spec.slides[1].title, "План");
  assert.equal(spec.slides.at(-1).title, "Список литературы");
  assert.equal(spec.slides.at(-2).title, "ЗАКЛЮЧЕНИЕ");
});
