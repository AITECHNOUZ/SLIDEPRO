// src/llm/client.js
// Yagona LLM klienti: faqat Anthropic Claude (Messages API) va OpenAI (Chat Completions).
//
//   provider = "anthropic" | "openai" | "both"
//   "both" — avval Claude, xato yoki bo'sh javob bo'lsa avtomatik OpenAI (failover).
//
// Imkoniyatlar:
//   • Claude: system prompt prompt-caching bilan (cache_control: ephemeral) — mustaqil ishda
//     bir xil system prompt o'nlab marta yuboriladi, kesh narx va kechikishni kamaytiradi.
//   • Claude: stop_reason = "max_tokens" bo'lsa javob kesilgan — tokenlar budjeti oshirilib
//     bir marta qayta so'raladi (kesilgan JSON hujjatni buzmasin).
//   • OpenAI: gpt-5 / o-seriya (reasoning) modellar `temperature`ni qabul qilmaydi va
//     max_completion_tokens ichida fikrlash tokenlarini ham sarflaydi — shu hisobga olinadi.
//   • 408/429/5xx uchun retry (llm-http), uzun javoblar uchun kattaroq timeout.

const { postJsonWithRetry } = require("../mustaqil/llm-http");

const ANTHROPIC_URL = process.env.ANTHROPIC_BASE_URL
  ? `${process.env.ANTHROPIC_BASE_URL.replace(/\/+$/, "")}/v1/messages`
  : "https://api.anthropic.com/v1/messages";
const OPENAI_URL = process.env.OPENAI_BASE_URL
  ? `${process.env.OPENAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`
  : "https://api.openai.com/v1/chat/completions";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const ANTHROPIC_MAX_OUTPUT = 32000;
const OPENAI_MAX_OUTPUT = 64000;

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Uzun bob matni 1–3 daqiqa yozilishi mumkin: tokenlar soniga mos timeout.
function timeoutFor(maxTokens) {
  const base = intEnv("LLM_TIMEOUT_MS", 0);
  if (base) return base;
  return Math.min(600_000, Math.max(90_000, 60_000 + Number(maxTokens || 0) * 25));
}

function providerOrder(provider, cfg) {
  // Asosiy provayder yiqilsa (overload, limit, refusal) ikkinchi kalit bo'lsa zaxira sifatida ishlatiladi —
  // foydalanuvchi baribir hujjat olishi kerak. LLM_STRICT_PROVIDER=1 bo'lsa faqat tanlangan provayder.
  const strict = /^(1|true|yes)$/i.test(String(process.env.LLM_STRICT_PROVIDER || ""));
  const order = provider === "openai" ? (strict ? ["openai"] : ["openai", "anthropic"])
    : provider === "anthropic" ? (strict ? ["anthropic"] : ["anthropic", "openai"])
      : ["anthropic", "openai"];
  return order.filter(name => (name === "anthropic" && cfg.anthropicKey) || (name === "openai" && cfg.openaiKey));
}

// OpenAI reasoning modellari: gpt-5*, o1/o3/o4*
function isOpenAIReasoningModel(model) {
  return /^(gpt-5|o\d)/i.test(String(model || ""));
}

class TruncatedResponseError extends Error {
  constructor(provider, maxTokens) {
    super(`${provider}: javob ${maxTokens} token chegarasida kesildi`);
    this.truncated = true;
  }
}

// ── Anthropic Claude ─────────────────────────────────────────
async function callAnthropic({ system, user, apiKey, model, maxTokens, temperature }) {
  const budget = Math.min(ANTHROPIC_MAX_OUTPUT, Math.max(256, Math.floor(maxTokens || 8000)));
  const body = {
    model: model || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: budget,
    messages: [{ role: "user", content: String(user || "") }],
  };
  if (system) {
    // Prompt caching: system prompt ~1K+ token bo'lsa kesh ishlaydi; kichik bo'lsa API e'tiborsiz qoldiradi.
    body.system = [{ type: "text", text: String(system), cache_control: { type: "ephemeral" } }];
  }
  if (Number.isFinite(temperature)) body.temperature = temperature;

  const data = await postJsonWithRetry(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  }, "Anthropic", undefined, { timeoutMs: timeoutFor(budget), retries: intEnv("LLM_RETRIES", 4) });

  const text = (data.content || []).filter(block => block.type === "text").map(block => block.text).join("").trim();
  if (data.stop_reason === "max_tokens") throw new TruncatedResponseError("Anthropic", budget);
  if (data.stop_reason === "refusal") throw new Error("Anthropic: model so'rovni rad etdi (refusal)");
  return text;
}

