"use strict";

function normalizeTemplates(value) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const templates = {};
  Object.entries(source)
    .slice(0, 64)
    .forEach(([name, template]) => {
      const field = String(name || "")
        .trim()
        .slice(0, 200);
      if (!field) return;
      templates[field] = String(template ?? "").slice(0, 20000);
    });
  return templates;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainNode(node, output = []) {
  if (node === null || node === undefined) return output;
  if (typeof node === "string" || typeof node === "number") {
    output.push(String(node));
    return output;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => plainNode(item, output));
    return output;
  }
  if (typeof node !== "object") return output;
  if (node.type === "text") {
    output.push(String(node.text || ""));
    return output;
  }
  if (node.type === "table" || node.type === "list") {
    (Array.isArray(node.rows) ? node.rows : []).forEach((row) => {
      output.push(Array.isArray(row) ? row.join(" · ") : String(row ?? ""));
      output.push("\n");
    });
    return output;
  }
  if (node.text) output.push(String(node.text));
  if (node.content) plainNode(node.content, output);
  return output;
}

function glossaryText(entry) {
  const glossaries = Array.isArray(entry?.glossaries) ? entry.glossaries : [];
  const sections = glossaries.map((glossary) => {
    const body = plainNode(glossary.content || [])
      .join("")
      .replace(/\n{3,}/g, "\n\n");
    return [glossary.dictionary, body].filter(Boolean).join("\n");
  });
  return sections.filter(Boolean).join("\n\n").trim();
}

function firstGlossaryText(entry) {
  const glossaries = Array.isArray(entry?.glossaries) ? entry.glossaries : [];
  return glossaries.length
    ? plainNode(glossaries[0].content || [])
        .join("")
        .trim()
    : "";
}

function uniqueLabels(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function frequencyRows(entry) {
  const rows = Array.isArray(entry?.frequencies) ? entry.frequencies : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const values = Array.isArray(row.frequencies) ? row.frequencies : [];
    return values.map((value) => ({
      dictionary: String(row.dictionary || row.dict || ""),
      value: Number.isFinite(Number(value?.value)) ? Number(value.value) : null,
      displayValue: String(value?.displayValue || value?.display || value?.value || ""),
    }));
  });
}

