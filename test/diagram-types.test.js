const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const sharp = require("sharp");
const {
  GRAPHVIZ_DIAGRAM_TYPES,
  MATPLOTLIB_DIAGRAM_TYPES,
  classifyGraphvizType,
  classifyMatplotlibType,
} = require("../src/mustaqil/diagram-types");
const { normalizeFlowchartData } = require("../src/mustaqil/flowchart-data");
const { buildFlowchartDot } = require("../src/mustaqil/flowchart");
const { normalizeChartData, safeMathExpression } = require("../src/mustaqil/chart-data");
const { renderChart } = require("../src/mustaqil/chart");

function graphvizLayout(flowchart) {
  const rendered = spawnSync("dot", ["-Tjson"], { input: buildFlowchartDot(flowchart), maxBuffer: 4 * 1024 * 1024 });
  assert.equal(rendered.status, 0, rendered.stderr?.toString("utf8"));
  return JSON.parse(rendered.stdout.toString("utf8"));
}

function graphvizTextRects(object) {
  const fontSize = Number(object._ldraw_?.find(draw => draw.op === "F")?.size || object.fontsize || 12);
  return (object._ldraw_ || []).filter(draw => draw.op === "T").map(draw => {
    const [x, y] = draw.pt;
    const halfWidth = Number(draw.width) / 2 + 2;
    return { left: x - halfWidth, right: x + halfWidth, bottom: y - fontSize / 2 - 2, top: y + fontSize / 2 + 2 };
  });
}

function graphvizSplineSamples(edge, steps = 24) {
  const samples = [];
  for (const draw of (edge._draw_ || []).filter(item => item.op === "b")) {
    const points = draw.points;
    if (points.length >= 4 && (points.length - 1) % 3 === 0) {
      for (let start = 0; start + 3 < points.length; start += 3) {
        const [p0, p1, p2, p3] = points.slice(start, start + 4);
        for (let index = 0; index <= steps; index++) {
          const t = index / steps;
          const u = 1 - t;
          samples.push({
            x: u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
            y: u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
          });
        }
      }
    }
  }
  return samples;
}

function graphvizLabelsAndRoutesAreClear(layout) {
  assert.equal(graphvizTextRects(layout).length, 0, "Graphviz rasmida alohida sarlavha bo‘lmasin");
  const nodeObjects = layout.objects.filter(object => object.pos);
  const nodeRects = nodeObjects.flatMap(graphvizTextRects);
  const nodesByGvid = new Map(nodeObjects.map(node => [node._gvid, node]));
  const protectedText = nodeRects;
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;

  for (const edge of layout.edges) {
    const route = graphvizSplineSamples(edge);
    assert.ok(route.length > 0, `Graphviz spline ${edge.tail}→${edge.head} mavjud bo‘lsin`);
    const arrow = [...(edge._hdraw_ || []), ...(edge._tdraw_ || [])].find(draw => (draw.op === "P" || draw.op === "p") && draw.points?.length);
    assert.ok(arrow, `Graphviz strelkasi ${edge.tail}→${edge.head} chizilsin`);
    const arrowCenter = arrow.points.reduce((center, point) => [center[0] + point[0] / arrow.points.length, center[1] + point[1] / arrow.points.length], [0, 0]);
    const endpointDistance = node => {
      const [x, y] = node.pos.split(",").map(Number);
      return Math.hypot(arrowCenter[0] - x, arrowCenter[1] - y);
    };
    assert.ok(endpointDistance(nodesByGvid.get(edge.head)) < endpointDistance(nodesByGvid.get(edge.tail)),
      `strelka ${edge.tail}→${edge.head} haqiqiy target tugunga qarasin`);
    for (const point of route) {
      for (const textRect of protectedText) {
        assert.ok(point.x < textRect.left || point.x > textRect.right || point.y < textRect.bottom || point.y > textRect.top,
          `o‘q ${edge.tail}→${edge.head} (${point.x.toFixed(2)},${point.y.toFixed(2)}) tugun yozuvi qutisiga tegmasin: ${JSON.stringify(textRect)}`);
      }
    }
    const edgeLabelRects = graphvizTextRects(edge);
    for (const labelRect of edgeLabelRects) {
      for (const textRect of protectedText) {
        assert.ok(!overlaps(labelRect, textRect), `qirra yozuvi ${edge.tail}→${edge.head} tugun yozuvi bilan ustma-ust tushmasin`);
      }
    }
  }

  for (let first = 0; first < layout.edges.length; first++) {
    const a = layout.edges[first];
    const aEnds = new Set([a.tail, a.head]);
    const aPoints = graphvizSplineSamples(a);
    for (let second = first + 1; second < layout.edges.length; second++) {
      const b = layout.edges[second];
      if ([b.tail, b.head].some(node => aEnds.has(node))) continue;
      const bPoints = graphvizSplineSamples(b);
      for (let i = 1; i < aPoints.length; i++) {
        for (let j = 1; j < bPoints.length; j++) {
          const p = aPoints[i - 1], q = aPoints[i], r = bPoints[j - 1], s = bPoints[j];
          const orient = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
          const crosses = orient(p.x, p.y, q.x, q.y, r.x, r.y) * orient(p.x, p.y, q.x, q.y, s.x, s.y) < -0.01
            && orient(r.x, r.y, s.x, s.y, p.x, p.y) * orient(r.x, r.y, s.x, s.y, q.x, q.y) < -0.01;
          assert.equal(crosses, false, `bog‘liq bo‘lmagan o‘qlar ${a.tail}→${a.head} va ${b.tail}→${b.head} kesishmasin`);
        }
      }
    }
  }
}

