// src/mustaqil/builder.js
// Mustaqil ish JSON spec → GOST formatli .docx
// Format: rasmlar asosida qayta ishlangan (2-sahifa: REJA, bob yo'q,
// har bo'lim yangi sahifadan, barcha matn qora)

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  Table, TableRow, TableCell, AlignmentType, PageBreak,
  Header, Footer, PageNumber, convertMillimetersToTwip,
  WidthType, BorderStyle, TableLayoutType, VerticalAlign,
  NumberFormat, SectionType, UnderlineType,
} = require("docx");
const sharp = require("sharp");
const { normalizeHeadingTitle } = require("./headings");
const { renumberMedia } = require("./media-numbering");
const { completeBibliography, sortReferencesAPA, parseApaPartsForDisplay } = require("./references");
const { cleanMediaText, isSyntheticSource } = require("./media-captions");
const { normalizeChartData } = require("./chart-data");
const { normalizeFlowchartData } = require("./flowchart-data");
const JSZip = require("jszip");
const { safeLatexToOmml, OMML_NAMESPACE } = require("./omml");

const mm = (n) => Math.round(n * 56.692);

const FONT = "Times New Roman";
const FONT_SIZE = 28;        // 14pt
const SMALL_SIZE = 24;       // 12pt (muqova uchun)
const LINE_SPACING = { line: 360, lineRule: "auto" };  // 1.5
const INDENT = mm(12.5);     // 1.25 sm
const BLACK = "000000";
const A4_PAGE_WIDTH_PX = 210 / 25.4 * 96;
const A4_PAGE_HEIGHT_PX = 297 / 25.4 * 96;
// GOST chizmalari ~6,2 dyuym (595 px) kenglikda: matn maydoni 165 mm = 624 px ichiga sig'adi.
const FIGURE_PAGE_FRACTION = 0.76;

// ─── OMML (Word native tenglama) ───────────────────────────
// Paragraf qurilayotganda formula o'rniga noyob belgi (token) qo'yiladi; Packer DOCX ni
// yig'gandan keyin document.xml ichida shu token turgan <w:r> butunlay <m:oMath> bilan
// almashtiriladi. Natija — Word'da tahrirlanadigan haqiqiy tenglama (rasm emas).
let activeMath = null;
const mathToken = (index) => `\u27E6OMML${index}\u27E7`;

function mathTokenRun(omml) {
  if (!activeMath || !omml) return null;
  activeMath.push(omml);
  return new TextRun({ text: mathToken(activeMath.length - 1), font: FONT, size: FONT_SIZE, color: BLACK });
}

// Matndagi $...$, \(...\), \[...\], $$...$$ bo'laklarini ajratish
const INLINE_MATH_RE = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$/g;

