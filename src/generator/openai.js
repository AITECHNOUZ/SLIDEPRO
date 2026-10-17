// src/generator/openai.js
// OpenAI backend — system+user promptdan matn qaytaradi (Chat Completions).
// JSON rejimi (response_format) yoqilgan, shuning uchun toza JSON keladi.

const API_URL = "https://api.openai.com/v1/chat/completions";

async function generate({ system, user, apiKey, model, maxTokens }) {
  if (!apiKey) throw new Error("OpenAI API kaliti yo'q (OPENAI_API_KEY).");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-5-nano",
      // Use `max_completion_tokens` for newer OpenAI models that reject `max_tokens`.
      max_completion_tokens: maxTokens || 8000,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI xatosi (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  return (msg && msg.content ? msg.content : "").trim();
}

module.exports = { generate };