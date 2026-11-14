#!/usr/bin/env python3
"""GOST uslubidagi blok-sxemalar (matplotlib) — stdin: JSON, stdout: 300 dpi PNG.

Graphviz o'rniga chizma qo'lda, GOST chizma qoidasi bo'yicha quriladi:
  • rasm 1:1 masshtabda chiziladi (kengligi ≤ 6,2 dyuym) — Word'da ham shrift 11 pt bo'lib qoladi;
  • konturlar qora 2 pt, signal/oqim chiziqlari to'q ko'k #1f5fa6, strelka to'ldirilgan;
  • chiziqlar faqat gorizontal/vertikal (ortogonal), T-tutashuvda qora nuqta, burilishda nuqta yo'q;
  • ish muhiti/obyekt bloki och ko'k #bcd9ee, qolganlari oq; soya, 3D, bezak yo'q;
  • shartli belgilar GOST 19.701 (ISO 5807): terminator — yumaloq uchli, jarayon — to'rtburchak,
    qaror — romb, ma'lumot — parallelogramm; taqqoslash elementi — sektorlarga bo'lingan doira.

Qo'llab-quvvatlanadi: pid_control_system, functional_block_diagram, process_sequence,
algorithm_flowchart, uml_software_architecture.
"""

import json
import math
import sys
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Circle, FancyArrowPatch, FancyBboxPatch, Polygon, Rectangle
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

DPI = 300
MAX_WIDTH_IN = 6.2
FONT_SIZE = 12.0
LABEL_SIZE = 11.0
CONTOUR_PT = 2.0
SIGNAL_PT = 1.4
BLACK = "#000000"
BLUE_DARK = "#1f5fa6"
BLUE_LIGHT = "#bcd9ee"
WHITE = "#ffffff"
PAD_X = 0.14   # dyuym — matn va kontur orasidagi bo'shliq
PAD_Y = 0.10
DOT_R = 0.032  # T-tutashuv nuqtasi radiusi (dyuym)


def choose_font():
    families = {entry.name for entry in font_manager.fontManager.ttflist}
    for name in ("DejaVu Sans", "Liberation Sans", "Arial"):
        if name in families:
            return name
    return "sans-serif"


FONT = choose_font()
FONT_PROPS = FontProperties(family=FONT, size=FONT_SIZE)
LABEL_PROPS = FontProperties(family=FONT, size=LABEL_SIZE, style="italic")


def text_size(text, props=FONT_PROPS):
    """Matn o'lchami dyuymda (kenglik, balandlik)."""
    lines = str(text).split("\n") or [""]
    widths = []
    for line in lines:
        if not line.strip():
            widths.append(0.0)
            continue
        extent = TextPath((0, 0), line, prop=props).get_extents()
        widths.append(extent.width / 72.0)
    line_height = props.get_size_in_points() * 1.28 / 72.0
    return max(widths) if widths else 0.0, line_height * len(lines)


SUBSCRIPT_RE = __import__("re").compile(r"(?<![\w$])([A-Za-zΑ-ω])_\{?([A-Za-z0-9]{1,6})\}?(?![\w])")


def mathify(text):
    """T_max → $T_{max}$ (mathtext indeks); qolgan matn o'zgarmaydi."""
    return SUBSCRIPT_RE.sub(lambda m: f"${m.group(1)}_{{{m.group(2)}}}$", text)


def wrap(text, width):
    text = " ".join(str(text or "").split())
    if not text:
        return ""
    lines = textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False)[:4]
    return "\n".join(mathify(line) for line in lines)


def unify(blocks, width=True, height=True):
    """GOST: bir qatordagi bir xil turdagi bloklar bir xil o'lchamda bo'lsin."""
    same = [b for b in blocks if b.shape not in ("circle", "diamond")]
    if not same:
        return
    if width:
        w = max(b.w for b in same)
        for b in same:
            b.w = w
    if height:
        h = max(b.h for b in same)
        for b in same:
            b.h = h


class Canvas:
    """Dyuym koordinatalarida chizish (y — yuqoriga). Oxirida chegaralar bo'yicha rasm o'lchami olinadi."""

    def __init__(self):
        self.ops = []
        self.xmin = self.ymin = math.inf
        self.xmax = self.ymax = -math.inf

    def extend(self, x0, y0, x1, y1):
        self.xmin = min(self.xmin, x0, x1)
        self.xmax = max(self.xmax, x0, x1)
        self.ymin = min(self.ymin, y0, y1)
        self.ymax = max(self.ymax, y0, y1)

    def add(self, fn, bounds):
        self.ops.append(fn)
        self.extend(*bounds)

    def render(self):
        margin = 0.06
        width = self.xmax - self.xmin + 2 * margin
        height = self.ymax - self.ymin + 2 * margin
        fig = plt.figure(figsize=(width, height), dpi=DPI)
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_xlim(self.xmin - margin, self.xmax + margin)
        ax.set_ylim(self.ymin - margin, self.ymax + margin)
        ax.set_aspect("equal")
        ax.axis("off")
        for op in self.ops:
            op(ax)
        return fig


