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
  if (process.platform !== "win32") {
    if (process.env.IINATAN_WINDOWS_REQUIRED === "1")
      throw new Error("the Windows native window probe smoke requires Windows");
    console.log("SKIP: Windows native window probe smoke requires Windows");
    return;
  }
  const candidates = [
    process.env.IINATAN_WINDOW_PROBE,
    path.join(root, "build", "native", "Release", "iinatan-window-probe.exe"),
    path.join(root, "build", "native", "iinatan-window-probe.exe"),
  ].filter(Boolean);
  let probe = null;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      probe = path.resolve(candidate);
      break;
    } catch (_) {}
  }
  if (!probe) {
    if (process.env.IINATAN_WINDOWS_REQUIRED === "1")
      throw new Error(
        `native Windows window probe is unavailable: ${path.resolve(candidates[0])}`,
      );
    console.log(
      `SKIP: build the Windows window probe (${path.resolve(candidates[0])})`,
    );
    return;
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-windows-window-probe-"),
  );
  const resultPath = path.join(temporaryRoot, "result.json");
  try {
    const child = await runChild(process.execPath, [
      path.join(root, "scripts", "run-electron.js"),
      path.join(root, "scripts", "e2e", "windows-window-probe-main.js"),
      `--result-file=${resultPath}`,
      `--probe=${probe}`,
    ]);
    const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
    assert.equal(result.ok, true, result.error || child.stderr);
    assert.equal(result.mode, "windows-native-window-probe-smoke");
    if (child.code !== 0)
      throw new Error(
        `Electron Windows probe exited with ${child.code}: ${child.stderr}`,
      );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`WINDOWS WINDOW PROBE SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