function splitInlineMath(text) {
  const parts = [];
  const source = String(text || "");
  let last = 0;
  let match;
  INLINE_MATH_RE.lastIndex = 0;
  while ((match = INLINE_MATH_RE.exec(source)) !== null) {
    // "100$" kabi valyuta belgisini formula deb olmaymiz
    if (match[4] != null && /\d\s?$/.test(source.slice(0, match.index))) continue;
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    parts.push({ math: match[1] ?? match[2] ?? match[3] ?? match[4], raw: match[0] });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}

async function injectOmml(buffer, formulas) {
  if (!formulas || !formulas.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) return buffer;
  let xml = await file.async("string");
  const runRe = /<w:r>(?:(?!<\/w:r>)[\s\S])*?\u27E6OMML(\d+)\u27E7(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g;
  xml = xml.replace(runRe, (whole, index) => formulas[Number(index)] || whole);
  if (!/xmlns:m=/.test(xml.slice(0, 4000))) {
    xml = xml.replace(/<w:document\b/, `<w:document xmlns:m="${OMML_NAMESPACE}"`);
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ─── inline LaTeX tozalash (sarlavha/izoh uchun — matn qaytaradi) ──
function cleanInlineLatex(text) {
  if (!text) return "";
  let t = String(text);
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => latexToUnicode(m));
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => latexToUnicode(m));
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => latexToUnicode(m));
  t = t.replace(/\$([^$]+?)\$/g, (_, m) => latexToUnicode(m));
  if (/\\[a-zA-Z]+|[_^]\{/.test(t)) t = latexToUnicode(t);
  // Qolgan X_n → X₁, X_word → Xword (sarlavha uchun yetarli)
  const subMap = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};
  t = t.replace(/([A-Za-z])_([0-9])/g, (_, b, d) => b + (subMap[d] || d));
  t = t.replace(/([A-Za-z])_([a-zA-Z][a-zA-Z0-9]*)/g, '$1$2');
  return t;
}

// ─── paragraf uchun: TextRun[] qaytaradi, X_sub → haqiqiy Word subscript ──
function parseTextRuns(rawText) {
  if (!rawText) return [new TextRun({ text: "", font: FONT, size: FONT_SIZE, color: BLACK })];
  let t = String(rawText);

  // 1) LaTeX delimiter'lar → latexToUnicode
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => latexToUnicode(m));
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => latexToUnicode(m));
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => latexToUnicode(m));
  t = t.replace(/\$([^$]+?)\$/g, (_, m) => latexToUnicode(m));
  if (/\\[a-zA-Z]+/.test(t)) t = latexToUnicode(t);

  // 2) X_sub, X_{sub}, X^sup, X^{sup} → Word TextRun with subScript/superScript
  const runs = [];
  // Pattern: base harf + subscript yoki superscript
  const re = /([A-Za-z])(?:_\{([^}]{1,20})\}|_([a-zA-Z][a-zA-Z0-9]{0,15}|[0-9]{1,3})|\^\{([^}]{1,20})\}|\^([a-zA-Z0-9]{1,10}))/g;
  let last = 0, m;
  while ((m = re.exec(t)) !== null) {
    // Mos kelishidan oldingi oddiy matn
    if (m.index > last) {
      runs.push(new TextRun({ text: t.slice(last, m.index), font: FONT, size: FONT_SIZE, color: BLACK }));
    }
    // Asosiy harf
    runs.push(new TextRun({ text: m[1], font: FONT, size: FONT_SIZE, color: BLACK }));
    const sub = m[2] != null ? m[2] : m[3]; // _{ } yoki _x
    const sup = m[4] != null ? m[4] : m[5]; // ^{ } yoki ^x
    if (sub != null) {
      runs.push(new TextRun({ text: sub, font: FONT, size: FONT_SIZE, subScript: true, color: BLACK }));
    } else if (sup != null) {
      runs.push(new TextRun({ text: sup, font: FONT, size: FONT_SIZE, superScript: true, color: BLACK }));
    }
    last = m.index + m[0].length;
  }
  // Qolgan matn
  if (last < t.length) {
    runs.push(new TextRun({ text: t.slice(last), font: FONT, size: FONT_SIZE, color: BLACK }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text: t, font: FONT, size: FONT_SIZE, color: BLACK })];
}

function latexToUnicode(s) {
  let t = String(s);
  t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");
  t = t.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  t = t.replace(/\\times/g,"×").replace(/\\cdot/g,"·").replace(/\\div/g,"÷");
  t = t.replace(/\\pm/g,"±").replace(/\\leq/g,"≤").replace(/\\geq/g,"≥")
       .replace(/\\neq/g,"≠").replace(/\\approx/g,"≈").replace(/\\infty/g,"∞");
  t = t.replace(/\\sum/g,"Σ").replace(/\\prod/g,"∏").replace(/\\int/g,"∫")
       .replace(/\\partial/g,"∂").replace(/\\nabla/g,"∇");
  const greek = { alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",theta:"θ",
    lambda:"λ",mu:"μ",pi:"π",rho:"ρ",sigma:"σ",tau:"τ",phi:"φ",omega:"ω",
    Delta:"Δ",Sigma:"Σ",Omega:"Ω",Pi:"Π",Gamma:"Γ",Theta:"Θ",Lambda:"Λ",Phi:"Φ" };
  Object.keys(greek).forEach((k) => { t = t.replace(new RegExp("\\\\"+k+"\\b","g"), greek[k]); });
  const sub = {"0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉","+":"₊","-":"₋","n":"ₙ","i":"ᵢ","a":"ₐ","x":"ₓ"};
  const sup = {"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","+":"⁺","-":"⁻","n":"ⁿ","i":"ⁱ"};
  t = t.replace(/_\{([^{}]+)\}/g,(_,m)=>m.split("").map(c=>sub[c]||c).join(""));
  t = t.replace(/_([a-zA-Z0-9])/g,(_,c)=>sub[c]||("_"+c));
  t = t.replace(/\^\{([^{}]+)\}/g,(_,m)=>m.split("").map(c=>sup[c]||c).join(""));
  t = t.replace(/\^([a-zA-Z0-9])/g,(_,c)=>sup[c]||("^"+c));
  t = t.replace(/[{}]/g,"").replace(/\\([a-zA-Z]+)/g,"$1").replace(/\\/g,"");
  return t.replace(/\s+/g," ").trim();
}

