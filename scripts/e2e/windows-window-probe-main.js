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

async function disableTransitions(windowId) {
  const result = await execFileAsync(
    probePath,
    ["--window-id", String(windowId), "--disable-transitions"],
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

function expectedPhysicalSize(bounds, desktopScale) {
  return {
    width: Math.round(Number(bounds.width) * desktopScale),
    height: Math.round(Number(bounds.height) * desktopScale),
  };
}

function assertPhysicalSize(value, expected, label) {
  assert.ok(
    Math.abs(Number(value.width) - expected.width) <= 2,
    `${label} width ${value.width} did not match ${expected.width}`,
  );
  assert.ok(
    Math.abs(Number(value.height) - expected.height) <= 2,
    `${label} height ${value.height} did not match ${expected.height}`,
  );
}

async function run() {
  if (process.platform !== "win32")
    throw new Error("the Windows window probe smoke requires Windows");
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
      'data:text/html,<body style="background:#202020;color:white">Win32 probe</body>',
    );
    window.setBounds({ x: 110, y: 140, width: 640, height: 360 });
    window.show();
    window.focus();

    const initial = await waitFor(async () => {
      const value = await probe();
      return value.ok === true && value.content ? value : null;
    }, "Win32 window discovery");
    assert.equal(initial.backend, "windows");
    assert.equal(initial.coordinateSpace, "desktop-physical");
    assert.equal(initial.contentExact, true);
    assert.ok(Number(initial.windowId) > 0);
    assert.ok(Number(initial.dpi) > 0);
    assert.ok(Number(initial.desktopScale) > 0);
    assertPhysicalSize(
      initial.content,
      expectedPhysicalSize(window.getContentBounds(), initial.desktopScale),
      "initial client area",
    );
    const transitions = await disableTransitions(initial.windowId);
    assert.equal(transitions.ok, true);
    assert.equal(transitions.backend, "windows");
    assert.equal(transitions.transitionsDisabled, true);
    assert.equal(transitions.transitionsVerified, true, JSON.stringify(transitions));

    const activation = await probe(true);
    assert.equal(activation.activationRequested, true);
    const focused = await waitFor(async () => {
      const value = await probe();
      return value.isForeground === true ? value : null;
    }, "Win32 foreground observation after activation");

    window.setBounds({ x: 180, y: 200, width: 700, height: 420 });
    const resized = await waitFor(async () => {
      const value = await probe();
      const expected = expectedPhysicalSize(
        window.getContentBounds(),
        value.desktopScale,
      );
      return value.content &&
        Math.abs(value.content.width - expected.width) <= 2 &&
        Math.abs(value.content.height - expected.height) <= 2
        ? value
        : null;
    }, "Win32 geometry update after resize");
    assert.equal(resized.windowId, initial.windowId);
    assert.ok(
      resized.content.x !== initial.content.x ||
        resized.content.y !== initial.content.y,
      "Win32 client origin did not move",
    );

    const output = {
      ok: true,
      pid: process.pid,
      initial,
      transitions,
      activation,
      focused,
      resized,
      limitation:
        "This exercises the native Win32 helper against a real Electron window; it is not stock-mpv or full companion-overlay evidence.",
      mode: "windows-native-window-probe-smoke",
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
  console.error(`WINDOWS WINDOW PROBE SMOKE FAILED: ${error.stack || error.message}`);
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
