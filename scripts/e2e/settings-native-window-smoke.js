"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");

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
      env: process.env,
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
        settings: status?.settings,
      });
      return status?.settingsWindow?.visible === true && status;
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
          mode: "native-settings-window-visibility-and-activation",
          boundary:
            "The signed macOS helper reported trusted Cmd+, input and native activation while the deterministic settings window was visible; profile controls remain covered by the real settings-document smoke, and other menu accelerators remain outside this test.",
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
