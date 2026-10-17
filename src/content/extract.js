// src/content/extract.js
// Yuklangan fayldan matn ajratish: .txt, .docx (mammoth), .pdf (pdf-parse).

const fs = require("fs");
const path = require("path");

async function extractText(filePath, mimeOrName) {
  const ext = path.extname(filePath || mimeOrName || "").toLowerCase();

  if (ext === ".txt" || ext === ".md" || ext === ".csv") {
    return fs.readFileSync(filePath, "utf8");
  }

  if (ext === ".docx") {
    const mammoth = require("mammoth");
    const res = await mammoth.extractRawText({ path: filePath });
    return res.value || "";
  }

  if (ext === ".pdf") {
    try {
      const pdfParse = require("pdf-parse");
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return data.text || "";
    } catch (e) {
      throw new Error("PDF o'qishda xato. Iltimos .docx yoki .txt yuboring.");
    }
  }

  // .doc (eski format) va boshqalar qo'llab-quvvatlanmaydi
  throw new Error("Bu fayl turi qo'llab-quvvatlanmaydi. .txt, .docx yoki .pdf yuboring (yoki matnni to'g'ridan-to'g'ri yozing).");
}

// matnni tozalash va cheklash
function cleanText(text, maxChars = 12000) {
  if (!text) return "";
  let t = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length > maxChars) t = t.slice(0, maxChars);
  return t;
}

module.exports = { extractText, cleanText };
