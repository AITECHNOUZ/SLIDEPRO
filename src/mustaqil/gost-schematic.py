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
