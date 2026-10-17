// src/payments/payme.js
// Payme (Paycom) Merchant API integratsiyasi (JSON-RPC 2.0).
// Metodlar: CheckPerformTransaction, CreateTransaction, PerformTransaction,
// CancelTransaction, CheckTransaction, GetStatement.
// Hujjat: https://developer.help.paycom.uz/
//
// DIQQAT: Haqiqiy PAYME_MERCHANT_ID va PAYME_KEY (kassa kaliti) bilan
// Payme sandbox'ida sinovdan o'tkazilishi shart. Basic auth: "Paycom:KEY".

const { config } = require("../config");
const { getOrder, updateOrder, findOrderByProviderTx } = require("../db");
const { fulfillOrder } = require("./fulfill");

const PAYME_ERR = {
  INVALID_AMOUNT: { code: -31001, message: { uz: "Noto'g'ri summa", ru: "Неверная сумма", en: "Invalid amount" } },
  ORDER_NOT_FOUND: { code: -31050, message: { uz: "Buyurtma topilmadi", ru: "Заказ не найден", en: "Order not found" } },
  CANT_PERFORM: { code: -31008, message: { uz: "Amalni bajarib bo'lmaydi", ru: "Невозможно выполнить", en: "Can't perform" } },
  TX_NOT_FOUND: { code: -31003, message: { uz: "Tranzaksiya topilmadi", ru: "Транзакция не найдена", en: "Transaction not found" } },
  UNAUTHORIZED: { code: -32504, message: { uz: "Avtorizatsiya xatosi", ru: "Ошибка авторизации", en: "Authorization error" } },
  METHOD_NOT_FOUND: { code: -32601, message: { uz: "Metod topilmadi", ru: "Метод не найден", en: "Method not found" } },
};

const TX_STATE = { CREATED: 1, COMPLETED: 2, CANCELLED: -1, CANCELLED_AFTER: -2 };

function rpcError(id, err, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: err.code, message: err.message, data } };
}
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

// Basic auth tekshiruvi: "Basic base64(Paycom:KEY)"
function checkAuth(req) {
  const header = req.headers.authorization || "";
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1], "base64").toString("utf8"); // "Paycom:KEY"
  const key = decoded.split(":")[1];
  return key && key === config.payme.key;
}

function orderFromParams(params) {
  const account = params.account || {};
  const orderId = parseInt(account.order_id, 10);
  return { orderId, order: orderId ? getOrder(orderId) : null };
}

function handle(method, params, id) {
  switch (method) {
    case "CheckPerformTransaction": {
      const { order } = orderFromParams(params);
      if (!order) return rpcError(id, PAYME_ERR.ORDER_NOT_FOUND);
      if (Math.round(Number(params.amount)) !== Math.round(order.amount * 100)) // Payme tiyinda
        return rpcError(id, PAYME_ERR.INVALID_AMOUNT);
      if (order.status === "done" || order.status === "paid")
        return rpcError(id, PAYME_ERR.CANT_PERFORM);
      return rpcResult(id, { allow: true });
    }
    case "CreateTransaction": {
      const { orderId, order } = orderFromParams(params);
      if (!order) return rpcError(id, PAYME_ERR.ORDER_NOT_FOUND);
      if (Math.round(Number(params.amount)) !== Math.round(order.amount * 100))
        return rpcError(id, PAYME_ERR.INVALID_AMOUNT);
      // mavjud tranzaksiya bormi
      const existing = findOrderByProviderTx(params.id);
      if (existing) {
        return rpcResult(id, { create_time: order.created_at, transaction: String(orderId), state: TX_STATE.CREATED });
      }
      updateOrder(orderId, { status: "awaiting_payment", payment_method: "payme", provider_tx: params.id });
      return rpcResult(id, { create_time: Date.now(), transaction: String(orderId), state: TX_STATE.CREATED });
    }
    case "PerformTransaction": {
      const order = findOrderByProviderTx(params.id);
      if (!order) return rpcError(id, PAYME_ERR.TX_NOT_FOUND);
      if (order.status !== "paid" && order.status !== "done") {
        updateOrder(order.id, { status: "paid" });
        setImmediate(() => fulfillOrder(order.id).catch(() => {}));
      }
      return rpcResult(id, { transaction: String(order.id), perform_time: Date.now(), state: TX_STATE.COMPLETED });
    }
    case "CancelTransaction": {
      const order = findOrderByProviderTx(params.id);
      if (!order) return rpcError(id, PAYME_ERR.TX_NOT_FOUND);
      updateOrder(order.id, { status: "failed" });
      return rpcResult(id, { transaction: String(order.id), cancel_time: Date.now(), state: TX_STATE.CANCELLED });
    }
    case "CheckTransaction": {
      const order = findOrderByProviderTx(params.id);
      if (!order) return rpcError(id, PAYME_ERR.TX_NOT_FOUND);
      const state = (order.status === "paid" || order.status === "done") ? TX_STATE.COMPLETED
        : order.status === "failed" ? TX_STATE.CANCELLED : TX_STATE.CREATED;
      return rpcResult(id, {
        create_time: order.created_at, perform_time: order.paid_at || 0, cancel_time: 0,
        transaction: String(order.id), state, reason: null,
      });
    }
    case "GetStatement":
      return rpcResult(id, { transactions: [] });
    default:
      return rpcError(id, PAYME_ERR.METHOD_NOT_FOUND);
  }
}

// to'lov havolasi (Payme checkout). m=merchant_id, ac.order_id=orderId, a=amount(tiyin)
function buildPaymentUrl(orderId, amount) {
  const params = `m=${config.payme.merchantId};ac.order_id=${orderId};a=${amount * 100}`;
  const b64 = Buffer.from(params).toString("base64");
  return `${config.payme.checkoutUrl}/${b64}`;
}

// Express handler
function webhook(req, res) {
  if (!checkAuth(req)) {
    return res.json(rpcError(req.body && req.body.id, PAYME_ERR.UNAUTHORIZED));
  }
  const { method, params, id } = req.body || {};
  try {
    return res.json(handle(method, params || {}, id));
  } catch (e) {
    return res.json(rpcError(id, PAYME_ERR.CANT_PERFORM, e.message));
  }
}

module.exports = { buildPaymentUrl, webhook };
