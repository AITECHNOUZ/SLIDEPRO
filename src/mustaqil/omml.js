// src/mustaqil/omml.js
// LaTeX → OMML (Office Math Markup Language) — Word'ning o'z (native) tenglamasi.
//
//   LaTeX --MathJax TeX input--> MathML --shu modul--> <m:oMath>…</m:oMath>
//
// Natija Word'da tahrirlanadigan haqiqiy formula bo'ladi (rasm emas): Insert → Equation
// bilan yozilgandek ko'rinadi, kattalashtirganda xiralashmaydi, PDF'ga ham vektor bo'lib chiqadi.
// Qo'llab-quvvatlanadi: kasr, daraja/indeks, ildiz, ∑/∏/∫ (nary), lim, aksentlar (^, ¯, →, ˙, ~),
// qavslar (\left…\right), matritsa/cases, \text, funksiya nomlari (sin, cos, log…), yunon harflari.

const MATH_FONT = "Cambria Math";
const FONT_SIZE_HALF_POINTS = 28; // 14 pt — asosiy matn bilan bir xil

let _tex = null;
function texEngine() {
  if (_tex) return _tex;
  const { mathjax } = require("mathjax-full/js/mathjax.js");
  const { TeX } = require("mathjax-full/js/input/tex.js");
  const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
  const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");
  const { SerializedMmlVisitor } = require("mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js");
  const { STATE } = require("mathjax-full/js/core/MathItem.js");
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // bussproofs output-jax talab qiladi (bizda yo'q) — chiqarib tashlaymiz.
  const packages = AllPackages.filter(name => name !== "bussproofs");
  const doc = mathjax.document("", { InputJax: new TeX({ packages, formatError: (_jax, err) => { throw err; } }) });
  _tex = { doc, visitor: new SerializedMmlVisitor(), STATE };
  return _tex;
}

function latexToMathML(latex, display = true) {
  const { doc, visitor, STATE } = texEngine();
  const node = doc.convert(String(latex), { display, end: STATE.CONVERT });
  return visitor.visitTree(node);
}

// ── Kichik XML parser (MathJax serializatsiyasi uchun yetarli) ──
function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseXml(xml) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const top = stack[stack.length - 1];
    if (match[1]) {
      if (stack.length > 1) stack.pop();
    } else if (match[2]) {
      const attrs = {};
      String(match[3] || "").replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, key, _q, dq, sq) => {
        attrs[key] = decodeEntities(dq != null ? dq : sq);
        return "";
      });
      const node = { name: match[2], attrs, children: [] };
      top.children.push(node);
      if (!match[4]) stack.push(node);
    } else if (match[5]) {
      if (match[5].trim()) top.children.push({ name: "#text", text: decodeEntities(match[5]) });
    }
  }
  return root;
}

const elements = node => (node.children || []).filter(child => child.name !== "#text");
const textOf = node => (node.children || []).map(child => child.name === "#text" ? child.text : textOf(child)).join("");

// ── OMML yozish yordamchilari ──
function xmlEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wordRunProps() {
  return `<w:rPr><w:rFonts w:ascii="${MATH_FONT}" w:hAnsi="${MATH_FONT}"/><w:sz w:val="${FONT_SIZE_HALF_POINTS}"/><w:szCs w:val="${FONT_SIZE_HALF_POINTS}"/></w:rPr>`;
}

// style: null (standart, harflar kursiv) | "p" (to'g'ri) | "b" | "bi"; normal: matn rejimi
function mathRun(text, { style = null, normal = false } = {}) {
  if (text == null || text === "") return "";
  const props = [];
  // CT_RPR sxemasi: <m:nor/> va <m:sty> o'zaro muqobil (choice) — ikkalasi birga bo'lmaydi.
  if (normal) props.push("<m:nor/>");
  else if (style) props.push(`<m:sty m:val="${style}"/>`);
  const mrPr = props.length ? `<m:rPr>${props.join("")}</m:rPr>` : "";
  return `<m:r>${mrPr}${wordRunProps()}<m:t xml:space="preserve">${xmlEscape(text)}</m:t></m:r>`;
}

const ctrl = () => `<m:ctrlPr>${wordRunProps()}</m:ctrlPr>`;
const wrap = (tag, inner) => `<m:${tag}>${inner || ""}</m:${tag}>`;

