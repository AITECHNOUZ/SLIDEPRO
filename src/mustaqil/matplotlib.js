const { spawn } = require("node:child_process");
const path = require("node:path");
const sharp = require("sharp");
const { normalizeChartData } = require("./chart-data");

const MAX_PNG_BYTES = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 20_000;
const SCRIPT_PATH = path.join(__dirname, "matplotlib-renderer.py");
let fontFallbackReported = false;

function runMatplotlib(data, scriptPath = SCRIPT_PATH) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let stdoutBytes = 0;
    let stderr = "";
    const chunks = [];
    const python = process.env.SLIDEPRO_PYTHON || process.env.PYTHON || "python3";
    const child = spawn(python, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, MPLBACKEND: "Agg" },
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RENDER_TIMEOUT_MS);

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    child.on("error", error => finish(new Error(`chart: Matplotlib/Python ishga tushmadi (${error.message})`)));
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_PNG_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("chart: Matplotlib natijasi 8 MB limitdan oshdi"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
    });
    child.on("close", code => {
      if (timedOut) return finish(new Error("chart: Matplotlib render 20 soniyada tugamadi"));
      if (code !== 0) return finish(new Error(`chart: Matplotlib render xatosi (${stderr.trim().slice(0, 700) || `exit ${code}`})`));
      if (!stdoutBytes) return finish(new Error("chart: Matplotlib bo'sh rasm qaytardi"));
      const warning = stderr.split(/\r?\n/).find(line => line.startsWith("FONT_FALLBACK:"));
      if (warning && !fontFallbackReported) {
        fontFallbackReported = true;
        console.warn(`[mustaqil] ${warning}`);
      }
      finish(null, Buffer.concat(chunks, stdoutBytes));
    });
    child.stdin.on("error", error => {
      if (!settled) finish(new Error(`chart: Matplotlib ma'lumotini yuborib bo'lmadi (${error.message})`));
    });
    child.stdin.end(JSON.stringify(data), "utf8");
  });
}

// Word sahifasidagi kenglik: GOST chizma qoidasi — ~6,2 dyuym (96 px/dyuym).
const DISPLAY_WIDTH_PX = Math.round(6.2 * 96);

async function renderMatplotlibChart(chart) {
  const normalized = normalizeChartData(chart);
  const diagramType = normalized.diagram_type || "simple";
  if (!["mathematical_graph", "experiment_results", "simple"].includes(diagramType)) {
    throw new Error(`chart: Matplotlib uchun noma'lum diagram_type (${diagramType})`);
  }
  const payload = { ...normalized, diagram_type: diagramType };
  if (chart && typeof chart.threshold === "object" && chart.threshold) payload.threshold = chart.threshold;
  const buf = await runMatplotlib(payload);
  const metadata = await sharp(buf).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("chart: Matplotlib yaroqli PNG qaytarmadi");
  const width = DISPLAY_WIDTH_PX;
  return { buf, width, height: Math.round(width * metadata.height / metadata.width) };
}

module.exports = { renderMatplotlibChart, runMatplotlib, MAX_PNG_BYTES, RENDER_TIMEOUT_MS, DISPLAY_WIDTH_PX };
