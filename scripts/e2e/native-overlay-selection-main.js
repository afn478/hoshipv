"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "../..");

function argumentValue(name) {
  const prefix = `${name}=`;
  return String(
    process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "",
  );
}

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

function popupPayload() {
  return {
    visible: true,
    position: { x: 100, y: 30 },
    width: 420,
    maxHeight: 190,
    popupMinWidth: 250,
    popupMaxWidth: 440,
    popupScale: 1,
    fontScale: 1,
    theme: "inherit",
    customCss: "",
    audioSources: [],
    audioAutoPlay: false,
    anki: { enabled: false, configured: false },
    result: {
      lookupString: "native-selection-probe",
      matched: "native-selection-probe",
      entries: [
        {
          id: "native-selection-entry",
          headword: "native-selection-probe",
          reading: "",
          tags: [],
          frequency: [],
          glossaries: [
            {
              dictionary: "native selection fixture",
              tags: [],
              content: [
                { type: "paragraph", text: "A selectable overlay definition." },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function run() {
  if (!readyPath || !triggerPath || !resultPath)
    throw new Error("--ready-file, --trigger-file, and --result-file are required");
  await app.whenReady();
  const options = {
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
      preload: path.join(root, "app", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
  const passive = new BrowserWindow(options);
  const popup = new BrowserWindow(options);
  try {
    await passive.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent("<body></body>")}`,
    );
    await popup.loadURL(
      `${pathToFileURL(path.join(root, "app", "overlay.html")).href}?surface=popup`,
    );
    await delay(300);
    passive.setIgnoreMouseEvents(true, { forward: true });
    passive.showInactive();
    popup.setIgnoreMouseEvents(false);
    popup.show();
    popup.focus();
    popup.webContents.send("host-event", {
      protocol: 1,
      type: "popup-state",
      geometryGeneration: 1,
      payload: popupPayload(),
    });
    let geometry;
    for (let attempt = 0; attempt < 40; attempt++) {
      geometry = await popup.webContents.executeJavaScript(
        `(() => {
          const headword = document.getElementById('popup-headword');
          const bounds = headword.getBoundingClientRect();
          return {
            visible: !document.getElementById('popup-panel').hidden,
            text: headword.textContent,
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
      if (
        geometry.visible &&
        geometry.text &&
        geometry.target.right > geometry.target.left
      )
        break;
      await delay(25);
    }
    const bounds = popup.getBounds();
    await writeJson(readyPath, {
      ok: true,
      pid: process.pid,
      bounds,
      geometry,
      mode: "native-overlay-selection-ready",
    });
    while (!(await fileExists(triggerPath))) await delay(25);
    await delay(250);
    const selection = await popup.webContents.executeJavaScript(
      "window.getSelection()?.toString() || ''",
      true,
    );
    await writeJson(resultPath, {
      ok: selection === "native-selection-probe",
      selection,
      bounds,
      geometry,
      mode: "native-overlay-selection-result",
    });
  } finally {
    if (!popup.isDestroyed()) popup.close();
    if (!passive.isDestroyed()) passive.close();
    await app.quit();
  }
}

run().catch(async (error) => {
  await writeJson(resultPath, {
    ok: false,
    error: error.stack || error.message,
    mode: "native-overlay-selection-result",
  }).catch(() => {});
  app.quit();
  process.exitCode = 1;
});
