// src/layouts.js
// 12 xil ZAMONAVIY va MOSLASHUVCHAN (adaptive) slayd dizayni.
// - Kartochkalar soni elementlar soniga qarab avtomatik joylashadi (bo'sh joy qolmaydi).
// - Matn qutilarda fit:"shrink" — uzun matn avtomatik kichrayadi, hech qachon chiqib ketmaydi.

const { THEMES } = require("./theme");

// Joriy dizayn mavzusi (render() har slaydda o'rnatadi; slaydlar ketma-ket, sinxron chiziladi)
let TH = THEMES.modern;
const F = { get head() { return TH.fonts.head; }, get body() { return TH.fonts.body; } };

const W = 13.3, H = 7.5;
const MX = 0.7; // chap/o'ng tashqi margin

// ---------- yumshoq soya (zamonaviy) ----------
function softShadow() {
  return { type: "outer", color: "000000", blur: 14, offset: 4, angle: 90, opacity: 0.10 };
}
function liftShadow() {
  return { type: "outer", color: "000000", blur: 18, offset: 6, angle: 90, opacity: 0.16 };
}

// ---------- matn yordamchisi: margin:0 default; fit:"shrink" faqat so'ralganda ----------
function txt(slide, content, opts) {
  slide.addText(content, Object.assign({ margin: 0 }, opts));
}
// uzun bo'lishi mumkin bo'lgan bir qatorli sarlavhalar uchun — avtomatik kichrayadi
function txtFit(slide, content, opts) {
  slide.addText(content, Object.assign({ margin: 0, fit: "shrink" }, opts));
}

// ---------- kartochka (mavzuga qarab: soyali, chegarali, tekis, yuqori chiziqli, yon chiziqli, kontur) ----------
function card(slide, pres, x, y, w, h, fill, lift) {
  const t = TH._t || {};
  const plain = fill === t.card || fill === t.surface;
  const color = plain ? (t.surface || fill) : fill;
  const r = TH.radius ?? 0.13;
  const shape = r > 0 ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE;
  const base = { x, y, w, h, fill: { color }, ...(r > 0 ? { rectRadius: Math.min(r, h / 2, w / 2) } : {}) };
  switch (TH.card) {
    case "border":
      slide.addShape(shape, { ...base, line: { color: plain ? t.line : color, width: 0.75 } });
      break;
    case "flat":
      slide.addShape(shape, { ...base, fill: { color: plain ? t.tint : color } });
      break;
    case "topline":
      slide.addShape(shape, { ...base, line: plain ? { color: t.line, width: 0.75 } : undefined, shadow: lift ? liftShadow() : undefined });
      if (plain) slide.addShape(pres.shapes.RECTANGLE, { x: x + 0.02, y, w: w - 0.04, h: 0.05, fill: { color: t.secondary } });
      break;
    case "stripe":
      slide.addShape(shape, { ...base, shadow: softShadow() });
      if (plain) slide.addShape(pres.shapes.RECTANGLE, { x, y: y + Math.min(r, 0.15), w: 0.09, h: h - Math.min(r, 0.15) * 2, fill: { color: t.accent } });
      break;
    case "outline":
      slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: plain ? t.surface : color }, line: { color: t.line, width: 1.25 } });
      if (plain) {
        // chizma uslubi: burchak belgilari
        const k = 0.16;
        [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => {
          slide.addShape(pres.shapes.LINE, { x: Math.min(cx, cx + sx * k), y: cy, w: k, h: 0, line: { color: t.accent, width: 2 } });
          slide.addShape(pres.shapes.LINE, { x: cx, y: Math.min(cy, cy + sy * k), w: 0, h: k, line: { color: t.accent, width: 2 } });
        });
      }
      break;
    case "ink":
      slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: plain ? t.surface : color }, line: { color: plain ? t.line : color, width: 1 } });
      if (plain) slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 0.06, fill: { color: t.ink } });
      break;
    case "soft":
      slide.addShape(shape, { ...base, fill: { color: plain ? t.surface : color }, shadow: plain ? softShadow() : undefined });
      if (plain) slide.addShape(pres.shapes.OVAL, { x: x + w - 0.55, y: y - 0.12, w: 0.4, h: 0.4, fill: { color: t.secondary, transparency: 70 } });
      break;
    case "glass":
      slide.addShape(shape, { ...base, fill: { color: plain ? "FFFFFF" : color, transparency: plain ? 90 : 10 }, line: { color: "FFFFFF", width: 0.75, transparency: plain ? 70 : 85 } });
      break;
    case "double":
      slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: plain ? t.surface : color }, line: { color: plain ? t.line : color, width: 1.25 } });
      if (plain) slide.addShape(pres.shapes.RECTANGLE, { x: x + 0.06, y: y + 0.06, w: w - 0.12, h: h - 0.12, fill: { type: "none" }, line: { color: t.line, width: 0.5 } });
      break;
    default:
      slide.addShape(shape, { ...base, shadow: lift ? liftShadow() : softShadow() });
  }
}

// ---------- icon chip (rounded square or circle) ----------
function chip(slide, pres, ctx, x, y, d, iconName, bg, iconColor, round) {
  const t = ctx.t;
  const fill = bg === t.card ? (t.surface || bg) : bg;
  if (round) slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill } });
  else if ((TH.radius ?? 0.13) === 0) slide.addShape(pres.shapes.RECTANGLE, { x, y, w: d, h: d, fill: { color: fill } });
  else slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: d, h: d, rectRadius: d * 0.28, fill: { color: fill } });
  const iw = d * 0.5;
  slide.addImage({ path: ctx.icon(iconName, iconColor), x: x + (d - iw) / 2, y: y + (d - iw) / 2, w: iw, h: iw });
}

// ---------- pill (rounded tag) ----------
function pill(slide, pres, x, y, w, h, fill, text, color) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: h / 2, fill: { color: fill } });
  txt(slide, text, { x, y, w, h, fontFace: F.body, fontSize: 12.5, bold: true, color, charSpacing: 1.5, align: "center", valign: "middle" });
}

// ---------- adaptive grid: n element uchun balanslangan katakchalar ----------
// area: {x,y,w,h}, gapX, gapY. Oxirgi to'liqsiz qator markazlashtiriladi.
function gridCells(n, area, gapX, gapY) {
  let cols;
  if (n <= 1) cols = 1;
  else if (n === 2) cols = 2;
  else if (n === 3) cols = 3;
  else if (n === 4) cols = 2;
  else cols = 3;
  const rows = Math.ceil(n / cols);
  const cw = (area.w - gapX * (cols - 1)) / cols;
  const ch = (area.h - gapY * (rows - 1)) / rows;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const itemsInRow = Math.min(cols, n - r * cols);
    const rowW = itemsInRow * cw + (itemsInRow - 1) * gapX;
    const offX = area.x + (area.w - rowW) / 2; // to'liqsiz qatorni markazlash
    const cInRow = i - r * cols;
    cells.push({
      x: offX + cInRow * (cw + gapX),
      y: area.y + r * (ch + gapY),
      w: cw, h: ch,
    });
  }
  return cells;
}

// ---------- sarlavha (mavzuga qarab 6 xil uslub) ----------
function header(pres, slide, ctx, num, title, iconName) {
  const { t } = ctx;
  const n = String(num || "").padStart(2, "0");
  switch (TH.header) {
    case "rule": {
      txtFit(slide, title, { x: MX, y: 0.42, w: W - MX * 2 - 1.2, h: 0.85, fontFace: F.head, fontSize: 26, bold: true, color: t.primary, valign: "middle" });
      txt(slide, n, { x: W - MX - 1.0, y: 0.5, w: 1.0, h: 0.7, fontFace: F.head, fontSize: 20, italic: true, color: t.mute, align: "right", valign: "middle" });
      slide.addShape(pres.shapes.LINE, { x: MX, y: 1.36, w: W - MX * 2, h: 0, line: { color: t.line, width: 1 } });
      slide.addShape(pres.shapes.RECTANGLE, { x: MX, y: 1.32, w: 1.3, h: 0.08, fill: { color: t.accent } });
      return;
    }
    case "band": {
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 1.38, fill: { color: t.primary } });
      slide.addShape(pres.shapes.OVAL, { x: W - 2.6, y: -1.1, w: 2.6, h: 2.6, fill: { color: t.secondary, transparency: 55 } });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 0.42, w: 0.72, h: 0.55, rectRadius: 0.2, fill: { color: t.accent } });
      txt(slide, n, { x: MX, y: 0.42, w: 0.72, h: 0.55, fontFace: F.head, fontSize: 18, bold: true, color: t.dark, align: "center", valign: "middle" });
      txtFit(slide, title, { x: MX + 0.95, y: 0.3, w: W - MX * 2 - 2.0, h: 0.8, fontFace: F.head, fontSize: 25, bold: true, color: t.card, valign: "middle" });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.75, 0.32, 0.75, iconName, t.card, t.primary, true);
      return;
    }
    case "sidebar": {
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.42, h: H, fill: { color: t.primary } });
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.45, w: 0.42, h: 0.85, fill: { color: t.accent } });
      txt(slide, n, { x: 0, y: 0.45, w: 0.42, h: 0.85, fontFace: F.head, fontSize: 14, bold: true, color: t.dark, align: "center", valign: "middle" });
      slide.addShape(pres.shapes.RECTANGLE, { x: MX, y: 0.45, w: 0.55, h: 0.07, fill: { color: t.accent } });
      txtFit(slide, title, { x: MX, y: 0.55, w: W - MX * 2 - 1.2, h: 0.8, fontFace: F.head, fontSize: 25, bold: true, color: t.dark, valign: "middle" });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.75, 0.52, 0.75, iconName, t.tint, t.primary, false);
      return;
    }
    case "bigtitle": {
      txt(slide, n, { x: W - MX - 1.2, y: 0.35, w: 1.2, h: 0.4, fontFace: F.body, fontSize: 13.5, color: t.mute, align: "right", charSpacing: 2 });
      txtFit(slide, title, { x: MX, y: 0.32, w: W - MX * 2 - 1.4, h: 1.0, fontFace: F.head, fontSize: 32, color: t.ink, valign: "middle" });
      slide.addShape(pres.shapes.RECTANGLE, { x: MX, y: 1.38, w: 0.7, h: 0.06, fill: { color: t.accent } });
      return;
    }
    case "frame": {
      txt(slide, "§ " + n, { x: MX, y: 0.45, w: 1.1, h: 0.75, fontFace: "Consolas", fontSize: 18, bold: true, color: t.accent, valign: "middle" });
      txtFit(slide, title, { x: MX + 1.1, y: 0.42, w: W - MX * 2 - 2.1, h: 0.8, fontFace: F.head, fontSize: 24, bold: true, color: t.primary, valign: "middle" });
      slide.addShape(pres.shapes.LINE, { x: MX, y: 1.34, w: W - MX * 2, h: 0, line: { color: t.primary, width: 1.5 } });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.7, 0.48, 0.7, iconName, t.surface, t.primary, false);
      return;
    }
    case "editorial": {
      txt(slide, n, { x: MX - 0.05, y: 0.18, w: 1.6, h: 1.3, fontFace: F.head, fontSize: 64, bold: true, color: t.secondary, valign: "middle" });
      slide.addShape(pres.shapes.LINE, { x: MX + 1.55, y: 0.45, w: 0, h: 0.95, line: { color: t.ink, width: 1 } });
      txtFit(slide, title, { x: MX + 1.75, y: 0.42, w: W - MX * 2 - 1.8, h: 0.95, fontFace: F.head, fontSize: 27, italic: true, color: t.ink, valign: "middle" });
      slide.addShape(pres.shapes.LINE, { x: MX, y: 1.45, w: W - MX * 2, h: 0, line: { color: t.ink, width: 2 } });
      slide.addShape(pres.shapes.LINE, { x: MX, y: 1.52, w: W - MX * 2, h: 0, line: { color: t.ink, width: 0.5 } });
      return;
    }
    case "leaf": {
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 0.5, w: 0.9, h: 0.8, rectRadius: 0.4, fill: { color: t.primary } });
      txt(slide, n, { x: MX, y: 0.5, w: 0.9, h: 0.8, fontFace: F.head, fontSize: 20, bold: true, color: t.card, align: "center", valign: "middle" });
      txtFit(slide, title, { x: MX + 1.15, y: 0.48, w: W - MX * 2 - 2.1, h: 0.85, fontFace: F.head, fontSize: 26, bold: true, color: t.dark, valign: "middle" });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.8, 0.5, 0.8, iconName, t.tint, t.primary, true);
      return;
    }
    case "glass": {
      txt(slide, n, { x: MX, y: 0.5, w: 1.0, h: 0.85, fontFace: F.head, fontSize: 30, bold: true, color: t.secondary, valign: "middle" });
      txtFit(slide, title, { x: MX + 1.0, y: 0.5, w: W - MX * 2 - 2.0, h: 0.85, fontFace: F.head, fontSize: 26, bold: true, color: t.ink, valign: "middle" });
      slide.addShape(pres.shapes.RECTANGLE, { x: MX + 1.0, y: 1.36, w: 1.6, h: 0.05, fill: { color: t.accent } });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.8, 0.52, 0.8, iconName, t.primary, "FFFFFF", true);
      return;
    }
    case "pill": {
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 0.62, w: 1.25, h: 0.5, rectRadius: 0.25, fill: { color: t.tint }, line: { color: t.primary, width: 1 } });
      txt(slide, n, { x: MX, y: 0.62, w: 1.25, h: 0.5, fontFace: F.head, fontSize: 15, bold: true, color: t.primary, align: "center", valign: "middle" });
      txtFit(slide, title, { x: MX + 1.45, y: 0.45, w: W - MX * 2 - 2.4, h: 0.85, fontFace: F.head, fontSize: 26, bold: true, color: t.dark, valign: "middle" });
      slide.addShape(pres.shapes.LINE, { x: MX, y: 1.4, w: W - MX * 2, h: 0, line: { color: t.line, width: 1.25 } });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.75, 0.52, 0.75, iconName, t.primary, "FFFFFF", true);
      return;
    }
    case "ornament": {
      txtFit(slide, title, { x: MX + 1.0, y: 0.38, w: W - MX * 2 - 2.0, h: 0.8, fontFace: F.head, fontSize: 27, bold: true, color: t.primary, align: "center", valign: "middle" });
      const cy = 1.32;
      slide.addShape(pres.shapes.LINE, { x: MX + 1.6, y: cy, w: (W - MX * 2 - 3.6) / 2, h: 0, line: { color: t.accent, width: 1 } });
      slide.addShape(pres.shapes.LINE, { x: W / 2 + 0.4, y: cy, w: (W - MX * 2 - 3.6) / 2, h: 0, line: { color: t.accent, width: 1 } });
      slide.addShape(pres.shapes.DIAMOND, { x: W / 2 - 0.16, y: cy - 0.16, w: 0.32, h: 0.32, fill: { color: t.accent } });
      txt(slide, n, { x: MX, y: 0.5, w: 0.9, h: 0.6, fontFace: F.head, fontSize: 16, italic: true, color: t.secondary, valign: "middle" });
      return;
    }
    default: {
      txt(slide, n, { x: MX, y: 0.45, w: 1.1, h: 0.95, fontFace: F.head, fontSize: 44, bold: true, color: t.secondary, align: "left", valign: "middle", transparency: 62 });
      txtFit(slide, title, { x: MX + 0.95, y: 0.5, w: W - MX * 2 - 1.7, h: 0.85, fontFace: F.head, fontSize: 25, bold: true, color: t.ink, align: "left", valign: "middle" });
      if (iconName) chip(slide, pres, ctx, W - MX - 0.82, 0.5, 0.82, iconName, t.primary, "FFFFFF", false);
    }
  }
}

