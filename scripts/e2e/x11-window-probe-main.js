"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, BrowserWindow } = require("electron");

const execFileAsync = promisify(execFile);
const resultPath = String(
  process.argv.find((value) => value.startsWith("--result-file="))?.slice(14) || "",
);
const probePath = String(
  process.argv.find((value) => value.startsWith("--probe="))?.slice(8) || "",
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function probe(activate = false) {
  const result = await execFileAsync(
    probePath,
    ["--pid", String(process.pid), ...(activate ? ["--activate"] : [])],
    { timeout: 3000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const lines = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return JSON.parse(lines.at(-1) || "{}");
}

async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function run() {
  if (process.platform !== "linux")
    throw new Error("the X11 window probe smoke requires Linux");
  if (!resultPath) throw new Error("--result-file is required");
  if (!probePath) throw new Error("--probe is required");

  await app.whenReady();
  let window = null;
  try {
    window = new BrowserWindow({
      show: false,
      frame: false,
      width: 640,
      height: 360,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await window.loadURL(
      'data:text/html,<body style="background:#202020;color:white">X11 probe</body>',
    );
    window.setBounds({ x: 110, y: 140, width: 640, height: 360 });
    window.show();
    window.focus();

    const initial = await waitFor(async () => {
      const value = await probe();
      return value.ok === true && value.content ? value : null;
    }, "X11 window discovery");
    assert.equal(initial.backend, "linux-x11");
    assert.equal(initial.coordinateSpace, "desktop-physical");
    assert.equal(initial.contentExact, false);
    assert.equal(initial.windowId > 0, true);
    assert.equal(initial.content.width, 640);
    assert.equal(initial.content.height, 360);

    const activation = await probe(true);
    assert.equal(activation.activationRequested, true);
    const focused = await waitFor(async () => {
      const value = await probe();
      return value.isForeground === true ? value : null;
    }, "X11 foreground observation after activation");

    window.setBounds({ x: 180, y: 200, width: 700, height: 420 });
    const resized = await waitFor(async () => {
      const value = await probe();
      return value.content?.width === 700 && value.content?.height === 420
        ? value
        : null;
    }, "X11 geometry update after resize");
    assert.equal(resized.windowId, initial.windowId);
    assert.equal(
      resized.content.x !== initial.content.x ||
        resized.content.y !== initial.content.y,
      true,
    );

    const output = {
      ok: true,
      pid: process.pid,
      initial,
      activation,
      focused,
      resized,
      limitation:
        "This exercises the native X11 helper against a real Electron window; it is not stock-mpv or full companion-overlay evidence.",
      mode: "linux-x11-native-window-probe-smoke",
    };
    await fs.writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, {
      mode: 0o600,
    });
  } finally {
    if (window && !window.isDestroyed()) window.close();
    app.quit();
  }
}

run().catch(async (error) => {
  console.error(`X11 WINDOW PROBE SMOKE FAILED: ${error.stack || error.message}`);
  if (resultPath) {
    await fs
      .writeFile(
        resultPath,
        `${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`,
        { mode: 0o600 },
      )
      .catch(() => {});
  }
  process.exitCode = 1;
});