const NARY_OPERATORS = new Set(["∑", "∏", "∐", "∫", "∬", "∭", "∮", "∯", "∰", "⋃", "⋂", "⋁", "⋀", "⨁", "⨂", "⨀"]);
const INTEGRALS = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);
const ACCENTS = new Map([
  ["^", "̂"], ["ˆ", "̂"], ["̂", "̂"],
  ["~", "̃"], ["˜", "̃"], ["̃", "̃"],
  ["¯", "̅"], ["‾", "̅"], ["̄", "̄"],
  ["→", "⃗"], ["⃗", "⃗"],
  ["˙", "̇"], ["̇", "̇"], ["¨", "̈"], ["̈", "̈"],
  ["ˇ", "̌"], ["˘", "̆"], ["´", "́"], ["`", "̀"],
]);
// Nary operanddan keyin to'xtash belgilari
const SUM_STOPS = new Set(["+", "-", "−", "=", "<", ">", "≤", "≥", "≈", "≠", "≡", ",", ";", "±", "∓", "⇒", "⇔", "→"]);
const INT_STOPS = new Set(["=", "<", ">", "≤", "≥", "≈", "≠", "≡", ",", ";", "⇒", "⇔"]);

function isMo(node, chars) {
  return node && node.name === "mo" && (chars == null || chars.has(textOf(node).trim()));
}

function naryBase(node) {
  // munderover/msubsup/munder/mover/msub/msup ning asosi katta operatormi?
  if (!node) return null;
  if (isMo(node, NARY_OPERATORS)) return textOf(node).trim();
  const scripted = ["munderover", "msubsup", "munder", "mover", "msub", "msup"];
  if (scripted.includes(node.name)) {
    const base = elements(node)[0];
    if (isMo(base, NARY_OPERATORS)) return textOf(base).trim();
  }
  return null;
}

function buildNary(opNode, operandNodes) {
  const chr = naryBase(opNode);
  const kids = elements(opNode);
  let sub = "", sup = "";
  if (["munderover", "msubsup"].includes(opNode.name)) { sub = convertNode(kids[1]); sup = convertNode(kids[2]); }
  else if (["munder", "msub"].includes(opNode.name)) sub = convertNode(kids[1]);
  else if (["mover", "msup"].includes(opNode.name)) sup = convertNode(kids[1]);
  const limLoc = INTEGRALS.has(chr) ? "subSup" : "undOvr";
  const props = [`<m:chr m:val="${xmlEscape(chr)}"/>`, `<m:limLoc m:val="${limLoc}"/>`];
  if (!sub) props.push('<m:subHide m:val="1"/>');
  if (!sup) props.push('<m:supHide m:val="1"/>');
  props.push(ctrl());
  return `<m:nary><m:naryPr>${props.join("")}</m:naryPr>${wrap("sub", sub)}${wrap("sup", sup)}${wrap("e", operandNodes.map(convertNode).join(""))}</m:nary>`;
}

// Ketma-ket elementlar: nary operandlarini va qavslarni guruhlash
function convertSequence(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const chr = naryBase(node);
    if (chr) {
      const stops = INTEGRALS.has(chr) ? INT_STOPS : SUM_STOPS;
      const operand = [];
      let j = i + 1;
      while (j < nodes.length && !isMo(nodes[j], stops)) operand.push(nodes[j++]);
      out.push(buildNary(node, operand));
      i = j - 1;
      continue;
    }
    out.push(convertNode(node));
  }
  return out.join("");
}

function fenceChar(node) {
  return node ? textOf(node).trim() : "";
}

function isFencedRow(node) {
  const kids = elements(node);
  if (kids.length < 2) return false;
  const first = kids[0], last = kids[kids.length - 1];
  const open = first.name === "mo" && (first.attrs["data-mjx-texclass"] === "OPEN" || first.attrs.fence === "true");
  const close = last.name === "mo" && (last.attrs["data-mjx-texclass"] === "CLOSE" || last.attrs.fence === "true");
  return open && close;
}

function convertDelimited(node) {
  const kids = elements(node);
  const beg = fenceChar(kids[0]);
  const end = fenceChar(kids[kids.length - 1]);
  // Ichida \middle| bo'lsa ham bitta e sifatida qoldiramiz.
  const inner = convertSequence(kids.slice(1, -1));
  return `<m:d><m:dPr><m:begChr m:val="${xmlEscape(beg)}"/><m:endChr m:val="${xmlEscape(end)}"/>${ctrl()}</m:dPr>${wrap("e", inner)}</m:d>`;
}

