"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");
const { SettingsStore } = require("../../src/settings/settings-store");

const root = path.resolve(__dirname, "../..");

function trace(message, value) {
  if (process.env.IINATAN_NATIVE_SETTINGS_DEBUG !== "1") return;
  console.error(
    `[iinatan-settings-native] ${message}${value === undefined ? "" : `: ${JSON.stringify(value)}`}`,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

async function waitFor(predicate, label, timeoutMs = 10000) {
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

function processAlive(child) {
  if (!child?.pid) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (error) {
    if (error.code !== "ESRCH" || process.platform === "win32")
      return error.code !== "ESRCH";
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (groupError) {
      return groupError.code !== "ESRCH";
    }
  }
}

function signalProcessGroup(child, signal) {
  process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
}

async function stopProcess(child) {
  if (!processAlive(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    signalProcessGroup(child, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exited, delay(4000)]);
  if (processAlive(child)) {
    try {
      signalProcessGroup(child, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([exited, delay(1000)]);
  }
}

function nativeProbeExecutable() {
  const name =
    process.platform === "win32" ? "iinatan-window-probe.exe" : "iinatan-window-probe";
  return (
    process.env.IINATAN_WINDOW_PROBE ||
    [
      path.join(root, "bin", name),
      path.join(root, "build", "native", name),
      path.join(root, "build", "native", "Release", name),
    ].find((candidate) => fsSync.existsSync(candidate)) ||
    ""
  );
}

function desktopTestExecutable() {
  const name =
    process.platform === "win32" ? "iinatan-desktop-test.exe" : "iinatan-desktop-test";
  return (
    process.env.IINATAN_DESKTOP_TEST ||
    [
      path.join(root, "bin", name),
      path.join(
        root,
        "build",
        "native",
        "iinatan-desktop-test.app",
        "Contents",
        "MacOS",
        name,
      ),
      path.join(root, "build", "native", name),
      path.join(root, "build", "native", "Release", name),
    ].find((candidate) => fsSync.existsSync(candidate)) ||
    ""
  );
}

function boundsDelta(nativeBounds, electronBounds) {
  return {
    x: Math.abs(Number(nativeBounds.x) - Number(electronBounds.x)),
    y: Math.abs(Number(nativeBounds.y) - Number(electronBounds.y)),
    width: Math.abs(Number(nativeBounds.width) - Number(electronBounds.width)),
    height: Math.abs(Number(nativeBounds.height) - Number(electronBounds.height)),
  };
}

function regionCenter(windowBounds, region) {
  return {
    x: Number(windowBounds.x) + Number(region.x) + Number(region.width) / 2,
    y: Number(windowBounds.y) + Number(region.y) + Number(region.height) / 2,
  };
}

function nativeCommand(executable, args, description) {
  trace("command", { description, args });
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${description} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  try {
    const parsed = JSON.parse(
      String(result.stdout || "")
        .trim()
        .split(/\r?\n/)
        .pop(),
    );
    trace("result", parsed);
    return parsed;
  } catch (error) {
    throw new Error(`${description} returned invalid JSON: ${error.message}`);
  }
}

async function main() {
  if (process.env.IINATAN_NATIVE_SETTINGS !== "1") {
    console.log(
      "SKIP: native settings-window evidence requires IINATAN_NATIVE_SETTINGS=1 in an isolated graphical session.",
    );
    console.log(
      "This checks the real Electron settings window, Cmd+, menu accelerator, and native activation.",
    );
    return;
  }
  if (process.platform !== "darwin")
    throw new Error(
      "native settings-window smoke currently has a macOS window-probe path only",
    );

  const probeExecutable = nativeProbeExecutable();
  if (!probeExecutable)
    throw new Error("the native window probe executable is unavailable");
  const inputExecutable = desktopTestExecutable();
  if (!inputExecutable)
    throw new Error("the native desktop input helper executable is unavailable");

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-settings-native-window-"),
  );
  const userDataPath = path.join(temporaryRoot, "user-data");
  const statusPath = path.join(temporaryRoot, "e2e-status.json");
  const backupDirectory = path.join(temporaryRoot, "backup");
  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDirectory, "settings-export.json");
  const iinatanDataRoot = path.join(userDataPath, "iinatan");
  const settingsPath = path.join(iinatanDataRoot, "config.json");
  const legacySettingsPath = path.join(userDataPath, "settings.json");
  const settingsStore = new SettingsStore(settingsPath, {
    backupPath: path.join(iinatanDataRoot, "backups", "config.json"),
  });
  const legacyMigration = process.env.IINATAN_NATIVE_SETTINGS_MIGRATION === "1";
  if (legacyMigration) {
    await fs.mkdir(userDataPath, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      legacySettingsPath,
      `${JSON.stringify(
        {
          activeProfileId: "default",
          profiles: {
            default: {
              id: "default",
              name: "Default",
              lookupLanguage: "de",
              popupMaxWidth: 9999,
            },
            study: {
              id: "study",
              name: "Study",
              preferences: { lookupLanguage: "fr" },
            },
          },
          global: { importTimeoutMs: 99999999 },
          dictionaries: [
            {
              id: "legacy-dictionary",
              title: "Legacy dictionary",
              path: "/private/legacy-dictionary",
              enabled: true,
            },
          ],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    const legacyStore = new SettingsStore(legacySettingsPath);
    await legacyStore.load();
    assert.equal(
      legacyStore.current().profiles.default.preferences.lookupLanguage,
      "de",
    );
    assert.equal(legacyStore.current().profiles.study.preferences.lookupLanguage, "fr");
    assert.equal(
      legacyStore.current().profiles.default.preferences.popupMaxWidth,
      2200,
    );
    assert.equal(legacyStore.current().global.importTimeoutMs, 7200000);
  } else {
    await settingsStore.load();
    await settingsStore.createProfile("study", "Study");
    await settingsStore.setActiveProfile("default");
  }
  const electronProcess = spawn(
    process.execPath,
    [
      path.join(root, "scripts", "run-electron.js"),
      ".",
      "--settings",
      `--e2e-status-file=${statusPath}`,
      `--user-data-dir=${userDataPath}`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        IINATAN_NATIVE_SETTINGS_BACKUP_PATH: backupPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  electronProcess.stdout.resume();
  let stderr = "";
  electronProcess.stderr.setEncoding("utf8");
  electronProcess.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const ready = await waitFor(async () => {
      const status = await readJson(statusPath);
      return status?.applicationMenu?.settings?.enabled === true && status;
    }, "application menu readiness");
    assert.equal(ready.applicationMenu?.openMedia?.label, "Open media in mpv…");
    assert.match(ready.applicationMenu.openMedia.accelerator || "", /O/);
    assert.equal(ready.applicationMenu.openMedia.enabled, true);
    assert.equal(ready.applicationMenu.openMedia.visible, true);
    assert.equal(ready.applicationMenu?.settings?.label, "Settings…");
    assert.match(ready.applicationMenu.settings.accelerator || "", /,/);
    assert.equal(ready.applicationMenu.settings.enabled, true);
    assert.equal(ready.applicationMenu.settings.visible, true);

    await waitFor(
      async () => (await readJson(statusPath))?.settingsWindow?.visible === true,
      "initial native settings window visibility",
    );

    const activationResult = await waitFor(
      () => {
        const result = nativeCommand(
          inputExecutable,
          ["--activate", String(ready.pid)],
          "native app activation",
        );
        return result.ok && result.foregroundVerified === true ? result : null;
      },
      "native app foreground ownership",
      5000,
    );
    await delay(500);

    const shortcut = nativeCommand(
      inputExecutable,
      ["--activate-shortcut", String(ready.pid), "command", "comma"],
      "native Settings shortcut",
    );
    assert.equal(shortcut.ok, true);
    assert.equal(shortcut.accessibilityTrusted, true);
    assert.equal(shortcut.postEventTrusted, true);

    const settingsOpened = await waitFor(async () => {
      const status = await readJson(statusPath);
      trace("status-after-settings-shortcut", {
        settingsWindow: status?.settingsWindow,
        settingsControlRegions: status?.settingsControlRegions,
        settings: status?.settings,
      });
      return (
        status?.settingsWindow?.visible === true &&
        status?.settingsControlRegions?.activeProfile &&
        status?.settingsControlRegions?.profileName &&
        status?.settingsControlRegions?.newProfileId &&
        status?.settingsControlRegions?.newProfileName &&
        status?.settingsControlRegions?.createProfile &&
        status?.settingsControlRegions?.deleteProfile &&
        status?.settingsControlRegions?.save &&
        status?.settingsControlRegions?.exportBackup &&
        status?.settingsControlRegions?.restoreBackup &&
        status
      );
    }, "native settings window visibility after Cmd+, shortcut");
    assert.equal(settingsOpened.settingsWindow.focused, true);
    assert.ok(settingsOpened.settingsWindow.bounds?.width > 0);
    assert.ok(settingsOpened.settingsWindow.bounds?.height > 0);

    const adapter = new NativeWindowAdapter({
      probeExecutable,
      resourceRoot: root,
      timeoutMs: 3000,
    });
    const descriptor = { pid: Number(ready.pid) };
    assert.ok(Number.isInteger(descriptor.pid) && descriptor.pid > 0);
    const nativeWindow = await waitFor(
      () => adapter.read(descriptor),
      "native settings window probe",
    );
    assert.equal(nativeWindow.ok, true);
    assert.ok(nativeWindow.windowId !== undefined);
    assert.ok(nativeWindow.content?.width > 0);
    assert.ok(nativeWindow.content?.height > 0);
    const geometryDelta = boundsDelta(
      nativeWindow.content,
      settingsOpened.settingsWindow.bounds,
    );
    for (const [axis, delta] of Object.entries(geometryDelta))
      assert.ok(delta <= 4, `settings ${axis} bound differs by ${delta}`);

    const activation = await adapter.focus({
      pid: descriptor.pid,
      windowId: String(nativeWindow.windowId),
    });
    assert.equal(activation.ok, true);
    const foreground = await waitFor(async () => {
      const status = await readJson(statusPath);
      if (status?.settingsWindow?.focused !== true) return null;
      const observed = await adapter.read({
        pid: descriptor.pid,
        windowId: String(nativeWindow.windowId),
      });
      return observed.isForeground === true ? { status, observed } : null;
    }, "native settings window foreground ownership");

    const profileSelectPoint = regionCenter(
      settingsOpened.settingsWindow.contentBounds ||
        settingsOpened.settingsWindow.bounds,
      settingsOpened.settingsControlRegions.activeProfile,
    );
    const settingsControlPoint = (name) =>
      regionCenter(
        settingsOpened.settingsWindow.contentBounds ||
          settingsOpened.settingsWindow.bounds,
        settingsOpened.settingsControlRegions[name],
      );
    const profileClick = nativeCommand(
      inputExecutable,
      ["--click", String(profileSelectPoint.x), String(profileSelectPoint.y), "left"],
      "native active-profile select click",
    );
    assert.equal(profileClick.ok, true);
    assert.equal(profileClick.accessibilityTrusted, true);
    assert.equal(profileClick.postEventTrusted, true);
    const profileDown = nativeCommand(
      inputExecutable,
      ["--key", "down"],
      "native profile down",
    );
    assert.equal(profileDown.ok, true);
    assert.equal(profileDown.accessibilityTrusted, true);
    assert.equal(profileDown.postEventTrusted, true);
    const profileSelectStudy = nativeCommand(
      inputExecutable,
      ["--key", "return"],
      "native profile study selection",
    );
    assert.equal(profileSelectStudy.ok, true);
    assert.equal(profileSelectStudy.accessibilityTrusted, true);
    assert.equal(profileSelectStudy.postEventTrusted, true);
    const switchedToStudy = await waitFor(async () => {
      const status = await readJson(statusPath);
      return status?.settings?.activeProfileId === "study" ? status : null;
    }, "native profile switch to study");

    const profileSelectBack = nativeCommand(
      inputExecutable,
      ["--click", String(profileSelectPoint.x), String(profileSelectPoint.y), "left"],
      "native active-profile select reopen",
    );
    assert.equal(profileSelectBack.ok, true);
    assert.equal(profileSelectBack.accessibilityTrusted, true);
    assert.equal(profileSelectBack.postEventTrusted, true);
    const profileUp = nativeCommand(
      inputExecutable,
      ["--key", "up"],
      "native profile up",
    );
    assert.equal(profileUp.ok, true);
    assert.equal(profileUp.accessibilityTrusted, true);
    assert.equal(profileUp.postEventTrusted, true);
    const profileSelectDefault = nativeCommand(
      inputExecutable,
      ["--key", "return"],
      "native profile default selection",
    );
    assert.equal(profileSelectDefault.ok, true);
    assert.equal(profileSelectDefault.accessibilityTrusted, true);
    assert.equal(profileSelectDefault.postEventTrusted, true);
    const switchedToDefault = await waitFor(async () => {
      const status = await readJson(statusPath);
      return status?.settings?.activeProfileId === "default" ? status : null;
    }, "native profile switch back to default");

    const profileNamePoint = settingsControlPoint("profileName");
    const profileNameFocus = nativeCommand(
      inputExecutable,
      ["--click", String(profileNamePoint.x), String(profileNamePoint.y), "left"],
      "native profile-name editor focus",
    );
    assert.equal(profileNameFocus.ok, true);
    assert.equal(profileNameFocus.accessibilityTrusted, true);
    assert.equal(profileNameFocus.postEventTrusted, true);
    const profileNameEnd = nativeCommand(
      inputExecutable,
      ["--key", "end"],
      "native profile-name editor end",
    );
    assert.equal(profileNameEnd.ok, true);
    assert.equal(profileNameEnd.accessibilityTrusted, true);
    assert.equal(profileNameEnd.postEventTrusted, true);
    const profileNameType = nativeCommand(
      inputExecutable,
      ["--type", " native"],
      "native profile-name editor typing",
    );
    assert.equal(profileNameType.ok, true);
    assert.equal(profileNameType.accessibilityTrusted, true);
    assert.equal(profileNameType.postEventTrusted, true);
    const profileNameSavePoint = settingsControlPoint("save");
    const profileNameSave = nativeCommand(
      inputExecutable,
      [
        "--click",
        String(profileNameSavePoint.x),
        String(profileNameSavePoint.y),
        "left",
      ],
      "native profile-name save",
    );
    assert.equal(profileNameSave.ok, true);
    assert.equal(profileNameSave.accessibilityTrusted, true);
    assert.equal(profileNameSave.postEventTrusted, true);
    const renamedDefault = await waitFor(async () => {
      const status = await readJson(statusPath);
      const profile = status?.settings?.profiles?.find((item) => item.id === "default");
      return profile?.name === "Default native" ? status : null;
    }, "native profile-name save");

    const newProfileIdPoint = settingsControlPoint("newProfileId");
    const newProfileIdFocus = nativeCommand(
      inputExecutable,
      ["--click", String(newProfileIdPoint.x), String(newProfileIdPoint.y), "left"],
      "native new-profile id focus",
    );
    assert.equal(newProfileIdFocus.ok, true);
    assert.equal(newProfileIdFocus.accessibilityTrusted, true);
    assert.equal(newProfileIdFocus.postEventTrusted, true);
    const newProfileIdType = nativeCommand(
      inputExecutable,
      ["--type", "native"],
      "native new-profile id typing",
    );
    assert.equal(newProfileIdType.ok, true);
    assert.equal(newProfileIdType.accessibilityTrusted, true);
    assert.equal(newProfileIdType.postEventTrusted, true);
    const newProfileNamePoint = settingsControlPoint("newProfileName");
    const newProfileNameFocus = nativeCommand(
      inputExecutable,
      ["--click", String(newProfileNamePoint.x), String(newProfileNamePoint.y), "left"],
      "native new-profile name focus",
    );
    assert.equal(newProfileNameFocus.ok, true);
    assert.equal(newProfileNameFocus.accessibilityTrusted, true);
    assert.equal(newProfileNameFocus.postEventTrusted, true);
    const newProfileNameType = nativeCommand(
      inputExecutable,
      ["--type", "Native"],
      "native new-profile name typing",
    );
    assert.equal(newProfileNameType.ok, true);
    assert.equal(newProfileNameType.accessibilityTrusted, true);
    assert.equal(newProfileNameType.postEventTrusted, true);
    const createProfilePoint = settingsControlPoint("createProfile");
    const createProfile = nativeCommand(
      inputExecutable,
      ["--click", String(createProfilePoint.x), String(createProfilePoint.y), "left"],
      "native profile create",
    );
    assert.equal(createProfile.ok, true);
    assert.equal(createProfile.accessibilityTrusted, true);
    assert.equal(createProfile.postEventTrusted, true);
    const createdProfile = await waitFor(async () => {
      const status = await readJson(statusPath);
      const profile = status?.settings?.profiles?.find((item) => item.id === "native");
      return status?.settings?.activeProfileId === "native" &&
        profile?.name === "Native"
        ? status
        : null;
    }, "native profile create");

    const deleteProfilePoint = settingsControlPoint("deleteProfile");
    const deleteProfile = nativeCommand(
      inputExecutable,
      ["--click", String(deleteProfilePoint.x), String(deleteProfilePoint.y), "left"],
      "native profile delete",
    );
    assert.equal(deleteProfile.ok, true);
    assert.equal(deleteProfile.accessibilityTrusted, true);
    assert.equal(deleteProfile.postEventTrusted, true);
    const deletedProfile = await waitFor(async () => {
      const status = await readJson(statusPath);
      const profile = status?.settings?.profiles?.find((item) => item.id === "native");
      return status?.settings?.activeProfileId === "default" && !profile
        ? status
        : null;
    }, "native profile delete");

    const settingsContentBounds =
      settingsOpened.settingsWindow.contentBounds ||
      settingsOpened.settingsWindow.bounds;
    const settingsScrollPoint = {
      x: Number(settingsContentBounds.x) + Number(settingsContentBounds.width) / 2,
      y: Number(settingsContentBounds.y) + Number(settingsContentBounds.height) / 2,
    };
    const visibleControlStatus = (status, name) => {
      const region = status?.settingsControlRegions?.[name];
      const bounds = status?.settingsWindow?.contentBounds || settingsContentBounds;
      if (!region || !bounds) return false;
      return (
        region.x >= 0 &&
        region.y >= 0 &&
        region.x + region.width <= bounds.width &&
        region.y + region.height <= bounds.height
      );
    };
    const scrollSettings = (delta, description) => {
      const result = nativeCommand(
        inputExecutable,
        [
          "--scroll",
          String(settingsScrollPoint.x),
          String(settingsScrollPoint.y),
          String(delta),
        ],
        description,
      );
      assert.equal(result.ok, true);
      assert.equal(result.accessibilityTrusted, true);
      assert.equal(result.postEventTrusted, true);
      return result;
    };

    scrollSettings(-5000, "native settings scroll to dictionary controls");
    const dictionaryControls = await waitFor(async () => {
      const status = await readJson(statusPath);
      return visibleControlStatus(status, "exportBackup") &&
        visibleControlStatus(status, "restoreBackup")
        ? status
        : null;
    }, "native settings dictionary controls");
    const dictionaryBounds =
      dictionaryControls.settingsWindow.contentBounds || settingsContentBounds;
    const backupControlPoint = regionCenter(
      dictionaryBounds,
      dictionaryControls.settingsControlRegions.exportBackup,
    );
    const exportBackupClick = nativeCommand(
      inputExecutable,
      ["--click", String(backupControlPoint.x), String(backupControlPoint.y), "left"],
      "native settings backup export click",
    );
    assert.equal(exportBackupClick.ok, true);
    assert.equal(exportBackupClick.accessibilityTrusted, true);
    assert.equal(exportBackupClick.postEventTrusted, true);
    await waitFor(
      async () => (await readJson(statusPath))?.settingsDialog === "export-backup",
      "native settings save panel",
    );
    await delay(750);
    const exportBackupSave = nativeCommand(
      inputExecutable,
      ["--key", "return"],
      "native settings backup save confirmation",
    );
    assert.equal(exportBackupSave.ok, true);
    assert.equal(exportBackupSave.accessibilityTrusted, true);
    assert.equal(exportBackupSave.postEventTrusted, true);
    const exportedBackup = await waitFor(async () => {
      const value = await readJson(backupPath);
      return value?.settings?.schemaVersion === 1 && value?.settings?.profiles?.default
        ? value
        : null;
    }, "native settings backup file");
    await waitFor(
      async () => (await readJson(statusPath))?.settingsDialog === null,
      "native settings save panel dismissal",
    );

    const mutatedSettings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    mutatedSettings.profiles.default.name = "Default native changed";
    await fs.writeFile(settingsPath, `${JSON.stringify(mutatedSettings, null, 2)}\n`, {
      mode: 0o600,
    });
    assert.equal(
      (await readJson(settingsPath))?.profiles?.default?.name,
      "Default native changed",
    );
    const restoreControls = await waitFor(async () => {
      const status = await readJson(statusPath);
      return visibleControlStatus(status, "restoreBackup") ? status : null;
    }, "native settings restore control");
    const restoreBounds =
      restoreControls.settingsWindow.contentBounds || settingsContentBounds;
    const restoreControlPoint = regionCenter(
      restoreBounds,
      restoreControls.settingsControlRegions.restoreBackup,
    );
    const restoreBackupClick = nativeCommand(
      inputExecutable,
      ["--click", String(restoreControlPoint.x), String(restoreControlPoint.y), "left"],
      "native settings backup restore click",
    );
    assert.equal(restoreBackupClick.ok, true);
    assert.equal(restoreBackupClick.accessibilityTrusted, true);
    assert.equal(restoreBackupClick.postEventTrusted, true);
    await delay(150);
    const restoreConfirmation = nativeCommand(
      inputExecutable,
      ["--key", "return"],
      "native settings backup restore confirmation",
    );
    assert.equal(restoreConfirmation.ok, true);
    assert.equal(restoreConfirmation.accessibilityTrusted, true);
    assert.equal(restoreConfirmation.postEventTrusted, true);
    await waitFor(
      async () => (await readJson(statusPath))?.settingsDialog === "restore-backup",
      "native settings open panel",
    );
    await delay(750);
    const restoreBackupHome = nativeCommand(
      inputExecutable,
      ["--key", "home"],
      "native settings backup file-list home",
    );
    assert.equal(restoreBackupHome.ok, true);
    assert.equal(restoreBackupHome.accessibilityTrusted, true);
    assert.equal(restoreBackupHome.postEventTrusted, true);
    const restoreBackupSelect = nativeCommand(
      inputExecutable,
      ["--key", "down"],
      "native settings backup file-list selection",
    );
    assert.equal(restoreBackupSelect.ok, true);
    assert.equal(restoreBackupSelect.accessibilityTrusted, true);
    assert.equal(restoreBackupSelect.postEventTrusted, true);
    const restoreBackupOpen = nativeCommand(
      inputExecutable,
      ["--key", "return"],
      "native settings backup open confirmation",
    );
    assert.equal(restoreBackupOpen.ok, true);
    assert.equal(restoreBackupOpen.accessibilityTrusted, true);
    assert.equal(restoreBackupOpen.postEventTrusted, true);
    await waitFor(
      async () => (await readJson(statusPath))?.settingsDialog === null,
      "native settings open panel dismissal",
    );
    const restoredSettings = await readJson(settingsPath);
    assert.equal(restoredSettings?.profiles?.default?.name, "Default native");
    const restoredBackup = await waitFor(async () => {
      const status = await readJson(statusPath);
      const profile = status?.settings?.profiles?.find((item) => item.id === "default");
      return profile?.name === "Default native" ? status : null;
    }, "native settings backup restore");
    let migrationEvidence = null;
    if (legacyMigration) {
      const normalized = await readJson(settingsPath);
      assert.equal(normalized?.schemaVersion, 1);
      assert.equal(normalized?.profiles?.default?.preferences?.lookupLanguage, "de");
      assert.equal(normalized?.profiles?.study?.preferences?.lookupLanguage, "fr");
      assert.equal(normalized?.global?.importTimeoutMs, 7200000);
      migrationEvidence = {
        input: "legacy-profile-preferences-and-global-values",
        normalizedSchemaVersion: normalized.schemaVersion,
        defaultLanguage: normalized.profiles.default.preferences.lookupLanguage,
        studyLanguage: normalized.profiles.study.preferences.lookupLanguage,
        clampedImportTimeoutMs: normalized.global.importTimeoutMs,
        clampedPopupMaxWidth: normalized.profiles.default.preferences.popupMaxWidth,
      };
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          electron: ready,
          appActivation: activationResult,
          settingsWindow: settingsOpened.settingsWindow,
          shortcut,
          nativeWindow: {
            windowId: nativeWindow.windowId,
            content: nativeWindow.content,
            isForeground: foreground.observed.isForeground,
            displayVisible: nativeWindow.displayVisible,
            contentSource: nativeWindow.contentSource,
          },
          geometryDelta,
          activation,
          profileSwitch: {
            control: settingsOpened.settingsControlRegions.activeProfile,
            point: profileSelectPoint,
            toStudy: {
              click: profileClick,
              down: profileDown,
              select: profileSelectStudy,
              activeProfileId: switchedToStudy.settings.activeProfileId,
            },
            toDefault: {
              click: profileSelectBack,
              up: profileUp,
              select: profileSelectDefault,
              activeProfileId: switchedToDefault.settings.activeProfileId,
            },
          },
          profileEditor: {
            name: {
              focus: profileNameFocus,
              end: profileNameEnd,
              type: profileNameType,
              save: profileNameSave,
              defaultName: renamedDefault.settings.profiles.find(
                (item) => item.id === "default",
              )?.name,
            },
            create: {
              id: newProfileIdType,
              name: newProfileNameType,
              click: createProfile,
              activeProfileId: createdProfile.settings.activeProfileId,
            },
            delete: {
              click: deleteProfile,
              activeProfileId: deletedProfile.settings.activeProfileId,
              removed: !deletedProfile.settings.profiles.some(
                (item) => item.id === "native",
              ),
            },
          },
          backupRestore: {
            path: backupPath,
            export: {
              click: exportBackupClick,
              save: exportBackupSave,
              schemaVersion: exportedBackup.settings.schemaVersion,
              defaultName: exportedBackup.settings.profiles.default.name,
            },
            restore: {
              click: restoreBackupClick,
              confirmation: restoreConfirmation,
              home: restoreBackupHome,
              select: restoreBackupSelect,
              open: restoreBackupOpen,
              defaultName: restoredBackup.settings.profiles.find(
                (item) => item.id === "default",
              )?.name,
              restoredFileName: restoredSettings.profiles.default.name,
            },
          },
          migration: migrationEvidence,
          mode: "native-settings-window-visibility-and-activation",
          boundary:
            "The signed macOS helper reported trusted Cmd+, input and native activation while the deterministic settings window was visible, verified the real Open Media Cmd+O and Settings Cmd+, menu metadata, switched a disposable default/study profile, edited a profile name, created/deleted a disposable profile, and drove the real macOS Save/Open panels for a disposable backup and restore; it does not invoke the Open Media accelerator because that would intentionally open a user-visible file picker.",
        },
        null,
        2,
      ),
    );
  } finally {
    await stopProcess(electronProcess);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`Electron settings smoke emitted diagnostics: ${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`NATIVE SETTINGS WINDOW SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
