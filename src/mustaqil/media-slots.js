const MEDIA_TYPES = new Set(["formula", "chart", "flowchart", "table"]);
const { selectFlowchartTemplates } = require("./flowchart-templates");
const { classifyMatplotlibType } = require("./diagram-types");

function countFor(chapter, type, plans) {
  const field = `${type}_count`;
  return Math.max(0, Math.floor(Number(chapter?.[field]) || 0), plans.length);
}

function buildMediaSlots(chapters = [], { random = Math.random, topic = "" } = {}) {
  const slots = [];
  (Array.isArray(chapters) ? chapters : []).forEach((chapter, chapterIndex) => {
    const chapterId = String(chapter?.id || `chapter-${chapterIndex + 1}`);
    const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
    const definitions = [
      ["formula", Array.isArray(chapter?.formula_plans)
        ? chapter.formula_plans
        : (Array.isArray(chapter?.formula_latex) ? chapter.formula_latex : [])],
      ["chart", Array.isArray(chapter?.chart_plans) ? chapter.chart_plans : []],
      ["flowchart", Array.isArray(chapter?.flowchart_plans) ? chapter.flowchart_plans : []],
      ["table", Array.isArray(chapter?.table_plans) ? chapter.table_plans : []],
    ];
    let sectionCursor = 0;
    for (const [type, plans] of definitions) {
      const count = type === "table"
        ? Math.max(0, Math.floor(Number(chapter?.table_count) || 0), plans.length)
        : countFor(chapter, type, plans);
      for (let index = 0; index < count; index++) {
        const slot = {
          slot_id: `${chapterId}:${type}:${index + 1}`,
          type,
          chapterId,
          chapterIndex,
          ordinal: index + 1,
          sectionIndex: sections.length ? sectionCursor % sections.length : 0,
          plan: plans[index] ?? (type === "formula" && Array.isArray(chapter?.formula_latex)
            ? chapter.formula_latex[index]
            : null),
          chartType: type === "chart" ? String(chapter?.chart_type || plans[index]?.chartType || "bar").toLowerCase() : undefined,
        };
        slots.push(slot);
        sectionCursor++;
      }
    }
  });
  const flowchartSlots = slots.filter(slot => slot.type === "flowchart");
  const contexts = flowchartSlots.map(slot => {
    const chapter = chapters[slot.chapterIndex] || {};
    const section = Array.isArray(chapter.sections) ? chapter.sections[slot.sectionIndex] : null;
    const plan = slot.plan && typeof slot.plan === "object" && !Array.isArray(slot.plan) ? slot.plan : {};
    return {
      topic,
      chapterTitle: chapter.title,
      sectionTitle: section?.title,
      planTitle: plan.title,
      purpose: plan.purpose,
      caption: plan.caption,
      diagram_type: plan.diagram_type,
    };
  });
  const templates = selectFlowchartTemplates(contexts, random);
  flowchartSlots.forEach((slot, index) => {
    const template = templates[index];
    const plan = slot.plan && typeof slot.plan === "object" && !Array.isArray(slot.plan) ? slot.plan : {};
    slot.template_id = template.id;
    slot.template_name = template.name;
    slot.template_description = template.description;
    slot.diagram_type = template.diagramType;
    slot.plan = {
      ...plan,
      diagram_type: template.diagramType,
      template_id: template.id,
      template_name: template.name,
      template_description: template.description,
      template_guidance: template.topologyGuidance,
    };
  });
  for (const slot of slots.filter(item => item.type === "chart")) {
    const chapter = chapters[slot.chapterIndex] || {};
    const section = Array.isArray(chapter.sections) ? chapter.sections[slot.sectionIndex] : null;
    const plan = slot.plan && typeof slot.plan === "object" && !Array.isArray(slot.plan) ? slot.plan : {};
    slot.diagram_type = classifyMatplotlibType({
      topic,
      chapterTitle: chapter.title,
      sectionTitle: section?.title,
      planTitle: plan.title,
      purpose: plan.purpose,
      variable: plan.variable,
      caption: plan.caption,
      diagram_type: plan.diagram_type,
    });
    if (slot.diagram_type === "mathematical_graph") slot.chartType = "line";
    if (slot.diagram_type === "experiment_results" && !["bar", "line"].includes(slot.chartType)) {
      slot.chartType = /trend|vaqt|time|dinamik/i.test(`${plan.title || ""} ${plan.variable || ""}`) ? "line" : "bar";
    }
  }
  return slots;
}

function groupMediaSlotsByChapter(slots = []) {
  const grouped = new Map();
  for (const slot of slots) {
    if (!grouped.has(slot.chapterId)) grouped.set(slot.chapterId, []);
    grouped.get(slot.chapterId).push(slot);
  }
  return grouped;
}

function mergeMediaSlotsIntoContent(chapter, content, slots, mediaBySlotId, mainNumber = 0) {
  const validSlots = Array.isArray(slots) ? slots : [];
  const slotById = new Map(validSlots.map(slot => [slot.slot_id, slot]));
  const emitted = new Set();
  let merged = [];

  for (const item of (Array.isArray(content) ? content : [])) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "media_slot") {
      const slot = slotById.get(item.slot_id);
      if (!slot || emitted.has(slot.slot_id)) continue;
      const media = mediaBySlotId.get(slot.slot_id);
      if (!media) throw new Error(`Media slot ${slot.slot_id} uchun natija topilmadi`);
      merged.push(media);
      emitted.add(slot.slot_id);
      continue;
    }
    // Prose-only javob tasodifan media payload qaytarsa, u alohida media so‘rovini almashtirmaydi.
    if (MEDIA_TYPES.has(item.type)) continue;
    merged.push(item);
  }

  const insertionOffsets = new Map();
  for (const slot of validSlots) {
    if (emitted.has(slot.slot_id)) continue;
    const media = mediaBySlotId.get(slot.slot_id);
    if (!media) throw new Error(`Media slot ${slot.slot_id} uchun natija topilmadi`);
    const sectionHeadings = merged
      .map((item, index) => item?.type === "heading" && item.level === 2 ? index : -1)
      .filter(index => index >= 0);
    const headingIndex = sectionHeadings[Math.min(slot.sectionIndex || 0, Math.max(0, sectionHeadings.length - 1))];
    let anchor = -1;
    if (headingIndex != null && headingIndex >= 0) {
      const nextHeading = sectionHeadings.find(index => index > headingIndex) ?? merged.length;
      for (let index = headingIndex + 1; index < nextHeading; index++) {
        if (merged[index]?.type === "paragraph") { anchor = index; break; }
      }
      if (anchor < 0) anchor = headingIndex;
    } else {
      anchor = merged.findIndex(item => item?.type === "paragraph");
      if (anchor < 0) anchor = merged.length - 1;
    }
    const offsetKey = String(slot.sectionIndex || 0);
    const previousOffset = insertionOffsets.get(offsetKey) || 0;
    const insertionIndex = Math.max(0, Math.min(merged.length, anchor + 1 + previousOffset));
    merged.splice(insertionIndex, 0, media);
    insertionOffsets.set(offsetKey, previousOffset + 1);
    emitted.add(slot.slot_id);
  }

  // The stable slot ID remains on each media object for later cache association and diagnostics.
  merged = merged.map(item => item && MEDIA_TYPES.has(item.type) && !item.slot_id
    ? { ...item, slot_id: validSlots.find(slot => slot.type === item.type && !emitted.has(slot.slot_id))?.slot_id }
    : item);
  return merged;
}

module.exports = { MEDIA_TYPES, buildMediaSlots, groupMediaSlotsByChapter, mergeMediaSlotsIntoContent };
