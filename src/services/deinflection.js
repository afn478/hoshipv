"use strict";

const englishRules = require("./language-rules/english");
const frenchRules = require("./language-rules/french");
const germanRules = require("./language-rules/german");

function arrayOf(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const text = String(value || "").trim();
    const key = text.normalize ? text.normalize("NFC") : text;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conditionDefaults(descriptor) {
  const result = Object.create(null);
  for (const condition of descriptor.conditions || []) {
    if (condition.isDefault !== false) result[condition.name] = true;
    for (const subcondition of condition.subconditions || []) {
      if (subcondition.isDefault) result[subcondition.name] = true;
    }
  }
  return result;
}

function conditionsMatch(active, required) {
  const names = arrayOf(required);
  return !names.length || names.some((name) => !!active[name]);
}

function nextConditions(active, names) {
  const required = arrayOf(names);
  if (!required.length) return { ...active };
  const result = Object.create(null);
  for (const name of required) result[name] = true;
  return result;
}

function conditionsKey(conditions) {
  return Object.keys(conditions || {})
    .sort()
    .join(",");
}

function suffixInflection(inflected, deinflected, conditionsIn, conditionsOut, reason) {
  return {
    type: "suffix",
    inflected: String(inflected || ""),
    deinflected: String(deinflected || ""),
    conditionsIn: arrayOf(conditionsIn),
    conditionsOut: arrayOf(conditionsOut),
    reason: reason || `suffix:${inflected}>${deinflected}`,
  };
}

function prefixInflection(inflected, deinflected, conditionsIn, conditionsOut, reason) {
  return {
    type: "prefix",
    inflected: String(inflected || ""),
    deinflected: String(deinflected || ""),
    conditionsIn: arrayOf(conditionsIn),
    conditionsOut: arrayOf(conditionsOut),
    reason: reason || `prefix:${inflected}>${deinflected}`,
  };
}

function wholeWordInflection(
  inflected,
  deinflected,
  conditionsIn,
  conditionsOut,
  reason,
) {
  return {
    type: "whole",
    inflected: String(inflected || ""),
    deinflected: String(deinflected || ""),
    conditionsIn: arrayOf(conditionsIn),
    conditionsOut: arrayOf(conditionsOut),
    reason: reason || `whole:${inflected}>${deinflected}`,
  };
}

function customInflection(apply, conditionsIn, conditionsOut, reason) {
  return {
    type: "custom",
    apply,
    conditionsIn: arrayOf(conditionsIn),
    conditionsOut: arrayOf(conditionsOut),
    reason: reason || "custom",
  };
}

function applyRule(text, rule) {
  if (rule.type === "suffix") {
    if (!rule.inflected || !text.endsWith(rule.inflected)) return [];
    return [text.slice(0, -rule.inflected.length) + rule.deinflected];
  }
  if (rule.type === "prefix") {
    if (!rule.inflected || !text.startsWith(rule.inflected)) return [];
    return [rule.deinflected + text.slice(rule.inflected.length)];
  }
  if (rule.type === "whole") return text === rule.inflected ? [rule.deinflected] : [];
  if (rule.type === "custom" && typeof rule.apply === "function") {
    const result = rule.apply(text);
    return Array.isArray(result) ? result : result ? [result] : [];
  }
  return [];
}

function addRuleIndex(index, key, ruleIndex) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(ruleIndex);
}

function createRuleIndex(rules) {
  const index = {
    suffixes: Object.create(null),
    prefixes: Object.create(null),
    wholeWords: Object.create(null),
    custom: [],
  };
  rules.forEach((rule, ruleIndex) => {
    if (!rule) return;
    if (rule.type === "suffix") addRuleIndex(index.suffixes, rule.inflected, ruleIndex);
    else if (rule.type === "prefix")
      addRuleIndex(index.prefixes, rule.inflected, ruleIndex);
    else if (rule.type === "whole")
      addRuleIndex(index.wholeWords, rule.inflected, ruleIndex);
    else if (rule.type === "custom" && typeof rule.apply === "function")
      index.custom.push(ruleIndex);
  });
  return index;
}

