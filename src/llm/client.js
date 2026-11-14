// src/llm/client.js
// Yagona LLM klienti: faqat Anthropic Claude (Messages API) va OpenAI (Chat Completions).
//
//   provider = "anthropic" | "openai" | "deepseek" | "zai" | kaskad rejimlari (claude_*)
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

const base = (env, def) => (process.env[env] || def).replace(/\/+$/, "");
const DEEPSEEK_URL = `${base("DEEPSEEK_BASE_URL", "https://api.deepseek.com")}/chat/completions`;
const ZAI_URL = `${base("ZAI_BASE_URL", "https://api.z.ai/api/paas/v4")}/chat/completions`;

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
// Asosiy model band (529) yoki limitda bo'lsa — arzonroq va tezroq zaxira model (o'chirish: ANTHROPIC_FALLBACK_MODEL=off)
const DEFAULT_ANTHROPIC_FALLBACK_MODEL = "claude-haiku-5-5";

// ── Provayderlar reyestri ─────────────────────────────────────
// deepseek va zai (GLM) — OpenAI bilan mos (chat/completions) API; kalit/model maydonlari llm sozlamasida.
const PROVIDERS = {
  anthropic: { label: "Claude", key: "anthropicKey", model: "anthropicModel", cheap: "anthropicCheapModel",
    env: "ANTHROPIC_MODEL", def: DEFAULT_ANTHROPIC_MODEL, cheapEnv: "ANTHROPIC_CHEAP_MODEL", cheapDef: "claude-haiku-5-5" },
  openai: { label: "OpenAI", key: "openaiKey", model: "openaiModel", cheap: "openaiCheapModel",
    env: "OPENAI_MODEL", def: DEFAULT_OPENAI_MODEL, cheapEnv: "OPENAI_CHEAP_MODEL", cheapDef: DEFAULT_OPENAI_MODEL },
  deepseek: { label: "DeepSeek", key: "deepseekKey", model: "deepseekModel", cheap: "deepseekCheapModel",
    env: "DEEPSEEK_MODEL", def: "deepseek-v4-pro", cheapEnv: "DEEPSEEK_CHEAP_MODEL", cheapDef: "deepseek-flash", url: () => DEEPSEEK_URL },
  zai: { label: "GLM (Z.ai)", key: "zaiKey", model: "zaiModel", cheap: "zaiCheapModel",
    env: "ZAI_MODEL", def: "glm-5.3", cheapEnv: "ZAI_CHEAP_MODEL", cheapDef: "glm-5.3-flash", url: () => ZAI_URL },
};
const PROVIDER_NAMES = Object.keys(PROVIDERS);
function providerModel(llm = {}, name) {
  const p = PROVIDERS[name];
  return (p && (llm[p.model] || process.env[p.env] || (name === "anthropic" && process.env.MODEL) || p.def)) || "";
}
function providerCheapModel(llm = {}, name) {
  const p = PROVIDERS[name];
  return (p && (llm[p.cheap] || process.env[p.cheapEnv] || p.cheapDef)) || "";
}
function hasKey(llm = {}, name) { const p = PROVIDERS[name]; return !!(p && llm[p.key]); }
function withModel(llm, name, model, extra = {}) { return { ...llm, provider: name, [PROVIDERS[name].model]: model, ...extra }; }

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
const disabledUntil = {};
function resetProviderState() {
  for (const k of Object.keys(disabledUntil)) delete disabledUntil[k];
  lastAlertAt.clear();
}
function isCreditError(error) {
  return error && (error.status === 400 || error.status === 402 || error.status === 403 || error.status === 429)
    && /credit balance|billing|insufficient_quota|insufficient balance|quota|payment|arrears|余额|欠费/i.test(`${error.message} ${error.body || ""}`);
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
  // Asosiy provayder yiqilsa (overload, limit, refusal) Claude/OpenAI kaliti bo'lsa darhol zaxira sifatida ishlatiladi —
  // foydalanuvchi baribir hujjat olishi kerak. LLM_STRICT_PROVIDER=1 bo'lsa faqat tanlangan provayder.
  // DeepSeek/GLM bu yerda avtomatik qo'shilmaydi — ular zaxira zanjirida (fallbackChain) ishlatiladi.
  const strict = /^(1|true|yes)$/i.test(String(process.env.LLM_STRICT_PROVIDER || ""));
  const primary = PROVIDERS[provider] ? provider : "anthropic";
  const order = strict ? [primary] : [primary, ...["anthropic", "openai"].filter(name => name !== primary)];
  return order.filter(name => hasKey(cfg, name));
}

