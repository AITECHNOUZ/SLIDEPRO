// src/mustaqil/page-fit.js
// So'ralgan sahifa soniga moslash: tayyor DOCX ni LibreOffice bilan PDF'ga aylantirib,
// HAQIQIY sahifalar sonini o'lchaydi va matnni aniq joyidan qisqartiradi yoki kengaytiradi.
//
// Nega kerak: so'z budjeti (~265 so'z/bet) taxminiy. Har asosiy bo'lim yangi betdan
// boshlangani uchun bitta bo'limning 3 qatori keyingi betga "toshib" o'tsa, butun bet
// qo'shiladi. Shuning uchun har bobning OXIRGI beti qanchalik to'lganini o'lchaymiz:
//   • bet ko'p bo'lsa — oxirgi beti eng bo'sh (toshib o'tgan) bobni shu qatorlar qadar qisqartiramiz;
//   • bet kam bo'lsa — oxirgi beti eng to'la bobga yangi betning yarmigacha matn qo'shamiz.
//
// Modul tashqi bog'liqliksiz (faqat LibreOffice + poppler-utils CLI); yo'q bo'lsa — "skipped".

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const WORDS_PER_PAGE = 265;
// A4, yuqori/pastki 20 mm, 14 pt, 1,5 interval ≈ 30–31 qator; pdftotext bo'sh qatorlarni tashlaydi.
const LINES_PER_PAGE = 30;
const MIN_PARAGRAPH_WORDS = 35;

