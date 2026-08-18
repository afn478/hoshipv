const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
  console,
  setTimeout,
  clearTimeout,
  isFinite,
  mp: {
    msg: { info() {}, error() {}, warn() {} },
    utils: {
      get_user_path(value) {
        return value.replace("~~home", "/config");
      },
      read_file() {
        throw new Error("missing");
      },
      write_file() {},
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
    fs.readFileSync(path.join(root, "src/mpv/05_config.js"), "utf8"),
  context,
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

const migrated = context.IINATAN.normalizeConfig({
  activeProfileId: "reader",
  profiles: {
    reader: {
      lookupLanguage: "de",
      hideNativeSubtitles: true,
      experimentalNativeSubtitleHitLayer: false,
      directWorkerIpc: false,
      customPopupCss: ".entry { color: red }",
      audioSourcesJson: '[{"url":"https://audio.example/{term}"}]',
      ankiEnabled: true,
      ankiDeckName: "Mining",
    },
  },
});
assert(migrated.schemaVersion === 2, "migration must produce schema v2");
assert(
  migrated.activeProfileId === "reader",
  "active profile must survive migration",
);
assert(
  migrated.profiles.reader.lookupLanguage === "de",
  "language must survive migration",
);
assert(
  !("hideNativeSubtitles" in migrated.profiles.reader),
  "native subtitles must remain owned by mpv",
);
assert(
  !("directWorkerIpc" in migrated.profiles.reader),
  "direct worker IPC is mandatory, not configurable",
);
assert(
  migrated.migration.archivedCustomCss.includes("color: red"),
  "legacy CSS must be archived",
);
assert(
  !("customPopupCss" in migrated.profiles.reader),
  "legacy CSS must never remain executable",
);
assert(
  migrated.profiles.reader.audio.sources.length === 1,
  "audio sources must migrate",
);
assert(
  migrated.profiles.reader.anki.enabled &&
    migrated.profiles.reader.anki.deck === "Mining",
  "Anki settings must migrate",
);

const invalidTheme = context.IINATAN.validateTheme({
  background: "url(x)",
  foreground: "#abcdef",
});
assert(
  invalidTheme.background === "181a20" && invalidTheme.foreground === "abcdef",
  "theme tokens must be constrained hex colors",
);
console.log("mpv config v2 tests passed");
