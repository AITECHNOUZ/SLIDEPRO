const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pay-")), "t.sqlite");
process.env.CLICK_SECRET_KEY = ""; process.env.PAYME_KEY = "";
const db = require("../src/db");
const click = require("../src/payments/click");
const payme = require("../src/payments/payme");
const crypto = require("crypto");

function fakeRes() { const r = { body: null, json(b) { r.body = b; return r; } }; return r; }

test("Click maxfiy kaliti sozlanmagan bo'lsa soxta imzo bilan buyurtma to'langan bo'lmaydi", async () => {
  const id = db.createOrder({ user_tg_id: 1, topic: "x", amount: 1000, currency: "so'm", status: "awaiting_payment", payment_method: "click" });
  const body = { click_trans_id: "1", service_id: "", merchant_trans_id: String(id), merchant_prepare_id: String(id), amount: "1000", action: "1", sign_time: "t", error: "0" };
  body.sign_string = crypto.createHash("md5").update(`1${""}${""}${id}${id}1000${1}t`).digest("hex");
  const res = fakeRes();
  await click.webhook({ body }, res);
  assert.notEqual(res.body.error, 0);
  assert.equal(db.getOrder(id).status, "awaiting_payment");
});

test("Payme kaliti sozlanmagan bo'lsa bo'sh parolli so'rov rad etiladi", () => {
  const res = fakeRes();
  payme.webhook({ headers: { authorization: "Basic " + Buffer.from("Paycom:").toString("base64") }, body: { id: 1, method: "PerformTransaction", params: { id: "x" } } }, res);
  assert.equal(res.body.error.code, -32504);
});
