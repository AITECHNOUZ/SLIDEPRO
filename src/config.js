// src/config.js
require("dotenv").config();

function intEnv(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
}

const config = {
  botToken: process.env.BOT_TOKEN,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.MODEL || "claude-sonnet-4-6",

  // OpenAI (muqobil yoki zaxira provayder)
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",

  // Admin Telegram ID(lar) — vergul bilan ajratilgan
  adminIds: (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  // Server (to'lov webhooklari + health) uchun port
  port: intEnv("PORT", 3000),
  publicUrl: process.env.PUBLIC_URL || "", // masalan https://myapp.up.railway.app

  // Tayyor fayllar yuboriladigan kanal (kesh uchun ham). Mas: -1001234567890 yoki @kanal
  deliveryChannelId: process.env.DELIVERY_CHANNEL_ID || "",

  // DB yo'li (Railway/Render'da volume ulang)
  dbPath: process.env.DB_PATH || "./data/bot.sqlite",

  // Standart narx sozlamalari (admin keyin o'zgartira oladi)
  defaults: {
    base_price: intEnv("BASE_PRICE", 0),
    price_per_slide: intEnv("PRICE_PER_SLIDE", 5000),
    currency: process.env.CURRENCY || "so'm",
    card_number: process.env.CARD_NUMBER || "8600 0000 0000 0000",
    card_holder: process.env.CARD_HOLDER || "F.I.SH",
    manual_enabled: process.env.MANUAL_ENABLED !== "false" ? "1" : "0",
    click_enabled: process.env.CLICK_ENABLED === "true" ? "1" : "0",
    payme_enabled: process.env.PAYME_ENABLED === "true" ? "1" : "0",
    // LLM provayder: "anthropic" | "openai" | "both"
    llm_provider: (["anthropic","openai","both"].includes(process.env.LLM_PROVIDER) ? process.env.LLM_PROVIDER : "anthropic"),
    // Mustaqil ish uchun alohida LLM (bo'sh = taqdimot bilan bir xil)
    mustaqil_llm_provider: process.env.MUSTAQIL_LLM_PROVIDER || "",
  },

  // Click merchant (avtomatik to'lov)
  click: {
    serviceId: process.env.CLICK_SERVICE_ID || "",
    merchantId: process.env.CLICK_MERCHANT_ID || "",
    secretKey: process.env.CLICK_SECRET_KEY || "",
    merchantUserId: process.env.CLICK_MERCHANT_USER_ID || "",
  },

  // Payme merchant (avtomatik to'lov)
  payme: {
    merchantId: process.env.PAYME_MERCHANT_ID || "",
    key: process.env.PAYME_KEY || "", // kassa kaliti (Basic auth uchun)
    checkoutUrl: process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz",
  },

  // Mustaqil ish uchun alohida LLM provayder
  mustaqilLlmProvider: (["anthropic","openai","both"].includes(process.env.MUSTAQIL_LLM_PROVIDER)
    ? process.env.MUSTAQIL_LLM_PROVIDER : null), // null = taqdimot bilan bir xil

  // Slayd soni chegaralari
  minSlides: intEnv("MIN_SLIDES", 6),
  maxSlides: intEnv("MAX_SLIDES", 20),

  // Mustaqil ish sahifa chegaralari
  minPages: intEnv("MIN_PAGES", 10),
  maxPages: intEnv("MAX_PAGES", 40),
};

function assertConfig() {
  const missing = [];
  if (!config.botToken) missing.push("BOT_TOKEN");
  if (config.adminIds.length === 0) missing.push("ADMIN_IDS");
  if (!config.anthropicApiKey && !config.openaiApiKey)
    missing.push("ANTHROPIC_API_KEY yoki OPENAI_API_KEY (kamida bittasi)");
  if (missing.length) {
    throw new Error("Quyidagi muhit o'zgaruvchilari yetishmaydi: " + missing.join(", "));
  }
}

module.exports = { config, assertConfig };
