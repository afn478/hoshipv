"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");
const { launchMpv } = require("../../src/player/mpv-launcher");
const { readDescriptor } = require("../../src/player/session-descriptor");
const { absoluteSuppliedMediaPath } = require("./supplied-media");

const root = path.resolve(__dirname, "../..");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function existingNativeShim() {
  if (process.platform !== "darwin") return null;
  const candidates = [
    path.join(root, "build", "native", "iinatan-mpv-window-shim.so"),
    path.join(root, "bin", "iinatan-mpv-window-shim.so"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_) {}
  }
  return null;
}

async function stopChild(launch) {
  if (launch.child.exitCode === null) launch.child.kill("SIGTERM");
  await Promise.race([launch.closePromise, delay(5000)]);
  if (launch.child.exitCode === null) launch.child.kill("SIGKILL");
  await launch.closePromise;
}

async function main() {
  if (process.env.IINATAN_MPV_LAUNCHER_REQUIRED !== "1") {
    console.log(
      "SKIP: set IINATAN_MPV_LAUNCHER_REQUIRED=1 to run the real launcher smoke.",
    );
    return;
  }
  if (!["darwin", "linux", "win32"].includes(process.platform)) {
    throw new Error(`unsupported launcher smoke platform: ${process.platform}`);
  }

  const mediaPath = absoluteSuppliedMediaPath("IINATAN_MPV_LAUNCHER_MEDIA_PATH");
  const mediaStat = await fs.stat(mediaPath);
  assert.equal(
    mediaStat.isFile(),
    true,
    `media path is not a regular file: ${mediaPath}`,
  );
  const executable =
    process.env.IINATAN_MPV || (process.platform === "win32" ? "mpv.exe" : "mpv");
  const version = spawnSync(executable, ["--no-config", "--version"], {
    encoding: "utf8",
  });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-launcher-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const temporaryDirectory = os.tmpdir();
  let launch = null;
  let ipc = null;
  try {
    launch = await launchMpv({
      executable,
      mediaPath,
      nativeShimPath: await existingNativeShim(),
      resourceRoot: root,
      sessionDirectory,
      temporaryDirectory,
    });
    const descriptorPath = path.join(sessionDirectory, `${launch.child.pid}.json`);
    await waitFor(
      async () =>
        fs
          .access(descriptorPath)
          .then(() => true)
          .catch(() => false),
      15000,
      "real launcher session descriptor",
    );
    const descriptor = await readDescriptor(descriptorPath);
    assert.equal(descriptor.pid, launch.child.pid);
    assert.equal(descriptor.ipcEndpoint, launch.plan.ipcEndpoint);
    ipc = new MpvJsonIpc(descriptor.ipcEndpoint, { timeoutMs: 3000 });
    const pid = await ipc.getProperty("pid");
    assert.equal(Number(pid), launch.child.pid);
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "real-stock-mpv-launcher-smoke",
          mpv: version.stdout.split(/\r?\n/)[0],
          mediaPath,
          descriptor: {
            sessionId: descriptor.sessionId,
            pid: descriptor.pid,
            ipcEndpoint: descriptor.ipcEndpoint,
          },
          launch: {
            sessionScript: launch.plan.sessionScript,
            nativeShim: launch.plan.nativeShimPath,
            shell: launch.plan.spawnOptions.shell,
            stdio: launch.plan.spawnOptions.stdio,
            windowsHide: launch.plan.spawnOptions.windowsHide,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    ipc?.close();
    if (launch) await stopChild(launch);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`MPV LAUNCHER SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
