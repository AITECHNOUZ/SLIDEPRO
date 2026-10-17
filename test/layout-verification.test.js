const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateRenderedLayout, parseBboxLayout, verifyDocxLayout } = require("../src/mustaqil/layout-verification");

const chapters = [
  { id: "intro", title: "Kirish", content: [{ type: "paragraph", text: "Kirish bo'limi uchun to'liq namunaviy matn." }] },
  { id: "ch1", title: "Tahlil", content: [] },
  { id: "conclusion", title: "Xulosa", content: [{ type: "paragraph", text: "Xulosa uchun to'liq namunaviy matn." }] },
];
const references = ["Muallif A. (2024). Birinchi manba.", "Muallif B. (2025). Ikkinchi manba."];

test("render qilingan sahifalarda Kirish, Xulosa va manbalar bittadan sahifaga sig'ishi tasdiqlanadi", () => {
  const result = evaluateRenderedLayout({
    pageCount: 5,
    maxPages: 7,
    chapters,
    references,
    pages: [
      "MUQOVA",
      "REJA",
      "KIRISH\nKirish bo'limi uchun to'liq namunaviy matn.",
      "XULOSA\nXulosa uchun to'liq namunaviy matn.",
      "FOYDALANILGAN ADABIYOTLAR RO'YXATI\n" + references.join("\n"),
    ],
  });
  assert.equal(result.status, "verified");
  assert.equal(result.actualPageCount, 5);
  assert.deepEqual(result.errors, []);
});

test("Kirish matni sahifaga bo'linib ketsa yakuniy DOCX layouti rad etiladi", () => {
  const result = evaluateRenderedLayout({
    pageCount: 6,
    maxPages: 8,
    chapters,
    references,
    pages: [
      "MUQOVA", "REJA", "KIRISH\nKirish bo'limi uchun to'liq", "namunaviy matn.",
      "XULOSA\nXulosa uchun to'liq namunaviy matn.",
      "FOYDALANILGAN ADABIYOTLAR RO'YXATI\n" + references.join("\n"),
    ],
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join(" "), /Kirish matnining 1 paragrafi/);
});

test("haqiqiy PDF sahifalari reja +2 maksimumidan oshsa rad etiladi", () => {
  const result = evaluateRenderedLayout({
    pageCount: 9,
    maxPages: 8,
    chapters: [],
    references: [],
    pages: Array.from({ length: 9 }, (_, index) => `Page ${index + 1}`),
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors[0], /Haqiqiy sahifalar soni 9; ruxsat etilgan maksimum 8/);
});

function bboxLine(text, y) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const markup = words.map((word, index) => `<word xMin="60" yMin="${y}" xMax="${80 + index * 10}" yMax="${y + 10}">${word.replace(/&/g, "&amp;").replace(/'/g, "&apos;")}</word>`).join("");
  return `<line xMin="60" yMin="${y}" xMax="500" yMax="${y + 10}">${markup}</line>`;
}

function bboxPage(lines) {
  return `<page width="595.303937" height="841.889764"><flow><block>${lines.join("")}</block></flow></page>`;
}

function introLayoutWithSpill(secondPageY) {
  const paragraph = "Kirish bo'limi uchun to'liq namunaviy matn.";
  const words = paragraph.split(/\s+/);
  const markup = [
    bboxPage([bboxLine("KIRISH", 57), bboxLine(words.slice(0, 3).join(" "), 760)]),
    bboxPage([bboxLine(words.slice(3).join(" "), secondPageY)]),
  ].join("");
  const pageGeometry = parseBboxLayout(markup);
  const pages = pageGeometry.map(page => page.lines.map(line => line.text).join("\n"));
  const result = evaluateRenderedLayout({
    pageCount: pageGeometry.length,
    maxPages: 2,
    pages,
    pageGeometry,
    chapters: [{ id: "intro", title: "Kirish", content: [{ type: "paragraph", text: paragraph }] }],
  });
  return result;
}

test("Kirishning haqiqiy PDF bbox hajmi 1,2 sahifa ekvivalentigacha ruxsat etiladi", () => {
  const result = introLayoutWithSpill(190);
  assert.equal(result.status, "verified");
  assert.equal(result.maxSectionPages, 1.2);
  assert.equal(result.sectionPageEquivalents.Kirish.startPage, 1);
  assert.equal(result.sectionPageEquivalents.Kirish.endPage, 2);
  assert.ok(result.sectionPageEquivalents.Kirish.pageEquivalents > 1);
  assert.ok(result.sectionPageEquivalents.Kirish.pageEquivalents <= 1.2);
  assert.deepEqual(result.errors, []);
});

test("Kirishning haqiqiy PDF bbox hajmi 1,2 sahifadan oshsa rad etiladi", () => {
  const result = introLayoutWithSpill(220);
  assert.equal(result.status, "failed");
  assert.ok(result.sectionPageEquivalents.Kirish.pageEquivalents > 1.2);
  assert.match(result.errors.join(" "), /Kirish hajmi .* sahifa ekvivalentida; ruxsat etilgan chegara 1\.2 sahifa/);
});

test("bbox-layout parser sahifa koordinatalari va XML entity apostroflarini saqlaydi", () => {
  const [page] = parseBboxLayout(bboxPage([bboxLine("O'zbekiston", 60)]));
  assert.equal(page.height, 841.889764);
  assert.equal(page.lines[0].text, "O'zbekiston");
  assert.equal(page.lines[0].words[0].yMin, 60);
});

test("LibreOffice yo'q bo'lsa haqiqiy bet soni da'vo qilinmaydi va verification unavailable qaytaradi", async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const result = await verifyDocxLayout(Buffer.from("not a real docx"), { maxPages: 7 });
    assert.equal(result.status, "unavailable");
    assert.equal(result.actualPageCount, null);
    assert.equal(result.maxExpectedPages, 7);
    assert.match(result.reason, /LibreOffice topilmadi/);
  } finally {
    if (originalPath == null) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});
