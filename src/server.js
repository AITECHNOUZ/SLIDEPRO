// src/server.js
// To'lov webhooklari (Click/Payme) va health-check uchun HTTP server.
const express = require("express");
const { config } = require("./config");
const click = require("./payments/click");
const payme = require("./payments/payme");
const fulfill = require("./payments/fulfill");

function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/", (_req, res) => res.send("Taqdimot bot ishlamoqda ✅"));
  app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.post("/payments/click", (req, res) => click.webhook(req, res));
  app.post("/payments/payme", (req, res) => payme.webhook(req, res));

  const server = app.listen(config.port, () => {
    console.log(`HTTP server: port ${config.port}`);
    if (config.publicUrl) {
      console.log(`  Click webhook:  ${config.publicUrl}/payments/click`);
      console.log(`  Payme webhook:  ${config.publicUrl}/payments/payme`);
    }
  });
  server.on("error", error => console.error("HTTP server ishga tushish xatosi:", error));

  // Recover paid/in-progress orders after a process restart. Bot initialization
  // is done before startServer() is called; delay briefly for long polling setup.
  const recoveryTimer = setTimeout(() => {
    fulfill.recoverPendingOrders().catch(error => console.error("Buyurtmalarni tiklash xatosi:", error));
  }, 2_000);
  recoveryTimer.unref?.();
  return app;
}

module.exports = { startServer };
