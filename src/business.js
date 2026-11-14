// src/business.js
// Biznes mantiq: statistika, promokodlar, VIP limitlari, xarajat nazorati, CSV hisobot.
// Telegram'ga bog'liq emas — testlarda to'g'ridan-to'g'ri tekshiriladi.

const dbm = require("./db");
const { db, getSetting } = dbm;

const PAID_STATUSES = ["paid", "generating", "done"];
const DAY = 24 * 60 * 60 * 1000;

function startOfToday(now = Date.now()) {
  // O'zbekiston vaqti (UTC+5) bo'yicha kun boshi
  const offset = 5 * 60 * 60 * 1000;
  return Math.floor((now + offset) / DAY) * DAY - offset;
}

function usdRate() {
  const rate = Number(getSetting("usd_rate", "12800"));
  return Number.isFinite(rate) && rate > 0 ? rate : 12800;
}

// ── STATISTIKA ─────────────────────────────────────────────
function periodStats(since = 0) {
  const ph = PAID_STATUSES.map(() => "?").join(",");
  const row = db.prepare(`SELECT
      COUNT(*) AS orders,
      SUM(CASE WHEN status IN (${ph}) THEN 1 ELSE 0 END) AS paid_orders,
      SUM(CASE WHEN status IN (${ph}) AND COALESCE(payment_method,'') NOT IN ('free','promo') THEN amount ELSE 0 END) AS revenue,
      SUM(CASE WHEN status IN (${ph}) AND COALESCE(payment_method,'') IN ('free','promo') THEN 1 ELSE 0 END) AS free_orders,
      SUM(CASE WHEN status IN (${ph}) AND work_type = 'mustaqil' THEN 1 ELSE 0 END) AS mustaqil,
      SUM(CASE WHEN status IN (${ph}) AND COALESCE(work_type,'taqdimot') = 'taqdimot' THEN 1 ELSE 0 END) AS taqdimot,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'awaiting_payment' THEN 1 ELSE 0 END) AS unpaid,
      SUM(COALESCE(cost_usd,0)) AS cost_usd,
      SUM(COALESCE(discount,0)) AS discounts
    FROM orders WHERE created_at >= ?`).get(...PAID_STATUSES, ...PAID_STATUSES, ...PAID_STATUSES, ...PAID_STATUSES, ...PAID_STATUSES, since);
  const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?").get(since).n;
  const buyers = db.prepare(`SELECT COUNT(DISTINCT user_tg_id) AS n FROM orders
    WHERE created_at >= ? AND status IN (${ph}) AND COALESCE(payment_method,'') NOT IN ('free','promo')`).get(since, ...PAID_STATUSES).n;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = Number(v) || 0;
  out.new_users = users;
  out.buyers = buyers;
  out.cost_sum = Math.round(out.cost_usd * usdRate());
  out.profit = out.revenue - out.cost_sum;
  out.avg_check = out.paid_orders - out.free_orders > 0 ? Math.round(out.revenue / (out.paid_orders - out.free_orders)) : 0;
  return out;
}

function overallCounters() {
  return {
    users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    active7: db.prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?").get(Date.now() - 7 * DAY).n,
    banned: db.prepare("SELECT COUNT(*) AS n FROM users WHERE COALESCE(banned,0) = 1").get().n,
    referred: db.prepare("SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL").get().n,
    referredPaid: db.prepare("SELECT COUNT(*) AS n FROM users WHERE ref_rewarded = 1").get().n,
    balances: db.prepare("SELECT SUM(COALESCE(balance,0)) AS s FROM users").get().s || 0,
    awaitingApproval: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'awaiting_approval'").get().n,
    generating: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','generating')").get().n,
  };
}

function fmt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

