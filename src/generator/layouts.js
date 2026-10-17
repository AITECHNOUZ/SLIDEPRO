// src/layouts.js
// 12 xil ZAMONAVIY va MOSLASHUVCHAN (adaptive) slayd dizayni.
// - Kartochkalar soni elementlar soniga qarab avtomatik joylashadi (bo'sh joy qolmaydi).
// - Matn qutilarda fit:"shrink" — uzun matn avtomatik kichrayadi, hech qachon chiqib ketmaydi.

const { FONTS } = require("./theme");

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

// ---------- modern card ----------
function card(slide, pres, x, y, w, h, fill, lift) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.13, fill: { color: fill },
    shadow: lift ? liftShadow() : softShadow(),
  });
}

// ---------- icon chip (rounded square or circle) ----------
function chip(slide, pres, ctx, x, y, d, iconName, bg, iconColor, round) {
  if (round) slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: bg } });
  else slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: d, h: d, rectRadius: d * 0.28, fill: { color: bg } });
  const iw = d * 0.5;
  slide.addImage({ path: ctx.icon(iconName, iconColor), x: x + (d - iw) / 2, y: y + (d - iw) / 2, w: iw, h: iw });
}

// ---------- pill (rounded tag) ----------
function pill(slide, pres, x, y, w, h, fill, text, color) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: h / 2, fill: { color: fill } });
  txt(slide, text, { x, y, w, h, fontFace: FONTS.body, fontSize: 11, bold: true, color, charSpacing: 1.5, align: "center", valign: "middle" });
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

// ---------- sarlavha (zamonaviy, editorial) ----------
function header(pres, slide, ctx, num, title, iconName) {
  const { t } = ctx;
  // katta soyalangan raqam
  txt(slide, String(num).padStart(2, "0"), {
    x: MX, y: 0.45, w: 1.1, h: 0.95, fontFace: FONTS.head, fontSize: 44, bold: true,
    color: t.secondary, align: "left", valign: "middle", transparency: 62,
  });
  txtFit(slide, title, {
    x: MX + 0.95, y: 0.5, w: W - MX * 2 - 1.7, h: 0.85, fontFace: FONTS.head, fontSize: 25, bold: true,
    color: t.ink, align: "left", valign: "middle",
  });
  if (iconName) {
    chip(slide, pres, ctx, W - MX - 0.82, 0.5, 0.82, iconName, t.primary, "FFFFFF", false);
  }
}

function lightBg(slide, t) { slide.background = { color: t.light }; }

