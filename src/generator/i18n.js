// Taqdimotdagi xizmat yozuvlari (titul, reja, adabiyotlar, xulosa) — tanlangan tilda
const LABELS = {
  uz: { kicker: "TAQDIMOT", agenda: "Reja", references: "Foydalanilgan adabiyotlar", thanks: "E'tiboringiz uchun rahmat!", conclusion: "XULOSA", by: "Bajardi:", group: "Guruh:", supervisor: "Tekshirdi:", languageName: "o'zbek (lotin yozuvi)" },
  ru: { kicker: "ПРЕЗЕНТАЦИЯ", agenda: "План", references: "Список литературы", thanks: "Спасибо за внимание!", conclusion: "ЗАКЛЮЧЕНИЕ", by: "Выполнил:", group: "Группа:", supervisor: "Проверил:", languageName: "русский" },
  en: { kicker: "PRESENTATION", agenda: "Outline", references: "References", thanks: "Thank you for your attention!", conclusion: "CONCLUSION", by: "Prepared by:", group: "Group:", supervisor: "Supervisor:", languageName: "English" },
};

function langKey(language) {
  const value = String(language || "").toLowerCase();
  if (/^(ru|рус)/.test(value)) return "ru";
  if (/^(en|ing)/.test(value)) return "en";
  return "uz";
}

function labels(language) {
  return LABELS[langKey(language)];
}

module.exports = { LABELS, labels, langKey };
