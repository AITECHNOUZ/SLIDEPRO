// src/generator/openai.js
// OpenAI backend — yagona LLM klienti orqali (src/llm/client.js).
// JSON rejimi (response_format) yoqilgan, shuning uchun toza JSON keladi.

const { complete } = require("../llm/client");

async function generate({ system, user, apiKey, model, maxTokens }) {
  if (!apiKey) throw new Error("OpenAI API kaliti yo'q (OPENAI_API_KEY).");
  const { text } = await complete({
    system, user, maxTokens: maxTokens || 8000,
    llm: { provider: "openai", openaiKey: apiKey, openaiModel: model },
  });
  return text;
}

module.exports = { generate };
