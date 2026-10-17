// src/generator/prompt2.js
// Taqdimot uchun 2 bosqichli (parallel) strategiya:
//   Pass 1: outline — AYNAN N ta mazmunli slayd (sarlavha + layout + qisqa tavsif)
//   Pass 2: har bir slayd to'liq kontenti PARALLEL generatsiya qilinadi
// Bu aniq slayd sonini VA har slaydda to'liq sifatli kontentni kafolatlaydi.

const { LAYOUT_NAMES } = require("./layouts");

// Mazmunli (content) layoutlar — titul/reja/xulosa/adabiyotlardan tashqari
const CONTENT_LAYOUTS = [
  "stat-callout", "objectives", "steps", "feature-grid",
  "layers", "split-list", "dual-column", "metrics", "chart",
];

// ===================== 1-BOSQICH: OUTLINE =====================
function outlineSystemPrompt() {
  return `Sen professional taqdimot tuzilmasini yaratuvchi mutaxassissan. FAQAT to'g'ri JSON qaytarasan — izoh, markdown, backtick yo'q.`;
}

function outlineUserPrompt({ topic, contentSlides, sourceContent }) {
  const contentNote = sourceContent
    ? `\n\nFoydalanuvchi MANBA MATNI berdi — slaydlar shunga asoslansin:\n---\n${sourceContent.slice(0, 4000)}\n---`
    : "";

  return `"${topic}" mavzusida professional taqdimot uchun tuzilma (reja) yarat.

Kerak: AYNAN ${contentSlides} ta mazmunli slayd.
Har bir slayd uchun: sarlavha, layout turi, va qisqa mazmun tavsifi (1-2 jumla).${contentNote}

Mavjud layout turlari (har biri turli vizual struktura):
- "stat-callout": katta statistika + yon kartochkalar (raqamlar, foizlar uchun)
- "objectives": banner + 2x2 maqsad kartochkalari (maqsadlar, vazifalar uchun)
- "steps": ketma-ket qadamlar (jarayon, bosqichlar uchun)
- "feature-grid": 2x2 ikonkali kartochkalar (xususiyatlar, turlar uchun)
- "layers": ustma-ust qatlamlar (ierarxiya, darajalar, arxitektura uchun)
- "split-list": chap ro'yxat + o'ng panel (tekshiruv, taqqoslash uchun)
- "dual-column": ikki ustun (afzallik/kamchilik, taqqoslash uchun)
- "metrics": raqamli ko'rsatkichlar paneli (natijalar, statistika uchun)
- "chart": diagramma + kartochkalar (ma'lumotlar dinamikasi uchun)
- "conclusion": xulosa slaydi — FAQAT oxirgi slayd uchun

Quyidagi JSON qaytar:
{
  "title": "taqdimot nomi (mavzu asosida, qisqa)",
  "palette": "ocean",
  "slides": [
    { "n": 1, "title": "slayd sarlavhasi", "layout": "stat-callout", "brief": "bu slaydda nima ko'rsatiladi (1-2 jumla)" },
    { "n": 2, "title": "...", "layout": "steps", "brief": "..." }
  ],
  "references": [
    "Muallif, A. A. (yil). Kitob nomi. Nashriyot.",
    "Muallif, B. B., & Muallif, C. C. (yil). Maqola nomi. Jurnal nomi, jild(son), sahifalar."
  ]
}

QOIDALAR:
- AYNAN ${contentSlides} ta slayd (na ko'p, na kam)
- OXIRGI slayd "conclusion" layout bilan XULOSA bo'lsin
- Qolgan layoutlar XILMA-XIL bo'lsin — ketma-ket bir xil layout ISHLATMA
- Mantiqiy ketma-ketlik: muammo/dolzarblik → tahlil → yechim → natija → xulosa
- Har slayd alohida g'oyani yoritadi, takrorlanmasin
- palette: ocean/forest/terracotta/berry/charcoal/teal dan biri (mavzuga mos)
- references: 5-8 ta HAQIQIY, MAVJUD manba APA 7 formatida (40% o'zbek, 60% xorijiy)
- Faqat JSON qaytar`;
}

function parseOutline(text) {
  const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(clean); }
  catch (e) {
    const s = clean.indexOf("{"), end = clean.lastIndexOf("}");
    if (s >= 0 && end > s) return JSON.parse(clean.slice(s, end + 1));
    throw new Error("Outline JSON o'qilmadi: " + clean.slice(0, 200));
  }
}

