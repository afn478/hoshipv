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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForValue(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(75);
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
  await waitForValue(
    () => !isProcessAlive(processPid),
    5000,
    "mpv process tree shutdown",
  );
}

function firstSubtitleTrack(tracks, id) {
  return (
    tracks.find((track) => track?.type === "sub" && String(track.id) === String(id)) ||
    null
  );
}

async function main() {
  const configuredMediaPath = absoluteSuppliedMediaPath(
    "IINATAN_MEDIA_PATH",
    "IINATAN_E2E_MEDIA_PATH",
  );
  if (!configuredMediaPath) {
    console.log(
      "SKIP: set IINATAN_TEST_MEDIA_PATH or IINATAN_MEDIA_PATH to an existing media file for real-media stock-mpv evidence.",
    );
    return;
  }

  const mediaPath = path.resolve(configuredMediaPath);
  const mediaStat = await fs.stat(mediaPath);
  if (!mediaStat.isFile())
    throw new Error(`media path is not a regular file: ${mediaPath}`);

  const subtitleId =
    process.env.IINATAN_MEDIA_SUBTITLE_ID || process.env.IINATAN_E2E_SUBTITLE_ID || "1";
  const startSeconds = Number(
    process.env.IINATAN_MEDIA_START_SECONDS ||
      process.env.IINATAN_E2E_START_SECONDS ||
      "19",
  );
  if (!Number.isFinite(startSeconds) || startSeconds < 0)
    throw new Error("media start time must be a non-negative number");

  const executable = process.env.IINATAN_MPV || "mpv";
  const version = spawnSync(executable, ["--no-config", "--version"], {
    encoding: "utf8",
  });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-media-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-mpv-media-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  await fs.mkdir(sessionDirectory);

  const child = spawn(
    executable,
    [
      "--no-config",
      "--vo=null",
      "--ao=null",
      "--pause=no",
      "--keep-open=yes",
      "--no-terminal",
      `--start=${startSeconds}`,
      `--sid=${subtitleId}`,
      `--input-ipc-server=${socketPath}`,
      `--script=${path.join(root, "mpv", "iinatan.lua")}`,
      `--script-opts=iinatan-session-dir=${sessionDirectory},iinatan-ipc-endpoint=${socketPath}`,
      "--title=iinatan-mpv-media-smoke",
      mediaPath,
    ],
    {
      env: { ...process.env, IINATAN_SESSION_DIR: sessionDirectory },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.resume();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let bridge = null;
  let processPid = child.pid;
  try {
    await waitForValue(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      15000,
      "mpv session descriptor",
    );
    const descriptor = (await listDescriptors(sessionDirectory))[0];
    if (!descriptor) throw new Error("stock mpv media-smoke descriptor disappeared");
    processPid = descriptor.pid;

    bridge = new PlayerBridge(descriptor, { timeoutMs: 5000 });
    await bridge.connect();
    const input = await waitForValue(
      () => {
        const value = bridge.geometryInput();
        return value.primary.assFull ? value : null;
      },
      15000,
      "active embedded subtitle cue",
    );
    const tracks = bridge.property("track-list", []);
    const selectedTrack = firstSubtitleTrack(tracks, subtitleId);
    if (!selectedTrack)
      throw new Error(`selected subtitle track ${subtitleId} was not exposed`);
    if (bridge.property("path") !== mediaPath)
      throw new Error("mpv reported a different media path");
    const externalSubtitlePath =
      selectedTrack["external-filename"] || selectedTrack.externalFilename || "";
    const expectedSourcePath = selectedTrack.external
      ? externalSubtitlePath
      : mediaPath;
    if (!expectedSourcePath || input.primary.source?.path !== expectedSourcePath)
      throw new Error("bridge did not preserve subtitle source identity");
    if (input.primary.source.external !== (selectedTrack.external === true))
      throw new Error("bridge subtitle source type did not match mpv track metadata");
    if (
      !Number.isFinite(input.primary.startMs) ||
      !Number.isFinite(input.primary.endMs)
    )
      throw new Error("active subtitle cue did not expose finite timing");

    console.log(
      JSON.stringify(
        {
          mpv: version.stdout.split(/\r?\n/)[0],
          mediaPath,
          startSeconds,
          timePos: bridge.property("time-pos"),
          subtitle: {
            id: selectedTrack.id,
            title: selectedTrack.title || null,
            language: selectedTrack.lang || null,
            codec: selectedTrack.codec || null,
            external: selectedTrack.external === true,
            sourcePath: input.primary.source.path,
            ffIndex: input.primary.source.ffIndex,
            startMs: input.primary.startMs,
            endMs: input.primary.endMs,
            assFull: input.primary.assFull,
            extradataLength: input.primary.extradata.length,
          },
          mode: "headless-stock-mpv-real-media-smoke",
        },
        null,
        2,
      ),
    );
  } finally {
    bridge?.close();
    await stopProcess(child, processPid);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`mpv emitted diagnostics during media smoke: ${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`STOCK MPV MEDIA SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
