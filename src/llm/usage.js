// src/llm/usage.js
// Har bir buyurtma bo'yicha haqiqiy token sarfi va taxminiy narxini hisoblash (AsyncLocalStorage orqali).
const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

// $ / 1M token: [kirish, chiqish]. Yangi model narxini env orqali qo'shish: PRICE_<model>=kirish,chiqish
const PRICES = [
  [/haiku-5-5/, 0.10, 0.50], [/sonnet-5-5/, 2, 10], [/opus-5-5/, 4, 20],
  [/sonnet-5(?!-5)/, 2, 10], [/opus-5(?!-5)/, 5, 25], [/haiku-4-5/, 1, 5], [/sonnet-4/, 3, 15], [/opus-4/, 5, 25],
  [/gpt-5-nano/, 0.05, 0.40], [/gpt-5-mini/, 0.25, 2], [/^gpt-5$/, 1.25, 10], [/gpt-4o-mini/, 0.15, 0.60], [/gpt-4\.1-mini/, 0.40, 1.60], [/gpt-4\.1-nano/, 0.10, 0.40],
];

function priceFor(model) {
  const env = process.env[`PRICE_${String(model).replace(/[^A-Za-z0-9]/g, "_")}`];
  if (env) {
    const [input, output] = env.split(",").map(Number);
    if (Number.isFinite(input) && Number.isFinite(output)) return { input, output };
  }
  const hit = PRICES.find(([re]) => re.test(String(model || "")));
  return hit ? { input: hit[1], output: hit[2] } : null;
}

function trackUsage(fn) {
  const usage = { calls: 0, input: 0, output: 0, cost: 0, unknownModels: new Set(), byModel: {} };
  return storage.run(usage, fn).then(result => ({ result, usage }), error => { error.usage = usage; throw error; });
}

function recordUsage(model, input = 0, output = 0) {
  const usage = storage.getStore();
  if (!usage) return;
  usage.calls += 1;
  usage.input += input;
  usage.output += output;
  const row = usage.byModel[model] || (usage.byModel[model] = { calls: 0, input: 0, output: 0 });
  row.calls += 1; row.input += input; row.output += output;
  const price = priceFor(model);
  if (price) usage.cost += (input * price.input + output * price.output) / 1e6;
  else usage.unknownModels.add(model);
}

function formatUsage(usage) {
  if (!usage || !usage.calls) return "";
  const models = Object.entries(usage.byModel).map(([model, row]) => `${model}: ${row.calls} so'rov`).join(", ");
  const unknown = usage.unknownModels.size ? ` (narxi noma'lum: ${[...usage.unknownModels].join(", ")})` : "";
  return `🔢 ${usage.input.toLocaleString("en")} kirish / ${usage.output.toLocaleString("en")} chiqish token · ≈ $${usage.cost.toFixed(3)}${unknown}\n${models}`;
}

module.exports = { trackUsage, recordUsage, formatUsage, priceFor };