// OpenAI reasoning modellari: gpt-5*, o1/o3/o4*
// Eski modellarning chiqish tokeni chegarasi (undan katta max_tokens 400 xato beradi)
function modelOutputCap(provider, model) {
  const name = String(model || "").toLowerCase();
  if (provider === "deepseek" || provider === "zai") return Number(process.env.COMPAT_MAX_OUTPUT) || 32000;
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
async function callOpenAI({ system, user, apiKey, model, maxTokens, json, temperature, provider = "openai" }) {
  if (provider !== "openai") return callCompat({ system, user, apiKey, model, maxTokens, json, temperature, provider });
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

// ── DeepSeek / GLM (OpenAI bilan mos chat/completions) ──────────
async function callCompat({ system, user, apiKey, model, maxTokens, json, temperature, provider }) {
  const p = PROVIDERS[provider];
  const chosenModel = model || p.def;
  const budget = Math.min(modelOutputCap(provider, chosenModel), Math.max(256, Math.floor(maxTokens || 8000)));
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system) });
  messages.push({ role: "user", content: String(user || "") });
  const body = { model: chosenModel, max_tokens: budget, messages,
    temperature: Number.isFinite(temperature) ? temperature : 0.7 };
  if (json) body.response_format = { type: "json_object" };
  // GLM: chuqur fikrlash JSON/matn uchun shart emas — tezroq va arzon (ZAI_THINKING=enabled bilan yoqiladi)
  if (provider === "zai") body.thinking = { type: process.env.ZAI_THINKING || "disabled" };

  const data = await postJsonWithRetry(p.url(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, p.label, undefined, { timeoutMs: timeoutFor(budget), retries: intEnv("LLM_RETRIES", 4) });

  if (data?.usage) recordUsage(chosenModel, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  const text = String((message && message.content) || "").trim();
  if (choice && choice.finish_reason === "length") throw new TruncatedResponseError(p.label, budget);
  if (choice && choice.finish_reason === "sensitive") throw new Error(`${p.label}: javob kontent filtri bilan to'xtatildi`);
  return text;
}

async function callProvider(name, args, cfg) {
  if (disabledUntil[name] > Date.now()) throw new Error(`${name}: balans tugagan (vaqtincha o'chirilgan)`);
  try {
    return await callProviderModel(name, args, cfg, providerModel(cfg, name));
  } catch (error) {
    if (isCreditError(error)) {
      disabledUntil[name] = Date.now() + 15 * 60_000;
      alertOnce(`credit:${name}`, `${PROVIDERS[name] ? PROVIDERS[name].label : name} balansi tugadi yoki to'lov muammosi: ${String(error.message).slice(0, 200)}. Balansni to'ldiring — hozircha zaxira provayder ishlatiladi.`);
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
    apiKey: cfg[PROVIDERS[name].key],
    model,
    provider: name,
  };
  try {
    return await fn(base);
  } catch (error) {
    // Kesilgan javob: budjetni ikki baravar oshirib bir marta qayta urinamiz.
    if (!error.truncated) throw error;
    const cap = name === "anthropic" ? ANTHROPIC_MAX_OUTPUT : modelOutputCap(name, model);
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
  const cfg = {};
  for (const name of PROVIDER_NAMES) { cfg[PROVIDERS[name].key] = llm[PROVIDERS[name].key]; cfg[PROVIDERS[name].model] = providerModel(llm, name); }
  const provider = /^claude_/.test(String(llm.provider)) || llm.provider === "both" || !llm.provider ? "anthropic" : llm.provider;
  const available = llm.strict ? providerOrder(provider, cfg).filter(name => name === provider) : providerOrder(provider, cfg);
  if (!available.length) {
    throw new Error("LLM kaliti topilmadi: tanlangan provayder uchun API kalitini o'rnating (ANTHROPIC/OPENAI/DEEPSEEK/ZAI_API_KEY).");
  }
  const errors = [];
  for (const name of available) {
    try {
      const text = await callProvider(name, { system, user, maxTokens, json, temperature }, cfg);
      if (!text) throw new Error("bo'sh javob");
      const okState = fallbackState(); if (okState) okState.pendingApiFailure = false;
      return { text, provider: name, model: providerModel(cfg, name) };
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

function mainModelOf(llm, provider) { return providerModel(llm, provider); }
function primaryProviderOf(llm = {}) {
  if (PROVIDERS[llm.provider] && llm.provider !== "anthropic") return llm.provider;
  if (hasKey(llm, "anthropic")) return "anthropic";
  const cheap = CASCADE_MODES[llm.provider];
  if (cheap && hasKey(llm, cheap)) return cheap;
  return PROVIDER_NAMES.find(name => hasKey(llm, name)) || "anthropic";
}

// "openai:gpt-5, anthropic:claude-opus-5-5" yoki ["openai:gpt-5"] → [{provider, model}]
function parseFallbackModels(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return items.map(item => {
    if (item && typeof item === "object") return item;
    const m = String(item).trim().match(/^(anthropic|claude|openai|gpt|deepseek|zai|glm):([A-Za-z0-9._:-]{2,80})$/i);
    if (!m) return null;
    const alias = { claude: "anthropic", gpt: "openai", glm: "zai" };
    return { provider: alias[m[1].toLowerCase()] || m[1].toLowerCase(), model: m[2] };
  }).filter(Boolean);
}

// Zaxira zanjiri: sozlamada berilgan bo'lsa o'sha, aks holda standart tartib
function fallbackChain(llm = {}) {
  if (/^off$/i.test(String(llm.fallbackModels || "").trim())) return [];
  const primary = primaryProviderOf(llm);
  const used = new Set([`${primary}:${mainModelOf(llm, primary)}`]);
  let candidates = parseFallbackModels(llm.fallbackModels);
  if (!candidates.length) {
    const claudeMain = mainModelOf(llm, "anthropic");
    candidates = [
      // avval boshqa yirik provayder (Claude ↔ OpenAI), so'ng boshqa modellar, oxirida DeepSeek va GLM
      ...["anthropic", "openai"].filter(name => name !== primary).map(name => ({ provider: name, model: mainModelOf(llm, name) })),
      { provider: "anthropic", model: /opus/i.test(claudeMain) ? "claude-sonnet-5-5" : "claude-opus-5-5" },
      { provider: "openai", model: /^gpt-5$/i.test(mainModelOf(llm, "openai")) ? "gpt-5-mini" : "gpt-5" },
      ...["deepseek", "zai"].filter(name => name !== primary).map(name => ({ provider: name, model: mainModelOf(llm, name) })),
      { provider: "anthropic", model: "claude-haiku-5-5" },
    ];
  }
  const keyOk = c => hasKey(llm, c.provider);
  const out = [];
  for (const c of candidates) {
    const id = `${c.provider}:${c.model}`;
    if (!keyOk(c) || used.has(id)) continue;
    used.add(id); out.push(c);
  }
  return out.slice(0, Math.max(0, Number(llm.maxFallbacks ?? 4)));
}

function fallbackLlm(llm, step) {
  return withModel(llm, step.provider, step.model, { tier: "fallback", strict: true });
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
const LLM_MODES = ["anthropic", "openai", "deepseek", "zai", "claude_openai", "claude_claude", "claude_deepseek", "claude_glm"];
// Kaskad rejimi → arzon bosqich provayderi (qimmat bosqich doim Claude asosiy modeli)
const CASCADE_MODES = { claude_openai: "openai", claude_claude: "anthropic", claude_deepseek: "deepseek", claude_glm: "zai" };
const CHEAP_ATTEMPTS = 2;

function cheapAnthropicModel() { return providerCheapModel({}, "anthropic"); }
function cheapOpenAIModel() { return providerCheapModel({}, "openai"); }

// Rejim bo'yicha urinishlar zanjiri: [{provider, model, tier}]
function cascadePlan(llm = {}) {
  const cheapProvider = CASCADE_MODES[llm.provider];
  if (!cheapProvider || !hasKey(llm, "anthropic") || !hasKey(llm, cheapProvider)) return null;
  return [
    ...Array(CHEAP_ATTEMPTS).fill({ provider: cheapProvider, model: providerCheapModel(llm, cheapProvider), tier: "cheap" }),
    { provider: "anthropic", model: providerModel(llm, "anthropic"), tier: "main" },
  ];
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
    const cheap = CASCADE_MODES[llm.provider];
    if (cheap) return { ...llm, provider: hasKey(llm, "anthropic") ? "anthropic" : cheap };
    return llm;
  }
  const step = plan[Math.min(plan.length, Math.max(1, attempt)) - 1];
  return withModel(llm, step.provider, step.model, { tier: step.tier });
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
  const text = await fn({ system: "", user: 'Faqat JSON qaytar: {"ok":true}', apiKey, model, maxTokens: 64, provider });
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
  CASCADE_MODES,
  PROVIDERS,
  providerModel,
  providerCheapModel,
  setProviderAlertHandler,
  isCreditError,
  resetProviderState,
  providerOrder,
  isOpenAIReasoningModel,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
};
