const test = require("node:test");
const assert = require("node:assert/strict");
const { formulaComplexity, complexityLevel, assignFormulaComplexity, fallbackFormula, FALLBACK_FORMULAS } = require("../src/mustaqil/formula-complexity");
const { latexToOmml } = require("../src/mustaqil/omml");
const { providerOrder } = require("../src/llm/client");
const { withRetries } = require("../src/payments/fulfill");

test("formula murakkabligi: integral/hosila murakkab, bitta kasr o'rtacha, P=UI sodda", () => {
  assert.equal(complexityLevel("u(t)=K_p e(t)+\\frac{K_p}{T_i}\\int_0^t e(\\tau)\\,d\\tau+K_p T_d\\frac{de(t)}{dt}"), "complex");
  assert.equal(complexityLevel("\\lambda=\\frac{V_h}{V_0}"), "medium");
  assert.equal(complexityLevel("P=UI"), "simple");
  assert.ok(formulaComplexity("") === 0);
});

test("formula slotlaridan aynan bittasi murakkab, qolgani o'rtacha", () => {
  const slots = [
    { slot_id: "a", plan: { latex: "", concept: "x" } },
    { slot_id: "b", plan: { latex: "", concept: "y" } },
    { slot_id: "c", plan: { latex: "", concept: "z" } },
    { slot_id: "d", plan: { latex: "", concept: "w" } },
  ];
  assignFormulaComplexity(slots);
  assert.equal(slots.filter(slot => slot.complexity === "complex").length, 1);
  assert.equal(slots.filter(slot => slot.complexity === "medium").length, 3);
  const planned = [{ plan: { latex: "\\lambda=\\frac{V_h}{V_0}" } }, { plan: { latex: "\\frac{dT}{dt}=\\frac{1}{C}\\left(Q_{k}-\\alpha F\\left(T-T_0\\right)\\right)" } }];
  assignFormulaComplexity(planned);
  assert.equal(planned[1].complexity, "complex", "rejadagi eng murakkab formula murakkab deb belgilanadi");
});

test("zaxira formulalar banki: OMML'ga o'giriladi, daraja mos va takrorlanmaydi", () => {
  for (const item of FALLBACK_FORMULAS) assert.doesNotThrow(() => latexToOmml(item.latex, { display: true }), item.latex);
  assert.equal(complexityLevel(fallbackFormula({ complexity: "complex" }, "o'zbek").latex), "complex");
  const medium = [0, 1, 2, 3].map(index => fallbackFormula({ complexity: "medium", formulaIndex: index }, "o'zbek").latex);
  assert.equal(new Set(medium).size, 4);
  assert.match(fallbackFormula({ complexity: "medium" }, "rus tili").caption, /[а-я]/);
});

test("LLM provayderi yiqilsa ikkinchi kalit zaxira bo'ladi (LLM_STRICT_PROVIDER bilan o'chadi)", () => {
  const cfg = { anthropicKey: "a", openaiKey: "o" };
  assert.deepEqual(providerOrder("anthropic", cfg), ["anthropic", "openai"]);
  assert.deepEqual(providerOrder("anthropic", { anthropicKey: "a" }), ["anthropic"]);
  process.env.LLM_STRICT_PROVIDER = "1";
  try { assert.deepEqual(providerOrder("anthropic", cfg), ["anthropic"]); } finally { delete process.env.LLM_STRICT_PROVIDER; }
});

test("buyurtma generatsiyasi xato bo'lsa avtomatik qayta urinadi", async () => {
  process.env.FULFILL_RETRY_DELAY_MS = "0";
  try {
    let calls = 0;
    const retries = [];
    const result = await withRetries(async () => { if (++calls < 3) throw new Error("overloaded"); return "ok"; }, { orderId: 1, onRetry: attempt => retries.push(attempt) });
    assert.equal(result, "ok");
    assert.deepEqual(retries, [1, 2]);
    await assert.rejects(withRetries(async () => { throw new Error("doim xato"); }, { orderId: 2 }), /doim xato/);
  } finally { delete process.env.FULFILL_RETRY_DELAY_MS; }
});
