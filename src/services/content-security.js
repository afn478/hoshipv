"use strict";

const { safeAudioUrl } = require("./audio-service");

const ALLOWED_EXTERNAL_PROTOCOL = /^https:\/\/[^\s<>"']+$/i;
const MAX_STRUCTURED_CONTENT_BYTES = 512 * 1024;
const STRUCTURED_TAGS = new Set([
  "a",
  "br",
  "details",
  "div",
  "img",
  "li",
  "ol",
  "p",
  "rp",
  "rt",
  "ruby",
  "span",
  "strong",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const STRUCTURED_STYLE_PROPERTIES = new Set([
  "background",
  "backgroundColor",
  "borderColor",
  "borderRadius",
  "borderStyle",
  "borderWidth",
  "color",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "margin",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginTop",
  "padding",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "textAlign",
  "textDecorationColor",
  "textDecorationLine",
  "textDecorationStyle",
  "textEmphasis",
  "textShadow",
  "verticalAlign",
  "whiteSpace",
  "wordBreak",
]);

function collapseMode(value, fallback) {
  const mode = String(value || "");
  return mode === "expanded" || mode === "collapsed" || mode === "inherit"
    ? mode
    : fallback;
}

function dictionaryPresentation(options) {
  const source = options && typeof options === "object" ? options : {};
  return {
    etymologyCollapseDefault: collapseMode(
      source.etymologyCollapseDefault,
      "collapsed",
    ),
    wiktionaryEtymologyCollapseOverride: collapseMode(
      source.wiktionaryEtymologyCollapseOverride,
      "collapsed",
    ),
  };
}

function externalUrl(value) {
  const raw = String(value || "").trim();
  if (!ALLOWED_EXTERNAL_PROTOCOL.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
      return "";
    return url.href;
  } catch (_) {
    return "";
  }
}

function customCss(value) {
  const css = String(value || "");
  if (css.length > 200000) throw new Error("custom CSS exceeds the 200 KB limit");
  if (
    /@import\b/i.test(css) ||
    /url\s*\(/i.test(css) ||
    /expression\s*\(/i.test(css) ||
    /behavior\s*:/i.test(css) ||
    /-moz-binding\s*:/i.test(css) ||
    /javascript\s*:/i.test(css)
  )
    throw new Error("custom CSS may not load remote resources or execute expressions");
  return css;
}

function labels(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => {
      if (item && typeof item === "object")
        return [item.name || item.label || item.displayValue || item.value];
      return String(item || "").split(/[,;]\s*|\s{2,}/);
    })
    .map((item) =>
      String(item || "")
        .trim()
        .slice(0, 300),
    )
    .filter(Boolean)
    .slice(0, 64);
}

function parseStructuredJson(value) {
  const text = String(value || "").trim();
  if (
    !text ||
    Buffer.byteLength(text, "utf8") > MAX_STRUCTURED_CONTENT_BYTES ||
    !/^[\[{]/.test(text)
  )
    return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed.type === "structured-content" || parsed.tag || parsed.content)
  )
    return parsed;
  return null;
}

function safeStructuredStyle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => STRUCTURED_STYLE_PROPERTIES.has(key))
      .slice(0, 32)
      .flatMap(([key, raw]) => {
        const text = String(raw ?? "")
          .trim()
          .slice(0, 500);
        if (!text || /[<>"']|url\s*\(|expression\s*\(|javascript\s*:/i.test(text))
          return [];
        return [[key, text]];
      }),
  );
}

function safeStructuredData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 48)
      .flatMap(([key, raw]) => {
        const name = String(key || "")
          .replace(/^data-/i, "")
          .trim();
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) return [];
        if (raw === null || raw === undefined || typeof raw === "object") return [];
        return [[name, String(raw).slice(0, 2000)]];
      }),
  );
}