// ===================== 2-BOSQICH: SLIDE CONTENT =====================
function slideSystemPrompt() {
  return `Sen professional taqdimot slaydi kontentini yaratuvchi mutaxassissan. FAQAT to'g'ri JSON qaytarasan — izoh, markdown, backtick yo'q. Slayd matnlari qisqa, ta'sirli, akademik bo'lsin.`;
}

// Har bir layout uchun aniq JSON sxema namunasi
// MUHIM: <...> ichidagilar — LLM to'ldirishi shart bo'lgan joylar (nusxa qilinmasin!)
function layoutSchema(layout) {
  const schemas = {
    "stat-callout": `{"layout":"stat-callout","title":"<slayd sarlavhasi>","icon":"chart","intro":"<kirish matni 1-2 jumla>","stat":{"label":"<ko'rsatkich nomi>","value":"<masalan 73%>","desc":"<izoh>"},"highlight":{"icon":"warning","label":"<muhim jihat nomi>","text":"<e'tibor talab qiladigan fikr>"},"items":[{"icon":"check","title":"<1-jihat nomi>","desc":"<tavsif>"},{"icon":"bolt","title":"<2-jihat nomi>","desc":"<tavsif>"},{"icon":"star","title":"<3-jihat nomi>","desc":"<tavsif>"}]}`,
    "objectives": `{"layout":"objectives","title":"<slayd sarlavhasi>","icon":"target","banner":{"icon":"target","label":"<asosiy maqsad nomi>","text":"<banner matni>"},"items":[{"icon":"cogs","title":"<1-maqsad>","desc":"<tavsif>"},{"icon":"chart","title":"<2-maqsad>","desc":"<tavsif>"},{"icon":"shield","title":"<3-maqsad>","desc":"<tavsif>"},{"icon":"users","title":"<4-maqsad>","desc":"<tavsif>"}]}`,
    "steps": `{"layout":"steps","title":"<slayd sarlavhasi>","icon":"tools","intro":"<kirish 1 jumla>","items":[{"icon":"search","title":"<1-qadam nomi>","desc":"<tavsif>"},{"icon":"target","title":"<2-qadam nomi>","desc":"<tavsif>"},{"icon":"cogs","title":"<3-qadam nomi>","desc":"<tavsif>"},{"icon":"check","title":"<4-qadam nomi>","desc":"<tavsif>"}],"note":{"icon":"lightbulb","label":"<eslatma nomi>","text":"<muhim izoh>"}}`,
    "feature-grid": `{"layout":"feature-grid","title":"<slayd sarlavhasi>","icon":"star","intro":"<kirish 1 jumla>","items":[{"icon":"shield","title":"<1-xususiyat>","desc":"<to'liq tavsif>"},{"icon":"bolt","title":"<2-xususiyat>","desc":"<to'liq tavsif>"},{"icon":"leaf","title":"<3-xususiyat>","desc":"<to'liq tavsif>"},{"icon":"globe","title":"<4-xususiyat>","desc":"<to'liq tavsif>"}]}`,
    "layers": `{"layout":"layers","title":"<slayd sarlavhasi>","icon":"layers","intro":"<kirish 1 jumla>","items":[{"num":"3","icon":"cloud","title":"<yuqori qatlam nomi>","desc":"<tavsif>"},{"num":"2","icon":"server","title":"<o'rta qatlam nomi>","desc":"<tavsif>"},{"num":"1","icon":"database","title":"<pastki qatlam nomi>","desc":"<tavsif>"}]}`,
    "split-list": `{"layout":"split-list","title":"<slayd sarlavhasi>","icon":"list","intro":"<kirish 1 jumla>","listTitle":"<ro'yxat sarlavhasi>","items":[{"text":"<band 1>"},{"text":"<band 2>"},{"text":"<band 3>"},{"text":"<band 4>"},{"text":"<band 5>"}],"panel":{"label":"<panel sarlavhasi>","lines":["<satr 1>","<satr 2>"],"foot":"<izoh>"},"highlight":{"icon":"up","label":"<natija nomi>","value":"<masalan +42%>","desc":"<izoh>"}}`,
    "dual-column": `{"layout":"dual-column","title":"<slayd sarlavhasi>","icon":"users","leftTitle":"<chap ustun sarlavhasi>","left":[{"icon":"check","title":"<element 1>","desc":"<tavsif>"},{"icon":"bolt","title":"<element 2>","desc":"<tavsif>"},{"icon":"star","title":"<element 3>","desc":"<tavsif>"}],"rightTitle":"<o'ng ustun sarlavhasi>","right":[{"title":"<element 1>","desc":"<tavsif>","color":"bad"},{"title":"<element 2>","desc":"<tavsif>","color":"accent"},{"title":"<element 3>","desc":"<tavsif>","color":"secondary"}],"strip":[{"value":"<son>","label":"<nomi>"},{"value":"<son>","label":"<nomi>"}]}`,
    "metrics": `{"layout":"metrics","title":"<slayd sarlavhasi>","icon":"gauge","intro":"<kirish 1 jumla>","stats":[{"value":"<son>","unit":"%","label":"<ko'rsatkich nomi>","sub":"<izoh>"},{"value":"<son>","unit":"x","label":"<ko'rsatkich nomi>","sub":"<izoh>"},{"value":"<son>","unit":"kun","label":"<ko'rsatkich nomi>","sub":"<izoh>"},{"value":"<son>","unit":"","label":"<ko'rsatkich nomi>","sub":"<izoh>"}],"stagesTitle":"<bosqichlar sarlavhasi>","stages":[{"title":"<1-bosqich>","desc":"<tavsif>"},{"title":"<2-bosqich>","desc":"<tavsif>"},{"title":"<3-bosqich>","desc":"<tavsif>"}]}`,
    "chart": `{"layout":"chart","title":"<slayd sarlavhasi>","icon":"chart","cards":[{"value":"<son>","unit":"<birlik>","label":"<ko'rsatkich nomi>"},{"value":"<son>","unit":"<birlik>","label":"<ko'rsatkich nomi>"},{"value":"<son>","unit":"<birlik>","label":"<ko'rsatkich nomi>"},{"value":"<son>","unit":"<birlik>","label":"<ko'rsatkich nomi>"}],"chart":{"title":"<diagramma nomi>","type":"bar","seriesName":"<ko'rsatkich>","labels":["<kat1>","<kat2>","<kat3>","<kat4>","<kat5>"],"values":[42,68,55,80,95]},"panels":[{"label":"<panel sarlavhasi>","lines":["<qisqa xulosa 4-6 so'z>"]},{"label":"<panel sarlavhasi>","lines":["<qisqa xulosa 4-6 so'z>"]}]}`,
    "conclusion": `{"layout":"conclusion","title":"XULOSA","summary":"<mavzu bo'yicha 60-80 so'zlik umumiy xulosa — yaxlit paragraf matni, butun sahifani to'ldirsin>","points":[{"icon":"check","text":"<1-asosiy natija (qisqa jumla)>"},{"icon":"star","text":"<2-asosiy natija>"},{"icon":"rocket","text":"<3-asosiy natija>"},{"icon":"layers","text":"<4-asosiy natija>"}]}`,
  };
  return schemas[layout] || schemas["feature-grid"];
}

