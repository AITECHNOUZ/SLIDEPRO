// src/db.js
// SQLite (better-sqlite3) — foydalanuvchilar, buyurtmalar, sozlamalar.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { config } = require("./config");

// DB papkasini yaratish
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_tg_id INTEGER,
  work_type TEXT DEFAULT 'taqdimot',
  topic TEXT,
  slides INTEGER,
  pages INTEGER,
  student_name TEXT,
  student_group TEXT,
  has_content INTEGER DEFAULT 0,
  content_text TEXT,
  amount INTEGER,
  currency TEXT,
  status TEXT,
  payment_method TEXT,
  provider_tx TEXT,
  file_id TEXT,
  file_path TEXT,
  created_at INTEGER,
  paid_at INTEGER
);
CREATE TABLE IF NOT EXISTS admins (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  added_by INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS free_users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  granted_by INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS cache (
  cache_key TEXT PRIMARY KEY,
  file_id TEXT,
  topic TEXT,
  slides INTEGER,
  channel_msg_id INTEGER,
  created_at INTEGER
);
`);

// eski bazaga yangi ustunlar qo'shish (migratsiya)
const migrate = (col, def="TEXT") => { try { db.prepare("SELECT "+col+" FROM orders LIMIT 1").get(); } catch(e) { try { db.exec("ALTER TABLE orders ADD COLUMN "+col+" "+def); } catch(_) {} } };
migrate("file_id"); migrate("work_type"); migrate("pages","INTEGER"); migrate("student_name"); migrate("student_group"); migrate("language");


// ---- settings ----
function getSetting(key, def = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : def;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}
function getAllSettings() {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  const o = {};
  rows.forEach((r) => (o[r.key] = r.value));
  return o;
}
// standart qiymatlarni birinchi marta o'rnatish
function seedDefaults(defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (getSetting(k) === null) setSetting(k, v);
  }
}

// ---- users ----
function upsertUser(tgId, username, firstName) {
  db.prepare(`INSERT INTO users(tg_id,username,first_name,created_at) VALUES(?,?,?,?)
    ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name`)
    .run(tgId, username || "", firstName || "", Date.now());
}

// ---- orders ----
function createOrder(o) {
  const info = db.prepare(`INSERT INTO orders
    (user_tg_id,work_type,topic,slides,pages,student_name,student_group,language,
     has_content,content_text,amount,currency,status,payment_method,created_at)
    VALUES(@user_tg_id,@work_type,@topic,@slides,@pages,@student_name,@student_group,@language,
           @has_content,@content_text,@amount,@currency,@status,@payment_method,@created_at)`)
    .run({
      user_tg_id: o.user_tg_id, work_type: o.work_type||"taqdimot",
      topic: o.topic, slides: o.slides||null, pages: o.pages||null,
      student_name: o.student_name||null, student_group: o.student_group||null,
      language: o.language||null,
      has_content: o.has_content ? 1 : 0, content_text: o.content_text || null,
      amount: o.amount, currency: o.currency, status: o.status || "draft",
      payment_method: o.payment_method || null, created_at: Date.now(),
    });
  return info.lastInsertRowid;
}
function getOrder(id) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
}
function updateOrder(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE orders SET ${set} WHERE id = @id`).run({ ...fields, id });
}
function listOrdersByUser(tgId, limit = 10) {
  return db.prepare("SELECT * FROM orders WHERE user_tg_id = ? ORDER BY id DESC LIMIT ?").all(tgId, limit);
}
function listRecentOrders(limit = 20) {
  return db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?").all(limit);
}
function findOrderByProviderTx(tx) {
  return db.prepare("SELECT * FROM orders WHERE provider_tx = ?").get(tx);
}
// status bo'yicha buyurtmalar (tasdiqlangan / tasdiqlanmagan ajratish uchun)
function listOrdersByStatuses(statuses, limit = 20) {
  const ph = statuses.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM orders WHERE status IN (${ph}) ORDER BY id DESC LIMIT ?`).all(...statuses, limit);
}

// ---- admins (env'dan tashqari, dinamik) ----
function addAdmin(tgId, username, addedBy) {
  db.prepare("INSERT INTO admins(tg_id,username,added_by,created_at) VALUES(?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username")
    .run(tgId, username || "", addedBy || null, Date.now());
}
function removeAdmin(tgId) { db.prepare("DELETE FROM admins WHERE tg_id = ?").run(tgId); }
function isDbAdmin(tgId) { return !!db.prepare("SELECT 1 FROM admins WHERE tg_id = ?").get(tgId); }
function listAdmins() { return db.prepare("SELECT * FROM admins ORDER BY created_at DESC").all(); }

// ---- bepul foydalanuvchilar ----
function addFreeUser(tgId, username, grantedBy) {
  db.prepare("INSERT INTO free_users(tg_id,username,granted_by,created_at) VALUES(?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username")
    .run(tgId, username || "", grantedBy || null, Date.now());
}
function removeFreeUser(tgId) { db.prepare("DELETE FROM free_users WHERE tg_id = ?").run(tgId); }
function isFreeUser(tgId) { return !!db.prepare("SELECT 1 FROM free_users WHERE tg_id = ?").get(tgId); }
function listFreeUsers() { return db.prepare("SELECT * FROM free_users ORDER BY created_at DESC").all(); }

// ---- kesh (bir xil taqdimotni qayta yaratmaslik) ----
function getCache(key) { return db.prepare("SELECT * FROM cache WHERE cache_key = ?").get(key); }
function setCache(key, fileId, topic, slides, channelMsgId) {
  db.prepare(`INSERT INTO cache(cache_key,file_id,topic,slides,channel_msg_id,created_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET file_id=excluded.file_id, channel_msg_id=excluded.channel_msg_id, created_at=excluded.created_at`)
    .run(key, fileId, topic, slides, channelMsgId || null, Date.now());
}
function deleteCache(key) { db.prepare("DELETE FROM cache WHERE cache_key = ?").run(key); }

module.exports = {
  db, getSetting, setSetting, getAllSettings, seedDefaults,
  upsertUser, createOrder, getOrder, updateOrder,
  listOrdersByUser, listRecentOrders, findOrderByProviderTx, listOrdersByStatuses,
  addAdmin, removeAdmin, isDbAdmin, listAdmins,
  addFreeUser, removeFreeUser, isFreeUser, listFreeUsers,
  getCache, setCache, deleteCache,
};