const algorithm = {
  diagram_type: "algorithm_flowchart",
  title: "Suv sifatini tekshirish algoritmi",
  nodes: [
    { id: "start", label: "Boshlash", kind: "start" },
    { id: "measure", label: "Suvni o'lchash", kind: "process" },
    { id: "check", label: "Mezonni tekshirish", kind: "decision" },
    { id: "treat", label: "Suvni tozalash", kind: "process" },
    { id: "end", label: "Tugatish", kind: "end" },
  ],
  edges: [
    { from: "start", to: "measure" },
    { from: "measure", to: "check" },
    { from: "check", to: "treat", label: "Ha" },
    { from: "check", to: "end", label: "Yo'q" },
    { from: "treat", to: "end" },
  ],
};

const pid = {
  diagram_type: "pid_control_system",
  title: "PID yopiq boshqaruv konturi",
  nodes: [
    { id: "ref", label: "Topshiriq signali", kind: "input" },
    { id: "sum", label: "Σ", kind: "sum" },
    { id: "pid", label: "PID rostlagich", kind: "controller" },
    { id: "plant", label: "Boshqaruv obyekti", kind: "plant" },
    { id: "sensor", label: "O'lchov datchigi", kind: "sensor" },
  ],
  edges: [
    { from: "ref", to: "sum" },
    { from: "sum", to: "pid" },
    { from: "pid", to: "plant" },
    { from: "plant", to: "sensor" },
    { from: "sensor", to: "sum", label: "Teskari aloqa" },
  ],
};

test("mavzu semantikasi yetti nomlangan diagramma turiga yo‘naltiriladi", () => {
  assert.deepEqual(GRAPHVIZ_DIAGRAM_TYPES, [
    "functional_block_diagram", "algorithm_flowchart", "pid_control_system", "uml_software_architecture", "process_sequence",
  ]);
  assert.deepEqual(MATPLOTLIB_DIAGRAM_TYPES, ["mathematical_graph", "experiment_results"]);
  assert.equal(classifyGraphvizType({ topic: "Funksional blok-sxema Graphviz" }), "functional_block_diagram");
  assert.equal(classifyGraphvizType({ topic: "Algoritm blok-sxemasi Graphviz" }), "algorithm_flowchart");
  assert.equal(classifyGraphvizType({ topic: "Boshqaruv tizimi PID Graphviz" }), "pid_control_system");
  assert.equal(classifyGraphvizType({ topic: "UML va dastur arxitekturasi Graphviz" }), "uml_software_architecture");
  assert.equal(classifyGraphvizType({ topic: "Jarayonlar ketma-ketligi Graphviz" }), "process_sequence");
  assert.equal(classifyGraphvizType({ planTitle: "Inqirozni erta aniqlash va javob choralarini tanlash", purpose: "indikatorlar asosida siyosat paketini bosqichma-bosqich tanlash" }), "process_sequence");
  assert.equal(classifyGraphvizType({ topic: "Suvni tozalash jarayoni" }), "functional_block_diagram");
  assert.equal(classifyGraphvizType({ topic: "UML arxitekturasi", diagram_type: "process_sequence" }), "process_sequence");
  assert.equal(classifyMatplotlibType({ topic: "Matematik grafiklar" }), "mathematical_graph");
  assert.equal(classifyMatplotlibType({ topic: "Tajriba natijalari diagrammasi" }), "experiment_results");
  assert.equal(classifyMatplotlibType({ topic: "Matematik tahlildagi tajriba natijalari" }), "experiment_results");
  assert.equal(classifyMatplotlibType({ topic: "Suv ta'minoti tizimi" }), null, "ma'nosiz ravishda matematik yoki tajriba grafigi belgilanmasin");
});

