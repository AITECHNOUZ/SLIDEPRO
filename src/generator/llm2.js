// src/generator/llm2.js
// Taqdimot uchun 2 bosqichli generatsiya (yagona LLM klienti orqali — limitlar, kaskad, zaxira):
//   Pass 1: reja (AYNAN N ta mazmunli slayd: sarlavha + layout + qisqa tavsif)
//   Pass 2: har bir slayd kontenti (tekshiruvdan o'tmasa qayta so'raladi; kaskadda qimmat modelga o'tadi)
// Har qanday holatda taqdimot chiqadi: reja kelmasa — mavzu skeleti, slayd kelmasa — sodda "bullets" slayd.

const { completeValidated } = require("../llm/client");
const { validateSlide } = require("./slide-validate");
const { labels } = require("./i18n");
const {
  outlineSystemPrompt, outlineUserPrompt, parseOutline,
  slideSystemPrompt, slideUserPrompt, parseSlide, CONTENT_LAYOUTS,
} = require("./prompt2");

const ROTATION = ["feature-grid", "steps", "stat-callout", "dual-column", "objectives", "metrics", "layers", "split-list", "chart"];
const SLIDE_CONCURRENCY = 4;

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

// Reja: aniq songa keltirish, layoutlarni tekshirish, ketma-ket takrorni layoutni almashtirib yo'qotish
function normalizeOutlineSlides(rawSlides, contentSlides, topic, language) {
  const L = labels(language);
  let slides = (Array.isArray(rawSlides) ? rawSlides : [])
    .filter(slide => slide && String(slide.title || "").trim())
    .map(slide => ({ title: String(slide.title).trim(), layout: String(slide.layout || "").trim(), brief: String(slide.brief || "").trim() }));
  // Xulosa — oxirida, bitta
  const conclusion = slides.find(slide => slide.layout === "conclusion");
  slides = slides.filter(slide => slide.layout !== "conclusion").slice(0, contentSlides - 1);
  while (slides.length < contentSlides - 1) {
    slides.push({ title: `${topic}: ${slides.length + 1}-jihat`, layout: "", brief: `${topic} mavzusining muhim jihatlaridan biri.` });
  }
  slides.push(conclusion || { title: L.conclusion, layout: "conclusion", brief: `${topic} bo'yicha umumiy xulosa va asosiy natijalar.` });
  // Layout tekshiruvi va ketma-ket takrorni almashtirish
  const used = new Map();
  slides.forEach((slide, index) => {
    if (slide.layout === "conclusion" && index === slides.length - 1) return;
    let layout = CONTENT_LAYOUTS.includes(slide.layout) && slide.layout !== "conclusion" ? slide.layout : null;
    const previous = index > 0 ? slides[index - 1].layout : null;
    if (!layout || layout === previous) {
      layout = ROTATION.filter(name => name !== previous).sort((a, b) => (used.get(a) || 0) - (used.get(b) || 0))[0];
    }
    used.set(layout, (used.get(layout) || 0) + 1);
    slide.layout = layout;
  });
  return slides.map((slide, index) => ({ ...slide, n: index + 1 }));
}

async function generateSpecParallel({ topic, slides, sourceContent, language, llm }) {
  // Titul + reja + adabiyotlar dastur tomonidan qo'shiladi; xulosa mazmunli slaydlar qatorida
  const contentSlides = Math.max(2, slides - 3);
  const L = labels(language);

  // ── PASS 1: REJA ─────────────────────────────────────────
  console.log(`[taqdimot] 1-pass: reja (${contentSlides} mazmunli slayd)...`);
  let outline;
  let usedProvider = null;
  try {
    const result = await completeValidated({
      system: outlineSystemPrompt(),
      user: outlineUserPrompt({ topic, contentSlides, sourceContent, language }),
      llm, maxTokens: 2500, attempts: 2,
      validate: text => {
        const parsed = parseOutline(text);
        const count = Array.isArray(parsed.slides) ? parsed.slides.filter(slide => slide && slide.title).length : 0;
        if (count < Math.ceil(contentSlides * 0.6)) throw new Error(`rejada ${count}/${contentSlides} slayd`);
        return parsed;
      },
    });
    outline = result.value;
    usedProvider = result.provider;
  } catch (error) {
    console.warn("[taqdimot] reja olinmadi — mavzu skeleti bilan davom:", error.message);
    outline = { title: topic, slides: [], references: [] };
  }
  const outlineSlides = normalizeOutlineSlides(outline.slides, contentSlides, topic, language);
  console.log("[taqdimot] reja: " + outlineSlides.map(slide => slide.layout).join(", "));

  // ── PASS 2: SLAYDLAR ─────────────────────────────────────
  const contentSpecs = await mapLimited(outlineSlides, SLIDE_CONCURRENCY, async slide => {
    let retryNote = "";
    const ask = async (layout, attempts) => completeValidated({
      system: slideSystemPrompt(),
      user: slideUserPrompt({ slide: { ...slide, layout }, outline, topic, language, retryNote }),
      llm, maxTokens: 1800, attempts,
      validate: text => {
        try {
          return validateSlide(parseSlide(text), { layout, title: slide.title });
        } catch (error) {
          retryNote = error.message;
          throw error;
        }
      },
    });
    try {
      return (await ask(slide.layout, 2)).value;
    } catch (error) {
      console.warn(`[taqdimot] slayd #${slide.n} (${slide.layout}) olinmadi: ${error.message}; sodda variant so'raladi`);
    }
    if (slide.layout !== "conclusion") {
      try {
        return (await ask("bullets", 1)).value;
      } catch (error) {
        console.warn(`[taqdimot] slayd #${slide.n} sodda variant ham olinmadi: ${error.message}`);
      }
    }
    // Oxirgi zaxira: rejadagi tavsifdan sodda slayd (bo'sh kartochkalarsiz)
    const brief = slide.brief || `${topic} — ${slide.title}`;
    return slide.layout === "conclusion"
      ? { layout: "conclusion", title: L.conclusion, summary: brief, points: [] }
      : { layout: "bullets", title: slide.title, icon: "list", intro: brief, items: brief.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 4).map(text => ({ text })) };
  });

  const spec = {
    palette: outline.palette || "ocean",
    title: outline.title || topic,
    slides: contentSpecs,
    references: Array.isArray(outline.references) ? outline.references.map(item => String(item || "").trim()).filter(Boolean) : [],
  };
  console.log(`[taqdimot] ${contentSpecs.length} mazmunli slayd tayyor`);
  return { spec, usedProvider };
}

module.exports = { generateSpecParallel, normalizeOutlineSlides };
