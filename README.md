# SLIDEPRO — taqdimot va mustaqil ish boti

Telegram bot: mavzu yoki yuklangan kontent asosida **PowerPoint taqdimot** (.pptx) va **mustaqil ish** (.docx) tayyorlaydi. To'lov: karta (chek), Click, Payme.

## LLM: faqat Claude API va OpenAI API

Barcha so'rovlar yagona klient orqali o'tadi: `src/llm/client.js`.

| Provayder | API | Standart model | O'zgaruvchi |
|---|---|---|---|
| Anthropic Claude | Messages API (`/v1/messages`) | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| OpenAI | Chat Completions (`/v1/chat/completions`) | `gpt-5-mini` | `OPENAI_API_KEY`, `OPENAI_MODEL` |

- `LLM_PROVIDER=anthropic | openai | both`. `both` bo'lsa, avval Claude ishlatiladi, xato bo'lsa OpenAI'ga o'tiladi. Admin panelda ham almashtirish mumkin.
- Claude: system prompt keshlanadi (`cache_control`). Javob `max_tokens` da kesilsa, token budjeti ikki baravar oshirilib qayta so'raladi.
- OpenAI gpt-5 / o-seriya modellari `temperature` qabul qilmaydi va fikrlash tokenlarini ham budjetdan sarflaydi. Klient buni hisobga oladi. Fikrlash darajasini `OPENAI_REASONING_EFFORT` bilan berish mumkin.
- 408, 429 va 5xx javoblarda qayta urinadi (`LLM_RETRIES`). Timeout token soniga qarab o'zgaradi (`LLM_TIMEOUT_MS`).

## Mustaqil ish sifati

### Formulalar Word'ga OMML bo'lib tushadi
`src/mustaqil/omml.js` modulida LaTeX avval MathJax orqali MathML'ga, keyin OMML'ga (`<m:oMath>`) o'giriladi.
- Alohida qatordagi formulalar va matn ichidagi `$...$` ifodalar Word'ning o'z tenglamasi bo'ladi, rasm emas: tahrirlash mumkin, xiralashmaydi.
- Qo'llab-quvvatlanadi: kasr, daraja/indeks, ildiz, ∑/∏/∫, lim, aksentlar, `\left…\right`, matritsa, `cases`, `\text`.
- Har formuladan keyin belgilar izohi chiqadi: «bu yerda $U$ — kuchlanish, V; …».
- O'girib bo'lmasa, zaxira sifatida MathJax PNG ishlatiladi.

### Chizmalar GOST uslubida
- Grafiklar (bar, line, pie, funksiya grafigi, tajriba natijalari) matplotlib bilan chiziladi (`src/mustaqil/matplotlib-renderer.py`). Rasm 300 dpi va ~6,2 dyuym kenglikda. Shrift DejaVu Sans, o'qlar qora, to'r alpha 0,25, legenda ramkasiz. Ranglar: asosiy oqim #1f5fa6, to'ldirish #bcd9ee, chegara chizig'i qizil punktir #c0392b. O'nli kasr vergul bilan (0,62). Grafik sarlavhasi rasm ichida emas, DOCX captionida.
- Blok-sxemalar Graphviz'da GOST 19.701 belgilari bilan chiziladi. Terminator yumaloq to'rtburchak, jarayon to'rtburchak, qaror romb, ma'lumot parallelogramm. Konturlar qora, strelkalar to'q ko'k.

### So'ralgan sahifa soniga moslik
`src/mustaqil/page-fit.js` tayyor DOCX ni LibreOffice bilan PDF'ga aylantiradi va haqiqiy sahifalar sonini o'lchaydi. Maqsadli oraliq `[so'ralgan; so'ralgan + 1]` bet.
- Bet ko'p bo'lsa, oxirgi beti eng bo'sh bob o'sha qatorlar hajmida qisqartiriladi. Bunday bob odatda keyingi betga bir necha qator toshib o'tgan bo'ladi.
- Bet kam bo'lsa, oxirgi beti eng to'la bobga LLM yozgan davom paragraflari qo'shiladi. Paragraflar oldingi matnni takrorlamaydi.
- Ko'pi bilan 3 marta tekshiriladi. Natija (`pageCount`) foydalanuvchiga yuboriladigan xabarda ko'rsatiladi.
- `SLIDEPRO_PAGE_FIT=1` bilan yoqiladi. `NODE_ENV=production` bo'lsa, standart holatda yoqilgan.

## Ishga tushirish

```bash
cp .env.example .env   # kalitlarni to'ldiring
npm install
npm start
npm test
```

Docker (Railway/Render): `Dockerfile` ichida graphviz, matplotlib, LibreOffice (writer+math), poppler-utils va DejaVu/Liberation shriftlari bor.

## Tuzilma

```
src/bot.js                Telegram menyulari va buyurtma oqimi
src/llm/client.js         Claude + OpenAI yagona klienti
src/generator/            taqdimot: outline → slaydlar → pptxgenjs
src/mustaqil/             mustaqil ish: outline → boblar → media → DOCX
  omml.js                 LaTeX → OMML
  page-fit.js             sahifa soniga moslash
  matplotlib-renderer.py  GOST grafiklar
  flowchart*.js           GOST blok-sxemalar (Graphviz)
src/payments/             Click, Payme, qo'lda to'lov, yetkazish
```
