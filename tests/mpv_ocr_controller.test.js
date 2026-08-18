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

console.log("mpv bitmap OCR controller tests passed");
