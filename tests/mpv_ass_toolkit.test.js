const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
let externalWork = 0;
const context = {
  console,
  setTimeout,
  clearTimeout,
  isFinite,
  mp: {
    msg: { info() {}, error() {}, warn() {} },
    utils: {
      get_user_path(value) {
        return value;
      },
    },
    get_opt() {
      return undefined;
    },
  },
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, "src/mpv/00_runtime.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "src/mpv/40_ass.js"), "utf8"),
  context,
);

function assert(value, message) {
  if (!value) throw new Error(message);
}
const I = context.IINATAN;
const index = new I.SpatialIndex(50);
index.add(
  new I.HitRegion("back", { x: 0, y: 0, w: 100, h: 100 }, {}, "default", 1),
);
index.add(
  new I.HitRegion(
    "front-large",
    { x: 0, y: 0, w: 80, h: 80 },
    {},
    "default",
    2,
  ),
);
index.add(
  new I.HitRegion(
    "front-small",
    { x: 10, y: 10, w: 20, h: 20 },
    {},
    "default",
    2,
  ),
);
assert(
  index.hit(15, 15).id === "front-small",
  "hits must prefer reverse paint order then smallest rectangle",
);
assert(
  index.hit(90, 90).id === "back",
  "spatial cells must retain background hits",
);

I.config = {
  activeProfileId: "default",
  profiles: {
    default: {
      popupScale: 1,
      theme: {
        background: "000000",
        foreground: "ffffff",
        accent: "ffff00",
        muted: "aaaaaa",
        border: "555555",
      },
    },
  },
};
I.state.osd = { w: 1280, h: 720 };
I.workerRequest = function () {
  externalWork++;
};
const overlay = { update() {}, remove() {} };
const scene = new I.Scene(overlay);
scene.measure("漢A", { font: "Noto Sans", size: 20 }, 200);
assert(
  externalWork === 1,
  "cache miss should schedule one text-layout request",
);
scene.measure("漢A", { font: "Noto Sans", size: 20 }, 200);
assert(externalWork === 1, "identical pending measurement must coalesce");
index.hit(15, 15);
assert(externalWork === 1, "pointer hit testing must perform no external work");

const ass = new I.AssBuilder();
ass.rect(1, { x: 1, y: 2, w: 20, h: 10 }, "000000", "ffffff", 3);
ass.text(2, 4, 5, { font: "Noto Sans", size: 20, color: "ffffff" }, "{漢}\\x");
assert(
  /\\p1/.test(ass.build()) && /\\\{漢\\\}/.test(ass.build()),
  "ASS builder must emit vectors and escape text",
);
console.log("mpv ASS toolkit tests passed");
