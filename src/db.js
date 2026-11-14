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
migrate("university"); migrate("faculty"); migrate("department"); migrate("supervisor"); migrate("include_toc","INTEGER");
migrate("cost_usd","REAL"); migrate("promo_code"); migrate("discount","INTEGER"); migrate("delivered_at","INTEGER");
try { db.prepare("SELECT banned FROM users LIMIT 1").get(); } catch (_) { try { db.exec("ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0"); } catch (_) {} }
try { db.prepare("SELECT last_seen FROM users LIMIT 1").get(); } catch (_) { try { db.exec("ALTER TABLE users ADD COLUMN last_seen INTEGER"); } catch (_) {} }

db.exec(`
CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  kind TEXT,            -- 'percent' | 'fixed'
  value INTEGER,
  max_uses INTEGER DEFAULT 0, -- 0 = cheksiz
  used INTEGER DEFAULT 0,
  work_type TEXT DEFAULT '', -- '' = hammasi, 'taqdimot' | 'mustaqil'
  expires_at INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS promo_uses (
  code TEXT,
  user_tg_id INTEGER,
  order_id INTEGER,
  created_at INTEGER,
  PRIMARY KEY (code, user_tg_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_tg_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);


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
// true qaytaradi — agar foydalanuvchi yangi bo'lsa
function upsertUser(tgId, username, firstName) {
  const existed = !!db.prepare("SELECT 1 FROM users WHERE tg_id = ?").get(tgId);
  const now = Date.now();
  db.prepare(`INSERT INTO users(tg_id,username,first_name,created_at,last_seen) VALUES(?,?,?,?,?)
    ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, last_seen=excluded.last_seen`)
    .run(tgId, username || "", firstName || "", now, now);
  return !existed;
}
function getUser(tgId) { return db.prepare("SELECT * FROM users WHERE tg_id = ?").get(tgId); }
function findUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(String(username || "").replace(/^@/, ""));
}
function setBanned(tgId, banned) { db.prepare("UPDATE users SET banned = ? WHERE tg_id = ?").run(banned ? 1 : 0, tgId); }
function isBanned(tgId) { const row = db.prepare("SELECT banned FROM users WHERE tg_id = ?").get(tgId); return !!(row && row.banned); }
function listUserIdsForBroadcast() { return db.prepare("SELECT tg_id FROM users WHERE COALESCE(banned,0) = 0 ORDER BY tg_id").all().map(row => row.tg_id); }

// ---- sessiyalar (bot qayta ishga tushganda yo'qolmasligi uchun) ----
const sessionStorage = {
  read(key) {
    const row = db.prepare("SELECT value FROM sessions WHERE key = ?").get(key);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch (_) { return undefined; }
  },
  write(key, value) {
    db.prepare("INSERT INTO sessions(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(key, JSON.stringify(value), Date.now());
  },
  delete(key) { db.prepare("DELETE FROM sessions WHERE key = ?").run(key); },
};

// ---- orders ----
function createOrder(o) {
  const info = db.prepare(`INSERT INTO orders
    (user_tg_id,work_type,topic,slides,pages,student_name,student_group,language,
     university,faculty,department,supervisor,include_toc,
     has_content,content_text,amount,currency,status,payment_method,created_at)
    VALUES(@user_tg_id,@work_type,@topic,@slides,@pages,@student_name,@student_group,@language,
           @university,@faculty,@department,@supervisor,@include_toc,
           @has_content,@content_text,@amount,@currency,@status,@payment_method,@created_at)`)
    .run({
      user_tg_id: o.user_tg_id, work_type: o.work_type||"taqdimot",
      topic: o.topic, slides: o.slides||null, pages: o.pages||null,
      student_name: o.student_name||null, student_group: o.student_group||null,
      language: o.language||null,
      university: o.university||null, faculty: o.faculty||null, department: o.department||null,
      supervisor: o.supervisor||null, include_toc: o.include_toc ? 1 : 0,
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
  upsertUser, getUser, findUserByUsername, setBanned, isBanned, listUserIdsForBroadcast, sessionStorage,
  createOrder, getOrder, updateOrder,
  listOrdersByUser, listRecentOrders, findOrderByProviderTx, listOrdersByStatuses,
  addAdmin, removeAdmin, isDbAdmin, listAdmins,
  addFreeUser, removeFreeUser, isFreeUser, listFreeUsers,
  getCache, setCache, deleteCache,
};