function applicableRuleIndices(text, index) {
  const result = index.custom.slice();
  if (index.wholeWords[text]) result.push(...index.wholeWords[text]);
  for (let offset = 0; offset < text.length; offset++) {
    const rules = index.suffixes[text.slice(offset)];
    if (rules) result.push(...rules);
  }
  for (let length = 1; length <= text.length; length++) {
    const rules = index.prefixes[text.slice(0, length)];
    if (rules) result.push(...rules);
  }
  return result.sort((left, right) => left - right);
}

function createTransformer(descriptor = {}) {
  const rules = Array.isArray(descriptor.rules) ? descriptor.rules : [];
  const defaults = conditionDefaults(descriptor);
  const ruleIndex = createRuleIndex(rules);
  const maxResults = Math.max(1, Number(descriptor.maxResults) || 96);
  const maxDepth = Math.max(1, Number(descriptor.maxDepth) || 4);

  return {
    transform(sourceText) {
      const source = String(sourceText || "");
      if (!source) return [];
      const results = [
        {
          text: source,
          conditions: { ...defaults },
          trace: [],
        },
      ];
      const seen = new Set([`${source}\t${conditionsKey(defaults)}`]);
      for (
        let index = 0;
        index < results.length && results.length < maxResults;
        index++
      ) {
        const current = results[index];
        if (current.trace.length >= maxDepth) continue;
        for (const ruleIndexValue of applicableRuleIndices(current.text, ruleIndex)) {
          if (results.length >= maxResults) break;
          const rule = rules[ruleIndexValue];
          if (!conditionsMatch(current.conditions, rule.conditionsIn)) continue;
          for (const applied of applyRule(current.text, rule)) {
            if (results.length >= maxResults) break;
            const text = String(applied || "");
            if (!text || text === current.text) continue;
            const conditions = nextConditions(current.conditions, rule.conditionsOut);
            const trace = current.trace.concat([rule.reason || rule.type || "rule"]);
            const key = `${text}\t${conditionsKey(conditions)}\t${trace.join("|")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({ text, conditions, trace });
          }
        }
      }
      return results;
    },
  };
}

function ruleTable(values, factory) {
  return values
    .filter((rule) => Array.isArray(rule) && rule.length >= 5)
    .map((rule) => factory(rule));
}

function englishRuleTable() {
  const rules = ruleTable(englishRules.suffixRules, (rule) =>
    suffixInflection(rule[0], rule[1], rule[2], rule[3], `Yomitan ${rule[4]}`),
  );
  rules.push(
    ...ruleTable(englishRules.prefixRules, (rule) =>
      prefixInflection(rule[0], rule[1], rule[2], rule[3], `Yomitan ${rule[4]}`),
    ),
  );
  for (const rule of englishRules.doubledSuffixRules || []) {
    if (!Array.isArray(rule) || rule.length < 5) continue;
    for (const consonant of String(rule[0] || ""))
      rules.push(
        suffixInflection(
          `${consonant}${consonant}${rule[1]}`,
          consonant,
          rule[2],
          rule[3],
          `Yomitan ${rule[4]}`,
        ),
      );
  }
  return rules;
}

function germanRuleTable() {
  return ruleTable(
    [...germanRules.suffixRules, ...(germanRules.localSuffixRules || [])],
    (rule) => suffixInflection(rule[0], rule[1], rule[2], rule[3], rule[4]),
  ).concat(
    ruleTable(germanRules.prefixRules, (rule) =>
      prefixInflection(rule[0], rule[1], rule[2], rule[3], rule[4]),
    ),
  );
}

function frenchRuleTable() {
  return ruleTable(frenchRules, (rule) =>
    suffixInflection(rule[0], rule[1], rule[2], rule[3], `Yomitan ${rule[4]}`),
  ).concat([
    wholeWordInflection("compris", "comprendre", "v", "v", "irregular past participle"),
    suffixInflection("ées", "er", "v", "v", "past participle -ées"),
    suffixInflection("ée", "er", "v", "v", "past participle -ée"),
    suffixInflection("és", "er", "v", "v", "past participle -és"),
    suffixInflection("é", "er", "v", "v", "past participle -é"),
    suffixInflection("ies", "ir", "v", "v", "past participle -ies"),
    suffixInflection("ie", "ir", "v", "v", "past participle -ie"),
    suffixInflection("çons", "cer", "v", "v", "present -çons"),
    suffixInflection("geons", "ger", "v", "v", "present -geons"),
    suffixInflection("amment", "ant", "adv", "adj", "adverb -amment"),
    suffixInflection("emment", "ent", "adv", "adj", "adverb -emment"),
    suffixInflection("ment", "", "adv", "adj", "adverb -ment"),
  ]);
}

const englishTransformer = createTransformer({
  maxDepth: 3,
  maxResults: 128,
  conditions: [
    { name: "v", isDefault: true },
    { name: "v_phr", isDefault: true },
    { name: "n", isDefault: true },
    { name: "np", isDefault: true },
    { name: "ns", isDefault: true },
    { name: "adj", isDefault: true },
    { name: "adv", isDefault: true },
  ],
  rules: englishRuleTable(),
});

const germanPrefixes = [
  ...(germanRules.separablePrefixes || []),
  ...(germanRules.localSeparablePrefixes || []),
];
const germanFiniteIrregular = Object.freeze({
  bin: ["sein"],
  bist: ["sein"],
  ist: ["sein"],
  sind: ["sein"],
  seid: ["sein"],
  war: ["sein"],
  waren: ["sein"],
  habe: ["haben"],
  hast: ["haben"],
  hat: ["haben"],
  haben: ["haben"],
  habt: ["haben"],
  hatte: ["haben"],
  hatten: ["haben"],
  kann: ["können"],
  kannst: ["können"],
  können: ["können"],
  könnt: ["können"],
  muss: ["müssen"],
  musst: ["müssen"],
  müssen: ["müssen"],
  müsst: ["müssen"],
  will: ["wollen"],
  willst: ["wollen"],
  wollen: ["wollen"],
  wollt: ["wollen"],
  geht: ["gehen"],
  gehe: ["gehen"],
  gehst: ["gehen"],
  sieht: ["sehen"],
  siehst: ["sehen"],
  steht: ["stehen"],
  stehst: ["stehen"],
  stehe: ["stehen"],
  darf: ["dürfen"],
  darfst: ["dürfen"],
  dürfen: ["dürfen"],
  dürft: ["dürfen"],
  soll: ["sollen"],
  sollst: ["sollen"],
  sollen: ["sollen"],
  sollt: ["sollen"],
  mag: ["mögen"],
  magst: ["mögen"],
  mögen: ["mögen"],
  mögt: ["mögen"],
  gibst: ["geben"],
  gibt: ["geben"],
  hilft: ["helfen"],
  helfe: ["helfen"],
  hilfst: ["helfen"],
  lese: ["lesen"],
  liest: ["lesen"],
  nimmt: ["nehmen"],
  nimmst: ["nehmen"],
  sehe: ["sehen"],
  spreche: ["sprechen"],
  sprichst: ["sprechen"],
  spricht: ["sprechen"],
  tue: ["tun"],
  tust: ["tun"],
  tut: ["tun"],
  werde: ["werden"],
  wirst: ["werden"],
  wird: ["werden"],
});
const germanPastParticipleIrregular = Object.freeze({
  gegangen: "gehen",
  gekommen: "kommen",
  gesehen: "sehen",
  gesprochen: "sprechen",
  genommen: "nehmen",
  geschrieben: "schreiben",
  gelesen: "lesen",
  gefahren: "fahren",
  geblieben: "bleiben",
  geworden: "werden",
  gefunden: "finden",
  begonnen: "beginnen",
  getrunken: "trinken",
  gegessen: "essen",
  getragen: "tragen",
  gegeben: "geben",
  gewesen: "sein",
});

function germanFiniteVerbInfinitives(word) {
  const value = String(word || "").toLowerCase();
  const result = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || candidate.length <= 3 || seen.has(candidate)) return;
    seen.add(candidate);
    result.push(candidate);
  };
  (germanFiniteIrregular[value] || []).forEach(add);
  if (value.endsWith("elst")) add(value.slice(0, -4) + "eln");
  if (value.endsWith("elt")) add(value.slice(0, -3) + "eln");
  if (value.endsWith("erst")) add(value.slice(0, -4) + "ern");
  if (value.endsWith("ert")) add(value.slice(0, -3) + "ern");
  if (value.endsWith("est")) add(value.slice(0, -3) + "en");
  if (value.endsWith("et")) add(value.slice(0, -2) + "en");
  if (value.endsWith("st")) add(value.slice(0, -2) + "en");
  if (value.endsWith("t")) add(value.slice(0, -1) + "en");
  if (value.endsWith("e")) add(value.slice(0, -1) + "en");
  if (value.endsWith("en")) add(value);
  return result;
}

function germanSplitVerbCandidates(text, start, end) {
  const chars = Array.from(String(text || ""));
  const context = chars.slice(start, Math.min(chars.length, end + 96)).join("");
  const tokens = context.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || [];
  if (tokens.length < 2) return [];
  const prefix = tokens[tokens.length - 1].toLowerCase();
  if (!germanPrefixes.includes(prefix)) return [];
  return germanFiniteVerbInfinitives(tokens[0]).map((value) => prefix + value);
}
const germanTransformer = createTransformer({
  maxDepth: 3,
  maxResults: 96,
  conditions: [
    { name: "v", isDefault: true },
    { name: "vw", isDefault: true },
    { name: "vst", isDefault: true },
    { name: "n", isDefault: true },
    { name: "adj", isDefault: true },
  ],
  rules: germanRuleTable().concat([
    customInflection(
      (text) => {
        const match = /^ge([a-zà-öø-ÿ]+)t$/i.exec(text);
        return match ? [match[1] + "en", match[1] + "n"] : [];
      },
      [],
      "vw",
      "past participle",
    ),
    customInflection(
      (text) => {
        const prefix = germanPrefixes.join("|");
        const match = new RegExp(`^(${prefix})ge([a-zà-öø-ÿ]+)t$`, "i").exec(text);
        return match ? [match[1] + match[2] + "en", match[1] + match[2] + "n"] : [];
      },
      [],
      "vw",
      "separable past participle",
    ),
    customInflection(
      (text) => {
        const prefix = germanPrefixes.join("|");
        const match = new RegExp(`^(${prefix})zu([a-zà-öø-ÿ]+)$`, "i").exec(text);
        return match ? [match[1] + match[2]] : [];
      },
      [],
      "v",
      "zu-infinitive",
    ),
  ]),
});

const frenchTransformer = createTransformer({
  maxDepth: 3,
  maxResults: 128,
  conditions: [
    { name: "v", isDefault: true },
    { name: "n", isDefault: true },
    { name: "adj", isDefault: true },
    { name: "adv", isDefault: true },
    { name: "aux", isDefault: true },
  ],
  rules: frenchRuleTable(),
});

function appendTransforms(
  list,
  seen,
  baseCandidate,
  transformer,
  language,
  limit = 24,
) {
  if (!baseCandidate?.text || !transformer) return;
  let added = 0;
  for (const result of transformer.transform(baseCandidate.text)) {
    if (added >= Math.max(1, Number(limit) || 24)) break;
    if (!result.text || result.text === baseCandidate.text) continue;
    const key = String(result.text).normalize
      ? String(result.text).normalize("NFC")
      : String(result.text);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      text: result.text,
      normalizedText: result.text,
      source: "deinflection",
      reason: result.trace.join(" -> ") || "deinflected",
      deinflectedFrom: baseCandidate.text,
      deinflectionTrace: result.trace,
      language,
      displayText: baseCandidate.displayText,
      range: baseCandidate.range,
    });
    added++;
  }
}

function addCandidate(list, seen, text, displayText, range, language, source, reason) {
  const value = String(text || "").trim();
  const key = value.normalize ? value.normalize("NFC") : value;
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push({
    text: value,
    normalizedText: value,
    source,
    reason,
    language,
    displayText,
    range,
  });
}

function transformCandidates(word, displayText, range, language, transformer) {
  const list = [];
  const seen = new Set();
  addCandidate(
    list,
    seen,
    word,
    displayText,
    range,
    language,
    "surface",
    "surface form",
  );
  const baseCount = list.length;
  for (let index = 0; index < baseCount; index++)
    appendTransforms(list, seen, list[index], transformer, language, 48);
  return list;
}

function englishCandidates(word, displayText = word, range = null) {
  return transformCandidates(
    String(word || "").toLowerCase(),
    displayText,
    range,
    "en",
    englishTransformer,
  );
}

function germanCandidates(word, displayText = word, range = null) {
  const surface = String(word || "").trim();
  const normalized = surface.toLowerCase();
  const list = [];
  const seen = new Set();
  addCandidate(
    list,
    seen,
    surface,
    displayText,
    range,
    "de",
    "surface",
    "surface form",
  );
  addCandidate(
    list,
    seen,
    normalized,
    displayText,
    range,
    "de",
    "lowercase",
    "lowercase form",
  );
  for (const base of [surface, normalized]) {
    for (const value of [base.replace(/ß/g, "ss"), base.replace(/ss/g, "ß")])
      addCandidate(
        list,
        seen,
        value,
        displayText,
        range,
        "de",
        "eszett",
        "eszett variant",
      );
  }
  const baseCount = list.length;
  for (let index = 0; index < baseCount; index++)
    appendTransforms(list, seen, list[index], germanTransformer, "de", 48);
  if (germanPastParticipleIrregular[normalized])
    addCandidate(
      list,
      seen,
      germanPastParticipleIrregular[normalized],
      displayText,
      range,
      "de",
      "irregular-past-participle",
      "irregular past participle",
    );
  return list;
}

function frenchCandidates(word, displayText = word, range = null) {
  const original = String(word || "")
    .trim()
    .toLowerCase();
  const normalized = original.replace(/[’ʼ＇‘‛]/g, "'");
  const list = [];
  const seen = new Set();
  addCandidate(
    list,
    seen,
    original,
    displayText,
    range,
    "fr",
    "surface",
    "surface form",
  );
  addCandidate(
    list,
    seen,
    normalized,
    displayText,
    range,
    "fr",
    "apostrophe-normalized",
    "apostrophe variant",
  );
  const elision = normalized.match(/^(c|d|j|l|m|n|qu|s|t)'(.+)$/);
  if (elision)
    addCandidate(
      list,
      seen,
      elision[2],
      displayText,
      range,
      "fr",
      "french-elision",
      `elided prefix ${elision[1]}'`,
    );
  const baseCount = list.length;
  for (let index = 0; index < baseCount; index++)
    appendTransforms(list, seen, list[index], frenchTransformer, "fr", 48);
  return list;
}

function candidatesFor(language, word, displayText = word, range = null) {
  if (language === "en") return englishCandidates(word, displayText, range);
  if (language === "de") return germanCandidates(word, displayText, range);
  if (language === "fr") return frenchCandidates(word, displayText, range);
  return [
    {
      text: String(word || ""),
      normalizedText: String(word || ""),
      source: "surface",
      reason: "surface form",
      language,
      displayText,
      range,
    },
  ].filter((candidate) => candidate.text);
}

module.exports = {
  appendTransforms,
  candidatesFor,
  createTransformer,
  englishCandidates,
  frenchCandidates,
  germanSplitVerbCandidates,
  germanCandidates,
  prefixInflection,
  suffixInflection,
  unique,
  wholeWordInflection,
};
