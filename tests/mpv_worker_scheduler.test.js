const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const callbacks = [];
const published = [];
const context = {
  console,
  Date,
  Math,
  JSON,
  Error,
  isFinite,
  setTimeout,
  clearTimeout,
  mp: {
    msg: { info() {}, error() {}, warn() {} },
    utils: {
      get_user_path(value) {
        return value;
      },
      getpid() {
        return 1;
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
    fs.readFileSync(path.join(root, "src/mpv/30_worker.js"), "utf8"),
  context,
);
const I = context.IINATAN;
I.config = {
  activeProfileId: "default",
  global: { backendPath: "/backend" },
  dictionaries: [{ id: "d", path: "/d" }],
  profiles: {
    default: {
      dictionaries: ["d"],
      lookupLanguage: "ja",
      lookupTimeoutMs: 9000,
    },
  },
};

const startupEvents = [];
I.backendCommand = function (args, callback) {
  startupEvents.push(args[0]);
  callback(null);
};
I.writeText = function () {
  startupEvents.push("write-config");
};
I.subprocess = function () {
  startupEvents.push("spawn-worker");
  return 42;
};
I.startWorker(function () {});
assert(
  startupEvents.join(",") === "worker-prepare,write-config,spawn-worker",
  "worker storage must be prepared before config is written and the worker starts",
);

I.worker.processId = null;
let startupError = null;
let spawnedAfterWriteFailure = false;
I.writeText = function () {
  throw new Error("config write failed");
};
I.subprocess = function () {
  spawnedAfterWriteFailure = true;
};
I.startWorker(function (error) {
  startupError = error;
});
assert(
  startupError &&
    startupError.message === "config write failed" &&
    !spawnedAfterWriteFailure,
  "worker config write failures must reach the caller without spawning",
);

I.startWorker = function (callback) {
  callback(null);
};
I.publishRequest = function (id, payload) {
  published.push(payload.text || payload.type);
};
I.pollResponse = function () {};

function assert(value, message) {
  if (!value) throw new Error(message);
}
function payload(text) {
  return {
    text,
    scanLength: 24,
    maxResults: 3,
    maxGlossaries: 4,
    mode: "exact",
  };
}
I.lookup(payload("active"), function (error) {
  callbacks.push(["active", error]);
});
I.lookup(payload("superseded"), function (error) {
  callbacks.push(["superseded", error]);
});
I.lookup(payload("latest"), function (error) {
  callbacks.push(["latest", error]);
});
assert(
  published.length === 1 && published[0] === "active",
  "only one lookup may be active",
);
assert(
  I.worker.pending.payload.text === "latest",
  "only the latest hover lookup may remain pending",
);
assert(
  callbacks.length === 1 && callbacks[0][0] === "superseded",
  "replaced pending lookup must terminate",
);
I.worker.active = null;
I.runPendingLookup();
assert(
  published.length === 2 && published[1] === "latest",
  "latest pending lookup must run after active completion",
);
console.log("mpv worker scheduler tests passed");
