IINATAN.safeExternalUrl = function (value) {
  var url = String(value || "").trim();
  return /^https:\/\/[^\s<>"']+$/i.test(url) ||
    /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(
      url,
    )
    ? url
    : "";
};

IINATAN.parseStructuredGlossary = function (raw, dictionary) {
  var value = raw;
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try {
      value = JSON.parse(value);
    } catch (_) {
      return [{ type: "paragraph", text: value }];
    }
  }
  var output = [];
  function visit(node, depth) {
    if (depth > 24 || node === null || node === undefined) return;
    if (typeof node === "string" || typeof node === "number") {
      output.push({ type: "paragraph", text: String(node) });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(function (item) {
        visit(item, depth + 1);
      });
      return;
    }
    if (typeof node !== "object") return;
    var tag = String(node.tag || node.type || "").toLowerCase();
    var content =
      node.content !== undefined
        ? node.content
        : node.children !== undefined
          ? node.children
          : node.text;
    if (tag === "a" || node.href) {
      var href = IINATAN.safeExternalUrl(
        (node.attributes || {}).href || node.href,
      );
      output.push({
        type: "link",
        text: IINATAN.structuredPlain(content),
        href: href,
      });
      return;
    }
    if (tag === "table") {
      output.push({ type: "table", rows: IINATAN.structuredTable(node) });
      return;
    }
    if (tag === "ul" || tag === "ol" || tag === "list") {
      output.push({
        type: "list",
        items: (Array.isArray(content) ? content : [content]).map(
          IINATAN.structuredPlain,
        ),
      });
      return;
    }
    if (tag === "details" || tag === "etymology" || tag === "grammar") {
      output.push({
        type: "section",
        title:
          tag === "details"
            ? String(node.title || "Details")
            : tag.charAt(0).toUpperCase() + tag.substring(1),
        content: [
          { type: "paragraph", text: IINATAN.structuredPlain(content) },
        ],
        collapsed: true,
      });
      return;
    }
    visit(content, depth + 1);
  }
  visit(value, 0);
  if (!output.length)
    output.push({ type: "paragraph", text: String(raw || "") });
  if (/^(wty-en-de|wty-de-en)$/i.test(dictionary || ""))
    output.forEach(function (node) {
      if (node.text)
        node.text = node.text.replace(/^\s*\([^)]*non-lemma[^)]*\)\s*/i, "");
    });
  return output;
};
IINATAN.structuredPlain = function (value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value))
    return value.map(IINATAN.structuredPlain).filter(Boolean).join(" ");
  return IINATAN.structuredPlain(
    value.content !== undefined
      ? value.content
      : value.children !== undefined
        ? value.children
        : value.text,
  );
};
IINATAN.structuredTable = function (node) {
  var rows = [];
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    var tag = String(value.tag || "").toLowerCase();
    if (tag === "tr")
      rows.push(
        (Array.isArray(value.content) ? value.content : [value.content]).map(
          IINATAN.structuredPlain,
        ),
      );
    else visit(value.content || value.children);
  }
  visit(node.content || node.children);
  return rows;
};

class DictionaryDocument {
  constructor(result, context) {
    this.lookupString = result.lookupString || "";
    this.matched = "";
    this.entries = [];
    this.context = context || {};
    this.fromResult(result);
  }
  fromResult(result) {
    var self = this;
    (result.results || []).forEach(function (item, index) {
      var term = item.term || {},
        entry = {
          id: "entry-" + index,
          headword: String(term.expression || item.matched || ""),
          reading: String(term.reading || ""),
          matched: String(item.matched || ""),
          rules: String(term.rules || ""),
          tags: [],
          frequencies: term.frequencies || [],
          pitches: term.pitches || [],
          glossaries: [],
          audio: [],
          sources: [],
        };
      if (!self.matched && entry.matched) self.matched = entry.matched;
      (term.glossaries || []).forEach(function (glossary, gi) {
        entry.glossaries.push({
          id: entry.id + ":g" + gi,
          dictionary: String(glossary.dict || ""),
          tags: String(glossary.definitionTags || "")
            .split(/\s+/)
            .filter(Boolean),
          content: IINATAN.parseStructuredGlossary(
            glossary.glossary,
            glossary.dict,
          ),
        });
      });
      self.entries.push(entry);
    });
  }
}
IINATAN.DictionaryDocument = DictionaryDocument;

IINATAN.documentWidget = function (document) {
  var root = new VStack("dictionary-document", 10);
  document.entries.forEach(function (entry, index) {
    var block = new VStack(entry.id, 5);
    block.add(
      new TextRun(
        entry.id + ":headword",
        entry.headword,
        IINATAN.scene.context().styles.headword,
      ),
    );
    if (entry.reading && entry.reading !== entry.headword)
      block.add(
        new TextRun(
          entry.id + ":reading",
          entry.reading,
          IINATAN.scene.context().styles.reading,
        ),
      );
    var chips = new HStack(entry.id + ":meta", 5);
    entry.frequencies.forEach(function (group, fi) {
      (group.frequencies || []).forEach(function (frequency, fj) {
        chips.add(
          new Chip(
            entry.id + ":freq:" + fi + ":" + fj,
            String(group.dict || "freq") +
              " " +
              String(frequency.displayValue || frequency.value || ""),
            null,
          ),
        );
      });
    });
    entry.pitches.forEach(function (pitch, pi) {
      chips.add(
        new Chip(
          entry.id + ":pitch:" + pi,
          String(pitch.dict || "pitch") +
            " " +
            (pitch.positions || []).join(","),
          null,
        ),
      );
    });
    if (chips.children.length) block.add(chips);
    entry.glossaries.forEach(function (glossary) {
      block.add(
        new TextRun(
          glossary.id + ":source",
          glossary.dictionary,
          IINATAN.scene.context().styles.tag,
        ),
      );
      glossary.content.forEach(function (node, ni) {
        var id = glossary.id + ":" + ni;
        if (node.type === "paragraph")
          block.add(
            new TextRun(id, node.text, IINATAN.scene.context().styles.body),
          );
        else if (node.type === "link")
          block.add(
            new Link(
              id,
              node.text,
              node.href,
              IINATAN.scene.context().styles.body,
            ),
          );
        else if (node.type === "list")
          node.items.forEach(function (text, li) {
            block.add(
              new TextRun(
                id + ":" + li,
                "• " + text,
                IINATAN.scene.context().styles.body,
              ),
            );
          });
        else if (node.type === "table") block.add(new Table(id, node.rows));
        else if (node.type === "section")
          block.add(
            new Expandable(
              id,
              node.title,
              new TextRun(
                id + ":body",
                IINATAN.structuredPlain(node.content),
                IINATAN.scene.context().styles.body,
              ),
              !node.collapsed,
            ),
          );
      });
    });
    var actions = new HStack(entry.id + ":actions", 6);
    actions.add(
      new Button(entry.id + ":audio", "▶ Audio", function () {
        IINATAN.previewEntryAudio(entry, document.context);
      }),
    );
    actions.add(
      new Button(entry.id + ":anki", "＋ Anki", function () {
        IINATAN.addEntryToAnki(entry, document);
      }),
    );
    block.add(actions);
    root.add(index ? new Callout(entry.id + ":surface", block) : block);
  });
  if (!document.entries.length)
    root.add(
      new TextRun(
        "no-results",
        "No dictionary results",
        IINATAN.scene.context().styles.body,
      ),
    );
  return root;
};
