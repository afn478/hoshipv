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
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-browser-integration-"),
  );
  const resultPath = path.join(temporaryRoot, "result.json");
  try {
    const child = await runChild(process.execPath, [
      path.join(root, "scripts", "run-electron.js"),
      path.join(root, "scripts", "e2e", "browser-integration-main.js"),
      `--result-file=${resultPath}`,
    ]);
    const raw = await fs.readFile(resultPath, "utf8");
    const result = JSON.parse(raw);
    assert.equal(result.ok, true, result.error || child.stderr);
    if (child.code !== 0)
      throw new Error(
        `Electron browser integration exited with ${child.code}: ${child.stderr}`,
      );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`BROWSER INTEGRATION FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
