const LLM_REQUEST_TIMEOUT_MS = 90_000;
const LLM_RETRY_LIMIT = 2;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function getRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const requestedMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(requestedMs)) return Math.max(0, Math.min(requestedMs, 60_000));
  }
  // 429 (limit) va 529 (Anthropic overloaded) uzoqroq davom etadi — kattaroq kutish
  const status = response?.status;
  const base = status === 429 || status === 529 ? 4_000 : 1_000;
  return Math.min(30_000, base * (2 ** attempt)) + Math.floor(Math.random() * 500);
}

async function postJsonWithRetry(url, options, provider, fetchImpl = fetch, { timeoutMs = LLM_REQUEST_TIMEOUT_MS, retries = LLM_RETRY_LIMIT } = {}) {
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : (...args) => fetch(...args);
  const limit = Math.max(1, Math.floor(Number(retries) || LLM_RETRY_LIMIT));
  for (let attempt = 0; attempt < limit; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`${provider} so‘rovi ${Math.round(timeoutMs / 1000)} soniyada tugamadi`)),
      timeoutMs,
    );
    let retryDelay = null;

    try {
      const response = await fetchFn(url, { ...options, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`${provider} ${response.status}: ${body.slice(0, 200)}`);
        error.status = response.status;
        if (isRetryableStatus(response.status) && attempt + 1 < limit) {
          retryDelay = getRetryDelay(response, attempt);
        } else {
          throw error;
        }
      } else {
        try {
          return JSON.parse(body);
        } catch {
          const error = new Error(`${provider} javobi yaroqli JSON emas`);
          error.retryable = false;
          throw error;
        }
      }
    } catch (error) {
      const retryable = error.retryable !== false
        && (error.status == null || isRetryableStatus(error.status));
      if (!retryable || attempt + 1 >= limit) throw error;
      retryDelay = getRetryDelay(null, attempt);
    } finally {
      clearTimeout(timeout);
    }

    if (retryDelay != null) await sleep(retryDelay);
  }
  throw new Error(`${provider} so‘rovi belgilangan retry chegarasidan o‘tdi`);
}

module.exports = { postJsonWithRetry, isRetryableStatus, LLM_REQUEST_TIMEOUT_MS };
