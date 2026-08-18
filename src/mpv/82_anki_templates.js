IINATAN.ankiMarkers = function (context, media) {
  return {
    expression: IINATAN.ankiEscape(context.expression),
    reading: IINATAN.ankiEscape(context.reading),
    sentence: IINATAN.ankiEscape(context.sentence),
    "glossary-html": context.glossaryHtml,
    "glossary-plain": IINATAN.ankiEscape(context.glossaryPlain),
    "selected-glossary": IINATAN.ankiEscape(context.selectedGlossary),
    dictionary: IINATAN.ankiEscape(context.dictionary),
    tags: IINATAN.ankiEscape(context.tags),
    frequencies: IINATAN.ankiEscape(context.frequencies),
    pitches: IINATAN.ankiEscape(context.pitches),
    "document-title": IINATAN.ankiEscape(context.documentTitle),
    "source-path": IINATAN.ankiEscape(context.sourcePath),
    timestamp: IINATAN.ankiEscape(context.timestamp),
    screenshot: media.screenshot
      ? '<img src="' + IINATAN.ankiEscape(media.screenshot) + '">'
      : "",
    "sentence-audio": media.sentenceAudio
      ? "[sound:" + IINATAN.ankiEscape(media.sentenceAudio) + "]"
      : "",
    "word-audio": media.wordAudio
      ? "[sound:" + IINATAN.ankiEscape(media.wordAudio) + "]"
      : "",
  };
};
IINATAN.renderAnkiFields = function (templates, context, media) {
  var markers = IINATAN.ankiMarkers(context, media || {}),
    fields = {};
  Object.keys(templates || {}).forEach(function (field) {
    fields[field] = String(templates[field]).replace(
      /\{([^{}]+)\}/g,
      function (_, marker) {
        return Object.prototype.hasOwnProperty.call(markers, marker)
          ? markers[marker]
          : "";
      },
    );
  });
  return fields;
};
