const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "biz-"));
process.env.DB_PATH = path.join(dir, "t.sqlite");
const db = require("../src/db");
const biz = require("../src/business");
const { calcPrice, calcMustaqilPrice } = require("../src/pricing");

function order(extra) {
  return db.createOrder({ user_tg_id: 1, work_type: "taqdimot", topic: "T", slides: 10, amount: 50000, currency: "so'm",
    status: "done", payment_method: "manual", ...extra });
}

test("taqdimot va mustaqil ish narxi alohida sozlanadi", () => {
  db.setSetting("base_price", 0); db.setSetting("price_per_slide", 5000);
  db.setSetting("mustaqil_base_price", 10000); db.setSetting("mustaqil_price_per_page", 2000);
  assert.equal(calcPrice(10), 50000);
  assert.equal(calcMustaqilPrice(15), 40000);
});

test("promokod: foiz, limit, ish turi, bir foydalanuvchi bir marta", () => {
  const p = biz.parsePromoInput("bahor20 20% 2 mustaqil 7kun");
  assert.equal(p.code, "BAHOR20"); assert.equal(p.kind, "percent"); assert.equal(p.maxUses, 2); assert.equal(p.workType, "mustaqil");
  assert.ok(p.expiresAt > Date.now());
  assert.ok(biz.parsePromoInput("X 20%").error);
  assert.ok(biz.parsePromoInput("KOD 150%").error);
  biz.createPromo(p, 1);
  assert.ok(biz.hasActivePromos());

  assert.match(biz.checkPromo("BAHOR20", { userId: 5, workType: "taqdimot", amount: 40000 }).error, /faqat/);
  const ok = biz.checkPromo("bahor20", { userId: 5, workType: "mustaqil", amount: 40000 });
  assert.equal(ok.discount, 8000); assert.equal(ok.final, 32000);

  const o1 = order({ user_tg_id: 5 });
  assert.equal(biz.redeemPromo("BAHOR20", 5, o1), true);
  assert.equal(biz.redeemPromo("BAHOR20", 5, o1), false, "ikkinchi marta yo'q");
  assert.match(biz.checkPromo("BAHOR20", { userId: 5, workType: "mustaqil", amount: 40000 }).error, /foydalangansiz/);

  const o2 = order({ user_tg_id: 6 });
  assert.equal(biz.redeemPromo("BAHOR20", 6, o2), true);
  assert.match(biz.checkPromo("BAHOR20", { userId: 7, workType: "mustaqil", amount: 40000 }).error, /limiti/);

  // rad etilsa kod qaytadi
  assert.equal(biz.releasePromo(o2), true);
  assert.equal(biz.checkPromo("BAHOR20", { userId: 7, workType: "mustaqil", amount: 40000 }).final, 32000);
});

test("promokod: qat'iy summa narxdan oshmaydi, 100% bepul", () => {
  biz.createPromo(biz.parsePromoInput("MINUS 99999"), 1);
  assert.equal(biz.checkPromo("MINUS", { userId: 9, workType: "taqdimot", amount: 30000 }).final, 0);
  biz.createPromo(biz.parsePromoInput("FREE 100%"), 1);
  assert.equal(biz.checkPromo("FREE", { userId: 9, workType: "taqdimot", amount: 30000 }).final, 0);
  assert.ok(biz.deletePromo("free"));
  assert.ok(biz.checkPromo("FREE", { userId: 9, workType: "taqdimot", amount: 30000 }).error);
});

test("statistika: tushum, bepul, xarajat va foyda", () => {
  db.setSetting("usd_rate", 12000);
  const before = biz.periodStats(0);
  const a = order({ amount: 50000 }); db.updateOrder(a, { cost_usd: 0.5 });
  order({ amount: 0, payment_method: "free" });
  order({ amount: 30000, status: "failed" });
  order({ amount: 40000, work_type: "mustaqil", pages: 15 });
  const s = biz.periodStats(0);
  assert.equal(s.revenue - before.revenue, 90000);
  assert.equal(s.free_orders - before.free_orders, 1);
  assert.equal(s.failed - before.failed, 1);
  assert.equal(s.mustaqil - before.mustaqil, 1);
  assert.equal(s.cost_sum - before.cost_sum, 6000);
  assert.match(biz.statsReport(), /Statistika/);
  const csv = biz.ordersCsv(0);
  assert.match(csv, /^﻿id,sana/);
  assert.ok(csv.split("\n").length > 4);
});

test("VIP kunlik limit va xarajat ogohlantirishi", () => {
  db.setSetting("vip_daily_limit", 2);
  db.createOrder({ user_tg_id: 42, topic: "a", amount: 0, currency: "so'm", status: "done", payment_method: "free" });
  assert.deepEqual(biz.vipQuota(42), { limit: 2, used: 1, left: 1 });
  db.createOrder({ user_tg_id: 42, topic: "b", amount: 0, currency: "so'm", status: "failed", payment_method: "free" });
  assert.equal(biz.vipQuota(42).left, 1, "xato bo'lgan ish limitga kirmaydi");
  db.setSetting("vip_daily_limit", 0);
  assert.equal(biz.vipQuota(42).left, Infinity);

  db.setSetting("daily_cost_alert_usd", "0.1");
  assert.match(biz.checkDailyCostAlert(), /oshdi/);
  assert.equal(biz.checkDailyCostAlert(), null, "bir kunda bir marta");
});

test("foydalanuvchi: blok, username bo'yicha qidiruv, sessiya saqlanishi", () => {
  assert.equal(db.upsertUser(100, "Ali_U", "Ali"), true);
  assert.equal(db.upsertUser(100, "Ali_U", "Ali"), false);
  assert.equal(db.findUserByUsername("@ali_u").tg_id, 100);
  db.setBanned(100, true);
  assert.equal(db.isBanned(100), true);
  assert.ok(!db.listUserIdsForBroadcast().includes(100));
  db.setBanned(100, false);
  assert.ok(db.listUserIdsForBroadcast().includes(100));

  db.sessionStorage.write("100", { step: "await_receipt", draft: { orderId: 7 } });
  assert.deepEqual(db.sessionStorage.read("100"), { step: "await_receipt", draft: { orderId: 7 } });
  db.sessionStorage.delete("100");
  assert.equal(db.sessionStorage.read("100"), undefined);
});
