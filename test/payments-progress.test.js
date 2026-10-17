const test = require("node:test");
const assert = require("node:assert/strict");
const {
  startPaymentStatus,
  PRESENTATION_PAYMENT_MESSAGE,
} = require("../src/payments/mustaqil-progress");

function createMockApi() {
  const sent = [];
  const edited = [];
  return {
    sent,
    edited,
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
      return { message_id: 91 };
    },
    async editMessageText(chatId, messageId, text) {
      edited.push({ chatId, messageId, text });
      return { message_id: messageId, text };
    },
  };
}

function percentFrom(text) {
  return Number(text.match(/(?:^|\s)(\d+)%/)?.[1]);
}

test("payment status wording stays specific to presentation and independent work", async () => {
  const api = createMockApi();
  const presentation = await startPaymentStatus(api, { work_type: "taqdimot", user_tg_id: 10 });
  assert.equal(presentation, null);
  assert.equal(api.sent[0].chatId, 10);
  assert.equal(api.sent[0].text, PRESENTATION_PAYMENT_MESSAGE);

  const independentWork = await startPaymentStatus(api, { work_type: "mustaqil", user_tg_id: 20 });
  assert.equal(api.sent.length, 2, "har buyurtma uchun bitta boshlang‘ich xabar yuboriladi");
  assert.equal(api.sent[1].chatId, 20);
  assert.match(api.sent[1].text, /Mustaqil ishingiz tayyorlanmoqda/);
  assert.match(api.sent[1].text, /0%/);
  assert.doesNotMatch(api.sent[1].text, /Taqdimotingiz/);
  independentWork.stop();
});

test("mustaqil ish progressi monoton, bitta xabarni animatsiya bilan tahrirlaydi va 100% da yakunlanadi", async () => {
  const api = createMockApi();
  const progress = await startPaymentStatus(api, { work_type: "mustaqil", user_tg_id: 42 }, { intervalMs: 500 });

  await progress.update(42, "Boblar yozilmoqda");
  await progress.update(17, "Kechikkan bosqich");
  await new Promise(resolve => setTimeout(resolve, 540));
  await progress.complete();

  assert.equal(api.sent.length, 1, "progress davomida yangi status xabarlari yuborilmaydi");
  assert.ok(api.edited.length >= 3, "status bosqichlarda va spinner animatsiyasi uchun tahrirlanadi");
  assert.ok(api.edited.every(edit => edit.chatId === 42 && edit.messageId === 91), "barcha yangilanishlar ayni Telegram xabariga boradi");
  const texts = [api.sent[0].text, ...api.edited.map(edit => edit.text)];
  const percentages = texts.map(percentFrom);
  assert.ok(percentages.every(Number.isFinite));
  assert.ok(percentages.every((value, index) => index === 0 || value >= percentages[index - 1]), "foiz monoton oshadi");
  assert.ok(texts.some(text => text.includes("⠙")), "statusda spinner animatsiyasi ko‘rinadi");
  assert.equal(percentages.at(-1), 100);
  assert.match(texts.at(-1), /tayyorlandi va yuborildi/);
});

test("xatolik progressni 100% ga chiqarmaydi", async () => {
  const api = createMockApi();
  const progress = await startPaymentStatus(api, { work_type: "mustaqil", user_tg_id: 77 }, { intervalMs: 10_000 });

  await progress.update(54, "Boblar tekshirilmoqda");
  await progress.fail("Sinov xatosi");

  assert.equal(api.sent.length, 1);
  const finalText = api.edited.at(-1).text;
  assert.match(finalText, /54%/);
  assert.match(finalText, /xatolik yuz berdi/);
  assert.doesNotMatch(finalText, /100%/);
});
