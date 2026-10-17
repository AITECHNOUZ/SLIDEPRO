// src/generator/llm.js
// LLM orkestratori: admin sozlamasiga ko'ra provayderni tanlaydi.
//   provider = "anthropic" | "openai" | "both"
// "both" — avval Anthropic, agar xato/bo'sh bo'lsa avtomatik OpenAI'ga o'tadi (failover).

const { buildSystemPrompt, buildUserPrompt, parseSpec } = require("./prompt");
const anthropic = require("./anthropic");
const openai = require("./openai");

// bitta provayderni chaqirib, JSON spec qaytarish
async function callOne(name, prompts, cfg) {
  let text;
  if (name === "anthropic") {
    text = await anthropic.generate({
      ...prompts, apiKey: cfg.anthropicKey, model: cfg.anthropicModel,
    });
  } else if (name === "openai") {
    text = await openai.generate({
      ...prompts, apiKey: cfg.openaiKey, model: cfg.openaiModel,
    });
  } else {
    throw new Error("Noma'lum provayder: " + name);
  }
  const spec = parseSpec(text); // JSON xato bo'lsa bu yerda otadi
  if (!spec || !Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new Error(`${name}: yaroqsiz spec (slides yo'q)`);
  }
  return spec;
}

// STRUKTURA KAFOLATI: titul(1) + reja(2) + ... + xulosa + adabiyotlar(oxirgi).
// AI biror qismni unutsa ham, bu funksiya uni joyiga qo'yadi yoki yaratadi.
function ensureStructure(spec, topic) {
  let slides = Array.isArray(spec.slides) ? spec.slides.slice() : [];

  // 1) TITUL — birinchi bo'lsin
  let ti = slides.findIndex((s) => s.layout === "title");
  if (ti > 0) slides.unshift(slides.splice(ti, 1)[0]);
  else if (ti === -1) slides.unshift({ layout: "title", title: topic || "Taqdimot", meta: [] });

  // 2) ADABIYOTLAR — oxirgi bo'lsin
  let ri = slides.findIndex((s) => s.layout === "references");
  // Spec'dan haqiqiy APA adabiyotlarni olish
  const realRefs = Array.isArray(spec.references) && spec.references.length > 0
    ? spec.references
    : null;
  if (ri !== -1 && ri !== slides.length - 1) slides.push(slides.splice(ri, 1)[0]);
  else if (ri === -1) {
    slides.push({
      layout: "references", title: "Foydalanilgan adabiyotlar", icon: "book",
      items: realRefs || [
        "Mavzu bo'yicha asosiy darslik va o'quv adabiyotlari.",
        "Tegishli sohaviy ilmiy maqolalar va nashrlar.",
        "Rasmiy hujjatlar, standartlar va me'yoriy manbalar.",
        "Ishonchli internet manbalari va ochiq akademik bazalar.",
      ],
      note: realRefs ? null : "Manbalar ro'yxatini aniq talab asosida to'ldirish tavsiya etiladi.",
      thanks: "E'tiboringiz uchun rahmat!",
    });
  } else if (ri !== -1 && realRefs) {
    // Mavjud references slaydiga haqiqiy adabiyotlarni qo'yamiz
    slides[slides.length - 1].items = realRefs;
    slides[slides.length - 1].note = null;
  }

  // 3) XULOSA — adabiyotlardan oldin bo'lsin
  let ci = slides.findIndex((s) => s.layout === "conclusion");
  if (ci !== -1) {
    const refIdx = slides.findIndex((s) => s.layout === "references");
    if (ci > refIdx) {
      const [c] = slides.splice(ci, 1);
      const newRefIdx = slides.findIndex((s) => s.layout === "references");
      slides.splice(newRefIdx, 0, c);
    }
  }

  // 4) REJA (agenda) — ikkinchi bo'lsin
  let ai = slides.findIndex((s) => s.layout === "agenda");
  if (ai === -1) {
    const skip = new Set(["title", "agenda", "conclusion", "references"]);
    const items = slides.filter((s) => !skip.has(s.layout) && s.title).map((s) => ({ title: s.title })).slice(0, 7);
    if (items.length) slides.splice(1, 0, { layout: "agenda", title: "Reja", icon: "list", items });
  } else if (ai !== 1) {
    slides.splice(1, 0, slides.splice(ai, 1)[0]);
  }

  // 5) KETMA-KET DUBLIKATLARNI SINDIRISH
  // Mazmun slaydlarini qayta tartiblaymiz — ma'lumot o'zgarmaydi
  slides = breakConsecutiveDuplicates(slides);

  spec.slides = slides;
  return spec;
}