function frequencyHarmonicRank(entry) {
  const values = frequencyRows(entry)
    .map((row) => row.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return "";
  const denominator = values.reduce((sum, value) => sum + 1 / value, 0);
  return denominator ? String(Math.round(values.length / denominator)) : "";
}

function pitchPositions(entry) {
  const rows = Array.isArray(entry?.pitches)
    ? entry.pitches
    : Array.isArray(entry?.pitch)
      ? entry.pitch
      : [];
  return rows.flatMap((row) => {
    if (Array.isArray(row)) return row;
    if (Array.isArray(row?.positions)) return row.positions;
    if (Array.isArray(row?.pitchPositions)) return row.pitchPositions;
    return row?.position === undefined ? [] : [row.position];
  });
}

function pitchAccentPositions(entry) {
  return pitchPositions(entry)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(", ");
}

function pitchAccentCategories(entry) {
  return pitchPositions(entry)
    .map(Number)
    .filter(Number.isFinite)
    .map((position) =>
      position === 0 ? "heiban" : position === 1 ? "atamadaka" : "nakadaka",
    )
    .join(", ");
}

function phoneticTranscriptions(entry) {
  const direct = Array.isArray(entry?.phoneticTranscriptions)
    ? entry.phoneticTranscriptions
    : [];
  const fromPitch = (Array.isArray(entry?.pitches) ? entry.pitches : []).flatMap(
    (row) => (Array.isArray(row?.transcriptions) ? row.transcriptions : []),
  );
  return uniqueLabels([...direct, ...fromPitch]).join(", ");
}

function furiganaPlain(expression, reading) {
  return reading
    ? `${String(expression || "")} [${String(reading || "")}]`
    : String(expression || "");
}

function furiganaHtml(expression, reading) {
  return reading
    ? `<ruby>${escapeHtml(expression)}<rt>${escapeHtml(reading)}</rt></ruby>`
    : escapeHtml(expression);
}

function formatTimestamp(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return String(value || "");
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(remaining).padStart(2, "0")}`;
}

function clozeParts(sentence, selectedText) {
  const text = String(sentence || "");
  const selected = String(selectedText || "");
  const start = selected ? text.indexOf(selected) : -1;
  if (start < 0) return { prefix: "", body: selected, suffix: "" };
  return {
    prefix: text.slice(0, start),
    body: selected,
    suffix: text.slice(start + selected.length),
  };
}

function contextForEntry({
  entry,
  result,
  sentence,
  selectedText,
  documentTitle,
  sourcePath,
  timestamp,
}) {
  const value = entry && typeof entry === "object" ? entry : {};
  const tags = Array.isArray(value.tags) ? value.tags.map(String).join(", ") : "";
  const frequencies = Array.isArray(value.frequency)
    ? value.frequency.map(String).join(", ")
    : "";
  const expression = String(value.headword || "");
  const reading = String(value.reading || "");
  const glossaryPlain = glossaryText(value);
  const cloze = clozeParts(sentence, selectedText || expression);
  const glossaries = Array.isArray(value.glossaries) ? value.glossaries : [];
  const dictionaries = uniqueLabels(glossaries.map((item) => item?.dictionary)).join(
    ", ",
  );
  const partOfSpeech = uniqueLabels([
    value.partOfSpeech,
    ...glossaries.map((item) => item?.partOfSpeech),
  ]).join(", ");
  return {
    expression,
    word: expression,
    reading,
    "popup-selection-text": String(selectedText || expression),
    sentence: String(sentence || ""),
    "cloze-prefix": cloze.prefix,
    "cloze-body": cloze.body,
    "cloze-suffix": cloze.suffix,
    glossary: glossaryPlain,
    "glossary-plain": glossaryPlain,
    "glossary-first": firstGlossaryText(value),
    "selected-glossary": firstGlossaryText(value),
    glossaryItems: glossaries,
    dictionary: dictionaries,
    "part-of-speech": partOfSpeech,
    tags,
    frequencies,
    "frequency-harmonic-rank": frequencyHarmonicRank(value),
    "pitch-accent-positions": pitchAccentPositions(value),
    "pitch-accent-categories": pitchAccentCategories(value),
    "phonetic-transcriptions": phoneticTranscriptions(value),
    "document-title": String(documentTitle || ""),
    "source-path": String(sourcePath || ""),
    timestamp: formatTimestamp(timestamp),
    lookupString: String(result?.lookupString || ""),
  };
}

function markerValue(marker, context, media = {}) {
  const key = String(marker || "")
    .trim()
    .toLowerCase();
  if (key === "screenshot" || key === "image")
    return media.screenshot ? `<img src="${escapeHtml(media.screenshot)}">` : "";
  if (key === "sentence-audio" || key === "subtitle-audio")
    return media.sentenceAudio ? `[sound:${escapeHtml(media.sentenceAudio)}]` : "";
  if (key === "audio")
    return media.wordAudio || media.sentenceAudio
      ? `[sound:${escapeHtml(media.wordAudio || media.sentenceAudio)}]`
      : "";
  if (key === "furigana") return furiganaHtml(context.expression, context.reading);
  if (key === "furigana-plain")
    return escapeHtml(furiganaPlain(context.expression, context.reading));
  if (key === "selected-glossary")
    return escapeHtml(context["selected-glossary"] || context["glossary-first"] || "");
  if (key.startsWith("single-glossary-")) {
    const dictionary = key.slice("single-glossary-".length).replace(/[^a-z0-9]/g, "");
    const glossary = Array.isArray(context.glossaryItems)
      ? context.glossaryItems.find(
          (item) =>
            String(item.dictionary || "")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "") === dictionary,
        )
      : null;
    return escapeHtml(glossary ? firstGlossaryText({ glossaries: [glossary] }) : "");
  }
  const value = context[key] ?? "";
  return escapeHtml(value);
}

function renderTemplate(template, context, media) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, marker) =>
    markerValue(marker, context, media),
  );
}

function renderFields(templates, context, media) {
  return Object.fromEntries(
    Object.entries(normalizeTemplates(templates)).map(([field, template]) => [
      field,
      renderTemplate(template, context, media),
    ]),
  );
}

function tagsFromValue(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 64);
}

function buildAnkiNote(config = {}, contextInput = {}, media = {}) {
  const context = contextForEntry(contextInput);
  const fields = renderFields(config.fieldTemplatesJson, context, media);
  const fieldNames = Object.keys(fields);
  if (!String(config.deckName || "").trim())
    throw new Error("Anki deck is not configured");
  if (!String(config.modelName || "").trim())
    throw new Error("Anki model is not configured");
  if (!fieldNames.length) throw new Error("Anki field templates are not configured");
  return {
    deckName: String(config.deckName).trim().slice(0, 200),
    modelName: String(config.modelName).trim().slice(0, 200),
    fields,
    tags: tagsFromValue(config.tags),
    options: {
      allowDuplicate:
        config.duplicateCheck !== true || config.duplicateMode === "allow",
      duplicateScope: config.duplicateScope === "collection" ? "collection" : "deck",
    },
  };
}

module.exports = {
  buildAnkiNote,
  contextForEntry,
  escapeHtml,
  firstGlossaryText,
  clozeParts,
  formatTimestamp,
  frequencyHarmonicRank,
  furiganaHtml,
  furiganaPlain,
  glossaryText,
  normalizeTemplates,
  phoneticTranscriptions,
  pitchAccentCategories,
  pitchAccentPositions,
  renderFields,
  renderTemplate,
  tagsFromValue,
};
