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
function init(bot) { _bot = bot; }

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
  return `${wt}|${norm}|${count}|${contentHash}`;
}

async function fulfillOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) return;
  if (order.status === "done" || order.status === "generating") return;

  updateOrder(orderId, { status: "generating", paid_at: Date.now() });
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
  const llmCfg = { provider: llmProvider, anthropicKey: config.anthropicApiKey, anthropicModel: config.model, openaiKey: config.openaiApiKey, openaiModel: config.openaiModel };

  try {
    let res;
    if (isMustaqil) {
      res = await generateMustaqilIsh({ topic: order.topic, pages: order.pages || 15,
        language: "o\'zbek", studentName: order.student_name || "", studentGroup: order.student_group || "",
        org: "", supervisor: "", sourceContent: order.content_text || "", llm: llmCfg, outFile,
        onProgress: ({ percent, phase }) => progress?.update(percent, phase) });
      res.slideCount = order.pages || 15;
    } else {
      res = await generatePresentation({ topic: order.topic, slides: order.slides,
        sourceContent: order.content_text || "",
        studentName: order.student_name || "", studentGroup: order.student_group || "",
        llm: llmCfg, outFile });
    }

    const caption = isMustaqil
      ? "📄 Mustaqil ishingiz tayyor!\n\n📌 Mavzu: " + order.topic + "\n📋 Sahifalar: " + (order.pages||15) + " ta"
      : "🎉 Taqdimot tayyor!\n\n📌 Mavzu: " + order.topic + "\n📄 Slaydlar: " + res.slideCount + " ta";

    // 3) KANALGA YUBORISH (kesh uchun file_id olamiz)
    let fileId = null, channelMsgId = null;
    if (config.deliveryChannelId) {
      try {
        const channelCap = isMustaqil
          ? `🆕 #${orderId} | 📝 Mustaqil ish | ${order.topic} | ${order.pages || "?"} bet`
          : `🆕 #${orderId} | 🎨 Taqdimot | ${order.topic} | ${res.slideCount} slayd`;
        const sent = await _bot.api.sendDocument(config.deliveryChannelId, new InputFile(outFile), {
          caption: channelCap,
        });
        fileId = sent.document && sent.document.file_id;
        channelMsgId = sent.message_id;
        console.log(`[fulfill] #${orderId} kanalga yuborildi (msg=${channelMsgId})`);
      } catch (e) {
        console.error(`[fulfill] kanalga yuborishda xato:`, e.message);
      }
    }

    // 4) FOYDALANUVCHIGA YUBORISH
    let userSent;
    if (fileId) {
      userSent = await _bot.api.sendDocument(order.user_tg_id, fileId, { caption: `${caption}\n\nBuyurtmangiz uchun rahmat!` });
    } else {
      userSent = await _bot.api.sendDocument(order.user_tg_id, new InputFile(outFile), { caption: `${caption}\n\nBuyurtmangiz uchun rahmat!` });
      fileId = userSent.document && userSent.document.file_id;
    }
    if (isMustaqil && progress) await progress.complete();

    // 5) KESHGA SAQLASH
    if (fileId) {
      try { setCache(key, fileId, order.topic, order.slides, channelMsgId); }
      catch (e) { console.error("[fulfill] kesh saqlashda xato:", e.message); }
    }

    updateOrder(orderId, { status: "done", file_path: outFile, file_id: fileId || null });
    console.log(`[fulfill] #${orderId} muvaffaqiyatli yetkazildi (provider=${res.usedProvider || llmProvider})`);
  } catch (e) {
    updateOrder(orderId, { status: "failed" });
    console.error(`[fulfill] #${orderId} GENERATSIYA XATOSI:`, e.message);
    if (progress) await progress.fail(e.message);
    try {
      await _bot.api.sendMessage(order.user_tg_id, isMustaqil
        ? "⚠️ Mustaqil ishni tayyorlashda xatolik yuz berdi. Administrator bilan bog'laning."
        : "⚠️ Taqdimot yaratishda xatolik yuz berdi. Administrator bilan bog'laning.");
    } catch (_) {}
    notifyAdmins(`❌ Buyurtma #${orderId} generatsiyada xato: ${e.message}`);
  }
}

function notifyAdmins(text) {
  let ids = [...config.adminIds];
  try { const { listAdmins } = require("../db"); ids = ids.concat(listAdmins().map((a) => a.tg_id)); } catch (_) {}
  ids = [...new Set(ids)];
  for (const id of ids) { _bot.api.sendMessage(id, text).catch(() => {}); }
}

module.exports = { init, fulfillOrder, notifyAdmins, cacheKey };
