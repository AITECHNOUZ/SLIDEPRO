const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyReferences, titleSimilarity, stripDoi } = require("../src/mustaqil/reference-verify");

function crossrefMock(handlers) {
  return async url => {
    for (const [pattern, body] of handlers) {
      if (pattern.test(url)) {
        if (body === 404) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
  };
}

test("Crossref: noto'g'ri DOI olib tashlanadi, mos asar uchun haqiqiy DOI qo'shiladi", async () => {
  const references = [
    "Esram, T., & Chapman, P. L. (2007). Comparison of photovoltaic array maximum power point tracking techniques. IEEE Transactions on Energy Conversion, 22(2), 439–449. https://doi.org/10.9999/invented.doi",
    "Skoplaki, E., & Palyvos, J. A. (2009). On the temperature dependence of photovoltaic module electrical performance. Solar Energy, 83(5), 614–624.",
    "Ротач, В. Я. (2008). Теория автоматического управления. Издательский дом МЭИ.",
    "Villalva, M. G., Gazoli, J. R., & Filho, E. R. (2009). Comprehensive approach to modeling and simulation of photovoltaic arrays. IEEE Transactions on Power Electronics, 24(5), 1198–1208. https://doi.org/10.1109/TPEL.2009.2013862",
  ];
  const fetchImpl = crossrefMock([
    [/works\/10\.9999/, 404],
    [/works\/10\.1109%2FTPEL/, { message: { title: ["Comprehensive Approach to Modeling and Simulation of Photovoltaic Arrays"], issued: { "date-parts": [[2009]] }, author: [{ family: "Villalva" }] } }],
    [/query\.bibliographic=On%20the%20temperature/, { message: { items: [
      { DOI: "10.1016/j.solener.2008.10.008", title: ["On the temperature dependence of photovoltaic module electrical performance: A review of efficiency/power correlations"], issued: { "date-parts": [[2009]] }, author: [{ family: "Skoplaki" }, { family: "Palyvos" }] },
    ] } }],
  ]);
  const { references: verified, stats } = await verifyReferences(references, { fetchImpl });
  assert.doesNotMatch(verified[0], /10\.9999/, "mavjud bo'lmagan DOI olib tashlanadi");
  assert.match(verified[0], /439–449\.$/);
  assert.match(verified[1], /https:\/\/doi\.org\/10\.1016\/j\.solener\.2008\.10\.008$/, "topilgan haqiqiy DOI qo'shiladi");
  assert.equal(verified[2], references[2], "Crossref'da yo'q kirill kitob o'zgarmaydi");
  assert.equal(verified[3], references[3], "tasdiqlangan DOI saqlanadi");
  assert.equal(stats.doiRemoved, 1);
  assert.equal(stats.doiAdded, 1);
});

test("Crossref tarmoq xatosida yozuvlar o'zgarmaydi", async () => {
  const references = ["Ogata, K. (2010). Modern control engineering (5th ed.). Prentice Hall. https://doi.org/10.5555/x.1"];
  const { references: verified, stats } = await verifyReferences(references, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual(verified, references);
  assert.equal(stats.errors, 1);
});

test("sarlavha o'xshashligi va DOI olib tashlash yordamchilari", () => {
  assert.ok(titleSimilarity("Modern control engineering", "Modern Control Engineering") > 0.95);
  assert.ok(titleSimilarity("Modern control engineering", "Deep learning for vision") < 0.2);
  assert.equal(stripDoi("A, B. (2020). Title. Journal, 1(2), 3–4. https://doi.org/10.1016/j.x.2020.01.001"), "A, B. (2020). Title. Journal, 1(2), 3–4.");
});
