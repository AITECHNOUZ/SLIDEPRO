// src/pricing.js
const { getSetting } = require("./db");

function calcPrice(slides) {
  const base = parseInt(getSetting("base_price", "0"), 10) || 0;
  const perSlide = parseInt(getSetting("price_per_slide", "5000"), 10) || 0;
  return base + perSlide * slides;
}

// Mustaqil ish uchun sahifaga asoslangan narx
// Agar alohida sozlanmagan bo'lsa, slayd narxi bilan bir xil (per unit)
function calcMustaqilPrice(pages) {
  const base = parseInt(getSetting("base_price", "0"), 10) || 0;
  const perPage = parseInt(getSetting("mustaqil_price_per_page", getSetting("price_per_slide", "5000")), 10) || 0;
  return base + perPage * pages;
}

function currency() {
  return getSetting("currency", "so'm");
}

function formatAmount(amount) {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

module.exports = { calcPrice, calcMustaqilPrice, currency, formatAmount };
