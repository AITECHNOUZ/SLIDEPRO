function renumberMedia(chapters = []) {
  let formulaNumber = 0;
  let figureNumber = 0;
  let tableNumber = 0;

  for (const chapter of chapters) {
    for (const item of chapter?.content || []) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "formula") item.number = ++formulaNumber;
      else if (item.type === "chart" || item.type === "flowchart") item.number = ++figureNumber;
      else if (item.type === "table") item.number = ++tableNumber;
    }
  }
}

module.exports = { renumberMedia };
