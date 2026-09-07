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
    path.join(os.tmpdir(), "iinatan-mpv-multi-session-").replace(/\\/g, "/"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  await fs.mkdir(sessionDirectory);

  const sessions = [
    { id: "multi-session-a", volume: 17 },
    { id: "multi-session-b", volume: 63 },
  ];
  const running = [];
  const bridges = [];
  const volumeValues = new Map();
  let descriptors = [];
  try {
    for (let index = 0; index < sessions.length; index++) {
      const socketPath =
        process.platform === "win32"
          ? `\\\\.\\pipe\\iinatan-mpv-multi-${process.pid}-${Date.now()}-${index}`
          : path.join(temporaryRoot, `mpv-${index}.sock`);
      running.push(
        spawnSession(
          executable,
          sessionDirectory,
          socketPath,
          sessions[index].id,
          `iinatan-mpv-multi-${index}`,
        ),
      );
    }

    await waitFor(
      async () => (await listDescriptors(sessionDirectory)).length === sessions.length,
      10000,
      "two isolated mpv session descriptors",
    );
    descriptors = await listDescriptors(sessionDirectory);
    if (new Set(descriptors.map((descriptor) => descriptor.pid)).size !== 2)
      throw new Error("the two mpv descriptors did not have distinct PIDs");
    if (new Set(descriptors.map((descriptor) => descriptor.sessionId)).size !== 2)
      throw new Error("the two mpv descriptors did not have distinct session IDs");
    if (descriptors.some((descriptor) => !isProcessAlive(descriptor.pid)))
      throw new Error("a descriptor pointed at a dead mpv process");
    if (sameSession(descriptors[0], descriptors[1]))
      throw new Error("the two mpv descriptors were treated as one session");

    for (const descriptor of descriptors) {
      const bridge = new PlayerBridge(descriptor, { timeoutMs: 3000 });
      const identity = await bridge.connect();
      if (!sameSession(identity, descriptor))
        throw new Error(`bridge identity did not match ${descriptor.sessionId}`);
      bridges.push(bridge);
    }

    const descriptorBySession = new Map(
      descriptors.map((descriptor) => [descriptor.sessionId, descriptor]),
    );
    for (const session of sessions) {
      const descriptor = descriptorBySession.get(session.id);
      const bridge = bridges.find(
        (candidate) => candidate.descriptor.sessionId === session.id,
      );
      if (!descriptor || !bridge) throw new Error(`missing bridge for ${session.id}`);
      await bridge.ipc.setProperty("volume", session.volume);
      const observedVolume = Number(await bridge.ipc.getProperty("volume"));
      if (observedVolume !== session.volume)
        throw new Error(`volume update did not apply for ${session.id}`);
      volumeValues.set(session.id, observedVolume);
    }

    for (const session of sessions) {
      const bridge = bridges.find(
        (candidate) => candidate.descriptor.sessionId === session.id,
      );
      if (Number(await bridge.ipc.getProperty("volume")) !== session.volume)
        throw new Error(`volume crossed session boundary for ${session.id}`);
    }

    console.log(
      JSON.stringify(
        {
          mpv: version.stdout.split(/\r?\n/)[0],
          sessionCount: descriptors.length,
          sessions: descriptors.map((descriptor) => ({
            sessionId: descriptor.sessionId,
            pid: descriptor.pid,
            ipcEndpoint: descriptor.ipcEndpoint,
            volume: volumeValues.get(descriptor.sessionId),
          })),
          identityIsolation: true,
          ipcPropertyIsolation: "volume",
          mode: "headless-stock-mpv-multiple-session-isolation-smoke",
        },
        null,
        2,
      ),
    );
  } finally {
    for (const bridge of bridges) bridge.close();
    for (const { child } of running) await stopProcess(child);
    await waitFor(
      async () => (await listDescriptors(sessionDirectory)).length === 0,
      3000,
      "both mpv session descriptor cleanup",
    ).catch(() => undefined);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  const diagnostics = running
    .map(({ getStderr }) => getStderr())
    .filter((value) => value && /error|fatal/i.test(value));
  if (diagnostics.length)
    console.warn(`mpv emitted diagnostics during smoke: ${diagnostics.join("\n")}`);
}

main().catch((error) => {
  console.error(`STOCK MPV MULTI-SESSION SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
