// src/bot.js
const fs = require("fs");
const path = require("path");
const { Bot, session, InlineKeyboard, Keyboard, InputFile } = require("grammy");
const { config, assertConfig } = require("./config");
const db = require("./db");
const { requiresStudentDetails } = require("./order-flow");
const { calcPrice, calcMustaqilPrice, currency, formatAmount } = require("./pricing");
const { extractText, cleanText } = require("./content/extract");
const fulfill = require("./payments/fulfill");
const click = require("./payments/click");
const payme = require("./payments/payme");
const { startServer } = require("./server");
const biz = require("./business");

assertConfig();
db.seedDefaults(config.defaults);

const bot = new Bot(config.botToken);
fulfill.init(bot);
// Sessiya SQLite'da saqlanadi — bot qayta ishga tushsa ham foydalanuvchi buyurtma o'rtasida qolib ketmaydi
bot.use(session({ initial: () => ({ step: "idle", draft: {} }), storage: db.sessionStorage }));

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// ── RUXSATLAR ─────────────────────────────────────────────
const isSuperAdmin = (id) => config.adminIds.includes(id);
const isAdmin = (id) => isSuperAdmin(id) || db.isDbAdmin(id);
const isFree = (id) => isAdmin(id) || db.isFreeUser(id);
const needsStudentDetails = (id) => requiresStudentDetails({ isAdmin: isAdmin(id), isVip: db.isFreeUser(id) });

const supportLine = () => fulfill.supportLine();

// ── UMUMIY FILTRLAR: blok, texnik ishlar, faollik ─────────
bot.use(async (ctx, next) => {
  const id = ctx.from && ctx.from.id;
  if (!id || (ctx.chat && ctx.chat.type !== "private")) return next();
  try {
    ctx.isNewUser = db.upsertUser(id, ctx.from.username, ctx.from.first_name);
    if (ctx.isNewUser && db.getSetting("notify_new_users", "0") === "1") {
      fulfill.notifyAdmins("👤 Yangi foydalanuvchi: " + (ctx.from.first_name || "") + (ctx.from.username ? " @" + ctx.from.username : "") + " (id:" + id + ")");
    }
  } catch (_) {}
  if (isAdmin(id)) return next();
  if (db.isBanned(id)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Siz bloklangansiz", show_alert: true }).catch(() => {});
    else await ctx.reply("⛔️ Siz botdan foydalanishdan cheklangansiz." + supportLine()).catch(() => {});
    return;
  }
  if (db.getSetting("maintenance", "0") === "1") {
    const text = db.getSetting("maintenance_text", "") || "🛠 Botda texnik ishlar olib borilmoqda. Birozdan keyin qayta urinib ko'ring.";
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: text.slice(0, 190), show_alert: true }).catch(() => {});
    else await ctx.reply(text + supportLine()).catch(() => {});
    return;
  }
  return next();
});

// Admin ommaviy xabar yoki shaxsiy xabar matnini kutayotgan bo'lsa — har qanday xabar turini (matn, rasm, fayl) ushlab olamiz
bot.on("message", async (ctx, next) => {
  const step = ctx.session.step;
  if (!["admin_broadcast", "admin_msg_user"].includes(step) || !isAdmin(ctx.from.id)) return next();
  if (ctx.message.text && ctx.message.text.startsWith("/")) return next();
  if (step === "admin_msg_user") {
    const target = ctx.session.adminTarget;
    ctx.session.step = "idle";
    try {
      await bot.api.copyMessage(target, ctx.chat.id, ctx.message.message_id);
      return ctx.reply("✅ Xabar yuborildi: " + target);
    } catch (e) { return ctx.reply("⚠️ Yuborilmadi: " + esc(e.message)); }
  }
  ctx.session.step = "idle";
  ctx.session.broadcast = { chatId: ctx.chat.id, messageId: ctx.message.message_id };
  const count = db.listUserIdsForBroadcast().length;
  return ctx.reply("📣 Yuqoridagi xabar <b>" + count + "</b> ta foydalanuvchiga yuborilsinmi?", { parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("✅ Yuborish", "bc:send").text("❌ Bekor", "bc:cancel") });
});

// ── MENYULAR ───────────────────────────────────────────────
function mainMenu(id) {
  const kb = new Keyboard()
    .text("🎨 Taqdimot yaratish").row()
    .text("📝 Mustaqil ish yaratish").row()
    .text("📂 Mening buyurtmalarim").text("ℹ️ Yordam").row();
  if (biz.referralEnabled() && !isFree(id)) kb.text("🤝 Do'st taklif qilish").row();
  if (isFree(id) && !isAdmin(id)) kb.text("🎁 Bepul rejim").row();
  if (isAdmin(id)) kb.text("🛠 Admin panel").row();
  return kb.resized();
}
function slidesInline() {
  return new InlineKeyboard()
    .text("8","slides:8").text("10","slides:10").row()
    .text("12","slides:12").text("14","slides:14").row()
    .text("✏️ Boshqa son","slides:custom");
}
function pagesInline() {
  return new InlineKeyboard()
    .text("10","pages:10").text("15","pages:15").row()
    .text("20","pages:20").text("25","pages:25").row()
    .text("30","pages:30").text("40","pages:40").row()
    .text("✏️ Boshqa son","pages:custom");
}
function langInline() {
  return new InlineKeyboard()
    .text("🇺🇿 O'zbek","lang:uz").row()
    .text("🇷🇺 Rus","lang:ru").row()
    .text("🇬🇧 Ingliz","lang:en");
}
function contentInline() {
  return new InlineKeyboard()
    .text("📎 Kontent yuklayman","content:yes").row()
    .text("🤖 AI o'zi yozsin","content:no");
}
function tocInline() {
  return new InlineKeyboard()
    .text("📑 Ha, mundarija kerak","toc:yes").row()
    .text("📄 Yo'q, faqat reja","toc:no");
}
function skipInline(field) {
  return new InlineKeyboard().text("⏭ O'tkazib yuborish","skip:"+field);
}
function formulaInline() {
  return new InlineKeyboard()
    .text("✅ Ha, kerak","formula:yes").text("❌ Yo'q","formula:no");
}
function paymentMethodsInline() {
  const kb = new InlineKeyboard();
  if (db.getSetting("manual_enabled")==="1") kb.text("💳 Karta orqali (chek bilan)","pay:manual").row();
  if (db.getSetting("click_enabled")==="1" && config.click.serviceId) kb.text("🟢 Click","pay:click").row();
  if (db.getSetting("payme_enabled")==="1" && config.payme.merchantId) kb.text("🔵 Payme","pay:payme").row();
  return kb;
}

// ── /start ─────────────────────────────────────────────────
bot.command("start", async (ctx) => {
  ctx.session.step = "idle"; ctx.session.draft = {};
  let refNote = "";
  const referrer = biz.parseStartPayload(ctx.match);
  if (ctx.isNewUser && referrer && biz.setReferrer(ctx.from.id, referrer)) {
    const pct = biz.refNewDiscount();
    if (pct) refNote = "\n\n🤝 Siz do'stingiz taklifi bilan keldingiz — birinchi buyurtmangizga <b>"+pct+"% chegirma</b>!";
    bot.api.sendMessage(referrer, "🤝 Havolangiz orqali yangi do'st qo'shildi: "+(ctx.from.first_name||"")+
      ". U birinchi buyurtmasini to'lasa, balansingizga "+biz.fmt(biz.refBonus())+" "+currency()+" tushadi.").catch(() => {});
  }
  const freeNote = (isFree(ctx.from.id) ? "\n\n🎁 Sizda <b>bepul foydalanish</b> huquqi bor!" : "") + refNote;
  await ctx.reply(
    "Assalomu alaykum, "+esc(ctx.from.first_name||"do'st")+"! 👋\n\n"+
    "Men <b>taqdimot</b> (.pptx) va <b>mustaqil ish</b> (.docx) yaratuvchi botman.\n\n"+
    "Mavzu bering — siz uchun professional hujjat tayyorlayman."+freeNote+"\n\nMenyudan tanlang 👇",
    { parse_mode:"HTML", reply_markup: mainMenu(ctx.from.id) }
  );
});
bot.command("cancel", async (ctx) => {
  ctx.session.step = "idle"; ctx.session.draft = {};
  await ctx.reply("Bekor qilindi.", { reply_markup: mainMenu(ctx.from.id) });
});
bot.command("id", async (ctx) => {
  await ctx.reply("Sizning Telegram ID: <code>"+ctx.from.id+"</code>", { parse_mode:"HTML" });
});

// ── ASOSIY MENYU ───────────────────────────────────────────
bot.hears("🎨 Taqdimot yaratish", async (ctx) => {
  ctx.session.step = "await_topic"; ctx.session.draft = { workType:"taqdimot" };
  await ctx.reply("📝 Taqdimot mavzusini yozing:");
});

bot.hears("📝 Mustaqil ish yaratish", async (ctx) => {
  ctx.session.step = "await_topic"; ctx.session.draft = { workType:"mustaqil" };
  await ctx.reply("📝 Mustaqil ish mavzusini yozing:");
});

bot.hears("🎁 Bepul rejim", async (ctx) => {
  const q = biz.vipQuota(ctx.from.id);
  const quota = q.limit ? "\n\nBugungi limit: <b>" + q.used + "/" + q.limit + "</b> (qoldi: " + q.left + ")" : "";
  await ctx.reply("🎁 Sizda bepul huquq bor. Taqdimot yoki mustaqil ish yaratishni tanlang." + quota, { parse_mode: "HTML" });
});

bot.hears("📂 Mening buyurtmalarim", async (ctx) => {
  const orders = db.listOrdersByUser(ctx.from.id, 10);
  if (!orders.length) return ctx.reply("Sizda hali buyurtmalar yo'q.");
  const lines = orders.map((o) => {
    const type = o.work_type === "mustaqil" ? "📝" : "🎨";
    const cnt = o.work_type === "mustaqil" ? (o.pages||"?")+"bet" : (o.slides||"?")+"sl";
    return type+" #"+o.id+" — "+esc((o.topic||"").slice(0,30))+" ("+cnt+") — "+statusLabel(o.status);
  });
  const kb = new InlineKeyboard();
  orders.filter(o => o.status === "done" && o.file_id).slice(0, 6).forEach((o, i) => { kb.text("📥 #" + o.id, "myfile:" + o.id); if (i % 3 === 2) kb.row(); });
  await ctx.reply("📂 Buyurtmalaringiz:\n\n"+lines.join("\n")+(kb.inline_keyboard.flat().length ? "\n\nTayyor faylni qayta olish uchun bosing 👇" : ""),
    { parse_mode:"HTML", reply_markup: kb.inline_keyboard.flat().length ? kb : undefined });
});
bot.callbackQuery(/^myfile:(\d+)$/, async (ctx) => {
  const order = db.getOrder(parseInt(ctx.match[1], 10));
  if (!order || order.user_tg_id !== ctx.from.id || !order.file_id) return ctx.answerCallbackQuery({ text: "Fayl topilmadi", show_alert: true });
  await ctx.answerCallbackQuery();
  try { await ctx.replyWithDocument(order.file_id, { caption: "📌 " + order.topic }); }
  catch (_) { await ctx.reply("⚠️ Faylni yuborib bo'lmadi." + supportLine()); }
});

