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
const suppliedMedia =
  "/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv";

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
  const mediaPath = path.resolve(process.env.IINATAN_E2E_MEDIA_PATH || suppliedMedia);
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
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
  const socketPath = path.join(temporaryRoot, "mpv.sock");
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
  try {
    await waitFor(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      10000,
      "stock mpv command-smoke descriptor",
    );
    const descriptor = await readDescriptor(
      path.join(sessionDirectory, `${child.pid}.json`),
    );
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
    await stopProcess(child);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`mpv emitted diagnostics during command smoke: ${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`STOCK MPV COMMAND SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
