const crypto = require("crypto");

// Include every field that changes the generated document. Cache hits must never
// return a document created in a different language or for another student.
function buildCacheKey(order) {
  const workType = order.work_type || "taqdimot";
  const payload = {
    version: 2,
    workType,
    topic: String(order.topic || "").trim().toLocaleLowerCase().replace(/\s+/g, " "),
    count: workType === "mustaqil" ? (order.pages || null) : (order.slides || null),
    language: order.language || "o'zbek",
    studentName: order.student_name || "",
    studentGroup: order.student_group || "",
    content: order.content_text || "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function retryDelay(error, attempt) {
  const seconds = Number(error?.parameters?.retry_after ?? error?.error?.parameters?.retry_after);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  return Math.min(250 * (2 ** attempt), 2_000);
}

function isRetryableTelegramError(error) {
  const code = Number(error?.error_code ?? error?.error?.error_code);
  // Network errors have no Telegram error_code; retry those as well as rate
  // limits and server errors. Invalid requests/blocked users are permanent.
  return !Number.isFinite(code) || code === 429 || code >= 500;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendDocumentWithRetry(api, chatId, document, options, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await api.sendDocument(chatId, document, options);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !isRetryableTelegramError(error)) throw error;
      await sleep(retryDelay(error, attempt));
    }
  }
  throw lastError;
}

module.exports = { buildCacheKey, isRetryableTelegramError, sendDocumentWithRetry };