bot.hears("🤝 Do'st taklif qilish", async (ctx) => {
  if (!biz.referralEnabled()) return ctx.reply("Taklif dasturi hozir o'chirilgan.");
  const st = biz.referralStats(ctx.from.id);
  const link = "https://t.me/"+ctx.me.username+"?start=ref_"+ctx.from.id;
  const pct = biz.refNewDiscount(), bonus = biz.refBonus();
  await ctx.reply(
    "🤝 <b>Do'stlaringizni taklif qiling</b>\n\n"+
    (bonus ? "Do'stingiz havolangiz orqali kelib, birinchi buyurtmasini to'lasa — balansingizga <b>"+biz.fmt(bonus)+" "+currency()+"</b> tushadi.\n" : "")+
    (pct ? "Do'stingiz esa birinchi buyurtmasiga <b>"+pct+"% chegirma</b> oladi.\n" : "")+
    "Balans keyingi buyurtmalaringizda avtomatik ishlatiladi.\n\n"+
    "🔗 Sizning havolangiz:\n<code>"+esc(link)+"</code>\n\n"+
    "👥 Taklif qilinganlar: "+st.invited+" · To'laganlar: "+st.paid+"\n"+
    "💰 Balans: <b>"+biz.fmt(st.balance)+" "+currency()+"</b>",
    { parse_mode:"HTML", reply_markup: new InlineKeyboard().url("📤 Ulashish", "https://t.me/share/url?url="+encodeURIComponent(link)+"&text="+encodeURIComponent("Taqdimot va mustaqil ishni bir necha daqiqada tayyorlaydigan bot 👇")) }
  );
});

bot.hears("ℹ️ Yordam", async (ctx) => {
  await ctx.reply(
    "ℹ️ <b>Qanday ishlaydi:</b>\n\n"+
    "🎨 <b>Taqdimot</b> (.pptx):\n"+
    "  Mavzu → Slaydlar soni → Til → Titul ma'lumotlari → Kontent → To'lov → Fayl\n\n"+
    "📝 <b>Mustaqil ish</b> (.docx, GOST formati):\n"+
    "  Mavzu → Sahifalar → Til → Titul ma'lumotlari → Mundarija → Kontent → To'lov → Fayl\n\n"+
    "💰 Narx: taqdimot — "+biz.fmt(db.getSetting("price_per_slide","0"))+" "+currency()+"/slayd, mustaqil ish — "+
      biz.fmt(db.getSetting("mustaqil_price_per_page", db.getSetting("price_per_slide","0")))+" "+currency()+"/sahifa\n"+
    "🎟 Promokodingiz bo'lsa, to'lov oldidan kiriting.\n"+
    "📌 Formulalar, grafiklar, jadvallar avtomatik qo'shiladi.\n"+
    "📂 Tayyor fayllarni «Mening buyurtmalarim» bo'limidan qayta olish mumkin.\n\n"+
    "/cancel — bekor qilish\n/id — Telegram ID"+supportLine(),
    { parse_mode:"HTML" }
  );
});

// ── ADMIN PANEL ────────────────────────────────────────────
bot.hears("🛠 Admin panel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.reply("🛠 <b>Admin panel</b>", { parse_mode:"HTML", reply_markup: adminMain(ctx.from.id) });
});

function adminMain(id) {
  const pending = biz.overallCounters().awaitingApproval;
  const kb = new InlineKeyboard()
    .text("📈 Statistika","adm:stats").text("📊 Buyurtmalar"+(pending?" ("+pending+")":""),"adm:orders").row()
    .text("🔎 Buyurtma #","adm:findorder").text("👤 Foydalanuvchi","adm:finduser").row()
    .text("📣 Xabar yuborish","adm:broadcast").text("🎟 Promokodlar","adm:promo").row()
    .text("💰 Narxlar","adm:price").text("💳 To'lov","adm:pay").row()
    .text("🤖 AI — Taqdimot","adm:provider").text("📝 AI — Mustaqil","adm:mustaqil_provider").row()
    .text("⚙️ Sozlamalar","adm:settings").text("🎁 VIP users","adm:free").row()
    .text("📥 CSV hisobot","adm:csv").row();
  if (isSuperAdmin(id)) kb.text("👥 Adminlar","adm:admins").row();
  return kb;
}

// --- Buyurtmalar ---
bot.callbackQuery("adm:orders", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("📊 <b>Buyurtmalar</b>", { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("✅ Tasdiqlangan","adm:ord:done").row()
    .text("⏳ Tasdiqlanmagan / xato","adm:ord:pending").row()
    .text("📋 Hammasi","adm:ord:all").row()
    .text("⬅️ Orqaga","adm:back") });
});
bot.callbackQuery(/^adm:ord:(done|pending|all)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const kind = ctx.match[1];
  let orders;
  if (kind==="done") orders = db.listOrdersByStatuses(["paid","generating","done"],20);
  else if (kind==="pending") orders = db.listOrdersByStatuses(["awaiting_payment","awaiting_approval","rejected","failed"],20);
  else orders = db.listRecentOrders(20);
  const body = orders.length
    ? orders.map((o) => {
        const type = o.work_type==="mustaqil" ? "📝" : "🎨";
        const cnt = o.work_type==="mustaqil" ? (o.pages||"?")+"bet" : (o.slides||"?")+"sl";
        return type+" #"+o.id+" | "+statusLabel(o.status)+" | "+cnt+" | "+formatAmount(o.amount)+"\n   "+esc((o.topic||"").slice(0,40));
      }).join("\n")
    : "Bo'sh.";
  const kb = new InlineKeyboard();
  orders.slice(0, 12).forEach((o, i) => { kb.text("#" + o.id, "admo:show:" + o.id); if (i % 4 === 3) kb.row(); });
  kb.row().text("⬅️ Orqaga","adm:orders");
  await ctx.editMessageText(body, { parse_mode:"HTML", reply_markup: kb });
});

// --- To'lov usullari ---
bot.callbackQuery("adm:pay", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("💳 <b>To'lov usullari:</b>", { parse_mode:"HTML", reply_markup: payInline() });
});
function payInline() {
  const m = (k) => db.getSetting(k)==="1" ? "✅" : "❌";
  return new InlineKeyboard()
    .text(m("manual_enabled")+" Karta (chek)","adm:toggle:manual_enabled").row()
    .text(m("click_enabled")+" Click","adm:toggle:click_enabled").row()
    .text(m("payme_enabled")+" Payme","adm:toggle:payme_enabled").row()
    .text("💳 Karta raqamini o'zgartirish","adm:card").row()
    .text("⬅️ Orqaga","adm:back");
}
bot.callbackQuery(/^adm:toggle:(manual_enabled|click_enabled|payme_enabled)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const k = ctx.match[1]; db.setSetting(k, db.getSetting(k)==="1" ? "0" : "1");
  await ctx.answerCallbackQuery(db.getSetting(k)==="1" ? "Yoqildi ✅" : "O'chirildi ❌");
  await ctx.editMessageReplyMarkup({ reply_markup: payInline() });
});

// --- AI rejimi (Taqdimot va Mustaqil ish) ---
// Rejimlar: faqat Claude | faqat OpenAI | Claude+OpenAI (arzon GPT → qimmat Claude) | Claude+Claude (Haiku → Sonnet)
// Kaskad rejimlarida avval arzon model ishlaydi; u 2 marta xato qilsa (javob formati buzilsa yoki API xatosi) qimmat model chaqiriladi.
const MODE_LABELS = {
  anthropic: "Faqat Claude",
  openai: "Faqat OpenAI",
  claude_openai: "Claude + OpenAI (arzon GPT → Claude)",
  claude_claude: "Claude + Claude (arzon → qimmat model)",
};
function modelSettings() {
  return {
    anthropicMain: db.getSetting("anthropic_main_model", "") || config.model,
    anthropicCheap: db.getSetting("anthropic_cheap_model", "") || process.env.ANTHROPIC_CHEAP_MODEL || "claude-haiku-5-5",
    openaiMain: db.getSetting("openai_main_model", "") || config.openaiModel,
    openaiCheap: db.getSetting("openai_cheap_model", "") || process.env.OPENAI_CHEAP_MODEL || "gpt-5-mini",
  };
}
function aiModeText(title, settingKey) {
  const a=config.anthropicApiKey?"✅":"❌", o=config.openaiApiKey?"✅":"❌";
  const m = modelSettings();
  const cur = db.getSetting(settingKey, "anthropic") || "anthropic";
  return `${title}\n\nKalitlar: Anthropic ${a}  OpenAI ${o}\nHozirgi rejim: <b>${esc(MODE_LABELS[cur] || cur)}</b>\n\n`+
    `<b>Modellar:</b>\n• Claude asosiy (qimmat): <code>${esc(m.anthropicMain)}</code>\n• Claude arzon: <code>${esc(m.anthropicCheap)}</code>\n`+
    `• OpenAI asosiy: <code>${esc(m.openaiMain)}</code>\n• OpenAI arzon: <code>${esc(m.openaiCheap)}</code>\n\n`+
    `<i>Kaskad rejimida avval arzon model ishlaydi; u 2 marta xato qilsa qimmat model ulanadi.</i>`;
}
function providerInline(settingKey, prefix) {
  const cur = db.getSetting(settingKey, "anthropic") || "anthropic";
  const m = (p) => cur===p ? "🔘 " : "⚪️ ";
  const kb = new InlineKeyboard();
  for (const mode of Object.keys(MODE_LABELS)) kb.text(m(mode)+MODE_LABELS[mode], prefix+":"+mode).row();
  return kb
    .text("✏️ Claude modellari","adm:models:anthropic").text("✏️ OpenAI modellari","adm:models:openai").row()
    .text("🧪 Modellarni tekshirish","adm:models_test").row()
    .text("⬅️ Orqaga","adm:back");
}
bot.callbackQuery("adm:provider", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(aiModeText("🤖 <b>Taqdimot uchun AI rejimi</b>", "llm_provider"),
    { parse_mode:"HTML", reply_markup: providerInline("llm_provider","prov") });
});
bot.callbackQuery("adm:mustaqil_provider", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(aiModeText("📝 <b>Mustaqil ish uchun AI rejimi</b>", "mustaqil_llm_provider"),
    { parse_mode:"HTML", reply_markup: providerInline("mustaqil_llm_provider","mprov") });
});
function modeKeyError(mode) {
  const needsClaude = mode !== "openai";
  const needsOpenAI = mode === "openai" || mode === "claude_openai";
  if (needsClaude && !config.anthropicApiKey) return "ANTHROPIC_API_KEY yo'q!";
  if (needsOpenAI && !config.openaiApiKey) return "OPENAI_API_KEY yo'q!";
  return null;
}
bot.callbackQuery(/^(prov|mprov):(anthropic|openai|claude_openai|claude_claude)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [prefix, mode] = [ctx.match[1], ctx.match[2]];
  const problem = modeKeyError(mode);
  if (problem) return ctx.answerCallbackQuery({ text: problem, show_alert: true });
  const key = prefix === "prov" ? "llm_provider" : "mustaqil_llm_provider";
  db.setSetting(key, mode);
  await ctx.answerCallbackQuery("Saqlandi ✅");
  await ctx.editMessageText(aiModeText(prefix === "prov" ? "🤖 <b>Taqdimot uchun AI rejimi</b>" : "📝 <b>Mustaqil ish uchun AI rejimi</b>", key),
    { parse_mode:"HTML", reply_markup: providerInline(key, prefix) }).catch(() => {});
});
// Kalit va model nomlari haqiqatan ishlashini kichik so'rov bilan tekshirish
async function modelTestReport() {
  const { testModel } = require("./llm/client");
  const m = modelSettings();
  const jobs = [
    ["Claude asosiy", "anthropic", m.anthropicMain, config.anthropicApiKey],
    ["Claude arzon", "anthropic", m.anthropicCheap, config.anthropicApiKey],
    ["OpenAI asosiy", "openai", m.openaiMain, config.openaiApiKey],
    ["OpenAI arzon", "openai", m.openaiCheap, config.openaiApiKey],
  ];
  const lines = await Promise.all(jobs.map(async ([label, provider, model, key]) => {
    if (!key) return `⚪️ ${label}: kalit yo'q`;
    try {
      const r = await testModel({ provider, model, apiKey: key });
      return `${r.ok ? "✅" : "⚠️"} ${label} <code>${esc(model)}</code> — ${(r.ms / 1000).toFixed(1)} s${r.ok ? "" : " (javob formati kutilganidek emas)"}`;
    } catch (error) {
      return `❌ ${label} <code>${esc(model)}</code> — ${esc(String(error.message).slice(0, 140))}`;
    }
  }));
  return "🧪 <b>Modellar tekshiruvi</b>\n\n" + lines.join("\n");
}
bot.callbackQuery("adm:models_test", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery("Tekshirilmoqda...");
  await ctx.reply(await modelTestReport(), { parse_mode: "HTML" });
});
bot.callbackQuery(/^adm:models:(anthropic|openai)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const provider = ctx.match[1];
  ctx.session.step = "admin_models_" + provider;
  await ctx.answerCallbackQuery();
  const m = modelSettings();
  const example = provider === "anthropic" ? `${m.anthropicMain} ${m.anthropicCheap}` : `${m.openaiMain} ${m.openaiCheap}`;
  await ctx.reply(`✏️ ${provider === "anthropic" ? "Claude" : "OpenAI"} modellarini yuboring: <code>asosiy arzon</code>\n\nMasalan:\n<code>${esc(example)}</code>\n\nStandartga qaytarish: <code>default</code>`, { parse_mode:"HTML" });
});

