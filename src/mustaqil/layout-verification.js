const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_SECTION_PAGE_LIMIT = 1.2;
const PAGE_MARGIN_MM = 20;
const POINTS_PER_MM = 72 / 25.4;

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

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u00ad\u200b\ufeff]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sectionKind(chapter) {
  if (chapter?.id === "intro" || chapter?.role === "introduction" || /^kirish$/i.test(String(chapter?.title || "").trim())) return "intro";
  if (chapter?.id === "conclusion" || chapter?.role === "conclusion" || /^xulosa$/i.test(String(chapter?.title || "").trim())) return "conclusion";
  return null;
}

function requiredBodyParagraphs(chapter) {
  return (Array.isArray(chapter?.content) ? chapter.content : [])
    .filter(item => item?.type === "paragraph" && String(item.text || "").trim())
    .map(item => String(item.text).trim());
}

function findSectionPage(pages, kind) {
  const heading = kind === "intro" ? "KIRISH" : kind === "conclusion" ? "XULOSA" : "FOYDALANILGAN ADABIYOTLAR RO'YXATI";
  const headingKey = normalizedText(heading);
  return pages.findIndex(page => {
    if (kind === "references") return normalizedText(page).includes(headingKey);
    return String(page || "").split(/\r?\n/).some(line => String(line).trim() === heading);
  });
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_match, entity) => ({
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    })[entity]);
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value || "").matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function parseBboxLayout(xml) {
  const pages = [];
  for (const pageMatch of String(xml || "").matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi)) {
    const pageAttributes = parseAttributes(pageMatch[1]);
    const page = {
      width: Number(pageAttributes.width),
      height: Number(pageAttributes.height),
      lines: [],
    };
    for (const lineMatch of pageMatch[2].matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/gi)) {
      const lineAttributes = parseAttributes(lineMatch[1]);
      const words = [...lineMatch[2].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/gi)].map(wordMatch => {
        const attributes = parseAttributes(wordMatch[1]);
        return {
          text: decodeXmlText(wordMatch[2]),
          xMin: Number(attributes.xMin),
          yMin: Number(attributes.yMin),
          xMax: Number(attributes.xMax),
          yMax: Number(attributes.yMax),
        };
      });
      const yValues = words.flatMap(word => [word.yMin, word.yMax]).filter(Number.isFinite);
      page.lines.push({
        text: words.map(word => word.text).join(" "),
        yMin: Number.isFinite(Number(lineAttributes.yMin)) ? Number(lineAttributes.yMin) : Math.min(...yValues),
        yMax: Number.isFinite(Number(lineAttributes.yMax)) ? Number(lineAttributes.yMax) : Math.max(...yValues),
        words,
      });
    }
    pages.push(page);
  }
  return pages;
}

function buildRenderedTextIndex(renderedPages) {
  const words = [];
  (Array.isArray(renderedPages) ? renderedPages : []).forEach((page, pageIndex) => {
    (page.lines || []).forEach(line => {
      line.wordIndexes = [];
      (line.words || []).forEach(word => {
        const key = normalizedText(word.text);
        if (!key) return;
        line.wordIndexes.push(words.length);
        words.push({ ...word, key, pageIndex });
      });
    });
  });

  let text = "";
  const spans = words.map((word, wordIndex) => {
    const start = text.length;
    text += word.key;
    return { start, end: text.length, wordIndex };
  });
  return { words, text, spans };
}

function findTextRange(index, value, fromWordIndex = 0) {
  const target = normalizedText(value);
  if (!target) return null;
  const firstSpan = index.spans.find(span => span.wordIndex >= fromWordIndex);
  const position = index.text.indexOf(target, firstSpan?.start ?? index.text.length);
  if (position < 0) return null;
  const end = position + target.length;
  const first = index.spans.find(span => span.end > position && span.start < end);
  const last = [...index.spans].reverse().find(span => span.end >= end && span.start < end);
  if (!first || !last) return null;
  return { startWordIndex: first.wordIndex, endWordIndex: last.wordIndex };
}

function findRenderedHeading(index, renderedPages, kind) {
  const heading = kind === "intro" ? "KIRISH" : kind === "conclusion" ? "XULOSA" : "FOYDALANILGAN ADABIYOTLAR RO'YXATI";
  if (kind === "references") return findTextRange(index, heading);
  for (const page of renderedPages) {
    for (const line of page.lines || []) {
      if (String(line.text || "").trim() === heading && line.wordIndexes?.length) {
        return { startWordIndex: line.wordIndexes[0], endWordIndex: line.wordIndexes.at(-1) };
      }
    }
  }
  return null;
}

