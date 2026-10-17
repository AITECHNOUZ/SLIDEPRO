#!/usr/bin/env python3
"""Render semantically typed mathematical and experimental charts to PNG."""

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

MAX_SERIES = 5
SAMPLE_POINTS = 501
ALLOWED_FUNCTIONS = {
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "asin": np.arcsin,
    "acos": np.arccos,
    "atan": np.arctan,
    "sinh": np.sinh,
    "cosh": np.cosh,
    "tanh": np.tanh,
    "exp": np.exp,
    "log": np.log,
    "log10": np.log10,
    "sqrt": np.sqrt,
    "abs": np.abs,
}
ALLOWED_NAMES = {"x", "pi", "e", *ALLOWED_FUNCTIONS}
ALLOWED_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult,
    ast.Div, ast.Pow, ast.UAdd, ast.USub, ast.Call, ast.Name, ast.Load,
    ast.Constant,
)


def choose_font():
    families = {entry.name for entry in font_manager.fontManager.ttflist}
    if "Times New Roman" in families:
        return "Times New Roman"
    if "Liberation Serif" in families:
        print("FONT_FALLBACK: Times New Roman is not installed; using metric-compatible Liberation Serif.", file=sys.stderr)
        return "Liberation Serif"
    serif_candidates = [name for name in ("Nimbus Roman", "DejaVu Serif") if name in families]
    if serif_candidates:
        print(f"FONT_FALLBACK: Times New Roman is not installed; using {serif_candidates[0]}.", file=sys.stderr)
        return serif_candidates[0]
    raise RuntimeError("Times New Roman is unavailable and no supported serif fallback is installed")


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
    code = compile(tree, "<validated-math-expression>", "eval")
    return code


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
            expression = item.get("expression", "")
            code = checked_expression(expression)
            y = np.asarray(eval(code, namespace, {}), dtype=float)
            if y.ndim == 0:
                y = np.full_like(x, float(y))
            if y.shape != x.shape:
                raise ValueError("function did not produce one y value per x sample")
            finite = np.isfinite(y)
            if not finite.any():
                raise ValueError(f"function {index + 1} has no finite values in the selected interval")
            y = np.where(finite, y, np.nan)
            ax.plot(x, y, linewidth=2.0, label=str(item.get("name") or f"f{index + 1}(x)"))
    ax.axhline(0, color="#555555", linewidth=0.8)
    ax.axvline(0, color="#555555", linewidth=0.8)
    ax.set_xlabel(str(data.get("x_label") or "x"))
    ax.set_ylabel(str(data.get("y_label") or data.get("unit") or "f(x)"))
    if len(functions) > 1:
        ax.legend(frameon=False, loc="best")


def plot_experiment_results(data, ax):
    labels = data.get("labels")
    series = data.get("series")
    chart_type = str(data.get("chartType") or "bar").lower()
    if not isinstance(labels, list) or not 2 <= len(labels) <= 8:
        raise ValueError("experiment results require 2–8 category labels")
    if not isinstance(series, list) or not 1 <= len(series) <= MAX_SERIES:
        raise ValueError("experiment results require 1–5 data series")
    x = np.arange(len(labels), dtype=float)
    if chart_type == "line":
        for index, item in enumerate(series):
            values = np.asarray(item.get("values"), dtype=float)
            if values.shape != x.shape or not np.isfinite(values).all():
                raise ValueError("each experimental series must match labels and contain finite numbers")
            ax.plot(x, values, marker="o", linewidth=1.8, label=str(item.get("name") or f"Seriya {index + 1}"))
    elif chart_type == "bar":
        group_width = 0.82
        bar_width = group_width / len(series)
        for index, item in enumerate(series):
            values = np.asarray(item.get("values"), dtype=float)
            if values.shape != x.shape or not np.isfinite(values).all():
                raise ValueError("each experimental series must match labels and contain finite numbers")
            offset = (index - (len(series) - 1) / 2) * bar_width
            ax.bar(x + offset, values, width=bar_width * 0.92, label=str(item.get("name") or f"Seriya {index + 1}"))
    else:
        raise ValueError("experiment chart type must be bar or line")
    ax.set_xticks(x, [str(label) for label in labels])
    if data.get("x_label"):
        ax.set_xlabel(str(data["x_label"]))
    ax.set_ylabel(str(data.get("y_label") or data.get("unit") or "Natija"))
    if len(series) > 1:
        ax.legend(frameon=False, loc="best")


def build_figure(data):
    font = choose_font()
    matplotlib.rcParams.update({
        "font.family": "serif",
        "font.serif": [font],
        "font.size": 10,
        "axes.labelsize": 10,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "legend.fontsize": 9,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
        "axes.unicode_minus": False,
    })
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        fig, ax = plt.subplots(figsize=(7.2, 4.4), constrained_layout=True)
        diagram_type = data.get("diagram_type")
        if diagram_type == "mathematical_graph":
            plot_mathematical_graph(data, ax)
        elif diagram_type == "experiment_results":
            plot_experiment_results(data, ax)
        else:
            raise ValueError(f"unsupported Matplotlib diagram type: {diagram_type}")
        ax.grid(True, axis="both", alpha=0.22, linewidth=0.7)
        ax.set_axisbelow(True)
    return fig, ax


def main():
    data = json.load(sys.stdin)
    fig, _ = build_figure(data)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        fig.savefig(sys.stdout.buffer, format="png", dpi=170, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Matplotlib render error: {error}", file=sys.stderr)
        sys.exit(1)
