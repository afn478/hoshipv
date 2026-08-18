IINATAN.ankiEscape = function (value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};
IINATAN.ankiGlossaryHtml = function (entry) {
  return (entry.glossaries || [])
    .map(function (glossary) {
      return (
        '<section class="iinatan-glossary"><header>' +
        IINATAN.ankiEscape(glossary.dictionary) +
        "</header>" +
        glossary.content
          .map(function (node) {
            if (node.type === "link")
              return (
                '<p><a href="' +
                IINATAN.ankiEscape(node.href) +
                '">' +
                IINATAN.ankiEscape(node.text) +
                "</a></p>"
              );
            if (node.type === "list")
              return (
                "<ul>" +
                node.items
                  .map(function (item) {
                    return "<li>" + IINATAN.ankiEscape(item) + "</li>";
                  })
                  .join("") +
                "</ul>"
              );
            if (node.type === "table")
              return (
                "<table>" +
                node.rows
                  .map(function (row) {
                    return (
                      "<tr>" +
                      row
                        .map(function (cell) {
                          return "<td>" + IINATAN.ankiEscape(cell) + "</td>";
                        })
                        .join("") +
                      "</tr>"
                    );
                  })
                  .join("") +
                "</table>"
              );
            return (
              "<p>" +
              IINATAN.ankiEscape(
                node.text || IINATAN.structuredPlain(node.content),
              ) +
              "</p>"
            );
          })
          .join("") +
        "</section>"
      );
    })
    .join("");
};
IINATAN.ankiCardContext = function (entry, document) {
  var media = document.context || IINATAN.captureCardMediaContext(),
    popup = IINATAN.popupStack[IINATAN.popupStack.length - 1] || {};
  return {
    expression: entry.headword,
    reading: entry.reading,
    sentence: media.sentence || "",
    glossaryHtml: IINATAN.ankiGlossaryHtml(entry),
    glossaryPlain: (entry.glossaries || [])
      .map(function (g) {
        return g.content
          .map(function (n) {
            return (
              n.text ||
              IINATAN.structuredPlain(n.content) ||
              (n.items || []).join("; ")
            );
          })
          .join(" ");
      })
      .join("\n"),
    selectedGlossary: popup.selectedText || "",
    dictionary: (entry.glossaries[0] || {}).dictionary || "",
    tags: entry.tags.join(" "),
    frequencies: JSON.stringify(entry.frequencies),
    pitches: JSON.stringify(entry.pitches),
    documentTitle: media.source.title || "",
    sourcePath: media.source.path || "",
    timestamp: String(media.timeFallback || 0),
    mediaContext: media,
    wordAudio: media.wordAudio || null,
  };
};
