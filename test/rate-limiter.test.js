const test = require("node:test");
const assert = require("node:assert/strict");
const { RateLimiter, estimateTokens, resetSharedLimiter } = require("../src/llm/rate-limiter");

function fakeClock() {
  let t = 0;
  return { now: () => t, sleepFn: async ms => { t += ms; }, advance: ms => { t += ms; } };
}

test("token bucket chiqish limitidan oshmaydi: 8000 OTPM da 6000 tokenli 3 so'rov ~1 daqiqaga taqsimlanadi", async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ requests: 50, input: 30_000, output: 8_000 }, { ...clock, safety: 1 });
  const times = [];
  for (let i = 0; i < 3; i++) { await limiter.acquire({ input: 2000, output: 6000 }); times.push(clock.now()); }
  assert.equal(times[0], 0);
  assert.ok(times[1] >= 30_000, `2-so'rov kutishi kerak (${times[1]})`);
  assert.ok(times[2] - times[1] >= 44_000, "3-so'rov ham kutadi");
});

test("haqiqiy sarf qaytarilgach keyingi so'rov tezroq ketadi; sarlavhadan tier o'qiladi", async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ requests: 50, input: 30_000, output: 8_000 }, { ...clock, safety: 1 });
  const reserved = await limiter.acquire({ input: 1000, output: 6000 });
  limiter.settle(reserved, { input: 1000, output: 1500 });
  await limiter.acquire({ input: 1000, output: 6000 });
  assert.ok(clock.now() < 5_000, "refunddan keyin deyarli kutmaydi");
  const headers = new Map([["anthropic-ratelimit-output-tokens-limit", "16000"], ["anthropic-ratelimit-output-tokens-remaining", "16000"]]);
  limiter.updateFromHeaders({ get: key => headers.get(key) ?? null });
  assert.equal(limiter.maxOutputTokens(), 16_000, "Tier 2 limiti avtomatik o'qiladi");
});

test("bucket hajmidan katta so'rov abadiy kutmaydi; pause hamma so'rovni to'xtatadi", async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ requests: 50, input: 30_000, output: 8_000 }, { ...clock, safety: 1 });
  await limiter.acquire({ input: 100, output: 50_000 });
  limiter.pause(10_000);
  const before = clock.now();
  await limiter.acquire({ input: 10, output: 10 });
  assert.ok(clock.now() - before >= 10_000);
  assert.ok(estimateTokens("salom dunyo") > 0 && estimateTokens("привет мир") > estimateTokens("salom dun"));
});

test("Claude klienti: 529 da zaxira modelga, balans tugasa OpenAI'ga o'tadi va admin ogohlantiriladi", async () => {
  const { complete, setProviderAlertHandler } = require("../src/llm/client");
  resetSharedLimiter(new RateLimiter({ requests: 1000, input: 1e7, output: 1e6 }));
  const realFetch = global.fetch;
  process.env.LLM_RETRIES = "1";
  const seenModels = [];
  const alerts = [];
  setProviderAlertHandler(text => alerts.push(text));
  try {
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.includes("anthropic")) {
        seenModels.push(body.model);
        if (body.model === "claude-sonnet-5-5") return new Response("{\"error\":{\"type\":\"overloaded_error\"}}", { status: 529 });
        return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":1}" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":2}" }, finish_reason: "stop" }] }), { status: 200 });
    };
    const first = await complete({ system: "s", user: "u", llm: { provider: "anthropic", anthropicKey: "k", openaiKey: "o" } });
    assert.equal(first.text, "{\"ok\":1}");
    assert.deepEqual(seenModels, ["claude-sonnet-5-5", "claude-haiku-5-5"]);

    global.fetch = async url => url.includes("anthropic")
      ? new Response("{\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Your credit balance is too low\"}}", { status: 400 })
      : new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":2}" }, finish_reason: "stop" }] }), { status: 200 });
    const second = await complete({ system: "s", user: "u", llm: { provider: "anthropic", anthropicKey: "k", openaiKey: "o" } });
    assert.equal(second.provider, "openai");
    assert.ok(alerts.some(text => /balansi tugadi/.test(text)));
  } finally {
    global.fetch = realFetch;
    delete process.env.LLM_RETRIES;
    setProviderAlertHandler(null);
    resetSharedLimiter(null);
  }
});

test("kaskad: arzon model 2 marta yaroqsiz javob bersa qimmat modelga o'tadi", async () => {
  const { completeValidated, cascadePlan, llmForAttempt, attemptsFor, resetProviderState } = require("../src/llm/client");
  resetProviderState();
  resetSharedLimiter(new RateLimiter({ requests: 1000, input: 1e7, output: 1e6 }));
  const realFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const model = body.model;
      calls.push(model);
      const text = model === "claude-haiku-5-5" ? "kechirasiz, JSON emas" : "{\"ok\":true}";
      if (url.includes("anthropic")) return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: model === "gpt-5-mini" ? "buzuq" : "{\"ok\":true}" }, finish_reason: "stop" }] }), { status: 200 });
    };
    const llm = { provider: "claude_claude", anthropicKey: "k", anthropicModel: "claude-sonnet-5-5" };
    assert.equal(attemptsFor(llm, 1), 3);
    assert.equal(llmForAttempt(llm, 1).anthropicModel, "claude-haiku-5-5");
    assert.equal(llmForAttempt(llm, 3).anthropicModel, "claude-sonnet-5-5");
    const result = await completeValidated({ system: "s", user: "u", llm, validate: text => JSON.parse(text) });
    assert.deepEqual(result.value, { ok: true });
    assert.deepEqual(calls, ["claude-haiku-5-5", "claude-haiku-5-5", "claude-sonnet-5-5"]);

    calls.length = 0;
    const mixed = { provider: "claude_openai", anthropicKey: "k", openaiKey: "o", anthropicModel: "claude-sonnet-5-5" };
    assert.equal(cascadePlan(mixed)[0].provider, "openai");
    const second = await completeValidated({ system: "s", user: "u", llm: mixed, validate: text => JSON.parse(text) });
    assert.equal(second.provider, "anthropic");
    assert.deepEqual(calls, ["gpt-5-mini", "gpt-5-mini", "claude-sonnet-5-5"]);

    // Arzon model birinchi urinishda to'g'ri javob bersa qimmat model chaqirilmaydi
    calls.length = 0;
    global.fetch = async () => new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":1}" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
    const cheapOk = await completeValidated({ system: "s", user: "u", llm, validate: text => JSON.parse(text) });
    assert.equal(cheapOk.tier, "cheap");
  } finally {
    global.fetch = realFetch;
    resetSharedLimiter(null);
  }
});

test("rate-limit sarlavhalari bo'lmasa limit nolga tushmaydi", () => {
  const limiter = new RateLimiter({ requests: 50, input: 30_000, output: 8_000 }, { safety: 1 });
  limiter.updateFromHeaders({ get: () => null });
  assert.equal(limiter.maxOutputTokens(), 8000);
  assert.ok(limiter.tokens.output > 7000 && limiter.tokens.requests > 40);
});