// LLM kiritgan "1-bob", "Bob 1", "2-bo'lim" kabi strukturaviy yorliqlarni olib tashlash.
function stripBob(title) {
  return normalizeHeadingTitle(title);
}

// ─── paragraph helpers ─────────────────────────────────────
function run(text, opts = {}) {
  return new TextRun({ text: cleanInlineLatex(String(text)), font: FONT,
    size: opts.size || FONT_SIZE, bold: opts.bold || false,
    italics: opts.italic || false, color: BLACK, ...opts.extra });
}

function para(text, opts = {}) {
  // $...$ ichidagi formulalar → inline OMML; qolgan matn parseTextRuns orqali
  // (X_sub → Word subscript, X^sup → superscript).
  const runs = [];
  for (const part of splitInlineMath(String(text || ""))) {
    if (part.math != null) {
      const omml = activeMath ? safeLatexToOmml(part.math, { display: false }) : null;
      const token = omml ? mathTokenRun(omml) : null;
      if (token) runs.push(token);
      else runs.push(...parseTextRuns(part.raw));
    } else if (part.text) {
      runs.push(...parseTextRuns(part.text));
    }
  }
  if (!runs.length) runs.push(...parseTextRuns(""));
  // bold/italic opts qo'llash kerak bo'lsa — barcha runlarga qo'shamiz
  if (opts.bold || opts.italic) {
    runs.forEach(r => { if (opts.bold) r.bold = true; if (opts.italic) r.italics = true; });
  }
  return new Paragraph({
    children: runs,
    spacing: LINE_SPACING,
    alignment: opts.align || AlignmentType.JUSTIFIED,
    indent: opts.noIndent ? undefined : { firstLine: INDENT },
  });
}

function centeredPara(text, opts = {}) {
  return new Paragraph({
    children: [run(text, { ...opts })],
    spacing: opts.spacing || LINE_SPACING,
    alignment: AlignmentType.CENTER,
    indent: undefined,
  });
}

function emptyLine(lines = 1) {
  const arr = [];
  for (let i = 0; i < lines; i++) {
    arr.push(new Paragraph({ children: [new TextRun("")], spacing: { line: 240 } }));
  }
  return arr;
}

function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()], spacing: { line: 240 } });
}

function heading1(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: stripBob(text).toUpperCase(), font: FONT, size: FONT_SIZE, bold: true, color: BLACK })],
    pageBreakBefore: opts.pageBreakBefore || undefined,
    spacing: { ...LINE_SPACING, before: mm(4), after: mm(2) },
    alignment: AlignmentType.CENTER,
    indent: undefined,
  });
}

function heading2(text) {
  return new Paragraph({
    children: [new TextRun({ text: stripBob(text), font: FONT, size: FONT_SIZE, bold: true, color: BLACK })],
    spacing: { ...LINE_SPACING, before: mm(3), after: mm(2) },
    alignment: AlignmentType.LEFT,
    indent: { firstLine: INDENT },
  });
}

function captionPara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: SMALL_SIZE, italics: true, color: BLACK })],
    spacing: { line: 240, before: mm(1), after: mm(2) },
    keepLines: true,
    alignment: AlignmentType.CENTER,
    indent: undefined,
  });
}