function safeDataImage(value) {
  const url = String(value || "").trim();
  return /^data:image\/(?:gif|jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(url)
    ? url.slice(0, 2 * 1024 * 1024)
    : "";
}

function boundedSourceText(value) {
  if (typeof value === "string") return value.slice(0, 1600);
  return "";
}

function structuredNodeText(value, depth = 0) {
  if (depth > 24 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.map((item) => structuredNodeText(item, depth + 1)).join(" ");
  if (typeof value !== "object") return "";
  if (value.type === "text") return String(value.text || "");
  if (value.type === "structured-content" || value.type === "structured-element")
    return structuredNodeText(value.content, depth + 1);
  return String(value.text || "");
}

function structuredDataText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.values(value)
    .slice(0, 48)
    .map((item) => String(item || "").slice(0, 2000))
    .join(" ");
}

function containsDictionaryDetailsMarker(value, depth = 0) {
  if (depth > 24 || value === null || value === undefined) return false;
  if (typeof value === "string")
    return /details-entry-(?:grammar|etymology)/i.test(value);
  if (Array.isArray(value))
    return value.some((item) => containsDictionaryDetailsMarker(item, depth + 1));
  if (typeof value !== "object") return false;
  if (
    /details-entry-(?:grammar|etymology)/i.test(
      `${structuredDataText(value.data)} ${String(value.kind || "")}`,
    )
  )
    return true;
  return containsDictionaryDetailsMarker(value.content, depth + 1);
}

function dictionarySourceKind(dictionary, rawContent, normalizedContent) {
  const dictionaryName = String(dictionary || "").trim();
  const raw = `${dictionaryName} ${boundedSourceText(rawContent)}`.toLowerCase();
  if (/^jitendex(?:\b|[._-])/i.test(dictionaryName)) return "jitendex";
  if (raw.includes("kaikki")) return "kaikki";
  if (raw.includes("wiktionary") || /(^|[^a-z])wty[-_]/.test(raw)) return "wiktionary";
  if (
    containsDictionaryDetailsMarker(rawContent) ||
    containsDictionaryDetailsMarker(normalizedContent)
  )
    return "wiktionary-style";
  return "generic";
}

function normalizedText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function structuredDetailsSummary(value) {
  const children = Array.isArray(value?.content) ? value.content : [];
  const summary = children.find(
    (item) => item && item.type === "structured-element" && item.tag === "summary",
  );
  return normalizedText(summary ? structuredNodeText(summary.content) : "");
}

function isEtymologyNode(value) {
  if (!value || typeof value !== "object") return false;
  if (value.type === "section") return /^etymology\b/i.test(String(value.title || ""));
  if (value.type !== "structured-element" || value.tag !== "details") return false;
  const marker = structuredDataText(value.data);
  return (
    /details-entry-etymology/i.test(marker) ||
    /^etymology\b/i.test(structuredDetailsSummary(value))
  );
}

function wiktionaryLike(sourceKind) {
  return /^(?:kaikki|wiktionary|wiktionary-style)$/.test(sourceKind);
}

function hasNonLemmaTag(glossary) {
  const values = labels([
    glossary?.definitionTags,
    glossary?.termTags,
    ...(Array.isArray(glossary?.tags) ? glossary.tags : [glossary?.tags]),
  ]);
  return values.some((value) => /\bnon[-\s]?lemma\b/i.test(value));
}

function tupleScalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function nonLemmaTupleRows(rawContent) {
  const parsed =
    typeof rawContent === "string" ? parseStructuredJson(rawContent) : rawContent;
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 200) return [];
  const rows = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length < 2 || !tupleScalar(row[0])) return [];
    const descriptions = Array.isArray(row[1]) ? row[1] : [row[1]];
    if (descriptions.some((description) => !tupleScalar(description))) return [];
    const lemma = String(row[0] ?? "")
      .trim()
      .slice(0, 4096);
    for (const description of descriptions) {
      const text = String(description ?? "")
        .trim()
        .slice(0, 4096);
      if (lemma || text) rows.push({ label: "Form of", lemma, text });
      if (rows.length >= 200) return rows;
    }
  }
  return rows;
}

const NON_LEMMA_GRAMMAR_WORD_RE =
  /\b(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|animate|inanimate|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)\b/i;

