const test = require("node:test");
const assert = require("node:assert/strict");
const { postJsonWithRetry } = require("../src/mustaqil/llm-http");

function response(status, body, extraHeaders = {}) {
  const headers = new Map(Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => headers.get(String(key).toLowerCase()) || null },
    text: async () => body,
  };
}

test("LLM 429 vaqtinchalik javobidan keyin bir marta qayta urunadi", async () => {
  let calls = 0;
  const result = await postJsonWithRetry("https://example.test", { method: "POST" }, "Mock LLM", async (_url, options) => {
    calls++;
    assert.ok(options.signal instanceof AbortSignal);
    return calls === 1
      ? response(429, "rate limited", { "retry-after": "0" })
      : response(200, '{"ok":true}');
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("LLM doimiy 401 xatosini takrorlamaydi", async () => {
  let calls = 0;
  await assert.rejects(
    postJsonWithRetry("https://example.test", { method: "POST" }, "Mock LLM", async () => {
      calls++;
      return response(401, "unauthorized");
    }),
    /Mock LLM 401: unauthorized/,
  );
  assert.equal(calls, 1);
});

test("LLM noto‘g‘ri JSON javobini takrorlamasdan xato qiladi", async () => {
  let calls = 0;
  await assert.rejects(
    postJsonWithRetry("https://example.test", { method: "POST" }, "Mock LLM", async () => {
      calls++;
      return response(200, "not json");
    }),
    /yaroqli JSON emas/,
  );
  assert.equal(calls, 1);
});