// =====================================================================
// 1. TITLE
// =====================================================================
function title(pres, slide, d, ctx) {
  const { t } = ctx;
  slide.background = { color: t.dark };
  slide.addShape(pres.shapes.OVAL, { x: 9.7, y: -2.2, w: 6.2, h: 6.2, fill: { color: t.primary, transparency: 60 } });
  slide.addShape(pres.shapes.OVAL, { x: 11.4, y: 4.7, w: 4.2, h: 4.2, fill: { color: t.secondary, transparency: 64 } });

  if (d.org) txt(slide, d.org, { x: MX, y: 0.6, w: 10.5, h: 0.4, fontFace: FONTS.body, fontSize: 13.5, bold: true, color: t.onDark, charSpacing: 2.5 });
  if (d.faculty) txt(slide, d.faculty, { x: MX, y: 1.0, w: 10.5, h: 0.35, fontFace: FONTS.body, fontSize: 12.5, color: t.onDark, transparency: 22 });

  // kicker pill
  pill(slide, pres, MX, 2.0, 2.5, 0.42, t.accent, (d.kicker || "TAQDIMOT"), t.dark);
  if (d.subkicker) txt(slide, d.subkicker, { x: MX + 2.65, y: 2.0, w: 6, h: 0.42, fontFace: FONTS.body, fontSize: 11.5, color: t.onDark, charSpacing: 1.5, valign: "middle" });

  const titleLines = (d.title || "").split("\n").map((line, i, arr) => ({ text: line, options: i < arr.length - 1 ? { breakLine: true } : {} }));
  txt(slide, titleLines, { x: MX - 0.02, y: 2.7, w: 11.2, h: 2.2, fontFace: FONTS.head, fontSize: 36, bold: true, color: t.card, align: "left", valign: "top", lineSpacingMultiple: 1.04 });

  // meta as a card strip
  const meta = d.meta || [];
  if (meta.length) {
    let by = 5.55;
    meta.forEach((m) => {
      txt(slide, [
        { text: (m.label || "") + "  ", options: { color: t.onDark } },
        { text: m.value || "", options: { color: t.card, bold: true } },
      ], { x: MX, y: by, w: 8.5, h: 0.46, fontFace: FONTS.body, fontSize: 14.5, valign: "middle" });
      by += 0.48;
    });
  }
  if (d.footer) txt(slide, d.footer, { x: MX, y: 6.75, w: 9.5, h: 0.4, fontFace: FONTS.body, fontSize: 11, italic: true, color: t.onDark, valign: "middle" });
  if (d.date) txt(slide, d.date, { x: W - MX - 3, y: 6.75, w: 3, h: 0.4, fontFace: FONTS.body, fontSize: 11.5, bold: true, color: t.accent, align: "right", valign: "middle" });
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

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.75, w: 7.0, h: 1.25, fontFace: FONTS.body, fontSize: 16, color: t.ink, valign: "top", lineSpacingMultiple: 1.15 });

  if (d.highlight) {
    const c = { x: MX, y: 3.15, w: 7.0, h: 1.6 };
    card(slide, pres, c.x, c.y, c.w, c.h, t.badTint);
    chip(slide, pres, ctx, c.x + 0.3, c.y + 0.32, 0.6, d.highlight.icon || "warning", t.card, t.bad, false);
    txt(slide, d.highlight.label || "", { x: c.x + 1.05, y: c.y + 0.28, w: c.w - 1.3, h: 0.42, fontFace: FONTS.body, fontSize: 13, bold: true, color: t.bad });
    txt(slide, d.highlight.text || "", { x: c.x + 1.05, y: c.y + 0.72, w: c.w - 1.3, h: 0.78, fontFace: FONTS.body, fontSize: 12.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" });
  }

  if (d.stat) {
    const sx = 8.05, sw = W - MX - sx;
    card(slide, pres, sx, 1.75, sw, 3.0, t.primary, true);
    if (d.stat.label) txt(slide, d.stat.label, { x: sx + 0.35, y: 2.0, w: sw - 0.7, h: 0.5, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: t.onDark });
    txt(slide, d.stat.value || "", { x: sx + 0.35, y: 2.5, w: sw - 0.7, h: 1.05, fontFace: FONTS.head, fontSize: 48, bold: true, color: t.card });
    if (d.stat.desc) txt(slide, d.stat.desc, { x: sx + 0.35, y: 3.6, w: sw - 0.7, h: 1.0, fontFace: FONTS.body, fontSize: 12.5, color: "EAF3F8", lineSpacingMultiple: 1.12, valign: "top" });
  }

  // adaptive bottom items
  const items = (d.items || []).slice(0, 4);
  if (items.length) {
    const cells = gridCells(items.length, { x: MX, y: 5.1, w: W - MX * 2, h: 1.75 }, 0.25, 0.2);
    items.forEach((it, i) => {
      const c = cells[i];
      card(slide, pres, c.x, c.y, c.w, c.h, t.card);
      chip(slide, pres, ctx, c.x + 0.28, c.y + 0.3, 0.62, it.icon || "check", t.tint, t.secondary, true);
      txtFit(slide, it.title || "", { x: c.x + 1.02, y: c.y + 0.28, w: c.w - 1.25, h: 0.6, fontFace: FONTS.body, fontSize: 14, bold: true, color: t.primary, valign: "middle" });
      txtFit(slide, it.desc || "", { x: c.x + 0.3, y: c.y + 0.98, w: c.w - 0.55, h: c.h - 1.25, fontFace: FONTS.body, fontSize: 11.5, color: t.mute, lineSpacingMultiple: 1.06, valign: "top" });
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
    txt(slide, d.banner.label || "Maqsad", { x: MX + 1.4, y: 1.95, w: W - MX * 2 - 1.8, h: 0.4, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: t.onDark, charSpacing: 1 });
    txt(slide, d.banner.text || "", { x: MX + 1.4, y: 2.32, w: W - MX * 2 - 1.8, h: 0.75, fontFace: FONTS.body, fontSize: 14.5, color: t.card, lineSpacingMultiple: 1.08, valign: "top" });
    gridTop = 3.4;
  }

  const items = (d.items || []).slice(0, 6);
  const cells = gridCells(items.length, { x: MX, y: gridTop, w: W - MX * 2, h: 6.95 - gridTop }, 0.3, 0.3);
  items.forEach((it, i) => {
    const c = cells[i];
    card(slide, pres, c.x, c.y, c.w, c.h, t.card);
    chip(slide, pres, ctx, c.x + 0.32, c.y + 0.34, 0.88, it.icon || "check", t.tint, t.secondary, true);
    txt(slide, `0${i + 1}`, { x: c.x + c.w - 1.15, y: c.y + 0.2, w: 0.95, h: 0.65, fontFace: FONTS.head, fontSize: 32, bold: true, color: t.tint, align: "right" });
    txtFit(slide, it.title || "", { x: c.x + 1.35, y: c.y + 0.34, w: c.w - 2.4, h: 0.5, fontFace: FONTS.body, fontSize: 15, bold: true, color: t.ink, valign: "middle" });
    txtFit(slide, it.desc || "", { x: c.x + 0.34, y: c.y + 1.28, w: c.w - 0.6, h: Math.min(0.95, c.h - 1.5), fontFace: FONTS.body, fontSize: 12, color: t.mute, lineSpacingMultiple: 1.08, valign: "top" });
  });
}

// =====================================================================
// 4. STEPS (adaptive width)
// =====================================================================
function steps(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.7, fontFace: FONTS.body, fontSize: 14.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" });

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
    txt(slide, String(i + 1), { x: sx + 0.12, y: sy + 0.16, w: 0.5, h: 0.4, fontFace: FONTS.head, fontSize: 20, bold: true, color: t.tint });
    txtFit(slide, it.title || "", { x: sx + 0.12, y: sy + 1.2, w: sw - 0.24, h: 0.5, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: t.ink, align: "center", valign: "middle" });
    txtFit(slide, it.desc || "", { x: sx + 0.14, y: sy + 1.7, w: sw - 0.28, h: sh - 2.0, fontFace: FONTS.body, fontSize: 10.5, color: t.mute, align: "center", lineSpacingMultiple: 1.04, valign: "top" });
  });

  if (hasNote) {
    const ny = sy + sh + 0.25;
    card(slide, pres, MX, ny, W - MX * 2, 6.9 - ny, t.tint);
    chip(slide, pres, ctx, MX + 0.32, ny + 0.32, 0.64, d.note.icon || "bolt", t.card, t.accent, true);
    txt(slide, d.note.label || "", { x: MX + 1.1, y: ny + 0.26, w: W - MX * 2 - 1.4, h: 0.42, fontFace: FONTS.body, fontSize: 14, bold: true, color: t.primary });
    txt(slide, d.note.text || "", { x: MX + 1.1, y: ny + 0.68, w: W - MX * 2 - 1.4, h: (6.9 - ny) - 0.8, fontFace: FONTS.body, fontSize: 13, color: t.ink, lineSpacingMultiple: 1.12, valign: "top" });
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
  if (d.intro) { txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.7, fontFace: FONTS.body, fontSize: 14.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" }); top = 2.6; }
  const hasNote = !!d.note;
  const bottom = hasNote ? 6.15 : 6.95;

  const items = (d.items || []).slice(0, 6);
  const cells = gridCells(items.length, { x: MX, y: top, w: W - MX * 2, h: bottom - top }, 0.3, 0.3);
  items.forEach((it, i) => {
    const c = cells[i];
    card(slide, pres, c.x, c.y, c.w, c.h, t.card);
    chip(slide, pres, ctx, c.x + 0.32, c.y + (c.h - 0.8) / 2 - 0.1, 0.8, it.icon || "check", t.tint, t.secondary, false);
    txtFit(slide, it.title || "", { x: c.x + 1.35, y: c.y + 0.28, w: c.w - 1.65, h: 0.5, fontFace: FONTS.body, fontSize: 14.5, bold: true, color: t.primary, valign: "middle" });
    txtFit(slide, it.desc || "", { x: c.x + 1.35, y: c.y + 0.78, w: c.w - 1.65, h: c.h - 1.12, fontFace: FONTS.body, fontSize: 11.5, color: t.mute, lineSpacingMultiple: 1.06, valign: "top" });
  });

  if (hasNote) txt(slide, [
    { text: (d.note.label ? d.note.label + " " : ""), options: { bold: true, color: t.primary } },
    { text: d.note.text || "", options: { color: t.mute, italic: true } },
  ], { x: MX, y: 6.3, w: W - MX * 2, h: 0.7, fontFace: FONTS.body, fontSize: 12.5, valign: "top", lineSpacingMultiple: 1.06 });
}

// =====================================================================
// 6. LAYERS (adaptive height, 2-4)
// =====================================================================
function layers(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  let top = 1.8;
  if (d.intro) { txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.5, fontFace: FONTS.body, fontSize: 14.5, color: t.ink, valign: "top" }); top = 2.3; }

  const ls = (d.items || []).slice(0, 4);
  const n = ls.length || 1;
  const cols = [t.secondary, t.primary, t.dark, t.primary];
  const gap = 0.22;
  const lh = (6.95 - top - gap * (n - 1)) / n;
  ls.forEach((it, i) => {
    const ly = top + i * (lh + gap);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: ly, w: W - MX * 2, h: lh, rectRadius: 0.13, fill: { color: cols[i % cols.length] }, shadow: softShadow() });
    txt(slide, it.num || String(n - i), { x: MX + 0.3, y: ly + (lh - 0.9) / 2, w: 1.0, h: 0.9, fontFace: FONTS.head, fontSize: 46, bold: true, color: t.card, align: "center", valign: "middle", transparency: 35 });
    chip(slide, pres, ctx, MX + 1.55, ly + (lh - 0.66) / 2, 0.66, it.icon || "layers", t.card, cols[i % cols.length], true);
    txtFit(slide, it.title || "", { x: MX + 2.45, y: ly + 0.24, w: W - MX * 2 - 2.9, h: 0.5, fontFace: FONTS.body, fontSize: 17, bold: true, color: t.card, valign: "middle" });
    txtFit(slide, it.desc || "", { x: MX + 2.45, y: ly + 0.74, w: W - MX * 2 - 2.9, h: lh - 1.05, fontFace: FONTS.body, fontSize: 12, color: "F0F6F9", lineSpacingMultiple: 1.05, valign: "top" });
  });
}

