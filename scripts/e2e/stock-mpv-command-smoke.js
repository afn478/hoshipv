"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { PlayerBridge } = require("../../src/player/player-bridge");
const {
  isProcessAlive,
  listDescriptors,
} = require("../../src/player/session-descriptor");
const { absoluteSuppliedMediaPath } = require("./supplied-media");

const root = path.resolve(__dirname, "../..");

const PLAYER_COMMANDS = Object.freeze([
  "seek-backward",
  "seek-forward",
  "seek-backward-long",
  "seek-forward-long",
  "subtitle-previous",
  "subtitle-next",
  "frame-step-backward",
  "frame-step-forward",
  "volume-down",
  "volume-up",
  "speed-down",
  "speed-up",
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${description}`);
}

function terminateWindowsProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopProcess(child, processPid = child?.pid) {
  if (!child || !processPid || !isProcessAlive(processPid)) return;
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
  });
  child.kill("SIGTERM");
  await Promise.race([exited, delay(4000)]);
  if (isProcessAlive(processPid)) {
    if (process.platform === "win32") terminateWindowsProcessTree(processPid);
    else child.kill("SIGKILL");
    await Promise.race([exited, delay(4000)]);
  }
  await waitFor(() => !isProcessAlive(processPid), 5000, "mpv process tree shutdown");
}

async function main() {
  const executable = process.env.IINATAN_MPV || "mpv";
  const mediaPath = absoluteSuppliedMediaPath("IINATAN_E2E_MEDIA_PATH");
  const version = spawnSync(executable, ["--no-config", "--version"], {
    encoding: "utf8",
  });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );
  const mediaStat = await fs.stat(mediaPath).catch(() => null);
  if (!mediaStat?.isFile())
    throw new Error(`media path is not a regular file: ${mediaPath}`);

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-command-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-mpv-command-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  await fs.mkdir(sessionDirectory, { mode: 0o700 });

  const child = spawn(
    executable,
    [
      "--no-config",
      "--vo=null",
      "--ao=null",
      "--keep-open=yes",
      "--no-terminal",
      "--start=19",
      "--sid=1",
      `--input-ipc-server=${socketPath}`,
      `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
      `--title=iinatan-mpv-command-smoke`,
      mediaPath,
    ],
    {
      cwd: root,
      env: { ...process.env, IINATAN_SESSION_DIR: sessionDirectory },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let bridge = null;
  let processPid = child.pid;
  try {
    await waitFor(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      10000,
      "stock mpv command-smoke descriptor",
    );
    const descriptor = (await listDescriptors(sessionDirectory))[0];
    if (!descriptor) throw new Error("stock mpv command-smoke descriptor disappeared");
    processPid = descriptor.pid;
    bridge = new PlayerBridge(descriptor, { timeoutMs: 3000 });
    await bridge.connect();
    await waitFor(
      () =>
        typeof bridge.property("path") === "string" &&
        Number.isFinite(Number(bridge.property("time-pos"))),
      15000,
      "stock mpv media readiness",
    );

    const results = [];
    for (const command of PLAYER_COMMANDS) {
      try {
        await bridge.command(command);
        results.push({ command, ok: true });
      } catch (error) {
        results.push({
          command,
          ok: false,
          error: error.message,
          code: error.code || null,
        });
      }
    }
    for (const command of ["toggle-pause", "toggle-pause"]) {
      try {
        await bridge.command(command);
        results.push({ command, ok: true });
      } catch (error) {
        results.push({
          command,
          ok: false,
          error: error.message,
          code: error.code || null,
        });
      }
    }

    const report = {
      ok: results.every((result) => result.ok),
      mpv: version.stdout.split(/\r?\n/)[0],
      mediaPath,
      results,
      mode: "real-stock-mpv-command-routing-smoke",
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    bridge?.close();
    await stopProcess(child, processPid);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`mpv emitted diagnostics during command smoke: ${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`STOCK MPV COMMAND SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
