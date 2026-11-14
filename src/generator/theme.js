// src/generator/theme.js
// Dizayn mavzulari: har biri — shrift juftligi, fon, sarlavha uslubi, kartochka shakli, titul ko'rinishi
// va o'ziga mos 2–3 ta rang palitrasi. Buyurtmada mavzu va palitra tasodifiy (yoki tanlab) olinadi,
// shuning uchun har bir taqdimot boshqacha ko'rinadi.

// Palitra kalitlari:
//   dark/primary/secondary/accent — asosiy ranglar; light — slayd foni; surface — kartochka foni;
//   card — rangli fon ustidagi oq matn; tint/goodTint/badTint — yengil fonlar; ink/mute — matn; line — chegara chizig'i
function palette(base) {
  return {
    card: "FFFFFF", surface: "FFFFFF", line: "D5DDE3", good: "1FA35A", bad: "C44536",
    goodTint: "E8F5EC", badTint: "FBECEA", onDark: "C9D6DE",
    ...base,
  };
}

const PALETTES = {
  // ── Zamonaviy (avvalgi dizayn) ──
  ocean: palette({ dark: "0B3A55", primary: "0E5C82", secondary: "2E8AA8", accent: "F0A93B", light: "F5F8FA", tint: "EAF2F6", ink: "16252D", mute: "5E727C", onDark: "B9D4E0" }),
  teal: palette({ dark: "0A4240", primary: "0A8A8A", secondary: "16B0A0", accent: "F2A65A", light: "F1F7F6", tint: "E4F1EF", ink: "12302E", mute: "55706C", onDark: "AEDAD2" }),
  berry: palette({ dark: "3C1B2C", primary: "73304A", secondary: "A05A74", accent: "D9A85C", light: "F8F3F5", tint: "F2E9EE", ink: "2A1A22", mute: "6E5560", onDark: "DCBCC8" }),
  // ── Akademik ──
  navy: palette({ dark: "14213D", primary: "1D3557", secondary: "457B9D", accent: "C9A227", light: "FFFFFF", tint: "EEF2F7", ink: "1B1F24", mute: "5B6573", line: "C9D2DD", onDark: "C5D1E0" }),
  burgundy: palette({ dark: "3B0D18", primary: "7A1E2E", secondary: "A4495A", accent: "B8963E", light: "FFFFFF", tint: "F6EDEF", ink: "231A1C", mute: "6B5A5E", line: "DCCBCF", onDark: "E2C6CC" }),
  forest: palette({ dark: "1E3528", primary: "2F5D44", secondary: "5C8C6A", accent: "C08A2E", light: "FFFFFF", tint: "EDF3EE", ink: "1C2620", mute: "5C6B60", line: "CBD8CE", onDark: "C3D8C8" }),
  // ── Minimal ──
  graphite: palette({ dark: "111111", primary: "1F1F1F", secondary: "6B6B6B", accent: "FF5A36", light: "FAFAF8", tint: "F0F0EC", ink: "141414", mute: "6E6E6A", line: "E2E2DD", onDark: "BDBDB8" }),
  sand: palette({ dark: "2B2621", primary: "3D352D", secondary: "8C7B68", accent: "2F7D6D", light: "FBF8F3", tint: "F2ECE2", ink: "26211C", mute: "776B5E", line: "E6DDD0", onDark: "D3C7B8" }),
  // ── To'q texnologik ──
  neon: palette({ dark: "05080F", primary: "0EA5E9", secondary: "22D3EE", accent: "A3E635", light: "0B1220", surface: "131D30", tint: "18283F", goodTint: "11302A", badTint: "3A1C26", ink: "E6EDF7", mute: "93A4BC", line: "24344F", good: "34D399", bad: "F87171", onDark: "93A4BC" }),
  violet: palette({ dark: "07060F", primary: "7C3AED", secondary: "A78BFA", accent: "F472B6", light: "0F0D1C", surface: "1A1730", tint: "231F3D", goodTint: "13302A", badTint: "3A1A2C", ink: "EDEBFA", mute: "A29CC2", line: "2E2950", good: "34D399", bad: "FB7185", onDark: "A29CC2" }),
  // ── Yorqin ta'lim ──
  sunny: palette({ dark: "1F2A5A", primary: "3A57E8", secondary: "00B8A9", accent: "FFB020", light: "FFF9EF", tint: "EAF0FF", ink: "1E2340", mute: "5A6185", line: "E3E6F5", onDark: "C9D2FF" }),
  coral: palette({ dark: "3A1F4D", primary: "E85D75", secondary: "6C5CE7", accent: "FFC048", light: "FFF7F5", tint: "FDECEF", ink: "2B1E33", mute: "6E5E78", line: "F1DDE2", onDark: "E8CDE9" }),
  // ── Korporativ ──
  corporate: palette({ dark: "0F2B46", primary: "0B5CAD", secondary: "3D8BD9", accent: "F2A900", light: "F4F6F9", tint: "E8EFF8", ink: "17212B", mute: "5D6B78", line: "D7DEE6", onDark: "BFD3EA" }),
  emerald: palette({ dark: "0D2E2A", primary: "0F7B6C", secondary: "38A89D", accent: "F29F05", light: "F3F7F6", tint: "E3F1EE", ink: "142422", mute: "586B68", line: "D2E1DE", onDark: "BFDAD5" }),
  // ── Muhandislik (chizma) ──
  blueprint: palette({ dark: "0B2545", primary: "13315C", secondary: "1F5FA6", accent: "C0392B", light: "EEF4FA", surface: "FFFFFF", tint: "DCE8F5", ink: "0B2545", mute: "4A6382", line: "1F5FA6", onDark: "BCD9EE" }),
  steel: palette({ dark: "1C2833", primary: "2C3E50", secondary: "5D6D7E", accent: "D35400", light: "F2F4F5", surface: "FFFFFF", tint: "E5E8EB", ink: "1C2833", mute: "566573", line: "2C3E50", onDark: "C9D1D8" }),
};

