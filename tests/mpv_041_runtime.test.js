const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const which = spawnSync("sh", ["-c", "command -v mpv"], { encoding: "utf8" });
if (which.status !== 0)
  throw new Error("mpv 0.41+ is required for runtime tests");
const mpv = which.stdout.trim();
const version = spawnSync(mpv, ["--version"], { encoding: "utf8" }).stdout;
const match = version.match(/mpv v(\d+)\.(\d+)/);
if (
  !match ||
  Number(match[1]) < 0 ||
  (Number(match[1]) === 0 && Number(match[2]) < 41)
)
  throw new Error("mpv 0.41+ is required");
const config = path.join(os.tmpdir(), "iinatan-mpv-runtime-config.json");
const run = spawnSync(
  mpv,
  [
    "--no-config",
    "--vo=null",
    "--ao=null",
    "--frames=1",
    "--script=" + path.join(root, "scripts/iinatan.js"),
    "--script-opts=iinatan-config=" + config,
    "--msg-level=iinatan=debug",
    "av://lavfi:color=c=black:s=320x180:d=0.1",
  ],
  { encoding: "utf8", timeout: 15000 },
);
const output = (run.stdout || "") + (run.stderr || "");
if (run.status !== 0 || !output.includes("native mpv runtime ready"))
  throw new Error(output || "mpv runtime smoke test failed");
if (
  /create_assdraw/.test(
    fs.readFileSync(path.join(root, "scripts/iinatan.js"), "utf8"),
  )
)
  throw new Error(
    "generated runtime must not call nonexistent mp.create_assdraw",
  );
console.log("mpv 0.41 runtime tests passed");
