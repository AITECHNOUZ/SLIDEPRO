# Dockerfile — Railway/Render uchun
FROM node:20-slim

# sharp va better-sqlite3 uchun build vositalari + SVG matn uchun shriftlar
# fontconfig + DejaVu shriftlar: diagrammalardagi matn □□□ bo'lib qolmasligi uchun
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-matplotlib make g++ \
    graphviz \
    fontconfig fonts-dejavu-core fonts-dejavu-extra fonts-liberation \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# ikonkalarni oldindan generatsiya qilish (ixtiyoriy, birinchi ishga tushishni tezlashtiradi)
RUN node -e "require('./src/generator/build').ensureIcons(require('./src/generator/theme').getPalette('ocean')).then(()=>console.log('icons ready')).catch(()=>{})" || true

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/bot.js"]
