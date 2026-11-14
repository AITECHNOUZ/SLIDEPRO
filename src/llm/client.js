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

const crypto = require("crypto");
const { postJsonWithRetry } = require("../mustaqil/llm-http");
const { sharedLimiter, estimateTokens } = require("./rate-limiter");
const { recordUsage } = require("./usage");
const { AsyncLocalStorage } = require("async_hooks");

const ANTHROPIC_URL = process.env.ANTHROPIC_BASE_URL
  ? `${process.env.ANTHROPIC_BASE_URL.replace(/\/+$/, "")}/v1/messages`
  : "https://api.anthropic.com/v1/messages";
const OPENAI_URL = process.env.OPENAI_BASE_URL
  ? `${process.env.OPENAI_BASE_URL.replace(/\/+$/, "")}/chat/completions`
  : "https://api.openai.com/v1/chat/completions";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
// Asosiy model band (529) yoki limitda bo'lsa — arzonroq va tezroq zaxira model (o'chirish: ANTHROPIC_FALLBACK_MODEL=off)
const DEFAULT_ANTHROPIC_FALLBACK_MODEL = "claude-haiku-5-5";

// ── Holat: balans tugashi va admin ogohlantirishi ──────────────
let alertHandler = null;
const lastAlertAt = new Map();
function setProviderAlertHandler(fn) { alertHandler = typeof fn === "function" ? fn : null; }
function alertOnce(key, text, everyMs = 30 * 60_000) {
  const now = Date.now();
  if (now - (lastAlertAt.get(key) || 0) < everyMs) return;
  lastAlertAt.set(key, now);
  console.error(`[llm] ${text}`);
  try { alertHandler?.(text); } catch (_) {}
}
const disabledUntil = { anthropic: 0, openai: 0 };
function resetProviderState() {
  disabledUntil.anthropic = 0;
  disabledUntil.openai = 0;
  lastAlertAt.clear();
}
function isCreditError(error) {
  return error && (error.status === 400 || error.status === 402 || error.status === 403)
    && /credit balance|billing|insufficient_quota|quota|payment/i.test(`${error.message} ${error.body || ""}`);
}

function modelClass(model) {
  const match = String(model).match(/haiku|sonnet|opus|fable|mythos/i);
  return match ? match[0].toLowerCase() : String(model);
}

function limiterEnabled() {
  return !/^(0|off|false|no)$/i.test(String(process.env.ANTHROPIC_RATE_LIMITER || ""));
}