function statsReport(now = Date.now()) {
  const cur = getSetting("currency", "so'm");
  const today = periodStats(startOfToday(now));
  const week = periodStats(now - 7 * DAY);
  const month = periodStats(now - 30 * DAY);
  const all = periodStats(0);
  const c = overallCounters();
  const block = (title, s) =>
    `<b>${title}</b>\n` +
    `💰 Tushum: <b>${fmt(s.revenue)} ${cur}</b> · AI xarajat ≈ ${fmt(s.cost_sum)} · Foyda ≈ <b>${fmt(s.profit)}</b>\n` +
    `🧾 To'langan: ${s.paid_orders - s.free_orders} (🎨 ${s.taqdimot} / 📝 ${s.mustaqil} jami) · 🎁 bepul: ${s.free_orders}\n` +
    `👤 Yangi: ${s.new_users} · Xaridor: ${s.buyers} · O'rtacha chek: ${fmt(s.avg_check)}\n` +
    `⚠️ Xato: ${s.failed} · ❌ Rad: ${s.rejected} · ⏳ To'lanmagan: ${s.unpaid}` +
    (s.discounts ? `\n🎟 Chegirma: ${fmt(s.discounts)} ${cur}` : "");
  return `📈 <b>Statistika</b>\n\n` +
    `👥 Foydalanuvchilar: <b>${c.users}</b> (7 kunda faol: ${c.active7}, bloklangan: ${c.banned})\n` +
    `🤝 Taklif orqali: ${c.referred} (to'laganlar: ${c.referredPaid}) · Bonus balanslar: ${fmt(c.balances)} ${cur}\n` +
    `🔄 Tasdiq kutayotgan cheklar: <b>${c.awaitingApproval}</b> · Tayyorlanmoqda: ${c.generating}\n\n` +
    [block("📅 Bugun", today), block("🗓 7 kun", week), block("📆 30 kun", month), block("♾ Jami", all)].join("\n\n") +
    `\n\n<i>AI xarajat 1$ = ${fmt(usdRate())} so'm kursida hisoblangan.</i>`;
}

// ── CSV HISOBOT ────────────────────────────────────────────
function ordersCsv(since = 0) {
  const rows = db.prepare(`SELECT id, created_at, user_tg_id, work_type, topic, slides, pages, language,
      amount, discount, promo_code, payment_method, status, cost_usd FROM orders WHERE created_at >= ? ORDER BY id`).all(since);
  const cols = ["id", "sana", "user_id", "turi", "mavzu", "slayd", "sahifa", "til", "summa", "chegirma", "promokod", "tolov", "holat", "ai_xarajat_usd"];
  const q = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [r.id, new Date(r.created_at || 0).toISOString().slice(0, 16).replace("T", " "), r.user_tg_id,
    r.work_type, r.topic, r.slides, r.pages, r.language, r.amount, r.discount, r.promo_code, r.payment_method, r.status,
    r.cost_usd ? Number(r.cost_usd).toFixed(4) : ""].map(q).join(","));
  return "﻿" + [cols.join(",")].concat(lines).join("\n");
}

// ── PROMOKODLAR ────────────────────────────────────────────
// Format: "KOD 20%" | "KOD 5000" | "KOD 20% 100" (100 marta) | "KOD 20% 100 mustaqil" | "... 7kun"
function parsePromoInput(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (parts.length < 2) return { error: "Format: KOD 20% [limit] [taqdimot|mustaqil] [7kun]" };
  const code = parts[0].toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return { error: "Kod 3–20 belgi: lotin harf, raqam, _ yoki -" };
  const valueMatch = parts[1].match(/^(\d+)(%?)$/);
  if (!valueMatch) return { error: "Qiymat: 20% yoki 5000" };
  const kind = valueMatch[2] ? "percent" : "fixed";
  const value = Number(valueMatch[1]);
  if (kind === "percent" && (value < 1 || value > 100)) return { error: "Foiz 1–100 oralig'ida bo'lsin" };
  if (kind === "fixed" && value < 1) return { error: "Summa musbat bo'lsin" };
  let maxUses = 0, workType = "", expiresAt = 0;
  for (const p of parts.slice(2)) {
    if (/^\d+$/.test(p)) maxUses = Number(p);
    else if (/^(taqdimot|mustaqil)$/i.test(p)) workType = p.toLowerCase();
    else if (/^(\d+)kun$/i.test(p)) expiresAt = Date.now() + Number(p.match(/^(\d+)/)[1]) * DAY;
    else return { error: "Noma'lum parametr: " + p };
  }
  return { code, kind, value, maxUses, workType, expiresAt };
}