function measureSectionPageEquivalents({ renderedPages, index, kind, bodyItems, marginMm = PAGE_MARGIN_MM }) {
  const name = kind === "intro" ? "Kirish" : kind === "conclusion" ? "Xulosa" : "Adabiyotlar ro'yxati";
  const errors = [];
  const headingRange = findRenderedHeading(index, renderedPages, kind);
  if (!headingRange) {
    return { pageEquivalents: null, startPage: null, endPage: null, errors: [`${name} sarlavhasi PDF matnidan topilmadi; sahifa sig'imi o'lchanmadi.`] };
  }

  let lastWordIndex = headingRange.endWordIndex;
  let cursor = lastWordIndex + 1;
  for (const [paragraphIndex, paragraph] of (bodyItems || []).entries()) {
    const range = findTextRange(index, paragraph, cursor);
    if (!range) {
      const description = kind === "references"
        ? `Adabiyotlar ro'yxatidagi ${paragraphIndex + 1}-yozuv`
        : `${name} matnining ${paragraphIndex + 1}-paragrafi`;
      errors.push(`${description} PDF matnidan topilmadi; sahifa sig'imi tasdiqlanmadi.`);
      continue;
    }
    lastWordIndex = range.endWordIndex;
    cursor = range.endWordIndex + 1;
  }

  const firstWord = index.words[headingRange.startWordIndex];
  const lastWord = index.words[lastWordIndex];
  if (!firstWord || !lastWord || lastWord.pageIndex < firstWord.pageIndex) {
    errors.push(`${name} matnining PDF sahifalardagi tartibi yoki koordinatasi yaroqsiz.`);
    return { pageEquivalents: null, startPage: null, endPage: null, errors };
  }

  const marginPt = Number(marginMm) * POINTS_PER_MM;
  let pageEquivalents = 0;
  for (let pageIndex = firstWord.pageIndex; pageIndex <= lastWord.pageIndex; pageIndex++) {
    const page = renderedPages[pageIndex];
    const height = Number(page?.height);
    const usableHeight = height - 2 * marginPt;
    if (!Number.isFinite(height) || usableHeight <= 0) {
      errors.push(`${name} joylashgan PDF sahifasining balandligi o'lchanmadi.`);
      return { pageEquivalents: null, startPage: firstWord.pageIndex + 1, endPage: lastWord.pageIndex + 1, errors };
    }
    const top = marginPt;
    const bottom = height - marginPt;
    let usedHeight;
    if (firstWord.pageIndex === lastWord.pageIndex) {
      usedHeight = lastWord.yMax - firstWord.yMin;
    } else if (pageIndex === firstWord.pageIndex) {
      usedHeight = bottom - firstWord.yMin;
    } else if (pageIndex === lastWord.pageIndex) {
      usedHeight = lastWord.yMax - top;
    } else {
      usedHeight = usableHeight;
    }
    if (!Number.isFinite(usedHeight)) {
      errors.push(`${name} matnining PDF koordinatalari to'liq emas.`);
      return { pageEquivalents: null, startPage: firstWord.pageIndex + 1, endPage: lastWord.pageIndex + 1, errors };
    }
    pageEquivalents += Math.max(0, usedHeight) / usableHeight;
  }
  return {
    pageEquivalents,
    startPage: firstWord.pageIndex + 1,
    endPage: lastWord.pageIndex + 1,
    errors,
  };
}

function evaluateRenderedLayout({
  pageCount,
  pages,
  pageGeometry,
  chapters = [],
  references = [],
  maxPages,
  maxSectionPages = DEFAULT_SECTION_PAGE_LIMIT,
  marginMm = PAGE_MARGIN_MM,
}) {
  const errors = [];
  if (!Number.isInteger(pageCount) || pageCount < 1) errors.push("PDF'dagi sahifalar soni aniqlanmadi.");
  if (Number.isFinite(maxPages) && pageCount > maxPages) {
    errors.push(`Haqiqiy sahifalar soni ${pageCount}; ruxsat etilgan maksimum ${maxPages}.`);
  }

  const textPages = Array.isArray(pages) ? pages : [];
  const hasGeometry = Array.isArray(pageGeometry) && pageGeometry.length > 0;
  if (hasGeometry && pageGeometry.length !== pageCount) {
    errors.push(`PDF bbox geometriyasida ${pageGeometry.length} sahifa bor, haqiqiy PDF sahifalari esa ${pageCount}; o'lchov to'liq emas.`);
  }
  const sectionPageEquivalents = {};
  const index = hasGeometry ? buildRenderedTextIndex(pageGeometry) : null;
  const evaluateSection = (kind, bodyItems) => {
    const name = kind === "intro" ? "Kirish" : kind === "conclusion" ? "Xulosa" : "Adabiyotlar ro'yxati";
    if (hasGeometry) {
      const measurement = measureSectionPageEquivalents({ renderedPages: pageGeometry, index, kind, bodyItems, marginMm });
      if (measurement.pageEquivalents != null) sectionPageEquivalents[name] = {
        pageEquivalents: Number(measurement.pageEquivalents.toFixed(4)),
        limit: maxSectionPages,
        startPage: measurement.startPage,
        endPage: measurement.endPage,
      };
      errors.push(...measurement.errors);
      if (measurement.pageEquivalents != null && measurement.pageEquivalents > maxSectionPages + 1e-6) {
        errors.push(`${name} hajmi ${measurement.pageEquivalents.toFixed(3)} sahifa ekvivalentida; ruxsat etilgan chegara ${maxSectionPages} sahifa.`);
      }
      return;
    }

    const pageIndex = findSectionPage(textPages, kind);
    if (pageIndex < 0) {
      errors.push(`${name} sarlavhasi PDF matnidan topilmadi; bir sahifalik joylashuv tekshirilmagan.`);
      return;
    }
    const pageText = normalizedText(textPages[pageIndex]);
    const spilled = bodyItems.filter(item => !pageText.includes(normalizedText(item)));
    if (spilled.length) errors.push(`${name} matnining ${spilled.length} paragrafi sarlavha turgan sahifaga to'liq sig'madi.`);
  };

  for (const chapter of chapters) {
    const kind = sectionKind(chapter);
    if (kind) evaluateSection(kind, requiredBodyParagraphs(chapter));
  }
  if (Array.isArray(references) && references.length) evaluateSection("references", references);

  return {
    status: errors.length ? "failed" : "verified",
    actualPageCount: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null,
    maxExpectedPages: Number.isFinite(maxPages) ? maxPages : null,
    maxSectionPages: Number.isFinite(maxSectionPages) ? maxSectionPages : null,
    sectionPageEquivalents,
    errors,
  };
}