function convertTable(node) {
  const rows = elements(node).filter(row => row.name === "mtr" || row.name === "mlabeledtr");
  if (!rows.length) return "";
  const columnCount = Math.max(1, ...rows.map(row => elements(row).filter(cell => cell.name === "mtd").length));
  const rowXml = rows.map(row => {
    const cells = elements(row).filter(cell => cell.name === "mtd");
    while (cells.length < columnCount) cells.push({ name: "mtd", attrs: {}, children: [] });
    return `<m:mr>${cells.map(cell => wrap("e", convertSequence(elements(cell)))).join("")}</m:mr>`;
  }).join("");
  const align = String(node.attrs.columnalign || "").split(/\s+/)[0];
  const jc = align === "left" ? "left" : align === "right" ? "right" : "center";
  return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${columnCount}"/><m:mcJc m:val="${jc}"/></m:mcPr></m:mc></m:mcs>${ctrl()}</m:mPr>${rowXml}</m:m>`;
}

function tokenRun(node) {
  const text = textOf(node);
  const variant = node.attrs.mathvariant;
  if (node.name === "mtext") return mathRun(text, { style: "p", normal: true });
  if (node.name === "ms") return mathRun(`"${text}"`, { style: "p", normal: true });
  if (variant === "bold") return mathRun(text, { style: "b" });
  if (variant === "bold-italic") return mathRun(text, { style: "bi" });
  if (variant === "normal") return mathRun(text, { style: "p" });
  if (node.name === "mi") {
    // Ko'p harfli identifikator (sin, cos, log, max) — to'g'ri (kursivsiz) yoziladi.
    return Array.from(text.trim()).length > 1 ? mathRun(text, { style: "p" }) : mathRun(text);
  }
  if (node.name === "mo") {
    const op = text.trim();
    if (op === "⁡" || op === "⁢" || op === "⁣") return ""; // ko'rinmas funksiya/ko'paytma belgisi
    return mathRun(op, { style: "p" });
  }
  return mathRun(text, { style: "p" }); // mn
}