function numberedMediaCaption(number, type, ...values) {
  const prefix = new RegExp(`^\\s*(?:n|\\d+)\\s*[-–—.]?\\s*${type}\\s*\\.?\\s*[:.)-]?\\s*`, "i");
  const title = values
    .map(value => cleanMediaText(String(value || "").replace(prefix, "").trim()))
    .find(value => value.length > 0) || "";
  return `${number}-${type}. ${title}`;
}

// ─── rasm bloki ────────────────────────────────────────────
function imageBlock(media, caption, { maxPageFraction = 0.6, maxHeightFraction = 0.6 } = {}) {
  const buf = media.buf || media;
  const w = media.width || 440;
  const h = media.height || 200;
  const heightFraction = maxPageFraction ? Math.min(maxPageFraction, maxHeightFraction) : null;
  const scale = maxPageFraction
    ? Math.min(1, A4_PAGE_WIDTH_PX * maxPageFraction / w, A4_PAGE_HEIGHT_PX * heightFraction / h)
    : 1;
  const maxWidth = maxPageFraction ? Math.floor(A4_PAGE_WIDTH_PX * maxPageFraction) : Infinity;
  const maxHeight = maxPageFraction ? Math.floor(A4_PAGE_HEIGHT_PX * heightFraction) : Infinity;
  const imageWidth = Math.max(1, Math.min(maxWidth, Math.round(w * scale)));
  const imageHeight = Math.max(1, Math.min(maxHeight, Math.round(h * scale)));
  const nodes = [];
  nodes.push(new Paragraph({
    children: [new ImageRun({ data: buf, transformation: { width: imageWidth, height: imageHeight }, type: "png" })],
    spacing: { before: mm(3), after: mm(1) },
    keepNext: Boolean(caption),
    keepLines: true,
    alignment: AlignmentType.CENTER,
    indent: undefined,
  }));
  if (caption) nodes.push(captionPara(caption));
  return nodes;
}

async function verifiedImageCache(chapters, pngCache) {
  const cache = new Map(pngCache instanceof Map ? pngCache : []);
  const checkedKeys = new Set();
  const prefixByType = { formula: "f", chart: "c", flowchart: "d" };
  for (const chapter of chapters || []) {
    for (const item of chapter.content || []) {
      const prefix = prefixByType[item?.type];
      if (!prefix || !Number.isFinite(Number(item.number))) continue;
      const key = `${prefix}_${item.number}`;
      if (!cache.has(key) || checkedKeys.has(key)) continue;
      checkedKeys.add(key);
      const media = cache.get(key);
      try {
        if (item.type === "chart") normalizeChartData(item);
        if (item.type === "flowchart") normalizeFlowchartData(item);
        const buf = Buffer.isBuffer(media) ? media : media?.buf;
        const width = Buffer.isBuffer(media) ? 440 : Number(media?.width);
        const height = Buffer.isBuffer(media) ? 200 : Number(media?.height);
        if (!Buffer.isBuffer(buf) || !buf.length || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          throw new Error("rasm buferi yoki o‘lchami yaroqsiz");
        }
        const metadata = await sharp(buf).metadata();
        if (metadata.format !== "png" || !metadata.width || !metadata.height) {
          throw new Error("render natijasi yaroqli PNG emas");
        }
      } catch (error) {
        cache.delete(key);
        console.warn(`[mustaqil] ${item.type} #${item.number} tekshiruvdan o‘tmadi — rasm DOCX’ga qo‘shilmadi (${error.message})`);
      }
    }
  }
  return cache;
}

