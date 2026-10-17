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
    if (Number.isFinite(requestedMs)) return Math.max(0, Math.min(requestedMs, 8_000));
  }
  return Math.min(4_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 200);
}

async function postJsonWithRetry(url, options, provider, fetchImpl = fetch) {
  for (let attempt = 0; attempt < LLM_RETRY_LIMIT; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`${provider} so‘rovi 90 soniyada tugamadi`)),
      LLM_REQUEST_TIMEOUT_MS,
    );
    let retryDelay = null;

    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`${provider} ${response.status}: ${body.slice(0, 200)}`);
        error.status = response.status;
        if (isRetryableStatus(response.status) && attempt + 1 < LLM_RETRY_LIMIT) {
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
      if (!retryable || attempt + 1 >= LLM_RETRY_LIMIT) throw error;
      retryDelay = getRetryDelay(null, attempt);
    } finally {
      clearTimeout(timeout);
    }

    if (retryDelay != null) await sleep(retryDelay);
  }
  throw new Error(`${provider} so‘rovi belgilangan retry chegarasidan o‘tdi`);
}

module.exports = { postJsonWithRetry };
