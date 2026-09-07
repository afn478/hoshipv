"use strict";

const { createTextIndex } = require("./unicode-index");

function stripAssTags(text) {
  return String(text || "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\h/g, " ");
}

function buildLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === "\n") starts.push(index + 1);
  return starts;
}

function buildPlainSubtitleGeometry(input) {
  if (!input || typeof input !== "object")
    throw new TypeError("subtitle geometry input is required");
  const text = stripAssTags(input.text);
  const index = createTextIndex(text);
  const osdWidth = Number(input.osdWidth);
  const osdHeight = Number(input.osdHeight);
  if (!(osdWidth > 0 && osdHeight > 0))
    throw new RangeError("osd dimensions are required");
  const fontSize = Math.max(1, Number(input.fontSize) || 48);
  const charWidth = Math.max(1, Number(input.charWidth) || fontSize * 0.55);
  const lineHeight = Math.max(fontSize, Number(input.lineHeight) || fontSize * 1.25);
  const lines = text.split("\n");
  const lineStarts = buildLineStarts(text);
  const marginX = Math.max(0, Number(input.marginX) || 0);
  const marginY = Math.max(0, Number(input.marginY) || 0);
  const position =
    input.position === "top"
      ? marginY
      : osdHeight - marginY - lines.length * lineHeight;
  const align =
    input.align === "left" ? "left" : input.align === "right" ? "right" : "center";
  const units = index.units.map((unit) => {
    if (unit.text === "\n" || /^\s+$/.test(unit.text))
      return {
        id: `${input.eventId || "event"}:unit:${unit.index}`,
        position: unit.index,
        text: unit.text,
        sourceText: text,
        utf16Range: [unit.utf16Start, unit.utf16End],
        utf8Range: [unit.utf8Start, unit.utf8End],
        rects: [{ x: 0.01, y: 0.01, width: 0.01, height: 0.01 }],
        lookupable: false,
      };
    const lineIndex = lineStarts.reduce(
      (last, start, indexValue) => (start <= unit.utf16Start ? indexValue : last),
      0,
    );
    const lineText = lines[lineIndex] || "";
    const lineWidth = lineText.length * charWidth;
    const startX =
      align === "left"
        ? marginX
        : align === "right"
          ? osdWidth - marginX - lineWidth
          : (osdWidth - lineWidth) / 2;
    const column = unit.utf16Start - lineStarts[lineIndex];
    return {
      id: `${input.eventId || "event"}:unit:${unit.index}`,
      position: unit.index,
      text: unit.text,
      sourceText: text,
      utf16Range: [unit.utf16Start, unit.utf16End],
      utf8Range: [unit.utf8Start, unit.utf8End],
      rects: [
        {
          x: startX + column * charWidth,
          y: position + lineIndex * lineHeight,
          width: charWidth,
          height: lineHeight,
        },
      ],
      lookupable: true,
    };
  });
  return {
    sourceText: text,
    units,
    exact: false,
    diagnostics: [
      "plain-subtitle approximation; ASS/native geometry is required for production lookup",
    ],
  };
}

module.exports = {
  buildPlainSubtitleGeometry,
  stripAssTags,
};
