// Asosiy model 3 marta javob bermasa zaxira modellarga o'tish
const test = require("node:test");
const assert = require("node:assert/strict");
const client = require("../src/llm/client");
const { RateLimiter, resetSharedLimiter } = require("../src/llm/rate-limiter");

const calls = [];
function server(behaviour) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    const mode = behaviour[body.model] || "ok";
    if (mode === "error") return new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } }), { status: 400 });
    const text = mode === "broken" ? "bu JSON emas" : "{\"ok\":true}";
    return url.includes("anthropic")
      ? new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
      : new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: 200 });
  };
}
const llm = { provider: "anthropic", anthropicKey: "a", openaiKey: "o", anthropicModel: "claude-sonnet-5-5", openaiModel: "gpt-5-mini" };
const validate = text => { const v = JSON.parse(text); if (!v.ok) throw new Error("yaroqsiz"); return v; };

async function withServer(behaviour, fn) {
  resetSharedLimiter(new RateLimiter({ requests: 1e5, input: 1e9, output: 1e9 }));
  client.resetProviderState();
  const real = global.fetch;
  process.env.LLM_STRICT_PROVIDER = "1"; process.env.ANTHROPIC_FALLBACK_MODEL = "off";
  global.fetch = server(behaviour); calls.length = 0;
  try { return await fn(); }
  finally { global.fetch = real; delete process.env.LLM_STRICT_PROVIDER; delete process.env.ANTHROPIC_FALLBACK_MODEL; resetSharedLimiter(null); }
}

test("standart zaxira zanjiri: boshqa provayder, keyin boshqa modellar; kalitsizlari tushib qoladi", () => {
  assert.deepEqual(client.fallbackChain(llm).map(c => c.provider + ":" + c.model),
    ["openai:gpt-5-mini", "anthropic:claude-opus-5-5", "openai:gpt-5", "anthropic:claude-haiku-5-5"]);
  // DeepSeek va GLM kaliti bo'lsa — zanjir oxirida
  assert.deepEqual(client.fallbackChain({ ...llm, deepseekKey: "d", zaiKey: "z", maxFallbacks: 6 }).map(c => c.provider + ":" + c.model),
    ["openai:gpt-5-mini", "anthropic:claude-opus-5-5", "openai:gpt-5", "deepseek:deepseek-v4-pro", "zai:glm-5.3", "anthropic:claude-haiku-5-5"]);
  assert.deepEqual(client.parseFallbackModels("glm:glm-5.3-flash, deepseek:deepseek-flash"), [{ provider: "zai", model: "glm-5.3-flash" }, { provider: "deepseek", model: "deepseek-flash" }]);
  assert.deepEqual(client.fallbackChain({ ...llm, openaiKey: "" }).map(c => c.model), ["claude-opus-5-5", "claude-haiku-5-5"]);
  assert.deepEqual(client.fallbackChain({ ...llm, fallbackModels: "openai:gpt-5, anthropic:claude-haiku-5-5" }).map(c => c.model), ["gpt-5", "claude-haiku-5-5"]);
  assert.deepEqual(client.fallbackChain({ ...llm, fallbackModels: "off" }), []);
});

test("javob formati 3 marta buzilsa — zaxira modeldan olinadi va ishning qolgani o'sha modelda davom etadi", async () => {
  await withServer({ "claude-sonnet-5-5": "broken" }, () => client.runWithFallback(async () => {
    const r = await client.completeValidated({ system: "s", user: "u", llm, attempts: 1, validate });
    assert.deepEqual(r.value, { ok: true });
    assert.equal(calls.filter(m => m === "claude-sonnet-5-5").length, 3, "asosiy model 3 marta sinaldi");
    assert.equal(calls[calls.length - 1], "gpt-5-mini");
    calls.length = 0;
    await client.completeValidated({ system: "s", user: "u", llm, attempts: 1, validate });
    assert.deepEqual(calls, ["gpt-5-mini"], "keyingi so'rov to'g'ridan-to'g'ri zaxira modelga");
    assert.ok(client.fallbackState().switches.length >= 1);
  }));
});

test("API xatosi: asosiy va birinchi zaxira yiqilsa ikkinchi zaxiraga o'tadi", async () => {
  await withServer({ "claude-sonnet-5-5": "error", "gpt-5-mini": "error" }, async () => {
    const r = await client.completeValidated({ system: "s", user: "u", llm, attempts: 2, validate });
    assert.deepEqual(r.value, { ok: true });
    assert.equal(calls[calls.length - 1], "claude-opus-5-5");
  });
});

test("oddiy complete() chaqiruvlari ham ketma-ket 3 xatodan keyin zaxiraga o'tadi", async () => {
  await withServer({ "claude-sonnet-5-5": "error" }, () => client.runWithFallback(async () => {
    for (let i = 0; i < 3; i++) await assert.rejects(client.complete({ system: "s", user: "u", llm }));
    const r = await client.complete({ system: "s", user: "u", llm });
    assert.equal(r.model, "gpt-5-mini");
  }));
});

test("hamma model ishlamasa — oxirgi xato qaytadi (cheksiz aylanmaydi)", async () => {
  await withServer({ "claude-sonnet-5-5": "error", "gpt-5-mini": "error", "claude-opus-5-5": "error", "gpt-5": "error", "claude-haiku-5-5": "error" }, async () => {
    await assert.rejects(client.completeValidated({ system: "s", user: "u", llm, attempts: 1, validate }));
    assert.ok(calls.length <= 10, "chaqiruvlar soni cheklangan: " + calls.length);
  });
});

test("DeepSeek va GLM: OpenAI mos format, to'g'ri manzil, max_tokens va GLM thinking o'chirilgan", async () => {
  const seen = [];
  resetSharedLimiter(new RateLimiter({ requests: 1e5, input: 1e9, output: 1e9 }));
  client.resetProviderState();
  const real = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    seen.push({ url, body, auth: options.headers.authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
  };
  process.env.LLM_STRICT_PROVIDER = "1";
  try {
    const d = await client.complete({ system: "s", user: "u", maxTokens: 50000, llm: { provider: "deepseek", deepseekKey: "dk" } });
    assert.equal(d.provider, "deepseek"); assert.equal(d.model, "deepseek-v4-pro");
    const z = await client.complete({ system: "s", user: "u", llm: { provider: "zai", zaiKey: "zk", zaiModel: "glm-5.3-flash" } });
    assert.equal(z.model, "glm-5.3-flash");
    assert.equal(seen[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(seen[0].auth, "Bearer dk");
    assert.equal(seen[0].body.max_tokens, 32000);
    assert.equal(seen[0].body.max_completion_tokens, undefined);
    assert.equal(seen[0].body.response_format.type, "json_object");
    assert.equal(seen[1].url, "https://api.z.ai/api/paas/v4/chat/completions");
    assert.deepEqual(seen[1].body.thinking, { type: "disabled" });
    // kaskad: arzon DeepSeek Flash 2 marta, keyin Claude
    const plan = client.cascadePlan({ provider: "claude_deepseek", anthropicKey: "a", deepseekKey: "d" });
    assert.deepEqual(plan.map(p => p.provider + ":" + p.model), ["deepseek:deepseek-flash", "deepseek:deepseek-flash", "anthropic:claude-sonnet-5-5"]);
    assert.deepEqual(client.cascadePlan({ provider: "claude_glm", anthropicKey: "a", zaiKey: "z" }).map(p => p.model), ["glm-5.3-flash", "glm-5.3-flash", "claude-sonnet-5-5"]);
  } finally { global.fetch = real; delete process.env.LLM_STRICT_PROVIDER; resetSharedLimiter(null); }
});
