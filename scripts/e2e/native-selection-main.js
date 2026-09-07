"use strict";

const fs = require("node:fs/promises");
const { app, BrowserWindow } = require("electron");

const argumentValue = (name) => {
  const prefix = `${name}=`;
  return String(
    process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "",
  );
};

const readyPath = argumentValue("--ready-file");
const triggerPath = argumentValue("--trigger-file");
const resultPath = argumentValue("--result-file");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function run() {
  if (!readyPath || !triggerPath || !resultPath)
    throw new Error("--ready-file, --trigger-file, and --result-file are required");
  await app.whenReady();
  const passive = new BrowserWindow({
    x: 180,
    y: 180,
    width: 620,
    height: 260,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const window = new BrowserWindow({
    x: 180,
    y: 180,
    width: 620,
    height: 260,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await passive.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent("<body></body>")}`,
    );
    passive.setIgnoreMouseEvents(true, { forward: true });
    passive.showInactive();
    window.setIgnoreMouseEvents(false);
    const html = `<!doctype html>
      <meta charset="utf-8">
      <style>
        html, body { width: 100%; height: 100%; margin: 0; }
        body { display: grid; place-items: center; background: transparent; color: white; }
        #target { font: 32px -apple-system, sans-serif; user-select: text; }
      </style>
      <div id="target">native-selection-probe</div>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    window.show();
    window.focus();
    await delay(150);
    const geometry = await window.webContents.executeJavaScript(
      `(() => {
        const bounds = document.getElementById('target').getBoundingClientRect();
        return {
          devicePixelRatio: window.devicePixelRatio,
          target: {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
          },
        };
      })()`,
      true,
    );
    const bounds = window.getBounds();
    await writeJson(readyPath, {
      ok: true,
      pid: process.pid,
      bounds,
      geometry,
      mode: "native-selection-electron-ready",
    });
    while (!(await fileExists(triggerPath))) await delay(25);
    await delay(250);
    const selection = await window.webContents.executeJavaScript(
      "window.getSelection()?.toString() || ''",
      true,
    );
    await writeJson(resultPath, {
      ok: selection === "native-selection-probe",
      selection,
      bounds,
      geometry,
      mode: "native-selection-electron-result",
    });
  } finally {
    if (!window.isDestroyed()) window.close();
    if (!passive.isDestroyed()) passive.close();
    await app.quit();
  }
}

run().catch(async (error) => {
  await writeJson(resultPath, {
    ok: false,
    error: error.stack || error.message,
    mode: "native-selection-electron-result",
  }).catch(() => {});
  app.quit();
  process.exitCode = 1;
});