function unavailable(reason, actualPageCount = null, maxPages = null) {
  return { status: "unavailable", actualPageCount, maxExpectedPages: Number.isFinite(maxPages) ? maxPages : null, errors: [], reason };
}

async function verifyDocxLayout(docxBuffer, {
  chapters = [],
  references = [],
  maxPages,
  maxSectionPages = DEFAULT_SECTION_PAGE_LIMIT,
  marginMm = PAGE_MARGIN_MM,
} = {}) {
  if (!Buffer.isBuffer(docxBuffer) || docxBuffer.length === 0) throw new Error("Layout tekshiruvi uchun DOCX buferi bo'sh.");
  if (!commandAvailable("libreoffice")) return unavailable("LibreOffice topilmadi; DOCX PDFga aylantirilmadi.", null, maxPages);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "slidepro-layout-"));
  const docxPath = path.join(tempDir, "candidate.docx");
  const pdfDir = path.join(tempDir, "pdf");
  const profileDir = path.join(tempDir, "lo-profile");
  fs.mkdirSync(pdfDir);
  fs.mkdirSync(profileDir);
  fs.writeFileSync(docxPath, docxBuffer);

  try {
    const converted = spawnSync("libreoffice", [
      "--headless",
      `-env:UserInstallation=file://${profileDir}`,
      "--convert-to", "pdf",
      "--outdir", pdfDir,
      docxPath,
    ], { cwd: tempDir, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    const pdfPath = path.join(pdfDir, "candidate.pdf");
    if (converted.error || converted.status !== 0 || !fs.existsSync(pdfPath)) {
      const detail = converted.error?.message || converted.stderr || converted.stdout || `exit=${converted.status}`;
      throw new Error(`LibreOffice PDF renderi bajarilmadi: ${String(detail).trim().slice(0, 600)}`);
    }

    let pageCount = null;
    if (commandAvailable("pdfinfo")) {
      const info = spawnSync("pdfinfo", [pdfPath], { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
      if (info.error || info.status !== 0) throw new Error(`pdfinfo sahifalar sonini o'qiy olmadi: ${info.error?.message || info.stderr || info.status}`);
      pageCount = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    }
    if (!commandAvailable("pdftotext")) return unavailable("pdftotext topilmadi; PDF koordinatalari va bo'lim sig'imi tekshirilmadi.", pageCount, maxPages);

    const extracted = spawnSync("pdftotext", ["-bbox-layout", "-enc", "UTF-8", pdfPath, "-"], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    });
    if (extracted.error || extracted.status !== 0) throw new Error(`PDF bbox matni o'qilmadi: ${extracted.error?.message || extracted.stderr || extracted.status}`);
    const pageGeometry = parseBboxLayout(extracted.stdout);
    if (!pageGeometry.length) throw new Error("PDF bbox natijasidan sahifa geometriyasi topilmadi; 1,2 sahifalik sig'im tekshirilmadi.");
    if (pageCount == null) pageCount = pageGeometry.length;
    const pages = pageGeometry.map(page => page.lines.map(line => line.text).join("\n"));
    const result = evaluateRenderedLayout({
      pageCount,
      pages,
      pageGeometry,
      chapters,
      references,
      maxPages,
      maxSectionPages,
      marginMm,
    });
    if (result.status === "failed") result.reason = "DOCX PDF renderida sahifa yoki 1,2 sahifalik bo'lim toleransi buzildi.";
    result.renderer = "LibreOffice + pdftotext -bbox-layout";
    return result;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_SECTION_PAGE_LIMIT,
  parseBboxLayout,
  measureSectionPageEquivalents,
  evaluateRenderedLayout,
  verifyDocxLayout,
};