// ---------- fon (mavzuga qarab) ----------
function gridLines(slide, pres, step, color, transparency) {
  for (let x = step; x < W; x += step) slide.addShape(pres.shapes.LINE, { x, y: 0, w: 0, h: H, line: { color, width: 0.5, transparency } });
  for (let y = step; y < H; y += step) slide.addShape(pres.shapes.LINE, { x: 0, y, w: W, h: 0, line: { color, width: 0.5, transparency } });
}
function lightBg(slide, t) {
  slide.background = { color: t.light };
  const pres = TH._pres;
  if (!pres) return;
  if (TH.bg === "grid-dark") {
    gridLines(slide, pres, 0.9, t.line, 40);
  } else if (TH.bg === "blobs") {
    slide.addShape(pres.shapes.OVAL, { x: -1.6, y: 5.2, w: 3.6, h: 3.6, fill: { color: t.tint } });
    slide.addShape(pres.shapes.OVAL, { x: W - 1.3, y: 5.9, w: 2.4, h: 2.4, fill: { color: t.accent, transparency: 80 } });
  } else if (TH.bg === "paper") {
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: H - 0.16, w: W, h: 0.16, fill: { color: t.ink } });
  } else if (TH.bg === "leaves") {
    slide.addShape(pres.shapes.OVAL, { x: W - 2.2, y: -1.4, w: 3.6, h: 2.6, fill: { color: t.secondary, transparency: 78 }, rotate: -25 });
    slide.addShape(pres.shapes.OVAL, { x: -1.5, y: H - 1.3, w: 3.4, h: 2.2, fill: { color: t.primary, transparency: 85 }, rotate: 20 });
    slide.addShape(pres.shapes.OVAL, { x: W - 1.1, y: H - 1.0, w: 1.6, h: 1.1, fill: { color: t.accent, transparency: 75 }, rotate: -35 });
  } else if (TH.bg === "aurora") {
    slide.addShape(pres.shapes.OVAL, { x: -2.5, y: -2.8, w: 7.5, h: 6.5, fill: { color: t.primary, transparency: 72 } });
    slide.addShape(pres.shapes.OVAL, { x: W - 4.5, y: 3.6, w: 7.0, h: 6.0, fill: { color: t.secondary, transparency: 78 } });
    slide.addShape(pres.shapes.OVAL, { x: W - 6.5, y: -3.2, w: 5.0, h: 4.5, fill: { color: t.accent, transparency: 84 } });
  } else if (TH.bg === "clean") {
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.1, fill: { color: t.primary } });
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.1, w: W * 0.35, h: 0.05, fill: { color: t.accent } });
  } else if (TH.bg === "parchment") {
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.18, y: 0.18, w: W - 0.36, h: H - 0.36, fill: { type: "none" }, line: { color: t.secondary, width: 2 } });
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.28, y: 0.28, w: W - 0.56, h: H - 0.56, fill: { type: "none" }, line: { color: t.secondary, width: 0.6 } });
    [[0.12, 0.12], [W - 0.42, 0.12], [0.12, H - 0.42], [W - 0.42, H - 0.42]].forEach(([x, y]) => slide.addShape(pres.shapes.DIAMOND, { x, y, w: 0.3, h: 0.3, fill: { color: t.accent } }));
  } else if (TH.bg === "blueprint") {
    gridLines(slide, pres, 0.5, t.tint, 0);
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.22, y: 0.22, w: W - 0.44, h: H - 0.44, fill: { type: "none" }, line: { color: t.primary, width: 1.25 } });
    // GOST asosiy yozuvi (shtamp) — o'ng past burchakda
    const bx = W - 4.62, by = H - 0.52;
    slide.addShape(pres.shapes.RECTANGLE, { x: bx, y: by, w: 4.4, h: 0.3, fill: { color: t.surface }, line: { color: t.primary, width: 1 } });
    slide.addShape(pres.shapes.LINE, { x: bx + 3.6, y: by, w: 0, h: 0.3, line: { color: t.primary, width: 1 } });
    txt(slide, TH._deck || "", { x: bx + 0.1, y: by, w: 3.45, h: 0.3, fontFace: F.body, fontSize: 10, color: t.primary, valign: "middle", fit: "shrink" });
    txt(slide, TH._slideNo ? `${TH._slideNo}` : "", { x: bx + 3.6, y: by, w: 0.8, h: 0.3, fontFace: "Consolas", fontSize: 10.5, bold: true, color: t.primary, align: "center", valign: "middle" });
  }
}

