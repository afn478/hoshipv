"use strict";

const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.resolve(__dirname, "../..");
const required = process.env.IINATAN_NATIVE_GAMEPAD_REQUIRED === "1";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readGamepads(window) {
  return window.webContents.executeJavaScript(
    `(() => {
    const values = typeof navigator.getGamepads === "function"
      ? [...(navigator.getGamepads() || [])].filter(Boolean)
      : [];
    return values.map((gamepad) => ({
      id: String(gamepad.id || "").slice(0, 240),
      index: Number.isInteger(gamepad.index) ? gamepad.index : 0,
      connected: gamepad.connected === true,
      mapping: String(gamepad.mapping || ""),
      buttons: Array.from(gamepad.buttons || []).length,
      axes: Array.from(gamepad.axes || []).length,
      pressed: Array.from(gamepad.buttons || []).some((button) => button?.pressed),
    }));
  })()`,
    true,
  );
}

async function waitForGamepad(window, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = await readGamepads(window);
    const connected = values.find((value) => value.connected);
    if (connected) return { values, connected };
    await delay(100);
  }
  return { values: await readGamepads(window), connected: null };
}

async function main() {
  if (process.platform !== "win32") {
    console.log("SKIP: Windows browser-gamepad smoke requires win32");
    return;
  }

  await app.whenReady();
  const controllerStates = [];
  const onHostRequest = (_event, message) => {
    if (
      message?.protocol === 1 &&
      message.type === "controller-state" &&
      message.payload?.source === "browser-gamepad"
    )
      controllerStates.push({
        connected: message.payload.connected === true,
        id: String(message.payload.id || "").slice(0, 240),
        index: Number.isInteger(message.payload.index) ? message.payload.index : 0,
        buttonCount: Array.isArray(message.payload.buttons)
          ? message.payload.buttons.length
          : 0,
        axisCount: Array.isArray(message.payload.axes)
          ? message.payload.axes.length
          : 0,
      });
  };
  ipcMain.on("host-request", onHostRequest);

  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(root, "app", "preload.js"),
    },
  });

  try {
    await window.loadFile(path.join(root, "app", "overlay.html"), {
      query: { surface: "highlight" },
    });
    window.show();
    window.focus();
    const observed = await waitForGamepad(window, 8000);
    await delay(250);
    const rendererState = controllerStates.find((value) => value.connected) || null;
    const report = {
      ok: !!observed.connected && !!rendererState,
      renderer: {
        ready: controllerStates.length > 0,
        connected: rendererState,
        last: controllerStates.at(-1) || null,
      },
      navigator: observed,
      mode: "windows-browser-gamepad-smoke",
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok && required)
      throw new Error(
        `no connected Windows browser gamepad was observed: ${JSON.stringify(report)}`,
      );
  } finally {
    ipcMain.removeListener("host-request", onHostRequest);
    if (!window.isDestroyed()) window.destroy();
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(`WINDOWS GAMEPAD SMOKE FAILED: ${error.message}`);
  if (app.isReady()) app.exit(1);
  else process.exitCode = 1;
});
