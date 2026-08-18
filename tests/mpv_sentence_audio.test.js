const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const pendingNative = [];
const context = {
  console,
  Date,
  JSON,
  isFinite,
  encodeURIComponent,
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  mp: {
    msg: { info() {}, warn() {}, error() {} },
    get_opt() {
      return undefined;
    },
    command_native_async(command, callback) {
      pendingNative.push({ command, callback });
      return pendingNative.length;
    },
    abort_async_command() {},
    utils: {
      get_user_path(value) {
        return value.replace("~~cache", "/cache").replace("~~state", "/state");
      },
      file_info() {
        return { size: 1 };
      },
      read_file() {
        return "{}";
      },
      write_file() {},
    },
  },
};
vm.createContext(context);
for (const file of [
  "00_runtime.js",
  "05_config.js",
  "20_media.js",
  "70_services.js",
]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "src", "mpv", file), "utf8"),
    context,
    { filename: file },
  );
}
const I = context.IINATAN;
I.config = I.clone(I.DEFAULT_CONFIG);
I.config.global.ffmpegPath = "/tools/ffmpeg";
I.config.profiles.default.anki.audioFormat = "opus";
I.config.profiles.default.anki.audioBitrateKbps = 80;
I.config.profiles.default.anki.sentenceAudioPaddingMs = 250;
I.mediaGeneration = 4;
I.worker = { serial: 0 };
I.requestId = (() => {
  let id = 0;
  return () => `test-${++id}`;
})();
I.backendCommand = (args, callback) => {
  if (args[0] === "hash-media") {
    callback(null, {
      stdout: JSON.stringify({
        ok: true,
        name: "Episode_deadbeefcafe.opus",
        path: "/state/anki-media/Episode_deadbeefcafe.opus",
        sha256: "deadbeefcafe".padEnd(64, "0"),
      }),
    });
  } else callback(null, { stdout: '{"ok":true}' });
};
const subprocesses = [];
I.subprocess = (args, _options, callback) => {
  subprocesses.push(args);
  callback(null, { status: 0 });
  return `process-${subprocesses.length}`;
};

const externalContext = {
  generation: 4,
  source: {
    primary: "/video.mkv",
    audio: "/external.mka",
    title: "Episode",
  },
  subtitleStart: 10,
  subtitleEnd: 12,
  subtitleDelay: 0.5,
  timeFallback: 11,
};
let exported;
I.exportSentenceAudio(externalContext, (error, result) => {
  assert.ifError(error);
  exported = result;
});
assert.ok(exported);
const externalArgs = subprocesses[0];
assert.strictEqual(externalArgs[0], "/tools/ffmpeg");
assert.strictEqual(externalArgs[externalArgs.indexOf("-ss") + 1], "10.25");
assert.strictEqual(externalArgs[externalArgs.indexOf("-t") + 1], "2.5");
assert.strictEqual(
  externalArgs[externalArgs.indexOf("-i") + 1],
  "/external.mka",
);
assert.strictEqual(externalArgs[externalArgs.indexOf("-map") + 1], "0:a:0");
assert.ok(externalArgs.includes("-vn"));
assert.ok(externalArgs.includes("-sn"));
assert.ok(externalArgs.includes("-dn"));
assert.strictEqual(externalArgs[externalArgs.indexOf("-c:a") + 1], "libopus");

subprocesses.length = 0;
const localContext = {
  ...externalContext,
  source: { primary: "/video.mkv", audio: "/video.mkv", title: "Episode" },
};
I.exportSentenceAudio(localContext, (error) => assert.ifError(error));
assert.strictEqual(pendingNative.length, 1);
assert.strictEqual(pendingNative[0].command.name, "dump-cache");
assert.strictEqual(pendingNative[0].command.start, 10.25);
assert.strictEqual(pendingNative[0].command.end, 12.75);
pendingNative.shift().callback(true, {}, "");
assert.match(subprocesses[0][subprocesses[0].indexOf("-i") + 1], /\.mkv$/);
assert.strictEqual(
  subprocesses[0][subprocesses[0].indexOf("-ss") + 1],
  "10.25",
);

const fallback = I.sentenceAudioWindow(
  {
    subtitleStart: null,
    subtitleEnd: null,
    subtitleDelay: 99,
    timeFallback: 2,
  },
  250,
);
assert.strictEqual(fallback.start, 0.5);
assert.strictEqual(fallback.duration, 3);
const capped = I.sentenceAudioWindow(
  { subtitleStart: 1, subtitleEnd: 100, subtitleDelay: 0, timeFallback: 0 },
  0,
);
assert.strictEqual(capped.duration, 35);

let cancelled;
I.exportSentenceAudio(localContext, (error) => {
  cancelled = error;
});
I.mediaGeneration = 5;
pendingNative.shift().callback(false, {}, "aborted");
assert.match(cancelled.message, /cancelled/);

console.log("mpv sentence-audio scheduling tests passed");
