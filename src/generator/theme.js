// src/theme.js
// Ranglar palitralari. API javobida "palette" maydoni shu nomlardan birini tanlaydi.

const PALETTES = {
  ocean: {
    dark: "0B3A55", primary: "0E5C82", secondary: "2E8AA8", accent: "F0A93B",
    light: "F5F8FA", card: "FFFFFF", tint: "EAF2F6", goodTint: "E8F5EC", badTint: "FBECEA",
    ink: "16252D", mute: "5E727C", good: "1FA35A", bad: "C44536", onDark: "B9D4E0",
  },
  forest: {
    dark: "20402A", primary: "2F6B3A", secondary: "5C9648", accent: "E0A444",
    light: "F5F8F1", card: "FFFFFF", tint: "EBF2E6", goodTint: "E8F4E6", badTint: "FBECEA",
    ink: "1C2A1E", mute: "5E6E58", good: "3C9E4A", bad: "C0392B", onDark: "C3D8B6",
  },
  terracotta: {
    dark: "5E2C23", primary: "B5513F", secondary: "CC8266", accent: "E2B24C",
    light: "FAF6F1", card: "FFFFFF", tint: "F5ECE5", goodTint: "EDF3E6", badTint: "F8E6E0",
    ink: "31231E", mute: "70605A", good: "5C8F4C", bad: "A0342B", onDark: "E8CBBF",
  },
  berry: {
    dark: "3C1B2C", primary: "73304A", secondary: "A05A74", accent: "D9A85C",
    light: "F8F3F5", card: "FFFFFF", tint: "F2E9EE", goodTint: "EBF3EC", badTint: "F8E6EA",
    ink: "2A1A22", mute: "6E5560", good: "4F8F5C", bad: "B23A48", onDark: "DCBCC8",
  },
  charcoal: {
    dark: "20262B", primary: "37454E", secondary: "5E7079", accent: "E8A33D",
    light: "F4F5F6", card: "FFFFFF", tint: "ECEEF0", goodTint: "E8F4EC", badTint: "FBECEA",
    ink: "1A1F23", mute: "66727A", good: "2E9E5B", bad: "C0392B", onDark: "C4CBD0",
  },
  teal: {
    dark: "0A4240", primary: "0A8A8A", secondary: "16B0A0", accent: "F2A65A",
    light: "F1F7F6", card: "FFFFFF", tint: "E4F1EF", goodTint: "E6F4EE", badTint: "FBECEA",
    ink: "12302E", mute: "55706C", good: "1F9E78", bad: "C0392B", onDark: "AEDAD2",
  },
};

const FONTS = { head: "Cambria", body: "Calibri" };

function getPalette(name) {
  return PALETTES[name] || PALETTES.ocean;
}

module.exports = { PALETTES, FONTS, getPalette };