function wiktionaryPathFragment(text) {
  return /(?:\b[a-z]{2,4}|[a-z])\/(?:languages|appendix|wiki|dictionary|thesaurus|wikipedia|wikisource)\b/i.test(
    String(text || "").replace(/https?:\/\/[^\s<>"']+/gi, ""),
  );
}

function nonLemmaTextRows(rawContent, sourceKind) {
  const text = String(rawContent || "");
  if (!text || parseStructuredJson(text)) return [];
  if (!wiktionaryLike(sourceKind) && !wiktionaryPathFragment(text)) return [];
  const grammarHits =
    text.match(new RegExp(NON_LEMMA_GRAMMAR_WORD_RE.source, "gi")) || [];
  if (
    !wiktionaryPathFragment(text) &&
    !/\b(?:non-lemma|nonlemma|form-of|inflection of|inflected form of|plural of|singular of|comparative of|superlative of|past participle of|present participle of|conjugation of|declension of)\b/i.test(
      text,
    ) &&
    grammarHits.length < 3
  )
    return [];

  const urls = [];
  let cleaned = text.replace(/\r/g, "\n").replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    const token = `__IINATAN_URL_${urls.length}__`;
    urls.push(url);
    return token;
  });
  cleaned = cleaned.replace(
    /(?:\b[a-z]{2,4}|[a-z])\/(?:languages|appendix|wiki|dictionary|thesaurus|wikipedia|wikisource)[A-Za-z0-9 _.-]*?(?=(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)\b|$)/gi,
    "",
  );
  cleaned = cleaned
    .replace(/([a-zà-öø-ÿ])([A-ZÀ-Ö])/g, "$1\n$2")
    .replace(
      /\b(singular|plural|dual|definite|indefinite|masculine|feminine|neuter|common)(?=(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)\b)/gi,
      "$1\n",
    )
    .replace(
      /\b(non-lemma|form-of|inflection of|inflected form of|plural of|singular of|comparative of|superlative of|past participle of|present participle of|conjugation of|declension of)\b\s*:?\s*/gi,
      "\n$1: ",
    );
  return cleaned
    .split(/\n+/)
    .map((part) => {
      let value = normalizedText(part);
      urls.forEach((url, index) => {
        value = value.replace(`__IINATAN_URL_${index}__`, url);
      });
      return value.slice(0, 4096);
    })
    .filter((value) => value && !wiktionaryPathFragment(value))
    .slice(0, 200)
    .map((value) => ({
      label: NON_LEMMA_GRAMMAR_WORD_RE.test(value) ? "Inflection" : "Definition",
      lemma: "",
      text: value,
    }));
}

function dictionaryFormattingContent(rawContent, sourceGlossary, sourceKind, content) {
  const rawText = String(rawContent || "");
  const sourceLooksWiktionary =
    wiktionaryLike(sourceKind) || wiktionaryPathFragment(rawText);
  if (!sourceLooksWiktionary) return content;
  if (wiktionaryLike(sourceKind) && hasNonLemmaTag(sourceGlossary)) {
    const tupleRows = nonLemmaTupleRows(rawContent);
    if (tupleRows.length) return [{ type: "non-lemma-list", rows: tupleRows }];
  }
  const textRows = nonLemmaTextRows(rawContent, sourceKind);
  return textRows.length ? [{ type: "non-lemma-list", rows: textRows }] : content;
}

function etymologyShouldOpen(sourceKind, presentation) {
  let mode = presentation.etymologyCollapseDefault;
  if (
    /^(?:kaikki|wiktionary|wiktionary-style)$/.test(sourceKind) &&
    presentation.wiktionaryEtymologyCollapseOverride !== "inherit"
  )
    mode = presentation.wiktionaryEtymologyCollapseOverride;
  return mode === "expanded";
}

function applyDictionaryPresentation(value, sourceKind, presentation, depth = 0) {
  if (depth > 24 || value === null || value === undefined) return value;
  if (Array.isArray(value))
    return value.map((item) =>
      applyDictionaryPresentation(item, sourceKind, presentation, depth + 1),
    );
  if (typeof value !== "object") return value;

  const result = { ...value };
  if (Array.isArray(value.content))
    result.content = applyDictionaryPresentation(
      value.content,
      sourceKind,
      presentation,
      depth + 1,
    );
  if (isEtymologyNode(result)) {
    const open = etymologyShouldOpen(sourceKind, presentation);
    if (result.type === "section") result.collapsed = !open;
    if (result.type === "structured-element") result.open = open;
  }
  return result;
}

