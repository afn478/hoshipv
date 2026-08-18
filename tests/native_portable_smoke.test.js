const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend =
  process.env.IINATAN_BACKEND ||
  path.join(root, "build", "native", "release", "iinatan-backend");
const ffmpeg = process.env.IINATAN_FFMPEG || "ffmpeg";
assert.ok(fs.existsSync(backend), `backend is missing: ${backend}`);

function invoke(args) {
  return JSON.parse(execFileSync(backend, args, { encoding: "utf8" }).trim());
}

const version = invoke(["version"]);
assert.strictEqual(version.ok, true);
assert.strictEqual(version.lookupProtocol, 1);
assert.strictEqual(version.geometryProtocol, 1);
assert.strictEqual(version.textLayoutProtocol, 1);
assert.strictEqual(version.http.available, true);
assert.strictEqual(version.audioPreview.available, true);
assert.ok(["macos", "linux", "windows"].includes(version.target.split("-")[0]));
if (!version.target.startsWith("macos-")) {
  assert.strictEqual(version.bitmapOcr.available, false);
  assert.strictEqual(version.bitmapOcr.provider, "unavailable");
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-native-"));
try {
  const fixture = path.join(temporary, "fixture");
  fs.mkdirSync(fixture);
  fs.writeFileSync(
    path.join(fixture, "index.json"),
    JSON.stringify({
      title: "Portable Fixture",
      format: 3,
      revision: "1",
      sequenced: true,
    }),
  );
  fs.writeFileSync(
    path.join(fixture, "term_bank_1.json"),
    JSON.stringify([["猫", "ねこ", "名詞", "", 0, ["cat"], 1, ""]]),
  );
  const zip = path.join(temporary, "fixture.zip");
  execFileSync("python3", [
    "-c",
    "import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:\n [z.write(p,p.name) for p in r.iterdir()]",
    fixture,
    zip,
  ]);
  const dictionaries = path.join(temporary, "dictionaries");
  const imported = invoke(["import-transaction", zip, dictionaries]);
  assert.strictEqual(imported.ok, true);
  assert.ok(fs.existsSync(path.join(imported.dictionary.path, "index.json")));
  const lookup = invoke([
    "lookup",
    imported.dictionary.path,
    "--mode",
    "exact",
    "--",
    "猫",
  ]);
  assert.strictEqual(lookup.ok, true);
  assert.strictEqual(lookup.lookupString, "猫");
  assert.ok(lookup.resultCount > 0);
  assert.strictEqual(lookup.results[0].term.expression, "猫");

  const traversal = path.join(temporary, "traversal.zip");
  execFileSync("python3", [
    "-c",
    "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('../index.json','{}')",
    traversal,
  ]);
  const unsafe = spawnSync(
    backend,
    ["import-transaction", traversal, dictionaries],
    { encoding: "utf8" },
  );
  assert.notStrictEqual(unsafe.status, 0);
  assert.match(unsafe.stdout + unsafe.stderr, /traversal|unsafe|absolute/);

  const layoutRequest = path.join(temporary, "layout.json");
  fs.writeFileSync(
    layoutRequest,
    JSON.stringify({
      type: "text-layout",
      protocol: 1,
      requestId: "portable-layout",
      text: "Á漢😀️한",
      font: { family: "sans-serif", size: 36 },
      wrapWidth: 600,
      osdScale: 1,
      fallbackFontPath: path.join(
        root,
        "assets",
        "fonts",
        "NotoSansCJKjp-Regular.otf",
      ),
    }),
  );
  const layout = invoke(["text-layout", layoutRequest]);
  assert.strictEqual(layout.ok, true);
  assert.ok(layout.clusters.length >= 4);
  assert.deepStrictEqual(layout.clusters[0].utf16Range, [0, 2]);
  assert.ok(layout.clusters.some((cluster) => cluster.utf16Range[1] >= 5));

  const audio = path.join(temporary, "tone.mp3");
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=0.2",
    "-y",
    audio,
  ]);
  const probe = invoke(["audio-probe", audio]);
  assert.strictEqual(probe.sampleRate, 48000);
  assert.strictEqual(probe.channels, 2);
  assert.ok(probe.frames >= 8000 && probe.frames <= 12000);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("portable native import/lookup/layout/audio smoke tests passed");