// =====================================================================
// 7. SPLIT-LIST (list height adapts to count)
// =====================================================================
function splitList(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: 7.0, h: 1.0, fontFace: FONTS.body, fontSize: 14.5, color: t.ink, lineSpacingMultiple: 1.15, valign: "top" });

  const items = (d.items || []).slice(0, 8);
  const listY = d.intro ? 2.85 : 1.75;
  const listH = 6.9 - listY;
  card(slide, pres, MX, listY, 7.0, listH, t.card);
  if (d.listTitle) txt(slide, d.listTitle, { x: MX + 0.35, y: listY + 0.25, w: 6.3, h: 0.45, fontFace: FONTS.body, fontSize: 14.5, bold: true, color: t.primary });
  const rowStart = listY + (d.listTitle ? 0.85 : 0.4);
  const rowH = Math.min(0.56, (listY + listH - rowStart - 0.2) / Math.max(items.length, 1));
  items.forEach((it, i) => {
    const ry = rowStart + i * rowH;
    slide.addImage({ path: ctx.icon("check", t.good), x: MX + 0.38, y: ry + 0.04, w: 0.3, h: 0.3 });
    txtFit(slide, typeof it === "string" ? it : it.text || "", { x: MX + 0.82, y: ry, w: 5.95, h: rowH, fontFace: FONTS.body, fontSize: 13, color: t.ink, valign: "middle" });
  });

  if (d.panel) {
    const px = 8.05, pw = W - MX - px;
    card(slide, pres, px, 1.75, pw, 2.35, t.primary, true);
    if (d.panel.label) txt(slide, d.panel.label, { x: px + 0.32, y: 1.95, w: pw - 0.6, h: 0.4, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: t.onDark });
    const lines = (d.panel.lines || []).map((l, i, arr) => ({ text: l, options: { bold: true, breakLine: i < arr.length - 1 } }));
    txt(slide, lines, { x: px + 0.32, y: 2.4, w: pw - 0.6, h: 1.0, fontFace: FONTS.body, fontSize: 18, color: t.card, lineSpacingMultiple: 1.18, valign: "top" });
    if (d.panel.foot) txt(slide, d.panel.foot, { x: px + 0.32, y: 3.5, w: pw - 0.6, h: 0.5, fontFace: FONTS.body, fontSize: 11, italic: true, color: "EAF3F8", valign: "top" });
  }
  if (d.highlight) {
    const px = 8.05, pw = W - MX - px;
    card(slide, pres, px, 4.25, pw, 2.45, t.goodTint);
    slide.addImage({ path: ctx.icon(d.highlight.icon || "up", t.good), x: px + 0.32, y: 4.5, w: 0.5, h: 0.5 });
    txt(slide, d.highlight.label || "", { x: px + 0.95, y: 4.52, w: pw - 1.2, h: 0.45, fontFace: FONTS.body, fontSize: 13, bold: true, color: t.good, valign: "middle" });
    txt(slide, d.highlight.value || "", { x: px + 0.32, y: 5.1, w: pw - 0.6, h: 0.9, fontFace: FONTS.head, fontSize: 38, bold: true, color: t.ink, align: "center", valign: "middle" });
    if (d.highlight.desc) txt(slide, d.highlight.desc, { x: px + 0.32, y: 6.0, w: pw - 0.6, h: 0.6, fontFace: FONTS.body, fontSize: 11.5, color: t.mute, align: "center", lineSpacingMultiple: 1.05, valign: "top" });
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

  if (d.leftTitle) txt(slide, d.leftTitle, { x: lx, y: top, w: colW, h: 0.45, fontFace: FONTS.body, fontSize: 16, bold: true, color: t.primary });
  if (d.rightTitle) txt(slide, d.rightTitle, { x: rx, y: top, w: colW, h: 0.45, fontFace: FONTS.body, fontSize: 16, bold: true, color: t.primary });

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
      txtFit(slide, it.title, { x: lx + 0.85, y: y + padV, w: colW - 1.05, h: titleH, fontFace: FONTS.body, fontSize: 13.5, bold: true, color: t.ink, valign: "bottom" });
      txtFit(slide, it.desc, { x: lx + 0.85, y: y + padV + titleH, w: colW - 1.05, h: descH, fontFace: FONTS.body, fontSize: 10.5, color: t.mute, valign: "top" });
    } else {
      txtFit(slide, it.title || "", { x: lx + 0.85, y, w: colW - 1.05, h: rh, fontFace: FONTS.body, fontSize: 13.5, bold: true, color: t.ink, valign: "middle" });
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
      txtFit(slide, it.title, { x: rx + 0.78, y: y + padV, w: colW - 1.0, h: titleH, fontFace: FONTS.body, fontSize: 13.5, bold: true, color: col, valign: "bottom" });
      txtFit(slide, it.desc, { x: rx + 0.78, y: y + padV + titleH, w: colW - 1.0, h: descH, fontFace: FONTS.body, fontSize: 10.5, color: t.mute, valign: "top" });
    } else {
      txtFit(slide, it.title || "", { x: rx + 0.78, y, w: colW - 1.0, h: rh, fontFace: FONTS.body, fontSize: 13.5, bold: true, color: col, valign: "middle" });
    }
  });

  if (hasStrip) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: rx, y: 5.98, w: colW, h: 0.8, rectRadius: 0.13, fill: { color: t.primary } });
    const runs = [];
    d.strip.forEach((s, i) => {
      runs.push({ text: (i > 0 ? "    " : "") + s.value + " ", options: { bold: true, color: t.card } });
      runs.push({ text: s.label, options: { color: t.onDark } });
    });
    txt(slide, runs, { x: rx + 0.2, y: 5.98, w: colW - 0.4, h: 0.8, fontFace: FONTS.body, fontSize: 14, align: "center", valign: "middle" });
  }
}