// =====================================================================
// 1. TITLE (mavzuga qarab 7 xil muqova)
// =====================================================================
function titleMeta(slide, d, t, { x, y, color, valueColor, size = 14.5 }) {
  (d.meta || []).forEach((m, i) => {
    txt(slide, [
      { text: (m.label || "") + "  ", options: { color } },
      { text: m.value || "", options: { color: valueColor, bold: true } },
    ], { x, y: y + i * 0.46, w: 8.5, h: 0.44, fontFace: F.body, fontSize: size, valign: "middle" });
  });
}
function titleLines(d) {
  return (d.title || "").split("\n").map((line, i, arr) => ({ text: line, options: i < arr.length - 1 ? { breakLine: true } : {} }));
}
function title(pres, slide, d, ctx) {
  const { t } = ctx;
  const metaY = 7.0 - 0.46 * Math.max(1, (d.meta || []).length) - 0.35;
  switch (TH.cover) {
    case "academic": {
      slide.background = { color: t.light };
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.38, h: H, fill: { color: t.primary } });
      slide.addShape(pres.shapes.RECTANGLE, { x: 0.38, y: 0, w: 0.07, h: H, fill: { color: t.accent } });
      if (d.org) txt(slide, d.org, { x: 1.0, y: 0.55, w: 11.3, h: 0.45, fontFace: F.head, fontSize: 15, bold: true, color: t.primary, charSpacing: 1.5 });
      if (d.faculty) txt(slide, d.faculty, { x: 1.0, y: 1.0, w: 11.3, h: 0.38, fontFace: F.body, fontSize: 14, italic: true, color: t.mute });
      slide.addShape(pres.shapes.LINE, { x: 1.0, y: 1.55, w: 11.6, h: 0, line: { color: t.line, width: 1 } });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: 1.0, y: 2.15, w: 6, h: 0.4, fontFace: F.body, fontSize: 14, bold: true, color: t.accent, charSpacing: 4 });
      txt(slide, titleLines(d), { x: 1.0, y: 2.6, w: 11.3, h: 2.1, fontFace: F.head, fontSize: 38, bold: true, color: t.ink, valign: "top", fit: "shrink" });
      slide.addShape(pres.shapes.LINE, { x: 1.0, y: metaY - 0.25, w: 11.6, h: 0, line: { color: t.line, width: 1 } });
      titleMeta(slide, d, t, { x: 1.0, y: metaY, color: t.mute, valueColor: t.ink });
      if (d.date) txt(slide, d.date, { x: W - MX - 3, y: 6.6, w: 3, h: 0.45, fontFace: F.head, fontSize: 16, italic: true, color: t.primary, align: "right", valign: "middle" });
      return;
    }
    case "minimal": {
      slide.background = { color: t.light };
      if (d.org) txt(slide, d.org, { x: MX, y: 0.55, w: 9, h: 0.38, fontFace: F.body, fontSize: 13.5, color: t.mute, charSpacing: 2 });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 0.9, w: 9, h: 0.34, fontFace: F.body, fontSize: 12.5, color: t.mute });
      if (d.date) txt(slide, d.date, { x: W - MX - 2, y: 0.55, w: 2, h: 0.38, fontFace: F.body, fontSize: 13.5, color: t.mute, align: "right" });
      slide.addShape(pres.shapes.RECTANGLE, { x: MX, y: 2.25, w: 0.22, h: 0.22, fill: { color: t.accent } });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: MX + 0.4, y: 2.18, w: 6, h: 0.36, fontFace: F.body, fontSize: 13.5, color: t.ink, charSpacing: 4 });
      txt(slide, titleLines(d), { x: MX - 0.03, y: 2.7, w: 11.6, h: 2.3, fontFace: F.head, fontSize: 46, color: t.ink, valign: "top", fit: "shrink", lineSpacingMultiple: 0.95 });
      slide.addShape(pres.shapes.LINE, { x: MX, y: metaY - 0.25, w: W - MX * 2, h: 0, line: { color: t.ink, width: 0.75 } });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink, size: 13.5 });
      return;
    }
    case "tech": {
      slide.background = { color: t.dark };
      gridLines(slide, pres, 0.6, t.line, 30);
      slide.addShape(pres.shapes.OVAL, { x: 8.6, y: -2.4, w: 7, h: 7, fill: { color: t.primary, transparency: 82 } });
      slide.addShape(pres.shapes.RECTANGLE, { x: MX, y: 2.05, w: 0.06, h: 2.6, fill: { color: t.secondary } });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.55, w: 10.5, h: 0.38, fontFace: F.body, fontSize: 14, bold: true, color: t.mute, charSpacing: 2.5 });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 0.92, w: 10.5, h: 0.34, fontFace: F.body, fontSize: 13, color: t.mute });
      txt(slide, "> " + (d.kicker || "TAQDIMOT"), { x: MX + 0.3, y: 2.0, w: 6, h: 0.4, fontFace: "Consolas", fontSize: 14, bold: true, color: t.accent });
      txt(slide, titleLines(d), { x: MX + 0.28, y: 2.45, w: 11.2, h: 2.2, fontFace: F.head, fontSize: 38, bold: true, color: t.ink, valign: "top", fit: "shrink" });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink });
      if (d.date) txt(slide, d.date, { x: W - MX - 3, y: 6.65, w: 3, h: 0.4, fontFace: "Consolas", fontSize: 13.5, bold: true, color: t.secondary, align: "right" });
      return;
    }
    case "bright": {
      slide.background = { color: t.light };
      slide.addShape(pres.shapes.OVAL, { x: 8.9, y: -1.6, w: 5.6, h: 5.6, fill: { color: t.primary } });
      slide.addShape(pres.shapes.OVAL, { x: 11.2, y: 3.4, w: 3.4, h: 3.4, fill: { color: t.secondary } });
      slide.addShape(pres.shapes.OVAL, { x: 8.3, y: 4.6, w: 2.2, h: 2.2, fill: { color: t.accent } });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.6, w: 8, h: 0.4, fontFace: F.body, fontSize: 14.5, bold: true, color: t.primary });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 1.0, w: 8, h: 0.35, fontFace: F.body, fontSize: 13.5, color: t.mute });
      pill(slide, pres, MX, 2.0, 2.6, 0.46, t.accent, (d.kicker || "TAQDIMOT"), t.dark);
      txt(slide, titleLines(d), { x: MX, y: 2.65, w: 7.6, h: 2.4, fontFace: F.head, fontSize: 36, bold: true, color: t.ink, valign: "top", fit: "shrink" });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink });
      if (d.date) txt(slide, d.date, { x: 9.4, y: 1.1, w: 3.2, h: 0.6, fontFace: F.head, fontSize: 22, bold: true, color: t.card, align: "center" });
      return;
    }
    case "split": {
      slide.background = { color: t.light };
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 4.9, h: H, fill: { color: t.primary } });
      slide.addShape(pres.shapes.RECTANGLE, { x: 4.9, y: 0, w: 0.12, h: H, fill: { color: t.accent } });
      if (d.org) txt(slide, d.org, { x: 0.55, y: 0.7, w: 3.9, h: 1.2, fontFace: F.head, fontSize: 15, bold: true, color: t.card, valign: "top", fit: "shrink" });
      if (d.faculty) txt(slide, d.faculty, { x: 0.55, y: 1.95, w: 3.9, h: 0.9, fontFace: F.body, fontSize: 13.5, color: t.onDark, valign: "top" });
      if (d.date) txt(slide, d.date, { x: 0.55, y: 6.4, w: 3.9, h: 0.6, fontFace: F.head, fontSize: 30, bold: true, color: t.card });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: 5.6, y: 1.9, w: 6.8, h: 0.4, fontFace: F.body, fontSize: 14, bold: true, color: t.primary, charSpacing: 3 });
      txt(slide, titleLines(d), { x: 5.6, y: 2.4, w: 7.0, h: 2.6, fontFace: F.head, fontSize: 34, bold: true, color: t.dark, valign: "top", fit: "shrink" });
      titleMeta(slide, d, t, { x: 5.6, y: metaY, color: t.mute, valueColor: t.ink, size: 13.5 });
      return;
    }
    case "blueprint": {
      TH._deck = d.title || TH._deck;
      lightBg(slide, t);
      if (d.org) txt(slide, d.org, { x: 0.6, y: 0.55, w: W - 1.2, h: 0.4, fontFace: F.head, fontSize: 15, bold: true, color: t.primary, align: "center", charSpacing: 1.5 });
      if (d.faculty) txt(slide, d.faculty, { x: 0.6, y: 0.95, w: W - 1.2, h: 0.35, fontFace: F.body, fontSize: 13.5, color: t.mute, align: "center" });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: 0.6, y: 2.0, w: W - 1.2, h: 0.4, fontFace: "Consolas", fontSize: 14, bold: true, color: t.accent, align: "center", charSpacing: 4 });
      txt(slide, titleLines(d), { x: 1.2, y: 2.45, w: W - 2.4, h: 2.0, fontFace: F.head, fontSize: 36, bold: true, color: t.primary, align: "center", valign: "middle", fit: "shrink" });
      // Shtamp uslubidagi ma'lumot jadvali
      const rows = (d.meta || []).concat(d.date ? [{ label: "", value: d.date }] : []);
      const bx = W - 6.0, by = 7.0 - 0.38 * rows.length - 0.35;
      rows.forEach((m, i) => {
        const y = by + i * 0.38;
        slide.addShape(pres.shapes.RECTANGLE, { x: bx, y, w: 1.7, h: 0.38, fill: { color: t.surface }, line: { color: t.primary, width: 1 } });
        slide.addShape(pres.shapes.RECTANGLE, { x: bx + 1.7, y, w: 3.65, h: 0.38, fill: { color: t.surface }, line: { color: t.primary, width: 1 } });
        txt(slide, m.label || "", { x: bx + 0.08, y, w: 1.6, h: 0.38, fontFace: F.body, fontSize: 12.5, color: t.mute, valign: "middle" });
        txt(slide, m.value || "", { x: bx + 1.8, y, w: 3.5, h: 0.38, fontFace: F.body, fontSize: 13.5, bold: true, color: t.primary, valign: "middle" });
      });
      return;
    }
    case "editorial": {
      slide.background = { color: t.light };
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.55, fill: { color: t.ink } });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.05, w: 9, h: 0.45, fontFace: F.body, fontSize: 12, bold: true, color: t.light, charSpacing: 3, valign: "middle" });
      if (d.date) txt(slide, d.date, { x: W - MX - 2, y: 0.05, w: 2, h: 0.45, fontFace: F.body, fontSize: 12, bold: true, color: t.light, align: "right", valign: "middle" });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: MX, y: 1.15, w: 6, h: 0.4, fontFace: F.body, fontSize: 13, bold: true, color: t.secondary, charSpacing: 5 });
      txt(slide, titleLines(d), { x: MX - 0.05, y: 1.6, w: 9.4, h: 3.4, fontFace: F.head, fontSize: 50, bold: true, color: t.ink, valign: "top", fit: "shrink", lineSpacingMultiple: 0.92 });
      slide.addShape(pres.shapes.LINE, { x: 10.3, y: 1.2, w: 0, h: 4.6, line: { color: t.ink, width: 1 } });
      if (d.faculty) txt(slide, d.faculty, { x: 10.5, y: 1.15, w: 2.2, h: 4.6, fontFace: F.head, fontSize: 14, italic: true, color: t.mute, valign: "top" });
      slide.addShape(pres.shapes.LINE, { x: MX, y: metaY - 0.25, w: W - MX * 2, h: 0, line: { color: t.ink, width: 2 } });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink });
      return;
    }
    case "nature": {
      slide.background = { color: t.light };
      slide.addShape(pres.shapes.OVAL, { x: 7.6, y: -1.8, w: 7.4, h: 6.0, fill: { color: t.primary }, rotate: -18 });
      slide.addShape(pres.shapes.OVAL, { x: 10.2, y: 3.8, w: 4.4, h: 3.2, fill: { color: t.secondary, transparency: 20 }, rotate: 25 });
      slide.addShape(pres.shapes.OVAL, { x: 8.0, y: 4.9, w: 2.2, h: 1.5, fill: { color: t.accent, transparency: 10 }, rotate: -30 });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.6, w: 7.2, h: 0.45, fontFace: F.body, fontSize: 13.5, bold: true, color: t.primary });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 1.02, w: 7.2, h: 0.38, fontFace: F.body, fontSize: 12, color: t.mute });
      pill(slide, pres, MX, 2.0, 2.4, 0.46, t.secondary, (d.kicker || "TAQDIMOT"), t.card);
      txt(slide, titleLines(d), { x: MX, y: 2.65, w: 7.0, h: 2.5, fontFace: F.head, fontSize: 38, bold: true, color: t.dark, valign: "top", fit: "shrink" });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink });
      if (d.date) txt(slide, d.date, { x: 9.6, y: 1.2, w: 3.0, h: 0.6, fontFace: F.head, fontSize: 24, bold: true, color: t.card, align: "center" });
      return;
    }
    case "aurora": {
      slide.background = { color: t.dark };
      slide.addShape(pres.shapes.OVAL, { x: -2.0, y: -3.0, w: 8.5, h: 7.5, fill: { color: t.primary, transparency: 55 } });
      slide.addShape(pres.shapes.OVAL, { x: 7.5, y: 2.5, w: 8.0, h: 7.0, fill: { color: t.secondary, transparency: 62 } });
      slide.addShape(pres.shapes.OVAL, { x: 5.0, y: -3.5, w: 5.5, h: 5.0, fill: { color: t.accent, transparency: 70 } });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 1.7, w: W - MX * 2, h: 3.4, rectRadius: 0.25, fill: { color: "FFFFFF", transparency: 88 }, line: { color: "FFFFFF", width: 0.75, transparency: 60 } });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.55, w: 10.5, h: 0.4, fontFace: F.body, fontSize: 13, bold: true, color: t.ink, charSpacing: 2.5 });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 0.95, w: 10.5, h: 0.35, fontFace: F.body, fontSize: 12, color: t.mute });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: MX + 0.5, y: 2.0, w: 6, h: 0.4, fontFace: F.body, fontSize: 13, bold: true, color: t.accent, charSpacing: 4 });
      txt(slide, titleLines(d), { x: MX + 0.5, y: 2.45, w: W - MX * 2 - 1.0, h: 2.4, fontFace: F.head, fontSize: 40, bold: true, color: t.ink, valign: "top", fit: "shrink" });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink });
      if (d.date) txt(slide, d.date, { x: W - MX - 3, y: 6.65, w: 3, h: 0.4, fontFace: F.body, fontSize: 13, bold: true, color: t.ink, align: "right" });
      return;
    }
    case "medical": {
      slide.background = { color: t.light };
      slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.12, fill: { color: t.primary } });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.4, y: 1.3, w: 4.3, h: 4.3, rectRadius: 0.6, fill: { color: t.tint } });
      // tibbiy "plus" belgisi
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 10.15, y: 2.2, w: 0.8, h: 2.5, rectRadius: 0.12, fill: { color: t.primary } });
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.3, y: 3.05, w: 2.5, h: 0.8, rectRadius: 0.12, fill: { color: t.primary } });
      slide.addShape(pres.shapes.OVAL, { x: 11.9, y: 1.0, w: 0.7, h: 0.7, fill: { color: t.accent } });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.55, w: 7.5, h: 0.42, fontFace: F.body, fontSize: 13.5, bold: true, color: t.primary });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 0.95, w: 7.5, h: 0.36, fontFace: F.body, fontSize: 12, color: t.mute });
      pill(slide, pres, MX, 2.0, 2.4, 0.44, t.primary, (d.kicker || "TAQDIMOT"), t.card);
      txt(slide, titleLines(d), { x: MX, y: 2.6, w: 7.4, h: 2.5, fontFace: F.head, fontSize: 38, bold: true, color: t.dark, valign: "top", fit: "shrink" });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.mute, valueColor: t.ink });
      if (d.date) txt(slide, d.date, { x: 8.4, y: 5.8, w: 4.3, h: 0.45, fontFace: F.body, fontSize: 14, bold: true, color: t.primary, align: "center" });
      return;
    }
    case "heritage": {
      slide.background = { color: t.light };
      lightBg(slide, t);
      if (d.org) txt(slide, d.org, { x: 1.0, y: 0.7, w: W - 2.0, h: 0.42, fontFace: F.head, fontSize: 15, bold: true, color: t.primary, align: "center", charSpacing: 2 });
      if (d.faculty) txt(slide, d.faculty, { x: 1.0, y: 1.1, w: W - 2.0, h: 0.36, fontFace: F.body, fontSize: 12.5, italic: true, color: t.mute, align: "center" });
      const cy = 1.95;
      slide.addShape(pres.shapes.LINE, { x: 3.2, y: cy, w: 2.8, h: 0, line: { color: t.accent, width: 1 } });
      slide.addShape(pres.shapes.LINE, { x: W - 6.0, y: cy, w: 2.8, h: 0, line: { color: t.accent, width: 1 } });
      slide.addShape(pres.shapes.DIAMOND, { x: W / 2 - 0.2, y: cy - 0.2, w: 0.4, h: 0.4, fill: { color: t.accent } });
      txt(slide, (d.kicker || "TAQDIMOT"), { x: 1.0, y: 2.25, w: W - 2.0, h: 0.4, fontFace: F.head, fontSize: 13, bold: true, color: t.secondary, align: "center", charSpacing: 6 });
      txt(slide, titleLines(d), { x: 1.4, y: 2.7, w: W - 2.8, h: 2.1, fontFace: F.head, fontSize: 40, bold: true, color: t.dark, align: "center", valign: "middle", fit: "shrink" });
      slide.addShape(pres.shapes.LINE, { x: 4.2, y: 5.0, w: W - 8.4, h: 0, line: { color: t.accent, width: 1 } });
      (d.meta || []).forEach((m, i) => txt(slide, [
        { text: (m.label || "") + "  ", options: { color: t.mute, italic: true } },
        { text: m.value || "", options: { color: t.ink, bold: true } },
      ], { x: 1.0, y: 5.2 + i * 0.4, w: W - 2.0, h: 0.38, fontFace: F.body, fontSize: 14, align: "center" }));
      if (d.date) txt(slide, d.date, { x: 1.0, y: 6.55, w: W - 2.0, h: 0.4, fontFace: F.head, fontSize: 14, italic: true, color: t.primary, align: "center" });
      return;
    }
    default: {
      slide.background = { color: t.dark };
      slide.addShape(pres.shapes.OVAL, { x: 9.7, y: -2.2, w: 6.2, h: 6.2, fill: { color: t.primary, transparency: 60 } });
      slide.addShape(pres.shapes.OVAL, { x: 11.4, y: 4.7, w: 4.2, h: 4.2, fill: { color: t.secondary, transparency: 64 } });
      if (d.org) txt(slide, d.org, { x: MX, y: 0.6, w: 10.5, h: 0.4, fontFace: F.body, fontSize: 14.5, bold: true, color: t.onDark, charSpacing: 2.5 });
      if (d.faculty) txt(slide, d.faculty, { x: MX, y: 1.0, w: 10.5, h: 0.35, fontFace: F.body, fontSize: 14, color: t.onDark, transparency: 22 });
      pill(slide, pres, MX, 2.0, 2.5, 0.42, t.accent, (d.kicker || "TAQDIMOT"), t.dark);
      txt(slide, titleLines(d), { x: MX - 0.02, y: 2.7, w: 11.2, h: 2.2, fontFace: F.head, fontSize: 36, bold: true, color: t.card, align: "left", valign: "top", lineSpacingMultiple: 1.04, fit: "shrink" });
      titleMeta(slide, d, t, { x: MX, y: metaY, color: t.onDark, valueColor: t.card });
      if (d.date) txt(slide, d.date, { x: W - MX - 3, y: 6.75, w: 3, h: 0.4, fontFace: F.body, fontSize: 13, bold: true, color: t.accent, align: "right", valign: "middle" });
    }
  }
}

