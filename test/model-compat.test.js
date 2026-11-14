// Turli modellar bilan so'rov formati to'g'riligini tekshirish: real API qoidalarini taqlid qiluvchi soxta server
const test = require("node:test");
const assert = require("node:assert/strict");
const { complete, resetProviderState } = require("../src/llm/client");
const { RateLimiter, resetSharedLimiter } = require("../src/llm/rate-limiter");

const OPENAI_RULES = {
  // model: [maks chiqish, reasoning (temperature taqiqlangan)]
  "gpt-5": [128000, true], "gpt-5-mini": [128000, true], "gpt-5-nano": [128000, true], "o4-mini": [100000, true],
  "gpt-4.1": [32768, false], "gpt-4.1-mini": [32768, false], "gpt-4o": [16384, false], "gpt-4o-mini": [16384, false],
};
const ANTHROPIC_RULES = {
  "claude-sonnet-5-5": 64000, "claude-opus-5-5": 32000, "claude-haiku-5-5": 64000,
  "claude-3-5-haiku-20241022": 8192, "claude-3-haiku-20240307": 4096,
};

function fakeServer(url, options) {
  const body = JSON.parse(options.body);
  if (url.includes("anthropic")) {
    const cap = ANTHROPIC_RULES[body.model];
    if (!cap) return new Response(JSON.stringify({ error: { type: "not_found_error", message: `model: ${body.model}` } }), { status: 404 });
    if (body.max_tokens > cap) return new Response(JSON.stringify({ error: { type: "invalid_request_error", message: `max_tokens: ${body.max_tokens} > ${cap}` } }), { status: 400 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  }
  const rule = OPENAI_RULES[body.model];
  if (!rule) return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
  const [cap, reasoning] = rule;
  if (body.max_tokens !== undefined) return new Response(JSON.stringify({ error: { message: "use max_completion_tokens" } }), { status: 400 });
  if (body.max_completion_tokens > cap) return new Response(JSON.stringify({ error: { message: "max_completion_tokens too large" } }), { status: 400 });
  if (reasoning && body.temperature !== undefined) return new Response(JSON.stringify({ error: { message: "temperature unsupported" } }), { status: 400 });
  if (!reasoning && body.reasoning_effort !== undefined) return new Response(JSON.stringify({ error: { message: "reasoning_effort unsupported" } }), { status: 400 });
  return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }] }), { status: 200 });
}

test("barcha mashhur Claude va OpenAI modellari bilan so'rov formati to'g'ri (katta max_tokens ham)", async () => {
  resetSharedLimiter(new RateLimiter({ requests: 1e5, input: 1e9, output: 1e9 }));
  resetProviderState();
  const realFetch = global.fetch;
  process.env.LLM_STRICT_PROVIDER = "1";
  process.env.ANTHROPIC_FALLBACK_MODEL = "off";
  global.fetch = fakeServer;
  try {
    for (const model of Object.keys(ANTHROPIC_RULES)) {
      const r = await complete({ system: "s", user: "u", maxTokens: 20000, llm: { provider: "anthropic", anthropicKey: "k", anthropicModel: model } });
      assert.equal(r.text, "{\"ok\":true}", model);
    }
    for (const model of Object.keys(OPENAI_RULES)) {
      const r = await complete({ system: "s", user: "u", maxTokens: 20000, llm: { provider: "openai", openaiKey: "k", openaiModel: model } });
      assert.equal(r.text, "{\"ok\":true}", model);
    }
  } finally {
    global.fetch = realFetch;
    delete process.env.LLM_STRICT_PROVIDER;
    delete process.env.ANTHROPIC_FALLBACK_MODEL;
    resetSharedLimiter(null);
  }
});

test("buyurtma bo'yicha token sarfi va narx hisoblanadi", async () => {
  const { trackUsage, formatUsage, priceFor } = require("../src/llm/usage");
  const { recordUsage } = require("../src/llm/usage");
  assert.deepEqual(priceFor("claude-sonnet-5-5"), { input: 2, output: 10 });
  assert.deepEqual(priceFor("gpt-5-mini"), { input: 0.25, output: 2 });
  const { usage } = await trackUsage(async () => {
    recordUsage("claude-sonnet-5-5", 100000, 50000);
    await new Promise(resolve => setTimeout(resolve, 5));
    recordUsage("claude-haiku-5-5", 1000000, 0);
  });
  assert.equal(usage.calls, 2);
  assert.ok(Math.abs(usage.cost - (0.2 + 0.5 + 0.1)) < 1e-9);
  assert.match(formatUsage(usage), /\$0\.800/);
});