// =====================================================================
// 9. METRICS (adaptive stat count + optional stages)
// =====================================================================
function metrics(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title, d.icon);

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.6, fontFace: FONTS.body, fontSize: 14.5, color: t.ink, lineSpacingMultiple: 1.1, valign: "top" });

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
    ], { x: x + 0.25, y: sy + 0.25, w: cw - 0.5, h: 0.85, fontFace: FONTS.head, valign: "middle" });
    txt(slide, s.label || "", { x: x + 0.27, y: sy + 1.12, w: cw - 0.5, h: 0.45, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: t.ink, valign: "top" });
    if (s.sub) txt(slide, s.sub, { x: x + 0.27, y: sy + 1.55, w: cw - 0.5, h: 0.32, fontFace: FONTS.body, fontSize: 11, italic: true, color: t.good, valign: "top" });
  });

  if (hasStages) {
    const stages = d.stages.slice(0, 3);
    const gy = sy + sH + 0.25;
    card(slide, pres, MX, gy, W - MX * 2, 6.9 - gy, t.tint);
    if (d.stagesTitle) txt(slide, d.stagesTitle, { x: MX + 0.35, y: gy + 0.22, w: 11, h: 0.4, fontFace: FONTS.body, fontSize: 14, bold: true, color: t.primary });
    const sgw = (W - MX * 2 - 0.7) / stages.length;
    stages.forEach((st, i) => {
      const sgx = MX + 0.35 + i * sgw;
      txt(slide, String(i + 1), { x: sgx, y: gy + 0.75, w: 0.55, h: 0.55, fontFace: FONTS.head, fontSize: 26, bold: true, color: t.secondary, valign: "middle" });
      txt(slide, st.title || "", { x: sgx + 0.55, y: gy + 0.75, w: sgw - 0.7, h: 0.5, fontFace: FONTS.body, fontSize: 13.5, bold: true, color: t.ink, valign: "middle" });
      txt(slide, st.desc || "", { x: sgx, y: gy + 1.35, w: sgw - 0.3, h: (6.9 - gy) - 1.5, fontFace: FONTS.body, fontSize: 11.5, color: t.mute, lineSpacingMultiple: 1.05, valign: "top" });
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
      txt(slide, c.value || "", { x: x + 0.1, y: 1.92, w: cw - 0.2, h: 0.8, fontFace: FONTS.head, fontSize: 29, bold: true, color: t.card, align: "center", valign: "middle" });
      if (c.unit) txt(slide, c.unit, { x: x + 0.1, y: 2.68, w: cw - 0.2, h: 0.32, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: "EEF5F9", align: "center" });
      txt(slide, c.label || "", { x: x + 0.1, y: 3.0, w: cw - 0.2, h: 0.32, fontFace: FONTS.body, fontSize: 11.5, color: "EEF5F9", align: "center" });
    });
    chartY = 3.6;
  }
  const chartH = 6.9 - chartY;
  const hasPanels = (d.panels || []).length > 0;
  const chartW = hasPanels ? 6.7 : W - MX * 2;

  if (d.chart) {
    card(slide, pres, MX, chartY, chartW, chartH, t.card);
    if (d.chart.title) txt(slide, d.chart.title, { x: MX + 0.35, y: chartY + 0.18, w: chartW - 0.7, h: 0.4, fontFace: FONTS.body, fontSize: 13, bold: true, color: t.primary });
    const type = (d.chart.type || "bar").toLowerCase();
    const chartType = type === "line" ? pres.charts.LINE : type === "pie" ? pres.charts.PIE : pres.charts.BAR;
    const data = [{ name: d.chart.seriesName || "Series", labels: d.chart.labels || [], values: d.chart.values || [] }];
    slide.addChart(chartType, data, {
      x: MX + 0.2, y: chartY + 0.6, w: chartW - 0.5, h: chartH - 1.0, barDir: "col",
      chartColors: [t.secondary, t.primary, t.accent, t.good, t.bad],
      chartArea: { fill: { color: "FFFFFF" } },
      catAxisLabelColor: t.mute, catAxisLabelFontSize: 9,
      valAxisLabelColor: t.mute, valAxisLabelFontSize: 9,
      valGridLine: { color: "E6EAED", size: 0.5 }, catGridLine: { style: "none" },
      showValue: type !== "pie", showPercent: type === "pie",
      dataLabelPosition: "outEnd", dataLabelColor: t.ink, dataLabelFontSize: 9.5, dataLabelFontBold: true,
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
      if (p.label) txt(slide, p.label, { x: px + 0.3, y: py + 0.2, w: pw - 0.6, h: 0.4, fontFace: FONTS.body, fontSize: 12.5, bold: true, color: i === 0 ? t.good : t.primary });
      // Matn overflow'ni oldini olish: har qator max 6 so'z, max 3 qator
      const rawLines = (p.lines || []).slice(0, 3).map(l => {
        const words = String(l).split(/\s+/).filter(Boolean);
        return words.length > 8 ? words.slice(0, 8).join(" ") + "…" : words.join(" ");
      });
      const lines = rawLines.map((l, j, arr) => ({ text: l, options: { bold: true, breakLine: j < arr.length - 1, color: t.ink } }));
      txt(slide, lines, { x: px + 0.3, y: py + 0.65, w: pw - 0.6, h: ph - 0.8, fontFace: FONTS.body, fontSize: 13, lineSpacingMultiple: 1.2, valign: "top" });
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
    fontFace: FONTS.head, fontSize: 32, bold: true, color: t.card, valign: "middle",
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
      fontFace: FONTS.body, fontSize: 15, color: t.card,
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
      fontFace: FONTS.body, fontSize: 13, color: t.card, valign: "middle", lineSpacingMultiple: 1.08,
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
      txt(slide, `${startIdx + i}.`, { x: x + 0.28, y: ry, w: 0.5, h: rh, fontFace: FONTS.body, fontSize: 12, bold: true, color: t.secondary, valign: "top" });
      txt(slide, r, { x: x + 0.72, y: ry, w: colW - 1.0, h: rh, fontFace: FONTS.body, fontSize: 11.5, color: t.ink, lineSpacingMultiple: 1.0, valign: "top" });
      ry += rh;
    });
  }
  col(left, MX, 1);
  if (twoCol) col(right, W - MX - colW, half + 1);

  if (d.note) txt(slide, d.note, { x: MX, y: 5.35, w: W - MX * 2, h: 0.4, fontFace: FONTS.body, fontSize: 12, italic: true, color: t.mute, align: "center" });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 5.85, w: W - MX * 2, h: 1.1, rectRadius: 0.14, fill: { color: t.primary }, shadow: liftShadow() });
  txt(slide, d.thanks || "E'tiboringiz uchun rahmat!", { x: MX, y: 5.85, w: W - MX * 2, h: 1.1, fontFace: FONTS.head, fontSize: 27, bold: true, color: t.card, align: "center", valign: "middle" });
}