function commandAvailable(command) {
  return String(process.env.PATH || "").split(path.delimiter).filter(Boolean).some(directory => {
    try {
      fs.accessSync(path.join(directory, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function officeCommand() {
  if (process.env.SLIDEPRO_SOFFICE) return process.env.SLIDEPRO_SOFFICE;
  return ["soffice", "libreoffice"].find(commandAvailable) || null;
}

function pageFitEnabled() {
  const flag = String(process.env.SLIDEPRO_PAGE_FIT || "").toLowerCase();
  if (["0", "false", "off", "no"].includes(flag)) return false;
  if (["1", "true", "on", "yes"].includes(flag)) return Boolean(officeCommand());
  // Standart: production'da yoqilgan (Dockerfile NODE_ENV=production), testlarda o'chiq.
  return process.env.NODE_ENV === "production" && Boolean(officeCommand());
}

/**
 * DOCX → PDF → sahifalar soni va har betning matni.
 * @returns {{pageCount:number, pages:string[]}|null}
 */
function measureDocx(docxBuffer) {
  const office = officeCommand();
  if (!office || !Buffer.isBuffer(docxBuffer) || !docxBuffer.length) return null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "slidepro-pagefit-"));
  try {
    const docxPath = path.join(tempDir, "work.docx");
    const profileDir = path.join(tempDir, "profile");
    fs.mkdirSync(profileDir);
    fs.writeFileSync(docxPath, docxBuffer);
    const converted = spawnSync(office, [
      "--headless", "--norestore",
      `-env:UserInstallation=file://${profileDir}`,
      "--convert-to", "pdf", "--outdir", tempDir, docxPath,
    ], { cwd: tempDir, encoding: "utf8", timeout: 150_000, maxBuffer: 4 * 1024 * 1024 });
    const pdfPath = path.join(tempDir, "work.pdf");
    if (converted.error || !fs.existsSync(pdfPath)) {
      throw new Error(`LibreOffice PDF yaratmadi: ${String(converted.error?.message || converted.stderr || converted.status).slice(0, 300)}`);
    }
    let pages = null;
    if (commandAvailable("pdftotext")) {
      const text = spawnSync("pdftotext", ["-enc", "UTF-8", "-layout", pdfPath, "-"], { encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
      if (!text.error && text.status === 0) {
        pages = text.stdout.split("\f");
        if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
      }
    }
    let pageCount = pages ? pages.length : null;
    if (commandAvailable("pdfinfo")) {
      const info = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8", timeout: 20_000 });
      const parsed = Number(String(info.stdout || "").match(/^Pages:\s+(\d+)/m)?.[1]);
      if (Number.isFinite(parsed) && parsed > 0) pageCount = parsed;
    }
    if (!pageCount) {
      const raw = fs.readFileSync(pdfPath, "latin1");
      pageCount = (raw.match(/\/Type\s*\/Page(?!s)/g) || []).length || null;
    }
    if (!pageCount) return null;
    return { pageCount, pages: pages || [] };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const normalize = text => String(text || "").normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");

function nonEmptyLines(pageText) {
  return String(pageText || "").split(/\r?\n/).filter(line => line.trim()).length;
}

/**
 * Har bir bob qaysi betlarda turganini va oxirgi beti qanchalik to'lganini aniqlaydi.
 * headings: bob sarlavhalari (DOCX'da yozilgan ko'rinishda, masalan "1. NAZARIY ASOSLAR").
 */
function analyzeChapterPages(pages, headings, referencesHeading = "Foydalanilgan adabiyotlar") {
  const pageKeys = pages.map(page => String(page || "").split(/\r?\n/).slice(0, 6).map(normalize).join(" "));
  const starts = [];
  let cursor = 0;
  for (const heading of headings) {
    const key = normalize(heading).slice(0, 40);
    let found = -1;
    for (let index = cursor; index < pages.length; index++) {
      if (key && pageKeys[index].includes(key)) { found = index; break; }
    }
    starts.push(found);
    if (found >= 0) cursor = found + 1;
  }
  const refKey = normalize(referencesHeading).slice(0, 20);
  let refStart = pages.length;
  for (let index = Math.max(0, cursor - 1); index < pages.length; index++) {
    if (normalize(pages[index]).includes(refKey)) { refStart = index; break; }
  }
  return headings.map((heading, index) => {
    const start = starts[index];
    if (start < 0) return { index, heading, start: -1, end: -1, pageSpan: 0, lastFill: null };
    const nextStart = starts.slice(index + 1).find(value => value >= 0);
    const end = (nextStart != null ? nextStart : refStart) - 1;
    const lastFill = end >= start ? Math.min(1, nonEmptyLines(pages[end]) / LINES_PER_PAGE) : null;
    return { index, heading, start, end, pageSpan: Math.max(0, end - start + 1), lastFill };
  });
}

/**
 * Qancha bet qo'shish/kamaytirish kerakligini va qaysi boblarda — rejasi.
 * @returns {{action:"ok"|"shrink"|"expand", items:Array<{chapterIndex:number, words:number}>}}
 */
function planPageAdjustment({ pageCount, minPages, maxPages, layout, mainChapterIndexes }) {
  if (pageCount >= minPages && pageCount <= maxPages) return { action: "ok", items: [] };
  const known = layout.filter(item => item.start >= 0 && item.lastFill != null);
  if (pageCount > maxPages) {
    let excess = pageCount - maxPages;
    // Oxirgi beti eng bo'sh (toshib o'tgan) boblar — eng arzon qisqartirish.
    const candidates = known.filter(item => item.pageSpan >= 2).sort((a, b) => a.lastFill - b.lastFill);
    const items = [];
    for (const item of candidates) {
      if (excess <= 0) break;
      items.push({ chapterIndex: item.index, words: Math.ceil(item.lastFill * WORDS_PER_PAGE * 1.08) + 12 });
      excess--;
    }
    // Hali ham ortiqcha bo'lsa — eng uzun boblardan butun bet hajmida.
    const longest = [...known].sort((a, b) => b.pageSpan - a.pageSpan);
    let pointer = 0;
    while (excess > 0 && longest.length) {
      const item = longest[pointer++ % longest.length];
      items.push({ chapterIndex: item.index, words: WORDS_PER_PAGE + 20 });
      excess--;
    }
    return { action: "shrink", items };
  }
  let deficit = minPages - pageCount;
  const mainSet = new Set(mainChapterIndexes);
  const candidates = known.filter(item => mainSet.has(item.index)).sort((a, b) => b.lastFill - a.lastFill);
  const pool = candidates.length ? candidates : known;
  const items = [];
  let pointer = 0;
  while (deficit > 0 && pool.length) {
    const item = pool[pointer % pool.length];
    // Birinchi aylanishda: bo'sh joyni to'ldirib, yangi betning ~yarmigacha; keyingi — butun bet.
    const words = pointer < pool.length
      ? Math.ceil((1 - item.lastFill) * WORDS_PER_PAGE + WORDS_PER_PAGE * 0.55)
      : Math.ceil(WORDS_PER_PAGE * 1.05);
    items.push({ chapterIndex: item.index, words });
    pointer++;
    deficit--;
  }
  return { action: "expand", items };
}

const wordCount = text => String(text || "").split(/\s+/).filter(Boolean).length;

function splitSentences(text) {
  return String(text || "").match(/[^.!?…]+[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g) || [String(text || "")];
}

/**
 * Bob matnidan taxminan `words` so'z olib tashlaydi: eng uzun paragraflarning oxirgi
 * gaplaridan boshlab, har paragrafda kamida MIN_PARAGRAPH_WORDS so'z qoldiriladi.
 * Media, sarlavha va jadvallarga tegmaydi.
 */
function shrinkChapterContent(content, words) {
  const blocks = (Array.isArray(content) ? content : []).map(block => ({ ...block }));
  let remaining = Math.max(0, Math.floor(words));
  let guard = 0;
  while (remaining > 0 && guard++ < 400) {
    const candidates = blocks
      .map((block, index) => ({ block, index, count: block?.type === "paragraph" ? wordCount(block.text) : 0 }))
      .filter(item => item.count > MIN_PARAGRAPH_WORDS)
      .sort((a, b) => b.count - a.count);
    if (!candidates.length) break;
    const target = candidates[0];
    const sentences = splitSentences(target.block.text);
    if (sentences.length > 1) {
      const last = sentences[sentences.length - 1];
      const lastWords = wordCount(last);
      if (target.count - lastWords < MIN_PARAGRAPH_WORDS) break;
      target.block.text = sentences.slice(0, -1).join("").trim();
      remaining -= lastWords;
    } else {
      // Bitta uzun gap: so'z bo'yicha kesib, nuqta bilan yakunlaymiz.
      const tokens = String(target.block.text).split(/\s+/);
      const cut = Math.min(remaining, tokens.length - MIN_PARAGRAPH_WORDS);
      if (cut <= 0) break;
      target.block.text = `${tokens.slice(0, tokens.length - cut).join(" ").replace(/[,;:—-]+$/, "")}.`;
      remaining -= cut;
    }
  }
  return { content: blocks, removed: Math.max(0, Math.floor(words) - Math.max(0, remaining)) };
}

/**
 * Bobdagi ichki bo'limlar (heading level 2) bo'yicha guruhlar: matni eng kam bo'limni
 * kengaytirish uchun tanlaymiz. Bo'limsiz bob (Kirish/Xulosa) — bitta guruh.
 */
function sectionGroups(content) {
  const groups = [];
  let current = { title: null, headingIndex: -1, endIndex: -1, words: 0, lastParagraph: "" };
  (content || []).forEach((block, index) => {
    if (block?.type === "heading" && block.level === 2) {
      if (current.headingIndex >= 0 || current.words > 0) groups.push(current);
      current = { title: block.text, headingIndex: index, endIndex: index, words: 0, lastParagraph: "" };
      return;
    }
    current.endIndex = index;
    if (block?.type === "paragraph") {
      current.words += wordCount(block.text);
      current.lastParagraph = String(block.text || "");
    }
  });
  if (current.headingIndex >= 0 || current.words > 0) groups.push(current);
  return groups;
}

/**
 * Mundarija: har bir sarlavha qaysi betda (chop etilgan raqam = PDF beti tartibi + 1 emas,
 * balki 1 dan boshlangan fizik raqam — muqova 1-bet hisoblanadi). Qidiruv MUNDARIJA
 * sahifasidan keyin boshlanadi va tartib bo'yicha davom etadi.
 */
function findEntryPages(pages, entries) {
  const keys = pages.map(page => normalize(page));
  let cursor = keys.findIndex(page => page.includes("MUNDARIJA"));
  cursor = cursor >= 0 ? cursor + 1 : 1;
  return entries.map(entry => {
    const key = normalize(entry.search || entry.text).slice(0, 36);
    if (!key) return null;
    for (let index = cursor; index < pages.length; index++) {
      if (keys[index].includes(key)) {
        cursor = index;
        return index + 1;
      }
    }
    return null;
  });
}

function insertParagraphsAfter(content, endIndex, paragraphs) {
  const blocks = Array.isArray(content) ? [...content] : [];
  const additions = (paragraphs || [])
    .map(text => String(text || "").trim())
    .filter(Boolean)
    .map(text => ({ type: "paragraph", text }));
  blocks.splice(endIndex + 1, 0, ...additions);
  return blocks;
}

module.exports = {
  WORDS_PER_PAGE,
  LINES_PER_PAGE,
  pageFitEnabled,
  measureDocx,
  analyzeChapterPages,
  planPageAdjustment,
  shrinkChapterContent,
  sectionGroups,
  insertParagraphsAfter,
  findEntryPages,
  officeCommand,
};