// ─── jadval bloki ──────────────────────────────────────────
function tableBlock(data, caption) {
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  // Jadval bo'sh bo'lsa — umuman chiqarmaymiz
  if (headers.length === 0 && rows.length === 0) return [];
  const nodes = [];
  const finalCaption = cleanMediaText(caption);
  if (finalCaption) nodes.push(captionPara(finalCaption));
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, font: FONT, size: FONT_SIZE, bold: true, color: BLACK })],
        alignment: AlignmentType.CENTER, spacing: { line: 240 }, indent: undefined,
      })],
      shading: { fill: "EAF2F6" }, verticalAlign: VerticalAlign.CENTER,
      margins: { top: mm(1.5), bottom: mm(1.5), left: mm(2), right: mm(2) },
    })),
  });
  const dataRows = rows.filter(row => Array.isArray(row)).map((row) => new TableRow({
    children: row.map((cell) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: cell == null ? "" : String(cell), font: FONT, size: FONT_SIZE, color: BLACK })],
        spacing: { line: 240 }, indent: undefined,
      })],
      margins: { top: mm(1.5), bottom: mm(1.5), left: mm(2), right: mm(2) },
    })),
  }));
  nodes.push(new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top:     { style: BorderStyle.SINGLE, size: 6, color: "999999" },
      bottom:  { style: BorderStyle.SINGLE, size: 6, color: "999999" },
      left:    { style: BorderStyle.SINGLE, size: 6, color: "999999" },
      right:   { style: BorderStyle.SINGLE, size: 6, color: "999999" },
      insideH: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      insideV: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
    },
  }));
  return nodes;
}

// ─── MUQOVA SAHIFASI ────────────────────────────────────────
// A4 kontent maydoni: 257mm balandlik
// Bloklar: Vazirlik(top) → Org chiziqlar → [bo'shliq] →
//          MUSTAQIL ISH(markazga) → Mavzu 18pt → Talaba(o'ng) → [bo'shliq] → Shahar chiziq(pastda)
function buildCoverPage(meta) {
  const year  = String(new Date().getFullYear());
  const UL28  = "_____________________________";   // 29 belgi ≈ 65mm (org chiziqlari uchun)
  const UL22  = "_____________________";            // 22 belgi ≈ 50mm (shahar uchun)
  const SZ14  = FONT_SIZE;                          // 14pt
  const SZ18  = 36;                                 // 18pt = 36 half-point

  // Qator yordamchi: font, o'lcham, qalinlik, rang
  const r = (text, bold = false, size = SZ14) =>
    new TextRun({ text, font: FONT, size, bold, color: BLACK });

  // Markazlangan paragraf
  const cp = (children, spacingOpts = {}) => new Paragraph({
    children,
    alignment: AlignmentType.CENTER,
    indent: undefined,
    spacing: { line: 280, ...spacingOpts },
  });

  // O'ng tomonlama paragraf
  const rp = (children) => new Paragraph({
    children,
    alignment: AlignmentType.RIGHT,
    indent: undefined,
    spacing: { line: 320 },
  });

  // Chiziq + label (markazda): "_____________ UNIVERSITETI"
  const ulLine = (label) => cp([
    r(UL28 + "  "),
    r(label, true, SZ14),
  ]);

  return [
    // ── 1. VAZIRLIK (yuqorida, 14pt qalin) ──────────────────
    cp([r("O'ZBEKISTON RESPUBLIKASI OLIY TA'LIM, FAN VA", true)],
      { before: mm(8) }),
    cp([r("INNOVATSIYALAR VAZIRLIGI", true)], { after: mm(10) }),

    // ── 2. TASHKILOT CHIZIQLARI ──────────────────────────────
    ulLine("UNIVERSITETI"),
    ulLine("FAKULTETI"),
    ulLine("KAFEDRASI"),

    // ── 3. MUSTAQIL ISH — sahifa markazida (before = katta) ──
    // Yuqori blok ≈ 55mm → MUSTAQIL ISH ≈ 120mm dan boshlaydi (markazga yaqin)
    cp([r("MUSTAQIL ISH", true, 36)], { before: mm(44), after: mm(14) }),

    // ── 4. MAVZU — 18pt ──────────────────────────────────────
    cp([r("Mavzu:", false, SZ18)], { before: mm(0) }),
    cp([r('"' + (meta.title || "") + '"', true, SZ18)],
      { before: mm(4), after: mm(18) }),

    // ── 5. TALABA MA'LUMOTLARI (o'ng tomondan) ───────────────
    rp([r("Bajardi:  "), r(meta.student_name || "____________________", true)]),
    rp([r("Guruh:    "), r(meta.student_group || "____________________", true)]),
    rp([r("Tekshirdi:"), r("  " + (meta.supervisor || "____________________"), true)]),

    // ── 6. SHAHAR + YIL — sahifa pastida ─────────────────────
    // before = katta qiymat → yil sahifa pastiga siqadi
    // pageBreakPara yo'q — section2 NEXT_PAGE o'zi sahifa almashtiradi
    cp([r(UL22 + " — " + year)], { before: mm(70) }),
  ];
}

