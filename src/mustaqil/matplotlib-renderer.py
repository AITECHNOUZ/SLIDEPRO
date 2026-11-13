#!/usr/bin/env python3
"""GOST uslubidagi grafiklar (matplotlib) — stdin: JSON, stdout: 300 dpi PNG.

Qo'llab-quvvatlanadigan diagram_type:
  • mathematical_graph — y = f(x) funksiyalar (xavfsiz, oq ro'yxatli ifodalar)
  • experiment_results — bir nechta seriyali tajriba natijalari (bar/line)
  • simple             — oddiy bar / line / pie (labels + values)

Uslub (GOST 2.xxx ga yaqin, o'quv/maqola chizmalari uchun):
  • oq fon, ramkasiz, kengligi ~6,2 dyuym; shrift DejaVu Sans (mathtext ham DejaVu Sans)
  • o'qlar qora, yuqori/o'ng ramka yo'q; to'r alpha 0,25; legenda ramkasiz
  • oqim/asosiy seriya to'q ko'k #1f5fa6, maydon/to'ldirish och ko'k #bcd9ee
  • qizil #c0392b faqat chegara (threshold) uchun — punktir
  • o'nli kasr vergul bilan: 0,62
  • sarlavha rasm ichida yo'q — u DOCX captionida (n-rasm. ...)
"""

import ast
import json
import math
import sys
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.ticker import FuncFormatter

MAX_SERIES = 5
SAMPLE_POINTS = 501
FIG_WIDTH_IN = 6.2
DPI = 300

BLUE_DARK = "#1f5fa6"
BLUE_LIGHT = "#bcd9ee"
RED = "#c0392b"
BLACK = "#000000"

# Bosma (oq-qora) nusxada ham ajraladigan seriyalar: rang + chiziq turi + marker
LINE_STYLES = [
    {"color": BLUE_DARK, "linestyle": "-", "marker": "o"},
    {"color": BLACK, "linestyle": "--", "marker": "s"},
    {"color": "#5b8cc4", "linestyle": "-.", "marker": "^"},
    {"color": "#555555", "linestyle": ":", "marker": "D"},
    {"color": "#8fb8de", "linestyle": (0, (5, 2, 1, 2)), "marker": "v"},
]
BAR_STYLES = [
    {"facecolor": BLUE_LIGHT, "edgecolor": BLUE_DARK, "hatch": None},
    {"facecolor": BLUE_DARK, "edgecolor": BLACK, "hatch": None},
    {"facecolor": "white", "edgecolor": BLACK, "hatch": "///"},
    {"facecolor": "#7fa8d1", "edgecolor": BLACK, "hatch": None},
    {"facecolor": "#d9d9d9", "edgecolor": BLACK, "hatch": "..."},
]
PIE_COLORS = [BLUE_DARK, BLUE_LIGHT, "#5b8cc4", "#d9d9d9", "#8fb8de"]

ALLOWED_FUNCTIONS = {
    "sin": np.sin, "cos": np.cos, "tan": np.tan,
    "asin": np.arcsin, "acos": np.arccos, "atan": np.arctan,
    "sinh": np.sinh, "cosh": np.cosh, "tanh": np.tanh,
    "exp": np.exp, "log": np.log, "log10": np.log10,
    "sqrt": np.sqrt, "abs": np.abs,
}
ALLOWED_NAMES = {"x", "pi", "e", *ALLOWED_FUNCTIONS}
ALLOWED_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult,
    ast.Div, ast.Pow, ast.UAdd, ast.USub, ast.Call, ast.Name, ast.Load,
    ast.Constant,
)


def choose_font():
    families = {entry.name for entry in font_manager.fontManager.ttflist}
    for name in ("DejaVu Sans", "Liberation Sans", "Arial"):
        if name in families:
            return name
    print("FONT_FALLBACK: DejaVu Sans topilmadi; standart sans-serif ishlatildi.", file=sys.stderr)
    return "sans-serif"


