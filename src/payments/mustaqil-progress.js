const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PRESENTATION_PAYMENT_MESSAGE = "✅ To'lov tasdiqlandi! Taqdimotingiz tayyorlanmoqda, biroz kuting...";
const DEFAULT_INTERVAL_MS = 2000;

function progressBar(percent) {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

function renderProgressMessage({ percent, frame, phase, state, initial = false }) {
  if (state === "failed") {
    return `⚠️ Mustaqil ishni tayyorlashda xatolik yuz berdi.\n\nJarayon ${percent}% da to'xtadi. ${phase} Administrator bilan bog'laning.`;
  }
  if (state === "complete") {
    return `✅ Mustaqil ishingiz tayyorlandi va yuborildi!\n\n${progressBar(100)} 100%\n📄 Hujjat yetkazildi.`;
  }
  const heading = initial
    ? "✅ To'lov tasdiqlandi! 📝 Mustaqil ishingiz tayyorlanmoqda, biroz kuting..."
    : "📝 Mustaqil ishingiz tayyorlanmoqda...";
  return `${heading}\n\n${progressBar(percent)} ${percent}%\n${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${phase}`;
}

function noOpReporter() {
  return {
    update: async () => {},
    complete: async () => {},
    fail: async () => {},
    stop: () => {},
  };
}

async function startPaymentStatus(api, order, { intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (order.work_type !== "mustaqil") {
    try {
      await api.sendMessage(order.user_tg_id, PRESENTATION_PAYMENT_MESSAGE);
    } catch (_) {}
    return null;
  }

  let message;
  try {
    message = await api.sendMessage(order.user_tg_id, renderProgressMessage({
      percent: 0,
      frame: 0,
      phase: "Ish boshlanmoqda...",
      state: "running",
      initial: true,
    }));
  } catch (_) {
    return noOpReporter();
  }

  if (!message?.message_id) return noOpReporter();

  const chatId = order.user_tg_id;
  const messageId = message.message_id;
  let percent = 0;
  let phase = "Ish boshlanmoqda...";
  let frame = 0;
  let state = "running";
  let inFlight = null;

  const render = async () => {
    if (inFlight) return inFlight;
    const text = renderProgressMessage({ percent, frame, phase, state });
    inFlight = Promise.resolve()
      .then(() => api.editMessageText(chatId, messageId, text))
      .catch(() => {})
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  const timer = setInterval(() => {
    if (state !== "running") return;
    frame = (frame + 1) % SPINNER_FRAMES.length;
    void render();
  }, Math.max(500, intervalMs));
  timer.unref?.();

  return {
    async update(nextPercent, nextPhase) {
      if (state !== "running") return;
      const value = Number(nextPercent);
      if (Number.isFinite(value)) percent = Math.max(percent, Math.min(99, Math.floor(value)));
      if (nextPhase) phase = String(nextPhase);
      await render();
    },
    async complete() {
      if (state !== "running") return;
      state = "complete";
      percent = 100;
      clearInterval(timer);
      if (inFlight) await inFlight;
      await render();
    },
    async fail(reason = "Generatsiya yakunlanmadi.") {
      if (state !== "running") return;
      state = "failed";
      phase = String(reason);
      clearInterval(timer);
      if (inFlight) await inFlight;
      await render();
    },
    stop() {
      if (state === "running") state = "stopped";
      clearInterval(timer);
    },
  };
}

module.exports = {
  startPaymentStatus,
  renderProgressMessage,
  PRESENTATION_PAYMENT_MESSAGE,
};