function createPromo(p, createdBy) {
  db.prepare(`INSERT INTO promo_codes(code,kind,value,max_uses,used,work_type,expires_at,active,created_by,created_at)
    VALUES(?,?,?,?,0,?,?,1,?,?) ON CONFLICT(code) DO UPDATE SET kind=excluded.kind, value=excluded.value,
    max_uses=excluded.max_uses, work_type=excluded.work_type, expires_at=excluded.expires_at, active=1`)
    .run(p.code, p.kind, p.value, p.maxUses || 0, p.workType || "", p.expiresAt || 0, createdBy || null, Date.now());
}
function deletePromo(code) { return db.prepare("DELETE FROM promo_codes WHERE code = ?").run(String(code || "").toUpperCase()).changes > 0; }
function listPromos() { return db.prepare("SELECT * FROM promo_codes ORDER BY created_at DESC").all(); }

function promoLabel(p) {
  const val = p.kind === "percent" ? `${p.value}%` : `${fmt(p.value)} so'm`;
  const lim = p.max_uses ? `${p.used}/${p.max_uses}` : `${p.used}/∞`;
  const wt = p.work_type ? ` · ${p.work_type}` : "";
  const exp = p.expires_at ? ` · ${new Date(p.expires_at).toISOString().slice(0, 10)} gacha` : "";
  return `<code>${p.code}</code> — ${val} · ${lim}${wt}${exp}${p.active ? "" : " · o'chiq"}`;
}

// Promokodni tekshirib, chegirmani hisoblaydi (hali ishlatilgan deb belgilamaydi)
function checkPromo(code, { userId, workType, amount, now = Date.now() }) {
  const p = db.prepare("SELECT * FROM promo_codes WHERE code = ?").get(String(code || "").trim().toUpperCase());
  if (!p || !p.active) return { error: "Bunday promokod topilmadi." };
  if (p.expires_at && p.expires_at < now) return { error: "Promokod muddati tugagan." };
  if (p.max_uses && p.used >= p.max_uses) return { error: "Promokod limiti tugagan." };
  if (p.work_type && p.work_type !== workType) return { error: `Bu promokod faqat ${p.work_type === "mustaqil" ? "mustaqil ish" : "taqdimot"} uchun.` };
  if (db.prepare("SELECT 1 FROM promo_uses WHERE code = ? AND user_tg_id = ?").get(p.code, userId)) return { error: "Siz bu promokoddan foydalangansiz." };
  const raw = p.kind === "percent" ? Math.round(amount * p.value / 100) : p.value;
  const discount = Math.max(0, Math.min(amount, raw));
  return { code: p.code, discount, final: amount - discount, promo: p };
}

// Buyurtma yaratilganda chaqiriladi; poyga holatida limitdan oshmaslik uchun tranzaksiyada
const redeemPromo = db.transaction((code, userId, orderId) => {
  const p = db.prepare("SELECT * FROM promo_codes WHERE code = ?").get(code);
  if (!p || (p.max_uses && p.used >= p.max_uses)) return false;
  const ins = db.prepare("INSERT OR IGNORE INTO promo_uses(code,user_tg_id,order_id,created_at) VALUES(?,?,?,?)").run(code, userId, orderId, Date.now());
  if (!ins.changes) return false;
  db.prepare("UPDATE promo_codes SET used = used + 1 WHERE code = ?").run(code);
  return true;
});

// Buyurtma rad etilsa yoki pul qaytarilsa — foydalanuvchi kodni qayta ishlata oladi
const releasePromo = db.transaction((orderId) => {
  const use = db.prepare("SELECT * FROM promo_uses WHERE order_id = ?").get(orderId);
  if (!use) return false;
  db.prepare("DELETE FROM promo_uses WHERE code = ? AND user_tg_id = ?").run(use.code, use.user_tg_id);
  db.prepare("UPDATE promo_codes SET used = MAX(used - 1, 0) WHERE code = ?").run(use.code);
  return true;
});
function hasActivePromos(now = Date.now()) {
  return !!db.prepare("SELECT 1 FROM promo_codes WHERE active = 1 AND (expires_at = 0 OR expires_at > ?) AND (max_uses = 0 OR used < max_uses) LIMIT 1").get(now);
}