// ─── REJA SAHIFASI ──────────────────────────────────────────
// 2-sahifa: Kirish + faqat raqamlangan asosiy reja bandlari + Xulosa + adabiyotlar.
function buildReja(chapters, meta) {
  const nodes = [];
  // Mavzu takrorlanadi
  nodes.push(new Paragraph({
    children: [new TextRun({ text: `Mavzu: ${meta.title || ""}`, font: FONT, size: FONT_SIZE, bold: true, color: BLACK })],
    alignment: AlignmentType.CENTER, spacing: { line: 280, after: mm(4) }, indent: undefined,
  }));
  // REJA sarlavhasi
  nodes.push(new Paragraph({
    children: [new TextRun({ text: "REJA", font: FONT, size: FONT_SIZE, bold: true, color: BLACK })],
    alignment: AlignmentType.CENTER, spacing: { line: 280, after: mm(4) }, indent: undefined,
  }));

  // Ichki bo'limlar hujjat matnida qoladi, lekin reja sahifasida ko'rsatilmaydi.
  const list = buildRejaItems(chapters);

  list.forEach((item) => {
    nodes.push(new Paragraph({
      children: [new TextRun({
        text: item.num ? `${item.num}. ${item.text}` : item.text,
        font: FONT, size: FONT_SIZE, color: BLACK,
        bold: item.level === 1,
      })],
      spacing: { line: 300 },
      indent: item.level === 2 ? { left: mm(10) } : undefined,
    }));
  });

  return nodes;
}

function buildRejaItems(chapters = []) {
  const mainSections = chapters.filter(ch => ch.id !== "intro" && ch.id !== "conclusion");
  const items = [{ text: "Kirish", level: 1 }];
  mainSections.forEach((section, index) => {
    items.push({ num: String(index + 1), text: stripBob(section.title || ""), level: 1 });
  });
  items.push({ text: "Xulosa", level: 1 });
  items.push({ text: "Foydalanilgan adabiyotlar", level: 1 });
  return items;
}

