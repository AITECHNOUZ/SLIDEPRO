// src/generator/anthropic.js
// Anthropic (Claude) backend — system+user promptdan matn qaytaradi.

const API_URL = "https://api.anthropic.com/v1/messages";

async function generate({ system, user, apiKey, model, maxTokens }) {
  if (!apiKey) throw new Error("Anthropic API kaliti yo'q (ANTHROPIC_API_KEY).");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: maxTokens || 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic xatosi (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

module.exports = { generate };
