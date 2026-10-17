// src/generator/prompt.js
// Umumiy prompt (system + user) va LLM javobini JSON spec ga aylantirish.
// Bu modul provayderdan (Anthropic/OpenAI) mustaqil.

const { LAYOUT_NAMES } = require("./layouts");
const { ICON_NAMES } = require("./icons");
const { PALETTES } = require("./theme");

const API_URL = "https://api.anthropic.com/v1/messages";

function buildSystemPrompt() {
  return `Sen taqdimot (slayd) kontentini tuzuvchi mutaxassis muharrirsan. Foydalanuvchi mavzu va sahifa sonini beradi. Sen FAQAT to'g'ri JSON qaytarasan — hech qanday izoh, markdown belgi yoki backtick YO'Q.

QAYTARILADIGAN STRUKTURA:
{
  "palette": "<palitra nomi>",
  "slides": [ { "layout": "<layout nomi>", ... layoutga mos maydonlar } ]
}

PALITRALAR (mavzuga mosini tanla): ${Object.keys(PALETTES).join(", ")}.

MAVJUD LAYOUTLAR va ularning maydonlari (har biri "title" — slayd sarlavhasi va "icon" — ikonka nomini qabul qiladi):

1. "title" (BIRINCHI slayd, FAQAT 1 marta): { title, kicker, subkicker, org, faculty, icon, meta:[{label,value}], footer, date }
2. "agenda" (Reja — IKKINCHI slayd, FAQAT 1 marta): { title:"Reja", icon:"list", intro?, items:[{title,desc?}] (4-7 ta, asosiy bo'lim nomlari) }
2. "stat-callout": { title, icon, intro, stat:{label,value,desc}, highlight:{icon,label,text}, items:[{icon,title,desc}] (max 3) }
3. "objectives": { title, icon, banner:{icon,label,text}, items:[{icon,title,desc}] (aniq 4 ta, 2x2) }
4. "steps": { title, icon, intro, items:[{icon,title,desc}] (4-6 ta gorizontal qadam), note:{icon,label,text} }
5. "feature-grid": { title, icon, intro, items:[{icon,title,desc}] (aniq 4 ta), note:{label,text} }
6. "layers": { title, icon, intro, items:[{num,icon,title,desc}] (aniq 3 ta, ustma-ust) }
7. "split-list": { title, icon, intro, listTitle, items:[{text}] (max 7 check ro'yxat), panel:{label,lines:[],foot}, highlight:{icon,label,value,desc} }
8. "dual-column": { title, icon, leftTitle, left:[{icon,title,desc}] (max 5), rightTitle, right:[{title,desc,color}] (max 5; color: bad/accent/secondary/mute/primary), strip:[{value,label}] }
9. "metrics": { title, icon, intro, stats:[{value,unit,label,sub,color}] (max 4), stagesTitle, stages:[{title,desc}] (max 3) }
10. "chart": { title, icon, cards:[{value,unit,label}] (max 4 ixtiyoriy), chart:{title,type:"bar|line|pie",seriesName,labels:[],values:[]}, panels:[{label,lines:[]}] (max 2) }
11. "conclusion": { title (mas. "XULOSA"), items:[{icon,text}] (max 5) }
12. "references": { title, icon, items:["manba1", ...], note, thanks }

MAVJUD IKONKA NOMLARI (faqat shulardan tanla): ${ICON_NAMES.join(", ")}.

QOIDALAR:
- MAJBURIY STRUKTURA (har bir taqdimotda, slayd sonidan qat'i nazar):
  • 1-slayd: "title" (titul)
  • 2-slayd: "agenda" (Reja) — asosiy bo'limlar ro'yxati; punktlari o'rtadagi mazmun slaydlari sarlavhalariga mos kelsin.
  • OXIRGI slayd: "references" (Foydalanilgan adabiyotlar) — 6-12 ta real, mavzuga mos manba.
  • OXIRGIDAN OLDINGI slayd: "conclusion" (Xulosa).
  • Qolgan o'rtadagi slaydlar — asosiy mazmun.
- Slayd budjeti: foydalanuvchi N ta so'rasa, N ning ichiga title + agenda + conclusion + references KIRADI; demak o'rtadagi mazmun slaydlari = N - 4.
- O'rtadagi slaydlarda layoutlarni XILMA-XIL tanla — bir xil layoutni ketma-ket takrorlama. Kamida 6 xil layout ishlatishga harakat qil.
- Aniq foydalanuvchi so'ragan SLAYD SONIga rioya qil.
- O'zbek tilida yoz (agar mavzu boshqa tilda bo'lsa, o'sha tilda).
- Raqamlar/statistikalar realistik bo'lsin. To'qima aniq faktlar o'rniga umumiy yoki taxminiy ko'rsatkichlardan foydalan.
- Faqat JSON qaytar.

KONTENT HAJMI (juda muhim — dizaynga mukammal sig'ishi uchun shu me'yorlarga AMAL QIL):
- Har bir kartochka tavsifi (desc): KAMIDA 8 so'z, ko'pi 16 so'z (to'liq 1 jumla). Hech qachon 20 so'zdan oshmasin va hech qachon 8 so'zdan kam bo'lmasin.
- Kartochka sarlavhasi (title): 2–4 so'z.
- Kirish matni (intro): to'liq 1–2 jumla (20–35 so'z). Bo'sh yoki yarim jumla qoldirma.
- Slayd sarlavhasi: 3–6 so'z.
- statistika qiymati (stat.value, metrics.value, chart cards value): qisqa — raqam yoki "308 → 3.4" kabi.
- Element SONI bo'yicha (ANIQ shu sonlarga rioya qil, kamaytirma):
  • objectives.items: ANIQ 4 ta
  • feature-grid.items: ANIQ 4 ta
  • steps.items: 5 yoki 6 ta
  • layers.items: ANIQ 3 ta
  • metrics.stats: ANIQ 4 ta
  • split-list.items: 6 yoki 7 ta
  • dual-column.left va right: har birida ANIQ 5 ta
  • stat-callout.items: ANIQ 3 ta
  • conclusion.items: 4 yoki 5 ta
  • references.items: 8–12 ta
  • chart.cards: aniq 4 ta; chart.labels/values: 4 yoki 5 ta

KAFOLAT (eng muhim qoida): Mavzu qisqa yoki tor bo'lsa ham, HECH QACHON kam yoki bo'sh kontent qaytarma. Har bir slayd to'liq to'ldirilgan bo'lishi SHART:
- Agar mavzu bo'yicha to'g'ridan-to'g'ri ma'lumot kam bo'lsa, mavzuni kengaytir: tarix, turlari, afzalliklari, kamchiliklari, qo'llanilishi, kelajagi, misollar, taqqoslash, statistika kabi yondosh jihatlardan foydalanib har bir kartochkani mazmunli to'ldir.
- Bir-ikki so'zli yoki yarim jumlali tavsiflardan QAT'IY saqlan. Har bir desc to'liq, ma'noli jumla bo'lsin.
- Slaydlarni ataylab kam element bilan qoldirma — yuqoridagi element sonlariga to'liq yet.
- O'zbek tilida yoz (agar mavzu boshqa tilda bo'lsa, o'sha tilda).
- Raqamlar/statistikalar realistik bo'lsin.

YAKUNIY TEKSHIRUV (JSON qaytarishdan oldin o'zingni tekshir): har bir slaydda elementlar soni yetarlimi? Har bir desc kamida 8 so'zmi? Bo'sh yoki yarim qolgan maydon yo'qmi? Agar bo'lsa — to'ldir. Faqat shundan keyin JSON qaytar.

- Faqat JSON qaytar (izoh, markdown, backtick YO'Q).`;
}

