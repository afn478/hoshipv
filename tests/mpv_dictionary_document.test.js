const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
  console,
  setTimeout,
  clearTimeout,
  isFinite,
  mp: { msg: { info() {}, warn() {}, error() {} } },
};
vm.createContext(context);
for (const file of ["00_runtime.js", "40_ass.js", "50_document.js"]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "src", "mpv", file), "utf8"),
    context,
    { filename: file },
  );
}
context.IINATAN.scene = {
  context() {
    return {
      styles: {
        headword: { size: 30 },
        reading: { size: 18 },
        tag: { size: 14 },
        body: { size: 20 },
      },
    };
  },
};
context.IINATAN.nestedTextAction = () => null;
context.IINATAN.previewEntryAudio = () => {};
context.IINATAN.addEntryToAnki = () => {};

const languages = [
  ["日本語", "にほんご", "Japanese"],
  ["reader", "", "English"],
  ["Wörterbuch", "", "German"],
  ["français", "", "French"],
  ["한국어", "", "Korean"],
  ["中文", "zhōngwén", "Chinese"],
];
const result = {
  lookupString: "fixture",
  results: languages.map(([expression, reading, dictionary], index) => ({
    matched: expression,
    term: {
      expression,
      reading,
      rules: index === 0 ? "common n" : "",
      termTags: index === 0 ? "news1" : "",
      frequencies: [{ dict: "frequency", frequencies: [{ value: index + 1 }] }],
      pitches: index === 0 ? [{ dict: "pitch", positions: [2] }] : [],
      glossaries: [
        {
          dict: dictionary,
          definitionTags: "tag",
          glossary:
            index === 0
              ? JSON.stringify({
                  tag: "div",
                  content: [
                    { tag: "p", content: "prominent definition" },
                    {
                      tag: "table",
                      content: [
                        {
                          tag: "tr",
                          content: [
                            { tag: "td", content: "form" },
                            { tag: "td", content: "formed" },
                          ],
                        },
                      ],
                    },
                    {
                      tag: "a",
                      attributes: { href: "https://example.test/source" },
                      content: "Source",
                    },
                    {
                      tag: "div",
                      attributes: { class: "etymology" },
                      content: "origin",
                    },
                  ],
                })
              : `definition ${index + 1}`,
        },
      ],
    },
  })),
};

const document = new context.IINATAN.DictionaryDocument(result, {});
assert.strictEqual(document.entries.length, 6);
assert.deepStrictEqual(
  Array.from(document.entries, (entry) => entry.headword),
  languages.map((item) => item[0]),
);
assert.ok(document.entries[0].tags.includes("news1"));
assert.ok(document.entries[0].tags.includes("common"));
assert.ok(document.entries[0].pitches.length);
assert.ok(document.entries[0].frequencies.length);
assert.ok(
  document.entries[0].glossaries[0].content.some(
    (node) => node.type === "table",
  ),
);
assert.ok(
  document.entries[0].glossaries[0].content.some(
    (node) => node.type === "section" && node.title === "Etymology",
  ),
);
assert.strictEqual(
  JSON.stringify(document.entries[0].sources),
  JSON.stringify([{ text: "Source", href: "https://example.test/source" }]),
);

const scoped = context.IINATAN.parseStructuredGlossary(
  "(non-lemma tuple) translated",
  "wty-en-de",
);
assert.strictEqual(scoped[0].text, "translated");
const unrelated = context.IINATAN.parseStructuredGlossary(
  "(non-lemma tuple) retained",
  "wty-fr-en",
);
assert.match(unrelated[0].text, /non-lemma/);
assert.strictEqual(context.IINATAN.safeExternalUrl("javascript:alert(1)"), "");

const widget = context.IINATAN.documentWidget(document);
assert.strictEqual(widget.children.length, 6);
widget.children.forEach((entryWidget, index) => {
  const block = index === 0 ? entryWidget : entryWidget.child;
  assert.ok(
    block.children.some((child) => child.id === `entry-${index}:headword`),
    `entry ${index} keeps a prominent independent headword`,
  );
});

console.log("mpv six-language dictionary document tests passed");