// ─── BOB KONTENTI ──────────────────────────────────────────
function buildChapterContent(chapter, pngCache, isFirst, mainNumber = 0) {
  const nodes = [];
  // Heading page-break avoids an accidental blank page when previous content
  // ended exactly at the bottom margin.

  // Sarlavha
  const title = stripBob(chapter.title || "");
  const numberedTitle = chapter.id !== "intro" && chapter.id !== "conclusion" && mainNumber
    ? `${mainNumber}. ${title}`
    : title;
  if (chapter.level === 1) nodes.push(heading1(numberedTitle, { pageBreakBefore: !isFirst || chapter.id === "intro" }));
  else nodes.push(heading2(numberedTitle));

  (chapter.content || []).forEach((item) => {
    if (!item || !item.type) return;
    switch (item.type) {
      case "paragraph":
        if (item.text != null && String(item.text).trim()) nodes.push(para(String(item.text).trim()));
        break;
      case "heading":
        nodes.push(item.level === 2 ? heading2(item.text || "") : heading1(item.text || ""));
        break;
      case "formula": {
        const caption = numberedMediaCaption(item.number, "formula", item.caption, item.display_text, item.latex);
        // 1) Asosiy yo'l: Word native tenglama (OMML)
        const omml = activeMath ? safeLatexToOmml(item.latex, { display: true }) : null;
        const token = omml ? mathTokenRun(omml) : null;
        const media = pngCache && pngCache.get("f_" + item.number);
        if (token) {
          nodes.push(new Paragraph({
            children: [token],
            spacing: { ...LINE_SPACING, before: mm(3), after: mm(1) },
            keepNext: true,
            keepLines: true,
            alignment: AlignmentType.CENTER,
            indent: undefined,
          }));
          nodes.push(captionPara(`(${caption})`));
        } else if (media) {
          // 2) Zaxira: MathJax PNG (LaTeX OMML ga o'girilmasa)
          nodes.push(...imageBlock(media, `(${caption})`));
        } else {
          nodes.push(new Paragraph({
            children: [new TextRun({ text: item.display_text || item.latex || "", font: FONT, size: FONT_SIZE, italics: true, color: BLACK })],
            spacing: { ...LINE_SPACING, before: mm(3), after: mm(3) },
            alignment: AlignmentType.CENTER, indent: undefined,
          }));
          nodes.push(captionPara(`(${caption})`));
        }
        // "bu yerda: U — kuchlanish, V; ..." — belgilarning izohi (GOST 7.32 talabi)
        const where = String(item.where || item.explanation || "").trim();
        if (where) {
          const whereText = /^bu yerda|^где|^where/i.test(where) ? where : `bu yerda ${where}`;
          nodes.push(para(whereText, { noIndent: true, align: AlignmentType.JUSTIFIED }));
        }
        break;
      }
      case "chart": {
        const media = pngCache && pngCache.get("c_" + item.number);
        const chartCaption = numberedMediaCaption(item.number, "rasm", item.caption, item.title);
        const dataSource = String(item.data_source || item.source || "").trim();
        const captionWithSource = dataSource && !isSyntheticSource(dataSource) && !chartCaption.toLowerCase().includes(dataSource.toLowerCase())
          ? `${chartCaption} Manba/izoh: ${dataSource}`
          : chartCaption;
        if (media) {
          nodes.push(...imageBlock(media, captionWithSource, { maxPageFraction: FIGURE_PAGE_FRACTION }));
        } else {
          // Render qilinmagan bo'lsa — ma'lumotni matn ko'rinishida ko'rsatamiz,
          // hech bo'lmaganda grafik ma'lumoti hujjatda yo'qolmaydi
          console.warn(`[mustaqil] chart #${item.number} render qilinmagan — matn ko'rinishida chiqariladi`);
          const labels = Array.isArray(item.labels) ? item.labels : [];
          const values = Array.isArray(item.values) ? item.values : [];
          const dataStr = labels.map((l, i) => `${l}: ${values[i] != null ? values[i] : "?"}`).join("; ");
          nodes.push(captionPara(captionWithSource));
          nodes.push(new Paragraph({
            children: [new TextRun({ text: `[Grafik: ${cleanMediaText(item.title, "Grafik")} — ${dataStr}]`, font: FONT, size: FONT_SIZE, italics: true, color: BLACK })],
            spacing: { ...LINE_SPACING, before: mm(2), after: mm(2) },
            alignment: AlignmentType.CENTER, indent: undefined,
          }));
        }
        break;
      }
      case "flowchart": {
        const media = pngCache && pngCache.get("d_" + item.number);
        const caption = numberedMediaCaption(item.number, "rasm", item.caption, item.title);
        if (media) {
          nodes.push(...imageBlock(media, caption, { maxPageFraction: FIGURE_PAGE_FRACTION }));
        } else {
          console.warn(`[mustaqil] flowchart #${item.number} render qilinmagan — matn ko'rinishida chiqariladi`);
          nodes.push(captionPara(caption));
          nodes.push(new Paragraph({
            children: [new TextRun({ text: `[Oqim sxemasi: ${cleanMediaText(item.title, "Oqim sxemasi")}]`, font: FONT, size: FONT_SIZE, italics: true, color: BLACK })],
            spacing: { ...LINE_SPACING, before: mm(2), after: mm(2) },
            alignment: AlignmentType.CENTER, indent: undefined,
          }));
        }
        break;
      }
      case "table": {
        const caption = numberedMediaCaption(item.number, "jadval", item.caption, item.title);
        nodes.push(...tableBlock(item, caption));
        break;
      }
    }
  });
  return nodes;
}

