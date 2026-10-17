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

assertConfig();
db.seedDefaults(config.defaults);

const bot = new Bot(config.botToken);
fulfill.init(bot);
bot.use(session({ initial: () => ({ step: "idle", draft: {} }) }));

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// ── RUXSATLAR ─────────────────────────────────────────────
const isSuperAdmin = (id) => config.adminIds.includes(id);
const isAdmin = (id) => isSuperAdmin(id) || db.isDbAdmin(id);
const isFree = (id) => isAdmin(id) || db.isFreeUser(id);
const needsStudentDetails = (id) => requiresStudentDetails({ isAdmin: isAdmin(id), isVip: db.isFreeUser(id) });

// ── MENYULAR ───────────────────────────────────────────────
function mainMenu(id) {
  const kb = new Keyboard()
    .text("🎨 Taqdimot yaratish").row()
    .text("📝 Mustaqil ish yaratish").row()
    .text("📂 Mening buyurtmalarim").text("ℹ️ Yordam").row();
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
  db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  ctx.session.step = "idle"; ctx.session.draft = {};
  const freeNote = isFree(ctx.from.id) ? "\n\n🎁 Sizda <b>bepul foydalanish</b> huquqi bor!" : "";
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
  await ctx.reply("🎁 Sizda bepul huquq bor. Taqdimot yoki mustaqil ish yaratishni tanlang.");
});

bot.hears("📂 Mening buyurtmalarim", async (ctx) => {
  const orders = db.listOrdersByUser(ctx.from.id, 10);
  if (!orders.length) return ctx.reply("Sizda hali buyurtmalar yo'q.");
  const lines = orders.map((o) => {
    const type = o.work_type === "mustaqil" ? "📝" : "🎨";
    const cnt = o.work_type === "mustaqil" ? (o.pages||"?")+"bet" : (o.slides||"?")+"sl";
    return type+" #"+o.id+" — "+esc((o.topic||"").slice(0,30))+" ("+cnt+") — "+statusLabel(o.status);
  });
  await ctx.reply("📂 Buyurtmalaringiz:\n\n"+lines.join("\n"), { parse_mode:"HTML" });
});

bot.hears("ℹ️ Yordam", async (ctx) => {
  await ctx.reply(
    "ℹ️ <b>Qanday ishlaydi:</b>\n\n"+
    "🎨 <b>Taqdimot</b> (.pptx):\n"+
    "  Mavzu → Slaydlar soni → Ism+Guruh (oddiy foydalanuvchilar uchun) → Kontent → To'lov → Fayl\n\n"+
    "📝 <b>Mustaqil ish</b> (.docx, GOST formati):\n"+
    "  Mavzu → Sahifalar → Til → Ism+Guruh (oddiy foydalanuvchilar uchun) → Kontent → To'lov → Fayl\n\n"+
    "Adminlar va VIP foydalanuvchilardan ism-guruh so'ralmaydi.\n"+
    "📌 Formulalar, grafiklar, jadvallar avtomatik qo'shiladi.\n\n"+
    "/cancel — bekor qilish\n/id — Telegram ID",
    { parse_mode:"HTML" }
  );
});

// ── ADMIN PANEL ────────────────────────────────────────────
bot.hears("🛠 Admin panel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.reply("🛠 <b>Admin panel</b>", { parse_mode:"HTML", reply_markup: adminMain(ctx.from.id) });
});

function adminMain(id) {
  const kb = new InlineKeyboard()
    .text("📊 Buyurtmalar","adm:orders").row()
    .text("💳 To'lov usullari","adm:pay").row()
    .text("🤖 AI — Taqdimot","adm:provider").row()
    .text("📝 AI — Mustaqil ish","adm:mustaqil_provider").row()
    .text("💰 Narx","adm:price").text("💳 Karta","adm:card").row()
    .text("🎁 Bepul users","adm:free").row();
  if (isSuperAdmin(id)) kb.text("👥 Adminlar","adm:admins").row();
  return kb;
}