// =====================================================================
// 2. STAT-CALLOUT
// =====================================================================
function statCallout(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  const hasItems = (d.items || []).length > 0;
  const topH = hasItems ? 3.05 : 4.6;

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.75, w: 7.0, h: 1.25, fontFace: F.body, fontSize: 16, color: t.ink, valign: "top", lineSpacingMultiple: 1.15 });

  if (d.highlight) {
    const c = { x: MX, y: 3.15, w: 7.0, h: 1.6 };
    card(slide, pres, c.x, c.y, c.w, c.h, t.badTint);
    chip(slide, pres, ctx, c.x + 0.3, c.y + 0.32, 0.6, d.highlight.icon || "warning", t.card, t.bad, false);
    txt(slide, d.highlight.label || "", { x: c.x + 1.05, y: c.y + 0.28, w: c.w - 1.3, h: 0.42, fontFace: F.body, fontSize: 14, bold: true, color: t.bad });
    txt(slide, d.highlight.text || "", { x: c.x + 1.05, y: c.y + 0.72, w: c.w - 1.3, h: 0.78, fontFace: F.body, fontSize: 14, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" });
  }

  if (d.stat) {
    const sx = 8.05, sw = W - MX - sx;
    card(slide, pres, sx, 1.75, sw, 3.0, t.primary, true);
    if (d.stat.label) txt(slide, d.stat.label, { x: sx + 0.35, y: 2.0, w: sw - 0.7, h: 0.5, fontFace: F.body, fontSize: 14, bold: true, color: t.onDark });
    txt(slide, d.stat.value || "", { x: sx + 0.35, y: 2.5, w: sw - 0.7, h: 1.05, fontFace: F.head, fontSize: 48, bold: true, color: t.card });
    if (d.stat.desc) txt(slide, d.stat.desc, { x: sx + 0.35, y: 3.6, w: sw - 0.7, h: 1.0, fontFace: F.body, fontSize: 14, color: "EAF3F8", lineSpacingMultiple: 1.12, valign: "top" });
  }

  // adaptive bottom items
  const items = (d.items || []).slice(0, 4);
  if (items.length) {
    const cells = gridCells(items.length, { x: MX, y: 5.1, w: W - MX * 2, h: 1.75 }, 0.25, 0.2);
    items.forEach((it, i) => {
      const c = cells[i];
      card(slide, pres, c.x, c.y, c.w, c.h, t.card);
      chip(slide, pres, ctx, c.x + 0.28, c.y + 0.3, 0.62, it.icon || "check", t.tint, t.secondary, true);
      txtFit(slide, it.title || "", { x: c.x + 1.02, y: c.y + 0.28, w: c.w - 1.25, h: 0.6, fontFace: F.body, fontSize: 15, bold: true, color: t.primary, valign: "middle" });
      txtFit(slide, it.desc || "", { x: c.x + 0.3, y: c.y + 0.98, w: c.w - 0.55, h: c.h - 1.25, fontFace: F.body, fontSize: 13, color: t.mute, lineSpacingMultiple: 1.06, valign: "top" });
    });
  }
}

// =====================================================================
// 3. OBJECTIVES (adaptive grid)
// =====================================================================
function objectives(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  let gridTop = 1.8;
  if (d.banner) {
    card(slide, pres, MX, 1.75, W - MX * 2, 1.4, t.primary, true);
    slide.addShape(pres.shapes.OVAL, { x: MX + 0.35, y: 2.05, w: 0.8, h: 0.8, fill: { color: t.secondary } });
    slide.addImage({ path: ctx.icon(d.banner.icon || "target", "FFFFFF"), x: MX + 0.55, y: 2.25, w: 0.4, h: 0.4 });
    txt(slide, d.banner.label || "Maqsad", { x: MX + 1.4, y: 1.95, w: W - MX * 2 - 1.8, h: 0.4, fontFace: F.body, fontSize: 14, bold: true, color: t.onDark, charSpacing: 1 });
    txt(slide, d.banner.text || "", { x: MX + 1.4, y: 2.32, w: W - MX * 2 - 1.8, h: 0.75, fontFace: F.body, fontSize: 15.5, color: t.card, lineSpacingMultiple: 1.08, valign: "top" });
    gridTop = 3.4;
  }

  const items = (d.items || []).slice(0, 6);
  const cells = gridCells(items.length, { x: MX, y: gridTop, w: W - MX * 2, h: 6.95 - gridTop }, 0.3, 0.3);
  items.forEach((it, i) => {
    const c = cells[i];
    card(slide, pres, c.x, c.y, c.w, c.h, t.card);
    chip(slide, pres, ctx, c.x + 0.32, c.y + 0.34, 0.88, it.icon || "check", t.tint, t.secondary, true);
    txt(slide, `0${i + 1}`, { x: c.x + c.w - 1.15, y: c.y + 0.2, w: 0.95, h: 0.65, fontFace: F.head, fontSize: 32, bold: true, color: t.tint, align: "right" });
    txtFit(slide, it.title || "", { x: c.x + 1.35, y: c.y + 0.34, w: c.w - 2.4, h: 0.5, fontFace: F.body, fontSize: 15, bold: true, color: t.ink, valign: "middle" });
    txtFit(slide, it.desc || "", { x: c.x + 0.34, y: c.y + 1.28, w: c.w - 0.6, h: Math.min(0.95, c.h - 1.5), fontFace: F.body, fontSize: 13.5, color: t.mute, lineSpacingMultiple: 1.08, valign: "top" });
  });
}

// =====================================================================
// 4. STEPS (adaptive width)
// =====================================================================
function steps(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.7, fontFace: F.body, fontSize: 15.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" });

  const st = (d.items || []).slice(0, 6);
  const n = st.length || 1;
  const hasNote = !!d.note;
  const sy = 2.6;
  const sh = hasNote ? 2.25 : 3.6;
  const gap = 0.18;
  const sw = (W - MX * 2 - gap * (n - 1)) / n;
  st.forEach((it, i) => {
    const sx = MX + i * (sw + gap);
    card(slide, pres, sx, sy, sw, sh, t.card);
    const col = i % 2 === 0 ? t.primary : t.secondary;
    chip(slide, pres, ctx, sx + (sw - 0.78) / 2, sy + 0.32, 0.78, it.icon || "check", col, "FFFFFF", true);
    txt(slide, String(i + 1), { x: sx + 0.12, y: sy + 0.16, w: 0.5, h: 0.4, fontFace: F.head, fontSize: 20, bold: true, color: t.tint });
    txtFit(slide, it.title || "", { x: sx + 0.12, y: sy + 1.2, w: sw - 0.24, h: 0.5, fontFace: F.body, fontSize: 14, bold: true, color: t.ink, align: "center", valign: "middle" });
    txtFit(slide, it.desc || "", { x: sx + 0.14, y: sy + 1.7, w: sw - 0.28, h: sh - 2.0, fontFace: F.body, fontSize: 12, color: t.mute, align: "center", lineSpacingMultiple: 1.04, valign: "top" });
  });

  if (hasNote) {
    const ny = sy + sh + 0.25;
    card(slide, pres, MX, ny, W - MX * 2, 6.9 - ny, t.tint);
    chip(slide, pres, ctx, MX + 0.32, ny + 0.32, 0.64, d.note.icon || "bolt", t.card, t.accent, true);
    txt(slide, d.note.label || "", { x: MX + 1.1, y: ny + 0.26, w: W - MX * 2 - 1.4, h: 0.42, fontFace: F.body, fontSize: 15, bold: true, color: t.primary });
    txt(slide, d.note.text || "", { x: MX + 1.1, y: ny + 0.68, w: W - MX * 2 - 1.4, h: (6.9 - ny) - 0.8, fontFace: F.body, fontSize: 14, color: t.ink, lineSpacingMultiple: 1.12, valign: "top" });
  }
}

// =====================================================================
// 5. FEATURE-GRID (adaptive)
// =====================================================================
function featureGrid(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  let top = 1.75;
  if (d.intro) { txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.7, fontFace: F.body, fontSize: 15.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" }); top = 2.6; }
  const hasNote = !!d.note;
  const bottom = hasNote ? 6.15 : 6.95;

  const items = (d.items || []).slice(0, 6);
  const cells = gridCells(items.length, { x: MX, y: top, w: W - MX * 2, h: bottom - top }, 0.3, 0.3);
  items.forEach((it, i) => {
    const c = cells[i];
    card(slide, pres, c.x, c.y, c.w, c.h, t.card);
    chip(slide, pres, ctx, c.x + 0.32, c.y + (c.h - 0.8) / 2 - 0.1, 0.8, it.icon || "check", t.tint, t.secondary, false);
    txtFit(slide, it.title || "", { x: c.x + 1.35, y: c.y + 0.28, w: c.w - 1.65, h: 0.5, fontFace: F.body, fontSize: 15.5, bold: true, color: t.primary, valign: "middle" });
    txtFit(slide, it.desc || "", { x: c.x + 1.35, y: c.y + 0.78, w: c.w - 1.65, h: c.h - 1.12, fontFace: F.body, fontSize: 13, color: t.mute, lineSpacingMultiple: 1.06, valign: "top" });
  });

  if (hasNote) txt(slide, [
    { text: (d.note.label ? d.note.label + " " : ""), options: { bold: true, color: t.primary } },
    { text: d.note.text || "", options: { color: t.mute, italic: true } },
  ], { x: MX, y: 6.3, w: W - MX * 2, h: 0.7, fontFace: F.body, fontSize: 14, valign: "top", lineSpacingMultiple: 1.06 });
}

// =====================================================================
// 6. LAYERS (adaptive height, 2-4)
// =====================================================================
function layers(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  let top = 1.8;
  if (d.intro) { txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.5, fontFace: F.body, fontSize: 15.5, color: t.ink, valign: "top" }); top = 2.3; }

  const ls = (d.items || []).slice(0, 4);
  const n = ls.length || 1;
  const cols = [t.secondary, t.primary, t.dark, t.primary];
  const gap = 0.22;
  const lh = (6.95 - top - gap * (n - 1)) / n;
  ls.forEach((it, i) => {
    const ly = top + i * (lh + gap);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: ly, w: W - MX * 2, h: lh, rectRadius: 0.13, fill: { color: cols[i % cols.length] }, shadow: softShadow() });
    txt(slide, it.num || String(n - i), { x: MX + 0.3, y: ly + (lh - 0.9) / 2, w: 1.0, h: 0.9, fontFace: F.head, fontSize: 46, bold: true, color: t.card, align: "center", valign: "middle", transparency: 35 });
    chip(slide, pres, ctx, MX + 1.55, ly + (lh - 0.66) / 2, 0.66, it.icon || "layers", t.card, cols[i % cols.length], true);
    txtFit(slide, it.title || "", { x: MX + 2.45, y: ly + 0.24, w: W - MX * 2 - 2.9, h: 0.5, fontFace: F.body, fontSize: 17, bold: true, color: t.card, valign: "middle" });
    txtFit(slide, it.desc || "", { x: MX + 2.45, y: ly + 0.74, w: W - MX * 2 - 2.9, h: lh - 1.05, fontFace: F.body, fontSize: 13.5, color: "F0F6F9", lineSpacingMultiple: 1.05, valign: "top" });
  });
}

