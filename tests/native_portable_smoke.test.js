const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn, spawnSync } = require("child_process");

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
const unsafeOpen = spawnSync(backend, ["open-url", "javascript:alert(1)"], {
  encoding: "utf8",
});
assert.notStrictEqual(unsafeOpen.status, 0);
assert.match(unsafeOpen.stdout + unsafeOpen.stderr, /unsafe URL/);
if (!version.target.startsWith("macos-")) {
  assert.strictEqual(version.bitmapOcr.available, false);
  assert.match(version.bitmapOcr.provider, /^unavailable/);
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
  const collisionImport = invoke(["import-transaction", zip, dictionaries]);
  assert.strictEqual(collisionImport.ok, true);
  assert.notStrictEqual(collisionImport.dictionary.id, imported.dictionary.id);
  assert.match(collisionImport.dictionary.id, /-2$/);
  assert.ok(
    fs.existsSync(path.join(collisionImport.dictionary.path, "index.json")),
  );
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

  const httpRoot = path.join(temporary, "http");
  fs.mkdirSync(httpRoot);
  fs.writeFileSync(path.join(httpRoot, "small.json"), '{"hello":"world"}');
  fs.writeFileSync(path.join(httpRoot, "large.bin"), "x".repeat(4096));
  const portFile = path.join(temporary, "http-port");
  const server = spawn(
    "python3",
    [
      "-u",
      "-c",
      "import http.server,os,sys\nos.chdir(sys.argv[1])\nclass Q(http.server.SimpleHTTPRequestHandler):\n def log_message(self,*a):pass\ns=http.server.ThreadingHTTPServer(('127.0.0.1',0),Q)\nopen(sys.argv[2],'w').write(str(s.server_port))\ns.serve_forever()",
      httpRoot,
      portFile,
    ],
    { stdio: "ignore" },
  );
  try {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(portFile) && Date.now() < deadline)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    assert.ok(fs.existsSync(portFile));
    const port = fs.readFileSync(portFile, "utf8");
    const httpOutput = path.join(temporary, "http.json");
    invoke([
      "http",
      "--url",
      `http://127.0.0.1:${port}/small.json`,
      "--output",
      httpOutput,
      "--max-bytes",
      "1024",
    ]);
    const httpResult = JSON.parse(fs.readFileSync(httpOutput));
    assert.strictEqual(httpResult.status, 200);
    assert.strictEqual(httpResult.body, '{"hello":"world"}');
    const oversized = spawnSync(
      backend,
      [
        "http",
        "--url",
        `http://127.0.0.1:${port}/large.bin`,
        "--output",
        httpOutput,
        "--max-bytes",
        "128",
      ],
      { encoding: "utf8" },
    );
    assert.notStrictEqual(oversized.status, 0);
    assert.match(oversized.stdout + oversized.stderr, /size limit/);
  } finally {
    server.kill("SIGTERM");
  }

  const layoutRequest = path.join(temporary, "layout.json");
  fs.writeFileSync(
    layoutRequest,
    JSON.stringify({
      type: "text-layout",
      protocol: 1,
      requestId: "portable-layout",
      text: "Á漢😀️한Ａｱ葛󠄀",
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
  assert.ok(layout.clusters.length >= 7);
  assert.deepStrictEqual(layout.clusters[0].utf16Range, [0, 2]);
  assert.ok(layout.clusters.some((cluster) => cluster.utf16Range[1] >= 5));
  assert.ok(layout.clusters.some((cluster) => cluster.text === "Ａ"));
  assert.ok(layout.clusters.some((cluster) => cluster.text === "ｱ"));
  const variationCluster = layout.clusters.find((cluster) =>
    cluster.text.startsWith("葛"),
  );
  assert.ok(
    variationCluster &&
      variationCluster.utf16Range[1] - variationCluster.utf16Range[0] === 3,
    "supplementary variation selector must share its base cluster",
  );

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
  for (const format of ["mp3", "opus"]) {
    const slice = path.join(temporary, `slice.${format}`);
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-ss",
      "0.05",
      "-t",
      "0.1",
      "-i",
      audio,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-c:a",
      format === "opus" ? "libopus" : "libmp3lame",
      "-b:a",
      "64k",
      "-y",
      slice,
    ]);
    const sliced = invoke(["audio-probe", slice]);
    assert.ok(sliced.frames > 0, `${format} slicing remains decodable`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("portable native import/lookup/layout/audio smoke tests passed");