function slideUserPrompt({ slide, outline, topic, language }) {
  const lang = language || "o'zbek";
  return `"${topic}" taqdimoti uchun BITTA slayd kontentini to'liq yarat.

Slayd: "${slide.title}" (${slide.n}-slayd)
Layout: ${slide.layout}
Mazmun: ${slide.brief}
Til: ${lang}

Quyidagi AYNAN shu strukturada to'liq to'ldirilgan JSON qaytar:
${layoutSchema(slide.layout)}

QOIDALAR:
- BARCHA <...> joylarni mavzuga mos haqiqiy matn bilan to'ldir — birorta ham bo'sh yoki namuna matn qoldirma
- MUHIM: "karta 1", "karta 2", "panel 1", "panel 2", "element 1", "tavsif", "kirish" kabi umumiy so'zlarni ISHLATMA — aniq, mazmunga oid matn yoz
- Matnlar ${lang} tilida, qisqa va ta'sirli (slayd uchun)
- title: "${slide.title}" ni ishlat
- icon: faqat shu ro'yxatdan — check, bolt, star, shield, cogs, chart, target, users, globe, leaf, cloud, server, database, search, tools, lightbulb, up, warning, rocket, gauge, book, list, layers
- Raqamlar/statistika realistik va mavzuga mos bo'lsin
- LaTeX yoki pastki chiziq (_) ISHLATMA
- Faqat JSON qaytar`;
}

function parseSlide(text) {
  const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(clean); }
  catch (e) {
    const s = clean.indexOf("{"), end = clean.lastIndexOf("}");
    if (s >= 0 && end > s) return JSON.parse(clean.slice(s, end + 1));
    throw new Error("Slide JSON o'qilmadi: " + e.message);
  }
}

module.exports = {
  outlineSystemPrompt, outlineUserPrompt, parseOutline,
  slideSystemPrompt, slideUserPrompt, parseSlide,
  CONTENT_LAYOUTS,
};
