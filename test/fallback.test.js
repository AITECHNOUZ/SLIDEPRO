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
    ["openai:gpt-5-mini", "anthropic:claude-opus-5-5", "openai:gpt-5"]);
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
  await withServer({ "claude-sonnet-5-5": "error", "gpt-5-mini": "error", "claude-opus-5-5": "error", "gpt-5": "error" }, async () => {
    await assert.rejects(client.completeValidated({ system: "s", user: "u", llm, attempts: 1, validate }));
    assert.ok(calls.length <= 10, "chaqiruvlar soni cheklangan: " + calls.length);
  });
});
