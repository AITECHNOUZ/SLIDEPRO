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

test("dizayn mavzusi taqdimot mavzusiga mos tanlanadi, 12 ta mavzu bor", () => {
  const { THEMES, suitableThemes, pickDesign } = require("../src/generator/theme");
  assert.equal(Object.keys(THEMES).length, 12);
  assert.deepEqual(suitableThemes("Gaz pechini avtomatlashtirish"), ["engineering"]);
  assert.ok(suitableThemes("Amir Temur davlatchiligi tarixi").includes("heritage"));
  assert.ok(suitableThemes("Yurak kasalliklari profilaktikasi").includes("medical"));
  assert.ok(suitableThemes("Quyosh energiyasi va ekologiya").includes("nature"));
  assert.ok(suitableThemes("Sun`iy intellekt").includes("tech"), "turli apostroflar ham tanilsin");
  const picked = pickDesign({ topic: "Gaz pechini avtomatlashtirish", random: () => 0.1 });
  assert.equal(picked.themeKey, "engineering");
  assert.ok(THEMES.engineering.palettes.includes(picked.paletteKey));
});

test("yangi slayd turlari tekshiruvi: jadval, vaqt chizig'i, SWOT, sxema", () => {
  const table = validateSlide({ layout: "table", title: "Taqqoslash", headers: ["Mezon", "A", "B"], rows: [["Narx", "past", "yuqori"], ["Aniqlik", "±5", "±2"]] }, { layout: "table" });
  assert.equal(table.rows[0].length, 3);
  assert.throws(() => validateSlide({ layout: "table", title: "T", headers: ["Mezon", "A"], rows: [["", ""], ["x", ""]] }, { layout: "table" }), /bo'sh/);
  assert.throws(() => validateSlide({ layout: "timeline", title: "T", items: [{ date: "", title: "a b", desc: "uch so'zli tavsif bor" }] }, { layout: "timeline" }), /kamida|bo'sh/);
  const diagram = validateSlide({ layout: "diagram", title: "Sikl", diagram: { diagram_type: "cycle_diagram", nodes: ["A", "B", "C"].map((label, i) => ({ id: `s${i}`, label, kind: "stage" })), edges: [["s0", "s1"], ["s1", "s2"], ["s2", "s0"]].map(([from, to]) => ({ from, to })) } }, { layout: "diagram" });
  assert.equal(diagram.diagram.diagram_type, "cycle_diagram");
  assert.throws(() => validateSlide({ layout: "diagram", title: "X", diagram: { diagram_type: "pid_control_system", nodes: [], edges: [] } }, { layout: "diagram" }), /diagram_type/);
  assert.throws(() => validateSlide({ layout: "swot", title: "S", strengths: ["a"], weaknesses: [], opportunities: [], threats: [] }, { layout: "swot" }), /kamida/);
});