# ── Bloklar ────────────────────────────────────────────────
class Block:
    def __init__(self, node, shape, label, fill=WHITE, min_w=0.9, min_h=0.42):
        self.id = node["id"]
        self.kind = node.get("kind")
        self.shape = shape
        self.label = label
        self.fill = fill
        tw, th = text_size(label)
        extra_w = 0.0
        if shape == "parallelogram":
            extra_w = 0.36
        elif shape == "diamond":
            # romb ichiga sig'ishi uchun: matn to'g'ri to'rtburchagi romb ichida
            self.w = max(min_w * 1.25, (tw + 2 * PAD_X) * 2.0)
            self.h = max(0.62, (th + 2 * PAD_Y) * 2.0)
            self.x = self.y = 0.0
            return
        elif shape == "terminator":
            extra_w = 0.2
        elif shape == "circle":
            self.w = self.h = 0.36
            self.x = self.y = 0.0
            return
        elif shape == "cylinder":
            extra_w = 0.0
            th += 0.16
        elif shape == "component":
            extra_w = 0.22
        self.w = max(min_w, tw + 2 * PAD_X + extra_w)
        self.h = max(min_h, th + 2 * PAD_Y)
        self.x = self.y = 0.0  # markaz

    # tomonlarning o'rtasi (parallelogrammda — qiya tomonning o'rtasi)
    def slant(self): return 0.09 if self.shape == "parallelogram" else 0.0
    def left(self): return (self.x - self.w / 2 + self.slant(), self.y)
    def right(self): return (self.x + self.w / 2 - self.slant(), self.y)
    def top(self): return (self.x, self.y + self.h / 2)
    def bottom(self): return (self.x, self.y - self.h / 2)

    def bounds(self):
        return (self.x - self.w / 2, self.y - self.h / 2, self.x + self.w / 2, self.y + self.h / 2)

    def draw(self, canvas):
        b = self
        kw = dict(linewidth=CONTOUR_PT, edgecolor=BLACK, facecolor=b.fill, zorder=3, joinstyle="miter")

        def op(ax):
            x0, y0 = b.x - b.w / 2, b.y - b.h / 2
            if b.shape == "rect":
                ax.add_patch(Rectangle((x0, y0), b.w, b.h, **kw))
            elif b.shape == "interface":
                ax.add_patch(Rectangle((x0, y0), b.w, b.h, linestyle=(0, (4, 2.5)), **kw))
            elif b.shape == "terminator":
                r = b.h / 2
                ax.add_patch(FancyBboxPatch((x0, y0), b.w, b.h, boxstyle=f"round,pad=0,rounding_size={r}", **kw))
            elif b.shape == "parallelogram":
                s = 0.18
                ax.add_patch(Polygon([(x0 + s, y0 + b.h), (x0 + b.w, y0 + b.h), (x0 + b.w - s, y0), (x0, y0)], closed=True, **kw))
            elif b.shape == "diamond":
                ax.add_patch(Polygon([(b.x, b.y + b.h / 2), (b.x + b.w / 2, b.y), (b.x, b.y - b.h / 2), (b.x - b.w / 2, b.y)], closed=True, **kw))
            elif b.shape == "circle":
                r = b.w / 2
                ax.add_patch(Circle((b.x, b.y), r, **kw))
                d = r / math.sqrt(2)
                ax.plot([b.x - d, b.x + d], [b.y - d, b.y + d], color=BLACK, linewidth=CONTOUR_PT * 0.6, zorder=4)
                ax.plot([b.x - d, b.x + d], [b.y + d, b.y - d], color=BLACK, linewidth=CONTOUR_PT * 0.6, zorder=4)
                # GOST: manfiy signal kiradigan (pastki) sektor qoraytiriladi
                from matplotlib.patches import Wedge
                ax.add_patch(Wedge((b.x, b.y), r, 225, 315, facecolor=BLACK, edgecolor=BLACK, linewidth=0, zorder=4))
            elif b.shape == "cylinder":
                e = 0.09
                ax.add_patch(Rectangle((x0, y0 + e), b.w, b.h - 2 * e, linewidth=0, facecolor=b.fill, zorder=3))
                from matplotlib.patches import Ellipse, Arc
                ax.add_patch(Ellipse((b.x, y0 + b.h - e), b.w, 2 * e, **kw))
                ax.add_patch(Arc((b.x, y0 + e), b.w, 2 * e, theta1=180, theta2=360, linewidth=CONTOUR_PT, color=BLACK, zorder=4))
                ax.plot([x0, x0], [y0 + e, y0 + b.h - e], color=BLACK, linewidth=CONTOUR_PT, zorder=4)
                ax.plot([x0 + b.w, x0 + b.w], [y0 + e, y0 + b.h - e], color=BLACK, linewidth=CONTOUR_PT, zorder=4)
            elif b.shape == "component":
                ax.add_patch(Rectangle((x0, y0), b.w, b.h, **kw))
                for dy in (0.32, 0.62):
                    ax.add_patch(Rectangle((x0 - 0.08, y0 + b.h * dy - 0.05), 0.16, 0.1, linewidth=CONTOUR_PT * 0.6,
                                           edgecolor=BLACK, facecolor=WHITE, zorder=4))
            if b.shape != "circle":
                ty = b.y - (0.05 if b.shape == "cylinder" else 0)
                tx = b.x + (0.05 if b.shape == "component" else 0)
                ax.text(tx, ty, b.label, ha="center", va="center", fontsize=FONT_SIZE, family=FONT,
                        color=BLACK, zorder=5, linespacing=1.15)
        canvas.add(op, b.bounds())


def wire(canvas, points, arrow=True, color=BLUE_DARK, width=SIGNAL_PT):
    """Ortogonal (siniq) chiziq; oxirida to'ldirilgan strelka."""
    pts = [tuple(p) for p in points]

    def op(ax):
        xs, ys = zip(*pts)
        if arrow and len(pts) >= 2:
            ax.plot(xs[:-1] + (pts[-1][0],), ys[:-1] + (pts[-1][1],), color=color, linewidth=width,
                    solid_joinstyle="miter", solid_capstyle="butt", zorder=2)
            ax.add_patch(FancyArrowPatch(pts[-2], pts[-1], arrowstyle="-|>,head_length=0.55,head_width=0.24",
                                         mutation_scale=12, color=color, linewidth=width, shrinkA=0, shrinkB=0, zorder=6))
        else:
            ax.plot(xs, ys, color=color, linewidth=width, solid_joinstyle="miter", zorder=2)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    canvas.add(op, (min(xs), min(ys), max(xs), max(ys)))


def dot(canvas, point):
    x, y = point
    canvas.add(lambda ax: ax.add_patch(Circle((x, y), DOT_R, facecolor=BLACK, edgecolor=BLACK, zorder=7)),
               (x - DOT_R, y - DOT_R, x + DOT_R, y + DOT_R))


def label(canvas, point, text, ha="center", va="bottom", dx=0.0, dy=0.04, size=LABEL_SIZE, italic=True):
    if not text:
        return
    x, y = point[0] + dx, point[1] + dy
    tw, th = text_size(text, FontProperties(family=FONT, size=size, style="italic" if italic else "normal"))
    x0 = x - tw / 2 if ha == "center" else (x - tw if ha == "right" else x)
    y0 = y if va == "bottom" else (y - th if va == "top" else y - th / 2)
    canvas.add(lambda ax: ax.text(x, y, text, ha=ha, va=va, fontsize=size, family=FONT,
                                  style="italic" if italic else "normal", color=BLACK, zorder=8,
                                  bbox=dict(facecolor=WHITE, edgecolor="none", pad=0.6)),
               (x0, y0, x0 + tw, y0 + th))


# ── Shakllar ──────────────────────────────────────────────
SHAPES = {
    "start": ("terminator", WHITE), "end": ("terminator", WHITE),
    "process": ("rect", WHITE), "step": ("rect", WHITE),
    "decision": ("diamond", WHITE),
    "input": ("parallelogram", WHITE), "output": ("parallelogram", WHITE),
    "sum": ("circle", WHITE),
    "controller": ("rect", WHITE), "plant": ("rect", BLUE_LIGHT), "sensor": ("rect", WHITE),
    "component": ("component", WHITE), "class": ("rect", WHITE), "interface": ("interface", WHITE),
    "database": ("cylinder", BLUE_LIGHT), "actor": ("rect", WHITE),
}


def make_block(node, wrap_width=18):
    kind = node.get("kind") or "process"
    shape, fill = SHAPES.get(kind, ("rect", WHITE))
    text = wrap(node.get("label", ""), wrap_width)
    if kind == "actor":
        text = "«actor»\n" + text
    return Block(node, shape, text, fill)


def edge_label(edges, src, dst):
    for edge in edges:
        if edge["from"] == src and edge["to"] == dst:
            return str(edge.get("label") or "").strip()
    return ""


