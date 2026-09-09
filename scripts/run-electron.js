"use strict";

const { spawn } = require("node:child_process");

const electronPath = String(require("electron")).trim();
const electronArguments = process.argv.slice(2);
if (process.env.IINATAN_E2E_NO_SANDBOX === "1") {
  // Apple-hosted amd64 emulation can reject Chromium's zygote clone flags.
  // This is an explicit disposable-runner escape, never a production default.
  electronArguments.unshift("--no-sandbox");
}
if (process.env.IINATAN_E2E_DISABLE_GPU === "1") {
  // Native interaction smokes can run in a disposable software-composited
  // session when the host GPU context is unavailable or unstable.
  electronArguments.unshift("--disable-gpu");
}
const child = spawn(electronPath, electronArguments, {
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error(`[iinatan] Electron could not start: ${error.message}`);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (code === null) {
    console.error(`[iinatan] Electron exited with signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
