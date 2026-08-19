const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
  console,
  Date,
  JSON,
  Object,
  Array,
  Number,
  String,
  Math,
  isFinite,
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  mp: {
    msg: { info() {}, warn() {}, error() {} },
    osd_message() {},
    get_opt() {},
    get_property() {
      return "Fixture";
    },
    command_native_async(_command, callback) {
      callback(true, {}, "");
      return 1;
    },
    last_error() {
      return "";
    },
    abort_async_command() {},
    utils: {
      get_user_path(value) {
        return value.replace("~~cache", "/cache");
      },
      file_info() {
        return true;
      },
    },
  },
};
vm.createContext(context);
for (const file of [
  "00_runtime.js",
  "05_config.js",
  "10_unicode.js",
  "20_media.js",
  "70_services.js",
])
  vm.runInContext(
    fs.readFileSync(path.join(root, "src", "mpv", file), "utf8"),
    context,
    { filename: file },
  );

const I = context.IINATAN;
I.config = I.clone(I.DEFAULT_CONFIG);
I.platform = "macos";
I.mediaGeneration = 2;
I.generation = 4;
I.state.fileLoaded = true;
I.state.subtitles = [];
I.state.osd = { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0 };
I.state.mouse = { hover: true, x: 500, y: 600 };
I.state.properties = {
  path: "/media/movie.mkv",
  sid: 3,
  "time-pos": 12,
  pause: true,
  "video-out-params": { w: 1920, h: 1080 },
  "track-list": [
    { id: 3, type: "sub", codec: "hdmv_pgs_subtitle", "ff-index": 5 },
  ],
};
I.debounce = function () {};
I.updateSelection = function () {};
I.propertyChanged("mouse-pos/x", 512);
I.propertyChanged("mouse-pos/y", 640);
I.propertyChanged("mouse-pos/hover", true);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(I.state.properties["mouse-pos"])),
  { x: 512, y: 640, hover: true },
  "mouse coordinate subproperties must update the pointer state source",
);
I.handleHover = function () {};

let request;
I.workerRequest = function (payload, callback) {
  request = payload;
  callback(null, {
    ok: true,
    text: "日本語",
    cueStartMs: 11000,
    cueEndMs: 13000,
    units: [
      {
        displayStartUtf16: 0,
        displayEndUtf16: 1,
        confidence: 0.98,
        rects: [{ x: 400, y: 600, w: 40, h: 50 }],
      },
      {
        displayStartUtf16: 1,
        displayEndUtf16: 2,
        confidence: 0.97,
        rects: [{ x: 440, y: 600, w: 40, h: 50 }],
      },
      {
        displayStartUtf16: 2,
        displayEndUtf16: 3,
        confidence: 0.96,
        rects: [{ x: 480, y: 600, w: 40, h: 50 }],
      },
    ],
  });
};

I.requestBitmapSubtitleOcr();
assert.strictEqual(request.type, "bitmap-subtitle-ocr");
assert.strictEqual(request.mode, "decoded-subtitle");
assert.strictEqual(request.source.ffIndex, 5);
assert.deepStrictEqual(Array.from(request.languages), ["ja-JP"]);
assert.strictEqual(I.state.subtitle.text, "日本語");
assert.strictEqual(I.state.subtitleUnits.length, 3);
assert.strictEqual(I.state.subtitleUnits[1].displayStartUtf16, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(I.state.subtitleRect)), {
  x: 400,
  y: 600,
  w: 120,
  h: 50,
});

request = null;
I.state.subtitles = [];
I.requestBitmapSubtitleOcr();
assert.strictEqual(request, null, "a cached cue must not schedule native work");
assert.strictEqual(I.state.subtitle.text, "日本語");

I.platform = "linux";
I.state.subtitles = [];
I.ocrCache.values = Object.create(null);
I.requestBitmapSubtitleOcr();
assert.strictEqual(request, null, "non-Apple platforms must not schedule OCR");

let hoverAfterGeometry = 0;
I.handleHover = function () {
  hoverAfterGeometry++;
};
I.state.subtitles = [
  { surface: "primary", text: "日本語", ass: "", extradata: "" },
];
I.state.geometryKey = "";
I.state.geometryGeneration = 0;
I.state.osd = { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0 };
I.state.properties = {
  path: "/media/movie.mkv",
  "video-out-params": { w: 1920, h: 1080 },
  "sub-font": "sans-serif",
  "sub-font-size": 38,
  "sub-scale": 1,
  "sub-margin-x": 19,
  "sub-margin-y": 34,
  "sub-align-x": "center",
  "sub-align-y": "bottom",
  "sub-justify": "auto",
  "sub-use-margins": true,
  "sub-pos": 100,
  "sub-scale-by-window": true,
  "sub-scale-with-window": true,
  "track-list": [],
};
I.workerRequest = function (payload, callback) {
  assert.strictEqual(payload.type, "text-layout");
  assert.strictEqual(payload.renderer.width, 1280);
  assert.strictEqual(payload.renderer.height, 720);
  assert.strictEqual(payload.renderer.playResHeight, 720);
  assert.strictEqual(payload.renderer.alignment, 2);
  assert.strictEqual(payload.renderer.justify, 0);
  assert.strictEqual(payload.renderer.linePosition, 0);
  callback(null, {
    ok: true,
    positioned: true,
    width: 180,
    height: 56,
    clusters: [
      { x: 550, y: 620, width: 60, height: 56, utf16Range: [0, 1] },
      { x: 610, y: 620, width: 60, height: 56, utf16Range: [1, 2] },
      { x: 670, y: 620, width: 60, height: 56, utf16Range: [2, 3] },
    ],
  });
};
I.updateSubtitleGeometry();
assert.strictEqual(
  hoverAfterGeometry,
  1,
  "geometry completion must re-run hover lookup for a stationary pointer",
);
assert.strictEqual(I.state.subtitleUnits.length, 3);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(I.state.subtitleUnits[0].rects[0])),
  { x: 550, y: 620, w: 60, h: 56 },
  "positioned text-layout rectangles must not be repositioned in JavaScript",
);

I.state.properties["track-list"] = [{ id: 2, type: "sub", "ff-index": 4 }];
I.state.properties.sid = 2;
const authored = I.geometryRequestForSubtitle({
  surface: "primary",
  text: "日本語",
  ass: "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,日本語",
  extradata: "[Script Info]\nScriptType: v4.00+",
  start: 0,
  end: 1,
});
assert.strictEqual(authored.type, "ass-geometry");
assert.strictEqual(
  authored.renderer.linePosition,
  0,
  "mpv sub-pos=100 must map to libass's bottom-origin line position",
);

console.log("mpv bitmap OCR controller tests passed");