# ── PID (yopiq rostlash konturi) ─────────────────────────
def draw_pid(data):
    nodes = {node["kind"]: node for node in data["nodes"]}
    edges = data["edges"]
    canvas = Canvas()
    gap = 0.62
    controller = make_block(nodes["controller"], 14)
    plant = make_block(nodes["plant"], 14)
    sensor = make_block(nodes["sensor"], 16)
    summ = make_block(nodes["sum"])
    input_text = wrap(nodes["input"].get("label", ""), 14)
    in_w, in_h = text_size(input_text, LABEL_PROPS)
    out_label = edge_label(edges, nodes["plant"]["id"], nodes["sensor"]["id"]) or "y(t)"
    out_w, _ = text_size(out_label, LABEL_PROPS)

    unify([controller, plant], width=False)
    x = max(in_w, 0.6) + 0.15
    summ.x, summ.y = x + summ.w / 2, 0
    controller.x = summ.x + summ.w / 2 + gap + controller.w / 2
    plant.x = controller.x + controller.w / 2 + gap + plant.w / 2
    controller.y = plant.y = 0
    tap_x = plant.x + plant.w / 2 + 0.38
    end_x = tap_x + max(0.42, out_w + 0.12)
    sensor.x = (controller.x + plant.x) / 2
    sensor.y = -(max(controller.h, plant.h) / 2 + 0.42 + sensor.h / 2)

    # Kenglik 6,2" dan oshsa — bo'shliqlarni qisqartiramiz
    total = end_x
    if total > MAX_WIDTH_IN:
        shrink = (total - MAX_WIDTH_IN) / 3
        gap = max(0.38, gap - shrink)
        controller.x = summ.x + summ.w / 2 + gap + controller.w / 2
        plant.x = controller.x + controller.w / 2 + gap + plant.w / 2
        tap_x = plant.x + plant.w / 2 + 0.3
        end_x = tap_x + max(0.38, out_w + 0.1)
        sensor.x = (controller.x + plant.x) / 2

    for block in (summ, controller, plant, sensor):
        block.draw(canvas)

    # Kirish: topshiriq signali (blok emas — yozuvli strelka, GOST struktura sxemasi)
    wire(canvas, [(0, 0), summ.left()])
    label(canvas, (0.02, 0.05), input_text, ha="left", va="bottom", dy=0.0)
    label(canvas, (summ.x - summ.w / 2 - 0.05, -0.04), "+", ha="right", va="top", dy=0.0, italic=False, size=11)
    e_label = edge_label(edges, nodes["sum"]["id"], nodes["controller"]["id"])
    wire(canvas, [summ.right(), controller.left()])
    label(canvas, ((summ.right()[0] + controller.left()[0]) / 2, 0.05), e_label, dy=0.0)
    u_label = edge_label(edges, nodes["controller"]["id"], nodes["plant"]["id"])
    wire(canvas, [controller.right(), plant.left()])
    label(canvas, ((controller.right()[0] + plant.left()[0]) / 2, 0.05), u_label, dy=0.0)
    # Chiqish va teskari aloqa tarmog'i (T-tutashuv nuqtasi bilan)
    wire(canvas, [plant.right(), (end_x, 0)])
    label(canvas, ((tap_x + end_x) / 2 + 0.02, 0.05), out_label, dy=0.0)
    dot(canvas, (tap_x, 0))
    wire(canvas, [(tap_x, 0), (tap_x, sensor.y), sensor.right()])
    fb_label = edge_label(edges, nodes["sensor"]["id"], nodes["sum"]["id"])
    wire(canvas, [sensor.left(), (summ.x, sensor.y), summ.bottom()])
    label(canvas, (summ.x + 0.07, summ.bottom()[1] - 0.06), "−", ha="left", va="top", dy=0.0, italic=False, size=12)
    if fb_label:
        label(canvas, ((summ.x + sensor.left()[0]) / 2, sensor.y + 0.05), wrap(fb_label, 14), dy=0.0)
    return canvas


# ── Chiziqli zanjir (funksional sxema / jarayon ketma-ketligi) ──
def draw_chain(data):
    nodes = data["nodes"]
    edges = data["edges"]
    canvas = Canvas()
    gap = 0.5
    wrap_width = 16
    def layout_width(blocks, per_row):
        rows = [blocks[i:i + per_row] for i in range(0, len(blocks), per_row)]
        return max(sum(b.w for b in row) + gap * (len(row) - 1) for row in rows)

    # Avval qatorlar sonini oshiramiz (bloklar ixcham qolsin), keyin yozuvni toraytiramiz.
    choice = None
    for per_row_try in range(len(nodes), 0, -1):
        row_count = math.ceil(len(nodes) / per_row_try)
        balanced = math.ceil(len(nodes) / row_count)
        for wrap_try in (16, 14, 12):
            candidate = [make_block(node, wrap_try) for node in nodes]
            unify(candidate)
            if layout_width(candidate, balanced) <= MAX_WIDTH_IN:
                choice = (candidate, balanced)
                break
        if choice:
            break
    if not choice:
        candidate = [make_block(node, 12) for node in nodes]
        unify(candidate)
        choice = (candidate, 1)
    blocks, per_row = choice
    rows = [blocks[i:i + per_row] for i in range(0, len(blocks), per_row)]
    row_gap = 0.55
    y = 0.0
    for row in rows:
        h = max(b.h for b in row)
        x = 0.0
        for b in row:
            b.x, b.y = x + b.w / 2, y - h / 2
            x += b.w + gap
        y -= h + row_gap
    index = {b.id: b for b in blocks}
    for b in blocks:
        b.draw(canvas)
    for edge in edges:
        a, c = index[edge["from"]], index[edge["to"]]
        if abs(a.y - c.y) < 1e-6 and c.x > a.x:
            wire(canvas, [a.right(), c.left()])
            label(canvas, ((a.right()[0] + c.left()[0]) / 2, a.y + 0.05), wrap(edge.get("label", ""), 12), dy=0.0)
        else:
            # Keyingi qatorga o'tish: pastga → chapga → pastga
            mid_y = a.y - a.h / 2 - row_gap / 2
            wire(canvas, [a.bottom(), (a.x, mid_y), (c.x, mid_y), c.top()])
    return canvas


def draw_fan_in(data):
    nodes = data["nodes"]
    canvas = Canvas()
    causes = [make_block(node, 18) for node in nodes[:-1]]
    effect = make_block(nodes[-1], 16)
    unify(causes + [effect])
    gap_y = 0.22
    y = 0.0
    width = max(b.w for b in causes)
    for b in causes:
        b.x, b.y = width / 2, y - b.h / 2
        y -= b.h + gap_y
    bus_x = width + 0.38
    top_y, bottom_y = causes[0].y, causes[-1].y
    effect.x = bus_x + 0.5 + effect.w / 2
    effect.y = (top_y + bottom_y) / 2
    # 4 tomonlama tugun bo'lmasin: natija chizig'i kirish chizig'i bilan ustma-ust tushsa, biroz suriladi
    if any(abs(b.y - effect.y) < 0.05 for b in causes):
        mid = min(causes, key=lambda b: abs(b.y - effect.y))
        effect.y = mid.y - (mid.h / 2 + gap_y / 2)
    for b in causes + [effect]:
        b.draw(canvas)
    for b in causes:
        wire(canvas, [b.right(), (bus_x, b.y)], arrow=False)
        if top_y > b.y > bottom_y:
            dot(canvas, (bus_x, b.y))
    wire(canvas, [(bus_x, top_y), (bus_x, bottom_y)], arrow=False)
    dot(canvas, (bus_x, effect.y))
    wire(canvas, [(bus_x, effect.y), effect.left()])
    return canvas


