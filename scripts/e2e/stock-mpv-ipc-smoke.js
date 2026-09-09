"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { PlayerBridge } = require("../../src/player/player-bridge");
const {
  isProcessAlive,
  listDescriptors,
  readDescriptor,
} = require("../../src/player/session-descriptor");

const root = path.resolve(__dirname, "../..");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function terminateWindowsProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function stopProcess(child, processPid = child?.pid) {
  if (!processPid || !isProcessAlive(processPid)) return;
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
  const version = spawnSync(executable, ["--no-config", "--version"], {
    encoding: "utf8",
  });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-ipc-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-mpv-ipc-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  await fs.mkdir(sessionDirectory);

  const child = spawn(
    executable,
    [
      "--no-config",
      "--no-video",
      "--ao=null",
      "--idle=yes",
      "--keep-open=yes",
      `--input-ipc-server=${socketPath}`,
      `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
      "--title=iinatan-mpv-ipc-smoke",
    ],
    {
      env: { ...process.env, IINATAN_SESSION_DIR: sessionDirectory },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stdout.resume();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let bridge = null;
  let descriptorPath = null;
  let processPid = child.pid;
  try {
    let descriptors = [];
    await waitFor(
      async () => {
        descriptors = await listDescriptors(sessionDirectory);
        return descriptors.length === 1;
      },
      10000,
      "mpv session descriptor",
    );
    const descriptor = descriptors[0];
    processPid = descriptor.pid;
    descriptorPath = path.join(sessionDirectory, `${descriptor.pid}.json`);
    await readDescriptor(descriptorPath);

    bridge = new PlayerBridge(descriptor, { timeoutMs: 3000 });
    const identity = await bridge.connect();
    const geometry = bridge.geometryInput();
    console.log(
      JSON.stringify(
        {
          mpv: version.stdout.split(/\r?\n/)[0],
          descriptor: {
            sessionId: descriptor.sessionId,
            pid: descriptor.pid,
            windowId: descriptor.windowId,
            ipcEndpoint: descriptor.ipcEndpoint,
          },
          identity: {
            sessionId: identity.sessionId,
            pid: identity.pid,
            mediaGeneration: identity.mediaGeneration,
            geometryGeneration: identity.geometryGeneration,
          },
          geometry: {
            width: geometry.osd.width,
            height: geometry.osd.height,
            primaryAss: geometry.primary.assFull,
            secondaryAss: geometry.secondary.assFull,
          },
          mode: "headless-stock-mpv-ipc-smoke",
        },
        null,
        2,
      ),
    );
  } finally {
    bridge?.close();
    await stopProcess(child, processPid);
    if (descriptorPath) {
      // SIGTERM is not guaranteed to run Lua's shutdown callback on Windows.
      // The process is confirmed dead above, so remove only this test's file.
      await fs.rm(descriptorPath, { force: true });
      await fs.rm(`${descriptorPath}.next`, { force: true });
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`mpv emitted diagnostics during smoke: ${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`STOCK MPV IPC SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
