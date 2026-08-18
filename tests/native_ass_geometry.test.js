const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend =
  process.env.IINATAN_BACKEND ||
  path.join(root, "build", "native", "release", "iinatan-backend");
const fixture = path.join(
  root,
  "tests",
  "fixtures",
  "native_ass_geometry_multilingual.ass",
);
assert.ok(fs.existsSync(backend), `backend is missing: ${backend}`);

const source = fs.readFileSync(fixture, "utf8");
const extradata = source.slice(0, source.indexOf("Dialogue:"));

function eventAt(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const timestamp = `0:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.00`;
  const event = source
    .split(/\r?\n/)
    .find((line) => line.startsWith(`Dialogue: 0,${timestamp},`));
  assert.ok(event, `missing authored event at ${timestamp}`);
  return event;
}

function unicodeUnits(text) {
  let utf16 = 0;
  return Array.from(text).map((scalar, position) => {
    const start = utf16;
    utf16 += scalar.length;
    return {
      position,
      displayStartUtf16: start,
      displayEndUtf16: utf16,
    };
  });
}

function measure(text, startMs, units) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-ass-"));
  const requestPath = path.join(temporary, "request.json");
  const request = {
    type: "ass-geometry",
    protocol: 1,
    requestId: `authored-${startMs}`,
    source: { path: fixture, ffIndex: 0, external: true },
    cue: {
      timeMs: startMs + 500,
      startMs,
      endMs: startMs + 2000,
      assExtradata: extradata,
      assFull: eventAt(startMs),
      observedAss: text,
    },
    units: units.map(([position, start, end]) => ({
      position,
      displayStartUtf16: start,
      displayEndUtf16: end,
    })),
    renderer: {
      width: 1280,
      height: 720,
      storageWidth: 1280,
      storageHeight: 720,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      pixelAspect: 1,
      fontScale: 1,
      lineSpacing: 0,
      forceMargins: false,
      embeddedFonts: true,
      useStorageSize: true,
      overrideMode: "yes",
      defaultFamily: "sans-serif",
      fontProvider: "auto",
      assJustify: false,
      linePosition: 100,
      hinting: "none",
      shaper: "complex",
    },
  };
  try {
    fs.writeFileSync(requestPath, JSON.stringify(request));
    return JSON.parse(
      execFileSync(backend, ["ass-geometry", requestPath], {
        encoding: "utf8",
      }),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

for (const [text, startMs, units] of [
  [
    "A careful reader",
    1000,
    [
      [0, 0, 1],
      [2, 2, 9],
      [10, 10, 16],
    ],
  ],
  [
    "Ça fonctionne très bien",
    4000,
    [
      [0, 0, 2],
      [3, 3, 13],
      [14, 14, 18],
      [19, 19, 23],
    ],
  ],
  [
    "Grüße aus Berlin",
    7000,
    [
      [0, 0, 5],
      [6, 6, 9],
      [10, 10, 16],
    ],
  ],
  [
    "日本語辞書",
    10000,
    unicodeUnits("日本語辞書").map((unit) => [
      unit.position,
      unit.displayStartUtf16,
      unit.displayEndUtf16,
    ]),
  ],
  [
    "这是中文测试",
    13000,
    unicodeUnits("这是中文测试").map((unit) => [
      unit.position,
      unit.displayStartUtf16,
      unit.displayEndUtf16,
    ]),
  ],
  [
    "한국어 사전",
    16000,
    [
      [0, 0, 3],
      [4, 4, 6],
    ],
  ],
]) {
  const response = measure(text, startMs, units);
  assert.strictEqual(
    response.ok,
    true,
    `${text}: geometry request failed: ${JSON.stringify(response)}`,
  );
  assert.strictEqual(response.protocol, 1);
  assert.strictEqual(response.units.length, units.length);
  const visible = response.units.filter((unit) => unit.rects.length);
  assert.strictEqual(visible.length, units.length);
  for (const unit of visible) {
    assert.ok(
      unit.rects.every(
        (rect) =>
          Number.isFinite(rect.x) &&
          Number.isFinite(rect.y) &&
          rect.w > 0 &&
          rect.h > 0 &&
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.w <= 1280 &&
          rect.y + rect.h <= 720,
      ),
      `${text}: unit rectangles must be bounded and positive`,
    );
  }
}

console.log("portable authored ASS geometry tests passed");
