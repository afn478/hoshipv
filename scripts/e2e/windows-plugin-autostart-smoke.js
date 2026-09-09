"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

function publicDiagnostic(value) {
  return String(value || "")
    .replaceAll(root, "<repo>")
    .replaceAll(os.homedir(), "<home>");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function processRecords() {
  const command =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
    "$rows = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(iinatan-companion|iinatan for mpv|iinatan-companion-payload).*\\.exe$' } | " +
    "ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; " +
    "commandLine=[string]$_.CommandLine; executablePath=[string]$_.ExecutablePath } }); " +
    "$rows | ConvertTo-Json -Compress";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return [];
  }
}

function normalizedPath(value) {
  return String(value || "")
    .replaceAll("/", "\\")
    .toLowerCase();
}

function recordsForPath(records, target) {
  const normalizedTarget = normalizedPath(target);
  const quotedTarget = `"${normalizedTarget}"`;
  return records.filter((record) => {
    const executablePath = normalizedPath(record.executablePath);
    const commandLine = normalizedPath(record.commandLine);
    return (
      executablePath === normalizedTarget ||
      (commandLine.includes(normalizedTarget) &&
        (commandLine.startsWith(normalizedTarget) ||
          commandLine.startsWith(quotedTarget)))
    );
  });
}

function processTree(records, roots) {
  const tree = new Set(roots.map((record) => Number(record.pid)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (!tree.has(Number(record.pid)) && tree.has(Number(record.parentPid))) {
        tree.add(Number(record.pid));
        changed = true;
      }
    }
  }
  return tree;
}

function companionMemorySnapshot(processIds) {
  const command =
    "Get-Process | Where-Object { $_.ProcessName -like 'iinatan*' } | " +
    "ForEach-Object { [pscustomobject]@{ pid=$_.Id; name=$_.ProcessName; workingSetBytes=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64 } } | " +
    "ConvertTo-Json -Compress";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return null;
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch (_) {
    return null;
  }
  rows = Array.isArray(rows) ? rows : [rows];
  const toMiB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  const selected = processIds
    ? rows.filter((row) => processIds.has(Number(row.pid)))
    : rows;
  const total = (field) =>
    selected.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  return {
    processes: selected.map((row) => ({
      pid: Number(row.pid),
      name: String(row.name || "iinatan"),
      workingSetMiB: toMiB(Number(row.workingSetBytes)),
      privateMiB: toMiB(Number(row.privateBytes)),
    })),
    totalWorkingSetMiB: toMiB(total("workingSetBytes")),
    totalPrivateMiB: toMiB(total("privateBytes")),
    counters: "Windows WorkingSet64 and PrivateMemorySize64",
  };
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
}

async function waitForCompanionExit(pids) {
  if (!pids.size) return;
  await waitFor(
    () => {
      const live = new Set(processRecords().map((record) => Number(record.pid)));
      return [...pids].every((pid) => !live.has(pid));
    },
    10000,
    "the plugin companion to exit",
  );
}

async function removeTree(target) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!new Set(["EBUSY", "ENOTEMPTY", "EPERM"]).has(error.code)) throw error;
      await delay(250);
    }
  }
  throw new Error(`could not remove ${path.basename(target)}`);
}

