"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { PlayerBridge } = require("../../src/player/player-bridge");
const {
  isProcessAlive,
  listDescriptors,
  sameSession,
  readDescriptor,
} = require("../../src/player/session-descriptor");

const root = path.resolve(__dirname, "../..");

function ipcEndpoint(temporaryRoot, name) {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\iinatan-mpv-recovery-${process.pid}-${name}-${Date.now()}`
    : path.join(temporaryRoot, `${name}.sock`);
}

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

function spawnSession(executable, sessionDirectory, socketPath, sessionId, title) {
  const child = spawn(
    executable,
    [
      "--no-config",
      "--no-video",
      "--ao=null",
      "--idle=yes",
      "--keep-open=yes",
      `--input-ipc-server=${socketPath}`,
      `--script=${path.join(root, "mpv", "iinatan.lua")}`,
      `--script-opts=iinatan-session-id=${sessionId}`,
      `--title=${title}`,
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
  return { child, getStderr: () => stderr };
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

async function forceTerminateProcess(child, processPid = child?.pid) {
  if (!processPid || !isProcessAlive(processPid)) return;
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
  });
  if (process.platform === "win32") terminateWindowsProcessTree(processPid);
  else child.kill("SIGKILL");
  await Promise.race([exited, delay(4000)]);
  await waitFor(
    () => !isProcessAlive(processPid),
    5000,
    "forced mpv process termination",
  );
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
    path.join(os.tmpdir(), "iinatan-mpv-recovery-").replace(/\\/g, "/"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  await fs.mkdir(sessionDirectory);
  const crashedSession = {
    id: "recovery-crashed",
    socket: ipcEndpoint(temporaryRoot, "crashed"),
  };
  const replacementSession = {
    id: "recovery-replacement",
    socket: ipcEndpoint(temporaryRoot, "replacement"),
  };
  let crashed = null;
  let replacement = null;
  let replacementBridge = null;
  let crashedPid = null;
  let replacementPid = null;
  let staleDescriptorPath = null;
  const diagnostics = [];
  try {
    crashed = spawnSession(
      executable,
      sessionDirectory,
      crashedSession.socket,
      crashedSession.id,
      "iinatan-mpv-recovery-crashed",
    );
    await waitFor(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      10000,
      "crash-test mpv descriptor",
    );
    const crashedDescriptor = (await listDescriptors(sessionDirectory))[0];
    staleDescriptorPath = path.join(sessionDirectory, `${crashedDescriptor.pid}.json`);
    if (crashedDescriptor.sessionId !== crashedSession.id)
      throw new Error("crash-test descriptor had the wrong session identity");
    crashedPid = crashedDescriptor.pid;

    await forceTerminateProcess(crashed.child, crashedPid);

    await waitFor(
      async () => {
        const descriptors = await listDescriptors(sessionDirectory);
        return descriptors.some((descriptor) => descriptor.pid === crashedPid);
      },
      2000,
      "stale descriptor after forced mpv termination",
    );
    const staleDescriptors = await listDescriptors(sessionDirectory);
    if (staleDescriptors.filter((descriptor) => isProcessAlive(descriptor.pid)).length)
      throw new Error("a forced-termination descriptor was still considered live");

    replacement = spawnSession(
      executable,
      sessionDirectory,
      replacementSession.socket,
      replacementSession.id,
      "iinatan-mpv-recovery-replacement",
    );
    await waitFor(
      async () =>
        (await listDescriptors(sessionDirectory)).some(
          (descriptor) => descriptor.sessionId === replacementSession.id,
        ),
      10000,
      "replacement mpv descriptor",
    );
    const descriptors = await listDescriptors(sessionDirectory);
    const liveDescriptors = descriptors.filter((descriptor) =>
      isProcessAlive(descriptor.pid),
    );
    if (liveDescriptors.length !== 1)
      throw new Error(
        `expected one live replacement descriptor, got ${JSON.stringify(liveDescriptors)}`,
      );
    const replacementDescriptor = liveDescriptors[0];
    replacementPid = replacementDescriptor.pid;
    if (replacementDescriptor.sessionId !== replacementSession.id)
      throw new Error("stale descriptor won replacement discovery");
    const normalized = await readDescriptor(
      path.join(sessionDirectory, `${replacementDescriptor.pid}.json`),
    );
    replacementBridge = new PlayerBridge(normalized, { timeoutMs: 3000 });
    const identity = await replacementBridge.connect();
    if (!sameSession(identity, replacementDescriptor))
      throw new Error("replacement bridge identity did not match its descriptor");
    await replacementBridge.ipc.setProperty("volume", 41);
    if (Number(await replacementBridge.ipc.getProperty("volume")) !== 41)
      throw new Error("replacement mpv IPC did not recover after the crash");

    console.log(
      JSON.stringify(
        {
          mpv: version.stdout.split(/\r?\n/)[0],
          crashedPid,
          replacementPid: replacementDescriptor.pid,
          staleDescriptorIgnored: true,
          replacementIpcRecovered: true,
          mode: "headless-stock-mpv-crash-recovery-smoke",
        },
        null,
        2,
      ),
    );
  } finally {
    replacementBridge?.close();
    await stopProcess(replacement?.child, replacementPid);
    await stopProcess(crashed?.child, crashedPid);
    if (staleDescriptorPath)
      await fs.rm(staleDescriptorPath, { force: true }).catch(() => {});
    diagnostics.push(crashed?.getStderr?.() || "", replacement?.getStderr?.() || "");
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  const errors = diagnostics.filter((value) => value && /error|fatal/i.test(value));
  if (errors.length)
    console.warn(`mpv emitted diagnostics during smoke: ${errors.join("\n")}`);
}

main().catch((error) => {
  console.error(`STOCK MPV RECOVERY SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
