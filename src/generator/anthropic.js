// src/generator/anthropic.js
// Anthropic (Claude) backend — yagona LLM klienti orqali (src/llm/client.js).

const { complete } = require("../llm/client");

async function generate({ system, user, apiKey, model, maxTokens }) {
  if (!apiKey) throw new Error("Anthropic API kaliti yo'q (ANTHROPIC_API_KEY).");
  const { text } = await complete({
    system, user, maxTokens: maxTokens || 8000,
    llm: { provider: "anthropic", anthropicKey: apiKey, anthropicModel: model },
  });
  return text;
}

module.exports = { generate };
