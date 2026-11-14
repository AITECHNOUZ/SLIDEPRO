// src/payments/fulfill.js
// To'lov tasdiqlangach: taqdimotni yaratib (yoki keshdan olib), foydalanuvchiga yuborish.
// + Tayyor faylni kanalga joylash. + Bir xil taqdimot qayta so'ralsa keshdan beradi.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { InputFile } = require("grammy");
const { getOrder, updateOrder, getSetting, getCache, setCache } = require("../db");
const { generatePresentation } = require("../generator/build");
const { generateMustaqilIsh } = require("../mustaqil/generate");
const { startPaymentStatus } = require("./mustaqil-progress");
const { config } = require("../config");

let _bot = null;
function init(bot) {
  _bot = bot;
  // LLM balansi tugasa yoki provayder ishlamasa adminlarga xabar
  try { require("../llm/client").setProviderAlertHandler(text => notifyAdmins(`⚠️ ${text}`)); } catch (_) {}
}

// Bir vaqtda nechta mustaqil ish tayyorlanadi. Tier 1 limitlarida 1 ta eng tez:
// navbatdagi foydalanuvchi kutadi, lekin ikkala ish ham sekinlashib qolmaydi.
const MAX_PARALLEL_MUSTAQIL = Math.max(1, Number(process.env.MAX_PARALLEL_MUSTAQIL) || 1);
let activeMustaqil = 0;
const waitingMustaqil = [];
async function acquireMustaqilSlot(onQueued) {
  if (activeMustaqil < MAX_PARALLEL_MUSTAQIL) { activeMustaqil++; return; }
  try { await onQueued?.(waitingMustaqil.length + 1); } catch (_) {}
  await new Promise(resolve => waitingMustaqil.push(resolve));
  activeMustaqil++;
}
function releaseMustaqilSlot() {
  activeMustaqil = Math.max(0, activeMustaqil - 1);
  const next = waitingMustaqil.shift();
  if (next) next();
}

// Taqdimotlar ham cheksiz parallel ishlamasin: ko'p buyurtma bir vaqtda kelsa server xotirasi va API limiti to'lib qoladi
const MAX_PARALLEL_TAQDIMOT = Math.max(1, Number(process.env.MAX_PARALLEL_TAQDIMOT) || 3);
let activeTaqdimot = 0;
const waitingTaqdimot = [];
async function acquireTaqdimotSlot(onQueued) {
  if (activeTaqdimot < MAX_PARALLEL_TAQDIMOT) { activeTaqdimot++; return; }
  try { await onQueued?.(waitingTaqdimot.length + 1); } catch (_) {}
  await new Promise(resolve => waitingTaqdimot.push(resolve));
  activeTaqdimot++;
}
function releaseTaqdimotSlot() {
  activeTaqdimot = Math.max(0, activeTaqdimot - 1);
  const next = waitingTaqdimot.shift();
  if (next) next();
}
function queueStatus() {
  return { mustaqil: { active: activeMustaqil, waiting: waitingMustaqil.length, max: MAX_PARALLEL_MUSTAQIL },
    taqdimot: { active: activeTaqdimot, waiting: waitingTaqdimot.length, max: MAX_PARALLEL_TAQDIMOT } };
}

