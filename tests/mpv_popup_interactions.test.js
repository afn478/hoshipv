const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const forced = [],
  removed = [];
const context = {
  console,
  setTimeout,
  clearTimeout,
  isFinite,
  mp: {
    msg: { info() {}, error() {}, warn() {} },
    utils: {
      get_user_path(v) {
        return v;
      },
    },
    get_opt() {},
    get_property_bool() {
      return false;
    },
    set_property_bool() {},
    remove_key_binding(name) {
      removed.push(name);
    },
    add_forced_key_binding(_key, name) {
      forced.push(name);
    },
  },
};
vm.createContext(context);
for (const file of [
  "src/mpv/00_runtime.js",
  "src/languages/lookup_character_policy.js",
  "src/languages/common.js",
  "src/languages/deinflection.js",
  "src/languages/japanese.js",
  "src/languages/english_yomitan_rules.js",
  "src/languages/english.js",
  "src/languages/french_yomitan_rules.js",
  "src/languages/french.js",
  "src/languages/german_yomitan_rules.js",
  "src/languages/german.js",
  "src/languages/chinese.js",
  "src/languages/korean.js",
  "src/languages/registry.js",
  "src/mpv/10_unicode.js",
  "src/mpv/40_ass.js",
  "src/mpv/60_popup.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const I = context.IINATAN;
I.config = {
  activeProfileId: "default",
  profiles: { default: { nestedPopupMode: "off", nestedPopupMaxDepth: 3 } },
};
I.state.osd = { w: 1000, h: 700, ml: 0, mr: 0, mt: 0, mb: 0 };
I.state.properties["user-data/osc/margins"] = { b: 0.12, l: 0, r: 0, t: 0 };
I.state.mouse = { hover: true, x: 500, y: 600 };
I.popupStack = [{ rect: { x: 400, y: 200, w: 300, h: 200 } }];
function assert(value, message) {
  if (!value) throw new Error(message);
}
const placed = I.placePopup(
  { x: 460, y: 500, w: 80, h: 30 },
  { w: 360, h: 260 },
);
assert(placed.x >= 8 && placed.y >= 8, "popup must stay in the OSD safe area");
assert(
  placed.y + placed.h <= 700 - 0.12 * 700 - 8,
  "popup must account for OSC margins",
);
I.state.osd = { w: 700, h: 1000, ml: 30, mr: 20, mt: 60, mb: 40 };
I.state.properties["user-data/osc/margins"] = { b: 0, l: 0, r: 0, t: 0 };
I.state.mouse = { hover: true, x: 350, y: 500 };
const resized = I.placePopup(
  { x: 310, y: 600, w: 80, h: 30 },
  { w: 500, h: 420 },
);
assert(
  resized.x >= 38 && resized.y >= 68,
  "letterbox margins form the safe area",
);
assert(
  resized.x + resized.w <= 700 - 20 - 8 &&
    resized.y + resized.h <= 1000 - 40 - 8,
  "resized fullscreen/windowed placement remains clamped",
);
assert(
  resized.x < 700 && resized.y < 1000,
  "OSD coordinates remain unscaled on HiDPI displays",
);
I.scene = { index: new I.SpatialIndex(50) };
I.scene.index.add(
  new I.HitRegion(
    "interactive",
    { x: 0, y: 0, w: 100, h: 100 },
    {},
    "pointer",
    1,
  ),
);
I.state.mouse = { hover: true, x: 10, y: 10 };
I.state.interactive = false;
I.updateBindings();
assert(
  forced.length === 3,
  "interactive hover installs click and wheel bindings",
);
I.state.mouse = { hover: true, x: 200, y: 200 };
I.updateBindings();
assert(removed.length === 3, "leaving iinatan releases all forced bindings");
I.pauseOwner = true;
I.popupStack = [{}, {}];
I.cancelAudioPreview = function () {};
I.invalidateScene = function () {};
I.closePopup();
assert(
  I.popupStack.length === 1 && I.pauseOwner,
  "closing nested popup must retain root and pause ownership",
);
I.closePopup();
assert(
  I.popupStack.length === 0 && !I.pauseOwner,
  "closing final popup must release owned pause",
);
I.config.profiles.default.subtitleLookupMode = "hover";
I.config.profiles.default.lookupLanguage = "ja";
I.config.profiles.default.scanLength = 24;
I.state.lookupEnabled = true;
I.state.settingsOpen = false;
I.state.hoverUnit = null;
I.state.mouse = { hover: true, x: 625, y: 640 };
I.state.subtitleUnits = [
  {
    surface: "primary",
    position: 1,
    displayStartUtf16: 1,
    text: "日本語",
    rects: [{ x: 610, y: 620, w: 60, h: 56 }],
  },
];
let hoverLookup = null;
I.unionRects = function (rects) {
  return rects[0];
};
I.openLookup = function (text, position, nested) {
  hoverLookup = { text, position, nested };
};
assert(
  I.lookupRequestFor("ja", "（", 0, I.config.profiles.default) === null,
  "punctuation must not produce a lookup payload",
);
I.handleHover();
assert(
  JSON.stringify(hoverLookup) ===
    JSON.stringify({ text: "日本語", position: 1, nested: false }),
  "a pointer inside absolute subtitle geometry must open lookup at that glyph",
);
console.log("mpv popup interaction tests passed");