// --- Narx / Karta ---
function priceText() {
  const tb = db.getSetting("base_price","0"), tp = db.getSetting("price_per_slide","5000");
  const mb = db.getSetting("mustaqil_base_price", tb), mp = db.getSetting("mustaqil_price_per_page", tp);
  return "💰 <b>Narxlar</b>\n\n"+
    "🎨 Taqdimot: "+biz.fmt(tb)+" + "+biz.fmt(tp)+"/slayd\n   10 slayd = <b>"+biz.fmt(calcPrice(10))+" "+currency()+"</b>\n"+
    "📝 Mustaqil ish: "+biz.fmt(mb)+" + "+biz.fmt(mp)+"/sahifa\n   15 sahifa = <b>"+biz.fmt(calcMustaqilPrice(15))+" "+currency()+"</b>";
}
bot.callbackQuery("adm:price", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(priceText(), { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("✏️ Taqdimot narxi","adm:price:t").text("✏️ Mustaqil narxi","adm:price:m").row()
    .text("⬅️ Orqaga","adm:back") });
});
bot.callbackQuery(/^adm:price:(t|m)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const t = ctx.match[1] === "t";
  ctx.session.step = t ? "admin_price_t" : "admin_price_m";
  await ctx.reply((t ? "🎨 Taqdimot" : "📝 Mustaqil ish")+" narxini yuboring: <code>bazaviy "+(t ? "slayd_narxi" : "sahifa_narxi")+"</code>\nMasalan: <code>"+(t ? "0 5000" : "10000 3000")+"</code>", { parse_mode:"HTML" });
});
bot.callbackQuery("adm:card", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  ctx.session.step = "admin_card"; await ctx.answerCallbackQuery();
  await ctx.reply("Yangi karta: <code>8600xxxxxxxxxxxx Familiya Ism</code>", { parse_mode:"HTML" });
});

// --- Bepul users ---
bot.callbackQuery("adm:free", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const list = db.listFreeUsers();
  const body = list.length ? list.map((u)=>"• "+u.tg_id+(u.username?" (@"+esc(u.username)+")":"")).join("\n") : "Bo'sh.";
  await ctx.editMessageText("🎁 <b>Bepul users:</b>\n\n"+body, { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("➕ Qo'shish","adm:free:add").text("➖ O'chirish","adm:free:del").row()
    .text("⬅️ Orqaga","adm:back") });
});
bot.callbackQuery("adm:free:add", async (ctx) => { if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery(); ctx.session.step="admin_add_free"; await ctx.answerCallbackQuery(); await ctx.reply("Bepul huquq beriladigan Telegram ID:"); });
bot.callbackQuery("adm:free:del", async (ctx) => { if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery(); ctx.session.step="admin_del_free"; await ctx.answerCallbackQuery(); await ctx.reply("O'chiriladigan Telegram ID:"); });

// --- Adminlar ---
bot.callbackQuery("adm:admins", async (ctx) => {
  if (!isSuperAdmin(ctx.from.id)) return ctx.answerCallbackQuery({text:"Faqat bosh admin",show_alert:true});
  await ctx.answerCallbackQuery();
  const supers = config.adminIds.map((id)=>"• "+id+" (bosh)");
  const dbAdmins = db.listAdmins().map((a)=>"• "+a.tg_id+(a.username?" (@"+esc(a.username)+")":""));
  await ctx.editMessageText("👥 <b>Adminlar:</b>\n\n"+supers.concat(dbAdmins).join("\n"), { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("➕","adm:admins:add").text("➖","adm:admins:del").row()
    .text("⬅️ Orqaga","adm:back") });
});
bot.callbackQuery("adm:admins:add", async (ctx) => { if (!isSuperAdmin(ctx.from.id)) return ctx.answerCallbackQuery(); ctx.session.step="admin_add_admin"; await ctx.answerCallbackQuery(); await ctx.reply("Yangi admin Telegram ID:"); });
bot.callbackQuery("adm:admins:del", async (ctx) => { if (!isSuperAdmin(ctx.from.id)) return ctx.answerCallbackQuery(); ctx.session.step="admin_del_admin"; await ctx.answerCallbackQuery(); await ctx.reply("O'chiriladigan admin ID:"); });
bot.callbackQuery("adm:back", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("🛠 <b>Admin panel</b>", { parse_mode:"HTML", reply_markup: adminMain(ctx.from.id) });
});

// --- Statistika / CSV ---
bot.callbackQuery("adm:stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(biz.statsReport(), { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("🔄 Yangilash","adm:stats").text("⬅️ Orqaga","adm:back") }).catch(() => {});
});
bot.callbackQuery("adm:csv", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("📥 Qaysi davr uchun hisobot?", { reply_markup: new InlineKeyboard()
    .text("7 kun","adm:csv:7").text("30 kun","adm:csv:30").text("Hammasi","adm:csv:0").row()
    .text("⬅️ Orqaga","adm:back") });
});
bot.callbackQuery(/^adm:csv:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery("Tayyorlanmoqda...");
  const days = parseInt(ctx.match[1], 10);
  const since = days ? Date.now() - days * 86400000 : 0;
  const csv = biz.ordersCsv(since);
  await ctx.replyWithDocument(new InputFile(Buffer.from(csv, "utf8"), "buyurtmalar_" + (days || "hammasi") + "_" + new Date().toISOString().slice(0, 10) + ".csv"),
    { caption: "📥 Buyurtmalar hisoboti (" + (days ? days + " kun" : "hammasi") + ")" });
});

// --- Buyurtma kartasi ---
function orderCard(o) {
  const type = o.work_type === "mustaqil" ? "📝 Mustaqil ish" : "🎨 Taqdimot";
  const cnt = o.work_type === "mustaqil" ? (o.pages||"?")+" sahifa" : (o.slides||"?")+" slayd";
  const date = (t) => t ? new Date(t + 5 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "—";
  return "📋 <b>Buyurtma #"+o.id+"</b>\n\n"+type+" · "+cnt+" · "+esc(o.language||"o'zbek")+"\n"+
    "📌 "+esc(o.topic||"")+"\n"+
    "👤 user: <code>"+o.user_tg_id+"</code>"+(o.student_name ? " · "+esc(o.student_name)+" "+esc(o.student_group||"") : "")+"\n"+
    "💰 "+formatAmount(o.amount||0)+" "+esc(o.currency||currency())+(o.discount ? " (chegirma "+formatAmount(o.discount)+", "+esc(o.promo_code||"")+")" : "")+
    " · "+esc(o.payment_method||"—")+"\n"+
    "📊 Holat: "+statusLabel(o.status)+"\n"+
    "🕒 Yaratilgan: "+date(o.created_at)+" · Yetkazilgan: "+date(o.delivered_at)+"\n"+
    (o.cost_usd ? "🔢 AI xarajat: $"+Number(o.cost_usd).toFixed(3)+" (≈ "+biz.fmt(o.cost_usd * biz.usdRate())+" so'm)\n" : "")+
    (o.has_content ? "📎 Kontent yuklangan ("+String(o.content_text||"").length+" belgi)\n" : "");
}
function orderKb(o) {
  const kb = new InlineKeyboard();
  if (["awaiting_approval","awaiting_payment","rejected"].includes(o.status)) kb.text("✅ To'lovni tasdiqlash","approve:"+o.id).row();
  if (["done","failed","paid"].includes(o.status) || (o.status === "generating" && o.created_at < Date.now() - 2 * 3600000)) kb.text("🔁 Qayta yaratish","admo:regen:"+o.id);
  if (o.file_id) kb.text("📤 Faylni qayta yuborish","admo:resend:"+o.id);
  kb.row();
  if (["done","failed","paid"].includes(o.status) && !["free","promo"].includes(o.payment_method)) kb.text("💸 Pul qaytarildi","admo:refund:"+o.id);
  kb.text("👤 Foydalanuvchi","admu:show:"+o.user_tg_id).row();
  if (o.file_id) kb.text("📄 Faylni menga","admo:file:"+o.id).row();
  return kb.text("⬅️ Admin panel","adm:back");
}
async function showOrder(ctx, id, edit) {
  const o = db.getOrder(id);
  if (!o) return ctx.reply("Buyurtma topilmadi: #"+id);
  const opts = { parse_mode:"HTML", reply_markup: orderKb(o) };
  if (edit) return ctx.editMessageText(orderCard(o), opts).catch(() => ctx.reply(orderCard(o), opts));
  return ctx.reply(orderCard(o), opts);
}
bot.callbackQuery("adm:findorder", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  ctx.session.step = "admin_find_order"; await ctx.answerCallbackQuery();
  await ctx.reply("🔎 Buyurtma raqamini yuboring (masalan: <code>125</code>):", { parse_mode:"HTML" });
});
bot.callbackQuery(/^admo:(show|regen|resend|refund|file):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [action, id] = [ctx.match[1], parseInt(ctx.match[2], 10)];
  const o = db.getOrder(id);
  if (!o) return ctx.answerCallbackQuery({ text: "Topilmadi", show_alert: true });
  if (action === "show") { await ctx.answerCallbackQuery(); return showOrder(ctx, id, !ctx.callbackQuery.message?.photo); }
  if (action === "regen") {
    if (o.status === "generating" && o.created_at > Date.now() - 2 * 3600000) return ctx.answerCallbackQuery({ text: "Hozir tayyorlanmoqda", show_alert: true });
    try { db.deleteCache(fulfill.cacheKey(o)); } catch (_) {}
    db.updateOrder(id, { status: "paid" });
    await ctx.answerCallbackQuery({ text: "Qayta yaratish boshlandi 🔁" });
    fulfill.fulfillOrder(id).catch((e) => console.error("[regen]", e.message));
    return ctx.reply("🔁 #"+id+" qayta tayyorlanmoqda. Tayyor bo'lgach foydalanuvchiga avtomatik yuboriladi.");
  }
  if (action === "resend") {
    if (!o.file_id) return ctx.answerCallbackQuery({ text: "Fayl yo'q", show_alert: true });
    try { await bot.api.sendDocument(o.user_tg_id, o.file_id, { caption: "📌 "+o.topic+"\n\nBuyurtmangiz #"+id+" fayli qayta yuborildi." }); await ctx.answerCallbackQuery({ text: "Yuborildi ✅" }); }
    catch (e) { await ctx.answerCallbackQuery({ text: "Xato: "+String(e.message).slice(0, 150), show_alert: true }); }
    return;
  }
  if (action === "file") {
    await ctx.answerCallbackQuery();
    return ctx.replyWithDocument(o.file_id, { caption: "#"+id+" — "+o.topic }).catch((e) => ctx.reply("⚠️ "+esc(e.message)));
  }
  if (action === "refund") {
    db.updateOrder(id, { status: "refunded" });
    try { biz.releasePromo(id); biz.releaseBalance(id); } catch (_) {}
    await ctx.answerCallbackQuery({ text: "Qaytarilgan deb belgilandi" });
    try { await bot.api.sendMessage(o.user_tg_id, "💸 Buyurtma #"+id+" uchun to'lovingiz qaytarildi. Noqulaylik uchun uzr so'raymiz."); } catch (_) {}
    return showOrder(ctx, id, true);
  }
});