// --- Buyurtmalar ---
bot.callbackQuery("adm:orders", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("📊 <b>Buyurtmalar</b>", { parse_mode:"HTML", reply_markup: new InlineKeyboard()
    .text("✅ Tasdiqlangan","adm:ord:done").row()
    .text("⏳ Tasdiqlanmagan","adm:ord:pending").row()
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
  await ctx.editMessageText(body, { parse_mode:"HTML", reply_markup: new InlineKeyboard().text("⬅️ Orqaga","adm:orders") });
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
    .text("⬅️ Orqaga","adm:back");
}
bot.callbackQuery(/^adm:toggle:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const k = ctx.match[1]; db.setSetting(k, db.getSetting(k)==="1" ? "0" : "1");
  await ctx.answerCallbackQuery(db.getSetting(k)==="1" ? "Yoqildi ✅" : "O'chirildi ❌");
  await ctx.editMessageReplyMarkup({ reply_markup: payInline() });
});

// --- AI Provayder (Taqdimot) ---
bot.callbackQuery("adm:provider", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const a=config.anthropicApiKey?"✅":"❌", o=config.openaiApiKey?"✅":"❌";
  await ctx.editMessageText(
    "🤖 <b>Taqdimot uchun AI provayder:</b>\n\nKalitlar: Anthropic "+a+"  OpenAI "+o,
    { parse_mode:"HTML", reply_markup: providerInline("llm_provider","prov") }
  );
});
// --- AI Provayder (Mustaqil ish) ---
bot.callbackQuery("adm:mustaqil_provider", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const a=config.anthropicApiKey?"✅":"❌", o=config.openaiApiKey?"✅":"❌";
  await ctx.editMessageText(
    "📝 <b>Mustaqil ish uchun AI provayder:</b>\n\nKalitlar: Anthropic "+a+"  OpenAI "+o+"\n\n<i>Tavsiya: Mustaqil ish uchun Claude (Anthropic) kontent sifati yaxshiroq.</i>",
    { parse_mode:"HTML", reply_markup: providerInline("mustaqil_llm_provider","mprov") }
  );
});
function providerInline(settingKey, prefix) {
  const cur = db.getSetting(settingKey, "anthropic") || "anthropic";
  const m = (p) => cur===p ? "🔘 " : "⚪️ ";
  return new InlineKeyboard()
    .text(m("anthropic")+"Anthropic (Claude)", prefix+":anthropic").row()
    .text(m("openai")+"OpenAI (GPT)", prefix+":openai").row()
    .text(m("both")+"Ikkalasi (zaxirali)", prefix+":both").row()
    .text("⬅️ Orqaga","adm:back");
}
bot.callbackQuery(/^prov:(anthropic|openai|both)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const p = ctx.match[1];
  if ((p==="anthropic"||p==="both") && !config.anthropicApiKey) return ctx.answerCallbackQuery({text:"ANTHROPIC_API_KEY yo'q!",show_alert:true});
  if ((p==="openai"||p==="both") && !config.openaiApiKey) return ctx.answerCallbackQuery({text:"OPENAI_API_KEY yo'q!",show_alert:true});
  db.setSetting("llm_provider", p);
  await ctx.answerCallbackQuery("Saqlandi ✅");
  await ctx.editMessageReplyMarkup({ reply_markup: providerInline("llm_provider","prov") });
});
bot.callbackQuery(/^mprov:(anthropic|openai|both)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const p = ctx.match[1];
  if ((p==="anthropic"||p==="both") && !config.anthropicApiKey) return ctx.answerCallbackQuery({text:"ANTHROPIC_API_KEY yo'q!",show_alert:true});
  if ((p==="openai"||p==="both") && !config.openaiApiKey) return ctx.answerCallbackQuery({text:"OPENAI_API_KEY yo'q!",show_alert:true});
  db.setSetting("mustaqil_llm_provider", p);
  await ctx.answerCallbackQuery("Saqlandi ✅");
  await ctx.editMessageReplyMarkup({ reply_markup: providerInline("mustaqil_llm_provider","mprov") });
});