// Prompt-kesh: bir xil system prompt 5 daqiqa ichida qayta yuborilsa, keshdan o'qiladi va ITPM'ga kirmaydi
const seenSystems = new Map();
function systemCostTokens(system) {
  if (!system) return 0;
  const key = crypto.createHash("md5").update(String(system)).digest("hex");
  const now = Date.now();
  const last = seenSystems.get(key) || 0;
  seenSystems.set(key, now);
  const tokens = estimateTokens(system);
  // Kesh faqat ~1024+ tokenli promptlarda ishlaydi
  return now - last < 4 * 60_000 && tokens >= 1024 ? 0 : tokens;
}
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
// Eski modellarning chiqish tokeni chegarasi (undan katta max_tokens 400 xato beradi)
function modelOutputCap(provider, model) {
  const name = String(model || "").toLowerCase();
  if (provider === "anthropic") {
    if (/claude-3-(haiku|opus|sonnet)/.test(name)) return 4096;
    if (/claude-3-5/.test(name)) return 8192;
    return ANTHROPIC_MAX_OUTPUT;
  }
  if (/gpt-3\.5|gpt-4-turbo|gpt-4-\d{4}|^gpt-4$/.test(name)) return 4096;
  if (/gpt-4o/.test(name)) return 16384;
  if (/gpt-4\.1/.test(name)) return 32768;
  return OPENAI_MAX_OUTPUT;
}

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
  // Har model sinfi (Haiku / Sonnet / Opus) uchun limitlar alohida — alohida navbat
  const limiter = limiterEnabled() ? sharedLimiter(modelClass(model || DEFAULT_ANTHROPIC_MODEL)) : null;
  // max_tokens chiqish limitidan (OTPM) katta bo'lsa so'rov hech qachon sig'masdi — chegaralaymiz
  const modelCap = modelOutputCap("anthropic", model || DEFAULT_ANTHROPIC_MODEL);
  const cap = limiter ? Math.min(modelCap, limiter.maxOutputTokens()) : modelCap;
  const budget = Math.min(cap, Math.max(256, Math.floor(maxTokens || 8000)));
  const inputEstimate = estimateTokens(user) + systemCostTokens(system) + 20;
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
  }, "Anthropic", undefined, {
    timeoutMs: timeoutFor(budget),
    retries: intEnv("LLM_RETRIES", 5),
    beforeAttempt: limiter ? () => limiter.acquire({ input: inputEstimate, output: budget }) : undefined,
    afterAttempt: limiter ? ({ response, data, error, reservation, retryDelay }) => {
      limiter.updateFromHeaders(response?.headers);
      if (!reservation) return;
      if (data?.usage) {
        const usage = data.usage;
        limiter.settle(reservation, {
          input: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
          output: usage.output_tokens || 0,
        });
      } else {
        // Xato: chiqish tokenlari sarflanmadi — band qilingan qism qaytariladi
        limiter.settle(reservation, { output: 0 });
        if (error?.status === 429 || error?.status === 529) limiter.pause(retryDelay || 5_000);
      }
    } : undefined,
  });

  if (data?.usage) {
    const u = data.usage;
    // Kesh o'qish arzonroq, lekin hisobda soddalik uchun oddiy kirish sifatida olinadi (yuqori baho)
    recordUsage(model || DEFAULT_ANTHROPIC_MODEL, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), u.output_tokens || 0);
  }
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
  const budget = Math.min(modelOutputCap("openai", chosenModel), reasoning ? requested + 8000 : requested);
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system) });
  messages.push({ role: "user", content: String(user || "") });
  const body = { model: chosenModel, max_completion_tokens: budget, messages };
  if (json) body.response_format = { type: "json_object" };
  if (reasoning) {
    // JSON/matn yozish uchun chuqur fikrlash shart emas: "low" — tezroq va 2–4 barobar arzon
    const effort = process.env.OPENAI_REASONING_EFFORT || "low";
    if (effort !== "default") body.reasoning_effort = effort;
  } else {
    body.temperature = Number.isFinite(temperature) ? temperature : 0.7;
  }

  const data = await postJsonWithRetry(OPENAI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, "OpenAI", undefined, { timeoutMs: timeoutFor(budget), retries: intEnv("LLM_RETRIES", 4) });

  if (data?.usage) recordUsage(chosenModel, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  if (message && message.refusal) throw new Error(`OpenAI: model so'rovni rad etdi (${String(message.refusal).slice(0, 120)})`);
  const text = String((message && message.content) || "").trim();
  if (choice && choice.finish_reason === "length") throw new TruncatedResponseError("OpenAI", budget);
  return text;
}

async function callProvider(name, args, cfg) {
  if (disabledUntil[name] > Date.now()) throw new Error(`${name}: balans tugagan (vaqtincha o'chirilgan)`);
  try {
    return await callProviderModel(name, args, cfg, name === "anthropic" ? cfg.anthropicModel : cfg.openaiModel);
  } catch (error) {
    if (isCreditError(error)) {
      disabledUntil[name] = Date.now() + 15 * 60_000;
      alertOnce(`credit:${name}`, `${name === "anthropic" ? "Claude (Anthropic)" : "OpenAI"} balansi tugadi yoki to'lov muammosi: ${String(error.message).slice(0, 200)}. Balansni to'ldiring — hozircha zaxira provayder ishlatiladi.`);
      throw error;
    }
    // Asosiy model band/limitda: zaxira modelga bir marta o'tamiz
    const fallbackModel = String(process.env.ANTHROPIC_FALLBACK_MODEL ?? DEFAULT_ANTHROPIC_FALLBACK_MODEL).trim();
    const overloaded = error.status === 529 || error.status === 429 || error.status >= 500 || /overloaded|timeout|tugamadi/i.test(error.message);
    if (name === "anthropic" && overloaded && fallbackModel && !/^off$/i.test(fallbackModel) && fallbackModel !== cfg.anthropicModel) {
      console.warn(`[llm] ${cfg.anthropicModel} ishlamadi (${error.message.slice(0, 120)}); zaxira model ${fallbackModel}`);
      return callProviderModel(name, args, cfg, fallbackModel);
    }
    throw error;
  }
}

