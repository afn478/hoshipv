"use strict";

function utf8Length(text) {
  return Buffer.byteLength(text, "utf8");
}

function fallbackSegments(text) {
  const result = [];
  let index = 0;
  while (index < text.length) {
    const start = index;
    const first = text.codePointAt(index);
    index += first > 0xffff ? 2 : 1;
    while (index < text.length) {
      const codePoint = text.codePointAt(index);
      if (codePoint === 0x200d || (codePoint >= 0x300 && codePoint <= 0x36f)) {
        index += codePoint === 0x200d ? 1 : codePoint > 0xffff ? 2 : 1;
        if (codePoint === 0x200d && index < text.length) {
          const joined = text.codePointAt(index);
          index += joined > 0xffff ? 2 : 1;
        }
        continue;
      }
      break;
    }
    result.push([start, index]);
  }
  return result;
}

function segmentText(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (item) => [
      item.index,
      item.index + item.segment.length,
    ]);
  }
  return fallbackSegments(text);
}

function createTextIndex(input) {
  const text = String(input || "");
  const ranges = segmentText(text);
  let utf8Start = 0;
  const units = ranges.map(([utf16Start, utf16End], index) => {
    const value = text.slice(utf16Start, utf16End);
    const utf8End = utf8Start + utf8Length(value);
    const unit = Object.freeze({
      index,
      text: value,
      utf16Start,
      utf16End,
      utf8Start,
      utf8End,
    });
    utf8Start = utf8End;
    return unit;
  });
  const result = {
    text,
    utf16Length: text.length,
    utf8Length: utf8Start,
    units,
    unitAtUtf16(offset) {
      const value = Number(offset);
      return (
        units.find((unit) => value >= unit.utf16Start && value < unit.utf16End) || null
      );
    },
    unitAtUtf8(offset) {
      const value = Number(offset);
      return (
        units.find((unit) => value >= unit.utf8Start && value < unit.utf8End) || null
      );
    },
    range(start, end) {
      return units.filter((unit) => unit.utf16Start < end && unit.utf16End > start);
    },
  };
  return Object.freeze(result);
}

module.exports = {
  createTextIndex,
  fallbackSegments,
  segmentText,
  utf8Length,
};