// =====================================================================
// 7. SPLIT-LIST (list height adapts to count)
// =====================================================================
function splitList(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: 7.0, h: 1.0, fontFace: F.body, fontSize: 15.5, color: t.ink, lineSpacingMultiple: 1.15, valign: "top" });

  const items = (d.items || []).slice(0, 8);
  const listY = d.intro ? 2.85 : 1.75;
  const listH = 6.9 - listY;
  card(slide, pres, MX, listY, 7.0, listH, t.card);
  if (d.listTitle) txt(slide, d.listTitle, { x: MX + 0.35, y: listY + 0.25, w: 6.3, h: 0.45, fontFace: F.body, fontSize: 15.5, bold: true, color: t.primary });
  const rowStart = listY + (d.listTitle ? 0.85 : 0.4);
  const rowH = Math.min(0.56, (listY + listH - rowStart - 0.2) / Math.max(items.length, 1));
  items.forEach((it, i) => {
    const ry = rowStart + i * rowH;
    slide.addImage({ path: ctx.icon("check", t.good), x: MX + 0.38, y: ry + 0.04, w: 0.3, h: 0.3 });
    txtFit(slide, typeof it === "string" ? it : it.text || "", { x: MX + 0.82, y: ry, w: 5.95, h: rowH, fontFace: F.body, fontSize: 14, color: t.ink, valign: "middle" });
  });

  if (d.panel) {
    const px = 8.05, pw = W - MX - px;
    card(slide, pres, px, 1.75, pw, 2.35, t.primary, true);
    if (d.panel.label) txt(slide, d.panel.label, { x: px + 0.32, y: 1.95, w: pw - 0.6, h: 0.4, fontFace: F.body, fontSize: 14, bold: true, color: t.onDark });
    const lines = (d.panel.lines || []).map((l, i, arr) => ({ text: l, options: { bold: true, breakLine: i < arr.length - 1 } }));
    txt(slide, lines, { x: px + 0.32, y: 2.4, w: pw - 0.6, h: 1.0, fontFace: F.body, fontSize: 18, color: t.card, lineSpacingMultiple: 1.18, valign: "top" });
    if (d.panel.foot) txt(slide, d.panel.foot, { x: px + 0.32, y: 3.5, w: pw - 0.6, h: 0.5, fontFace: F.body, fontSize: 12.5, italic: true, color: "EAF3F8", valign: "top" });
  }
  if (d.highlight) {
    const px = 8.05, pw = W - MX - px;
    card(slide, pres, px, 4.25, pw, 2.45, t.goodTint);
    slide.addImage({ path: ctx.icon(d.highlight.icon || "up", t.good), x: px + 0.32, y: 4.5, w: 0.5, h: 0.5 });
    txt(slide, d.highlight.label || "", { x: px + 0.95, y: 4.52, w: pw - 1.2, h: 0.45, fontFace: F.body, fontSize: 14, bold: true, color: t.good, valign: "middle" });
    txt(slide, d.highlight.value || "", { x: px + 0.32, y: 5.1, w: pw - 0.6, h: 0.9, fontFace: F.head, fontSize: 38, bold: true, color: t.ink, align: "center", valign: "middle" });
    if (d.highlight.desc) txt(slide, d.highlight.desc, { x: px + 0.32, y: 6.0, w: pw - 0.6, h: 0.6, fontFace: F.body, fontSize: 13, color: t.mute, align: "center", lineSpacingMultiple: 1.05, valign: "top" });
  }
}

// =====================================================================
// 8. DUAL-COLUMN (adaptive rows each side)
// =====================================================================
function dualColumn(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  const colW = 5.95;
  const lx = MX, rx = W - MX - colW;
  const top = 1.8;

  if (d.leftTitle) txt(slide, d.leftTitle, { x: lx, y: top, w: colW, h: 0.45, fontFace: F.body, fontSize: 16, bold: true, color: t.primary });
  if (d.rightTitle) txt(slide, d.rightTitle, { x: rx, y: top, w: colW, h: 0.45, fontFace: F.body, fontSize: 16, bold: true, color: t.primary });

  const left = (d.left || []).slice(0, 6);
  const right = (d.right || []).slice(0, 6);
  const hasStrip = (d.strip || []).length > 0;
  const rowsY = top + 0.55;
  const bottomLimit = hasStrip ? 5.78 : 6.85;
  const maxRows = Math.max(left.length, right.length, 1);
  const gapR = 0.14;
  const rh = Math.min(1.0, (bottomLimit - rowsY - gapR * (maxRows - 1)) / maxRows);

  // qator ichidagi matnni rh ga proporsional joylashtirish (PowerPoint-xavfsiz)
  const dot = [t.bad, t.accent, t.secondary, t.mute, t.primary, t.good];
  left.forEach((it, i) => {
    const y = rowsY + i * (rh + gapR);
    card(slide, pres, lx, y, colW, rh, t.card);
    chip(slide, pres, ctx, lx + 0.2, y + (rh - 0.5) / 2, 0.5, it.icon || "check", t.tint, t.secondary, true);
    // matnni qator ichida joylashtirish uchun y offsetni qator ichiga ko'chiramiz
    const hasDesc = !!it.desc;
    const padV = Math.min(0.1, rh * 0.12);
    if (hasDesc) {
      const innerH = rh - padV * 2;
      const titleH = innerH * 0.54, descH = innerH * 0.46;
      txtFit(slide, it.title, { x: lx + 0.85, y: y + padV, w: colW - 1.05, h: titleH, fontFace: F.body, fontSize: 14.5, bold: true, color: t.ink, valign: "bottom" });
      txtFit(slide, it.desc, { x: lx + 0.85, y: y + padV + titleH, w: colW - 1.05, h: descH, fontFace: F.body, fontSize: 12, color: t.mute, valign: "top" });
    } else {
      txtFit(slide, it.title || "", { x: lx + 0.85, y, w: colW - 1.05, h: rh, fontFace: F.body, fontSize: 14.5, bold: true, color: t.ink, valign: "middle" });
    }
  });
  right.forEach((it, i) => {
    const y = rowsY + i * (rh + gapR);
    const col = it.color ? (t[it.color] || dot[i % 6]) : dot[i % 6];
    card(slide, pres, rx, y, colW, rh, t.card);
    slide.addShape(pres.shapes.OVAL, { x: rx + 0.28, y: y + (rh - 0.3) / 2, w: 0.3, h: 0.3, fill: { color: col } });
    const hasDesc = !!it.desc;
    const padV = Math.min(0.1, rh * 0.12);
    if (hasDesc) {
      const innerH = rh - padV * 2;
      const titleH = innerH * 0.54, descH = innerH * 0.46;
      txtFit(slide, it.title, { x: rx + 0.78, y: y + padV, w: colW - 1.0, h: titleH, fontFace: F.body, fontSize: 14.5, bold: true, color: col, valign: "bottom" });
      txtFit(slide, it.desc, { x: rx + 0.78, y: y + padV + titleH, w: colW - 1.0, h: descH, fontFace: F.body, fontSize: 12, color: t.mute, valign: "top" });
    } else {
      txtFit(slide, it.title || "", { x: rx + 0.78, y, w: colW - 1.0, h: rh, fontFace: F.body, fontSize: 14.5, bold: true, color: col, valign: "middle" });
    }
  });

  if (hasStrip) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: rx, y: 5.98, w: colW, h: 0.8, rectRadius: 0.13, fill: { color: t.primary } });
    const runs = [];
    d.strip.forEach((s, i) => {
      runs.push({ text: (i > 0 ? "    " : "") + s.value + " ", options: { bold: true, color: t.card } });
      runs.push({ text: s.label, options: { color: t.onDark } });
    });
    txt(slide, runs, { x: rx + 0.2, y: 5.98, w: colW - 0.4, h: 0.8, fontFace: F.body, fontSize: 15, align: "center", valign: "middle" });
  }
}