function convertNode(node) {
  if (!node) return "";
  switch (node.name) {
    case "#text": return node.text.trim() ? mathRun(node.text) : "";
    case "math":
    case "mstyle":
    case "mpadded":
    case "menclose":
    case "merror":
    case "mrow":
      if (node.name === "mrow" && isFencedRow(node)) return convertDelimited(node);
      return convertSequence(elements(node));
    case "semantics": return convertNode(elements(node)[0]);
    case "mphantom":
    case "annotation":
    case "annotation-xml":
      return "";
    case "mspace": return mathRun(" ", { style: "p" });
    case "mi":
    case "mn":
    case "mo":
    case "mtext":
    case "ms":
      return tokenRun(node);
    case "mfrac": {
      const [num, den] = elements(node);
      const noBar = node.attrs.linethickness === "0" || node.attrs.linethickness === "0px" || node.attrs.linethickness === "0em";
      const props = `${noBar ? '<m:type m:val="noBar"/>' : ""}${ctrl()}`;
      return `<m:f><m:fPr>${props}</m:fPr>${wrap("num", convertNode(num))}${wrap("den", convertNode(den))}</m:f>`;
    }
    case "msqrt":
      return `<m:rad><m:radPr><m:degHide m:val="1"/>${ctrl()}</m:radPr><m:deg/>${wrap("e", convertSequence(elements(node)))}</m:rad>`;
    case "mroot": {
      const [base, index] = elements(node);
      return `<m:rad><m:radPr>${ctrl()}</m:radPr>${wrap("deg", convertNode(index))}${wrap("e", convertNode(base))}</m:rad>`;
    }
    case "msup": {
      if (naryBase(node)) return buildNary(node, []);
      const [base, sup] = elements(node);
      return `<m:sSup><m:sSupPr>${ctrl()}</m:sSupPr>${wrap("e", convertNode(base))}${wrap("sup", convertNode(sup))}</m:sSup>`;
    }
    case "msub": {
      if (naryBase(node)) return buildNary(node, []);
      const [base, sub] = elements(node);
      return `<m:sSub><m:sSubPr>${ctrl()}</m:sSubPr>${wrap("e", convertNode(base))}${wrap("sub", convertNode(sub))}</m:sSub>`;
    }
    case "msubsup": {
      if (naryBase(node)) return buildNary(node, []);
      const [base, sub, sup] = elements(node);
      return `<m:sSubSup><m:sSubSupPr>${ctrl()}</m:sSubSupPr>${wrap("e", convertNode(base))}${wrap("sub", convertNode(sub))}${wrap("sup", convertNode(sup))}</m:sSubSup>`;
    }
    case "mover": {
      if (naryBase(node)) return buildNary(node, []);
      const [base, over] = elements(node);
      const mark = over && over.name === "mo" ? textOf(over).trim() : "";
      if (mark === "¯" || mark === "‾" || mark === "―" || mark === "_") {
        return `<m:bar><m:barPr><m:pos m:val="top"/>${ctrl()}</m:barPr>${wrap("e", convertNode(base))}</m:bar>`;
      }
      if (ACCENTS.has(mark)) {
        return `<m:acc><m:accPr><m:chr m:val="${ACCENTS.get(mark)}"/>${ctrl()}</m:accPr>${wrap("e", convertNode(base))}</m:acc>`;
      }
      if (mark === "⏞") {
        return `<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/>${ctrl()}</m:groupChrPr>${wrap("e", convertNode(base))}</m:groupChr>`;
      }
      return `<m:limUpp><m:limUppPr>${ctrl()}</m:limUppPr>${wrap("e", convertNode(base))}${wrap("lim", convertNode(over))}</m:limUpp>`;
    }
    case "munder": {
      if (naryBase(node)) return buildNary(node, []);
      const [base, under] = elements(node);
      const mark = under && under.name === "mo" ? textOf(under).trim() : "";
      if (mark === "_" || mark === "¯" || mark === "‾" || mark === "―") {
        return `<m:bar><m:barPr><m:pos m:val="bot"/>${ctrl()}</m:barPr>${wrap("e", convertNode(base))}</m:bar>`;
      }
      return `<m:limLow><m:limLowPr>${ctrl()}</m:limLowPr>${wrap("e", convertNode(base))}${wrap("lim", convertNode(under))}</m:limLow>`;
    }
    case "munderover": {
      if (naryBase(node)) return buildNary(node, []);
      const [base, under, over] = elements(node);
      const low = `<m:limLow><m:limLowPr>${ctrl()}</m:limLowPr>${wrap("e", convertNode(base))}${wrap("lim", convertNode(under))}</m:limLow>`;
      return `<m:limUpp><m:limUppPr>${ctrl()}</m:limUppPr>${wrap("e", low)}${wrap("lim", convertNode(over))}</m:limUpp>`;
    }
    case "mtable": return convertTable(node);
    case "mfenced": {
      const open = node.attrs.open != null ? node.attrs.open : "(";
      const close = node.attrs.close != null ? node.attrs.close : ")";
      return `<m:d><m:dPr><m:begChr m:val="${xmlEscape(open)}"/><m:endChr m:val="${xmlEscape(close)}"/>${ctrl()}</m:dPr>${elements(node).map(child => wrap("e", convertNode(child))).join("")}</m:d>`;
    }
    default:
      return convertSequence(elements(node));
  }
}

function mathMLToOmmlInner(mathml) {
  const tree = parseXml(mathml);
  const math = elements(tree).find(node => node.name === "math") || tree;
  return convertNode(math);
}

/**
 * LaTeX → OMML.
 * @param {string} latex
 * @param {{display?: boolean}} [options]
 * @returns {string} `<m:oMath>…</m:oMath>` (display=true bo'lsa ham — o'rab olish chaqiruvchiga bog'liq)
 */
function latexToOmml(latex, { display = true } = {}) {
  const source = String(latex == null ? "" : latex).trim()
    .replace(/^\$\$?|\$\$?$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .trim();
  if (!source) throw new Error("OMML: formula bo'sh");
  const inner = mathMLToOmmlInner(latexToMathML(source, display));
  if (!inner || !/<m:(r|f|sSup|sSub|sSubSup|rad|nary|d|acc|bar|limLow|limUpp|m)\b/.test(inner)) {
    throw new Error("OMML: formula bo'sh natija berdi");
  }
  return `<m:oMath>${inner}</m:oMath>`;
}

function safeLatexToOmml(latex, options) {
  try {
    return latexToOmml(latex, options);
  } catch {
    return null;
  }
}

const OMML_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/math";

module.exports = { latexToOmml, safeLatexToOmml, latexToMathML, mathMLToOmmlInner, OMML_NAMESPACE };
