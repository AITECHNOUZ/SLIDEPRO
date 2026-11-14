// src/llm/rate-limiter.js
// Anthropic API uchun mijoz tomonidagi "token bucket" cheklagich.
//
// Nega kerak: Tier 1 (kichik balans) da limitlar juda past — Sonnet uchun taxminan
// 50 so'rov/daq, 30 000 kirish tokeni/daq, 8 000 chiqish tokeni/daq. Anthropic chiqish limitini
// so'rov boshida max_tokens bo'yicha band qiladi, shuning uchun 3 ta bobni parallel
// (har biri max_tokens=6000) yuborish darhol 429 beradi. Bu modul so'rovlarni limitga
// sig'adigan qilib navbatga qo'yadi: 429 umuman bo'lmasligi kerak, bo'lsa ham kam.
//
// Limitlar javob sarlavhalaridan (anthropic-ratelimit-*) avtomatik o'qiladi — balans
// oshib Tier 2+ ga o'tsangiz, kod o'zgarmasdan tezlashadi.

const DIMENSIONS = ["requests", "input", "output"];

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Tier 1 uchun ehtiyotkor boshlang'ich qiymatlar (haqiqiy limitlar birinchi javobdan o'qiladi)
function defaultLimits() {
  return {
    requests: numberEnv("ANTHROPIC_RPM", 45),
    input: numberEnv("ANTHROPIC_ITPM", 27_000),
    output: numberEnv("ANTHROPIC_OTPM", 7_500),
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class RateLimiter {
  constructor(limits = defaultLimits(), { now = () => Date.now(), sleepFn = sleep, safety = 0.92 } = {}) {
    this.now = now;
    this.sleep = sleepFn;
    this.safety = safety; // limitning 92% idan foydalanamiz — boshqa jarayonlar va noaniqlik uchun zaxira
    this.capacity = {};
    this.tokens = {};
    this.updated = now();
    this.pausedUntil = 0;
    this.queue = Promise.resolve();
    for (const dim of DIMENSIONS) {
      this.capacity[dim] = limits[dim] * safety;
      this.tokens[dim] = this.capacity[dim];
    }
  }

  refill() {
    const now = this.now();
    const elapsed = Math.max(0, now - this.updated);
    this.updated = now;
    for (const dim of DIMENSIONS) {
      this.tokens[dim] = Math.min(this.capacity[dim], this.tokens[dim] + elapsed * this.capacity[dim] / 60_000);
    }
  }

  // Bitta so'rov sig'adigan eng katta qiymat (bucket hajmidan oshsa — kutish abadiy bo'lardi)
  clamp(dim, amount) {
    return Math.min(Math.max(0, amount), this.capacity[dim]);
  }

  maxOutputTokens() {
    return Math.floor(this.capacity.output);
  }

  // So'rov uchun joy band qilish. Navbat FIFO: oldin kelgan so'rov oldin ketadi.
  acquire({ input = 0, output = 0 } = {}) {
    const need = { requests: 1, input: this.clamp("input", input), output: this.clamp("output", output) };
    const run = async () => {
      for (;;) {
        this.refill();
        const now = this.now();
        let wait = Math.max(0, this.pausedUntil - now);
        for (const dim of DIMENSIONS) {
          const missing = need[dim] - this.tokens[dim];
          if (missing > 0) wait = Math.max(wait, Math.ceil(missing / (this.capacity[dim] / 60_000)));
        }
        if (wait <= 0) {
          for (const dim of DIMENSIONS) this.tokens[dim] -= need[dim];
          return need;
        }
        await this.sleep(Math.min(wait + 25, 65_000));
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  // Javobdan keyin: band qilingan va haqiqiy sarf farqini qaytarish (yoki yechish)
  settle(reserved, actual = {}) {
    this.refill();
    for (const dim of ["input", "output"]) {
      if (!Number.isFinite(actual[dim])) continue;
      const delta = (reserved[dim] || 0) - actual[dim];
      this.tokens[dim] = Math.min(this.capacity[dim], this.tokens[dim] + delta);
    }
  }

  // 429 / 529: barcha so'rovlar to'xtatiladi
  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + Math.max(0, ms));
  }

  // anthropic-ratelimit-* sarlavhalaridan haqiqiy limit va qoldiqni o'qish
  updateFromHeaders(headers) {
    if (!headers || typeof headers.get !== "function") return;
    const map = { requests: "requests", input: "input-tokens", output: "output-tokens" };
    this.refill();
    for (const [dim, name] of Object.entries(map)) {
      const limit = Number(headers.get(`anthropic-ratelimit-${name}-limit`));
      const remaining = Number(headers.get(`anthropic-ratelimit-${name}-remaining`));
      if (Number.isFinite(limit) && limit > 0) {
        const capacity = limit * this.safety;
        if (Math.abs(capacity - this.capacity[dim]) > 1) {
          // Tier o'zgardi (yoki birinchi o'lchov) — bucket hajmi moslashtiriladi
          const ratio = this.tokens[dim] / this.capacity[dim];
          this.capacity[dim] = capacity;
          this.tokens[dim] = capacity * Math.min(1, Math.max(0, ratio));
        }
      }
      if (Number.isFinite(remaining) && remaining >= 0) {
        this.tokens[dim] = Math.min(this.tokens[dim], remaining * this.safety);
      }
    }
  }
}

// Kirish tokenlarini taxminlash: lotin o'zbek ~3 belgi/token, kirill ~2,2 belgi/token
function estimateTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  const cyrillic = (value.match(/[Ѐ-ӿ]/g) || []).length;
  return Math.ceil(cyrillic / 2.2 + (value.length - cyrillic) / 3);
}

// Model sinfi bo'yicha alohida cheklagichlar (Anthropic limitlari model sinfiga qarab alohida)
const shared = new Map();
let override = null;
function sharedLimiter(key = "default") {
  if (override) return override;
  if (!shared.has(key)) shared.set(key, new RateLimiter());
  return shared.get(key);
}
function resetSharedLimiter(limiter = null) {
  override = limiter;
  shared.clear();
}

module.exports = { RateLimiter, estimateTokens, sharedLimiter, resetSharedLimiter, defaultLimits };
