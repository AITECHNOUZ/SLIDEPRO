const test = require("node:test");
const assert = require("node:assert/strict");
const { requiresStudentDetails } = require("../src/order-flow");

test("oddiy foydalanuvchidan talaba ma'lumotlari so'raladi", () => {
  assert.equal(requiresStudentDetails(), true);
  assert.equal(requiresStudentDetails({ isAdmin: false, isVip: false }), true);
});

test("admin va VIP foydalanuvchidan talaba ma'lumotlari so'ralmaydi", () => {
  assert.equal(requiresStudentDetails({ isAdmin: true }), false);
  assert.equal(requiresStudentDetails({ isVip: true }), false);
  assert.equal(requiresStudentDetails({ isAdmin: true, isVip: true }), false);
});
