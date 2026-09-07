"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { PlayerBridge } = require("../../src/player/player-bridge");
const {
  listDescriptors,
  readDescriptor,
} = require("../../src/player/session-descriptor");

const root = path.resolve(__dirname, "../..");

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

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(4000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  const executable = process.env.IINATAN_MPV || "mpv";
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-ipc-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const socketPath = path.join(temporaryRoot, "mpv.sock");
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
  try {
    await waitFor(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      10000,
      "mpv session descriptor",
    );
    const descriptorFile = `${child.pid}.json`;
    descriptorPath = path.join(sessionDirectory, descriptorFile);
    const descriptor = await readDescriptor(descriptorPath);
    if (descriptor.pid !== child.pid)
      throw new Error(
        `descriptor PID ${descriptor.pid} does not match mpv PID ${child.pid}`,
      );

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
    await stopProcess(child);
    if (descriptorPath)
      await waitFor(
        async () =>
          !(await fs
            .access(descriptorPath)
            .then(() => true)
            .catch(() => false)),
        2000,
        "mpv session descriptor cleanup",
      );
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`mpv emitted diagnostics during smoke: ${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`STOCK MPV IPC SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
