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
  vipDailyLimit, freeOrdersToday, vipQuota, checkDailyCostAlert, userSummary, fmt,
};
