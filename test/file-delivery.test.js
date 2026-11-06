const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCacheKey, sendDocumentWithRetry, isRetryableTelegramError } = require("../src/payments/delivery-utils");

test("file cache key distinguishes every document-affecting field", () => {
  const base = {
    work_type: "mustaqil", topic: "Sinov mavzusi", pages: 15, language: "o'zbek",
    student_name: "Ali Valiyev", student_group: "AT-22", content_text: "Asosiy matn",
  };
  const key = buildCacheKey(base);
  assert.equal(buildCacheKey({ ...base, topic: "  Sinov   mavzusi " }), key, "mavzu bo'shliqlari normallashtiriladi");
  for (const change of [
    { language: "rus" }, { student_name: "Vali Aliyev" }, { student_group: "AT-23" },
    { pages: 20 }, { content_text: "Boshqa matn" }, { work_type: "taqdimot" },
  ]) {
    assert.notEqual(buildCacheKey({ ...base, ...change }), key);
  }
});

test("document delivery retries network errors and returns the successful Telegram response", async () => {
  let calls = 0;
  const expected = { document: { file_id: "tg-file" } };
  const api = { async sendDocument() {
    calls++;
    if (calls < 3) throw new Error("network timeout");
    return expected;
  } };
  assert.equal(await sendDocumentWithRetry(api, 42, "file", {}, { attempts: 3 }), expected);
  assert.equal(calls, 3);
});

test("document delivery does not retry permanent Telegram errors", async () => {
  let calls = 0;
  const api = { async sendDocument() {
    calls++;
    const error = new Error("bot was blocked by the user");
    error.error_code = 403;
    throw error;
  } };
  await assert.rejects(sendDocumentWithRetry(api, 42, "file", {}, { attempts: 3 }), /blocked/);
  assert.equal(calls, 1);
  assert.equal(isRetryableTelegramError({ error_code: 500 }), true);
  assert.equal(isRetryableTelegramError({ error_code: 400 }), false);
});