// Mavzular (uslub). header: number|rule|band|sidebar|bigtitle|frame
// card: shadow|border|flat|topline|stripe|outline;  bg: plain|dots|grid-dark|blobs|blueprint
// cover: circles|academic|minimal|tech|bright|split|blueprint
const THEMES = {
  modern: { name: "Zamonaviy", fonts: { head: "Cambria", body: "Calibri" }, palettes: ["ocean", "teal", "berry"], header: "number", card: "shadow", bg: "plain", cover: "circles", radius: 0.13 },
  academic: { name: "Akademik klassik", fonts: { head: "Georgia", body: "Calibri" }, palettes: ["navy", "burgundy", "forest"], header: "rule", card: "border", bg: "plain", cover: "academic", radius: 0.04 },
  minimal: { name: "Zamonaviy minimal", fonts: { head: "Calibri Light", body: "Calibri" }, palettes: ["graphite", "sand"], header: "bigtitle", card: "flat", bg: "plain", cover: "minimal", radius: 0 },
  tech: { name: "To'q texnologik", fonts: { head: "Segoe UI Semibold", body: "Segoe UI" }, palettes: ["neon", "violet"], header: "number", card: "topline", bg: "grid-dark", cover: "tech", radius: 0.06, dark: true },
  bright: { name: "Yorqin ta'lim", fonts: { head: "Trebuchet MS", body: "Trebuchet MS" }, palettes: ["sunny", "coral"], header: "band", card: "stripe", bg: "blobs", cover: "bright", radius: 0.22 },
  corporate: { name: "Korporativ", fonts: { head: "Arial", body: "Arial" }, palettes: ["corporate", "emerald"], header: "sidebar", card: "shadow", bg: "plain", cover: "split", radius: 0.06 },
  engineering: { name: "Muhandislik chizma", fonts: { head: "Century Gothic", body: "Calibri" }, palettes: ["blueprint", "steel"], header: "frame", card: "outline", bg: "blueprint", cover: "blueprint", radius: 0 },
};

const FONTS = THEMES.modern.fonts; // eski importlar uchun

function getPalette(name) {
  return PALETTES[name] || PALETTES.ocean;
}

function getTheme(name) {
  return THEMES[name] || THEMES.modern;
}

// Mavzu va palitra tanlash: aniq berilsa — o'sha, aks holda tasodifiy (har buyurtma boshqacha)
function pickDesign({ theme, palette: paletteName, random = Math.random } = {}) {
  const themeKey = THEMES[theme] ? theme : Object.keys(THEMES)[Math.floor(random() * Object.keys(THEMES).length)];
  const th = THEMES[themeKey];
  const paletteKey = th.palettes.includes(paletteName) ? paletteName : th.palettes[Math.floor(random() * th.palettes.length)];
  return { themeKey, paletteKey, theme: th, palette: PALETTES[paletteKey] };
}

module.exports = { PALETTES, THEMES, FONTS, getPalette, getTheme, pickDesign };
