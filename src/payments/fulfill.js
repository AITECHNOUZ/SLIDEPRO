// src/payments/fulfill.js
// Paid orders are fulfilled idempotently: reuse a valid cached/generated file,
// deliver it to the customer first, and only then mark the order complete.
const fs = require("fs");
const path = require("path");
const { InputFile } = require("grammy");
const { getOrder, updateOrder, getSetting, getCache, setCache, deleteCache, listOrdersByStatuses } = require("../db");
const { generatePresentation } = require("../generator/build");
const { generateMustaqilIsh } = require("../mustaqil/generate");
const { startPaymentStatus } = require("./mustaqil-progress");
const { config } = require("../config");
const { buildCacheKey, sendDocumentWithRetry } = require("./delivery-utils");

let _bot = null;
const inFlight = new Map();
function init(bot) { _bot = bot; }

function slug(s) {
  return (s || "taqdimot").toLowerCase().replace(/[^a-z0-9\u0400-\u04FF]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "taqdimot";
}

function cacheKey(order) { return buildCacheKey(order); }

async function fulfillOrder(orderId) {
  if (inFlight.has(String(orderId))) return inFlight.get(String(orderId));
  const task = fulfillOrderOnce(orderId);
  inFlight.set(String(orderId), task);
  try { return await task; }
  finally { inFlight.delete(String(orderId)); }
}

async function fulfillOrderOnce(orderId) {
  const order = getOrder(orderId);
  if (!order) return false;
  if (order.status === "done") return true;
  if (!_bot?.api) throw new Error("Telegram bot yetkazib berish uchun ishga tushmagan.");

  updateOrder(orderId, { status: "generating", paid_at: order.paid_at || Date.now() });
  const key = cacheKey(order);
  const isMustaqil = order.work_type === "mustaqil";
  const count = isMustaqil ? (order.pages || 15) : (order.slides || 10);
  const caption = isMustaqil
    ? `📄 Mustaqil ishingiz tayyor!\n\n📌 Mavzu: ${order.topic}\n📋 Sahifalar: ${count} ta`
    : `🎉 Taqdimotingiz tayyor!\n\n📌 Mavzu: ${order.topic}\n📄 Slaydlar: ${count} ta`;
  let progress = null;

  try {
    // A cached Telegram file_id may have expired or become unusable. If so,
    // remove it and fall back to a local artifact/generation instead of failing.
    try {
      const cached = getCache(key);
      if (cached?.file_id) {
        const sent = await sendDocumentWithRetry(_bot.api, order.user_tg_id, cached.file_id, { caption: `${caption}\n\nBuyurtmangiz uchun rahmat!` });
        if (!sent?.document?.file_id) throw new Error("Telegram kesh faylini yubordi, ammo file_id qaytarmadi.");
        updateOrder(orderId, { status: "done", file_id: sent.document.file_id });
        console.log(`[fulfill] #${orderId} keshdan mijozga yetkazildi`);
        return true;
      }
    } catch (error) {
      console.warn(`[fulfill] #${orderId} keshi yaroqsiz, qayta yaratishga o'tiladi: ${error.message}`);
      try { deleteCache(key); } catch (deleteError) { console.error("[fulfill] cache o'chirish xatosi:", deleteError.message); }
    }

    try { progress = await startPaymentStatus(_bot.api, order); } catch (error) {
      console.warn(`[fulfill] #${orderId} progress xabari yuborilmadi: ${error.message}`);
    }

    const outDir = path.join(__dirname, "..", "..", "output");
    fs.mkdirSync(outDir, { recursive: true });
    const ext = isMustaqil ? ".docx" : ".pptx";
    const outFile = path.join(outDir, `order_${orderId}_${slug(order.topic)}${ext}`);
    const existing = fs.existsSync(outFile) && fs.statSync(outFile).size > 0;
    const mustaqilProv = getSetting("mustaqil_llm_provider", "");
    const llmProvider = (isMustaqil && mustaqilProv) ? mustaqilProv : getSetting("llm_provider", "anthropic");
    const llmCfg = {
      provider: llmProvider,
      anthropicKey: config.anthropicApiKey,
      anthropicModel: config.model,
      openaiKey: config.openaiApiKey,
      openaiModel: config.openaiModel,
    };
    let res = {};

    // Preserve a completed artifact when a previous delivery attempt failed.
    if (!existing) {
      if (isMustaqil) {
        res = await generateMustaqilIsh({
          topic: order.topic, pages: count, language: order.language || "o'zbek",
          studentName: order.student_name || "", studentGroup: order.student_group || "",
          org: "", supervisor: "", sourceContent: order.content_text || "", llm: llmCfg, outFile,
          onProgress: ({ percent, phase }) => progress?.update(percent, phase),
        });
      } else {
        res = await generatePresentation({
          topic: order.topic, slides: count, sourceContent: order.content_text || "",
          studentName: order.student_name || "", studentGroup: order.student_group || "",
          llm: llmCfg, outFile,
        });
      }
    }
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
      throw new Error("Generatsiya fayl yaratmadi yoki fayl bo'sh.");
    }

    // Customer delivery is the success criterion. A channel outage must never
    // prevent the paid customer from receiving their document.
    const userSent = await sendDocumentWithRetry(
      _bot.api,
      order.user_tg_id,
      new InputFile(outFile),
      { caption: `${caption}\n\nBuyurtmangiz uchun rahmat!` },
    );
    const fileId = userSent?.document?.file_id;
    if (!fileId) throw new Error("Telegram fayl yuborilganini tasdiqlamadi (file_id yo'q).");

    updateOrder(orderId, { status: "done", file_path: outFile, file_id: fileId });
    try { setCache(key, fileId, order.topic, order.slides, null); }
    catch (error) { console.error(`[fulfill] #${orderId} kesh saqlash xatosi:`, error.message); }
    if (isMustaqil && progress) await progress.complete();

    // Channel delivery is optional/best-effort and happens after customer
    // delivery, so channel permissions or outages cannot block fulfillment.
    if (config.deliveryChannelId) {
      try {
        const channelCap = isMustaqil
          ? `🆕 #${orderId} | 📝 Mustaqil ish | ${order.topic} | ${count} bet`
          : `🆕 #${orderId} | 🎨 Taqdimot | ${order.topic} | ${count} slayd`;
        const channelSent = await _bot.api.sendDocument(config.deliveryChannelId, new InputFile(outFile), { caption: channelCap });
        try { setCache(key, fileId, order.topic, order.slides, channelSent.message_id || null); } catch (_) {}
      } catch (error) {
        console.error(`[fulfill] #${orderId} kanalga yuborilmadi (mijozga yetkazildi):`, error.message);
      }
    }

    console.log(`[fulfill] #${orderId} mijozga muvaffaqiyatli yetkazildi (provider=${res.usedProvider || llmProvider})`);
    return true;
  } catch (error) {
    // Keep the paid order recoverable. The generated file is deliberately left
    // in place, so a retry can send it without spending LLM tokens again.
    try { updateOrder(orderId, { status: "paid" }); } catch (dbError) {
      console.error(`[fulfill] #${orderId} statusni tiklash xatosi:`, dbError.message);
    }
    console.error(`[fulfill] #${orderId} yetkazib berish/generatsiya xatosi:`, error);
    if (progress) await progress.fail(error.message || "Yetkazib berish amalga oshmadi.");
    try {
      await _bot.api.sendMessage(order.user_tg_id,
        `⚠️ Buyurtma #${orderId} uchun fayl hozir yuborilmadi. Buyurtmangiz to'langan va qayta ishlash uchun saqlandi; iltimos birozdan so'ng qayta urinib ko'ring yoki administratorga murojaat qiling.`);
    } catch (_) {}
    notifyAdmins(`❌ Buyurtma #${orderId} yetkazilmadi va qayta urinish uchun saqlandi: ${(error.message || "xato").slice(0, 300)}`);
    return false;
  }
}

async function recoverPendingOrders() {
  const orders = listOrdersByStatuses(["paid", "generating"], 100);
  for (const order of orders) {
    try { await fulfillOrder(order.id); }
    catch (error) { console.error(`[fulfill] #${order.id} tiklash xatosi:`, error.message); }
  }
  if (orders.length) console.log(`[fulfill] ${orders.length} to'langan buyurtma tiklash uchun tekshirildi`);
}

function notifyAdmins(text) {
  if (!_bot?.api) return;
  let ids = [...config.adminIds];
  try { const { listAdmins } = require("../db"); ids = ids.concat(listAdmins().map(a => a.tg_id)); } catch (_) {}
  for (const id of new Set(ids)) _bot.api.sendMessage(id, text).catch(() => {});
}

module.exports = { init, fulfillOrder, recoverPendingOrders, notifyAdmins, cacheKey };
