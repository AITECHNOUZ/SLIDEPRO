function normalizeFormulaSource(value) {
  const latex = String(value == null ? "" : value).trim();
  if (!latex) throw new Error("formula LaTeX bo'sh");

  let depth = 0;
  let escaped = false;
  for (const ch of latex) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) throw new Error("formula LaTeX qavslar balansi noto'g'ri");
    }
  }
  if (depth !== 0) throw new Error("formula LaTeX qavslar balansi noto'g'ri");
  return latex;
}

module.exports = { normalizeFormulaSource };