def comma_number(value, decimals=None):
    """0.62 -> '0,62'; butun sonlar kasrsiz; ming ajratgich — bo'sh joy."""
    if value is None or not math.isfinite(float(value)):
        return ""
    value = float(value)
    if decimals is None:
        if abs(value - round(value)) < 1e-9:
            decimals = 0
        elif abs(value) >= 100:
            decimals = 1
        else:
            decimals = 2
    text = f"{value:,.{decimals}f}".replace(",", " ")
    text = text.replace(".", ",")
    if "," in text:
        text = text.rstrip("0").rstrip(",")
    return text.replace("-", "−")


def tick_formatter():
    return FuncFormatter(lambda value, _pos: comma_number(value))


def checked_expression(expression):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 120:
        raise ValueError("function expression is empty or exceeds 120 characters")
    tree = ast.parse(expression.replace("^", "**"), mode="eval")
    nodes = list(ast.walk(tree))
    if len(nodes) > 80 or any(not isinstance(node, ALLOWED_NODES) for node in nodes):
        raise ValueError("function expression contains unsupported syntax")
    for node in nodes:
        if isinstance(node, ast.Name) and node.id not in ALLOWED_NAMES:
            raise ValueError(f"unsupported name in function expression: {node.id}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS or len(node.args) != 1 or node.keywords:
                raise ValueError("only whitelisted single-argument math functions are allowed")
        if isinstance(node, ast.Constant) and (isinstance(node.value, bool) or not isinstance(node.value, (int, float))):
            raise ValueError("only numeric constants are allowed")
        if isinstance(node, ast.Constant) and abs(float(node.value)) > 1_000_000:
            raise ValueError("numeric constant is outside the supported range")
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            if not isinstance(node.right, ast.Constant) or abs(float(node.right.value)) > 12:
                raise ValueError("exponents must be numeric constants between -12 and 12")
    return compile(tree, "<validated-math-expression>", "eval")


def axis_label(label, unit=""):
    label = str(label or "").strip()
    unit = str(unit or "").strip()
    if unit and unit not in label:
        return f"{label}, {unit}" if label else unit
    return label


def draw_threshold(ax, data):
    """Ixtiyoriy chegara chizig'i: {"threshold": {"value": 0.8, "label": "Me'yor"}} — qizil punktir."""
    threshold = data.get("threshold")
    if not isinstance(threshold, dict):
        return
    try:
        value = float(threshold.get("value"))
    except (TypeError, ValueError):
        return
    if not math.isfinite(value):
        return
    label = str(threshold.get("label") or "Chegara")
    ax.axhline(value, color=RED, linestyle="--", linewidth=1.3, label=f"{label}: {comma_number(value)}", zorder=4)


def style_axes(ax):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(BLACK)
        ax.spines[side].set_linewidth(1.0)
    ax.tick_params(colors=BLACK, width=0.9, length=4)
    ax.grid(True, axis="both", alpha=0.25, linewidth=0.7, linestyle="-", color="#808080")
    ax.set_axisbelow(True)


def finish_legend(ax, count, force=False):
    handles, _labels = ax.get_legend_handles_labels()
    if (count > 1 or force) and handles:
        ax.legend(frameon=False, loc="best")


def plot_mathematical_graph(data, ax):
    functions = data.get("functions")
    if not isinstance(functions, list) or not 1 <= len(functions) <= MAX_SERIES:
        raise ValueError("mathematical graph requires 1–5 function series")
    x_min = float(data["x_min"])
    x_max = float(data["x_max"])
    if not math.isfinite(x_min) or not math.isfinite(x_max) or x_max <= x_min or x_max - x_min > 1_000_000:
        raise ValueError("invalid x range")
    x = np.linspace(x_min, x_max, SAMPLE_POINTS)
    namespace = {"__builtins__": {}, "x": x, "pi": np.pi, "e": np.e, **ALLOWED_FUNCTIONS}
    with np.errstate(over="ignore", divide="ignore", invalid="ignore", under="ignore"):
        for index, item in enumerate(functions):
            if not isinstance(item, dict):
                raise ValueError("function series must be objects")
            code = checked_expression(item.get("expression", ""))
            y = np.asarray(eval(code, namespace, {}), dtype=float)  # noqa: S307 — AST oq ro'yxatidan o'tgan
            if y.ndim == 0:
                y = np.full_like(x, float(y))
            if y.shape != x.shape:
                raise ValueError("function did not produce one y value per x sample")
            finite = np.isfinite(y)
            if not finite.any():
                raise ValueError(f"function {index + 1} has no finite values in the selected interval")
            y = np.where(finite, y, np.nan)
            style = LINE_STYLES[index % len(LINE_STYLES)]
            ax.plot(x, y, linewidth=2.0, color=style["color"], linestyle=style["linestyle"],
                    label=str(item.get("name") or f"f{index + 1}(x)"))
    ax.axhline(0, color=BLACK, linewidth=0.8)
    ax.axvline(0, color=BLACK, linewidth=0.8)
    ax.set_xlabel(str(data.get("x_label") or "x"))
    ax.set_ylabel(axis_label(data.get("y_label") or "f(x)", data.get("unit")))
    draw_threshold(ax, data)
    finish_legend(ax, len(functions), force=isinstance(data.get("threshold"), dict))


def series_label(item, index, count):
    name = str(item.get("name") or "").strip()
    if name:
        return name
    return "_nolegend_" if count == 1 else f"Seriya {index + 1}"


def plot_series(ax, labels, series, chart_type):
    x = np.arange(len(labels), dtype=float)
    if chart_type == "line":
        for index, item in enumerate(series):
            values = np.asarray(item.get("values"), dtype=float)
            if values.shape != x.shape or not np.isfinite(values).all():
                raise ValueError("each series must match labels and contain finite numbers")
            style = LINE_STYLES[index % len(LINE_STYLES)]
            ax.plot(x, values, linewidth=2.0, markersize=5.5, markerfacecolor="white", markeredgewidth=1.4,
                    label=series_label(item, index, len(series)), **style)
            if len(series) == 1:
                for xi, yi in zip(x, values):
                    ax.annotate(comma_number(yi), (xi, yi), textcoords="offset points", xytext=(0, 7),
                                ha="center", fontsize=9, color=BLACK)
    elif chart_type == "bar":
        group_width = 0.78
        bar_width = group_width / len(series)
        for index, item in enumerate(series):
            values = np.asarray(item.get("values"), dtype=float)
            if values.shape != x.shape or not np.isfinite(values).all():
                raise ValueError("each series must match labels and contain finite numbers")
            offset = (index - (len(series) - 1) / 2) * bar_width
            style = BAR_STYLES[index % len(BAR_STYLES)]
            bars = ax.bar(x + offset, values, width=bar_width * 0.9, linewidth=1.2,
                          label=series_label(item, index, len(series)),
                          facecolor=style["facecolor"], edgecolor=style["edgecolor"], hatch=style["hatch"], zorder=3)
            if len(series) <= 2:
                for rect, value in zip(bars, values):
                    height = rect.get_height()
                    va = "bottom" if value >= 0 else "top"
                    ax.annotate(comma_number(value), (rect.get_x() + rect.get_width() / 2, height if value >= 0 else value),
                                textcoords="offset points", xytext=(0, 3 if value >= 0 else -3),
                                ha="center", va=va, fontsize=9, color=BLACK)
        ax.axhline(0, color=BLACK, linewidth=1.0, zorder=4)
    else:
        raise ValueError("chart type must be bar or line")
    ax.set_xticks(x, [wrap_label(str(label)) for label in labels])
    ax.margins(y=0.12)


def wrap_label(text, width=14):
    words, lines, line = text.split(), [], ""
    for word in words:
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return "\n".join(lines[:4]) if lines else text


def plot_experiment_results(data, ax):
    labels = data.get("labels")
    series = data.get("series")
    chart_type = str(data.get("chartType") or "bar").lower()
    if not isinstance(labels, list) or not 2 <= len(labels) <= 8:
        raise ValueError("experiment results require 2–8 category labels")
    if not isinstance(series, list) or not 1 <= len(series) <= MAX_SERIES:
        raise ValueError("experiment results require 1–5 data series")
    if chart_type not in ("bar", "line"):
        raise ValueError("experiment chart type must be bar or line")
    plot_series(ax, labels, series, chart_type)
    if data.get("x_label"):
        ax.set_xlabel(str(data["x_label"]))
    ax.set_ylabel(axis_label(data.get("y_label") or "Natija", data.get("unit")))
    draw_threshold(ax, data)
    finish_legend(ax, len(series), force=isinstance(data.get("threshold"), dict))


def plot_simple(data, ax):
    labels = data.get("labels")
    values = data.get("values")
    chart_type = str(data.get("chartType") or "bar").lower()
    if not isinstance(labels, list) or not isinstance(values, list) or len(labels) != len(values) or not 2 <= len(labels) <= 8:
        raise ValueError("simple chart requires 2–8 labels with matching values")
    numbers = np.asarray(values, dtype=float)
    if not np.isfinite(numbers).all():
        raise ValueError("chart values must be finite numbers")
    if chart_type == "pie":
        if (numbers < 0).any() or numbers.sum() <= 0:
            raise ValueError("pie values must be non-negative with a positive total")
        total = numbers.sum()
        shown = [(str(label), value) for label, value in zip(labels, numbers) if value > 0]
        wedges, _texts, autotexts = ax.pie(
            [value for _label, value in shown],
            colors=[PIE_COLORS[i % len(PIE_COLORS)] for i in range(len(shown))],
            startangle=90, counterclock=False,
            wedgeprops={"edgecolor": BLACK, "linewidth": 0.9},
            autopct=lambda pct: comma_number(pct, 1) + "%" if pct >= 4 else "",
            pctdistance=0.68, textprops={"fontsize": 10},
        )
        for index, text in enumerate(autotexts):
            text.set_color("white" if PIE_COLORS[index % len(PIE_COLORS)] in (BLUE_DARK, "#5b8cc4") else BLACK)
        ax.legend(wedges, [f"{label} — {comma_number(value / total * 100, 1)}%" for label, value in shown],
                  frameon=False, loc="center left", bbox_to_anchor=(1.0, 0.5))
        ax.set_aspect("equal")
        return
    plot_series(ax, labels, [{"name": data.get("series_name") or "", "values": values}], chart_type)
    if data.get("x_label"):
        ax.set_xlabel(str(data["x_label"]))
    y_label = axis_label(data.get("y_label") or "", data.get("unit"))
    if y_label:
        ax.set_ylabel(y_label)
    draw_threshold(ax, data)
    finish_legend(ax, 1, force=isinstance(data.get("threshold"), dict))


def build_figure(data):
    font = choose_font()
    matplotlib.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": [font, "DejaVu Sans"],
        "mathtext.fontset": "dejavusans",
        "font.size": 11,
        "axes.labelsize": 11,
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
        "legend.fontsize": 10,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
        "axes.edgecolor": BLACK,
        "axes.labelcolor": BLACK,
        "text.color": BLACK,
        "axes.unicode_minus": True,
        "hatch.linewidth": 0.8,
        "svg.fonttype": "none",
    })
    diagram_type = data.get("diagram_type") or "simple"
    is_pie = diagram_type == "simple" and str(data.get("chartType") or "").lower() == "pie"
    height = 3.4 if is_pie else 3.9
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, height), constrained_layout=True)
        if diagram_type == "mathematical_graph":
            plot_mathematical_graph(data, ax)
        elif diagram_type == "experiment_results":
            plot_experiment_results(data, ax)
        elif diagram_type == "simple":
            plot_simple(data, ax)
        else:
            raise ValueError(f"unsupported Matplotlib diagram type: {diagram_type}")
        if not is_pie:
            style_axes(ax)
            ax.yaxis.set_major_formatter(tick_formatter())
            if diagram_type == "mathematical_graph":
                ax.xaxis.set_major_formatter(tick_formatter())
    return fig, ax


def main():
    data = json.load(sys.stdin)
    fig, _ = build_figure(data)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        fig.savefig(sys.stdout.buffer, format="png", dpi=DPI, bbox_inches="tight", pad_inches=0.08)
    plt.close(fig)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(f"Matplotlib render error: {error}", file=sys.stderr)
        sys.exit(1)
