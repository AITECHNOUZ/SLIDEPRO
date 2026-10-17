const MARKER = String.raw`(?:sintetik|synthetic|illustrativ|illustrative|sample|namunaviy|simulyatsiya|simulation|simulated)`;
const DATA_TERM = String.raw`(?:ma['’‘]?lumot(?:lar)?|misol(?:lar)?|qiymat(?:lar)?|natija(?:lar)?|simulyatsiya|simulation|data|values?|examples?|results?|measurements?)`;
const DISCLOSURE_PATTERNS = [
  new RegExp(String.raw`\b${MARKER}\b[^.!?]{0,120}\b${DATA_TERM}\b[^.!?]*`, "gi"),
  /\b(?:real|haqiqiy)\s+(?:tajriba\s+)?o['’‘]?lchov(?:i|lari|lar)?\s+emas\b[^.!?]*/gi,
  /\bnot\s+(?:a\s+)?(?:real|actual)\s+(?:experiment\s+)?measurements?\b[^.!?]*/gi,
  /\bnot\s+measured\b[^.!?]*/gi,
  /\bfor\s+illustration\s+only\b[^.!?]*/gi,
];

function cleanMediaText(value, fallback = "") {
  let text = String(value || "");
  for (const pattern of DISCLOSURE_PATTERNS) text = text.replace(pattern, " ");
  text = text
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\(\s*(?=[,.;:!?)]|$)/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[,;:—–-]+\s*(?=[.!?]|$)/g, "")
    .replace(/([.!?])(?:\s*[.!?])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/g, "")
    .trim();
  return text || String(fallback || "").trim();
}

function isSyntheticSource(value) {
  return /\b(?:sintetik|synthetic|illustrative|illustrativ|sample|namunaviy|simulyatsiya|simulation|simulated)\b/i.test(String(value || ""));
}

module.exports = { cleanMediaText, isSyntheticSource };
