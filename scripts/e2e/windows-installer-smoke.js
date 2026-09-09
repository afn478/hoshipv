"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const productName = "iinatan for mpv";

function publicDiagnostic(value) {
  const text = String(value);
  const escapedRoot = root.replaceAll("\\", "\\\\");
  const escapedHome = os.homedir().replaceAll("\\", "\\\\");
  return text
    .replaceAll(root, "<repo>")
    .replaceAll(escapedRoot, "<repo>")
    .replaceAll(os.homedir(), "<home>")
    .replaceAll(escapedHome, "<home>");
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.error)
    throw new Error(
      `${executable} failed to start: ${publicDiagnostic(result.error.message)}`,
    );
  return result;
}

function startWindowsGuiApplication(executable, args) {
  const command =
    "$process = Start-Process -FilePath $env:IINATAN_INSTALLER_FILE " +
    "-ArgumentList $env:IINATAN_INSTALLER_ARGS -WindowStyle Hidden -PassThru; " +
    "if ($null -eq $process) { exit 1 }; Write-Output $process.Id";
  const result = run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      env: {
        ...process.env,
        IINATAN_INSTALLER_FILE: executable,
        IINATAN_INSTALLER_ARGS: args
          .map((value) => (/\s/.test(value) ? `"${value}"` : value))
          .join(" "),
      },
    },
  );
  assertCompleted(result, "Windows GUI installer process launch");
  const pid = Number.parseInt(String(result.stdout).trim().split(/\s+/).at(-1), 10);
  assert.ok(Number.isInteger(pid) && pid > 0, "Windows GUI process returned no PID");
  return pid;
}

function processExists(pid) {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return result.status === 0 && new RegExp(`"${pid}"`).test(result.stdout || "");
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!processExists(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Windows GUI process ${pid} did not exit`);
}

function assertCompleted(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} exited with ${result.status}: ${publicDiagnostic(
      result.stderr || result.stdout || "",
    )}`,
  );
}

async function removeTreeWithRetry(target) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!new Set(["EBUSY", "ENOTEMPTY", "EPERM"]).has(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function waitForEmptyDirectory(target) {
  let lastEntries = [];
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const entries = await fs.readdir(target);
      lastEntries = entries;
      if (entries.length === 0) return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `NSIS uninstaller left application files behind: ${lastEntries.join(", ")}`,
  );
}

async function waitForFile(target) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fs.access(target);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`installer did not create ${path.basename(target)}`);
}

async function main() {
  if (process.platform !== "win32") {
    if (process.env.IINATAN_WINDOWS_REQUIRED === "1")
      throw new Error("the Windows installer smoke requires Windows");
    console.log("SKIP: Windows installer smoke requires Windows");
    return;
  }

  const packageJson = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  const installer = path.resolve(
    process.env.IINATAN_WINDOWS_INSTALLER ||
      path.join(root, "dist", `${productName} Setup ${packageJson.version}.exe`),
  );
  await fs.access(installer);

  const buildRoot = path.resolve(root, "build");
  const buildPrefix = `${buildRoot}${path.sep}`;
  const smokeRoot = await fs.mkdtemp(path.join(buildRoot, "windows-installer-smoke-"));
  const installRoot = path.join(smokeRoot, "app");
  assert.ok(
    smokeRoot.startsWith(buildPrefix),
    "installer smoke directory escaped the build directory",
  );
  const userDataRoot = await fs.mkdtemp(
    path.join(buildRoot, "windows-installer-user-data-"),
  );
  const userDataSentinel = path.join(userDataRoot, "sentinel.txt");

  try {
    const installPid = startWindowsGuiApplication(installer, [
      "/S",
      `/D=${installRoot}`,
    ]);
    await waitForProcessExit(installPid);

    const executable = path.join(installRoot, `${productName}.exe`);
    const uninstaller = path.join(installRoot, `Uninstall ${productName}.exe`);
    await waitForFile(executable);
    await fs.access(uninstaller);

    const validation = run(
      process.execPath,
      [path.join(root, "scripts", "validate-package.js")],
      {
        env: {
          ...process.env,
          IINATAN_PACKAGE_DIR: installRoot,
          IINATAN_PACKAGE_PLATFORM: "win32",
        },
      },
    );
    assertCompleted(validation, "installed package validation");
    const validationOutput = JSON.parse(validation.stdout);
    assert.equal(validationOutput.ok, true);
    assert.equal(validationOutput.platform, "win32");

    await fs.writeFile(userDataSentinel, "preserve this file\n", "utf8");
    const uninstallPid = startWindowsGuiApplication(uninstaller, ["/S"]);
    await waitForProcessExit(uninstallPid);
    await waitForEmptyDirectory(installRoot);
    await fs.access(userDataSentinel);

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "windows-nsis-install-uninstall-smoke",
          installer: path.relative(root, installer),
          installedLayout: "validated",
          uninstaller: "removed-application-files",
          userDataPreserved: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await removeTreeWithRetry(smokeRoot);
    await removeTreeWithRetry(userDataRoot);
  }
}

main().catch((error) => {
  console.error(
    `WINDOWS INSTALLER SMOKE FAILED: ${publicDiagnostic(error.stack || error.message)}`,
  );
  process.exitCode = 1;
});