function buildUserPrompt({ topic, slides, extra, sourceContent, studentName, studentGroup }) {
  // Tizim slaydlari (ensureStructure qo'shadi): titul+reja+xulosa+adabiyotlar = 4 ta
  // LLM dan faqat mazmunli slaydlar so'raladi, keyin tizim slaydlari qo'shiladi
  const contentSlides = Math.max(1, slides - 4);
  let p = `Mavzu: "${topic}"
Talab qilingan jami slaydlar: AYNAN ${slides} ta
Tizim slaydlari (men o'zim qo'shaman): titul(1) + reja(1) + xulosa(1) + adabiyotlar(1) = 4 ta
Sen yaratishing kerak: AYNAN ${contentSlides} ta MAZMUNLI slayd
MUHIM: na ${contentSlides-1} ta, na ${contentSlides+1} ta — AYNAN ${contentSlides} ta!`;
  if (studentName) p += `\nTalaba: ${studentName}`;
  if (studentGroup) p += `\nGuruh: ${studentGroup}`;
  if (extra) p += `\nQo'shimcha talablar: ${extra}`;
  if (studentName || studentGroup) {
    p += `\n\nMuhim: titul slaydning meta maydonida talaba va guruh ma'lumotlari bo'lsin:\n  meta: [{"label":"Bajardi:","value":"${studentName||'F.I.Sh.'}"},{"label":"Guruh:","value":"${studentGroup||'—'}"}]`;
  }
  if (sourceContent && sourceContent.trim()) {
    const trimmed = sourceContent.length > 12000 ? sourceContent.slice(0, 12000) : sourceContent;
    p += `\n\nFoydalanuvchi quyidagi MANBA MATNINI berdi. Slaydlar AYNAN shu manba mazmuniga asoslansin — uni tahlil qilib, eng muhim fikrlarni slaydlarga ajrat, struktura ber va qisqartir. O'zingdan mavzuga aloqasiz ma'lumot qo'shma:\n--- MANBA BOSHLANISHI ---\n${trimmed}\n--- MANBA TUGASHI ---`;
  }
  p += `\n\nShu mavzu bo'yicha AYNAN ${contentSlides} ta mazmunli slayd kontentini yuqoridagi JSON strukturada qaytar. (titul/reja/xulosa/adabiyotlar slaydlari bu songa kirmaydi - ularni men qo'shaman)`;
  return p;
}

// LLM matnli javobini JSON spec'ga aylantirish
function parseSpec(text) {
  const clean = (text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }
    throw new Error("LLM javobini JSON sifatida o'qib bo'lmadi: " + clean.slice(0, 300));
  }
}

module.exports = { buildSystemPrompt, buildUserPrompt, parseSpec };