// =====================================================================
// 9. METRICS (adaptive stat count + optional stages)
// =====================================================================
function metrics(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.6, fontFace: F.body, fontSize: 15.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" });

  const stats = (d.stats || []).slice(0, 4);
  const hasStages = (d.stages || []).length > 0;
  const sy = d.intro ? 2.45 : 1.9;
  const sH = 1.95;
  const cells = gridCells(stats.length, { x: MX, y: sy, w: W - MX * 2, h: sH }, 0.25, 0.25);
  // metrics uchun bir qatorda: gridCells 4->2x2 beradi; biz bir qatorni xohlaymiz
  const n = stats.length || 1;
  const gap = 0.25;
  const cw = (W - MX * 2 - gap * (n - 1)) / n;
  stats.forEach((s, i) => {
    const x = MX + i * (cw + gap);
    const col = s.color ? (t[s.color] || t.good) : t.good;
    card(slide, pres, x, sy, cw, sH, t.card);
    txt(slide, [
      { text: s.value || "", options: { fontSize: 40, bold: true, color: col } },
      { text: s.unit ? " " + s.unit : "", options: { fontSize: 15, bold: true, color: t.mute } },
    ], { x: x + 0.25, y: sy + 0.25, w: cw - 0.5, h: 0.85, fontFace: F.head, valign: "middle" });
    txt(slide, s.label || "", { x: x + 0.27, y: sy + 1.12, w: cw - 0.5, h: 0.45, fontFace: F.body, fontSize: 14, bold: true, color: t.ink, valign: "top" });
    if (s.sub) txt(slide, s.sub, { x: x + 0.27, y: sy + 1.55, w: cw - 0.5, h: 0.32, fontFace: F.body, fontSize: 12.5, italic: true, color: t.good, valign: "top" });
  });

  if (hasStages) {
    const stages = d.stages.slice(0, 3);
    const gy = sy + sH + 0.25;
    card(slide, pres, MX, gy, W - MX * 2, 6.9 - gy, t.tint);
    if (d.stagesTitle) txt(slide, d.stagesTitle, { x: MX + 0.35, y: gy + 0.22, w: 11, h: 0.4, fontFace: F.body, fontSize: 15, bold: true, color: t.primary });
    const sgw = (W - MX * 2 - 0.7) / stages.length;
    stages.forEach((st, i) => {
      const sgx = MX + 0.35 + i * sgw;
      txt(slide, String(i + 1), { x: sgx, y: gy + 0.75, w: 0.55, h: 0.55, fontFace: F.head, fontSize: 26, bold: true, color: t.secondary, valign: "middle" });
      txt(slide, st.title || "", { x: sgx + 0.55, y: gy + 0.75, w: sgw - 0.7, h: 0.5, fontFace: F.body, fontSize: 14.5, bold: true, color: t.ink, valign: "middle" });
      txt(slide, st.desc || "", { x: sgx, y: gy + 1.35, w: sgw - 0.3, h: (6.9 - gy) - 1.5, fontFace: F.body, fontSize: 13, color: t.mute, lineSpacingMultiple: 1.05, valign: "top" });
    });
  }
}

// =====================================================================
// 10. CHART (adaptive cards + native chart + panels)
// =====================================================================
function chartLayout(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  const tops = (d.cards || []).slice(0, 4);
  let chartY = 1.8;
  if (tops.length) {
    const n = tops.length;
    const gap = 0.25;
    const cw = (W - MX * 2 - gap * (n - 1)) / n;
    const cols = [t.primary, t.secondary, t.accent, t.good];
    tops.forEach((c, i) => {
      const x = MX + i * (cw + gap);
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.75, w: cw, h: 1.65, rectRadius: 0.13, fill: { color: cols[i % 4] }, shadow: softShadow() });
      txt(slide, c.value || "", { x: x + 0.1, y: 1.92, w: cw - 0.2, h: 0.8, fontFace: F.head, fontSize: 29, bold: true, color: t.card, align: "center", valign: "middle" });
      if (c.unit) txt(slide, c.unit, { x: x + 0.1, y: 2.68, w: cw - 0.2, h: 0.32, fontFace: F.body, fontSize: 14, bold: true, color: "EEF5F9", align: "center" });
      txt(slide, c.label || "", { x: x + 0.1, y: 3.0, w: cw - 0.2, h: 0.32, fontFace: F.body, fontSize: 13, color: "EEF5F9", align: "center" });
    });
    chartY = 3.6;
  }
  const chartH = 6.9 - chartY;
  const hasPanels = (d.panels || []).length > 0;
  const chartW = hasPanels ? 6.7 : W - MX * 2;

  if (d.chart) {
    card(slide, pres, MX, chartY, chartW, chartH, t.card);
    if (d.chart.title) txt(slide, d.chart.title, { x: MX + 0.35, y: chartY + 0.18, w: chartW - 0.7, h: 0.4, fontFace: F.body, fontSize: 14, bold: true, color: t.primary });
    const type = (d.chart.type || "bar").toLowerCase();
    const chartType = type === "line" ? pres.charts.LINE : type === "pie" ? pres.charts.PIE : pres.charts.BAR;
    const data = [{ name: d.chart.seriesName || "Series", labels: d.chart.labels || [], values: d.chart.values || [] }];
    slide.addChart(chartType, data, {
      x: MX + 0.2, y: chartY + 0.6, w: chartW - 0.5, h: chartH - 1.0, barDir: "col",
      chartColors: [t.secondary, t.primary, t.accent, t.good, t.bad],
      chartArea: { fill: { color: t.surface || "FFFFFF" } },
      plotArea: { fill: { color: t.surface || "FFFFFF" } },
      catAxisLabelColor: t.mute, catAxisLabelFontSize: 10.5,
      valAxisLabelColor: t.mute, valAxisLabelFontSize: 10.5,
      valGridLine: { color: "E6EAED", size: 0.5 }, catGridLine: { style: "none" },
      showValue: type !== "pie", showPercent: type === "pie",
      dataLabelPosition: "outEnd", dataLabelColor: t.ink, dataLabelFontSize: 11, dataLabelFontBold: true,
      lineSmooth: type === "line", lineSize: 3,
      showLegend: type === "pie", legendPos: "r", legendColor: t.mute,
    });
  }
  if (hasPanels) {
    const px = MX + chartW + 0.3, pw = W - MX - px;
    const panels = d.panels.slice(0, 2);
    const ph = (chartH - 0.2 * (panels.length - 1)) / panels.length;
    panels.forEach((p, i) => {
      const py = chartY + i * (ph + 0.2);
      card(slide, pres, px, py, pw, ph, i === 0 ? t.goodTint : t.tint);
      if (p.label) txt(slide, p.label, { x: px + 0.3, y: py + 0.2, w: pw - 0.6, h: 0.4, fontFace: F.body, fontSize: 14, bold: true, color: i === 0 ? t.good : t.primary });
      // Matn overflow'ni oldini olish: har qator max 6 so'z, max 3 qator
      const rawLines = (p.lines || []).slice(0, 3).map(l => {
        const words = String(l).split(/\s+/).filter(Boolean);
        return words.length > 8 ? words.slice(0, 8).join(" ") + "…" : words.join(" ");
      });
      const lines = rawLines.map((l, j, arr) => ({ text: l, options: { bold: true, breakLine: j < arr.length - 1, color: t.ink } }));
      txt(slide, lines, { x: px + 0.3, y: py + 0.65, w: pw - 0.6, h: ph - 0.8, fontFace: F.body, fontSize: 14, lineSpacingMultiple: 1.2, valign: "top" });
    });
  }
}

// =====================================================================
// 11. CONCLUSION (adaptive rows, dark)
// =====================================================================
function conclusion(pres, slide, d, ctx) {
  const { t } = ctx;
  slide.background = { color: t.dark };
  // Dekorativ doiralar
  slide.addShape(pres.shapes.OVAL, { x: -2.2, y: 4.3,  w: 5.2, h: 5.2, fill: { color: t.primary,   transparency: 60 } });
  slide.addShape(pres.shapes.OVAL, { x: 11.3, y: -1.8, w: 4.4, h: 4.4, fill: { color: t.secondary, transparency: 62 } });

  // Sarlavha
  chip(slide, pres, ctx, MX, 0.6, 0.9, "check", t.secondary, "FFFFFF", true);
  txt(slide, d.title || "XULOSA", {
    x: MX + 1.1, y: 0.6, w: 10, h: 0.9,
    fontFace: F.head, fontSize: 32, bold: true, color: t.card, valign: "middle",
  });

  // summary — yaxlit matn bloki (sahifani to'ldiradi)
  const summary = d.summary || ((d.items || []).map(it => typeof it === "string" ? it : (it.text || "")).join(" "));
  if (summary) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: MX, y: 1.72, w: W - MX * 2, h: 2.4,
      rectRadius: 0.14, fill: { color: "FFFFFF", transparency: 85 },
    });
    txt(slide, summary, {
      x: MX + 0.3, y: 1.8, w: W - MX * 2 - 0.6, h: 2.25,
      fontFace: F.body, fontSize: 15, color: t.card,
      valign: "middle", align: "left", lineSpacingMultiple: 1.5, wrap: true,
    });
  }

  // Pastda: 4 ta asosiy natija (kichik qatorlar)
  const points = d.points || d.items || [];
  const show = points.slice(0, 4);
  const colW = (W - MX * 2 - 0.3) / 2;
  show.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MX + col * (colW + 0.3);
    const y = 4.4 + row * 1.12;
    const text = typeof it === "string" ? it : (it.text || "");
    const icon = it.icon || ["check", "star", "rocket", "layers"][i];
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: colW, h: 0.92, rectRadius: 0.12, fill: { color: "FFFFFF", transparency: 88 } });
    chip(slide, pres, ctx, x + 0.2, y + 0.2, 0.52, icon, t.card, t.secondary, true);
    txtFit(slide, text, {
      x: x + 0.88, y, w: colW - 1.05, h: 0.92,
      fontFace: F.body, fontSize: 14, color: t.card, valign: "middle", lineSpacingMultiple: 1.08,
    });
  });
}

