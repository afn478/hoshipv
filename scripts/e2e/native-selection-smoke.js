"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

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

function helperPath() {
  const executableName =
    process.platform === "win32" ? "iinatan-desktop-test.exe" : "iinatan-desktop-test";
  return (
    process.env.IINATAN_DESKTOP_TEST ||
    [
      path.join(
        root,
        "build",
        "native",
        ...(process.platform === "darwin"
          ? ["iinatan-desktop-test.app", "Contents", "MacOS", executableName]
          : [executableName]),
      ),
      path.join(root, "build", "native", "Release", executableName),
      path.join(root, "build", "native", executableName),
    ].find((candidate) => fsSync.existsSync(candidate)) ||
    ""
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

async function stopProcess(child) {
  if (!processAlive(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exited, delay(4000)]);
  if (processAlive(child)) {
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([exited, delay(1000)]);
  }
}

function invokeHelper(executable, args) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { cwd: root, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop()));
        } catch (parseError) {
          parseError.stdout = stdout;
          reject(parseError);
        }
      },
    );
  });
}

async function main() {
  if (process.env.IINATAN_NATIVE_SELECTION !== "1") {
    console.log(
      "SKIP: native Chromium text-selection evidence requires IINATAN_NATIVE_SELECTION=1 in an isolated graphical session.",
    );
    return;
  }
  if (!["darwin", "linux", "win32"].includes(process.platform))
    throw new Error(`native selection smoke does not support ${process.platform}`);
  if (process.platform === "linux" && !process.env.DISPLAY)
    throw new Error("native selection smoke requires an X11 DISPLAY on Linux");
  const helper = helperPath();
  if (!helper) throw new Error("the platform desktop-test helper is unavailable");

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-native-selection-"),
  );
  const readyPath = path.join(temporaryRoot, "ready.json");
  const triggerPath = path.join(temporaryRoot, "trigger");
  const resultPath = path.join(temporaryRoot, "result.json");
  const capturePath = path.join(temporaryRoot, "desktop.png");
  const child = spawn(
    process.execPath,
    [
      path.join(root, "scripts", "run-electron.js"),
      path.join(
        root,
        "scripts",
        "e2e",
        process.env.IINATAN_NATIVE_SELECTION_OVERLAY === "1"
          ? "native-overlay-selection-main.js"
          : "native-selection-main.js",
      ),
      `--ready-file=${readyPath}`,
      `--trigger-file=${triggerPath}`,
      `--result-file=${resultPath}`,
      `--user-data-dir=${path.join(temporaryRoot, "user-data")}`,
    ],
    {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  child.stdout.resume();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  try {
    let ready;
    try {
      ready = await waitFor(() => readJson(readyPath), "Electron selection probe");
    } catch (error) {
      const diagnostics = stderr.trim();
      if (diagnostics) error.message += `; Electron stderr: ${diagnostics}`;
      throw error;
    }
    assert.equal(ready.ok, true);
    const capture = await invokeHelper(helper, ["--capture", capturePath]);
    assert.equal(capture.ok, true);
    assert.ok(capture.width > 0);
    assert.ok(capture.height > 0);
    assert.ok((await fs.stat(capturePath)).size > 0);
    const target = ready.geometry.target;
    const scale =
      process.platform === "win32"
        ? Math.max(1, Number(ready.geometry.devicePixelRatio) || 1)
        : 1;
    const start = {
      x: (ready.bounds.x + target.left + 2) * scale,
      y: (ready.bounds.y + (target.top + target.bottom) / 2) * scale,
    };
    const end = {
      x: (ready.bounds.x + target.right - 2) * scale,
      y: start.y,
    };
    const input = await invokeHelper(helper, [
      "--drag",
      String(start.x),
      String(start.y),
      String(end.x),
      String(end.y),
    ]);
    assert.equal(input.ok, true);
    assert.equal(
      input.nativeInputReady === true ||
        (input.accessibilityTrusted === true && input.postEventTrusted === true),
      true,
    );
    await fs.writeFile(triggerPath, "go\n", { mode: 0o600 });
    const result = await waitFor(() => readJson(resultPath), "native selection result");
    if (!result.ok)
      throw new Error(
        `native selection result was not successful: ${JSON.stringify(result)}`,
      );
    console.log(
      JSON.stringify(
        {
          ok: true,
          helper: input,
          capture,
          scale,
          start,
          end,
          result,
          mode: "native-electron-text-selection",
        },
        null,
        2,
      ),
    );
  } finally {
    await stopProcess(child);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  if (stderr && /error|fatal/i.test(stderr))
    console.warn(
      `Electron native selection smoke emitted diagnostics: ${stderr.trim()}`,
    );
}

main().catch((error) => {
  console.error(`NATIVE SELECTION SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