# ── Algoritm (GOST 19.701) ───────────────────────────────
def draw_algorithm(data):
    nodes = data["nodes"]
    edges = data["edges"]
    canvas = Canvas()
    blocks = [make_block(node, 20) for node in nodes]
    index = {b.id: b for b in blocks}
    order = {b.id: i for i, b in enumerate(blocks)}
    gap = 0.36
    width = max(b.w for b in blocks)
    y = 0.0
    for b in blocks:
        b.x, b.y = 0.0, y - b.h / 2
        y -= b.h + gap
    for b in blocks:
        b.draw(canvas)
    right_lane = width / 2 + 0.36
    left_lane = -(width / 2 + 0.36)
    lane_step = 0.2
    left_used = 0
    # Blok ustiga asosiy (yuqoridan) chiziq kiradimi — kiradigan bo'lsa, yon shox shu chiziqqa nuqta bilan qo'shiladi
    main_into = set()
    for edge in edges:
        if order[edge["to"]] == order[edge["from"]] + 1:
            main_into.add(edge["to"])
    for edge in edges:
        a, c = index[edge["from"]], index[edge["to"]]
        text = str(edge.get("label") or "").strip()
        if order[c.id] == order[a.id] + 1:
            wire(canvas, [a.bottom(), c.top()])
            if text:
                label(canvas, (a.x + 0.08, a.bottom()[1] - 0.04), text, ha="left", va="top", dy=0.0)
            continue
        join_y = c.top()[1] + gap / 2
        if a.kind == "decision":
            start = a.right()
            lane = max(right_lane, a.x + a.w / 2 + 0.28)
            label(canvas, (start[0] + 0.06, start[1] + 0.04), text, ha="left", va="bottom", dy=0.0)
        else:
            lane = left_lane - lane_step * left_used
            left_used += 1
            start = a.left()
            if text:
                label(canvas, (lane - 0.05, (start[1] + join_y) / 2), text, ha="right", va="center", dy=0.0)
        if c.id in main_into:
            # Asosiy chiziqqa qo'shilish: strelkasiz, T-tutashuvda qora nuqta
            wire(canvas, [start, (lane, start[1]), (lane, join_y), (c.x, join_y)], arrow=False)
            dot(canvas, (c.x, join_y))
        else:
            wire(canvas, [start, (lane, start[1]), (lane, join_y), (c.x, join_y), c.top()])
    return canvas


