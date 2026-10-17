// src/generator/llm2.js
// Taqdimot uchun 2 bosqichli PARALLEL generatsiya:
//   Pass 1: outline (AYNAN N ta mazmunli slayd rejasi)
//   Pass 2: har bir slayd PARALLEL to'liq kontent
// Bu aniq slayd sonini VA har slaydda to'liq sifatli kontentni kafolatlaydi.

const anthropic = require("./anthropic");
const openai = require("./openai");
const {
  outlineSystemPrompt, outlineUserPrompt, parseOutline,
  slideSystemPrompt, slideUserPrompt, parseSlide,
} = require("./prompt2");

// Provayder tartibi (failover)
function providerOrder(provider, cfg) {
  const order = provider === "openai" ? ["openai"]
    : provider === "anthropic" ? ["anthropic"] : ["anthropic", "openai"];
  return order.filter(p => (p === "anthropic" && cfg.anthropicKey) || (p === "openai" && cfg.openaiKey));
}

// Bitta LLM chaqiruv (failover bilan)
async function call({ system, user, provider, cfg, maxTokens }) {
  const avail = providerOrder(provider, cfg);
  if (!avail.length) throw new Error("LLM kalit topilmadi.");
  const errs = [];
  for (const name of avail) {
    try {
      if (name === "anthropic") {
        return { text: await anthropic.generate({ system, user, apiKey: cfg.anthropicKey, model: cfg.anthropicModel, maxTokens }), provider: name };
      } else {
        return { text: await openai.generate({ system, user, apiKey: cfg.openaiKey, model: cfg.openaiModel, maxTokens }), provider: name };
      }
    } catch (e) { errs.push(name + ": " + e.message); }
  }
  throw new Error(errs.join(" | "));
}

// 2-bosqichli parallel spec generatsiya
async function generateSpecParallel({ topic, slides, sourceContent, studentName, studentGroup, provider, anthropicKey, anthropicModel, openaiKey, openaiModel }) {
  const cfg = { anthropicKey, anthropicModel, openaiKey, openaiModel };
  // ensureStructure 3 ta slayd qo'shadi: titul + reja(agenda) + adabiyotlar(references)
  // Xulosa esa mazmunli slaydlar qatorida bo'ladi (outline uni ham yaratadi)
  const contentSlides = Math.max(2, slides - 3);

  // ── PASS 1: OUTLINE ─────────────────────────────────────
  console.log("[taqdimot] 1-pass: outline (" + contentSlides + " mazmunli slayd)...");
  const o = await call({
    system: outlineSystemPrompt(),
    user: outlineUserPrompt({ topic, contentSlides, sourceContent }),
    provider, cfg, maxTokens: 2000,
  });
  const usedProvider = o.provider;
  const outline = parseOutline(o.text);
  let outlineSlides = Array.isArray(outline.slides) ? outline.slides : [];

  // Outline aniq songa keltirish (LLM 1-2 ta adashishi mumkin)
  if (outlineSlides.length > contentSlides) {
    outlineSlides = outlineSlides.slice(0, contentSlides);
  } else while (outlineSlides.length < contentSlides) {
    // Kam bo'lsa — oxirgi mavzuni davom ettiruvchi slayd qo'shamiz (lekin alohida kontent oladi)
    const idx = outlineSlides.length + 1;
    const LAYOUTS = ["feature-grid", "metrics", "objectives", "steps", "layers", "split-list", "dual-column"];
    outlineSlides.push({
      n: idx,
      title: topic + " — qo'shimcha jihatlar",
      layout: LAYOUTS[outlineSlides.length % LAYOUTS.length],
      brief: topic + " mavzusining muhim qo'shimcha tomonlarini yoritadi.",
    });
  }
  outlineSlides.forEach((s, i) => { s.n = i + 1; });
  console.log("[taqdimot] outline: " + outlineSlides.length + " slayd: " + outlineSlides.map(s => s.layout).join(", "));

  // ── PASS 2: HAR SLAYD PARALLEL ──────────────────────────
  console.log("[taqdimot] 2-pass: " + outlineSlides.length + " slayd parallel...");

  // Agar biror matnda qolgan placeholder bo'lsa tozalash
  const PLACEHOLDER_RE = /^(karta|panel|element|tavsif|kirish|maqsad|qadam|xususiyat|qatlam|band|bosqich|ustun|ko'rsatkich)\s*\d+$/i;
  function cleanPlaceholders(obj) {
    if (!obj || typeof obj !== "object") return;
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (typeof v === "string" && PLACEHOLDER_RE.test(v.trim())) {
        obj[k] = "";  // Bo'sh qoldiramiz — layout o'zi yashiradi
      } else if (typeof v === "object") {
        cleanPlaceholders(v);
      }
    });
  }
  const results = await Promise.allSettled(
    outlineSlides.map(slide =>
      call({
        system: slideSystemPrompt(),
        user: slideUserPrompt({ slide, outline, topic, language: "o'zbek" }),
        provider, cfg, maxTokens: 2000,
      }).then(r => {
        const parsed = parseSlide(r.text);
        cleanPlaceholders(parsed);
        parsed.layout = slide.layout;
        if (!parsed.title) parsed.title = slide.title;
        return parsed;
      })
    )
  );

  const contentSpecs = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      contentSpecs.push(r.value);
    } else {
      console.warn("[taqdimot] slayd #" + (i + 1) + " xato:", r.reason?.message);
      // Xato bo'lsa — outline'dan minimal slayd yasaymiz (bo'sh emas)
      const s = outlineSlides[i];
      contentSpecs.push({
        layout: s.layout, title: s.title, icon: "star",
        intro: s.brief || "",
        items: [{ icon: "check", title: s.title, desc: s.brief || "" }],
      });
    }
  });

  // Spec yig'ish (ensureStructure titul/reja/xulosa/adabiyotlarni qo'shadi)
  const spec = {
    palette: outline.palette || "ocean",
    title: outline.title || topic,
    slides: contentSpecs,
    // Outline'dan haqiqiy APA adabiyotlarni references slaydiga uzatamiz
    references: Array.isArray(outline.references) ? outline.references : [],
  };

  console.log("[taqdimot] " + contentSpecs.length + " mazmunli slayd tayyor");
  return { spec, usedProvider };
}

module.exports = { generateSpecParallel };
