const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const timers = [];
const context = {
  console,
  Date,
  JSON,
  isFinite,
  setTimeout(callback) {
    timers.push(callback);
    return timers.length;
  },
  clearTimeout() {},
};
context.IINATAN = {
  config: {
    activeProfileId: "default",
    profiles: {
      default: {
        anki: {
          enabled: true,
          connectUrl: "http://127.0.0.1:8765",
          timeoutSeconds: 1,
          deck: "Mining",
          model: "Basic",
          fields: {
            Front: "{expression}",
            Back: "{glossary-html}{selected-glossary}{sentence-audio}{word-audio}{screenshot}",
          },
          tags: ["iinatan"],
          duplicateMode: "prevent",
          duplicateScope: "deck",
        },
      },
    },
  },
  popupStack: [{ selectedText: "selected definition" }],
  state: {},
  structuredPlain(value) {
    return typeof value === "string" ? value : "";
  },
  captureCardMediaContext() {
    throw new Error("document context should be immutable");
  },
  showStatus(message, level) {
    this.lastStatus = { message, level };
  },
  path(value) {
    return value;
  },
  backendCommand(args, callback) {
    callback(null, {
      stdout: JSON.stringify({
        ok: true,
        name: "word_hash.mp3",
        path: "/media/word_hash.mp3",
      }),
    });
  },
};
vm.createContext(context);
for (const file of [
  "80_anki_transport.js",
  "81_anki_context.js",
  "82_anki_templates.js",
  "83_anki_duplicates.js",
  "84_anki_actions.js",
]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "src", "mpv", file), "utf8"),
    context,
    { filename: file },
  );
}
const I = context.IINATAN;
const entry = {
  headword: "猫",
  reading: "ねこ",
  tags: ["common"],
  frequencies: [],
  pitches: [],
  glossaries: [
    {
      dictionary: "Jitendex",
      content: [
        { type: "paragraph", text: "cat & pet" },
        { type: "list", items: ["feline", "animal"] },
        {
          type: "link",
          href: "https://example.test/cat?a=1&b=2",
          text: "source",
        },
      ],
    },
  ],
};
const document = {
  context: {
    sentence: "猫です。",
    source: { title: "Episode", path: "/video.mkv" },
    timeFallback: 12.5,
    wordAudio: { path: "/cache/word.mp3" },
  },
};
const card = I.ankiCardContext(entry, document);
assert.strictEqual(card.selectedGlossary, "selected definition");
assert.match(card.glossaryHtml, /cat &amp; pet/);
assert.match(card.glossaryHtml, /<ul>/);
assert.match(card.glossaryHtml, /https:\/\/example\.test/);

let httpCalls = 0;
I.http = (_request, callback) => {
  httpCalls++;
  callback(null, { body: "not-json" });
};
I.ankiInvoke("version", {}, (error) => {
  assert.match(error.message, /invalid JSON/);
});
assert.strictEqual(httpCalls, 1);
I.http = (_request, callback) => callback(null, { body: '{"result":1}' });
I.ankiInvoke("version", {}, (error) => {
  assert.match(error.message, /Unsupported/);
});
let retryCalls = 0,
  retryError;
I.http = (_request, callback) => {
  retryCalls++;
  callback(new Error("timeout"));
};
I.ankiInvoke("version", {}, (error) => {
  retryError = error;
});
assert.strictEqual(retryCalls, 1);
timers.shift()();
assert.strictEqual(retryCalls, 2);
assert.match(retryError.message, /timeout/);

let findCallbacks = [];
let findCalls = 0;
I.ankiInvoke = (action, _params, callback) => {
  assert.strictEqual(action, "findNotes");
  findCalls++;
  findCallbacks.push(callback);
};
const duplicateResults = [];
I.checkAnkiDuplicate(
  { Front: "猫" },
  I.config.profiles.default.anki,
  (_error, ids) => duplicateResults.push(ids),
);
I.checkAnkiDuplicate(
  { Front: "猫" },
  I.config.profiles.default.anki,
  (_error, ids) => duplicateResults.push(ids),
);
assert.strictEqual(findCalls, 1, "passive duplicate races must coalesce");
findCallbacks[0](null, [42]);
assert.deepStrictEqual(
  duplicateResults.map((ids) => Array.from(ids)),
  [[42], [42]],
);
I.ankiCache = Object.create(null);

I.captureScreenshot = (_media, callback) =>
  callback(null, { name: "shot.jpg", path: "/media/shot.jpg" });
I.exportSentenceAudio = (_media, callback) =>
  callback(null, { name: "sentence.opus", path: "/media/sentence.opus" });
I.storeAnkiMedia = (file, callback) => callback(null, file.name);
const actions = [];
I.ankiInvoke = (action, params, callback) => {
  actions.push({ action, params });
  if (action === "findNotes") callback(null, []);
  else if (action === "addNote") callback(null, 99);
  else callback(null, []);
};
I.addEntryToAnki(entry, document, false);
assert.ok(actions.some((item) => item.action === "findNotes"));
const add = actions.find((item) => item.action === "addNote");
assert.ok(add);
assert.strictEqual(add.params.note.options.allowDuplicate, false);
assert.match(add.params.note.fields.Back, /sentence\.opus/);
assert.match(add.params.note.fields.Back, /word_hash\.mp3/);
assert.match(add.params.note.fields.Back, /shot\.jpg/);
assert.strictEqual(I.state.lastNoteId, 99);

I.ankiCache = Object.create(null);
I.config.profiles.default.anki.fields = { Front: "{expression}" };
actions.length = 0;
I.ankiInvoke = (action, params, callback) => {
  actions.push({ action, params });
  if (action === "findNotes") callback(null, [77]);
  else if (action === "addNote") callback(null, 100);
};
I.addEntryToAnki(entry, document, false);
assert.ok(I.state.pendingDuplicate);
assert.ok(!actions.some((item) => item.action === "addNote"));
I.ankiCache = Object.create(null);
I.addEntryToAnki(entry, document, true);
const addAnyway = actions.find((item) => item.action === "addNote");
assert.strictEqual(addAnyway.params.note.options.allowDuplicate, true);

I.config.profiles.default.anki.fields = {
  Front: "{expression}",
  Back: "{screenshot}",
};
I.ankiCache = Object.create(null);
actions.length = 0;
I.captureScreenshot = (_media, callback) =>
  callback(new Error("screenshot failed"));
I.addEntryToAnki(entry, document, false);
assert.match(I.lastStatus.message, /media failed/i);
assert.ok(!actions.some((item) => item.action === "addNote"));

I.popupStack.push({ selectedText: "nested" });
let nestedTasks = 0;
I.captureScreenshot = () => nestedTasks++;
I.exportSentenceAudio = () => nestedTasks++;
I.captureAnkiMedia(
  I.config.profiles.default.anki.fields,
  card,
  (error, media) => {
    assert.ifError(error);
    assert.deepStrictEqual(Object.keys(media), []);
  },
);
assert.strictEqual(
  nestedTasks,
  0,
  "nested popups must not capture video media",
);

I.openAnkiNote(-1);
assert.match(I.lastStatus.message, /Invalid/);
let browseQuery = "";
I.ankiInvoke = (action, params, callback) => {
  assert.strictEqual(action, "guiBrowse");
  browseQuery = params.query;
  callback(null, []);
};
I.openAnkiNote(99);
assert.strictEqual(browseQuery, "nid:99");

console.log("mpv Anki end-to-end tests passed");