async function main() {
  if (process.platform !== "win32") {
    if (process.env.IINATAN_WINDOWS_REQUIRED === "1")
      throw new Error("the Windows mpv plugin smoke requires Windows");
    console.log("SKIP: Windows mpv plugin smoke requires Windows");
    return;
  }

  const pluginDirectory = path.resolve(
    process.env.IINATAN_PLUGIN_DIR || path.join(root, "dist", "mpv-plugin"),
  );
  const sessionScript = path.join(pluginDirectory, "iinatan.lua");
  const companion = path.join(pluginDirectory, "iinatan-companion.exe");
  assert.equal(
    fsSync.existsSync(sessionScript),
    true,
    "plugin session script is missing",
  );
  assert.equal(fsSync.existsSync(companion), true, "mpv plugin companion is missing");

  const mpv = process.env.IINATAN_MPV || "mpv.exe";
  const temporaryRoot = await fs.mkdtemp(
    path.join(root, "build", "windows plugin-测试-"),
  );
  const temporaryProfile = path.join(temporaryRoot, "profile");
  const temporaryAppData = path.join(temporaryProfile, "AppData", "Roaming");
  const temporaryLocalAppData = path.join(temporaryProfile, "AppData", "Local");
  const temporaryConfigDirectory = path.join(temporaryAppData, "mpv");
  const temporaryCompanion = path.join(
    temporaryConfigDirectory,
    "iinatan-companion.exe",
  );
  const statusPath = path.join(temporaryRoot, "e2e-status.json");
  const temporaryScriptDirectory = path.join(temporaryConfigDirectory, "scripts");
  await fs.mkdir(temporaryScriptDirectory, { recursive: true });
  await fs.copyFile(sessionScript, path.join(temporaryScriptDirectory, "iinatan.lua"));
  await fs.copyFile(companion, temporaryCompanion);
  const environment = {
    ...process.env,
    APPDATA: temporaryAppData,
    LOCALAPPDATA: temporaryLocalAppData,
    USERPROFILE: temporaryProfile,
    IINATAN_E2E_AUTOSTART_STATUS_FILE: statusPath,
  };
  delete environment.IINATAN_COMPANION_APP;
  delete environment.IINATAN_SESSION_DIR;
  delete environment.IINATAN_IPC_ENDPOINT;

  let child = null;
  let startedRoots = [];
  let startedCompanion = new Set();
  let settingsProcess = null;
  let failure = null;
  const logPath = path.join(temporaryRoot, "mpv.log");
  try {
    child = spawn(mpv, [`--log-file=${logPath}`, "--idle=yes"], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.resume();
    child.stderr.resume();
    await waitFor(
      async () => {
        try {
          const dataRoot = path.join(environment.APPDATA, "mpv", "iinatan");
          await Promise.all([
            fs.access(path.join(dataRoot, "config.json")),
            fs.access(path.join(dataRoot, "dictionaries")),
            fs.access(path.join(dataRoot, "backups")),
            fs.access(path.join(dataRoot, "cache")),
            fs.access(path.join(dataRoot, "logs")),
            fs.access(path.join(dataRoot, "cache", "sessions")),
          ]);
          return true;
        } catch (_) {
          return false;
        }
      },
      45000,
      "the first-use mpv data layout",
    );
    await waitFor(
      () => {
        const records = processRecords();
        startedRoots = recordsForPath(records, temporaryCompanion);
        startedCompanion = processTree(records, startedRoots);
        return startedRoots.length > 0;
      },
      45000,
      "the companion started by the mpv script",
    );
    assert.equal(child.exitCode, null, "mpv exited before the companion was observed");
    await delay(
      Math.max(1000, Number(process.env.IINATAN_PLUGIN_SETTINGS_DELAY_MS) || 1000),
    );
    const activeRecords = processRecords();
    startedCompanion = processTree(activeRecords, startedRoots);
    const memory = companionMemorySnapshot(startedCompanion);
    let settingsAccess = { requested: false };
    if (process.env.IINATAN_PLUGIN_SETTINGS_REQUIRED === "1") {
      const dataRoot = path.join(temporaryConfigDirectory, "iinatan");
      settingsProcess = spawn(
        temporaryCompanion,
        [
          "--settings",
          `--iinatan-companion-executable=${temporaryCompanion}`,
          `--iinatan-mpv-root=${temporaryConfigDirectory}`,
          `--iinatan-data-root=${dataRoot}`,
        ],
        { env: environment, stdio: "ignore", windowsHide: true },
      );
      await waitFor(
        () => settingsProcess.exitCode !== null,
        Math.max(1000, Number(process.env.IINATAN_PLUGIN_SETTINGS_TIMEOUT_MS) || 15000),
        "settings handoff companion request",
      );
      assert.equal(
        settingsProcess.exitCode,
        0,
        "settings handoff companion request failed",
      );
      let settingsStatus;
      try {
        settingsStatus = await waitFor(
          async () => {
            try {
              const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
              return status.settingsWindow?.visible === true ? status : null;
            } catch (_) {
              return null;
            }
          },
          Math.max(
            1000,
            Number(process.env.IINATAN_PLUGIN_SETTINGS_WINDOW_TIMEOUT_MS) || 60000,
          ),
          "settings window after companion handoff",
        );
      } catch (error) {
        let diagnostic = null;
        try {
          const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
          diagnostic = {
            settingsWindow: status.settingsWindow || null,
            settingsError: status.settingsError || null,
            settingsLoadDiagnostic: status.settingsLoadDiagnostic || null,
            protocol: status.protocol || null,
          };
        } catch (_) {}
        throw new Error(`${error.message}; last status ${JSON.stringify(diagnostic)}`);
      }
      settingsAccess = {
        requested: true,
        handoff: true,
        settingsWindow: settingsStatus.settingsWindow,
      };
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "windows-mpv-plugin-autostart",
          pluginFiles: ["iinatan.lua", "iinatan-companion.exe"],
          installLayout: {
            script: "%APPDATA%\\mpv\\scripts\\iinatan.lua",
            companion: "%APPDATA%\\mpv\\iinatan-companion.exe",
          },
          loadMode: "mpv automatic scripts directory",
          descriptorLocation: "%APPDATA%\\mpv\\iinatan\\cache\\sessions",
          settingsAccess,
          companionProcessCount: startedCompanion.size,
          companionMemory: memory,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (settingsProcess && settingsProcess.exitCode === null)
      killProcessTree(settingsProcess.pid);
    if (child && child.exitCode === null) killProcessTree(child.pid);
    for (const rootProcess of startedRoots) killProcessTree(rootProcess.pid);
    for (const pid of startedCompanion) killProcessTree(pid);
    await waitForCompanionExit(startedCompanion).catch(() => {
      for (const pid of startedCompanion) killProcessTree(pid);
    });
    if (failure) {
      try {
        const log = await fs.readFile(logPath, "utf8");
        if (log.trim()) console.error(`mpv log:\n${publicDiagnostic(log)}`);
      } catch (_) {}
    }
    await removeTree(temporaryRoot).catch(() => {});
  }
}

main().catch((error) => {
  console.error(
    `WINDOWS MPV PLUGIN SMOKE FAILED: ${publicDiagnostic(error.stack || error.message)}`,
  );
  process.exitCode = 1;
});