// --- Foydalanuvchi kartasi ---
function userCardText(id) {
  const s = biz.userSummary(id);
  const u = s.user;
  const vip = db.isFreeUser(id), banned = db.isBanned(id);
  const date = (t) => t ? new Date(t + 5 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "—";
  const last = db.listOrdersByUser(id, 5).map(o => "  #"+o.id+" "+(o.work_type==="mustaqil"?"📝":"🎨")+" "+statusLabel(o.status)+" — "+esc((o.topic||"").slice(0, 28))).join("\n");
  return "👤 <b>Foydalanuvchi</b> <code>"+id+"</code>\n\n"+
    (u ? esc(u.first_name||"")+(u.username ? " @"+esc(u.username) : "")+"\n🕒 Qo'shilgan: "+date(u.created_at)+" · Oxirgi: "+date(u.last_seen)+"\n" : "⚠️ Botda ro'yxatdan o'tmagan\n")+
    "🧾 Buyurtmalar: "+s.orders+" (bajarilgan: "+s.paid+") · To'lagan: <b>"+biz.fmt(s.spent)+" "+currency()+"</b>\n"+
    "💰 Bonus balans: "+biz.fmt(biz.getBalance(id))+" · 🤝 Taklif qilgan: "+biz.referralStats(id).invited+
    (u && u.referred_by ? " · Uni taklif qilgan: <code>"+u.referred_by+"</code>" : "")+"\n"+
    (isAdmin(id) ? "🛠 Admin\n" : "")+(vip ? "🎁 VIP (bepul)\n" : "")+(banned ? "⛔️ Bloklangan\n" : "")+
    (last ? "\nOxirgi buyurtmalar:\n"+last : "");
}
function userKb(id) {
  const kb = new InlineKeyboard()
    .text(db.isBanned(id) ? "✅ Blokdan chiqarish" : "⛔️ Bloklash", "admu:ban:"+id)
    .text(db.isFreeUser(id) ? "➖ VIP olish" : "🎁 VIP berish", "admu:vip:"+id).row()
    .text("✉️ Xabar yozish","admu:msg:"+id).text("💰 Balans","admu:bal:"+id).row();
  db.listOrdersByUser(id, 4).forEach(o => kb.text("#"+o.id, "admo:show:"+o.id));
  return kb.row().text("⬅️ Admin panel","adm:back");
}
async function showUser(ctx, id, edit) {
  const opts = { parse_mode:"HTML", reply_markup: userKb(id) };
  if (edit) return ctx.editMessageText(userCardText(id), opts).catch(() => ctx.reply(userCardText(id), opts));
  return ctx.reply(userCardText(id), opts);
}
bot.callbackQuery("adm:finduser", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  ctx.session.step = "admin_find_user"; await ctx.answerCallbackQuery();
  await ctx.reply("👤 Telegram ID yoki @username yuboring:");
});
bot.callbackQuery(/^admu:(show|ban|vip|msg|bal):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const [action, id] = [ctx.match[1], parseInt(ctx.match[2], 10)];
  if (action === "show") { await ctx.answerCallbackQuery(); return showUser(ctx, id, !ctx.callbackQuery.message?.photo); }
  if (action === "ban") {
    if (isAdmin(id)) return ctx.answerCallbackQuery({ text: "Adminni bloklab bo'lmaydi", show_alert: true });
    if (!db.getUser(id)) db.upsertUser(id, "", "");
    const next = !db.isBanned(id); db.setBanned(id, next);
    await ctx.answerCallbackQuery({ text: next ? "Bloklandi ⛔️" : "Blokdan chiqarildi ✅" });
    return showUser(ctx, id, true);
  }
  if (action === "vip") {
    if (db.isFreeUser(id)) db.removeFreeUser(id);
    else { db.addFreeUser(id, "", ctx.from.id); bot.api.sendMessage(id, "🎁 Sizga bepul foydalanish huquqi berildi! /start bosing.").catch(() => {}); }
    await ctx.answerCallbackQuery({ text: "Saqlandi ✅" });
    return showUser(ctx, id, true);
  }
  if (action === "bal") {
    ctx.session.step = "admin_balance"; ctx.session.adminTarget = id;
    await ctx.answerCallbackQuery();
    return ctx.reply("💰 "+id+" balansi: "+biz.fmt(biz.getBalance(id))+"\n\nO'zgartirish: <code>+5000</code> yoki <code>-5000</code>", { parse_mode:"HTML" });
  }
  if (action === "msg") {
    ctx.session.step = "admin_msg_user"; ctx.session.adminTarget = id;
    await ctx.answerCallbackQuery();
    return ctx.reply("✉️ "+id+" ga yuboriladigan xabarni yozing (matn, rasm yoki fayl). Bekor qilish: /cancel");
  }
});

// --- Ommaviy xabar ---
bot.callbackQuery("adm:broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  ctx.session.step = "admin_broadcast"; await ctx.answerCallbackQuery();
  await ctx.reply("📣 Barcha foydalanuvchilarga yuboriladigan xabarni yuboring (matn, rasm, video yoki fayl).\nYuborishdan oldin tasdiq so'raladi. Bekor qilish: /cancel");
});
let broadcastRunning = false;
bot.callbackQuery(/^bc:(send|cancel)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const bc = ctx.session.broadcast;
  if (ctx.match[1] === "cancel" || !bc) { ctx.session.broadcast = null; await ctx.answerCallbackQuery("Bekor qilindi"); return ctx.editMessageText("❌ Ommaviy xabar bekor qilindi."); }
  if (broadcastRunning) return ctx.answerCallbackQuery({ text: "Boshqa xabar yuborilmoqda, kuting", show_alert: true });
  ctx.session.broadcast = null;
  await ctx.answerCallbackQuery("Boshlandi");
  const ids = db.listUserIdsForBroadcast();
  await ctx.editMessageText("📣 Yuborilmoqda: 0/"+ids.length);
  broadcastRunning = true;
  const status = ctx.callbackQuery.message;
  (async () => {
    let ok = 0, fail = 0, blocked = 0;
    for (let i = 0; i < ids.length; i++) {
      try { await bot.api.copyMessage(ids[i], bc.chatId, bc.messageId); ok++; }
      catch (e) {
        fail++;
        if (e.error_code === 403) blocked++;
        const wait = e.parameters && e.parameters.retry_after;
        if (wait) { await new Promise(r => setTimeout(r, wait * 1000)); i--; fail--; continue; }
      }
      await new Promise(r => setTimeout(r, 40)); // ~25 xabar/s — Telegram limitidan past
      if (i % 50 === 49) bot.api.editMessageText(status.chat.id, status.message_id, "📣 Yuborilmoqda: "+(i+1)+"/"+ids.length).catch(() => {});
    }
    broadcastRunning = false;
    await bot.api.editMessageText(status.chat.id, status.message_id,
      "✅ Ommaviy xabar tugadi\n\nYetkazildi: "+ok+"\nYetkazilmadi: "+fail+(blocked ? " (botni bloklagan: "+blocked+")" : "")).catch(() => {});
  })().catch((e) => { broadcastRunning = false; console.error("[broadcast]", e); });
});

// --- Promokodlar ---
function promoText() {
  const list = biz.listPromos();
  return "🎟 <b>Promokodlar</b>\n\n"+(list.length ? list.map(biz.promoLabel).join("\n") : "Hali yo'q.")+
    "\n\n<i>Foydalanuvchi to'lov oldidan «🎟 Promokod» tugmasi orqali kiritadi. Har bir foydalanuvchi bitta kodni bir marta ishlatadi.</i>";
}
bot.callbackQuery("adm:promo", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(promoText(), { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("➕ Yangi","adm:promo:add").text("➖ O'chirish","adm:promo:del").row()
    .text("⬅️ Orqaga","adm:back") });
});
bot.callbackQuery(/^adm:promo:(add|del)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  if (ctx.match[1] === "add") {
    ctx.session.step = "admin_promo_add";
    return ctx.reply("➕ Promokod: <code>KOD qiymat [limit] [taqdimot|mustaqil] [Nkun]</code>\n\nMisollar:\n<code>BAHOR20 20%</code> — 20% chegirma, cheksiz\n<code>START 5000 100</code> — 5 000 so'm, 100 marta\n<code>MI50 50% 30 mustaqil 7kun</code> — faqat mustaqil ish, 7 kun\n<code>SOVGA 100% 10</code> — bepul, 10 marta", { parse_mode:"HTML" });
  }
  ctx.session.step = "admin_promo_del";
  return ctx.reply("➖ O'chiriladigan promokodni yozing:");
});

