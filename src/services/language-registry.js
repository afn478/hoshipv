"use strict";

const { createTextIndex } = require("../geometry/unicode-index");
const { LANGUAGES } = require("../settings/defaults");
const { candidatesFor, germanSplitVerbCandidates } = require("./deinflection");

const LATIN = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’ʼ＇‘‛-]/;
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/;
const CHINESE = /[\u3400-\u9fff\uf900-\ufaff]/;
const KOREAN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const KANA_ONLY = /^[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f\s]+$/;

function kanaFuriganaEnd(units, start) {
  if (units[start]?.text !== "（") return null;
  let end = start + 1;
  while (end < units.length && units[end].text !== "）") end++;
  if (end >= units.length) return null;
  const reading = units
    .slice(start + 1, end)
    .map((unit) => unit.text)
    .join("");
  return reading && KANA_ONLY.test(reading) ? end + 1 : null;
}

function characterRequest(text, unitIndex, scanLength, languageId) {
  const index = createTextIndex(text);
  const start = Math.max(0, Math.min(Number(unitIndex) || 0, index.units.length));
  const predicate =
    languageId === "zh"
      ? (unit) => CHINESE.test(unit.text)
      : (unit) => JAPANESE.test(unit.text);
  if (!predicate(index.units[start])) return null;
  const units = [];
  for (
    let position = start;
    position < index.units.length &&
    units.length < Math.max(1, Number(scanLength) || 24);
    position++
  ) {
    if (languageId === "ja") {
      const furiganaEnd = kanaFuriganaEnd(index.units, position);
      if (furiganaEnd !== null) {
        position = furiganaEnd - 1;
        continue;
      }
    }
    if (!predicate(index.units[position])) break;
    units.push(index.units[position]);
  }
  if (!units.length) return null;
  const lookupText = units.map((unit) => unit.text).join("");
  return {
    lookupText,
    mode: languageId === "zh" ? "prefix" : "yomitan-japanese",
    utf16Start: units[0].utf16Start,
    utf16End: units[units.length - 1].utf16End,
    units,
    candidates: [
      {
        text: lookupText,
        normalizedText: lookupText,
        source: "surface",
        reason: "rightward prefix",
        language: languageId,
      },
    ],
  };
}

function wordRequest(text, unitIndex, languageId) {
  const index = createTextIndex(text);
  const position = Math.max(
    0,
    Math.min(Number(unitIndex) || 0, index.units.length - 1),
  );
  const at = index.units[position];
  if (!at || (!LATIN.test(at.text) && !KOREAN.test(at.text))) return null;
  let start = position;
  let end = position + 1;
  const isWord = (unit) => LATIN.test(unit.text) || KOREAN.test(unit.text);
  while (start > 0 && isWord(index.units[start - 1])) start--;
  while (end < index.units.length && isWord(index.units[end])) end++;
  const units = index.units.slice(start, end);
  const lookupText = units.map((unit) => unit.text).join("");
  const displayText = lookupText;
  const range = {
    start: units[0].utf16Start,
    end: units[units.length - 1].utf16End,
  };
  const candidates = candidatesFor(languageId, lookupText, displayText, range);
  if (languageId === "de") {
    const splitCandidates = germanSplitVerbCandidates(
      text,
      units[0].index,
      units[units.length - 1].index + 1,
    );
    const seen = new Set(candidates.map((candidate) => candidate.text));
    splitCandidates.forEach((value) => {
      if (seen.has(value)) return;
      seen.add(value);
      candidates.push({
        text: value,
        normalizedText: value,
        source: "german-split-verb",
        reason: "bounded right-context separable prefix",
        language: languageId,
        displayText,
        range,
      });
    });
  }
  return {
    lookupText: candidates[0]?.text || lookupText,
    mode: "exact",
    utf16Start: units[0].utf16Start,
    utf16End: units[units.length - 1].utf16End,
    units,
    candidates,
  };
}

function requestFor(languageId, text, utf16Position, scanLength) {
  const language = LANGUAGES.find((item) => item.id === languageId) || LANGUAGES[0];
  const index = createTextIndex(text);
  const at = index.unitAtUtf16(utf16Position) || index.units[0];
  if (!at) return null;
  const unitIndex = at.index;
  if (language.id === "ja" || language.id === "zh")
    return characterRequest(text, unitIndex, scanLength, language.id);
  return wordRequest(text, unitIndex, language.id);
}

module.exports = { CHINESE, JAPANESE, KOREAN, LATIN, requestFor };
