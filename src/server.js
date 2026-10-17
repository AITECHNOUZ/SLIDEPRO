// src/server.js
// To'lov webhooklari (Click/Payme) va health-check uchun HTTP server.

const express = require("express");
const { config } = require("./config");
const click = require("./payments/click");
const payme = require("./payments/payme");

function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/", (_req, res) => res.send("Taqdimot bot ishlamoqda ✅"));
  app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Click callback (Prepare + Complete bitta URL)
  app.post("/payments/click", (req, res) => click.webhook(req, res));

  // Payme JSON-RPC
  app.post("/payments/payme", (req, res) => payme.webhook(req, res));

  app.listen(config.port, () => {
    console.log(`HTTP server: port ${config.port}`);
    if (config.publicUrl) {
      console.log(`  Click webhook:  ${config.publicUrl}/payments/click`);
      console.log(`  Payme webhook:  ${config.publicUrl}/payments/payme`);
    }
  });
  return app;
}

module.exports = { startServer };