// --- Narx / Karta ---
bot.callbackQuery("adm:price", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  ctx.session.step = "admin_price"; await ctx.answerCallbackQuery();
  await ctx.reply(
    "Hozirgi:\n"+
    "• Taqdimot: "+db.getSetting("base_price")+"+"+db.getSetting("price_per_slide")+"/slayd\n"+
    "• Mustaqil ish: "+db.getSetting("mustaqil_price_per_page",db.getSetting("price_per_slide","5000"))+"/sahifa\n\n"+
    "Yangi taqdimot narxini yuboring: <code>bazaviy per_slayd</code>\nMasalan: <code>0 5000</code>",
    { parse_mode:"HTML" }
  );
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
    return ctx.reply("Sahifa sonini yozing ("+config.minSlides+"–"+config.maxSlides+"):");
  }
  ctx.session.draft.slides = parseInt(val, 10);
  await ctx.editMessageText("✅ Sahifa soni: "+val);
  await askStudentDetailsOrContinue(ctx);
});

// Til tanlash (mustaqil ish)
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
  await ctx.reply("🌐 Mustaqil ish tilini tanlang:", { reply_markup: langInline() });
}
async function askContent(ctx) {
  await ctx.reply(
    "📎 Kontent bormi?\n\n"+
    "• <b>Yuklayman</b> — .docx/.txt/.pdf yoki matn berасиз\n"+
    "• <b>AI yozsin</b> — mavzudan avtomatik yaratiladi",
    { parse_mode:"HTML", reply_markup: contentInline() }
  );
}
async function continueWithoutStudentDetails(ctx) {
  ctx.session.draft.studentName = "";
  ctx.session.draft.studentGroup = "";
  ctx.session.step = "await_content_choice";
  return askContent(ctx);
}
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
    await ctx.reply("✅ Sahifa soni: "+n);
    return askStudentDetailsOrContinue(ctx);
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
    ctx.session.step = "await_content_choice";
    await ctx.reply("✅ "+esc(ctx.session.draft.studentName)+" — "+esc(text));
    return askContent(ctx);
  }

  if (step === "await_content_upload") {
    const cleaned = cleanText(text);
    if (cleaned.length < 20) return ctx.reply("Kontent juda qisqa. Ko'proq matn yuboring.");
    ctx.session.draft.has_content = true; ctx.session.draft.content_text = cleaned;
    await ctx.reply("✅ Kontent qabul qilindi ("+cleaned.length+" belgi).");
    return proceedToPayment(ctx);
  }

  // Admin kiritishlari
  if (step === "admin_price" && isAdmin(ctx.from.id)) {
    const pts = text.split(/\s+/).map(Number);
    if (pts.length<2||!Number.isFinite(pts[0])||!Number.isFinite(pts[1]))
      return ctx.reply("Format: <code>bazaviy per_slayd</code>", { parse_mode:"HTML" });
    db.setSetting("base_price", pts[0]); db.setSetting("price_per_slide", pts[1]);
    db.setSetting("mustaqil_price_per_page", pts[1]); // mustaqil uchun ham bir xil
    ctx.session.step = "idle";
    return ctx.reply("✅ Narx yangilandi");
  }
  if (step === "admin_card" && isAdmin(ctx.from.id)) {
    const m = text.match(/^([\d\s]{8,})\s+(.+)$/);
    if (!m) return ctx.reply("Format: <code>raqam Familiya Ism</code>", { parse_mode:"HTML" });
    db.setSetting("card_number",m[1].trim()); db.setSetting("card_holder",m[2].trim());
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
async function proceedToPayment(ctx) {
  const d = ctx.session.draft;
  const isMustaqil = d.workType === "mustaqil";
  const amount = isFree(ctx.from.id) ? 0 : (isMustaqil ? calcMustaqilPrice(d.pages||15) : calcPrice(d.slides||10));
  d.amount = amount;

  if (isFree(ctx.from.id)) {
    const orderId = db.createOrder({
      user_tg_id: ctx.from.id, work_type: d.workType||"taqdimot",
      topic: d.topic, slides: d.slides, pages: d.pages,
      student_name: d.studentName||"", student_group: d.studentGroup||"",
      language: d.language||"o'zbek",
      has_content: d.has_content, content_text: d.content_text,
      amount: 0, currency: currency(), status: "paid", payment_method: "free",
    });
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
  if (!methods.inline_keyboard.flat().length) return ctx.reply("⚠️ To'lov usullari mavjud emas.");

  await ctx.reply(
    "🧾 <b>Buyurtma:</b>\n\n"+
    "📌 Mavzu: "+esc(d.topic)+"\n"+
    (isMustaqil ? "📄 Sahifalar: "+(d.pages||15)+" ta (Word .docx)\n" : "🎨 Slaydlar: "+(d.slides||10)+" ta (PowerPoint)\n")+
    "👤 "+esc(d.studentName||"—")+" — "+esc(d.studentGroup||"—")+"\n"+
    "📎 Kontent: "+(d.has_content ? "yuklangan" : "AI yaratadi")+"\n\n"+
    "💰 <b>Narx: "+formatAmount(amount)+" "+currency()+"</b>\n\nTo'lov usuli:",
    { parse_mode:"HTML", reply_markup: methods }
  );
}

bot.callbackQuery(/^pay:(manual|click|payme)$/, async (ctx) => {
  if (ctx.session.step !== "await_payment_method") return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const method = ctx.match[1], d = ctx.session.draft;
  const orderId = db.createOrder({
    user_tg_id: ctx.from.id, work_type: d.workType||"taqdimot",
    topic: d.topic, slides: d.slides, pages: d.pages,
    student_name: d.studentName||"", student_group: d.studentGroup||"",
    language: d.language||"o'zbek",
    has_content: d.has_content, content_text: d.content_text,
    amount: d.amount, currency: currency(), status: "awaiting_payment", payment_method: method,
  });
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
bot.on("message:photo", async (ctx) => {
  if (ctx.session.step !== "await_receipt") { console.log("[photo] step="+ctx.session.step); return; }
  const orderId = ctx.session.draft.orderId;
  const order = orderId ? db.getOrder(orderId) : null;
  if (!order) return ctx.reply("Buyurtma topilmadi. /start bilan qaytadan.");
  db.updateOrder(orderId, { status:"awaiting_approval" });
  ctx.session.step = "idle";
  const photo = ctx.message.photo[ctx.message.photo.length-1].file_id;
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
    try { await bot.api.sendPhoto(admin, photo, { caption: cap, reply_markup: kb }); notified=true; }
    catch(e) { console.error("[photo] admin "+admin+" xato:", e.message); }
  }
  if (isAdmin(ctx.from.id)) {
    await ctx.reply("✅ Chek qabul qilindi.\n\nAdmin sifatida #"+orderId+" ni tasdiqlashingiz mumkin:", { reply_markup: kb });
  } else {
    await ctx.reply("✅ Chek qabul qilindi. Administrator tasdiqlaydi ⏳");
  }
  if (!notified) console.error("[photo] DIQQAT: adminlarga yuborilmadi. ids="+JSON.stringify(adminIds));
});

// ── TASDIQLASH / RAD ───────────────────────────────────────
bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({text:"Ruxsat yo'q",show_alert:true});
  const orderId = parseInt(ctx.match[1],10);
  const order = db.getOrder(orderId);
  if (!order) return ctx.answerCallbackQuery({text:"Topilmadi",show_alert:true});
  if (["done","paid","generating"].includes(order.status)) return ctx.answerCallbackQuery({text:"Allaqachon ishlangan ✅",show_alert:true});
  db.updateOrder(orderId, { status:"paid" });
  await ctx.answerCallbackQuery({text:"Tasdiqlandi ✅"});
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
  db.updateOrder(orderId, { status:"rejected" });
  await ctx.answerCallbackQuery({text:"Rad etildi ❌"});
  const addText = "\n\n❌ RAD ETILDI (admin: "+ctx.from.id+")";
  try {
    const msg = ctx.callbackQuery.message;
    if (msg?.caption !== undefined) await ctx.editMessageCaption({ caption: (msg.caption||"")+addText });
    else if (msg?.text) await ctx.editMessageText(msg.text+addText);
  } catch(_){}
  try { await bot.api.sendMessage(order.user_tg_id, "❌ Buyurtma #"+orderId+" rad etildi. Administrator bilan bog'laning."); } catch(_){}
});

// ── STATUS ─────────────────────────────────────────────────
function statusLabel(s) {
  return ({draft:"qoralama",awaiting_payment:"⏳ to'lov kutilmoqda",awaiting_approval:"🔄 tasdiq kutilmoqda",
    paid:"💰 to'langan",generating:"⚙️ tayyorlanmoqda",done:"✅ tayyor",
    rejected:"❌ rad",failed:"⚠️ xato",free:"🎁 bepul"})[s]||s;
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
}
main().catch((e) => { console.error(e); process.exit(1); });