// ── VIP / BEPUL LIMIT ──────────────────────────────────────
function vipDailyLimit() {
  const n = parseInt(getSetting("vip_daily_limit", "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function freeOrdersToday(userId, now = Date.now()) {
  return db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_tg_id = ? AND payment_method = 'free'
    AND created_at >= ? AND status NOT IN ('failed','rejected')`).get(userId, startOfToday(now)).n;
}
function vipQuota(userId, now = Date.now()) {
  const limit = vipDailyLimit();
  if (!limit) return { limit: 0, used: freeOrdersToday(userId, now), left: Infinity };
  const used = freeOrdersToday(userId, now);
  return { limit, used, left: Math.max(0, limit - used) };
}

// ── XARAJAT NAZORATI ───────────────────────────────────────
// Kunlik AI xarajat chegaradan oshsa — bir kunda bir marta ogohlantirish
function checkDailyCostAlert(now = Date.now()) {
  const limit = Number(getSetting("daily_cost_alert_usd", "0"));
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const today = startOfToday(now);
  const spent = db.prepare("SELECT SUM(COALESCE(cost_usd,0)) AS s FROM orders WHERE created_at >= ?").get(today).s || 0;
  if (spent < limit) return null;
  const marker = String(today);
  if (getSetting("cost_alert_day", "") === marker) return null;
  dbm.setSetting("cost_alert_day", marker);
  return `💸 Diqqat: bugungi AI xarajat $${spent.toFixed(2)} — belgilangan chegara $${limit.toFixed(2)} dan oshdi.`;
}

// ── TAKLIF (REFERAL) TIZIMI ────────────────────────────────
// Do'st havola orqali kelib, birinchi pullik buyurtmasini to'lasa — taklif qilganga bonus balans.
// Yangi kelgan do'st birinchi buyurtmasiga chegirma oladi.
function referralEnabled() { return getSetting("referral_enabled", "1") === "1"; }
function refBonus() { const n = parseInt(getSetting("ref_bonus", "5000"), 10); return Number.isFinite(n) && n > 0 ? n : 0; }
function refNewDiscount() { const n = parseInt(getSetting("ref_new_discount", "10"), 10); return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0; }

function parseStartPayload(payload) {
  const m = String(payload || "").match(/^ref_?(\d{1,15})$/);
  return m ? Number(m[1]) : null;
}
// Faqat yangi foydalanuvchiga va o'zini o'zi taklif qilmasa
function setReferrer(userId, referrerId) {
  if (!referralEnabled() || !referrerId || referrerId === userId) return false;
  if (!dbm.getUser(referrerId)) return false;
  const u = dbm.getUser(userId);
  if (!u || u.referred_by) return false;
  db.prepare("UPDATE users SET referred_by = ? WHERE tg_id = ?").run(referrerId, userId);
  return true;
}
function getBalance(userId) { const u = dbm.getUser(userId); return u ? Number(u.balance) || 0 : 0; }
function addBalance(userId, amount) { db.prepare("UPDATE users SET balance = MAX(COALESCE(balance,0) + ?, 0) WHERE tg_id = ?").run(Math.round(amount), userId); }

// Yangi do'stga birinchi buyurtma chegirmasi: taklif orqali kelgan va hali pullik buyurtmasi yo'q
function referralDiscountFor(userId, amount) {
  const pct = refNewDiscount();
  if (!referralEnabled() || !pct || !amount) return 0;
  const u = dbm.getUser(userId);
  if (!u || !u.referred_by) return 0;
  const ph = PAID_STATUSES.map(() => "?").join(",");
  const had = db.prepare(`SELECT 1 FROM orders WHERE user_tg_id = ? AND status IN (${ph},'awaiting_approval')
    AND COALESCE(payment_method,'') NOT IN ('free') LIMIT 1`).get(userId, ...PAID_STATUSES);
  return had ? 0 : Math.round(amount * pct / 100);
}

// To'lov tasdiqlanganda chaqiriladi; bir do'st uchun bonus faqat bir marta. Bonus olgan taklifchi id'sini qaytaradi.
const creditReferral = db.transaction((order) => {
  if (!order || !referralEnabled()) return null;
  if (["free", "promo", "balance"].includes(order.payment_method) || !(order.amount > 0)) return null;
  const u = dbm.getUser(order.user_tg_id);
  if (!u || !u.referred_by || u.ref_rewarded) return null;
  const bonus = refBonus();
  if (!bonus) return null;
  db.prepare("UPDATE users SET ref_rewarded = 1 WHERE tg_id = ?").run(order.user_tg_id);
  addBalance(u.referred_by, bonus);
  return { referrer: u.referred_by, bonus };
});

function referralStats(userId) {
  const invited = db.prepare("SELECT COUNT(*) AS n FROM users WHERE referred_by = ?").get(userId).n;
  const paid = db.prepare("SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND ref_rewarded = 1").get(userId).n;
  return { invited, paid, earned: paid * refBonus(), balance: getBalance(userId) };
}
function topReferrers(limit = 5) {
  return db.prepare(`SELECT referred_by AS id, COUNT(*) AS invited, SUM(CASE WHEN ref_rewarded = 1 THEN 1 ELSE 0 END) AS paid
    FROM users WHERE referred_by IS NOT NULL GROUP BY referred_by ORDER BY paid DESC, invited DESC LIMIT ?`).all(limit);
}

// Balansdan yechilgan summa — buyurtma rad etilsa / bekor qilinsa qaytariladi
const releaseBalance = db.transaction((orderId) => {
  const o = dbm.getOrder(orderId);
  if (!o || !(o.balance_used > 0)) return 0;
  addBalance(o.user_tg_id, o.balance_used);
  db.prepare("UPDATE orders SET balance_used = 0 WHERE id = ?").run(orderId);
  return o.balance_used;
});
const spendBalance = db.transaction((userId, orderId, amount) => {
  const have = getBalance(userId);
  const use = Math.min(have, Math.max(0, Math.round(amount)));
  if (!use) return 0;
  addBalance(userId, -use);
  db.prepare("UPDATE orders SET balance_used = ? WHERE id = ?").run(use, orderId);
  return use;
});

// ── TO'LANMAGAN BUYURTMALAR ESLATMASI ──────────────────────
// reminded: 1 — mijozga eslatma yuborilgan, 2 — muddati o'tib bekor qilingan
function dueReminders(now = Date.now()) {
  const after = Number(getSetting("unpaid_remind_min", "30")) * 60000;
  const expire = Number(getSetting("unpaid_expire_hours", "24")) * 3600000;
  const remind = db.prepare(`SELECT * FROM orders WHERE status = 'awaiting_payment' AND COALESCE(reminded,0) = 0
    AND created_at <= ? AND created_at > ?`).all(now - after, now - expire);
  const expired = db.prepare(`SELECT * FROM orders WHERE status = 'awaiting_payment' AND COALESCE(reminded,0) < 2
    AND created_at <= ?`).all(now - expire);
  const stale = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'awaiting_approval' AND created_at <= ?`).get(now - 30 * 60000).n;
  return { remind, expired, staleApprovals: stale };
}
function cancelOrder(orderId, status = "cancelled") {
  const o = dbm.getOrder(orderId);
  if (!o || !["awaiting_payment", "awaiting_approval"].includes(o.status)) return false;
  dbm.updateOrder(orderId, { status, reminded: 2 });
  releasePromo(orderId); releaseBalance(orderId);
  return true;
}

// ── FOYDALANUVCHI KARTASI ──────────────────────────────────
function userSummary(userId) {
  const u = dbm.getUser(userId);
  const ph = PAID_STATUSES.map(() => "?").join(",");
  const agg = db.prepare(`SELECT COUNT(*) AS orders,
      SUM(CASE WHEN status IN (${ph}) AND COALESCE(payment_method,'') NOT IN ('free','promo') THEN amount ELSE 0 END) AS spent,
      SUM(CASE WHEN status IN (${ph}) THEN 1 ELSE 0 END) AS paid
    FROM orders WHERE user_tg_id = ?`).get(...PAID_STATUSES, ...PAID_STATUSES, userId);
  return { user: u || null, orders: agg.orders || 0, paid: agg.paid || 0, spent: agg.spent || 0 };
}

module.exports = {
  PAID_STATUSES, startOfToday, usdRate, periodStats, overallCounters, statsReport, ordersCsv,
  parsePromoInput, createPromo, deletePromo, listPromos, promoLabel, checkPromo, redeemPromo, releasePromo, hasActivePromos,
  referralEnabled, refBonus, refNewDiscount, parseStartPayload, setReferrer, getBalance, addBalance,
  referralDiscountFor, creditReferral, referralStats, topReferrers, releaseBalance, spendBalance,
  dueReminders, cancelOrder,
  vipDailyLimit, freeOrdersToday, vipQuota, checkDailyCostAlert, userSummary, fmt,
};