// --- Sozlamalar ---
const EDITABLE_SETTINGS = {
  support_contact: { label: "📞 Yordam kontakti", hint: "Masalan: @admin_username yoki +998901234567. O'chirish: -", validate: (t) => t.length <= 64 },
  vip_daily_limit: { label: "🎁 VIP kunlik limit", hint: "VIP foydalanuvchi kuniga nechta bepul ish olishi mumkin. 0 = cheksiz", validate: (t) => /^\d{1,3}$/.test(t) },
  usd_rate: { label: "💱 Dollar kursi", hint: "1$ necha so'm (statistikada AI xarajatini hisoblash uchun)", validate: (t) => /^\d{3,6}$/.test(t) },
  daily_cost_alert_usd: { label: "💸 Kunlik AI xarajat chegarasi ($)", hint: "Oshsa adminlarga ogohlantirish keladi. 0 = o'chiq", validate: (t) => /^\d{1,4}(\.\d{1,2})?$/.test(t) },
  ref_bonus: { label: "🤝 Taklif bonusi (so'm)", hint: "Do'st birinchi to'lovni qilganda taklif qilganga beriladigan bonus. 0 = bonus yo'q", validate: (t) => /^\d{1,7}$/.test(t) },
  ref_new_discount: { label: "🤝 Yangi do'st chegirmasi (%)", hint: "Taklif orqali kelgan foydalanuvchining birinchi buyurtmasiga chegirma, 0–100", validate: (t) => /^\d{1,3}$/.test(t) && Number(t) <= 100 },
  unpaid_remind_min: { label: "⏰ To'lov eslatmasi (daqiqa)", hint: "To'lanmagan buyurtma haqida necha daqiqadan keyin eslatilsin (5–720)", validate: (t) => /^\d{1,3}$/.test(t) && Number(t) >= 5 && Number(t) <= 720 },
  unpaid_expire_hours: { label: "⌛️ Buyurtma muddati (soat)", hint: "To'lanmagan buyurtma necha soatdan keyin bekor qilinsin (1–168)", validate: (t) => /^\d{1,3}$/.test(t) && Number(t) >= 1 && Number(t) <= 168 },
  maintenance_text: { label: "🛠 Texnik ishlar matni", hint: "Texnik rejimda foydalanuvchiga ko'rsatiladigan matn. Standart: -", validate: (t) => t.length <= 500 },
};
function settingsText() {
  const v = (k, d) => esc(db.getSetting(k, d) || d);
  return "⚙️ <b>Sozlamalar</b>\n\n"+
    "🛠 Texnik ishlar rejimi: <b>"+(db.getSetting("maintenance","0")==="1" ? "YOQILGAN (foydalanuvchilar to'xtatilgan)" : "o'chiq")+"</b>\n"+
    "🔔 Yangi foydalanuvchi xabari: "+(db.getSetting("notify_new_users","0")==="1" ? "✅" : "❌")+"\n"+
    "🤝 Taklif dasturi: "+(biz.referralEnabled() ? "✅ bonus "+biz.fmt(biz.refBonus())+", yangi do'stga "+biz.refNewDiscount()+"%" : "❌")+"\n"+
    "⏰ To'lov eslatmasi: "+db.getSetting("unpaid_remind_min","30")+" daqiqadan keyin · bekor qilish: "+db.getSetting("unpaid_expire_hours","24")+" soatda\n"+
    "📞 Yordam kontakti: "+v("support_contact","—")+"\n"+
    "🎁 VIP kunlik limit: "+(biz.vipDailyLimit() || "cheksiz")+"\n"+
    "💱 1$ = "+biz.fmt(biz.usdRate())+" so'm\n"+
    "💸 Kunlik AI xarajat chegarasi: "+(Number(db.getSetting("daily_cost_alert_usd","0")) > 0 ? "$"+v("daily_cost_alert_usd","0") : "o'chiq");
}
function settingsKb() {
  const kb = new InlineKeyboard()
    .text(db.getSetting("maintenance","0")==="1" ? "🟢 Botni ochish" : "🛠 Texnik rejimni yoqish","adm:flag:maintenance").row()
    .text("🔔 Yangi user xabari","adm:flag:notify_new_users").text("🤝 Taklif dasturi","adm:flag:referral_enabled").row();
  for (const [key, meta] of Object.entries(EDITABLE_SETTINGS)) kb.text(meta.label, "adm:set:"+key).row();
  return kb.text("⬅️ Orqaga","adm:back");
}
bot.callbackQuery("adm:settings", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(settingsText(), { parse_mode:"HTML", reply_markup: settingsKb() });
});
bot.callbackQuery(/^adm:flag:(maintenance|notify_new_users|referral_enabled)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const k = ctx.match[1], def = k === "referral_enabled" ? "1" : "0";
  db.setSetting(k, db.getSetting(k,def)==="1" ? "0" : "1");
  await ctx.answerCallbackQuery(db.getSetting(k)==="1" ? "Yoqildi" : "O'chirildi");
  await ctx.editMessageText(settingsText(), { parse_mode:"HTML", reply_markup: settingsKb() }).catch(() => {});
});
bot.callbackQuery(/^adm:set:([a-z_]+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const meta = EDITABLE_SETTINGS[ctx.match[1]];
  if (!meta) return ctx.answerCallbackQuery();
  ctx.session.step = "admin_set"; ctx.session.adminSetting = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.reply(meta.label+"\n\n"+meta.hint+"\n\nHozirgi: "+(db.getSetting(ctx.match[1], "") || "—"));
});

// ── UMUMIY OQIM ────────────────────────────────────────────

// Sahifalar soni (mustaqil ish)
bot.callbackQuery(/^pages:(.+)$/, async (ctx) => {
  if (ctx.session.step !== "await_pages") return ctx.answerCallbackQuery();
  const val = ctx.match[1]; await ctx.answerCallbackQuery();
  if (val === "custom") {
    ctx.session.step = "await_custom_pages";
    return ctx.reply("Sahifalar sonini yozing ("+config.minPages+"–"+config.maxPages+"):");
  }
  ctx.session.draft.pages = parseInt(val, 10);
  ctx.session.step = "await_lang";
  await ctx.editMessageText("✅ Sahifalar: "+val+" ta");
  await askLang(ctx);
});

// Slaydlar soni (taqdimot)
bot.callbackQuery(/^slides:(.+)$/, async (ctx) => {
  if (ctx.session.step !== "await_slides") return ctx.answerCallbackQuery();
  const val = ctx.match[1]; await ctx.answerCallbackQuery();
  if (val === "custom") {
    ctx.session.step = "await_custom_slides";
    return ctx.reply("Slaydlar sonini yozing ("+config.minSlides+"–"+config.maxSlides+"):");
  }
  ctx.session.draft.slides = parseInt(val, 10);
  ctx.session.step = "await_lang";
  await ctx.editMessageText("✅ Slaydlar: "+val+" ta");
  await askLang(ctx);
});

// Til tanlash (mustaqil ish va taqdimot)
bot.callbackQuery(/^lang:(uz|ru|en)$/, async (ctx) => {
  if (ctx.session.step !== "await_lang") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const langMap = { uz:"o'zbek", ru:"rus", en:"ingliz" };
  ctx.session.draft.language = langMap[ctx.match[1]];
  await ctx.editMessageText("✅ Til: "+langMap[ctx.match[1]]);
  await askStudentDetailsOrContinue(ctx);
});

// Kontent tanlash
bot.callbackQuery(/^content:(yes|no)$/, async (ctx) => {
  if (ctx.session.step !== "await_content_choice") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  if (ctx.match[1] === "yes") {
    ctx.session.step = "await_content_upload";
    await ctx.editMessageText("📎 Kontentni yuboring: matn yozing yoki .docx/.txt/.pdf fayl jo'nating.");
  } else {
    ctx.session.draft.has_content = false; ctx.session.draft.content_text = "";
    await ctx.editMessageText("🤖 AI mavzudan o'zi yozadi.");
    await proceedToPayment(ctx);
  }
});

async function askLang(ctx) {
  await ctx.reply(ctx.session.draft.workType === "mustaqil" ? "🌐 Mustaqil ish tilini tanlang:" : "🌐 Taqdimot tilini tanlang:", { reply_markup: langInline() });
}
async function askContent(ctx) {
  await ctx.reply(
    "📎 Kontent bormi?\n\n"+
    "• <b>Yuklayman</b> — .docx/.txt/.pdf yoki matn berasiz\n"+
    "• <b>AI yozsin</b> — mavzudan avtomatik yaratiladi",
    { parse_mode:"HTML", reply_markup: contentInline() }
  );
}
async function continueWithoutStudentDetails(ctx) {
  ctx.session.draft.studentName = "";
  ctx.session.draft.studentGroup = "";
  return afterStudentDetails(ctx);
}
// ── TITUL MA'LUMOTLARI (mustaqil ish va taqdimot, VIP/admin'dan so'ralmaydi) ──
const TITLE_FIELDS = [
  { key: "university", step: "await_university", ask: "🏛 Universitet nomini kiriting:\n\n<i>Masalan: Qarshi davlat texnika universiteti</i>" },
  { key: "faculty", step: "await_faculty", ask: "🏢 Fakultet nomini kiriting:\n\n<i>Masalan: Energetika</i>" },
  { key: "department", step: "await_department", ask: "📚 Kafedra nomini kiriting:\n\n<i>Masalan: Texnologik jarayonlarni avtomatlashtirish</i>" },
  { key: "supervisor", step: "await_supervisor", ask: "👨‍🏫 Tekshiruvchi (o'qituvchi) F.I.Sh.:\n\n<i>Masalan: Karimov A.B.</i>" },
];
async function askTitleField(ctx, index) {
  const field = TITLE_FIELDS[index];
  if (!field) {
    if (ctx.session.draft.workType === "mustaqil") return askToc(ctx);
    ctx.session.step = "await_content_choice";
    return askContent(ctx);
  }
  ctx.session.step = field.step;
  return ctx.reply(field.ask, { parse_mode:"HTML", reply_markup: skipInline(field.key) });
}
async function nextTitleField(ctx, currentKey) {
  const index = TITLE_FIELDS.findIndex(field => field.key === currentKey);
  return askTitleField(ctx, index + 1);
}
// Mundarija — barcha foydalanuvchilardan (VIP ham) so'raladi
async function askToc(ctx) {
  ctx.session.step = "await_toc";
  return ctx.reply("📑 Mustaqil ishga sahifa raqamli <b>mundarija</b> qo'shilsinmi?\n\n<i>Yo'q desangiz, 2-sahifada qisqa reja bo'ladi.</i>", { parse_mode:"HTML", reply_markup: tocInline() });
}
// Talaba ma'lumotlaridan keyingi qadam: mustaqil ish → titul/mundarija, taqdimot → kontent
async function afterStudentDetails(ctx) {
  // Titul ma'lumotlari (universitet, fakultet, kafedra, tekshiruvchi) — ikkala ish turida ham, VIP/admin'dan so'ralmaydi
  if (needsStudentDetails(ctx.from.id)) return askTitleField(ctx, 0);
  if (ctx.session.draft.workType !== "mustaqil") {
    ctx.session.step = "await_content_choice";
    return askContent(ctx);
  }
  return askToc(ctx);
}

bot.callbackQuery(/^skip:(university|faculty|department|supervisor)$/, async (ctx) => {
  const field = TITLE_FIELDS.find(item => item.key === ctx.match[1]);
  if (!field || ctx.session.step !== field.step) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  ctx.session.draft[field.key] = "";
  try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch (_) {}
  return nextTitleField(ctx, field.key);
});

bot.callbackQuery(/^toc:(yes|no)$/, async (ctx) => {
  if (ctx.session.step !== "await_toc") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  ctx.session.draft.includeToc = ctx.match[1] === "yes";
  await ctx.editMessageText(ctx.session.draft.includeToc ? "✅ Mundarija qo'shiladi" : "✅ Mundarija o'rniga reja");
  ctx.session.step = "await_content_choice";
  return askContent(ctx);
});

