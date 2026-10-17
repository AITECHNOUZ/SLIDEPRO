// Pure helpers for sectioning generated independent-work content.
// Kept separate from API, DOCX, and image dependencies so they can be unit-tested.
const { normalizeHeadingTitle } = require("./headings");

function countWords(content) {
  return (content || [])
    .filter(block => block && block.type === "paragraph")
    .reduce((sum, block) => sum + String(block.text || "").split(/\s+/).filter(Boolean).length, 0);
}

function countSectionWords(chapter) {
  const sections = [];
  let current = -1;
  for (const item of chapter?.content || []) {
    if (item?.type === "heading" && item.level === 2) {
      sections.push(0);
      current = sections.length - 1;
    } else if (current >= 0 && item?.type === "paragraph") {
      sections[current] += String(item.text || "").split(/\s+/).filter(Boolean).length;
    }
  }
  return sections;
}

function chapterMainNumber(chapters, chapterIndex) {
  return chapters.slice(0, chapterIndex + 1)
    .filter(chapter => chapter.id !== "intro" && chapter.id !== "conclusion").length;
}

function normalizeChapterContent(chapter, content, mainNumber) {
  const body = (Array.isArray(content) ? content : []).filter(item => item && item.type !== "heading");
  if (chapter.id === "intro" || chapter.id === "conclusion") return body;

  const sections = Array.isArray(chapter.sections) ? chapter.sections : [];
  if (!sections.length) return body;
  const grouped = sections.map(() => []);
  const totalWords = countWords(body);
  // Distribute against the chapter's actual word count so a short chapter remains
  // visibly short in every section rather than making an empty section look full.
  const sectionWordTarget = totalWords > 0 ? totalWords / sections.length : Number.POSITIVE_INFINITY;
  let sectionIndex = 0;
  let sectionWords = 0;

  for (const item of body) {
    if (sectionIndex < sections.length - 1 && sectionWords >= sectionWordTarget) {
      sectionIndex++;
      sectionWords = 0;
    }
    grouped[sectionIndex].push(item);
    sectionWords += countWords([item]);
  }

  return grouped.flatMap((items, index) => {
    const title = normalizeHeadingTitle(sections[index].title || `Bo'lim ${index + 1}`, { stripNumbering: true });
    return [
      { type: "heading", level: 2, text: `${mainNumber}.${index + 1}. ${title}` },
      ...items,
    ];
  });
}

function trimToWordLimit(text, limit) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const maxWords = Math.max(0, Math.floor(Number(limit) || 0));
  if (words.length <= maxWords) return String(text || "").trim();
  if (maxWords === 0) return "";

  const minCompleteSentence = Math.max(1, Math.floor(maxWords * 0.6));
  for (let end = maxWords; end >= minCompleteSentence; end--) {
    if (/[.!?…][”"»')\]]*$/.test(words[end - 1])) return words.slice(0, end).join(" ");
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;—-]+$/, "")}…`;
}

function mergeParagraphs(blocks, maxParagraphs = 3) {
  const merged = (blocks || []).map(block => ({ ...block }));
  const paragraphIndexes = () => merged.map((block, index) => block?.type === "paragraph" ? index : -1).filter(index => index >= 0);
  while (paragraphIndexes().length > maxParagraphs) {
    const indexes = paragraphIndexes();
    const previous = indexes[indexes.length - 2];
    const last = indexes[indexes.length - 1];
    merged[previous].text = `${String(merged[previous].text || "").trim()} ${String(merged[last].text || "").trim()}`.trim();
    merged.splice(last, 1);
  }
  return merged;
}

function capBlockGroup(blocks, wordLimit) {
  const capped = mergeParagraphs(blocks, 3);
  const paragraphIndexes = capped.map((block, index) => block?.type === "paragraph" ? index : -1).filter(index => index >= 0);
  const totalWords = paragraphIndexes.reduce((sum, index) => sum + countWords([capped[index]]), 0);
  if (totalWords <= wordLimit || paragraphIndexes.length === 0) return capped;

  const baseBudget = Math.floor(wordLimit / paragraphIndexes.length);
  let extraWords = wordLimit % paragraphIndexes.length;
  let paragraphNumber = 0;
  return capped.map(block => {
    if (block?.type !== "paragraph") return block;
    const budget = baseBudget + (extraWords-- > 0 ? 1 : 0);
    paragraphNumber++;
    return { ...block, text: trimToWordLimit(block.text, budget) };
  }).filter(block => block?.type !== "paragraph" || String(block.text || "").trim());
}

function clampChapterContent(chapter, content, mainNumber, maxWordRatio = 1) {
  const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
  const source = Array.isArray(content) ? content : [];
  const headings = source.filter(item => item?.type === "heading" && item.level === 2);
  const preserveSectionGroups = sections.length > 0 && headings.length === sections.length;
  const normalized = preserveSectionGroups
    ? source.map(item => {
      if (item?.type !== "heading" || item.level !== 2) return item;
      const sectionIndex = headings.indexOf(item);
      const title = normalizeHeadingTitle(sections[sectionIndex]?.title || `Bo'lim ${sectionIndex + 1}`, { stripNumbering: true });
      return { ...item, text: `${mainNumber}.${sectionIndex + 1}. ${title}` };
    })
    : normalizeChapterContent(chapter, source, mainNumber);
  const requestedRatio = Number(maxWordRatio);
  const wordRatio = Number.isFinite(requestedRatio) && requestedRatio >= 1 ? requestedRatio : 1;
  const boundedLimit = target => Math.floor((Number(target) || 0) * wordRatio + 1e-9);
  const chapterLimit = Number(chapter?.word_target) || 265;
  if (chapter?.id === "intro" || chapter?.id === "conclusion") return capBlockGroup(normalized, boundedLimit(chapterLimit));

  if (!sections.length) return capBlockGroup(normalized, boundedLimit(chapterLimit));
  const result = [];
  let group = [];
  let sectionIndex = -1;
  const flush = () => {
    if (!group.length) return;
    const heading = group[0];
    const limit = Number(sections[sectionIndex]?.word_target) || 398;
    result.push(heading, ...capBlockGroup(group.slice(1), boundedLimit(limit)));
    group = [];
  };

  for (const item of normalized) {
    if (item?.type === "heading" && item.level === 2) {
      flush();
      sectionIndex++;
      group = [item];
    } else if (group.length) {
      group.push(item);
    } else {
      result.push(item);
    }
  }
  flush();
  return result;
}

module.exports = { countWords, countSectionWords, chapterMainNumber, normalizeChapterContent, trimToWordLimit, clampChapterContent };