// ── OpenAI ───────────────────────────────────────────────────
async function callOpenAI({ system, user, apiKey, model, maxTokens, json, temperature }) {
  const chosenModel = model || DEFAULT_OPENAI_MODEL;
  const reasoning = isOpenAIReasoningModel(chosenModel);
  // Reasoning modellar fikrlash tokenlarini ham shu budjetdan sarflaydi — zaxira qo'shamiz.
  const requested = Math.max(256, Math.floor(maxTokens || 8000));
  const budget = Math.min(OPENAI_MAX_OUTPUT, reasoning ? requested + 8000 : requested);
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system) });
  messages.push({ role: "user", content: String(user || "") });
  const body = { model: chosenModel, max_completion_tokens: budget, messages };
  if (json) body.response_format = { type: "json_object" };
  if (reasoning) {
    const effort = process.env.OPENAI_REASONING_EFFORT;
    if (effort) body.reasoning_effort = effort;
  } else {
    body.temperature = Number.isFinite(temperature) ? temperature : 0.7;
  }

  const data = await postJsonWithRetry(OPENAI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, "OpenAI", undefined, { timeoutMs: timeoutFor(budget), retries: intEnv("LLM_RETRIES", 4) });

  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  if (message && message.refusal) throw new Error(`OpenAI: model so'rovni rad etdi (${String(message.refusal).slice(0, 120)})`);
  const text = String((message && message.content) || "").trim();
  if (choice && choice.finish_reason === "length") throw new TruncatedResponseError("OpenAI", budget);
  return text;
}

async function callProvider(name, args, cfg) {
  const fn = name === "anthropic" ? callAnthropic : callOpenAI;
  const base = {
    ...args,
    apiKey: name === "anthropic" ? cfg.anthropicKey : cfg.openaiKey,
    model: name === "anthropic" ? cfg.anthropicModel : cfg.openaiModel,
  };
  try {
    return await fn(base);
  } catch (error) {
    // Kesilgan javob: budjetni ikki baravar oshirib bir marta qayta urinamiz.
    if (!error.truncated) throw error;
    const cap = name === "anthropic" ? ANTHROPIC_MAX_OUTPUT : OPENAI_MAX_OUTPUT;
    const bigger = Math.min(cap, Math.floor((args.maxTokens || 8000) * 2));
    if (bigger <= (args.maxTokens || 8000)) throw error;
    console.warn(`[llm] ${error.message}; ${bigger} token bilan qayta so'ralmoqda`);
    return fn({ ...base, maxTokens: bigger });
  }
}

/**
 * Matn generatsiyasi (failover bilan).
 * @returns {Promise<{text: string, provider: string}>}
 */
async function complete({ system, user, maxTokens = 8000, json = true, temperature, llm = {} }) {
  const cfg = {
    anthropicKey: llm.anthropicKey,
    anthropicModel: llm.anthropicModel || process.env.ANTHROPIC_MODEL || process.env.MODEL || DEFAULT_ANTHROPIC_MODEL,
    openaiKey: llm.openaiKey,
    openaiModel: llm.openaiModel || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  };
  const available = providerOrder(llm.provider, cfg);
  if (!available.length) {
    throw new Error("LLM kaliti topilmadi: ANTHROPIC_API_KEY yoki OPENAI_API_KEY o'rnating (tanlangan provayder uchun).");
  }
  const errors = [];
  for (const name of available) {
    try {
      const text = await callProvider(name, { system, user, maxTokens, json, temperature }, cfg);
      if (!text) throw new Error("bo'sh javob");
      return { text, provider: name };
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

module.exports = {
  complete,
  providerOrder,
  isOpenAIReasoningModel,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
};