async function askStudentDetailsOrContinue(ctx) {
  if (!needsStudentDetails(ctx.from.id)) return continueWithoutStudentDetails(ctx);
  ctx.session.step = "await_student_name";
  return ctx.reply("👤 Ismingizni kiriting (F.I.Sh.):\n\n<i>Masalan: Toshmatov Jasur Hamidovich</i>", { parse_mode:"HTML" });
}

// ── MATN KIRITISH ──────────────────────────────────────────
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  const step = ctx.session.step;
  const wt = ctx.session.draft.workType;

  if (step === "await_topic") {
    if (text.length < 3) return ctx.reply("Mavzu juda qisqa. To'liqroq yozing.");
    ctx.session.draft.topic = text;
    if (wt === "mustaqil") {
      ctx.session.step = "await_pages";
      return ctx.reply("📄 Necha sahifalik mustaqil ish kerak?", { reply_markup: pagesInline() });
    } else {
      ctx.session.step = "await_slides";
      return ctx.reply("📄 Necha sahifalik taqdimot kerak?", { reply_markup: slidesInline() });
    }
  }

  if (step === "await_custom_pages") {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n)||n<config.minPages||n>config.maxPages)
      return ctx.reply("Iltimos "+config.minPages+"–"+config.maxPages+" oralig'ida son kiriting.");
    ctx.session.draft.pages = n;
    ctx.session.step = "await_lang";
    await ctx.reply("✅ Sahifalar: "+n);
    return askLang(ctx);
  }

  if (step === "await_custom_slides") {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n)||n<config.minSlides||n>config.maxSlides)
      return ctx.reply("Iltimos "+config.minSlides+"–"+config.maxSlides+" oralig'ida son kiriting.");
    ctx.session.draft.slides = n;
    ctx.session.step = "await_lang";
    await ctx.reply("✅ Sahifa soni: "+n);
    return askLang(ctx);
  }

  if (step === "await_student_name") {
    if (!needsStudentDetails(ctx.from.id)) return continueWithoutStudentDetails(ctx);
    ctx.session.draft.studentName = text;
    ctx.session.step = "await_student_group";
    return ctx.reply("🎓 Guruhingizni kiriting:\n\n<i>Masalan: 21-MTI-1 yoki AT-22</i>", { parse_mode:"HTML" });
  }

  if (step === "await_student_group") {
    if (!needsStudentDetails(ctx.from.id)) return continueWithoutStudentDetails(ctx);
    ctx.session.draft.studentGroup = text;
    await ctx.reply("✅ "+esc(ctx.session.draft.studentName)+" — "+esc(text));
    return afterStudentDetails(ctx);
  }

  const titleField = TITLE_FIELDS.find(field => field.step === step);
  if (titleField) {
    if (text.length < 2 || text.length > 120) return ctx.reply("Iltimos, to'g'ri nom kiriting (2–120 belgi) yoki «O'tkazib yuborish» tugmasini bosing.");
    ctx.session.draft[titleField.key] = text;
    return nextTitleField(ctx, titleField.key);
  }

  if (step === "await_content_upload") {
    const cleaned = cleanText(text);
    if (cleaned.length < 20) return ctx.reply("Kontent juda qisqa. Ko'proq matn yuboring.");
    ctx.session.draft.has_content = true; ctx.session.draft.content_text = cleaned;
    await ctx.reply("✅ Kontent qabul qilindi ("+cleaned.length+" belgi).");
    return proceedToPayment(ctx);
  }

  if (step === "await_promo") {
    const d = ctx.session.draft;
    const base = d.workType === "mustaqil" ? calcMustaqilPrice(d.pages||15) : calcPrice(d.slides||10);
    const chk = biz.checkPromo(text, { userId: ctx.from.id, workType: d.workType || "taqdimot", amount: base });
    if (chk.error) {
      ctx.session.step = "await_payment_method";
      return ctx.reply("⚠️ "+esc(chk.error), { reply_markup: new InlineKeyboard().text("🎟 Boshqa kod","promo:enter").text("➡️ Davom etish","promo:clear") });
    }
    d.promoCode = chk.code;
    await ctx.reply("✅ Promokod qabul qilindi: −"+formatAmount(chk.discount)+" "+currency());
    return proceedToPayment(ctx);
  }

  // Admin kiritishlari
  if ((step === "admin_models_anthropic" || step === "admin_models_openai") && isAdmin(ctx.from.id)) {
    const provider = step.endsWith("anthropic") ? "anthropic" : "openai";
    ctx.session.step = "idle";
    if (/^default$/i.test(text.trim())) {
      db.setSetting(provider + "_main_model", ""); db.setSetting(provider + "_cheap_model", "");
      return ctx.reply("✅ Standart modellar tiklandi");
    }
    const parts = text.trim().split(/\s+/);
    const valid = parts.length === 2 && parts.every(p => /^[A-Za-z0-9._:-]{3,80}$/.test(p));
    if (!valid) return ctx.reply("Format: <code>asosiy_model arzon_model</code>", { parse_mode:"HTML" });
    db.setSetting(provider + "_main_model", parts[0]); db.setSetting(provider + "_cheap_model", parts[1]);
    await ctx.reply(`✅ Saqlandi:\nasosiy — <code>${esc(parts[0])}</code>\narzon — <code>${esc(parts[1])}</code>\n\nTekshirilmoqda...`, { parse_mode:"HTML" });
    return ctx.reply(await modelTestReport(), { parse_mode: "HTML" });
  }
  if ((step === "admin_price_t" || step === "admin_price_m") && isAdmin(ctx.from.id)) {
    const pts = text.split(/\s+/).map(Number);
    if (pts.length !== 2 || !pts.every(n => Number.isInteger(n) && n >= 0 && n <= 10_000_000))
      return ctx.reply("Format: <code>bazaviy birlik_narxi</code> (butun sonlar)", { parse_mode:"HTML" });
    if (step === "admin_price_t") { db.setSetting("base_price", pts[0]); db.setSetting("price_per_slide", pts[1]); }
    else { db.setSetting("mustaqil_base_price", pts[0]); db.setSetting("mustaqil_price_per_page", pts[1]); }
    ctx.session.step = "idle";
    return ctx.reply("✅ Narx yangilandi\n\n"+priceText(), { parse_mode:"HTML" });
  }
  if (step === "admin_find_order" && isAdmin(ctx.from.id)) {
    const id = parseInt(text.replace(/^#/, ""), 10);
    if (!Number.isFinite(id)) return ctx.reply("Raqam yuboring.");
    ctx.session.step = "idle";
    return showOrder(ctx, id, false);
  }
  if (step === "admin_find_user" && isAdmin(ctx.from.id)) {
    let id = parseInt(text, 10);
    if (!/^\d+$/.test(text)) { const u = db.findUserByUsername(text); id = u ? u.tg_id : NaN; }
    if (!Number.isFinite(id)) return ctx.reply("Topilmadi. ID yoki @username yuboring.");
    ctx.session.step = "idle";
    return showUser(ctx, id, false);
  }
  if (step === "admin_promo_add" && isAdmin(ctx.from.id)) {
    const p = biz.parsePromoInput(text);
    if (p.error) return ctx.reply("⚠️ "+esc(p.error));
    biz.createPromo(p, ctx.from.id); ctx.session.step = "idle";
    return ctx.reply("✅ Promokod saqlandi:\n"+biz.promoLabel({ ...p, used: 0, max_uses: p.maxUses, work_type: p.workType, expires_at: p.expiresAt, active: 1 }), { parse_mode:"HTML" });
  }
  if (step === "admin_promo_del" && isAdmin(ctx.from.id)) {
    ctx.session.step = "idle";
    return ctx.reply(biz.deletePromo(text) ? "✅ O'chirildi" : "Bunday promokod yo'q");
  }
  if (step === "admin_balance" && isAdmin(ctx.from.id)) {
    const m = text.replace(/\s/g, "").match(/^([+-])(\d{1,8})$/);
    if (!m) return ctx.reply("Format: <code>+5000</code> yoki <code>-5000</code>", { parse_mode:"HTML" });
    const id = ctx.session.adminTarget, delta = (m[1] === "-" ? -1 : 1) * Number(m[2]);
    if (!db.getUser(id)) db.upsertUser(id, "", "");
    biz.addBalance(id, delta); ctx.session.step = "idle";
    if (delta > 0) bot.api.sendMessage(id, "🎁 Balansingizga "+biz.fmt(delta)+" "+currency()+" qo'shildi. Keyingi buyurtmada avtomatik ishlatiladi.").catch(() => {});
    return showUser(ctx, id, false);
  }
  if (step === "admin_set" && isAdmin(ctx.from.id)) {
    const key = ctx.session.adminSetting, meta = EDITABLE_SETTINGS[key];
    if (!meta) { ctx.session.step = "idle"; return; }
    const value = text === "-" ? "" : text;
    if (value && !meta.validate(value)) return ctx.reply("⚠️ Noto'g'ri qiymat. "+meta.hint);
    db.setSetting(key, value); ctx.session.step = "idle";
    return ctx.reply("✅ Saqlandi\n\n"+settingsText(), { parse_mode:"HTML", reply_markup: settingsKb() });
  }
  if (step === "admin_card" && isAdmin(ctx.from.id)) {
    const m = text.match(/^([\d\s]{8,})\s+(.+)$/);
    if (!m) return ctx.reply("Format: <code>raqam Familiya Ism</code>", { parse_mode:"HTML" });
    db.setSetting("card_number",m[1].trim().replace(/\s+/g," ")); db.setSetting("card_holder",m[2].trim());
    ctx.session.step = "idle";
    return ctx.reply("✅ Karta yangilandi");
  }
  if (step === "admin_add_admin" && isSuperAdmin(ctx.from.id)) {
    const id = parseInt(text,10); if (!Number.isFinite(id)) return ctx.reply("Raqam yuboring.");
    db.addAdmin(id,"",ctx.from.id); ctx.session.step="idle"; return ctx.reply("✅ Admin qo'shildi: "+id);
  }
  if (step === "admin_del_admin" && isSuperAdmin(ctx.from.id)) {
    const id = parseInt(text,10); if (!Number.isFinite(id)) return ctx.reply("Raqam yuboring.");
    db.removeAdmin(id); ctx.session.step="idle"; return ctx.reply("✅ O'chirildi: "+id);
  }
  if (step === "admin_add_free" && isAdmin(ctx.from.id)) {
    const id = parseInt(text,10); if (!Number.isFinite(id)) return ctx.reply("Raqam yuboring.");
    db.addFreeUser(id,"",ctx.from.id); ctx.session.step="idle";
    try { await bot.api.sendMessage(id,"🎁 Sizga bepul foydalanish huquqi berildi! /start bosing."); } catch(_){}
    return ctx.reply("✅ Bepul user qo'shildi: "+id);
  }
  if (step === "admin_del_free" && isAdmin(ctx.from.id)) {
    const id = parseInt(text,10); if (!Number.isFinite(id)) return ctx.reply("Raqam yuboring.");
    db.removeFreeUser(id); ctx.session.step="idle"; return ctx.reply("✅ O'chirildi: "+id);
  }

  if (step === "idle") return ctx.reply("Menyudan tanlang 👇", { reply_markup: mainMenu(ctx.from.id) });
});

