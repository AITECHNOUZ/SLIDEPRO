// src/payments/click.js
// Click (O'zbekiston) Shop API integratsiyasi.
// Click ikki callback yuboradi: Prepare (action=0) va Complete (action=1).
// Hujjat: https://docs.click.uz/
//
// DIQQAT: Bu kod Click protokoliga muvofiq yozilgan, lekin haqiqiy merchant
// hisob ma'lumotlari (CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_SECRET_KEY)
// va Click sandbox'ida sinovdan o'tkazilishi shart.

const crypto = require("crypto");
const { config } = require("../config");
const { getOrder, updateOrder } = require("../db");
const { fulfillOrder } = require("./fulfill");

const ERR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  ERROR_IN_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
};

function md5(s) { return crypto.createHash("md5").update(s).digest("hex"); }

// to'lov havolasini yaratish (foydalanuvchini Click sahifasiga yo'naltirish)
function buildPaymentUrl(orderId, amount) {
  const { serviceId, merchantId } = config.click;
  const ret = config.publicUrl ? `&return_url=${encodeURIComponent(config.publicUrl)}` : "";
  // merchant_trans_id = orderId
  return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${orderId}${ret}`;
}

// Prepare callback (action = 0)
function handlePrepare(body) {
  const { click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string } = body;
  const orderId = parseInt(merchant_trans_id, 10);
  const order = getOrder(orderId);

  const mySign = md5(`${click_trans_id}${service_id}${config.click.secretKey}${merchant_trans_id}${amount}${action}${sign_time}`);
  if (mySign !== sign_string) return { error: ERR.SIGN_CHECK_FAILED, error_note: "Sign check failed" };
  if (!order) return { error: ERR.USER_NOT_FOUND, error_note: "Order not found" };
  if (Math.round(Number(amount)) !== Math.round(order.amount)) return { error: ERR.INCORRECT_AMOUNT, error_note: "Incorrect amount" };
  if (order.status === "done" || order.status === "paid") return { error: ERR.ALREADY_PAID, error_note: "Already paid" };

  updateOrder(orderId, { status: "awaiting_payment", payment_method: "click", provider_tx: String(click_trans_id) });
  return {
    error: ERR.SUCCESS, error_note: "Success",
    click_trans_id, merchant_trans_id,
    merchant_prepare_id: orderId,
  };
}

// Complete callback (action = 1)
async function handleComplete(body) {
  const { click_trans_id, service_id, merchant_trans_id, merchant_prepare_id, amount, action, sign_time, sign_string, error } = body;
  const orderId = parseInt(merchant_trans_id, 10);
  const order = getOrder(orderId);

  const mySign = md5(`${click_trans_id}${service_id}${config.click.secretKey}${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`);
  if (mySign !== sign_string) return { error: ERR.SIGN_CHECK_FAILED, error_note: "Sign check failed" };
  if (!order) return { error: ERR.USER_NOT_FOUND, error_note: "Order not found" };
  if (Number(error) < 0) {
    updateOrder(orderId, { status: "failed" });
    return { error: ERR.TRANSACTION_CANCELLED, error_note: "Cancelled" };
  }
  if (order.status === "done" || order.status === "paid") return { error: ERR.ALREADY_PAID, error_note: "Already paid" };

  updateOrder(orderId, { status: "paid" });
  // generatsiyani fon rejimida boshlash
  setImmediate(() => fulfillOrder(orderId).catch(() => {}));

  return {
    error: ERR.SUCCESS, error_note: "Success",
    click_trans_id, merchant_trans_id,
    merchant_confirm_id: orderId,
  };
}

// Express handler
async function webhook(req, res) {
  try {
    const action = String(req.body.action);
    if (action === "0") return res.json(handlePrepare(req.body));
    if (action === "1") return res.json(await handleComplete(req.body));
    return res.json({ error: ERR.ACTION_NOT_FOUND, error_note: "Action not found" });
  } catch (e) {
    return res.json({ error: ERR.ERROR_IN_REQUEST, error_note: "Error: " + e.message });
  }
}

module.exports = { buildPaymentUrl, webhook };