// ─── ADABIYOTLAR RO'YXATI ──────────────────────────────────
function buildReferences(refs = [], topic = "mavzu") {
  const nodes = [
    new Paragraph({
      children: [new TextRun({ text: "Foydalanilgan adabiyotlar ro'yxati", font: FONT, size: 24, bold: true, color: BLACK })],
      pageBreakBefore: true,
      spacing: { line: 480, lineRule: "auto", before: 0, after: 0 },
      alignment: AlignmentType.CENTER,
      indent: undefined,
    }),
  ];
  sortReferencesAPA(completeBibliography(refs, { topic })).forEach((ref, index) => {
    const parts = parseApaPartsForDisplay(ref);
    const run = (text, italics = false) => new TextRun({ text: cleanInlineLatex(text), font: FONT, size: 24, italics, color: BLACK });
    const children = parts
      ? [run(`${index + 1}. ${parts.authorDate} `), ...(parts.kind === "journal"
        ? [run(parts.title), run(". "), run(parts.journal, true), run(", "), run(parts.volume, true), ...(parts.issue ? [run(`(${parts.issue})`)] : []), run(parts.suffix)]
        : [run(parts.title, true), run(`. ${parts.publication}`)])]
      : [run(`${index + 1}. ${ref}`)];
    nodes.push(new Paragraph({
      children,
      alignment: AlignmentType.LEFT,
      spacing: { line: 300, lineRule: "auto", before: 0, after: mm(1) },
      indent: { left: mm(8), hanging: mm(8) },
    }));
  });
  return nodes;
}

// ─── ASOSIY BUILDER ────────────────────────────────────────
async function buildDocument(fullSpec, pngCache) {
  const { meta, chapters = [], references = [] } = fullSpec;
  renumberMedia(chapters);
  const safePngCache = await verifiedImageCache(chapters, pngCache);

  // Joriy yilni majburiy o'rnatish (LLM eski yil yozishi mumkin)
  if (meta) meta.year = String(new Date().getFullYear());

  // Sinxron qurilish davomida formulalar shu ro'yxatga yig'iladi (parallel buyurtmalar
  // bir-biriga aralashmaydi: tugunlar qurilishi orasida await yo'q).
  const formulas = [];
  activeMath = formulas;
  try {
  const coverNodes = buildCoverPage(meta);
  const rejaNodes  = buildReja(chapters, meta);

  const contentNodes = [];
  let mainNumber = 0;
  chapters.forEach((ch, i) => {
    // Kirish headingi pageBreakBefore bilan REJA'dan keyin boshlanadi.
    if (ch.id !== "intro" && ch.id !== "conclusion") mainNumber++;
    const chNodes = buildChapterContent(ch, safePngCache, i === 0, mainNumber);
    contentNodes.push(...chNodes);
  });

  const refNodes = buildReferences(references, meta?.title);

  const footerPara = new Paragraph({
    children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 24, color: BLACK })],
    alignment: AlignmentType.CENTER, indent: undefined,
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run:       { font: FONT, size: FONT_SIZE, color: BLACK },
          paragraph: { spacing: LINE_SPACING },
        },
      },
    },
    sections: [
      // 1-sahifa: Muqova — raqamsiz
      {
        properties: {
          page: {
            margin: { left: mm(30), right: mm(15), top: mm(20), bottom: mm(20) },
          },
        },
        footers: { default: new Footer({ children: [] }) },
        children: coverNodes,
      },
      // 2+ sahifa: REJA + kontent — raqamlash 2-dan
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            margin: { left: mm(30), right: mm(15), top: mm(20), bottom: mm(20) },
            pageNumbers: { start: 2, formatType: NumberFormat.DECIMAL },
          },
        },
        footers: { default: new Footer({ children: [footerPara] }) },
        children: [...rejaNodes, ...contentNodes, ...refNodes],
      },
    ],
  });

  activeMath = null;
  const packed = await Packer.toBuffer(doc);
  return injectOmml(packed, formulas);
  } finally {
    if (activeMath === formulas) activeMath = null;
  }
}

module.exports = { buildDocument, buildRejaItems, splitInlineMath, injectOmml };