# ── UML daraxt ───────────────────────────────────────────
def draw_tree(data):
    nodes = data["nodes"]
    edges = data["edges"]
    canvas = Canvas()
    blocks = {node["id"]: make_block(node, 16) for node in nodes}
    children = {node["id"]: [] for node in nodes}
    for edge in edges:
        children[edge["from"]].append(edge["to"])
    root = nodes[0]["id"]
    levels = []
    frontier = [root]
    while frontier:
        levels.append(frontier)
        frontier = [child for node in frontier for child in children[node]]
    gap_x, gap_y = 0.28, 0.55
    y = 0.0
    widths = [sum(blocks[i].w for i in level) + gap_x * (len(level) - 1) for level in levels]
    full = max(widths)
    for level, level_width in zip(levels, widths):
        h = max(blocks[i].h for i in level)
        x = (full - level_width) / 2
        for node_id in level:
            b = blocks[node_id]
            b.x, b.y = x + b.w / 2, y - h / 2
            x += b.w + gap_x
        y -= h + gap_y
    # Bitta ota-blokli qatorda o'rtadagi bola aynan ota ostida bo'lsin (yaqin tugunlar bo'lmasin)
    for parent, kids in children.items():
        if len(kids) % 2 == 1:
            p = blocks[parent]
            shift = p.x - blocks[kids[len(kids) // 2]].x
            for k in kids:
                blocks[k].x += shift
    for b in blocks.values():
        b.draw(canvas)
    for parent, kids in children.items():
        if not kids:
            continue
        p = blocks[parent]
        bus_y = p.y - p.h / 2 - gap_y / 2
        wire(canvas, [p.bottom(), (p.x, bus_y)], arrow=False)
        xs = [blocks[k].x for k in kids] + [p.x]
        if len(kids) > 1 or abs(blocks[kids[0]].x - p.x) > 1e-6:
            wire(canvas, [(min(xs), bus_y), (max(xs), bus_y)], arrow=False)
        if len(kids) > 1 and min(xs) < p.x < max(xs):
            dot(canvas, (p.x, bus_y))
        for k in kids:
            c = blocks[k]
            if min(xs) < c.x < max(xs) and abs(c.x - p.x) > 1e-6:
                dot(canvas, (c.x, bus_y))
            wire(canvas, [(c.x, bus_y), c.top()])
    return canvas


# ── Til bo'yicha xizmat yozuvlari ─────────────────────────
WORDS = {
    "uz": {"S": "Kuchli tomonlar (S)", "W": "Zaif tomonlar (W)", "O": "Imkoniyatlar (O)", "T": "Tahdidlar (T)",
           "internal": "Ichki omillar", "external": "Tashqi omillar", "positive": "Ijobiy", "negative": "Salbiy",
           "panel": "Boshqaruv\nshiti", "local": "Joyida"},
    "ru": {"S": "Сильные стороны (S)", "W": "Слабые стороны (W)", "O": "Возможности (O)", "T": "Угрозы (T)",
           "internal": "Внутренние факторы", "external": "Внешние факторы", "positive": "Положительные", "negative": "Отрицательные",
           "panel": "Щит\nуправления", "local": "По месту"},
    "en": {"S": "Strengths (S)", "W": "Weaknesses (W)", "O": "Opportunities (O)", "T": "Threats (T)",
           "internal": "Internal factors", "external": "External factors", "positive": "Positive", "negative": "Negative",
           "panel": "Control\npanel", "local": "Local"},
}


def words(data):
    lang = str(data.get("language") or "").lower()
    if lang.startswith(("ru", "рус")):
        return WORDS["ru"]
    if lang.startswith(("en", "ing")):
        return WORDS["en"]
    return WORDS["uz"]


def plain_text(canvas, point, text, size=FONT_SIZE, ha="center", va="center", weight="normal", italic=False,
               color=BLACK, rotation=0):
    if not text:
        return
    props = FontProperties(family=FONT, size=size, weight=weight, style="italic" if italic else "normal")
    tw, th = text_size(text, props)
    if rotation:
        tw, th = th, tw
    x, y = point
    x0 = x - tw / 2 if ha == "center" else (x - tw if ha == "right" else x)
    y0 = y - th / 2 if va == "center" else (y - th if va == "top" else y)
    canvas.add(lambda ax: ax.text(x, y, text, ha=ha, va=va, fontsize=size, family=FONT, weight=weight,
                                  style="italic" if italic else "normal", color=color, zorder=8,
                                  linespacing=1.15, rotation=rotation),
               (x0, y0, x0 + tw, y0 + th))


def line(canvas, points, color=BLACK, width=CONTOUR_PT, style="-"):
    pts = [tuple(p) for p in points]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    canvas.add(lambda ax: ax.plot(xs, ys, color=color, linewidth=width, linestyle=style,
                                  solid_joinstyle="miter", solid_capstyle="butt", zorder=2),
               (min(xs), min(ys), max(xs), max(ys)))


def fitted_blocks(nodes, max_total, gap, widths=(16, 14, 12, 10, 8), fill=None):
    """Bir qatorga sig'adigan eng keng yozuvli bloklarni tanlaydi."""
    blocks = []
    for width in widths:
        blocks = [make_block(node, width) for node in nodes]
        if fill:
            for b in blocks:
                b.fill = fill
        unify(blocks, height=True)
        if sum(b.w for b in blocks) + gap * (len(blocks) - 1) <= max_total:
            return blocks
    return blocks


# ── Tasnif (klassifikatsiya) daraxti ─────────────────────
def tree_structure(data):
    nodes = data["nodes"]
    children = {node["id"]: [] for node in nodes}
    for edge in data["edges"]:
        children[edge["from"]].append(edge["to"])
    by_id = {node["id"]: node for node in nodes}
    root = next(node for node in nodes if node.get("kind") == "root")
    categories = [by_id[i] for i in children[root["id"]]]
    return root, categories, {c["id"]: [by_id[i] for i in children[c["id"]]] for c in categories}


def draw_classification_vertical(data):
    root_node, categories, items = tree_structure(data)
    canvas = Canvas()
    gap_x, gap_y, item_gap = 0.2, 0.5, 0.16
    cats = fitted_blocks(categories, MAX_WIDTH_IN, gap_x, fill=BLUE_LIGHT)
    root = make_block(root_node, 30)
    root.label = root.label
    x = 0.0
    for b in cats:
        b.x = x + b.w / 2
        x += b.w + gap_x
    total = x - gap_x
    root.x, root.y = total / 2, 0.0
    cat_y = -(root.h / 2 + gap_y + cats[0].h / 2)
    for b in cats:
        b.y = cat_y
    root.draw(canvas)
    bus_y = root.y - root.h / 2 - gap_y / 2
    wire(canvas, [root.bottom(), (root.x, bus_y)], arrow=False)
    wire(canvas, [(cats[0].x, bus_y), (cats[-1].x, bus_y)], arrow=False)
    if cats[0].x < root.x < cats[-1].x:
        dot(canvas, (root.x, bus_y))
    for b, cat_node in zip(cats, categories):
        b.draw(canvas)
        if cats[0].x < b.x < cats[-1].x and abs(b.x - root.x) > 1e-6:
            dot(canvas, (b.x, bus_y))
        wire(canvas, [(b.x, bus_y), b.top()])
        kids = items[cat_node["id"]]
        if not kids:
            continue
        # Bolalar ota ostida ustun bo'lib: chap tomondagi umurtqa → o'ng tomonga strelka
        spine_x = b.x - b.w / 2 + 0.12
        width = b.w - 0.24
        y = b.y - b.h / 2 - item_gap
        last_y = None
        kid_blocks = []
        for kid in kids:
            for wrap_try in (14, 12, 10, 8):
                kb = make_block(kid, wrap_try)
                if kb.w <= width:
                    break
            kb.w = max(kb.w, width - 0.04)
            kb.x = spine_x + 0.16 + kb.w / 2
            kb.y = y - kb.h / 2
            y -= kb.h + item_gap
            kid_blocks.append(kb)
        for kb in kid_blocks:
            kb.draw(canvas)
            wire(canvas, [(spine_x, kb.y), kb.left()])
            last_y = kb.y
        line(canvas, [(spine_x, b.y - b.h / 2), (spine_x, last_y)], color=BLUE_DARK, width=SIGNAL_PT)
        for kb in kid_blocks[:-1]:
            dot(canvas, (spine_x, kb.y))
    return canvas


def draw_classification_horizontal(data):
    root_node, categories, items = tree_structure(data)
    canvas = Canvas()
    gap_x, gap_y = 0.42, 0.16
    root = make_block(root_node, 12)
    root.fill = WHITE
    cats = [make_block(node, 16) for node in categories]
    for b in cats:
        b.fill = BLUE_LIGHT
    unify(cats)
    kid_rows = []
    for cat in categories:
        row = [make_block(kid, 16) for kid in items[cat["id"]]]
        kid_rows.append(row)
    all_kids = [k for row in kid_rows for k in row]
    if all_kids:
        unify(all_kids)
    # Har bir kategoriya qatori balandligi: o'zi yoki bolalari ustuni
    cat_x = root.w + gap_x + cats[0].w / 2
    kid_x = cat_x + cats[0].w / 2 + gap_x + (all_kids[0].w / 2 if all_kids else 0)
    y = 0.0
    for b, row in zip(cats, kid_rows):
        stack = sum(k.h for k in row) + gap_y * max(0, len(row) - 1)
        band = max(b.h, stack)
        b.x, b.y = cat_x, y - band / 2
        ky = y - (band - stack) / 2
        for k in row:
            k.x, k.y = kid_x, ky - k.h / 2
            ky -= k.h + gap_y
        y -= band + gap_y * 2.2
    # Ildiz ikki kategoriya orasida — 4 tomonlama tugun hosil bo'lmaydi
    k = len(cats) // 2
    root.x, root.y = root.w / 2, (cats[k - 1].y + cats[k].y) / 2
    bus_x = root.w + gap_x / 2
    root.draw(canvas)
    wire(canvas, [root.right(), (bus_x, root.y)], arrow=False)
    wire(canvas, [(bus_x, cats[0].y), (bus_x, cats[-1].y)], arrow=False)
    dot(canvas, (bus_x, root.y))
    for b, row in zip(cats, kid_rows):
        b.draw(canvas)
        if cats[0].y > b.y > cats[-1].y and abs(b.y - root.y) > 1e-6:
            dot(canvas, (bus_x, b.y))
        wire(canvas, [(bus_x, b.y), b.left()])
        if not row:
            continue
        sub_x = b.x + b.w / 2 + gap_x / 2
        for k in row:
            k.draw(canvas)
            wire(canvas, [(sub_x, k.y), k.left()])
        wire(canvas, [b.right(), (sub_x, b.y)], arrow=False)
        ys = [k.y for k in row] + [b.y]
        if max(ys) - min(ys) > 1e-6:
            line(canvas, [(sub_x, max(ys)), (sub_x, min(ys))], color=BLUE_DARK, width=SIGNAL_PT)
        if len(row) > 1:
            dot(canvas, (sub_x, b.y))
        for k in row:
            if min(ys) < k.y < max(ys) and abs(k.y - b.y) > 1e-6:
                dot(canvas, (sub_x, k.y))
    return canvas


# ── Ishikava ("baliq skeleti") diagrammasi ───────────────
def draw_ishikawa(data):
    nodes = data["nodes"]
    by_id = {node["id"]: node for node in nodes}
    effect_node = next(node for node in nodes if node.get("kind") == "effect")
    causes = [node for node in nodes if node.get("kind") == "cause"]
    factors = {c["id"]: [] for c in causes}
    for edge in data["edges"]:
        if by_id[edge["from"]].get("kind") == "factor":
            factors[edge["to"]].append(by_id[edge["from"]])
    canvas = Canvas()
    columns = math.ceil(len(causes) / 2)
    effect = make_block(effect_node, 12)
    effect.fill = BLUE_LIGHT
    col_w = (MAX_WIDTH_IN - effect.w - 0.35) / columns
    blocks = []
    for wrap_try in (14, 12, 10, 8):
        blocks = [make_block(c, wrap_try) for c in causes]
        if max(b.w for b in blocks) <= col_w - 0.18:
            break
    unify(blocks)
    bone_h = 1.05 + 0.2 * max([len(v) for v in factors.values()] + [0])
    slope = 0.42  # suyakning gorizontal siljishi / balandlik
    spine_y = 0.0
    spine_x0 = 0.0
    for index, (b, cause) in enumerate(zip(blocks, causes)):
        col = index // 2
        up = index % 2 == 0
        b.x = spine_x0 + col * col_w + b.w / 2 + 0.05
        b.y = spine_y + (bone_h + b.h / 2) * (1 if up else -1)
    spine_end = spine_x0 + columns * col_w + 0.2
    effect.x, effect.y = spine_end + effect.w / 2, spine_y
    # Umurtqa — asosiy qalin chiziq, natijaga strelka
    wire(canvas, [(spine_x0, spine_y), effect.left()], color=BLACK, width=CONTOUR_PT)
    effect.draw(canvas)
    factor_props = FontProperties(family=FONT, size=LABEL_SIZE)
    for b, cause in zip(blocks, causes):
        b.draw(canvas)
        up = b.y > spine_y
        start = b.bottom() if up else b.top()
        end = (start[0] + slope * bone_h, spine_y)
        wire(canvas, [start, end], color=BLUE_DARK, width=SIGNAL_PT)
        kids = factors[cause["id"]]
        for k_index, factor in enumerate(kids):
            t = (k_index + 1) / (len(kids) + 1)
            fy = start[1] + (end[1] - start[1]) * t
            fx = start[0] + (end[0] - start[0]) * t
            text = wrap(factor.get("label", ""), 14)
            tw, th = text_size(text, factor_props)
            # Yozuv suyakdan chapda, uning ostida gorizontal "qovurg'a" chizig'i
            dy_text = (th / 2 + 0.06) if not (b.y > spine_y) else (th / 2 + 0.06)
            text_right = fx - 0.1 - abs(dy_text) * slope
            tick_len = tw + 0.18 + abs(dy_text) * slope
            line(canvas, [(fx - tick_len, fy), (fx, fy)], color=BLUE_DARK, width=SIGNAL_PT * 0.7)
            plain_text(canvas, (text_right, fy + 0.04), text, size=LABEL_SIZE, ha="right", va="bottom")
    return canvas


# ── Vaqt chizig'i (timeline) ─────────────────────────────
def draw_timeline_horizontal(data):
    nodes = data["nodes"]
    canvas = Canvas()
    n = len(nodes)
    step = (MAX_WIDTH_IN - 0.5) / max(1, n - 1) if n > 1 else 1.0
    max_box = min(2 * step - 0.16, 1.9)
    blocks = []
    for wrap_try in (16, 14, 12, 10, 8):
        blocks = [make_block(node, wrap_try) for node in nodes]
        if max(b.w for b in blocks) <= max_box:
            break
    unify(blocks, width=False)
    axis_y = 0.0
    stem = 0.42
    x0 = 0.25
    for index, b in enumerate(blocks):
        up = index % 2 == 0
        cx = x0 + index * step
        b.x = cx
        b.y = axis_y + (stem + b.h / 2) * (1 if up else -1)
    # Chegaradan chiqmasin
    left_shift = min(0.0, min(b.x - b.w / 2 for b in blocks))
    right_over = max(0.0, max(b.x + b.w / 2 for b in blocks) - MAX_WIDTH_IN)
    wire(canvas, [(min(-0.05, left_shift), axis_y), (MAX_WIDTH_IN + 0.05 + right_over * 0, axis_y)],
         color=BLACK, width=CONTOUR_PT)
    date_props = FontProperties(family=FONT, size=LABEL_SIZE, weight="bold")
    for index, (b, node) in enumerate(zip(blocks, nodes)):
        up = index % 2 == 0
        cx = x0 + index * step
        b.draw(canvas)
        line(canvas, [(cx, axis_y), b.bottom() if up else b.top()], color=BLUE_DARK, width=SIGNAL_PT)
        r = 0.055
        canvas.add(lambda ax, cx=cx: ax.add_patch(Circle((cx, axis_y), r, facecolor=BLACK, edgecolor=BLACK, zorder=7)),
                   (cx - r, axis_y - r, cx + r, axis_y + r))
        # Sana — chiziqning qarama-qarshi tomonida
        plain_text(canvas, (cx, axis_y + (-0.1 if up else 0.1)), mathify(node.get("date", "")), size=LABEL_SIZE,
                   va="top" if up else "bottom", weight="bold")
    return canvas


def draw_timeline_vertical(data):
    nodes = data["nodes"]
    canvas = Canvas()
    date_props = FontProperties(family=FONT, size=FONT_SIZE, weight="bold")
    date_w = max(text_size(str(node.get("date", "")), date_props)[0] for node in nodes)
    axis_x = date_w + 0.25
    blocks = [make_block(node, 34) for node in nodes]
    for b in blocks:
        b.w = max(b.w, 2.6)
    unify(blocks, height=False)
    y = 0.0
    gap = 0.22
    for b in blocks:
        b.x = axis_x + 0.45 + b.w / 2
        b.y = y - b.h / 2
        y -= b.h + gap
    top_y = blocks[0].y + blocks[0].h / 2 + 0.1
    bottom_y = blocks[-1].y - blocks[-1].h / 2 - 0.15
    wire(canvas, [(axis_x, top_y), (axis_x, bottom_y)], color=BLACK, width=CONTOUR_PT)
    for b, node in zip(blocks, nodes):
        b.draw(canvas)
        line(canvas, [(axis_x, b.y), b.left()], color=BLUE_DARK, width=SIGNAL_PT)
        r = 0.055
        canvas.add(lambda ax, yy=b.y: ax.add_patch(Circle((axis_x, yy), r, facecolor=BLACK, edgecolor=BLACK, zorder=7)),
                   (axis_x - r, b.y - r, axis_x + r, b.y + r))
        plain_text(canvas, (axis_x - 0.14, b.y), mathify(str(node.get("date", ""))), ha="right", weight="bold")
    return canvas


# ── Siklik jarayon ───────────────────────────────────────
def draw_cycle_ring(data):
    nodes = data["nodes"]
    canvas = Canvas()
    n = len(nodes)
    blocks = [make_block(node, 14) for node in nodes]
    unify(blocks)
    w, h = blocks[0].w, blocks[0].h
    # Ellips bo'ylab: keng bloklar uchun gorizontal radius kattaroq
    rx = max(1.2, (MAX_WIDTH_IN - w) / 2)
    ry = max(1.0, min(rx * 0.68, (h + 0.55) / (2 * math.sin(math.pi / n)) + 0.35))
    angles = [math.pi / 2 - 2 * math.pi * i / n for i in range(n)]
    for b, a in zip(blocks, angles):
        b.x, b.y = rx * math.cos(a), ry * math.sin(a)
        b.draw(canvas)

    def inside(b, px, py):
        return abs(px - b.x) <= b.w / 2 + 0.01 and abs(py - b.y) <= b.h / 2 + 0.01

    for i in range(n):
        a0, a1 = angles[i], angles[(i + 1) % n]
        if a1 > a0:
            a1 -= 2 * math.pi
        steps = 600
        pts = [(rx * math.cos(a0 + (a1 - a0) * t / steps), ry * math.sin(a0 + (a1 - a0) * t / steps))
               for t in range(steps + 1)]
        src, dst = blocks[i], blocks[(i + 1) % n]
        pts = [p for p in pts if not inside(src, *p) and not inside(dst, *p)]
        if len(pts) >= 2:
            wire(canvas, pts)
    return canvas


def draw_cycle_loop(data):
    nodes = data["nodes"]
    canvas = Canvas()
    n = len(nodes)
    top_count = math.ceil(n / 2)
    gap = 0.5
    blocks = fitted_blocks(nodes, MAX_WIDTH_IN - 0.5, gap, widths=(16, 14, 12, 10))
    unify(blocks)
    top = blocks[:top_count]
    bottom = blocks[top_count:]
    row_gap = 0.75
    x = 0.25
    for b in top:
        b.x, b.y = x + b.w / 2, 0.0
        x += b.w + gap
    # Pastki qator o'ngdan chapga (aylanma yo'nalish)
    xs = [b.x for b in top]
    for index, b in enumerate(bottom):
        b.x = xs[len(xs) - 1 - index] if len(xs) - 1 - index >= 0 else xs[0]
        b.y = -(top[0].h + row_gap)
    for b in blocks:
        b.draw(canvas)
    for a, c in zip(top, top[1:]):
        wire(canvas, [a.right(), c.left()])
    for a, c in zip(bottom, bottom[1:]):
        wire(canvas, [a.left(), c.right()])
    last_top = top[-1]
    lane_r = last_top.x + last_top.w / 2 + 0.25
    lane_l = min(b.x - b.w / 2 for b in blocks) - 0.25
    if bottom:
        first_bottom = bottom[0]
        if abs(first_bottom.x - last_top.x) < 1e-6:
            wire(canvas, [last_top.bottom(), first_bottom.top()])
        else:
            wire(canvas, [last_top.right(), (lane_r, last_top.y), (lane_r, first_bottom.y), first_bottom.right()])
        tail = bottom[-1]
        wire(canvas, [tail.left(), (lane_l, tail.y), (lane_l, top[0].y), top[0].left()])
    else:
        wire(canvas, [last_top.bottom(), (last_top.x, -row_gap), (top[0].x, -row_gap), top[0].bottom()])
    return canvas


# ── SWOT matritsasi ──────────────────────────────────────
def draw_swot(data):
    w = words(data)
    canvas = Canvas()
    side_w = 0.34
    cell_w = (MAX_WIDTH_IN - side_w) / 2
    head_h = 0.34
    groups = {kind: [node for node in data["nodes"] if node.get("kind") == kind]
              for kind in ("strength", "weakness", "opportunity", "threat")}
    item_props = FontProperties(family=FONT, size=FONT_SIZE)
    chars = max(14, int((cell_w - 0.3) / (text_size("o" * 20, item_props)[0] / 20)))

    def lines_for(kind):
        out = []
        for node in groups[kind]:
            wrapped = wrap(node.get("label", ""), chars).split("\n")
            out.append("– " + wrapped[0])
            out.extend("   " + rest for rest in wrapped[1:])
        return out

    texts = {kind: lines_for(kind) for kind in groups}
    line_h = text_size("Ag", item_props)[1] * 1.3
    row_h = [max(len(texts["strength"]), len(texts["weakness"])) * line_h + 0.22,
             max(len(texts["opportunity"]), len(texts["threat"])) * line_h + 0.22]
    top_head = 0.3
    x0 = side_w
    y_top = 0.0
    layout = [(("strength", "S"), ("weakness", "W")), (("opportunity", "O"), ("threat", "T"))]
    # Ustun sarlavhalari (ijobiy/salbiy)
    plain_text(canvas, (x0 + cell_w / 2, y_top + top_head / 2), w["positive"], size=LABEL_SIZE, italic=True)
    plain_text(canvas, (x0 + cell_w * 1.5, y_top + top_head / 2), w["negative"], size=LABEL_SIZE, italic=True)
    y = y_top
    for row_index, row in enumerate(layout):
        cell_h = head_h + row_h[row_index]
        for col_index, (kind, letter) in enumerate(row):
            cx0 = x0 + col_index * cell_w
            cy0 = y - cell_h

            def op(ax, cx0=cx0, cy0=cy0, cell_h=cell_h):
                ax.add_patch(Rectangle((cx0, cy0 + cell_h - head_h), cell_w, head_h, facecolor=BLUE_LIGHT,
                                       edgecolor=BLACK, linewidth=CONTOUR_PT * 0.5, zorder=2))
                ax.add_patch(Rectangle((cx0, cy0), cell_w, cell_h, facecolor="none", edgecolor=BLACK,
                                       linewidth=CONTOUR_PT, zorder=3, joinstyle="miter"))
            canvas.add(op, (cx0, cy0, cx0 + cell_w, y))
            plain_text(canvas, (cx0 + cell_w / 2, y - head_h / 2), w[letter], weight="bold")
            plain_text(canvas, (cx0 + 0.12, y - head_h - 0.1), "\n".join(texts[kind]), ha="left", va="top")
        # Qator yorlig'i (ichki/tashqi) — chapda vertikal
        plain_text(canvas, (side_w / 2, y - cell_h / 2), w["internal" if row_index == 0 else "external"],
                   size=LABEL_SIZE, italic=True, rotation=90)
        y -= cell_h
    return canvas


# ── Avtomatlashtirishning funksional sxemasi (GOST 21.208) ─
def instrument(canvas, center, tag, number, panel=False, r=0.25):
    x, y = center

    def op(ax):
        ax.add_patch(Circle((x, y), r, facecolor=WHITE, edgecolor=BLACK, linewidth=CONTOUR_PT * 0.75, zorder=5))
        if panel:
            ax.plot([x - r, x + r], [y, y], color=BLACK, linewidth=CONTOUR_PT * 0.6, zorder=6)
        ax.text(x, y + r * 0.42, tag, ha="center", va="center", fontsize=LABEL_SIZE - 1, family=FONT, zorder=7)
        ax.text(x, y - r * 0.45, number, ha="center", va="center", fontsize=LABEL_SIZE - 2, family=FONT, zorder=7)
    canvas.add(op, (x - r, y - r, x + r, y + r))


def valve(canvas, center, size=0.15):
    x, y = center

    def op(ax):
        ax.add_patch(Polygon([(x - size, y + size * 0.75), (x - size, y - size * 0.75), (x + size, y + size * 0.75),
                              (x + size, y - size * 0.75)], closed=True, facecolor=WHITE, edgecolor=BLACK,
                             linewidth=CONTOUR_PT * 0.75, zorder=5))
    canvas.add(op, (x - size, y - size, x + size, y + size))


def draw_automation(data):
    w = words(data)
    nodes = data["nodes"]
    edges = data["edges"]
    by_id = {node["id"]: node for node in nodes}
    kind_of = lambda i: by_id[i].get("kind")
    canvas = Canvas()
    equipment_node = next(node for node in nodes if node.get("kind") == "equipment")
    streams = [node for node in nodes if node.get("kind") == "stream"]
    inputs = [s for s in streams if any(e["from"] == s["id"] and e["to"] == equipment_node["id"] for e in edges)]
    outputs = [s for s in streams if s not in inputs]
    sensors = [node for node in nodes if node.get("kind") == "sensor"]
    controllers = [node for node in nodes if node.get("kind") == "controller"]
    actuators = [node for node in nodes if node.get("kind") == "actuator"]
    number = {node["id"]: f"{index + 1}" for index, node in enumerate(sensors)}
    for index, node in enumerate(controllers):
        number[node["id"]] = f"{index + 1}a"
    for index, node in enumerate(actuators):
        number[node["id"]] = f"{index + 1}b"

    eq = make_block(equipment_node, 16)
    eq.fill = BLUE_LIGHT
    eq.w = max(eq.w, 1.7)
    eq.h = max(eq.h, 0.95)
    pipe_len = 1.55
    left_x = 0.0
    eq.x = left_x + pipe_len + eq.w / 2
    eq.y = 0.0
    # Quvurlar: kirishlar chapdan, chiqishlar o'ngga
    def pipe_ys(count):
        if count <= 1:
            return [0.0]
        return [eq.h / 4, -eq.h / 4]
    stream_pos = {}
    for s, py in zip(inputs, pipe_ys(len(inputs))):
        start = (left_x, py)
        wire(canvas, [start, (eq.x - eq.w / 2, py)], color=BLACK, width=CONTOUR_PT)
        plain_text(canvas, (left_x, py + 0.06), wrap(s.get("label", ""), 16), size=LABEL_SIZE, ha="left", va="bottom", italic=True)
        stream_pos[s["id"]] = ("in", py, left_x + 0.25, eq.x - eq.w / 2)
    right_end = eq.x + eq.w / 2 + pipe_len
    for s, py in zip(outputs, pipe_ys(len(outputs))):
        wire(canvas, [(eq.x + eq.w / 2, py), (right_end, py)], color=BLACK, width=CONTOUR_PT)
        plain_text(canvas, (right_end, py + 0.06), wrap(s.get("label", ""), 16), size=LABEL_SIZE, ha="right", va="bottom", italic=True)
        stream_pos[s["id"]] = ("out", py, eq.x + eq.w / 2 + 0.25, right_end - 0.25)
    eq.draw(canvas)

    # Klapanlar (bajaruvchi mexanizm) — o'z quvurining o'rtasida
    actuator_pos = {}
    for act in actuators:
        target = next((e["to"] for e in edges if e["from"] == act["id"] and kind_of(e["to"]) == "stream"), None)
        side, py, a, b = stream_pos.get(target, ("in", 0.0, left_x + 0.25, eq.x - eq.w / 2))
        vx = (a + b) / 2 + (0.15 if side == "in" else -0.15)
        valve(canvas, (vx, py))
        stem_top = py + 0.55
        line(canvas, [(vx, py + 0.11), (vx, stem_top - 0.25)], width=CONTOUR_PT * 0.6)
        instrument(canvas, (vx, stem_top), act.get("tag", "FV"), number[act["id"]])
        actuator_pos[act["id"]] = (vx, stem_top + 0.25)

    # Datchiklar — o'lchanadigan joy ostida
    panel_top = -eq.h / 2 - 1.25
    sensor_pos = {}
    on_eq = [s for s in sensors if any(e["to"] == s["id"] and kind_of(e["from"]) == "equipment" for e in edges)]
    on_pipe = [s for s in sensors if s not in on_eq]
    for index, s in enumerate(on_eq):
        sx = eq.x - eq.w / 2 + eq.w * (index + 1) / (len(on_eq) + 1)
        sy = -eq.h / 2 - 0.55
        line(canvas, [(sx, -eq.h / 2), (sx, sy + 0.25)], width=CONTOUR_PT * 0.6)
        dot(canvas, (sx, -eq.h / 2))
        instrument(canvas, (sx, sy), s.get("tag", "TE"), number[s["id"]])
        sensor_pos[s["id"]] = (sx, sy)
    for index, s in enumerate(on_pipe):
        src = next((e["from"] for e in edges if e["to"] == s["id"]), None)
        side, py, a, b = stream_pos.get(src, ("in", 0.0, left_x + 0.25, eq.x - eq.w / 2))
        sx = a + 0.1 + index * 0.6 if side == "in" else b - 0.1 - index * 0.6
        sy = min(py, 0.0) - eq.h / 2 - 0.55
        line(canvas, [(sx, py), (sx, sy + 0.25)], width=CONTOUR_PT * 0.6)
        dot(canvas, (sx, py))
        instrument(canvas, (sx, sy), s.get("tag", "PT"), number[s["id"]])
        sensor_pos[s["id"]] = (sx, sy)

    # Boshqaruv shiti tasmasi
    band_h = 0.85
    band_x0 = -0.95
    band_x1 = max(right_end, eq.x + eq.w / 2 + 0.6) + 0.1
    band_y0 = panel_top - band_h

    def band(ax):
        ax.add_patch(Rectangle((band_x0, band_y0), band_x1 - band_x0, band_h, facecolor="none", edgecolor=BLACK,
                               linewidth=CONTOUR_PT * 0.75, zorder=2))
        ax.plot([band_x0 + 0.85, band_x0 + 0.85], [band_y0, panel_top], color=BLACK, linewidth=CONTOUR_PT * 0.75, zorder=2)
    canvas.add(band, (band_x0, band_y0, band_x1, panel_top))
    plain_text(canvas, (band_x0 + 0.425, band_y0 + band_h / 2), w["panel"], size=LABEL_SIZE - 1)
    controller_pos = {}
    used_x = []
    for c in controllers:
        feeding = [sensor_pos[e["from"]][0] for e in edges if e["to"] == c["id"] and e["from"] in sensor_pos]
        cx = sum(feeding) / len(feeding) if feeding else (band_x0 + band_x1) / 2
        while any(abs(cx - u) < 0.65 for u in used_x):
            cx += 0.7
        used_x.append(cx)
        cy = band_y0 + band_h / 2
        instrument(canvas, (cx, cy), c.get("tag", "TIC"), number[c["id"]], panel=True)
        controller_pos[c["id"]] = (cx, cy)
    # Signal chiziqlari (to'q ko'k)
    lane = band_x0 - 0.22
    lane_used = 0
    for e in edges:
        f, t = e["from"], e["to"]
        if f in sensor_pos and t in controller_pos:
            sx, sy = sensor_pos[f]
            cx, cy = controller_pos[t]
            low = min(p[1] for p in sensor_pos.values())
            mid = (low - 0.25 + cy + 0.25) / 2
            pts = [(sx, sy - 0.25)] + ([(sx, mid), (cx, mid)] if abs(sx - cx) > 1e-6 else []) + [(cx, cy + 0.25)]
            wire(canvas, pts)
            feeders = [sensor_pos[e2["from"]][0] for e2 in edges if e2["to"] == t and e2["from"] in sensor_pos]
            if len(feeders) > 1 and min(feeders) < cx < max(feeders):
                dot(canvas, (cx, mid))
        elif f in controller_pos and t in controller_pos:
            (ax_, ay), (bx, by) = controller_pos[f], controller_pos[t]
            wire(canvas, [(ax_ + 0.25, ay), (bx - 0.25, by)] if bx > ax_ else [(ax_ - 0.25, ay), (bx + 0.25, by)])
        elif f in controller_pos and t in actuator_pos:
            cx, cy = controller_pos[f]
            vx, vtop = actuator_pos[t]
            lx = lane - 0.18 * lane_used
            lane_used += 1
            over = vtop + 0.25 + 0.12 * lane_used
            wire(canvas, [(cx, cy - 0.25), (cx, band_y0 - 0.18), (lx, band_y0 - 0.18), (lx, over), (vx, over), (vx, vtop)])
    return canvas


def build(data):
    diagram_type = data.get("diagram_type")
    if diagram_type == "pid_control_system":
        return draw_pid(data)
    if diagram_type == "algorithm_flowchart":
        return draw_algorithm(data)
    if diagram_type == "uml_software_architecture":
        return draw_tree(data)
    if diagram_type == "functional_block_diagram":
        nodes = data["nodes"]
        if all(node.get("kind") == "input" for node in nodes[:-1]) and len(nodes) >= 3:
            return draw_fan_in(data)
        return draw_chain(data)
    if diagram_type == "process_sequence":
        return draw_chain(data)
    variant = str(data.get("variant") or "")
    if diagram_type == "classification_tree":
        return draw_classification_horizontal(data) if variant == "horizontal" else draw_classification_vertical(data)
    if diagram_type == "ishikawa_diagram":
        return draw_ishikawa(data)
    if diagram_type == "timeline_diagram":
        return draw_timeline_vertical(data) if variant == "vertical" else draw_timeline_horizontal(data)
    if diagram_type == "cycle_diagram":
        return draw_cycle_loop(data) if variant == "loop" else draw_cycle_ring(data)
    if diagram_type == "swot_matrix":
        return draw_swot(data)
    if diagram_type == "automation_scheme":
        return draw_automation(data)
    raise ValueError(f"unsupported schematic type: {diagram_type}")


def main():
    data = json.load(sys.stdin)
    plt.rcParams.update({"font.family": "sans-serif", "font.sans-serif": [FONT, "DejaVu Sans"],
                         "svg.fonttype": "none", "figure.facecolor": "white"})
    canvas = build(data)
    fig = canvas.render()
    width_in = fig.get_size_inches()[0]
    if width_in > MAX_WIDTH_IN + 0.5:
        print(f"WIDTH_WARNING: {width_in:.2f} in", file=sys.stderr)
    fig.savefig(sys.stdout.buffer, format="png", dpi=DPI, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(f"Schematic render error: {error}", file=sys.stderr)
        sys.exit(1)
