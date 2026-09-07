"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

function runChild(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function main() {
  if (process.platform !== "linux") {
    if (process.env.IINATAN_X11_REQUIRED === "1")
      throw new Error("the X11 native window probe smoke requires Linux");
    console.log("SKIP: X11 native window probe smoke requires Linux");
    return;
  }
  const probe = path.resolve(
    process.env.IINATAN_WINDOW_PROBE ||
      path.join(root, "build", "native", "iinatan-window-probe"),
  );
  try {
    await fs.access(probe);
  } catch (_) {
    if (process.env.IINATAN_X11_REQUIRED === "1")
      throw new Error(`native X11 window probe is unavailable: ${probe}`);
    console.log(`SKIP: build the X11 window probe (${probe})`);
    return;
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-x11-window-probe-"),
  );
  const resultPath = path.join(temporaryRoot, "result.json");
  try {
    const child = await runChild(process.execPath, [
      path.join(root, "scripts", "run-electron.js"),
      path.join(root, "scripts", "e2e", "x11-window-probe-main.js"),
      `--result-file=${resultPath}`,
      `--probe=${probe}`,
    ]);
    const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
    assert.equal(result.ok, true, result.error || child.stderr);
    assert.equal(result.mode, "linux-x11-native-window-probe-smoke");
    if (child.code !== 0)
      throw new Error(`Electron X11 probe exited with ${child.code}: ${child.stderr}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`X11 WINDOW PROBE SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
