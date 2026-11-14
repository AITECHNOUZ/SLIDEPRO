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

// hooks.beforeAttempt() → har urinishdan oldin (masalan, rate-limiter navbati); qaytgan qiymat afterAttempt'ga beriladi.
// hooks.afterAttempt({ response, data, error, reservation, retryDelay }) → har urinishdan keyin (sarlavhalarni o'qish).
async function postJsonWithRetry(url, options, provider, fetchImpl = fetch, { timeoutMs = LLM_REQUEST_TIMEOUT_MS, retries = LLM_RETRY_LIMIT, beforeAttempt, afterAttempt } = {}) {
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : (...args) => fetch(...args);
  const limit = Math.max(1, Math.floor(Number(retries) || LLM_RETRY_LIMIT));
  for (let attempt = 0; attempt < limit; attempt++) {
    const controller = new AbortController();
    let timeout = null;
    let retryDelay = null;
    let reservation = null;
    let response = null;
    const notify = async payload => {
      if (typeof afterAttempt === "function") {
        try { await afterAttempt({ response, reservation, ...payload }); } catch (_) {}
      }
    };

    try {
      if (typeof beforeAttempt === "function") reservation = await beforeAttempt(attempt);
      // Taymer navbat kutib bo'lingandan keyin boshlanadi (rate-limiter kutishi timeout emas)
      timeout = setTimeout(
        () => controller.abort(new Error(`${provider} so‘rovi ${Math.round(timeoutMs / 1000)} soniyada tugamadi`)),
        timeoutMs,
      );
      response = await fetchFn(url, { ...options, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`${provider} ${response.status}: ${body.slice(0, 200)}`);
        error.status = response.status;
        error.body = body.slice(0, 500);
        if (isRetryableStatus(response.status) && attempt + 1 < limit) {
          retryDelay = getRetryDelay(response, attempt);
          await notify({ error, retryDelay });
        } else {
          await notify({ error });
          throw Object.assign(error, { notified: true });
        }
      } else {
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          const error = new Error(`${provider} javobi yaroqli JSON emas`);
          error.retryable = false;
          await notify({ error });
          throw Object.assign(error, { notified: true });
        }
        await notify({ data });
        return data;
      }
    } catch (error) {
      if (!error.notified && !retryDelay) await notify({ error });
      const retryable = error.retryable !== false
        && (error.status == null || isRetryableStatus(error.status));
      if (!retryable || attempt + 1 >= limit) throw error;
      retryDelay = getRetryDelay(null, attempt);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (retryDelay != null) await sleep(retryDelay);
  }
  throw new Error(`${provider} so‘rovi belgilangan retry chegarasidan o‘tdi`);
}

module.exports = { postJsonWithRetry, isRetryableStatus, LLM_REQUEST_TIMEOUT_MS };