// =====================================================================
// 12. REFERENCES (adaptive columns + thanks)
// =====================================================================
function references(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  const all = d.items || [];
  const half = Math.ceil(all.length / 2);
  const left = all.slice(0, half);
  const right = all.slice(half);
  const twoCol = right.length > 0;
  const colW = twoCol ? 5.95 : W - MX * 2;
  const blockH = 3.5;

  function col(items, x, startIdx) {
    card(slide, pres, x, 1.75, colW, blockH, t.card);
    const rh = Math.min(0.55, (blockH - 0.5) / Math.max(items.length, 1));
    let ry = 1.95;
    items.forEach((r, i) => {
      txt(slide, `${startIdx + i}.`, { x: x + 0.28, y: ry, w: 0.5, h: rh, fontFace: F.body, fontSize: 13.5, bold: true, color: t.secondary, valign: "top" });
      txt(slide, r, { x: x + 0.72, y: ry, w: colW - 1.0, h: rh, fontFace: F.body, fontSize: 13, color: t.ink, lineSpacingMultiple: 1.0, valign: "top" });
      ry += rh;
    });
  }
  col(left, MX, 1);
  if (twoCol) col(right, W - MX - colW, half + 1);

  if (d.note) txt(slide, d.note, { x: MX, y: 5.35, w: W - MX * 2, h: 0.4, fontFace: F.body, fontSize: 13.5, italic: true, color: t.mute, align: "center" });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 5.85, w: W - MX * 2, h: 1.1, rectRadius: 0.14, fill: { color: t.primary }, shadow: liftShadow() });
  txt(slide, d.thanks || "E'tiboringiz uchun rahmat!", { x: MX, y: 5.85, w: W - MX * 2, h: 1.1, fontFace: F.head, fontSize: 27, bold: true, color: t.card, align: "center", valign: "middle" });
}

// =====================================================================
// AGENDA — Reja / mundarija (asosiy bo'limlar ro'yxati). Moslashuvchan.
// =====================================================================
function agenda(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title || "Reja", d.icon || "list");

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.5, fontFace: F.body, fontSize: 15.5, color: t.ink, valign: "top" });
  const top = d.intro ? 2.35 : 1.85;

  const items = (d.items || []).slice(0, 8);
  const n = items.length || 1;
  const twoCol = n > 5;
  const cols = twoCol ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gapX = 0.3, gapY = 0.22;
  const colW = (W - MX * 2 - gapX * (cols - 1)) / cols;
  const rowH = Math.min(twoCol ? 1.0 : 0.95, ((6.95 - top) - gapY * (rows - 1)) / rows);

  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = MX + c * (colW + gapX);
    const y = top + r * (rowH + gapY);
    card(slide, pres, x, y, colW, rowH, t.card);
    // katta raqam chip
    const numCol = i % 2 === 0 ? t.primary : t.secondary;
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.22, y: y + (rowH - 0.7) / 2, w: 0.7, h: 0.7, rectRadius: 0.16, fill: { color: numCol } });
    txt(slide, String(i + 1).padStart(2, "0"), { x: x + 0.22, y: y + (rowH - 0.7) / 2, w: 0.7, h: 0.7, fontFace: F.head, fontSize: 22, bold: true, color: t.card, align: "center", valign: "middle" });
    const hasDesc = !!it.desc;
    const tx = x + 1.12, tw = colW - 1.35;
    if (hasDesc) {
      const padV = 0.14;
      const titleH = (rowH - padV * 2) * 0.52;
      const descH = (rowH - padV * 2) * 0.48;
      txtFit(slide, it.title || "", { x: tx, y: y + padV, w: tw, h: titleH, fontFace: F.body, fontSize: 15, bold: true, color: t.ink, valign: "middle" });
      txtFit(slide, it.desc, { x: tx, y: y + padV + titleH, w: tw, h: descH, fontFace: F.body, fontSize: 13, color: t.mute, valign: "middle" });
    } else {
      txtFit(slide, it.title || "", { x: tx, y, w: tw, h: rowH, fontFace: F.body, fontSize: 15.5, bold: true, color: t.ink, valign: "middle" });
    }
  });
}

// =====================================================================
// BULLETS — sodda, lekin to'la slayd (zaxira va qisqa mazmun uchun)
// =====================================================================
function bullets(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "list");
  const items = (d.items || []).slice(0, 5);
  const hasIntro = !!d.intro;
  const listX = hasIntro ? 5.3 : MX;
  if (hasIntro) {
    card(slide, pres, MX, 1.75, 4.3, 5.15, t.primary, true);
    slide.addShape(pres.shapes.RECTANGLE, { x: MX + 0.35, y: 2.15, w: 0.9, h: 0.08, fill: { color: t.accent } });
    txt(slide, d.intro, { x: MX + 0.35, y: 2.4, w: 3.6, h: 4.2, fontFace: F.body, fontSize: 17, color: t.card, lineSpacingMultiple: 1.25, valign: "top" });
  }
  const area = { x: listX, y: 1.75, w: W - MX - listX, h: 5.15 };
  const gap = 0.2;
  const rowH = (area.h - gap * (items.length - 1)) / Math.max(1, items.length);
  items.forEach((it, i) => {
    const y = area.y + i * (rowH + gap);
    card(slide, pres, area.x, y, area.w, rowH, t.card);
    slide.addShape(pres.shapes.RECTANGLE, { x: area.x, y, w: 0.12, h: rowH, fill: { color: i % 2 ? t.secondary : t.primary } });
    txt(slide, String(i + 1).padStart(2, "0"), { x: area.x + 0.3, y, w: 0.8, h: rowH, fontFace: F.head, fontSize: 24, bold: true, color: t.secondary, valign: "middle" });
    txtFit(slide, it.text || "", { x: area.x + 1.15, y: y + 0.08, w: area.w - 1.4, h: rowH - 0.16, fontFace: F.body, fontSize: 16, color: t.ink, valign: "middle", lineSpacingMultiple: 1.1 });
  });
}

// =====================================================================
// TIMELINE — vaqt chizig'i (sana + voqea), kartochkalar navbat bilan yuqori/past
// =====================================================================
function timeline(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "calendar");
  const items = (d.items || []).slice(0, 6);
  const top = d.intro ? 2.35 : 1.8;
  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.65, w: W - MX * 2, h: 0.6, fontFace: F.body, fontSize: 15, color: t.mute, valign: "top" });
  const axisY = top + (6.95 - top) / 2;
  const n = Math.max(1, items.length);
  const step = (W - MX * 2) / n;
  slide.addShape(pres.shapes.LINE, { x: MX, y: axisY, w: W - MX * 2, h: 0, line: { color: t.primary, width: 3, endArrowType: "triangle" } });
  const cardH = Math.min(1.95, axisY - top - 0.45);
  items.forEach((it, i) => {
    const cx = MX + step * (i + 0.5);
    const up = i % 2 === 0;
    const cw = Math.min(step * 1.7, 3.6);
    const x = Math.min(Math.max(MX, cx - cw / 2), W - MX - cw);
    const y = up ? axisY - 0.45 - cardH : axisY + 0.45;
    slide.addShape(pres.shapes.LINE, { x: cx, y: up ? y + cardH : axisY, w: 0, h: 0.45, line: { color: t.secondary, width: 1.5 } });
    slide.addShape(pres.shapes.OVAL, { x: cx - 0.17, y: axisY - 0.17, w: 0.34, h: 0.34, fill: { color: i % 2 ? t.secondary : t.accent }, line: { color: t.light, width: 2 } });
    card(slide, pres, x, y, cw, cardH, t.card);
    txt(slide, it.date || "", { x: x + 0.2, y: y + 0.12, w: cw - 0.4, h: 0.42, fontFace: F.head, fontSize: 18, bold: true, color: t.primary });
    txtFit(slide, it.title || "", { x: x + 0.2, y: y + 0.52, w: cw - 0.4, h: 0.45, fontFace: F.body, fontSize: 14, bold: true, color: t.ink });
    txtFit(slide, it.desc || "", { x: x + 0.2, y: y + 0.95, w: cw - 0.4, h: cardH - 1.05, fontFace: F.body, fontSize: 12.5, color: t.mute, valign: "top" });
  });
}

// =====================================================================
// PROCESS — chevron strelkalar bilan jarayon zanjiri
// =====================================================================
function processFlow(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "cogs");
  const items = (d.items || []).slice(0, 5);
  let y0 = 1.8;
  if (d.intro) { txt(slide, d.intro, { x: MX, y: 1.65, w: W - MX * 2, h: 0.7, fontFace: F.body, fontSize: 15, color: t.mute, valign: "top" }); y0 = 2.45; }
  const n = Math.max(1, items.length);
  const gap = -0.12;
  const cw = (W - MX * 2 - gap * (n - 1)) / n;
  const cols = [t.primary, t.secondary, t.accent, t.dark, t.good];
  items.forEach((it, i) => {
    const x = MX + i * (cw + gap);
    const col = cols[i % cols.length];
    slide.addShape(i === 0 ? pres.shapes.PENTAGON : pres.shapes.CHEVRON, { x, y: y0, w: cw, h: 1.15, fill: { color: col } });
    txt(slide, String(i + 1).padStart(2, "0"), { x: x + (i === 0 ? 0.25 : 0.62), y: y0, w: 0.9, h: 1.15, fontFace: F.head, fontSize: 26, bold: true, color: t.card, valign: "middle" });
    chip(slide, pres, ctx, x + cw - 1.05, y0 + 0.27, 0.6, it.icon || "check", t.card, col, true);
    const by = y0 + 1.4;
    card(slide, pres, x + 0.1, by, cw - 0.2 + gap, 6.95 - by, t.card);
    slide.addShape(pres.shapes.RECTANGLE, { x: x + 0.1, y: by, w: cw - 0.2 + gap, h: 0.07, fill: { color: col } });
    txtFit(slide, it.title || "", { x: x + 0.3, y: by + 0.2, w: cw - 0.6 + gap, h: 0.75, fontFace: F.head, fontSize: 16, bold: true, color: t.ink, valign: "top" });
    txtFit(slide, it.desc || "", { x: x + 0.3, y: by + 0.95, w: cw - 0.6 + gap, h: 6.95 - by - 1.1, fontFace: F.body, fontSize: 13.5, color: t.mute, valign: "top", lineSpacingMultiple: 1.08 });
  });
}