// Mazmun slaydlari orasida ketma-ket bir xil layoutni oldini olish.
// Tartibni almashtiramiz (mazmun o'zgarmaydi, faqat joylashuv).
function breakConsecutiveDuplicates(slides) {
  const SKIP = new Set(["title", "agenda", "conclusion", "references"]);
  const result = [...slides];
  let changed = true;
  let pass = 0;
  while (changed && pass < 12) {
    changed = false; pass++;
    for (let i = 0; i < result.length - 1; i++) {
      if (SKIP.has(result[i].layout) || SKIP.has(result[i + 1].layout)) continue;
      if (result[i].layout !== result[i + 1].layout) continue;
      // Keyingi boshqa layoutli content slaydini topib almashtirish
      let swapped = false;
      for (let j = i + 2; j < result.length; j++) {
        if (SKIP.has(result[j].layout)) continue;
        if (result[j].layout !== result[i].layout) {
          [result[i + 1], result[j]] = [result[j], result[i + 1]];
          changed = true; swapped = true; break;
        }
      }
      // agar almashtirib bo'lmasa — oldingi bilan almashtirish urin
      if (!swapped && i > 0 && !SKIP.has(result[i - 1].layout) && result[i - 1].layout !== result[i + 1].layout) {
        [result[i], result[i + 1]] = [result[i + 1], result[i]];
        changed = true;
      }
    }
  }
  // Qolgan dublikatlarni loglash (hammasi bir xil layout bo'lsa — API qayta urinishi kerak)
  let remaining = 0;
  for (let i = 0; i < result.length - 1; i++) {
    if (!SKIP.has(result[i].layout) && result[i].layout === result[i+1].layout) remaining++;
  }
  if (remaining > 0) {
    console.warn("[llm] ensureStructure: " + remaining + " ta ketma-ket dublikat qoldi (layout xilma-xillik yetarli emas)");
  }
  return result;
}

// asosiy funksiya
async function generateSpec({ topic, slides, sourceContent, extra, studentName, studentGroup, provider, anthropicKey, anthropicModel, openaiKey, openaiModel }) {
  const prompts = {
    system: buildSystemPrompt(),
    user: buildUserPrompt({ topic, slides, extra, sourceContent, studentName, studentGroup }),
  };
  const cfg = { anthropicKey, anthropicModel, openaiKey, openaiModel };

  const order =
    provider === "openai" ? ["openai"] :
    provider === "anthropic" ? ["anthropic"] :
    ["anthropic", "openai"]; // "both" — Anthropic birinchi, keyin OpenAI

  // mavjud kaliti bor provayderlarnigina qoldirish
  const available = order.filter((p) =>
    (p === "anthropic" && anthropicKey) || (p === "openai" && openaiKey)
  );
  if (available.length === 0) {
    throw new Error("Hech qaysi LLM provayderga kalit topilmadi. ANTHROPIC_API_KEY yoki OPENAI_API_KEY o'rnating.");
  }

  const errors = [];
  for (const name of available) {
    try {
      const spec = await callOne(name, prompts, cfg);
      spec._targetSlides = slides; // slayd soni tekshiruvi uchun
      ensureStructure(spec, topic);
      return { spec, usedProvider: name };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      // keyingi provayderga o'tadi (failover)
    }
  }
  throw new Error("Barcha provayderlar muvaffaqiyatsiz:\n" + errors.join("\n"));
}

module.exports = { generateSpec, ensureStructure };