// ── FAYL ───────────────────────────────────────────────────
bot.on("message:document", async (ctx) => {
  if (ctx.session.step === "await_receipt") {
    const mime = ctx.message.document.mime_type || "";
    if (/^image\/|pdf$/.test(mime)) return handleReceipt(ctx, { document: ctx.message.document.file_id });
    return ctx.reply("Chekni rasm (skrinshot) yoki PDF ko'rinishida yuboring.");
  }
  if (ctx.session.step !== "await_content_upload") return;
  const doc = ctx.message.document, name = doc.file_name||"file", ext = path.extname(name).toLowerCase();
  if (![".txt",".md",".docx",".pdf"].includes(ext)) return ctx.reply("Faqat .txt, .docx yoki .pdf.");
  if (doc.file_size > 15*1024*1024) return ctx.reply("Fayl juda katta (maks 15MB).");
  await ctx.reply("⏳ Fayl o'qilmoqda...");
  try {
    const file = await ctx.getFile();
    const url = "https://api.telegram.org/file/bot"+config.botToken+"/"+file.file_path;
    const tmpDir = path.join(__dirname,"..","tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir,{recursive:true});
    const tmp = path.join(tmpDir, ctx.from.id+"_"+Date.now()+ext);
    fs.writeFileSync(tmp, Buffer.from(await (await fetch(url)).arrayBuffer()));
    const raw = await extractText(tmp, name);
    fs.unlink(tmp, ()=>{});
    const cleaned = cleanText(raw);
    if (cleaned.length < 20) return ctx.reply("Matn topilmadi. Boshqa fayl yuboring.");
    ctx.session.draft.has_content = true; ctx.session.draft.content_text = cleaned;
    await ctx.reply("✅ "+cleaned.length+" belgi matn olindi.");
    return proceedToPayment(ctx);
  } catch(e) { return ctx.reply("⚠️ "+esc(e.message||"Xato")); }
});

// ── TO'LOV / BEPUL ─────────────────────────────────────────
function orderFields(ctx, d, extra) {
  return {
    user_tg_id: ctx.from.id, work_type: d.workType||"taqdimot",
    topic: d.topic, slides: d.slides, pages: d.pages,
    student_name: d.studentName||"", student_group: d.studentGroup||"",
    language: d.language||"o'zbek",
    university: d.university||"", faculty: d.faculty||"", department: d.department||"",
    supervisor: d.supervisor||"", include_toc: d.includeToc ? 1 : 0,
    has_content: d.has_content, content_text: d.content_text,
    currency: currency(), ...extra,
  };
}
// Promokodni buyurtmaga biriktiradi; poyga holatida limit tugagan bo'lsa false
// Promokod, taklif chegirmasi va bonus balansni buyurtmaga biriktiradi; holat o'zgargan bo'lsa false
function attachPromo(orderId, userId, d) {
  if (d.promoCode) {
    if (!biz.redeemPromo(d.promoCode, userId, orderId)) return false;
    db.updateOrder(orderId, { promo_code: d.promoCode, discount: d.discount || 0 });
  } else if (d.refDiscount) {
    db.updateOrder(orderId, { promo_code: "REF", discount: d.refDiscount });
  }
  if (d.balanceUse) {
    const spent = biz.spendBalance(userId, orderId, d.balanceUse);
    if (spent < d.balanceUse) { biz.releasePromo(orderId); biz.releaseBalance(orderId); return false; }
  }
  return true;
}

async function proceedToPayment(ctx) {
  const d = ctx.session.draft;
  const isMustaqil = d.workType === "mustaqil";
  const baseAmount = isMustaqil ? calcMustaqilPrice(d.pages||15) : calcPrice(d.slides||10);
  let amount = isFree(ctx.from.id) ? 0 : baseAmount;
  d.discount = 0;
  if (!isFree(ctx.from.id) && d.promoCode) {
    const chk = biz.checkPromo(d.promoCode, { userId: ctx.from.id, workType: d.workType || "taqdimot", amount: baseAmount });
    if (chk.error) { await ctx.reply("⚠️ "+esc(chk.error)+" Promokod olib tashlandi."); d.promoCode = null; }
    else { amount = chk.final; d.discount = chk.discount; }
  }
  // Taklif orqali kelgan do'stga birinchi buyurtma chegirmasi (promokod bilan birga qo'llanmaydi)
  d.refDiscount = 0;
  if (!isFree(ctx.from.id) && !d.promoCode) {
    d.refDiscount = biz.referralDiscountFor(ctx.from.id, amount);
    amount -= d.refDiscount;
  }
  // Bonus balans avtomatik ishlatiladi
  d.balanceUse = isFree(ctx.from.id) ? 0 : Math.min(biz.getBalance(ctx.from.id), amount);
  amount -= d.balanceUse;
  d.amount = amount;

  // VIP kunlik limiti (adminlarga taalluqli emas)
  if (isFree(ctx.from.id) && !isAdmin(ctx.from.id)) {
    const q = biz.vipQuota(ctx.from.id);
    if (q.limit && q.left <= 0) {
      ctx.session.step = "idle";
      return ctx.reply("⏳ Bugungi bepul limit tugadi ("+q.limit+" ta). Ertaga yana foydalanishingiz mumkin."+supportLine(), { reply_markup: mainMenu(ctx.from.id) });
    }
  }

  // Chegirma/balans narxni to'liq qoplasa — to'lovsiz bajariladi
  if (!isFree(ctx.from.id) && amount === 0 && (d.promoCode || d.balanceUse || d.refDiscount)) {
    const orderId = db.createOrder(orderFields(ctx, d, { amount: 0, status: "paid", payment_method: d.balanceUse ? "balance" : "promo" }));
    if (!attachPromo(orderId, ctx.from.id, d)) {
      biz.cancelOrder(orderId); db.updateOrder(orderId, { status: "cancelled" });
      d.promoCode = null;
      await ctx.reply("⚠️ Promokod yoki balans holati o'zgardi — narx qayta hisoblandi.");
      return proceedToPayment(ctx);
    }
    ctx.session.step = "idle";
    await ctx.reply((d.balanceUse ? "💰 Bonus balansdan to'landi!" : "🎟 Chegirma qo'llandi — to'lovsiz!")+"\n\n📌 "+esc(d.topic)+"\n\nTayyorlanmoqda...", { parse_mode:"HTML" });
    fulfill.fulfillOrder(orderId).catch((e)=>console.error(e));
    return;
  }

  if (isFree(ctx.from.id)) {
    const orderId = db.createOrder(orderFields(ctx, d, { amount: 0, status: "paid", payment_method: "free" }));
    ctx.session.step = "idle";
    await ctx.reply(
      "🎁 Bepul rejim — to'lovsiz!\n\n📌 "+esc(d.topic)+"\n"+
      (isMustaqil ? "📄 "+d.pages+" sahifa" : "🎨 "+d.slides+" slayd")+
      "\n\nTayyorlanmoqda...",
      { parse_mode:"HTML" }
    );
    fulfill.fulfillOrder(orderId).catch((e)=>console.error(e));
    return;
  }

  ctx.session.step = "await_payment_method";
  const methods = paymentMethodsInline();
  if (!methods.inline_keyboard.flat().length) return ctx.reply("⚠️ To'lov usullari vaqtincha mavjud emas."+supportLine());
  if (!d.promoCode && biz.hasActivePromos()) methods.text("🎟 Promokod kiritish","promo:enter").row();
  else if (d.promoCode) methods.text("✖️ Promokodni olib tashlash","promo:clear").row();

  await ctx.reply(
    "🧾 <b>Buyurtma:</b>\n\n"+
    "📌 Mavzu: "+esc(d.topic)+"\n"+
    (isMustaqil ? "📄 Sahifalar: "+(d.pages||15)+" ta (Word .docx)\n" : "🎨 Slaydlar: "+(d.slides||10)+" ta (PowerPoint)\n")+
    "👤 "+esc(d.studentName||"—")+" — "+esc(d.studentGroup||"—")+"\n"+
    (isMustaqil && d.university ? "🏛 "+esc(d.university)+"\n" : "")+
    (isMustaqil ? "📑 "+(d.includeToc ? "Mundarija bilan" : "Reja bilan")+"\n" : "")+
    "📎 Kontent: "+(d.has_content ? "yuklangan" : "AI yaratadi")+"\n\n"+
    (d.discount || d.refDiscount || d.balanceUse ? "💰 Narx: <s>"+formatAmount(baseAmount)+"</s>\n" : "")+
    (d.discount ? "🎟 "+esc(d.promoCode)+": −"+formatAmount(d.discount)+"\n" : "")+
    (d.refDiscount ? "🤝 Do'st taklifi chegirmasi: −"+formatAmount(d.refDiscount)+"\n" : "")+
    (d.balanceUse ? "💰 Bonus balansdan: −"+formatAmount(d.balanceUse)+"\n" : "")+
    "💰 <b>To'lov: "+formatAmount(amount)+" "+currency()+"</b>\n\nTo'lov usuli:",
    { parse_mode:"HTML", reply_markup: methods }
  );
}

bot.callbackQuery(/^promo:(enter|clear)$/, async (ctx) => {
  if (ctx.session.step !== "await_payment_method") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  if (ctx.match[1] === "clear") { ctx.session.draft.promoCode = null; return proceedToPayment(ctx); }
  ctx.session.step = "await_promo";
  return ctx.reply("🎟 Promokodni yozing:");
});

bot.callbackQuery(/^pay:(manual|click|payme)$/, async (ctx) => {
  if (ctx.session.step !== "await_payment_method") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const method = ctx.match[1], d = ctx.session.draft;
  if (!d.topic) { ctx.session.step = "idle"; return ctx.reply("Buyurtma ma'lumotlari topilmadi. Qaytadan boshlang.", { reply_markup: mainMenu(ctx.from.id) }); }
  ctx.session.step = "creating_order"; // ikki marta bosilsa ikkita buyurtma yaratilmasin
  const orderId = db.createOrder(orderFields(ctx, d, { amount: d.amount, status: "awaiting_payment", payment_method: method }));
  if (!attachPromo(orderId, ctx.from.id, d)) {
    db.updateOrder(orderId, { status: "cancelled" });
    d.promoCode = null; ctx.session.step = "await_payment_method";
    await ctx.reply("⚠️ Promokod yoki balans holati o'zgardi — narx qayta hisoblandi.");
    return proceedToPayment(ctx);
  }
  ctx.session.draft.orderId = orderId;
  const isMustaqil = d.workType === "mustaqil";

  if (method === "manual") {
    ctx.session.step = "await_receipt";
    const cardNum = db.getSetting("card_number")||"— (karta sozlanmagan)";
    const cardHolder = db.getSetting("card_holder")||"—";
    await ctx.editMessageText(
      "💳 <b>Karta orqali to'lov</b>\n\nQuyidagi kartaga <b>"+formatAmount(d.amount)+" "+currency()+"</b> o'tkazing:\n\n"+
      "<code>"+esc(cardNum)+"</code>\n"+esc(cardHolder)+"\n\n"+
      "To'lovdan so'ng <b>chek/skrinshot</b> (rasm) yuboring.\n\n"+
      "Buyurtma: <b>#"+orderId+"</b>",
      { parse_mode:"HTML" }
    );
  } else if (method === "click") {
    const url = click.buildPaymentUrl(orderId, d.amount);
    ctx.session.step = "idle";
    await ctx.editMessageText("🟢 <b>Click</b> — #"+orderId+", "+formatAmount(d.amount)+" "+currency(),
      { parse_mode:"HTML", reply_markup: new InlineKeyboard().url("💳 To'lash",url) });
    await ctx.reply(isMustaqil ? "To'lov tasdiqlangach mustaqil ish avtomatik yuboriladi." : "To'lov tasdiqlangach taqdimot avtomatik yuboriladi.");
  } else if (method === "payme") {
    const url = payme.buildPaymentUrl(orderId, d.amount);
    ctx.session.step = "idle";
    await ctx.editMessageText("🔵 <b>Payme</b> — #"+orderId+", "+formatAmount(d.amount)+" "+currency(),
      { parse_mode:"HTML", reply_markup: new InlineKeyboard().url("💳 To'lash",url) });
    await ctx.reply(isMustaqil ? "To'lov tasdiqlangach mustaqil ish avtomatik yuboriladi." : "To'lov tasdiqlangach taqdimot avtomatik yuboriladi.");
  }
});

// ── CHEK (RASM) ────────────────────────────────────────────
// Chekni qaysi buyurtmaga tegishli ekanini aniqlash: sessiyadagi buyurtma yoki oxirgi 48 soatdagi to'lanmagan karta buyurtmasi
function receiptOrder(ctx) {
  if (ctx.session.step === "await_receipt" && ctx.session.draft.orderId) {
    const o = db.getOrder(ctx.session.draft.orderId);
    if (o && o.user_tg_id === ctx.from.id) return o;
  }
  return db.listOrdersByUser(ctx.from.id, 5).find(o => o.status === "awaiting_payment" && o.payment_method === "manual" && o.created_at > Date.now() - 48 * 3600000) || null;
}
bot.on("message:photo", async (ctx) => handleReceipt(ctx, { photo: ctx.message.photo[ctx.message.photo.length-1].file_id }));
async function handleReceipt(ctx, media) {
  const order = receiptOrder(ctx);
  if (!order) {
    if (ctx.session.step === "await_receipt") return ctx.reply("Buyurtma topilmadi. /start bilan qaytadan.");
    return ctx.reply("🤔 Bu rasm qaysi buyurtma uchun ekanini topa olmadim. Chek yuborish uchun avval buyurtma bering."+supportLine());
  }
  const orderId = order.id;
  db.updateOrder(orderId, { status:"awaiting_approval" });
  ctx.session.step = "idle";
  const isMustaqil = order.work_type === "mustaqil";
  const cap = (isMustaqil ? "📝 Mustaqil ish cheki" : "🧾 Taqdimot cheki")+"\n\n"+
    "Buyurtma: #"+orderId+"\nMavzu: "+order.topic+"\n"+
    (isMustaqil ? "Sahifalar: "+(order.pages||"?")+"\n" : "Slaydlar: "+(order.slides||"?")+"\n")+
    "Summa: "+formatAmount(order.amount)+" "+currency()+"\n"+
    "Talaba: "+(order.student_name||"—")+" "+(order.student_group||"")+"\n"+
    "Foydalanuvchi: "+(ctx.from.first_name||"")+" (@"+(ctx.from.username||"—")+", id:"+ctx.from.id+")";
  const kb = new InlineKeyboard().text("✅ Tasdiqlash","approve:"+orderId).text("❌ Rad etish","reject:"+orderId);
  const adminIds = [...new Set([...config.adminIds, ...db.listAdmins().map(a=>a.tg_id)])];
  let notified = false;
  for (const admin of adminIds) {
    try {
      if (media.photo) await bot.api.sendPhoto(admin, media.photo, { caption: cap, reply_markup: kb });
      else await bot.api.sendDocument(admin, media.document, { caption: cap, reply_markup: kb });
      notified=true;
    }
    catch(e) { console.error("[photo] admin "+admin+" xato:", e.message); }
  }
  if (isAdmin(ctx.from.id)) {
    await ctx.reply("✅ Chek qabul qilindi.\n\nAdmin sifatida #"+orderId+" ni tasdiqlashingiz mumkin:", { reply_markup: kb });
  } else {
    await ctx.reply("✅ Chek qabul qilindi. Administrator tasdiqlaydi ⏳");
  }
  if (!notified) console.error("[photo] DIQQAT: adminlarga yuborilmadi. ids="+JSON.stringify(adminIds));
}

// ── TASDIQLASH / RAD ───────────────────────────────────────
bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({text:"Ruxsat yo'q",show_alert:true});
  const orderId = parseInt(ctx.match[1],10);
  const order = db.getOrder(orderId);
  if (!order) return ctx.answerCallbackQuery({text:"Topilmadi",show_alert:true});
  if (["done","paid","generating"].includes(order.status)) return ctx.answerCallbackQuery({text:"Allaqachon ishlangan ✅",show_alert:true});
  db.updateOrder(orderId, { status:"paid" });
  await ctx.answerCallbackQuery({text:"Tasdiqlandi ✅"});
  bot.api.sendMessage(order.user_tg_id, "✅ To'lovingiz tasdiqlandi! Buyurtma #"+orderId+" tayyorlanmoqda.").catch(() => {});
  fulfill.fulfillOrder(orderId).catch((e)=>console.error("[approve]:",e.message));
  const addText = "\n\n✅ TASDIQLANDI (admin: "+ctx.from.id+")";
  try {
    const msg = ctx.callbackQuery.message;
    if (msg?.caption !== undefined) await ctx.editMessageCaption({ caption: (msg.caption||"")+addText });
    else if (msg?.text) await ctx.editMessageText(msg.text+addText);
  } catch(e) { console.log("[approve] tahrir xato (e'tiborsiz):", e.message); }
});

bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({text:"Ruxsat yo'q",show_alert:true});
  const orderId = parseInt(ctx.match[1],10);
  const order = db.getOrder(orderId);
  if (!order) return ctx.answerCallbackQuery({text:"Topilmadi",show_alert:true});
  if (["done","generating"].includes(order.status)) return ctx.answerCallbackQuery({text:"Buyurtma allaqachon bajarilgan",show_alert:true});
  db.updateOrder(orderId, { status:"rejected" });
  try { biz.releasePromo(orderId); biz.releaseBalance(orderId); } catch (_) {}
  await ctx.answerCallbackQuery({text:"Rad etildi ❌"});
  const addText = "\n\n❌ RAD ETILDI (admin: "+ctx.from.id+")";
  try {
    const msg = ctx.callbackQuery.message;
    if (msg?.caption !== undefined) await ctx.editMessageCaption({ caption: (msg.caption||"")+addText });
    else if (msg?.text) await ctx.editMessageText(msg.text+addText);
  } catch(_){}
  try { await bot.api.sendMessage(order.user_tg_id, "❌ Buyurtma #"+orderId+" bo'yicha to'lov tasdiqlanmadi (chek topilmadi yoki summa mos emas). Xato bo'lsa, administrator bilan bog'laning."+supportLine()); } catch(_){}
});

// ── TO'LANMAGAN BUYURTMA: eslatmadagi tugmalar ─────────────
bot.callbackQuery(/^(rcpt|ocancel):(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[2], 10), o = db.getOrder(id);
  if (!o || o.user_tg_id !== ctx.from.id || o.status !== "awaiting_payment")
    return ctx.answerCallbackQuery({ text: "Bu buyurtma endi faol emas", show_alert: true });
  await ctx.answerCallbackQuery();
  if (ctx.match[1] === "ocancel") {
    biz.cancelOrder(id);
    return ctx.editMessageText("🚫 Buyurtma #"+id+" bekor qilindi.").catch(() => {});
  }
  ctx.session.step = "await_receipt"; ctx.session.draft = { orderId: id };
  return ctx.reply("💳 <b>"+formatAmount(o.amount)+" "+currency()+"</b> ni kartaga o'tkazing:\n\n<code>"+esc(db.getSetting("card_number")||"—")+"</code>\n"+
    esc(db.getSetting("card_holder")||"")+"\n\nSo'ng chek rasmini shu yerga yuboring.", { parse_mode:"HTML" });
});

async function runReminders() {
  const { remind, expired, staleApprovals } = biz.dueReminders();
  for (const o of remind) {
    db.updateOrder(o.id, { reminded: 1 });
    const kb = new InlineKeyboard();
    if (o.payment_method === "manual") kb.text("📎 Chek yuborish","rcpt:"+o.id);
    kb.text("❌ Bekor qilish","ocancel:"+o.id);
    await bot.api.sendMessage(o.user_tg_id,
      "⏰ Buyurtma #"+o.id+" («"+(o.topic||"").slice(0, 60)+"») to'lovi kutilmoqda — "+formatAmount(o.amount)+" "+currency()+".\n\n"+
      (o.payment_method === "manual" ? "To'lov qilgan bo'lsangiz, chek rasmini yuboring." : "To'lovni yakunlasangiz, ish avtomatik tayyorlanadi."),
      { reply_markup: kb }).catch(() => {});
    await new Promise(r => setTimeout(r, 50));
  }
  for (const o of expired) {
    if (biz.cancelOrder(o.id, "expired")) {
      bot.api.sendMessage(o.user_tg_id, "⌛️ Buyurtma #"+o.id+" to'lanmagani uchun bekor qilindi. Istalgan vaqtda qaytadan buyurtma berishingiz mumkin.").catch(() => {});
    }
  }
  // Admin: 30 daqiqadan ortiq tasdiq kutayotgan cheklar — 2 soatda bir marta eslatish
  const lastAt = Number(db.getSetting("approval_remind_at", "0"));
  if (staleApprovals > 0 && Date.now() - lastAt > 2 * 3600000) {
    db.setSetting("approval_remind_at", Date.now());
    fulfill.notifyAdmins("⏳ "+staleApprovals+" ta chek 30 daqiqadan beri tasdiq kutmoqda. Mijozlar kutyapti!",
      { inline_keyboard: [[{ text: "📋 Ko'rish", callback_data: "adm:ord:pending" }]] });
  }
}

// ── STATUS ─────────────────────────────────────────────────
function statusLabel(s) {
  return ({draft:"qoralama",awaiting_payment:"⏳ to'lov kutilmoqda",awaiting_approval:"🔄 tasdiq kutilmoqda",
    paid:"💰 to'langan",generating:"⚙️ tayyorlanmoqda",done:"✅ tayyor",
    rejected:"❌ rad",failed:"⚠️ xato",free:"🎁 bepul",refunded:"💸 qaytarilgan",
    cancelled:"🚫 bekor qilingan",expired:"⌛️ muddati o'tgan"})[s]||s;
}

bot.catch((err) => { console.error("Bot xatosi:", err.error||err); });

async function main() {
  startServer();
  await bot.api.setMyCommands([
    { command:"start", description:"Boshlash / Bosh menyu" },
    { command:"cancel", description:"Bekor qilish" },
    { command:"id", description:"Telegram ID'imni ko'rsatish" },
  ]);
  console.log("Bot ishga tushdi.");
  console.log("Super adminlar:", config.adminIds.join(", "));
  bot.start();
  // Oldingi ishga tushirishda yarim qolgan buyurtmalar (server restart) qayta tayyorlanadi
  setInterval(() => runReminders().catch(e => console.error("[reminders]", e.message)), 5 * 60_000);
  setTimeout(() => fulfill.resumeStuckOrders(db.listOrdersByStatuses).then(count => {
    if (count) console.log(`[bot] ${count} ta yarim qolgan buyurtma davom ettirildi`);
  }), 5_000);
}
main().catch((e) => { console.error(e); process.exit(1); });
