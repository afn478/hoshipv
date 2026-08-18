const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const runtime = path.join(root, "scripts", "iinatan.js");
new vm.Script(fs.readFileSync(runtime, "utf8"), { filename: runtime });

const generated = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "build_mpv.js"), "--check"],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0)
  throw new Error(generated.stderr || generated.stdout || "stale mpv runtime");

const source = fs.readFileSync(runtime, "utf8");
for (const forbidden of [
  /^\s*const\s/gm,
  /^\s*let\s/gm,
  /=>/,
  /^\s*class\s+/gm,
  /\?\./,
  /\?\?/,
  /mp\.create_assdraw/,
]) {
  if (forbidden.test(source))
    throw new Error(`generated MuJS runtime contains ${forbidden}`);
}

console.log("generated ES5 runtime syntax checks passed");