// =====================================================================
// AGENDA — Reja / mundarija (asosiy bo'limlar ro'yxati). Moslashuvchan.
// =====================================================================
function agenda(pres, slide, d, ctx) {
  const { t } = ctx;
  lightBg(slide, t);
  header(pres, slide, ctx, d.number, d.title || "Reja", d.icon || "list");

  if (d.intro) txt(slide, d.intro, { x: MX, y: 1.7, w: W - MX * 2, h: 0.5, fontFace: FONTS.body, fontSize: 14.5, color: t.ink, valign: "top" });
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
    txt(slide, String(i + 1).padStart(2, "0"), { x: x + 0.22, y: y + (rowH - 0.7) / 2, w: 0.7, h: 0.7, fontFace: FONTS.head, fontSize: 22, bold: true, color: t.card, align: "center", valign: "middle" });
    const hasDesc = !!it.desc;
    const tx = x + 1.12, tw = colW - 1.35;
    if (hasDesc) {
      const padV = 0.14;
      const titleH = (rowH - padV * 2) * 0.52;
      const descH = (rowH - padV * 2) * 0.48;
      txtFit(slide, it.title || "", { x: tx, y: y + padV, w: tw, h: titleH, fontFace: FONTS.body, fontSize: 15, bold: true, color: t.ink, valign: "middle" });
      txtFit(slide, it.desc, { x: tx, y: y + padV + titleH, w: tw, h: descH, fontFace: FONTS.body, fontSize: 11.5, color: t.mute, valign: "middle" });
    } else {
      txtFit(slide, it.title || "", { x: tx, y, w: tw, h: rowH, fontFace: FONTS.body, fontSize: 15.5, bold: true, color: t.ink, valign: "middle" });
    }
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
};
const LAYOUT_NAMES = Object.keys(LAYOUTS);

function render(pres, slide, data, ctx) {
  const fn = LAYOUTS[data.layout] || statCallout;
  fn(pres, slide, data, ctx);
}

module.exports = { render, LAYOUTS, LAYOUT_NAMES };