function structuredContentNode(value, depth = 0) {
  if (depth > 24 || value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number")
    return { type: "text", text: String(value).slice(0, 20000) };
  if (Array.isArray(value))
    return value
      .slice(0, 512)
      .map((item) => structuredContentNode(item, depth + 1))
      .filter(Boolean);
  if (typeof value !== "object") return null;
  if (value.type === "structured-content") {
    const content = structuredContentNode(value.content, depth + 1);
    return {
      type: "structured-content",
      content: Array.isArray(content) ? content : content ? [content] : [],
    };
  }
  const tag = String(value.tag || "").toLowerCase();
  if (!STRUCTURED_TAGS.has(tag)) return null;
  const children =
    tag === "br" || tag === "img"
      ? []
      : structuredContentNode(value.content, depth + 1);
  const result = {
    type: "structured-element",
    tag,
    content: Array.isArray(children) ? children : children ? [children] : [],
  };
  const className = String(value.class || value.className || "")
    .trim()
    .slice(0, 300);
  if (className && /^[A-Za-z0-9_ :.-]+$/.test(className)) result.className = className;
  if (value.style) result.style = safeStructuredStyle(value.style);
  if (value.data) result.data = safeStructuredData(value.data);
  if (value.title) result.title = String(value.title).slice(0, 1000);
  if (tag === "a") result.href = externalUrl(value.href || value.url);
  if (tag === "details" && Object.prototype.hasOwnProperty.call(value, "open"))
    result.open = value.open === true;
  if (tag === "img") {
    result.src = safeDataImage(value.src || value.url);
    result.alt = String(value.alt || value.title || "").slice(0, 500);
  }
  return result;
}

function contentList(value) {
  const normalized = dictionaryNode(value);
  return Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
}

function dictionaryNode(node, depth = 0) {
  if (depth > 24 || node === null || node === undefined) return null;
  if (typeof node === "string") {
    const structured = parseStructuredJson(node);
    if (structured) return dictionaryNode(structured, depth + 1);
    return { type: "paragraph", text: String(node).slice(0, 20000) };
  }
  if (typeof node === "number") return { type: "paragraph", text: String(node) };
  if (Array.isArray(node))
    return node
      .slice(0, 512)
      .map((item) => dictionaryNode(item, depth + 1))
      .flatMap((item) => (Array.isArray(item) ? item : item ? [item] : []));
  if (typeof node !== "object") return null;
  if (node.type === "structured-content" || node.tag)
    return structuredContentNode(node, depth);
  const type = String(node.type || "paragraph");
  const safeTypes = new Set([
    "paragraph",
    "example",
    "note",
    "link",
    "section",
    "table",
    "list",
    "cross-reference",
    "furigana",
    "audio",
  ]);
  if (!safeTypes.has(type)) return { type: "paragraph", text: String(node.text || "") };
  const result = { type, text: String(node.text || "") };
  if (type === "furigana") result.reading = String(node.reading || "").slice(0, 2000);
  if (type === "link") result.href = externalUrl(node.href);
  if (type === "audio") {
    result.url = safeAudioUrl(node.url || node.href);
    result.name = String(node.name || node.text || "Audio").slice(0, 200);
  }
  if (type === "cross-reference")
    result.lookup = String(node.lookup || node.term || node.text || "").slice(0, 4096);
  if (type === "section") {
    result.title = String(node.title || "Details").slice(0, 300);
    result.collapsed = node.collapsed !== false;
    result.content = contentList(node.content);
  }
  if (type === "table" || type === "list")
    result.rows = Array.isArray(node.rows)
      ? node.rows
          .slice(0, 200)
          .map((row) =>
            Array.isArray(row)
              ? row.map((cell) => String(cell || "").slice(0, 20000))
              : String(row || ""),
          )
      : [];
  return result;
}

function normalizeDictionaryResult(result, options = {}) {
  const source = result && typeof result === "object" ? result : {};
  const presentation = dictionaryPresentation(options);
  const entries = Array.isArray(source.entries)
    ? source.entries
    : Array.isArray(source.results)
      ? source.results
      : [];
  return {
    lookupString: String(source.lookupString || ""),
    matched: String(source.matched || ""),
    entries: entries.slice(0, 64).map((entry, index) => {
      const sourceEntry =
        entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
      const term =
        sourceEntry.term && typeof sourceEntry.term === "object"
          ? sourceEntry.term
          : sourceEntry;
      const glossaries = Array.isArray(sourceEntry.glossaries)
        ? sourceEntry.glossaries
        : Array.isArray(term.glossaries)
          ? term.glossaries
          : [];
      const rawFrequency =
        sourceEntry.frequencies || sourceEntry.frequency || term.frequencies || [];
      const frequencies = Array.isArray(rawFrequency)
        ? rawFrequency.slice(0, 64).map((row) => {
            if (!row || typeof row !== "object" || Array.isArray(row))
              return {
                dictionary: "",
                frequencies: [{ value: null, displayValue: String(row || "") }],
              };
            const values = Array.isArray(row.frequencies) ? row.frequencies : [row];
            return {
              dictionary: String(
                row.dict || row.dictionary || row.dictName || "",
              ).slice(0, 300),
              frequencies: values.slice(0, 64).map((value) => ({
                value: Number.isFinite(Number(value?.value))
                  ? Number(value.value)
                  : null,
                displayValue: String(
                  value?.displayValue || value?.display || value?.value || "",
                ).slice(0, 300),
              })),
            };
          })
        : [];
      const pitches = Array.isArray(
        sourceEntry.pitches || sourceEntry.pitch || term.pitches,
      )
        ? (sourceEntry.pitches || sourceEntry.pitch || term.pitches).slice(0, 64)
        : [];
      const frequencyLabels = frequencies
        .flatMap((row) =>
          row.frequencies.map(
            (value) => value.displayValue || String(value.value || ""),
          ),
        )
        .filter(Boolean)
        .slice(0, 64);
      const entryTags = labels(sourceEntry.tags || term.tags || term.termTags);
      const glossarySource = glossaries;
      const glossaryTags = glossarySource.flatMap((glossary) =>
        labels([
          ...(Array.isArray(glossary?.tags) ? glossary.tags : [glossary?.tags]),
          glossary?.definitionTags,
          glossary?.termTags,
        ]),
      );
      return {
        id: String(sourceEntry.id || `entry-${index}`),
        matched: String(sourceEntry.matched || "").slice(0, 4096),
        deinflected: String(sourceEntry.deinflected || "").slice(0, 4096),
        headword: String(
          sourceEntry.headword || sourceEntry.expression || term.expression || "",
        ),
        reading: String(sourceEntry.reading || term.reading || ""),
        tags: [...new Set([...entryTags, ...glossaryTags])].slice(0, 64),
        frequency: frequencyLabels,
        frequencies,
        pitch: pitches,
        pitches,
        phoneticTranscriptions: pitches
          .flatMap((row) =>
            Array.isArray(row?.transcriptions) ? row.transcriptions : [],
          )
          .map((value) => String(value).slice(0, 300))
          .filter(Boolean)
          .slice(0, 64),
        partOfSpeech: String(
          sourceEntry.partOfSpeech ||
            term.partOfSpeech ||
            glossarySource.flatMap((item) =>
              labels(item?.partOfSpeech || item?.partOfSpeechInfo),
            )[0] ||
            "",
        ).slice(0, 500),
        glossaries: glossaries.slice(0, 64).map((glossary) => {
          const sourceGlossary =
            glossary && typeof glossary === "object" && !Array.isArray(glossary)
              ? glossary
              : {};
          const rawContent =
            sourceGlossary.content !== undefined
              ? sourceGlossary.content
              : sourceGlossary.glossary;
          const dictionary = String(
            sourceGlossary.dictionary ||
              sourceGlossary.dict ||
              sourceGlossary.dictName ||
              "",
          ).slice(0, 300);
          const content = contentList(rawContent);
          const sourceKind = dictionarySourceKind(dictionary, rawContent, content);
          const formattedContent = dictionaryFormattingContent(
            rawContent,
            sourceGlossary,
            sourceKind,
            content,
          );
          return {
            dictionary,
            sourceKind,
            tags: labels([
              ...(Array.isArray(sourceGlossary.tags)
                ? sourceGlossary.tags
                : [sourceGlossary.tags]),
              sourceGlossary.definitionTags,
              sourceGlossary.termTags,
            ]),
            definitionTags: labels(sourceGlossary.definitionTags),
            termTags: labels(sourceGlossary.termTags),
            partOfSpeech: String(
              sourceGlossary.partOfSpeech || sourceGlossary.partOfSpeechInfo || "",
            ).slice(0, 500),
            content: applyDictionaryPresentation(
              formattedContent,
              sourceKind,
              presentation,
            ),
          };
        }),
      };
    }),
  };
}

module.exports = {
  customCss,
  dictionaryNode,
  externalUrl,
  normalizeDictionaryResult,
  parseStructuredJson,
  structuredContentNode,
};