function slug(s) {
  return (s || "taqdimot").toLowerCase().replace(/[^a-z0-9\u0400-\u04FF]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "taqdimot";
}

// kesh kaliti: ish turi + mavzu (normallashtirilgan) + son + kontent xeshi
// MUHIM: work_type kalitda bo'lishi shart — aks holda bir xil mavzuli
// taqdimot va mustaqil ish to'qnashib, noto'g'ri fayl yuborilishi mumkin.
function cacheKey(order) {
  const norm = (order.topic || "").trim().toLowerCase().replace(/\s+/g, " ");
  const contentHash = order.content_text
    ? crypto.createHash("md5").update(order.content_text).digest("hex").slice(0, 8)
    : "ai";
  const wt = order.work_type || "taqdimot";
  const count = wt === "mustaqil" ? (order.pages || "?") : (order.slides || "?");
  // Titul (ism, guruh, universitet...), til va mundarija farq qilsa — boshqa hujjat:
  // aks holda boshqa talabaga birovning ismi yozilgan fayl yuborilib qolardi.
  const personal = [order.student_name, order.student_group, order.university, order.faculty,
    order.department, order.supervisor, order.language, order.include_toc ? "toc" : "reja"]
    .map(value => String(value || "").trim().toLowerCase()).join("|");
  const personalHash = crypto.createHash("md5").update(personal).digest("hex").slice(0, 8);
  return `${wt}|${norm}|${count}|${contentHash}|${personalHash}`;
}

async function fulfillOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) return;
  if (order.status === "done" || order.status === "generating") return;

  updateOrder(orderId, { status: "generating", paid_at: Date.now() });
  // Taklif bonusi: do'st birinchi pullik buyurtmasini to'laganda
  try {
    const credited = require("../business").creditReferral(order);
    if (credited) _bot.api.sendMessage(credited.referrer, `🎉 Do'stingiz birinchi buyurtmasini to'ladi — balansingizga ${require("../business").fmt(credited.bonus)} so'm qo'shildi!`).catch(() => {});
  } catch (e) { console.error("[fulfill] referal xato:", e.message); }
  const key = cacheKey(order);

  // 1) KESH TEKSHIRUVI — bir xil ish avval yaratilganmi?
  try {
    const cached = getCache(key);
    if (cached && cached.file_id) {
      const isMustaqilC = order.work_type === "mustaqil";
      const capC = isMustaqilC
        ? `📄 Mustaqil ishingiz tayyor!\n\n📌 Mavzu: ${order.topic}\n📋 Sahifalar: ${order.pages || "?"} ta\n\n(Tezkor yetkazildi)`
        : `🎉 Taqdimotingiz tayyor!\n\n📌 Mavzu: ${order.topic}\n📄 Slaydlar: ${order.slides || "?"} ta\n\n(Tezkor yetkazildi)`;
      await _bot.api.sendDocument(order.user_tg_id, cached.file_id, { caption: capC });
      updateOrder(orderId, { status: "done", file_id: cached.file_id });
      console.log(`[fulfill] #${orderId} KESHDAN yetkazildi (key=${key})`);
      return;
    }
  } catch (e) {
    console.error(`[fulfill] kesh tekshiruvida xato:`, e.message);
  }

  // 2) YANGI GENERATSIYA
  let progress = null;
  try { progress = await startPaymentStatus(_bot.api, order); } catch (_) {}

  const outDir = path.join(__dirname, "..", "..", "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const isMustaqil = order.work_type === "mustaqil";
  const ext = isMustaqil ? ".docx" : ".pptx";
  const outFile = path.join(outDir, "order_" + orderId + "_" + slug(order.topic) + ext);
  const mustaqilProv = getSetting("mustaqil_llm_provider", "");
  const llmProvider = (isMustaqil && mustaqilProv) ? mustaqilProv : getSetting("llm_provider", "anthropic");
  const setting = (key, fallback) => getSetting(key, "") || fallback;
  const llmCfg = {
    provider: llmProvider,
    anthropicKey: config.anthropicApiKey,
    anthropicModel: setting("anthropic_main_model", config.model),
    anthropicCheapModel: setting("anthropic_cheap_model", process.env.ANTHROPIC_CHEAP_MODEL || "claude-haiku-5-5"),
    openaiKey: config.openaiApiKey,
    openaiModel: setting("openai_main_model", config.openaiModel),
    openaiCheapModel: setting("openai_cheap_model", process.env.OPENAI_CHEAP_MODEL || "gpt-5-mini"),
    // Asosiy model 3 marta javob bermasa o'tiladigan zaxira modellar (admin sozlamasi; bo'sh — standart zanjir)
    fallbackModels: setting("fallback_models", process.env.LLM_FALLBACK_MODELS || ""),
  };
  const { runWithFallback, fallbackState } = require("../llm/client");
  let fallbackInfo = "";

  const { trackUsage, formatUsage } = require("../llm/usage");
  let usageInfo = null;
  try {
    let res;
    const tracked = await trackUsage(() => runWithFallback(async () => {
    if (isMustaqil) {
      await acquireMustaqilSlot(position => _bot.api.sendMessage(order.user_tg_id,
        `🕒 Sizning mustaqil ishingiz navbatda (${position}-o'rin). Oldingi ish tugashi bilan avtomatik boshlanadi.`));
      try {
      res = await withRetries(() => generateMustaqilIsh({ topic: order.topic, pages: order.pages || 15,
        language: order.language || "o\'zbek", studentName: order.student_name || "", studentGroup: order.student_group || "",
        org: "", supervisor: order.supervisor || "", university: order.university || "",
        faculty: order.faculty || "", department: order.department || "", includeToc: Boolean(order.include_toc),
        sourceContent: order.content_text || "", llm: llmCfg, outFile,
        onProgress: ({ percent, phase }) => progress?.update(percent, phase) }), {
        orderId,
        // Ikkinchi urinishdan boshlab ikkala provayder ham ishlatiladi (Claude → OpenAI zaxira)
        onRetry: async (attempt, error) => {
          // Qayta urinishda ikkala kalit bo'lsa OpenAI ham zaxiraga qo'shiladi
          if (llmCfg.anthropicKey && llmCfg.openaiKey && llmCfg.provider === "anthropic") llmCfg.provider = "both";
          if (attempt === 1) {
            try { await _bot.api.sendMessage(order.user_tg_id, "⏳ Server hozir band — mustaqil ishingiz biroz kechikib, avtomatik qayta tayyorlanmoqda. Hech narsa qilish shart emas."); } catch (_) {}
          }
          notifyAdmins(`⚠️ #${orderId} ${attempt}-urinish xato, qayta uriniladi: ${String(error.message).slice(0, 300)}`);
        },
      });
      } finally {
        releaseMustaqilSlot();
      }
      res.slideCount = order.pages || 15;
    } else {
      await acquireTaqdimotSlot(position => _bot.api.sendMessage(order.user_tg_id,
        `🕒 Taqdimotingiz navbatda (${position}-o'rin). Bir necha daqiqada avtomatik boshlanadi.`));
      try {
      res = await withRetries(() => generatePresentation({ topic: order.topic, slides: order.slides,
        sourceContent: order.content_text || "", language: order.language || "o'zbek",
        studentName: order.student_name || "", studentGroup: order.student_group || "",
        university: order.university || "", faculty: order.faculty || "", department: order.department || "",
        supervisor: order.supervisor || "", llm: llmCfg, outFile }), { orderId });
      } finally {
        releaseTaqdimotSlot();
      }
    }
    const st = fallbackState();
    if (st && st.switches.length) fallbackInfo = "🔀 Zaxira model: " + st.switches.join(", ");
    return res;
    }));
    res = tracked.result;
    usageInfo = formatUsage(tracked.usage);
    try { updateOrder(orderId, { cost_usd: Number(tracked.usage.cost || 0) }); } catch (_) {}
    if (usageInfo) console.log(`[fulfill] #${orderId} sarf: ${usageInfo.replace(/\n/g, " | ")}`);

    const caption = isMustaqil
      ? "📄 Mustaqil ishingiz tayyor!\n\n📌 Mavzu: " + order.topic + "\n📋 Sahifalar: " + (res.pageCount || order.pages || 15) + " ta"
      : "🎉 Taqdimot tayyor!\n\n📌 Mavzu: " + order.topic + "\n📄 Slaydlar: " + res.slideCount + " ta";

    // 3) KANALGA YUBORISH (kesh uchun file_id olamiz)
    let fileId = null, channelMsgId = null;
    if (config.deliveryChannelId) {
      try {
        const channelCap = isMustaqil
          ? `🆕 #${orderId} | 📝 Mustaqil ish | ${order.topic} | ${order.pages || "?"} bet`
          : `🆕 #${orderId} | 🎨 Taqdimot | ${order.topic} | ${res.slideCount} slayd`;
        // Kanal (admin) xabarida haqiqiy token sarfi va taxminiy narx
        const sent = await _bot.api.sendDocument(config.deliveryChannelId, new InputFile(outFile), {
          caption: (channelCap + (usageInfo ? "\n" + usageInfo : "") + (fallbackInfo ? "\n" + fallbackInfo : "")).slice(0, 1000),
        });
        fileId = sent.document && sent.document.file_id;
        channelMsgId = sent.message_id;
        console.log(`[fulfill] #${orderId} kanalga yuborildi (msg=${channelMsgId})`);
      } catch (e) {
        console.error(`[fulfill] kanalga yuborishda xato:`, e.message);
      }
    }

    // 4) FOYDALANUVCHIGA YUBORISH
    // Fayl tayyor — foydalanuvchiga yuborishdagi xato (botni bloklagan, tarmoq) generatsiya xatosi emas:
    // buyurtma "done" bo'lib qoladi va fayl keyin «Mening buyurtmalarim» yoki admin orqali qayta yuboriladi.
    let userSent = null, deliveryError = null;
    for (let attempt = 0; attempt < 3 && !userSent; attempt++) {
      try {
        userSent = fileId
          ? await _bot.api.sendDocument(order.user_tg_id, fileId, { caption: `${caption}\n\nBuyurtmangiz uchun rahmat!` })
          : await _bot.api.sendDocument(order.user_tg_id, new InputFile(outFile), { caption: `${caption}\n\nBuyurtmangiz uchun rahmat!` });
      } catch (e) {
        deliveryError = e;
        if (e.error_code === 403) break; // foydalanuvchi botni bloklagan
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    if (userSent && !fileId) fileId = userSent.document && userSent.document.file_id;
    if (!userSent) {
      console.error(`[fulfill] #${orderId} foydalanuvchiga yuborilmadi:`, deliveryError && deliveryError.message);
      notifyAdmins(`📭 #${orderId} tayyor, lekin foydalanuvchiga yuborilmadi: ${String(deliveryError && deliveryError.message).slice(0, 200)}`,
        { inline_keyboard: [[{ text: "📋 Buyurtma", callback_data: "admo:show:" + orderId }]] });
    }
    if (isMustaqil && progress) await progress.complete();

    // 5) KESHGA SAQLASH
    if (fileId) {
      try { setCache(key, fileId, order.topic, order.slides, channelMsgId); }
      catch (e) { console.error("[fulfill] kesh saqlashda xato:", e.message); }
    }

    updateOrder(orderId, { status: "done", file_path: outFile, file_id: fileId || null, delivered_at: Date.now() });
    try { const alert = require("../business").checkDailyCostAlert(); if (alert) notifyAdmins(alert); } catch (_) {}
    console.log(`[fulfill] #${orderId} muvaffaqiyatli yetkazildi (provider=${res.usedProvider || llmProvider})`);
  } catch (e) {
    updateOrder(orderId, { status: "failed", ...(e.usage ? { cost_usd: Number(e.usage.cost || 0) } : {}) });
    console.error(`[fulfill] #${orderId} GENERATSIYA XATOSI:`, e.message);
    if (progress) await progress.fail(e.message);
    try {
      await _bot.api.sendMessage(order.user_tg_id, isMustaqil
        ? "⚠️ Mustaqil ishni tayyorlashda xatolik yuz berdi. Administratorga xabar berildi — ish qayta tayyorlanib yuboriladi yoki pulingiz qaytariladi." + supportLine()
        : "⚠️ Taqdimot yaratishda xatolik yuz berdi. Administratorga xabar berildi — ish qayta tayyorlanib yuboriladi yoki pulingiz qaytariladi." + supportLine());
    } catch (_) {}
    notifyAdmins(`❌ Buyurtma #${orderId} generatsiyada xato: ${String(e.message).slice(0, 500)}`,
      { inline_keyboard: [[{ text: "🔁 Qayta yaratish", callback_data: "admo:regen:" + orderId }, { text: "📋 Buyurtma", callback_data: "admo:show:" + orderId }]] });
  }
}

// Generatsiyani bir necha marta qayta urinish (API overload, tarmoq uzilishi va h.k.)
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
async function withRetries(fn, { orderId, onRetry } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_DELAYS_MS.length) break;
      console.warn(`[fulfill] #${orderId} urinish ${attempt + 1} xato: ${error.message}; ${RETRY_DELAYS_MS[attempt] / 1000}s dan keyin qayta`);
      try { await onRetry?.(attempt + 1, error); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, Number(process.env.FULFILL_RETRY_DELAY_MS) >= 0 && process.env.FULFILL_RETRY_DELAY_MS !== undefined ? Number(process.env.FULFILL_RETRY_DELAY_MS) : RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

// Bot qayta ishga tushganda "generating" holatida qolib ketgan buyurtmalarni davom ettirish
async function resumeStuckOrders(listOrdersByStatuses) {
  try {
    // "paid" — tasdiqlangan, lekin generatsiya boshlanmay qolgan (server shu orada o'chgan)
    const stuck = (listOrdersByStatuses(["generating", "paid"], 50) || []).filter(order => order && ["generating", "paid"].includes(order.status));
    for (const order of stuck) {
      updateOrder(order.id, { status: "paid" });
      console.log(`[fulfill] #${order.id} qayta ishga tushirishdan keyin davom ettirilmoqda`);
      fulfillOrder(order.id).catch(error => console.error(`[fulfill] #${order.id} resume xato:`, error.message));
    }
    return stuck.length;
  } catch (error) {
    console.error("[fulfill] resumeStuckOrders xato:", error.message);
    return 0;
  }
}

function supportLine() {
  const contact = getSetting("support_contact", "");
  return contact ? "\n\n📞 Yordam: " + contact : "";
}

function notifyAdmins(text, replyMarkup) {
  let ids = [...config.adminIds];
  try { const { listAdmins } = require("../db"); ids = ids.concat(listAdmins().map((a) => a.tg_id)); } catch (_) {}
  ids = [...new Set(ids)];
  for (const id of ids) { _bot.api.sendMessage(id, text, replyMarkup ? { reply_markup: replyMarkup } : undefined).catch(() => {}); }
}

// Eski chiqish fayllarini tozalash (fayl Telegram'da file_id orqali saqlanadi, diskda keragi yo'q)
function cleanupOutputs(maxAgeDays = Number(process.env.OUTPUT_KEEP_DAYS) || 3) {
  let removed = 0;
  for (const dir of [path.join(__dirname, "..", "..", "output"), path.join(__dirname, "..", "..", "tmp")]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    const cutoff = Date.now() - maxAgeDays * 86400000;
    for (const name of names) {
      const file = path.join(dir, name);
      try { const st = fs.statSync(file); if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(file); removed++; } } catch (_) {}
    }
  }
  return removed;
}

module.exports = { init, fulfillOrder, notifyAdmins, supportLine, cleanupOutputs, queueStatus, cacheKey, withRetries, resumeStuckOrders };
