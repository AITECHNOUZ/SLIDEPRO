// src/icons.js
// Semantik nom -> react-icon. PNG'lar icons/ papkaga bir marta generatsiya qilinadi.
// API javobida har bir element uchun "icon" maydoni shu nomlardan birini tanlaydi.

const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const Fa = require("react-icons/fa");

// Semantik nom -> Font Awesome komponent
const ICON_MAP = {
  industry: Fa.FaIndustry,
  thermometer: Fa.FaThermometerHalf,
  cogs: Fa.FaCogs,
  gear: Fa.FaCog,
  chart: Fa.FaChartLine,
  chartbar: Fa.FaChartBar,
  shield: Fa.FaShieldAlt,
  network: Fa.FaNetworkWired,
  scale: Fa.FaBalanceScale,
  leaf: Fa.FaLeaf,
  check: Fa.FaCheckCircle,
  target: Fa.FaBullseye,
  diagram: Fa.FaProjectDiagram,
  server: Fa.FaServer,
  warning: Fa.FaExclamationTriangle,
  chip: Fa.FaMicrochip,
  dollar: Fa.FaDollarSign,
  clock: Fa.FaClock,
  up: Fa.FaArrowUp,
  down: Fa.FaArrowDown,
  layers: Fa.FaLayerGroup,
  gauge: Fa.FaTachometerAlt,
  flask: Fa.FaFlask,
  desktop: Fa.FaDesktop,
  bolt: Fa.FaBolt,
  book: Fa.FaBook,
  cap: Fa.FaGraduationCap,
  water: Fa.FaWater,
  tools: Fa.FaTools,
  sliders: Fa.FaSlidersH,
  lightbulb: Fa.FaLightbulb,
  users: Fa.FaUsers,
  globe: Fa.FaGlobe,
  search: Fa.FaSearch,
  rocket: Fa.FaRocket,
  database: Fa.FaDatabase,
  cloud: Fa.FaCloud,
  lock: Fa.FaLock,
  cube: Fa.FaCube,
  flag: Fa.FaFlag,
  star: Fa.FaStar,
  heart: Fa.FaHeartbeat,
  brain: Fa.FaBrain,
  code: Fa.FaCode,
  cube3: Fa.FaCubes,
  list: Fa.FaListUl,
  calendar: Fa.FaCalendarAlt,
  money: Fa.FaMoneyBillWave,
  handshake: Fa.FaHandshake,
  award: Fa.FaAward,
  microscope: Fa.FaMicroscope,
  atom: Fa.FaAtom,
  seedling: Fa.FaSeedling,
  sun: Fa.FaSun,
  recycle: Fa.FaRecycle,
};

const ICON_NAMES = Object.keys(ICON_MAP);

function hex(c) {
  return c.startsWith("#") ? c : "#" + c;
}

async function renderIcon(name, color, outPath, size = 256) {
  const Comp = ICON_MAP[name] || ICON_MAP.check;
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color: hex(color), size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(outPath, buf);
}

// Har bir ikonka ikki rangda generatsiya qilinadi: teal (yorug' fon uchun) va oq (to'q fon uchun).
// Fayl nomi: <name>__<colorhex>.png
async function generateAll(iconsDir, colors) {
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
  // colors: rang qiymatlari massivi (hex, # siz). Har bir ikonka har bir rangda chiqadi.
  const tasks = [];
  for (const name of ICON_NAMES) {
    for (const color of colors) {
      const file = path.join(iconsDir, `${name}__${color}.png`);
      if (!fs.existsSync(file)) tasks.push(renderIcon(name, color, file));
    }
  }
  await Promise.all(tasks);
  return tasks.length;
}

// Ikonka fayl yo'lini olish (kerak bo'lsa shu yerda generatsiya qiladi)
function iconPath(iconsDir, name, color) {
  const safe = ICON_MAP[name] ? name : "check";
  return path.join(iconsDir, `${safe}__${color}.png`);
}

module.exports = { generateAll, iconPath, ICON_NAMES, renderIcon };

// CLI orqali to'g'ridan-to'g'ri ishga tushirilsa
if (require.main === module) {
  const dir = path.join(__dirname, "..", "icons");
  // standart ranglar: teal, oq, deep, gold, green, red
  generateAll(dir, ["1C7293", "FFFFFF", "065A82", "E8A33D", "27AE60", "C0392B"]).then((n) =>
    console.log(`Generated ${n} icons in ${dir}`)
  );
}
