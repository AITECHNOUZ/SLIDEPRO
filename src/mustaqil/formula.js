// src/mustaqil/formula.js
// LaTeX formulani PNG rasmga aylantirish.
// MathJax v3 (pure JS) → SVG → sharp → PNG

const sharp = require("sharp");

let _mj = null; // singleton

async function initMathJax() {
  if (_mj) return _mj;
  const { mathjax } = require("mathjax-full/js/mathjax.js");
  const { TeX } = require("mathjax-full/js/input/tex.js");
  const { SVG } = require("mathjax-full/js/output/svg.js");
  const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
  const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document("", {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: "local" }),
  });
  _mj = { doc, adaptor };
  return _mj;
}

// LaTeX → PNG { buf, width, height }
// em=8, density=144 → raw PNG ≈ 280×29px; MAX_H=28, MAX_W=180 → Word'da ~1.9 dyuym keng
async function renderFormula(latex, display = true) {
  try {
    const { doc, adaptor } = await initMathJax();
    // em=8 (kichik) → formula matn balandligiga mutanosib
    const node = doc.convert(latex, { display, em: 8, ex: 4, containerWidth: 600 });
    let svg = adaptor.outerHTML(node);

    const svgMatch = svg.match(/<svg[\s\S]*<\/svg>/i);
    if (svgMatch) svg = svgMatch[0];
    if (!/xmlns=/.test(svg)) {
      svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // density=144 — yetarli aniqlik, kichik o'lcham
    const rawPng = await sharp(Buffer.from(svg), { density: 144 })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();

    const meta = await sharp(rawPng).metadata();
    const realW = meta.width || 150;
    const realH = meta.height || 28;

    // Word'da ko'rsatish chegaralari:
    // MAX_H = 28px (~0.29 dyuym, 2 qator matn balandligi)
    // MAX_W = 180px (~1.9 dyuym, kontent kengligining ~29%)
    const MAX_H = 28;
    const MAX_W = 180;
    let dispH = Math.min(realH, MAX_H);
    let dispW = Math.round(dispH * realW / realH);
    if (dispW > MAX_W) { dispW = MAX_W; dispH = Math.round(dispW * realH / realW); }
    // minimal o'lcham
    dispH = Math.max(dispH, 12);
    dispW = Math.max(dispW, 40);

    return { buf: rawPng, width: dispW, height: dispH };
  } catch (e) {
    console.error("[formula] MathJax xato:", e.message, "| latex:", latex.slice(0, 50));
    return fallbackFormula(latex);
  }
}

// Zaxira: oddiy SVG matn sifatida
async function fallbackFormula(latex) {
  // LaTeX buyruqlarini o'qiladigan matnga aylantirish
  const text = latex
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
    .replace(/\\sum/g, "Σ")
    .replace(/\\int/g, "∫")
    .replace(/\\pi/g, "π")
    .replace(/\\alpha/g, "α").replace(/\\beta/g, "β").replace(/\\gamma/g, "γ")
    .replace(/\\Delta/g, "Δ").replace(/\\delta/g, "δ")
    .replace(/\\infty/g, "∞").replace(/\\pm/g, "±").replace(/\\cdot/g, "·")
    .replace(/\^(\{[^}]+\}|[^\s}]+)/g, (_, e) => "^" + e.replace(/[{}]/g, ""))
    .replace(/_(\{[^}]+\}|[^\s}]+)/g, (_, e) => "_" + e.replace(/[{}]/g, ""))
    .replace(/[{}\\]/g, "")
    .trim();

  const W = Math.max(220, text.length * 9 + 30);
  const H = 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    <text x="${W/2}" y="${H/2+6}" text-anchor="middle" font-family="Times New Roman,serif"
          font-size="18" font-style="italic" fill="#111">${escSvg(text)}</text>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buf, width: W, height: H };
}

function escSvg(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

module.exports = { renderFormula };
