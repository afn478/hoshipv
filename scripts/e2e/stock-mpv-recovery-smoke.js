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
      `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
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

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
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
    path.join(os.tmpdir(), "iinatan-mpv-recovery-").replace(/\\/g, "/"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  await fs.mkdir(sessionDirectory);
  const crashedSession = {
    id: "recovery-crashed",
    socket: path.join(temporaryRoot, "crashed.sock"),
  };
  const replacementSession = {
    id: "recovery-replacement",
    socket: path.join(temporaryRoot, "replacement.sock"),
  };
  let crashed = null;
  let replacement = null;
  let replacementBridge = null;
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
    const crashedPid = crashedDescriptor.pid;

    crashed.child.kill("SIGKILL");
    await new Promise((resolve) => crashed.child.once("exit", resolve));
    if (isProcessAlive(crashedPid))
      throw new Error("the crashed mpv process remained alive after SIGKILL");

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
    await stopProcess(replacement?.child);
    await stopProcess(crashed?.child);
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