test("algoritm flowchart standart belgilar va Ha/Yo‘q shoxlarini talab qiladi", () => {
  const normalized = normalizeFlowchartData(algorithm);
  assert.equal(normalized.diagram_type, "algorithm_flowchart");
  const dot = buildFlowchartDot(algorithm);
  assert.match(dot, /rankdir=TB/);
  assert.match(dot, /shape=diamond/);
  assert.match(dot, /shape=ellipse/);
  assert.match(dot, /Times New Roman/);
  assert.throws(() => normalizeFlowchartData({ ...algorithm, edges: algorithm.edges.map(edge => edge.from === "check" && edge.label === "Yo'q" ? { ...edge, label: "Balki" } : edge) }), /Ha va Yo'q/);
  assert.throws(() => normalizeFlowchartData({ ...algorithm, nodes: algorithm.nodes.map(node => node.kind === "start" ? { ...node, kind: "process" } : node) }), /bittadan start va end/);
  assert.throws(() => normalizeFlowchartData({ ...algorithm, edges: [...algorithm.edges, { from: "end", to: "start" }] }), /startga kiruvchi qirra bo'lmasin/);
  assert.throws(() => normalizeFlowchartData({ ...algorithm, edges: [
    { from: "start", to: "measure" }, { from: "measure", to: "check" },
    { from: "check", to: "measure", label: "Ha" }, { from: "check", to: "end", label: "Yo'q" },
    { from: "treat", to: "end" },
  ] }), /barcha tugunlar startdan yetib boriladigan/);
  const repeatLoop = {
    diagram_type: "algorithm_flowchart", title: "O‘lchovni takrorlash algoritmi",
    nodes: [{ id: "start", label: "Boshlash", kind: "start" }, { id: "measure", label: "Suvni o‘lchash", kind: "process" }, { id: "check", label: "Mezon mosmi", kind: "decision" }, { id: "end", label: "Yakunlash", kind: "end" }],
    edges: [{ from: "start", to: "measure" }, { from: "measure", to: "check" }, { from: "check", to: "measure", label: "Ha" }, { from: "check", to: "end", label: "Yo‘q" }],
  };
  assert.doesNotThrow(() => normalizeFlowchartData(repeatLoop), "to‘g‘ri shartli qaytish sikli algoritmda ruxsat etiladi");
  graphvizLabelsAndRoutesAreClear(graphvizLayout(repeatLoop));
});

test("PID Graphviz modeli besh blok va haqiqiy sensor teskari aloqasini talab qiladi", () => {
  const normalized = normalizeFlowchartData(pid);
  assert.equal(normalized.nodes.length, 5);
  const dot = buildFlowchartDot(pid);
  assert.match(dot, /rankdir=LR/);
  assert.match(dot, /constraint=false/);
  assert.match(dot, /Times New Roman/);
  assert.throws(() => normalizeFlowchartData({ ...pid, edges: pid.edges.map(edge => edge.from === "sensor" ? { ...edge, to: "pid" } : edge) }), /PID signal path/);
  assert.throws(() => normalizeFlowchartData({ ...pid, nodes: pid.nodes.map(node => node.kind === "sum" ? { ...node, label: "Xatolik yig'indisi" } : node) }), /doirasiga sig'adigan ixcham/);
  assert.throws(() => normalizeFlowchartData({ ...pid, nodes: pid.nodes.slice(0, 4) }), /aynan 5 ta node/);
});

test("jarayon ketma-ketligi oldinga, UML esa arxitektura elementlari bilan quriladi", () => {
  const sequence = {
    diagram_type: "process_sequence", title: "Jarayon bosqichlari",
    nodes: [{ id: "a", label: "Namuna olish", kind: "step" }, { id: "b", label: "Sifatni o'lchash", kind: "step" }, { id: "c", label: "Natijani qayd qilish", kind: "output" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  };
  assert.match(buildFlowchartDot(sequence), /rankdir=LR/);
  assert.throws(() => normalizeFlowchartData({ ...sequence, edges: [{ from: "b", to: "a" }, { from: "b", to: "c" }] }), /chapdan o'ngga/);
  assert.throws(() => normalizeFlowchartData({ ...sequence, edges: [...sequence.edges, { from: "a", to: "c" }] }), /faqat bevosita keyingi tugunga/);
  assert.throws(() => normalizeFlowchartData({ ...sequence, edges: [{ from: "a", to: "b" }] }), /faqat bevosita keyingi tugunga/);
  const uml = {
    diagram_type: "uml_software_architecture", title: "Dastur komponentlari",
    nodes: [{ id: "api", label: "API komponenti", kind: "component" }, { id: "service", label: "Domen klassi", kind: "class" }, { id: "db", label: "Ma'lumotlar ombori", kind: "database" }],
    edges: [{ from: "api", to: "service", label: "calls" }, { from: "service", to: "db", label: "reads" }],
  };
  assert.match(buildFlowchartDot(uml), /shape=component/);
  assert.match(buildFlowchartDot(uml), /rankdir=TB/);
  const umlWithActor = {
    ...uml,
    nodes: [{ id: "api", label: "API komponenti", kind: "component" }, { id: "actor", label: "Operator", kind: "actor" }, { id: "service", label: "Domen klassi", kind: "class" }, { id: "db", label: "Ma'lumotlar ombori", kind: "database" }],
    edges: [{ from: "api", to: "actor", label: "uses" }, { from: "api", to: "service", label: "calls" }, { from: "service", to: "db", label: "reads" }],
  };
  const actorDot = buildFlowchartDot(umlWithActor);
  assert.ok(actorDot.includes('label="«actor»\\nOperator", shape=box'), "UML actor stereotype and classifier rectangle distinguish it from a use-case ellipse");
  graphvizLabelsAndRoutesAreClear(graphvizLayout(umlWithActor));
  assert.throws(() => normalizeFlowchartData({ ...uml, nodes: uml.nodes.map(node => ({ ...node, kind: "process" })) }), /mos bo'lmagan node turi/);
});

test("uzluksiz jarayon zanjiri sarlavhasiz bo‘lib, o‘qlari tugunlar orasida va kesishuvsiz qoladi", () => {
  const sequence = {
    diagram_type: "process_sequence", title: "Inqirozni erta aniqlash va javob choralarini tanlash",
    nodes: [
      { id: "indicators", label: "Indikatorlar", kind: "step" },
      { id: "risk", label: "Risk baholash", kind: "step" },
      { id: "policy", label: "Siyosat tanlash", kind: "step" },
      { id: "action", label: "Boshqaruv chorasi", kind: "step" },
      { id: "monitoring", label: "Monitoring", kind: "step" },
    ],
    edges: [
      { from: "indicators", to: "risk" }, { from: "risk", to: "policy" },
      { from: "policy", to: "action" }, { from: "action", to: "monitoring" },
    ],
  };
  const rendered = spawnSync("dot", ["-Tjson"], { input: buildFlowchartDot(sequence), maxBuffer: 4 * 1024 * 1024 });
  assert.equal(rendered.status, 0, rendered.stderr?.toString("utf8"));
  const layout = JSON.parse(rendered.stdout.toString("utf8"));
  assert.equal(layout.label, undefined, "diagramma sarlavhasi alohida rasmda chiqmasin");
  const byId = new Map(layout.objects.map(node => [node.name, node]));
  const ordered = sequence.nodes.map(node => byId.get(node.id));
  const x = node => Number(node.pos.split(",")[0]);
  assert.ok(ordered.every((node, index) => index === 0 || x(ordered[index - 1]) < x(node)), "tugunlar chapdan o‘ngga qat’iy tartibda qoladi");
  assert.equal(layout.edges.length, sequence.nodes.length - 1, "faqat qo‘shni bosqichlarni ulaydigan qirralar bo‘lsin");

  const nodesByGvid = new Map(layout.objects.map(node => [node._gvid, node]));
  const routes = layout.edges.map(edge => {
    const points = edge.pos.trim().split(/\s+/).map(point => point.replace(/^[se],/, "").split(",").map(Number));
    assert.ok(points.length >= 2 && points.every(point => point.length === 2 && point.every(Number.isFinite)), "har bir Graphviz qirrasi koordinatalarga ega");
    const source = nodesByGvid.get(edge.tail);
    const target = nodesByGvid.get(edge.head);
    const sourceRight = x(source) + Number(source.width) * 36;
    const targetLeft = x(target) - Number(target.width) * 36;
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    assert.ok(Math.min(...xs) >= sourceRight - 1 && Math.max(...xs) <= targetLeft + 1, "o‘q source/target label qutilaridan tashqaridagi bo‘sh yo‘lakda qoladi");
    assert.ok(Math.max(...ys) - Math.min(...ys) < 0.1, "ketma-ketlik o‘qlari bir xil qatorda, diagonal va kesishuvsiz qoladi");
    return [Math.min(...xs), Math.max(...xs)];
  });
  for (let index = 1; index < routes.length; index++) {
    assert.ok(routes[index - 1][1] <= routes[index][0] + 1, "qo‘shni o‘qlar oralig‘i tartib bo‘yicha ajralgan, o‘zaro kesishmaydi");
  }
});

test("IPO va sabab–oqibat Graphviz sxemalari besh tugun ichida semantik joylashadi", () => {
  const ipo = {
    diagram_type: "functional_block_diagram", title: "Kirish–jarayon–chiqish modeli",
    nodes: [{ id: "input", label: "Ma'lumot va resurs", kind: "input" }, { id: "process", label: "Qayta ishlash", kind: "process" }, { id: "output", label: "Natija", kind: "output" }],
    edges: [{ from: "input", to: "process" }, { from: "process", to: "output" }],
  };
  const ipoDot = buildFlowchartDot(ipo);
  assert.match(ipoDot, /input -> process/);
  assert.match(ipoDot, /process -> output/);
  assert.match(ipoDot, /shape=parallelogram/);
  assert.throws(() => buildFlowchartDot({ ...ipo, diagram_type: "random_picture" }), /noma'lum diagram_type/);

  const causeEffect = {
    diagram_type: "functional_block_diagram", title: "Sabab–oqibat tahlili",
    nodes: [
      { id: "method", label: "Usul", kind: "input" },
      { id: "people", label: "Inson omili", kind: "input" },
      { id: "tools", label: "Vositalar", kind: "input" },
      { id: "data", label: "Ma'lumotlar", kind: "input" },
      { id: "effect", label: "Asosiy muammo", kind: "output" },
    ],
    edges: [{ from: "method", to: "effect" }, { from: "people", to: "effect" }, { from: "tools", to: "effect" }, { from: "data", to: "effect" }],
  };
  const causeDot = buildFlowchartDot(causeEffect);
  assert.equal(causeEffect.nodes.length, 5);
  assert.match(causeDot, /method -> effect/);
  assert.match(causeDot, /data -> effect/);
  assert.doesNotMatch(causeDot, /style=invis/, "sabablar sun'iy ketma-ket ulanmasin");
  const rendered = spawnSync("dot", ["-Tpng"], { input: causeDot, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(rendered.status, 0, rendered.stderr?.toString("utf8"));
  assert.equal(rendered.stdout.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("algoritm, PID, sabab–oqibat va UML layoutlari yozuvlarni bosmay, mazmuniy qatorlarni saqlaydi", () => {
  const causeEffect = {
    diagram_type: "functional_block_diagram", title: "Suv sifatiga ta’sir qiluvchi omillar",
    nodes: [
      { id: "method", label: "Filtrlash usuli", kind: "input" },
      { id: "source", label: "Xom suv manbai", kind: "input" },
      { id: "load", label: "Ishlab chiqarish yuki", kind: "input" },
      { id: "sampling", label: "Namuna olish", kind: "input" },
      { id: "quality", label: "Suv sifati", kind: "output" },
    ],
    edges: [
      { from: "method", to: "quality" }, { from: "source", to: "quality" },
      { from: "load", to: "quality" }, { from: "sampling", to: "quality" },
    ],
  };
  const uml = {
    diagram_type: "uml_software_architecture", title: "Suv nazorati dastur modullari",
    nodes: [
      { id: "root", label: "Nazorat komponenti", kind: "component" },
      { id: "service", label: "Sifat xizmati", kind: "class" },
      { id: "interface", label: "Sensor interfeysi", kind: "interface" },
      { id: "database", label: "O‘lchovlar ombori", kind: "database" },
    ],
    edges: [
      { from: "root", to: "service", label: "calls" },
      { from: "root", to: "interface", label: "reads" },
      { from: "service", to: "database", label: "writes" },
    ],
  };
  const cases = [
    ["algorithm", algorithm], ["pid", pid], ["cause-effect", causeEffect], ["uml", uml],
  ];
  const layouts = new Map();
  for (const [name, flowchart] of cases) {
    const layout = graphvizLayout(flowchart);
    graphvizLabelsAndRoutesAreClear(layout);
    layouts.set(name, layout);
  }

  const nodes = layout => new Map(layout.objects.filter(object => object.pos).map(object => [object.name, object]));
  const algorithmNodes = nodes(layouts.get("algorithm"));
  assert.ok(Math.abs(Number(algorithmNodes.get("treat").pos.split(",")[1]) - Number(algorithmNodes.get("end").pos.split(",")[1])) < 0.1,
    "Ha/Yo‘q qaror shoxlari bir xil qatorda joylashadi");
  const pidLayout = layouts.get("pid");
  const pidNodes = nodes(pidLayout);
  const pidRows = [...pidNodes.values()].map(node => Number(node.pos.split(",")[1]));
  assert.ok(Math.max(...pidRows) - Math.min(...pidRows) < 0.1, "PID oldinga signal yo‘li bitta gorizontal qatorda qoladi");
  const feedback = pidLayout.edges.find(edge => edge.label === "Teskari aloqa");
  const feedbackSamples = graphvizSplineSamples(feedback);
  const sensor = pidNodes.get("sensor");
  const sensorY = Number(sensor.pos.split(",")[1]);
  assert.ok(Math.max(...feedbackSamples.map(point => point.y)) <= sensorY - Number(sensor.height) * 36 + 1,
    "PID teskari aloqa barcha bloklar ostidan alohida qaytadi");

  const causeNodes = nodes(layouts.get("cause-effect"));
  const causeX = causeEffect.nodes.slice(0, -1).map(node => Number(causeNodes.get(node.id).pos.split(",")[0]));
  assert.ok(Math.max(...causeX) - Math.min(...causeX) < 0.1, "sabablar bitta tartibli ustunda turadi");
  assert.ok(Number(causeNodes.get("quality").pos.split(",")[0]) > Math.max(...causeX), "yagona natija sabablar ustunining yonida joylashadi");

  const umlNodes = nodes(layouts.get("uml"));
  const rootY = Number(umlNodes.get("root").pos.split(",")[1]);
  const siblingRows = ["service", "interface"].map(id => Number(umlNodes.get(id).pos.split(",")[1]));
  assert.ok(Math.abs(siblingRows[0] - siblingRows[1]) < 0.1 && rootY > Math.max(...siblingRows),
    "UML ildiz yuqorida, bevosita quyi modullar bitta qatorda turadi");

  assert.throws(() => normalizeFlowchartData({ ...pid, edges: [...pid.edges, { from: "ref", to: "plant" }] }), /PID signal path/);
  assert.throws(() => normalizeFlowchartData({ ...uml, edges: [...uml.edges, { from: "root", to: "database" }] }), /daraxt bo'lsin/);
  assert.throws(() => normalizeFlowchartData({ ...causeEffect, edges: [...causeEffect.edges, { from: "method", to: "source" }] }), /faqat input→process→output zanjiri/);
});

test("Matplotlib chart schemalari matematik ifoda va beshtagacha tajriba seriyasini tekshiradi", () => {
  assert.equal(safeMathExpression("sin(x) + x**2 / pi"), true);
  assert.equal(safeMathExpression("__import__('os').system('id')"), false);
  assert.equal(safeMathExpression("np.sin(x)"), false);
  const math = normalizeChartData({
    diagram_type: "mathematical_graph", title: "Parabola va sinusoid",
    functions: [{ name: "f(x)", expression: "x**2" }, { name: "g(x)", expression: "sin(x)" }],
    x_min: -5, x_max: 5, x_label: "x", y_label: "f(x)",
  });
  assert.equal(math.chartType, "line");
  assert.equal(math.functions.length, 2);
  assert.throws(() => normalizeChartData({ ...math, functions: Array.from({ length: 6 }, (_, index) => ({ name: `f${index}`, expression: "x" })) }), /1–5 ta funksiya/);
  assert.throws(() => normalizeChartData({ ...math, functions: [{ expression: "__import__('os')" }] }), /xavfsiz matematik ifoda/);

  const experimental = normalizeChartData({
    diagram_type: "experiment_results", chartType: "bar", title: "Harorat bo‘yicha sinov",
    labels: ["10 °C", "20 °C", "30 °C"], unit: "mg/L",
    series: [{ name: "Nazorat", values: [5.1, 4.6, 4.2] }, { name: "Sinov", values: [4.7, 3.9, 3.1] }],
  });
  assert.equal(experimental.series.length, 2);
  assert.throws(() => normalizeChartData({ ...experimental, series: Array.from({ length: 6 }, () => ({ name: "x", values: [1, 2, 3] })) }), /1–5 ta series/);
  assert.throws(() => normalizeChartData({ ...experimental, series: [{ name: "bad", values: [1, 2] }] }), /labels bilan teng uzunlik/);
  assert.throws(() => normalizeChartData({ ...experimental, diagram_type: "random_picture" }), /noma'lum diagram_type/);
});

test("Matplotlib matematik va eksperimental PNG’larni chizadi", async () => {
  const matplotlibCheck = spawnSync("python3", ["-c", "import matplotlib, numpy; print(matplotlib.__version__)"]);
  assert.equal(matplotlibCheck.status, 0, matplotlibCheck.stderr.toString("utf8"));
  const cases = [
    {
      diagram_type: "mathematical_graph", title: "f(x) = x² va sin(x)",
      functions: [{ name: "x squared", expression: "x**2" }, { name: "sin(x)", expression: "sin(x)" }],
      x_min: -4, x_max: 4, x_label: "x qiymati", y_label: "f(x)",
    },
    {
      diagram_type: "experiment_results", chartType: "line", title: "Tajriba natijalari", labels: ["1-kun", "2-kun", "3-kun"],
      series: [{ name: "Nazorat", values: [3.1, 3.4, 3.2] }, { name: "Sinov", values: [2.9, 2.4, 1.8] }], unit: "mg/L", x_label: "Vaqt", y_label: "Konsentratsiya (mg/L)",
    },
  ];
  for (const chart of cases) {
    const image = await renderChart(chart);
    const metadata = await sharp(image.buf).metadata();
    assert.equal(metadata.format, "png");
    assert.ok(metadata.width >= 800 && metadata.height >= 400);
    assert.ok(image.width > 0 && image.height > 0);
    assert.ok(Math.abs(image.width / image.height - metadata.width / metadata.height) < 0.01);
  }
  const titleProbe = spawnSync("python3", ["-c", `
import importlib.util, json, sys
import matplotlib.pyplot as plt
spec = importlib.util.spec_from_file_location("matplotlib_renderer", sys.argv[1])
renderer = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(renderer)
for data in json.load(sys.stdin):
    figure, axes = renderer.build_figure(data)
    assert axes.get_title() == "", "diagram title belongs in the DOCX caption, not inside the image"
    plt.close(figure)
`, require("node:path").resolve(__dirname, "../src/mustaqil/matplotlib-renderer.py")], { input: JSON.stringify(cases) });
  assert.equal(titleProbe.status, 0, titleProbe.stderr.toString("utf8"));
});