// =====================================================================
// TABLE — taqqoslash jadvali (PowerPoint'da tahrirlanadigan)
// =====================================================================
function tableSlide(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "layers");
  const headers = (d.headers || []).slice(0, 5);
  const rows = (d.rows || []).slice(0, 6).map(r => headers.map((_, i) => String((r || [])[i] ?? "")));
  let y = 1.8;
  if (d.intro) { txt(slide, d.intro, { x: MX, y: 1.65, w: W - MX * 2, h: 0.6, fontFace: F.body, fontSize: 15, color: t.mute, valign: "top" }); y = 2.35; }
  const fontSize = rows.length > 4 || headers.length > 4 ? 13 : 14.5;
  const head = headers.map(h => ({ text: h, options: { bold: true, color: t.card, fill: { color: t.primary }, fontFace: F.head, fontSize: fontSize + 0.5, valign: "middle" } }));
  const body = rows.map((r, ri) => r.map((cell, ci) => ({ text: cell, options: {
    color: ci === 0 ? t.ink : t.ink, bold: ci === 0, fontFace: F.body, fontSize, valign: "middle",
    fill: { color: ri % 2 ? (t.tint) : (t.surface || "FFFFFF") },
  } })));
  const firstW = headers.length > 2 ? 3.0 : (W - MX * 2) / 2;
  const restW = (W - MX * 2 - firstW) / Math.max(1, headers.length - 1);
  slide.addTable([head, ...body], {
    x: MX, y, w: W - MX * 2, colW: headers.map((_, i) => (i === 0 ? firstW : restW)),
    border: { type: "solid", pt: 0.75, color: t.line }, margin: 0.08, rowH: Math.min(0.85, (6.95 - y) / (rows.length + 1)), autoPage: false,
  });
}

// =====================================================================
// SECTION — bo'lim ajratuvchi (katta raqam + sarlavha)
// =====================================================================
function section(pres, slide, d, ctx) {
  const { t } = ctx;
  slide.background = { color: t.primary };
  slide.addShape(pres.shapes.OVAL, { x: W - 5.2, y: -1.6, w: 6.5, h: 6.5, fill: { color: t.secondary, transparency: 55 } });
  slide.addShape(pres.shapes.OVAL, { x: W - 2.6, y: 4.6, w: 3.6, h: 3.6, fill: { color: t.accent, transparency: 45 } });
  txt(slide, String(d.number || "").padStart(2, "0"), { x: MX, y: 1.2, w: 4, h: 2.0, fontFace: F.head, fontSize: 110, bold: true, color: t.card, transparency: 35 });
  slide.addShape(pres.shapes.RECTANGLE, { x: MX, y: 3.45, w: 1.2, h: 0.09, fill: { color: t.accent } });
  txtFit(slide, d.title || "", { x: MX, y: 3.7, w: 9.5, h: 1.5, fontFace: F.head, fontSize: 40, bold: true, color: t.card, valign: "top" });
  if (d.subtitle) txtFit(slide, d.subtitle, { x: MX, y: 5.25, w: 9.0, h: 1.2, fontFace: F.body, fontSize: 18, color: t.onDark, valign: "top" });
}

// =====================================================================
// QUOTE — iqtibos (olim, hujjat, qonun) + 2-3 asosiy xulosa
// =====================================================================
function quote(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "book");
  const pts = (d.points || []).slice(0, 3);
  const qw = pts.length ? 7.6 : W - MX * 2;
  card(slide, pres, MX, 1.8, qw, 5.1, t.tint);
  txt(slide, "“", { x: MX + 0.25, y: 1.55, w: 1.5, h: 1.6, fontFace: "Georgia", fontSize: 120, bold: true, color: t.accent });
  txtFit(slide, d.quote || "", { x: MX + 0.6, y: 2.75, w: qw - 1.2, h: 2.85, fontFace: F.head, fontSize: 22, italic: true, color: t.ink, valign: "top", lineSpacingMultiple: 1.15 });
  slide.addShape(pres.shapes.RECTANGLE, { x: MX + 0.6, y: 5.85, w: 0.6, h: 0.06, fill: { color: t.accent } });
  txt(slide, [
    { text: d.author || "", options: { bold: true, color: t.primary, breakLine: !!d.source } },
    ...(d.source ? [{ text: d.source, options: { color: t.mute, italic: true } }] : []),
  ], { x: MX + 1.35, y: 5.65, w: qw - 1.9, h: 0.95, fontFace: F.body, fontSize: 14, valign: "middle" });
  const px = MX + qw + 0.3, pw = W - MX - px;
  const ph = (5.1 - 0.2 * (pts.length - 1)) / Math.max(1, pts.length);
  pts.forEach((p, i) => {
    const y = 1.8 + i * (ph + 0.2);
    card(slide, pres, px, y, pw, ph, t.card);
    chip(slide, pres, ctx, px + 0.25, y + 0.25, 0.55, p.icon || "check", t.tint, t.secondary, true);
    txtFit(slide, p.text || "", { x: px + 0.95, y: y + 0.15, w: pw - 1.15, h: ph - 0.3, fontFace: F.body, fontSize: 14, color: t.ink, valign: "middle" });
  });
}

// =====================================================================
// BIGNUMBER — bitta katta raqam (asosiy ko'rsatkich) + yordamchi raqamlar
// =====================================================================
function bignumber(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "chart");
  const hero = d.hero || {};
  card(slide, pres, MX, 1.8, 6.6, 5.1, t.primary, true);
  txt(slide, [
    { text: hero.value || "", options: { fontSize: 96, bold: true, color: t.card } },
    { text: hero.unit ? " " + hero.unit : "", options: { fontSize: 36, bold: true, color: t.accent } },
  ], { x: MX + 0.4, y: 2.05, w: 6.0, h: 1.9, fontFace: F.head, valign: "middle", fit: "shrink" });
  txtFit(slide, hero.label || "", { x: MX + 0.45, y: 4.0, w: 5.8, h: 0.6, fontFace: F.head, fontSize: 20, bold: true, color: t.card });
  txtFit(slide, hero.desc || "", { x: MX + 0.45, y: 4.65, w: 5.8, h: 2.0, fontFace: F.body, fontSize: 15, color: t.onDark, valign: "top", lineSpacingMultiple: 1.12 });
  const items = (d.items || []).slice(0, 3);
  const px = MX + 6.9, pw = W - MX - px;
  const ih = (5.1 - 0.2 * (items.length - 1)) / Math.max(1, items.length);
  items.forEach((it, i) => {
    const y = 1.8 + i * (ih + 0.2);
    card(slide, pres, px, y, pw, ih, t.card);
    txt(slide, it.value || "", { x: px + 0.3, y, w: 2.0, h: ih, fontFace: F.head, fontSize: 30, bold: true, color: [t.secondary, t.accent, t.good][i % 3], valign: "middle", fit: "shrink" });
    txtFit(slide, it.label || "", { x: px + 2.35, y: y + 0.1, w: pw - 2.6, h: ih - 0.2, fontFace: F.body, fontSize: 14, color: t.ink, valign: "middle" });
  });
}

// =====================================================================
// SWOT — 2x2 rangli kvadrantlar
// =====================================================================
const SWOT_LABELS = {
  uz: ["Kuchli tomonlar", "Zaif tomonlar", "Imkoniyatlar", "Tahdidlar"],
  ru: ["Сильные стороны", "Слабые стороны", "Возможности", "Угрозы"],
  en: ["Strengths", "Weaknesses", "Opportunities", "Threats"],
};
function swot(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "target");
  const names = SWOT_LABELS[ctx.lang || "uz"] || SWOT_LABELS.uz;
  const groups = [d.strengths, d.weaknesses, d.opportunities, d.threats];
  const colors = [t.good, t.bad, t.secondary, t.accent];
  const letters = ["S", "W", "O", "T"];
  const gw = (W - MX * 2 - 0.25) / 2, gh = (5.15 - 0.25) / 2;
  groups.forEach((list, i) => {
    const x = MX + (i % 2) * (gw + 0.25), y = 1.75 + Math.floor(i / 2) * (gh + 0.25);
    card(slide, pres, x, y, gw, gh, t.card);
    slide.addShape(pres.shapes.RECTANGLE, { x, y, w: 1.05, h: gh, fill: { color: colors[i] } });
    txt(slide, letters[i], { x, y: y + 0.1, w: 1.05, h: 1.0, fontFace: F.head, fontSize: 44, bold: true, color: t.card, align: "center", valign: "middle" });
    txt(slide, names[i], { x: x + 1.3, y: y + 0.12, w: gw - 1.5, h: 0.45, fontFace: F.head, fontSize: 17, bold: true, color: colors[i] });
    const lines = (list || []).slice(0, 3).map((item, k, all) => ({ text: item, options: { bullet: { code: "25AA" }, breakLine: k < all.length - 1 } }));
    txtFit(slide, lines, { x: x + 1.3, y: y + 0.6, w: gw - 1.5, h: gh - 0.75, fontFace: F.body, fontSize: 14, color: t.ink, valign: "top", paraSpaceAfter: 4 });
  });
}

// =====================================================================
// DIAGRAM — GOST uslubidagi sxema (mustaqil ish dvigatelidan) + 2-3 izoh
// =====================================================================
function diagram(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon || "layers");
  const pts = (d.points || []).slice(0, 3);
  const areaW = pts.length ? 8.4 : W - MX * 2;
  card(slide, pres, MX, 1.75, areaW, 5.2, "FFFFFF" === t.surface ? t.card : t.card);
  // Sxema oq fonda chiziladi — to'q mavzuda ham oq "varaq" ustida
  slide.addShape(pres.shapes.RECTANGLE, { x: MX + 0.12, y: 1.87, w: areaW - 0.24, h: 4.96, fill: { color: "FFFFFF" } });
  if (d._image) {
    const maxW = areaW - 0.5, maxH = 4.7;
    const ratio = d._image.width / d._image.height;
    let w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    slide.addImage({ path: d._image.path, x: MX + (areaW - w) / 2, y: 1.87 + (4.96 - h) / 2, w, h });
  }
  const px = MX + areaW + 0.3, pw = W - MX - px;
  const ph = (5.2 - 0.2 * (pts.length - 1)) / Math.max(1, pts.length);
  pts.forEach((p, i) => {
    const y = 1.75 + i * (ph + 0.2);
    card(slide, pres, px, y, pw, ph, t.card);
    txt(slide, String(i + 1), { x: px + 0.2, y: y + 0.18, w: 0.5, h: 0.5, fontFace: F.head, fontSize: 22, bold: true, color: t.accent });
    txtFit(slide, p.text || "", { x: px + 0.7, y: y + 0.15, w: pw - 0.9, h: ph - 0.3, fontFace: F.body, fontSize: 13.5, color: t.ink, valign: "middle" });
  });
}

// ---------- registr ----------
const LAYOUTS = {
  title,
  agenda,
  "stat-callout": statCallout,
  objectives,
  steps,
  "feature-grid": featureGrid,
  layers,
  "split-list": splitList,
  "dual-column": dualColumn,
  metrics,
  chart: chartLayout,
  conclusion,
  references,
  bullets,
  timeline,
  process: processFlow,
  table: tableSlide,
  section,
  quote,
  bignumber,
  swot,
  diagram,
};
const LAYOUT_NAMES = Object.keys(LAYOUTS);

function render(pres, slide, data, ctx) {
  // Joriy mavzu: shrift, kartochka, sarlavha, fon uslubi + palitra
  TH = Object.assign({}, ctx.theme || THEMES.modern, { _t: ctx.t, _pres: pres, _slideNo: data.number, _deck: ctx.deckTitle || "" });
  const fn = LAYOUTS[data.layout] || statCallout;
  fn(pres, slide, data, ctx);
}

module.exports = { render, LAYOUTS, LAYOUT_NAMES };