async function callProviderModel(name, args, cfg, model) {
  const fn = name === "anthropic" ? callAnthropic : callOpenAI;
  const base = {
    ...args,
    apiKey: name === "anthropic" ? cfg.anthropicKey : cfg.openaiKey,
    model,
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
async function complete({ system, user, maxTokens = 8000, json = true, temperature, llm: requested = {} }) {
  const llm = effectiveLlm(requested);
  const cfg = {
    anthropicKey: llm.anthropicKey,
    anthropicModel: llm.anthropicModel || process.env.ANTHROPIC_MODEL || process.env.MODEL || DEFAULT_ANTHROPIC_MODEL,
    openaiKey: llm.openaiKey,
    openaiModel: llm.openaiModel || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  };
  const provider = llm.provider === "claude_openai" ? "anthropic" : llm.provider === "claude_claude" ? "anthropic" : llm.provider;
  const available = llm.strict ? providerOrder(provider, cfg).filter(name => name === provider) : providerOrder(provider, cfg);
  if (!available.length) {
    throw new Error("LLM kaliti topilmadi: ANTHROPIC_API_KEY yoki OPENAI_API_KEY o'rnating (tanlangan provayder uchun).");
  }
  const errors = [];
  for (const name of available) {
    try {
      const text = await callProvider(name, { system, user, maxTokens, json, temperature }, cfg);
      if (!text) throw new Error("bo'sh javob");
      const okState = fallbackState(); if (okState) okState.pendingApiFailure = false;
      return { text, provider: name, model: name === "anthropic" ? cfg.anthropicModel : cfg.openaiModel };
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  const failure = new Error(errors.join(" | "));
  reportFailure(llm, failure.message);
  const st = fallbackState();
  if (st) st.pendingApiFailure = true; // callLLM qayta urinishda buni ikkinchi marta sanamasin
  throw failure;
}

// ── Zaxira modellar (fallback) ─────────────────────────────
// Asosiy model ketma-ket 3 marta javob bera olmasa (API xatosi yoki javob formati buzilgan) —
// ish keyingi zaxira modelga o'tadi: avval boshqa provayder, keyin boshqa modellar.
// Holat bitta buyurtma (ish) ichida saqlanadi: model almashsa, qolgan bo'limlar ham ishlaydigan modelda davom etadi.
const FALLBACK_AFTER_FAILURES = 3;
const fallbackStorage = new AsyncLocalStorage();

function mainModelOf(llm, provider) {
  return provider === "anthropic"
    ? (llm.anthropicModel || process.env.ANTHROPIC_MODEL || process.env.MODEL || DEFAULT_ANTHROPIC_MODEL)
    : (llm.openaiModel || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
}
function primaryProviderOf(llm = {}) {
  if (llm.provider === "openai") return "openai";
  if (llm.provider === "claude_openai" && !llm.anthropicKey) return "openai";
  return llm.anthropicKey ? "anthropic" : "openai";
}

// "openai:gpt-5, anthropic:claude-opus-5-5" yoki ["openai:gpt-5"] → [{provider, model}]
function parseFallbackModels(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return items.map(item => {
    if (item && typeof item === "object") return item;
    const m = String(item).trim().match(/^(anthropic|claude|openai|gpt):([A-Za-z0-9._:-]{2,80})$/i);
    if (!m) return null;
    return { provider: /^(anthropic|claude)$/i.test(m[1]) ? "anthropic" : "openai", model: m[2] };
  }).filter(Boolean);
}

// Zaxira zanjiri: sozlamada berilgan bo'lsa o'sha, aks holda standart tartib
function fallbackChain(llm = {}) {
  if (/^off$/i.test(String(llm.fallbackModels || "").trim())) return [];
  const primary = primaryProviderOf(llm);
  const used = new Set([`${primary}:${mainModelOf(llm, primary)}`]);
  let candidates = parseFallbackModels(llm.fallbackModels);
  if (!candidates.length) {
    const other = primary === "anthropic" ? "openai" : "anthropic";
    const claudeMain = mainModelOf(llm, "anthropic");
    candidates = [
      { provider: other, model: mainModelOf(llm, other) },
      { provider: "anthropic", model: /opus/i.test(claudeMain) ? "claude-sonnet-5-5" : "claude-opus-5-5" },
      { provider: "openai", model: /^gpt-5$/i.test(mainModelOf(llm, "openai")) ? "gpt-5-mini" : "gpt-5" },
      { provider: "anthropic", model: "claude-haiku-5-5" },
    ];
  }
  const keyOk = c => (c.provider === "anthropic" ? llm.anthropicKey : llm.openaiKey);
  const out = [];
  for (const c of candidates) {
    const id = `${c.provider}:${c.model}`;
    if (!keyOk(c) || used.has(id)) continue;
    used.add(id); out.push(c);
  }
  return out.slice(0, Math.max(0, Number(llm.maxFallbacks ?? 3)));
}

function fallbackLlm(llm, step) {
  return step.provider === "anthropic"
    ? { ...llm, provider: "anthropic", anthropicModel: step.model, tier: "fallback", strict: true }
    : { ...llm, provider: "openai", openaiModel: step.model, tier: "fallback", strict: true };
}

// Butun ish (buyurtma) davomida zaxira holatini saqlash
function runWithFallback(fn) {
  return fallbackStorage.run({ failures: 0, level: 0, chain: null, switches: [] }, fn);
}
function fallbackState() { return fallbackStorage.getStore() || null; }

// Joriy holatga ko'ra haqiqatda ishlatiladigan sozlama
function effectiveLlm(llm = {}) {
  const st = fallbackState();
  if (!st || !st.level || llm.tier === "fallback") return llm;
  if (!st.chain) st.chain = fallbackChain(llm);
  const step = st.chain[st.level - 1];
  return step ? fallbackLlm(llm, step) : llm;
}

// Asosiy (yoki joriy zaxira) model xato qildi; arzon kaskad urinishlari hisobga olinmaydi
function reportFailure(llm = {}, reason = "") {
  const st = fallbackState();
  if (!st || llm.tier === "cheap") return false;
  st.failures++;
  if (st.failures < FALLBACK_AFTER_FAILURES) return false;
  if (!st.chain) st.chain = fallbackChain(llm);
  if (st.level >= st.chain.length) { st.failures = 0; return false; }
  const from = st.level ? st.chain[st.level - 1] : { provider: primaryProviderOf(llm), model: mainModelOf(llm, primaryProviderOf(llm)) };
  st.level++; st.failures = 0;
  const to = st.chain[st.level - 1];
  st.switches.push(`${from.model} → ${to.model}`);
  console.warn(`[llm] ${from.model} ketma-ket ${FALLBACK_AFTER_FAILURES} marta javob bermadi — zaxira modelga o'tildi: ${to.provider}:${to.model} (${String(reason).slice(0, 120)})`);
  alertOnce(`fallback:${from.model}:${to.model}`, `${from.model} ketma-ket ${FALLBACK_AFTER_FAILURES} marta javob bera olmadi — ish zaxira model ${to.model} bilan davom etmoqda. Sabab: ${String(reason).slice(0, 160)}`);
  return true;
}
function reportSuccess() {
  const st = fallbackState();
  if (st) st.failures = 0;
}

// ── Ish rejimlari (admin sozlamasi) ─────────────────────────
//   anthropic      — faqat Claude (asosiy model)
//   openai         — faqat OpenAI
//   claude_openai  — avval arzon OpenAI modeli (2 urinish), keyin qimmat Claude
//   claude_claude  — avval arzon Claude modeli (Haiku, 2 urinish), keyin qimmat Claude (Sonnet)
//   both (eski)    — Claude, xato bo'lsa OpenAI (claude_openai kabi emas, oddiy zaxira)
const LLM_MODES = ["anthropic", "openai", "claude_openai", "claude_claude"];
const CHEAP_ATTEMPTS = 2;

function cheapAnthropicModel() {
  return process.env.ANTHROPIC_CHEAP_MODEL || DEFAULT_ANTHROPIC_FALLBACK_MODEL;
}
function cheapOpenAIModel() {
  return process.env.OPENAI_CHEAP_MODEL || DEFAULT_OPENAI_MODEL;
}

// Rejim bo'yicha urinishlar zanjiri: [{provider, model, tier}]
function cascadePlan(llm = {}) {
  const mode = llm.provider;
  const mainClaude = llm.anthropicModel || process.env.ANTHROPIC_MODEL || process.env.MODEL || DEFAULT_ANTHROPIC_MODEL;
  if (mode === "claude_openai" && llm.openaiKey && llm.anthropicKey) {
    return [
      ...Array(CHEAP_ATTEMPTS).fill({ provider: "openai", model: llm.openaiCheapModel || cheapOpenAIModel(), tier: "cheap" }),
      { provider: "anthropic", model: mainClaude, tier: "main" },
    ];
  }
  if (mode === "claude_claude" && llm.anthropicKey) {
    return [
      ...Array(CHEAP_ATTEMPTS).fill({ provider: "anthropic", model: llm.anthropicCheapModel || cheapAnthropicModel(), tier: "cheap" }),
      { provider: "anthropic", model: mainClaude, tier: "main" },
    ];
  }
  return null;
}

// Urinishlar soni: kaskad rejimida kamida 3 (2 arzon + 1 qimmat)
function attemptsFor(llm, base = 1) {
  const plan = cascadePlan(llm);
  return plan ? Math.max(base, plan.length) : base;
}

// N-urinish uchun LLM sozlamasi: dastlabki 2 tasi arzon model, keyingilari qimmat model
function llmForAttempt(llm = {}, attempt = 1) {
  const plan = cascadePlan(llm);
  if (!plan) {
    if (llm.provider === "claude_openai") return { ...llm, provider: llm.anthropicKey ? "anthropic" : "openai" };
    if (llm.provider === "claude_claude") return { ...llm, provider: "anthropic" };
    return llm;
  }
  const step = plan[Math.min(plan.length, Math.max(1, attempt)) - 1];
  return step.provider === "anthropic"
    ? { ...llm, provider: "anthropic", anthropicModel: step.model, tier: step.tier }
    : { ...llm, provider: "openai", openaiModel: step.model, tier: step.tier };
}

// Tekshiruvli chaqiruv: javob validate()dan o'tmasa yoki xato bo'lsa keyingi (qimmatroq) urinish
async function completeValidated({ validate = text => text, attempts = 1, ...args }) {
  const run = async () => {
    // Asosiy model kamida 3 marta (kaskadda: 2 arzon + 1 qimmat) sinab ko'riladi
    const total = Math.max(attemptsFor(args.llm, attempts), FALLBACK_AFTER_FAILURES);
    let lastError;
    for (let attempt = 1; attempt <= total; attempt++) {
      const llm = llmForAttempt(args.llm, Math.min(attempt, attemptsFor(args.llm, attempts)));
      try {
        const result = await complete({ ...args, llm });
        let value;
        try { value = await validate(result.text); }
        catch (error) { reportFailure(effectiveLlm(llm), error.message); throw error; }
        reportSuccess();
        return { value, ...result, tier: effectiveLlm(llm).tier || llm.tier || "main" };
      } catch (error) {
        lastError = error;
        // Zaxira modelga o'tilgan bo'lsa, qolgan urinishlar effectiveLlm orqali avtomatik o'sha modelda
        if (attempt < total) console.warn(`[llm] urinish ${attempt}/${total} (${llm.tier || "asosiy"} model) xato: ${String(error.message).slice(0, 160)}`);
      }
    }
    // Shu chaqiruv uchun zaxira zanjiri: har bir modelga bittadan urinish
    const st = fallbackState();
    const chain = (st && st.chain) || fallbackChain(args.llm);
    for (let i = st ? Math.max(0, st.level - 1) : 0; i < chain.length; i++) {
      const llm = fallbackLlm(args.llm, chain[i]);
      try {
        const result = await complete({ ...args, llm });
        const value = await validate(result.text);
        if (st) { st.chain = chain; if (st.level < i + 1) { st.switches.push(`→ ${chain[i].model}`); st.level = i + 1; } st.failures = 0; }
        console.warn(`[llm] zaxira model ${chain[i].provider}:${chain[i].model} javob berdi`);
        return { value, ...result, tier: "fallback" };
      } catch (error) {
        lastError = error;
        console.warn(`[llm] zaxira model ${chain[i].model} ham xato: ${String(error.message).slice(0, 160)}`);
      }
    }
    throw lastError;
  };
  return fallbackState() ? run() : runWithFallback(run);
}

// Admin model nomini kiritganda: kalit va model haqiqatan ishlashini tekshirish (kichik so'rov)
async function testModel({ provider, model, apiKey }) {
  const started = Date.now();
  const fn = provider === "anthropic" ? callAnthropic : callOpenAI;
  const text = await fn({ system: "", user: 'Faqat JSON qaytar: {"ok":true}', apiKey, model, maxTokens: 64 });
  return { ok: /ok/i.test(text), text: String(text).slice(0, 80), ms: Date.now() - started };
}

module.exports = {
  complete,
  testModel,
  modelOutputCap,
  completeValidated,
  fallbackChain,
  parseFallbackModels,
  runWithFallback,
  fallbackState,
  reportFailure,
  reportSuccess,
  effectiveLlm,
  cascadePlan,
  attemptsFor,
  llmForAttempt,
  LLM_MODES,
  setProviderAlertHandler,
  isCreditError,
  resetProviderState,
  providerOrder,
  isOpenAIReasoningModel,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
};
