"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const {
  ACTIONS: CONTROLLER_ACTIONS,
  BUTTONS: CONTROLLER_BUTTONS,
  DEFAULTS: CONTROLLER_DEFAULTS,
} = require("../../src/interaction/controller-bindings");

const root = path.resolve(__dirname, "../..");
const resultPath = String(
  process.argv.find((value) => value.startsWith("--result-file="))?.slice(14) || "",
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    await delay(25);
  }
  throw new Error(
    `timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function createState() {
  return {
    activeProfileId: "default",
    profiles: [
      {
        id: "default",
        name: "Default",
        preferences: {
          lookupLanguage: "ja",
          scanLength: 12,
          maxEntries: 8,
          maxGlossesPerEntry: 6,
          lookupTimeoutMs: 9000,
          hoverRequestTimeoutMs: 15000,
          subtitlePollMs: 120,
          flattenSubtitleLineBreaks: false,
          pauseWhilePopupVisible: true,
          popupTheme: "inherit",
          popupMinWidth: 250,
          popupMaxWidth: 440,
          backendTimeoutMs: 30000,
          directIpcPollMs: 2,
          workerIdleSleepMs: 2,
          customPopupCss: "",
          audioAutoPlay: false,
          ankiEnabled: true,
          ankiConnectUrl: "http://127.0.0.1:8765",
          ankiConnectTimeoutSeconds: 3,
          controllerEnabled: false,
          controllerNoPopupBindingsJson: JSON.stringify(CONTROLLER_DEFAULTS.noPopup),
          controllerPopupBindingsJson: JSON.stringify(CONTROLLER_DEFAULTS.popup),
          controllerAudioBindingsJson: JSON.stringify(CONTROLLER_DEFAULTS.audio),
        },
      },
    ],
    global: { importTimeoutMs: 120000 },
    controllerBindings: {
      buttons: CONTROLLER_BUTTONS,
      actions: CONTROLLER_ACTIONS,
      defaults: CONTROLLER_DEFAULTS,
    },
    dictionaries: [
      {
        id: "fixture-dictionary",
        title: "Fixture dictionary",
        path: "/private/fixture/dictionary",
        enabled: true,
      },
    ],
    recommendedDictionaries: [
      {
        id: "fixture-recommended",
        title: "Fixture recommended",
        category: "Terms",
        description: "A deterministic recommended dictionary fixture.",
        installed: false,
      },
    ],
    diagnostics: {
      protocol: 1,
      runtime: {
        platform: "test",
        architecture: "x64",
        electron: "fixture",
        displaySession: "x11",
      },
      player: {
        backend: "stock-mpv-json-ipc",
        nativeSubtitles: "mpv",
        activeSessions: 1,
      },
      dictionary: {
        backend: "demo",
        installed: 1,
        enabled: 1,
      },
      window: {
        backend: "x11-or-xwayland",
        supported: true,
      },
      subtitleGeometry: {
        nativeHelper: "unavailable",
        exactSessionCount: 0,
        evidenceBoundary:
          "Settings diagnostics do not prove stock-mpv glyph geometry, compositor placement, or native input.",
      },
      sessions: [
        {
          sessionId: "fixture-session",
          foreground: true,
          geometry: {
            available: true,
            contentExact: false,
            nativeSubtitleGeometry: false,
            subtitleSource: {
              mode: "plain-text-approximation",
              exact: false,
              reason:
                "stock mpv does not expose per-grapheme libass layout; native geometry provider has not supplied an oracle",
            },
            nativeGeometryError: {
              code: "NATIVE_GEOMETRY_INPUT_UNSUPPORTED",
              message: "unsupported ASS tag",
            },
          },
        },
      ],
    },
  };
}

function createWindow() {
  return new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: {
      preload: path.join(root, "app", "settings-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    title: "iinatan settings integration",
  });
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function run() {
  if (!resultPath) throw new Error("--result-file is required");
  await app.whenReady();

  const state = createState();
  const requests = [];
  const handleRequest = async (_event, raw) => {
    assert.equal(raw?.protocol, 1);
    assert.equal(typeof raw?.type, "string");
    assert.ok(raw.payload && typeof raw.payload === "object");
    requests.push(raw);
    switch (raw.type) {
      case "get-state":
        return { state };
      case "save-profile": {
        const profile = state.profiles.find(
          (item) => item.id === raw.payload.profileId,
        );
        assert.ok(profile, "save target profile should exist");
        profile.name = String(raw.payload.name || profile.name);
        profile.preferences = { ...raw.payload.preferences };
        state.global = { ...raw.payload.global };
        return { state };
      }
      case "set-active-profile": {
        const profile = state.profiles.find(
          (item) => item.id === raw.payload.profileId,
        );
        assert.ok(profile, "active profile should exist");
        state.activeProfileId = profile.id;
        return { state };
      }
      case "create-profile": {
        const id = String(raw.payload.id || "").trim();
        assert.match(id, /^[a-z0-9][a-z0-9_-]{0,79}$/);
        assert.ok(!state.profiles.some((item) => item.id === id));
        const source = state.profiles.find((item) => item.id === "default");
        state.profiles.push({
          id,
          name: String(raw.payload.name || id),
          preferences: { ...source.preferences },
        });
        state.activeProfileId = id;
        return { state };
      }
      case "delete-profile": {
        assert.notEqual(raw.payload.profileId, "default");
        const index = state.profiles.findIndex(
          (item) => item.id === raw.payload.profileId,
        );
        assert.notEqual(index, -1);
        state.profiles.splice(index, 1);
        state.activeProfileId = "default";
        return { state };
      }
      case "reset-profile": {
        const profile = state.profiles.find(
          (item) => item.id === raw.payload.profileId,
        );
        assert.ok(profile, "reset target profile should exist");
        profile.preferences = {
          ...profile.preferences,
          scanLength: 12,
          lookupTimeoutMs: 9000,
        };
        return { state };
      }
      case "set-dictionary-enabled": {
        const entry = state.dictionaries.find((item) => item.id === raw.payload.id);
        assert.ok(entry, "dictionary target should exist");
        entry.enabled = raw.payload.enabled === true;
        return { state };
      }
      case "download-recommended": {
        assert.equal(raw.payload.id, "fixture-recommended");
        state.recommendedDictionaries[0].installed = true;
        return { state };
      }
      default:
        throw new Error(`unexpected settings request: ${raw.type}`);
    }
  };
  ipcMain.handle("settings-request", handleRequest);

  const settings = createWindow();
  try {
    await settings.loadFile(path.join(root, "app", "settings.html"));
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.getElementById('active-profile').value",
        )) === "default",
      "settings document readiness",
    );

    const initial = await evaluate(
      settings,
      `(() => ({
        title: document.title,
        activeProfile: document.getElementById('active-profile').value,
        language: document.querySelector('[data-pref="lookupLanguage"]').value,
        lookupTimeoutMs: document.querySelector('[data-pref="lookupTimeoutMs"]').value,
        hoverRequestTimeoutMs: document.querySelector('[data-pref="hoverRequestTimeoutMs"]').value,
        subtitlePollMs: document.querySelector('[data-pref="subtitlePollMs"]').value,
        flattenSubtitleLineBreaks: document.querySelector('[data-pref="flattenSubtitleLineBreaks"]').checked,
        popupMinWidth: document.querySelector('[data-pref="popupMinWidth"]').value,
        backendTimeoutMs: document.querySelector('[data-pref="backendTimeoutMs"]').value,
        directIpcPollMs: document.querySelector('[data-pref="directIpcPollMs"]').value,
        workerIdleSleepMs: document.querySelector('[data-pref="workerIdleSleepMs"]').value,
        dictionaries: document.querySelectorAll('#dictionary-list .dictionary-row').length,
        dictionaryTitle: document.querySelector('#dictionary-list .dictionary-row strong')?.textContent,
        recommended: document.querySelectorAll('#recommended-list .dictionary-row').length,
        recommendedTitle: document.querySelector('#recommended-list strong')?.textContent,
        diagnosticsRuntime: document.querySelector('#diagnostics-list dd')?.textContent,
        diagnosticsText: document.querySelector('#diagnostics-sessions')?.textContent,
        diagnosticsBoundary: document.querySelector('#diagnostics-note')?.textContent,
        controllerContexts: document.querySelectorAll('.controller-context').length,
        controllerRows: document.querySelectorAll('.controller-binding-table tbody tr').length,
        noPopupCross: document.querySelector('[data-controller-context="noPopup"][data-controller-button="primary"]')?.value,
        popupCross: document.querySelector('[data-controller-context="popup"][data-controller-button="primary"]')?.value,
        audioCross: document.querySelector('[data-controller-context="audio"][data-controller-button="primary"]')?.value,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
      }))()`,
    );
    assert.equal(initial.title, "iinatan settings");
    assert.equal(initial.activeProfile, "default");
    assert.equal(initial.language, "ja");
    assert.equal(initial.lookupTimeoutMs, "9000");
    assert.equal(initial.hoverRequestTimeoutMs, "15000");
    assert.equal(initial.subtitlePollMs, "120");
    assert.equal(initial.flattenSubtitleLineBreaks, false);
    assert.equal(initial.popupMinWidth, "250");
    assert.equal(initial.backendTimeoutMs, "30000");
    assert.equal(initial.directIpcPollMs, "2");
    assert.equal(initial.workerIdleSleepMs, "2");
    assert.equal(initial.dictionaries, 1);
    assert.equal(initial.dictionaryTitle, "Fixture dictionary");
    assert.equal(initial.recommended, 1);
    assert.equal(initial.recommendedTitle, "Fixture recommended");
    assert.equal(initial.controllerContexts, 3);
    assert.equal(initial.controllerRows, CONTROLLER_BUTTONS.length * 3);
    assert.equal(initial.noPopupCross, CONTROLLER_DEFAULTS.noPopup.primary);
    assert.equal(initial.popupCross, CONTROLLER_DEFAULTS.popup.primary);
    assert.equal(initial.audioCross, CONTROLLER_DEFAULTS.audio.primary);
    assert.match(initial.diagnosticsRuntime, /test x64/);
    assert.match(initial.diagnosticsText, /fixture-session/);
    assert.match(initial.diagnosticsText, /reconstructed geometry/);
    assert.match(initial.diagnosticsText, /plain-text-approximation/);
    assert.match(initial.diagnosticsText, /stock mpv does not expose per-grapheme/);
    assert.match(initial.diagnosticsText, /NATIVE_GEOMETRY_INPUT_UNSUPPORTED/);
    assert.match(initial.diagnosticsText, /unsupported ASS tag/);
    assert.doesNotMatch(initial.diagnosticsText, /private\/fixture/);
    assert.match(initial.diagnosticsBoundary, /do not prove stock-mpv glyph geometry/);
    assert.match(initial.csp, /default-src 'self'/);
    assert.doesNotMatch(initial.csp, /connect-src\s+\*/);

    await evaluate(
      settings,
      `(() => {
        const popupCross = document.querySelector('[data-controller-context="popup"][data-controller-button="primary"]');
        popupCross.value = 'close-popup';
        popupCross.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('[data-controller-reset="audio"]').click();
        const input = document.querySelector('[data-pref="scanLength"]');
        input.value = '18';
        document.querySelector('[data-pref="lookupTimeoutMs"]').value = '12000';
        document.querySelector('[data-pref="flattenSubtitleLineBreaks"]').checked = true;
        document.querySelector('[data-pref="popupMinWidth"]').value = '320';
        document.querySelector('[data-pref="workerIdleSleepMs"]').value = '8';
        document.getElementById('profile-name').value = 'Renamed default';
        document.getElementById('save').click();
      })()`,
    );
    await waitFor(
      () => requests.some((request) => request.type === "save-profile"),
      "profile save request",
    );
    const saveRequest = requests.find((request) => request.type === "save-profile");
    assert.equal(saveRequest.payload.preferences.scanLength, "18");
    assert.equal(saveRequest.payload.preferences.lookupTimeoutMs, "12000");
    assert.equal(saveRequest.payload.preferences.flattenSubtitleLineBreaks, true);
    assert.equal(saveRequest.payload.preferences.popupMinWidth, "320");
    assert.equal(saveRequest.payload.preferences.workerIdleSleepMs, "8");
    assert.equal(
      JSON.parse(saveRequest.payload.preferences.controllerPopupBindingsJson).primary,
      "close-popup",
    );
    assert.equal(
      JSON.parse(saveRequest.payload.preferences.controllerAudioBindingsJson).primary,
      CONTROLLER_DEFAULTS.audio.primary,
    );
    assert.equal(state.profiles[0].preferences.scanLength, "18");
    assert.equal(state.profiles[0].preferences.lookupTimeoutMs, "12000");
    assert.equal(state.profiles[0].preferences.flattenSubtitleLineBreaks, true);
    assert.equal(state.profiles[0].preferences.popupMinWidth, "320");
    assert.equal(state.profiles[0].preferences.workerIdleSleepMs, "8");
    assert.equal(state.profiles[0].name, "Renamed default");

    await evaluate(
      settings,
      `(() => {
        document.getElementById('new-profile-id').value = 'review';
        document.getElementById('new-profile-name').value = 'Review';
        document.getElementById('create-profile').click();
      })()`,
    );
    await waitFor(
      () => state.activeProfileId === "review",
      "created profile activation",
    );
    assert.ok(requests.some((request) => request.type === "create-profile"));
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.getElementById('active-profile').value",
        )) === "review",
      "created profile rendering",
    );

    await evaluate(
      settings,
      `(() => {
        const selector = document.getElementById('active-profile');
        selector.value = 'default';
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
    await waitFor(() => state.activeProfileId === "default", "profile switch");
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.getElementById('active-profile').value",
        )) === "default",
      "profile switch rendering",
    );
    assert.ok(requests.some((request) => request.type === "set-active-profile"));

    await evaluate(
      settings,
      `(() => {
        const selector = document.getElementById('active-profile');
        selector.value = 'review';
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
    await waitFor(
      () => state.activeProfileId === "review",
      "profile reactivation before delete",
    );
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.getElementById('active-profile').value",
        )) === "review",
      "profile reactivation rendering",
    );
    await evaluate(
      settings,
      `(() => {
        document.querySelector('[data-pref="scanLength"]').value = '99';
        document.getElementById('reset-profile').click();
      })()`,
    );
    await waitFor(
      () => requests.some((request) => request.type === "reset-profile"),
      "profile reset",
    );
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.querySelector('[data-pref=\\\"scanLength\\\"]').value",
        )) === "12",
      "profile reset rendering",
    );
    await evaluate(settings, "document.getElementById('delete-profile').click()");
    await waitFor(() => state.activeProfileId === "default", "profile deletion");
    assert.ok(requests.some((request) => request.type === "delete-profile"));

    await evaluate(
      settings,
      `(() => {
        const button = [...document.querySelectorAll('.dictionary-row button')]
          .find((item) => item.textContent === 'Disable');
        if (!button) throw new Error('dictionary disable button missing');
        button.click();
      })()`,
    );
    await waitFor(
      () => requests.some((request) => request.type === "set-dictionary-enabled"),
      "dictionary toggle request",
    );
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.querySelector('.dictionary-row .state')?.textContent",
        )) === "disabled",
      "dictionary state refresh",
    );
    assert.equal(state.dictionaries[0].enabled, false);

    await evaluate(
      settings,
      `(() => {
        const button = [...document.querySelectorAll('#recommended-list button')]
          .find((item) => item.textContent === 'Download');
        if (!button) throw new Error('recommended download button missing');
        button.click();
      })()`,
    );
    await waitFor(
      () => requests.some((request) => request.type === "download-recommended"),
      "recommended dictionary request",
    );
    await waitFor(
      async () =>
        (await evaluate(
          settings,
          "document.querySelector('#recommended-list button')?.textContent",
        )) === "Update",
      "recommended dictionary refresh state",
    );
    assert.equal(state.recommendedDictionaries[0].installed, true);

    const rejectedUnknownRequest = await evaluate(
      settings,
      `window.iinatanSettings.request('not-allowed', {}).then(() => false).catch(() => true)`,
    );
    assert.equal(rejectedUnknownRequest, true);

    const result = {
      ok: true,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      requestTypes: [...new Set(requests.map((request) => request.type))].sort(),
      initial,
      savedScanLength: state.profiles[0].preferences.scanLength,
      dictionaryEnabled: state.dictionaries[0].enabled,
      rejectedUnknownRequest,
      mode: "real-electron-settings-integration",
    };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
  } finally {
    ipcMain.removeHandler("settings-request");
    if (!settings.isDestroyed()) settings.close();
    await app.quit();
  }
}

run().catch(async (error) => {
  const result = {
    ok: false,
    error: error.stack || error.message,
    mode: "real-electron-settings-integration",
  };
  if (resultPath) {
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  console.error(`[iinatan-settings-integration] ${error.stack || error.message}`);
  app.quit();
  process.exitCode = 1;
});
