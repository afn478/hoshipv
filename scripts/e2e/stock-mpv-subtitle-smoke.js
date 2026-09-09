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
const fixtureDirectory = path.join(root, "tests", "fixtures");

function publicDiagnostic(value) {
  const text = String(value);
  const escapedRoot = root.replaceAll("\\", "\\\\");
  const escapedHome = os.homedir().replaceAll("\\", "\\\\");
  return text
    .replaceAll(root, "<repo>")
    .replaceAll(escapedRoot, "<repo>")
    .replaceAll(os.homedir(), "<home>")
    .replaceAll(escapedHome, "<home>");
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

function command(executable, args, description) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(new Error(`${description}: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${description} failed (${signal || `exit ${code}`}): ${stderr.trim()}`,
          ),
        );
    });
    child.stdout.resume();
  });
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

function firstTrack(tracks, id) {
  return (
    tracks.find(
      (track) => track && track.type === "sub" && String(track.id) === String(id),
    ) || null
  );
}

async function main() {
  const executable = process.env.IINATAN_MPV || "mpv";
  const ffmpeg = process.env.IINATAN_FFMPEG || "ffmpeg";
  const version = spawnSync(executable, ["--no-config", "--version"], {
    encoding: "utf8",
  });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );
  const ffmpegVersion = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
  if (ffmpegVersion.error || ffmpegVersion.status !== 0)
    throw new Error(
      `ffmpeg is unavailable for the deterministic video fixture: ${ffmpegVersion.error?.message || ffmpegVersion.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-subtitle-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const videoPath = path.join(temporaryRoot, "solid-background.mkv");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-mpv-subtitle-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  const primaryPath = path.join(fixtureDirectory, "stock-mpv-primary.srt");
  const secondaryPath = path.join(fixtureDirectory, "stock-mpv-secondary.ass");
  await fs.mkdir(sessionDirectory);

  let child = null;
  let bridge = null;
  let descriptorPath = null;
  let processPid = null;
  let stderr = "";
  try {
    await command(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x101820:s=640x360:r=24:d=6",
        "-an",
        "-c:v",
        "mpeg4",
        "-q:v",
        "4",
        "-pix_fmt",
        "yuv420p",
        "-y",
        videoPath,
      ],
      "deterministic video fixture generation",
    );

    child = spawn(
      executable,
      [
        "--no-config",
        "--vo=null",
        "--ao=null",
        "--pause=yes",
        "--keep-open=yes",
        `--input-ipc-server=${socketPath}`,
        `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
        `--sub-file=${primaryPath}`,
        `--sub-file=${secondaryPath}`,
        "--sid=1",
        "--secondary-sid=2",
        "--secondary-sub-visibility=yes",
        "--start=2",
        "--title=iinatan-mpv-subtitle-smoke",
        videoPath,
      ],
      {
        env: { ...process.env, IINATAN_SESSION_DIR: sessionDirectory },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdout.resume();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

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
    await bridge.connect();
    try {
      await waitFor(
        async () => bridge.property("sub-text/ass-full", ""),
        5000,
        "primary subtitle text",
      );
    } catch (error) {
      throw new Error(
        `${error.message}; observed=${JSON.stringify({
          sid: bridge.property("sid"),
          secondarySid: bridge.property("secondary-sid"),
          tracks: bridge.property("track-list"),
          primary: bridge.property("sub-text/ass-full"),
          secondary: bridge.property("secondary-sub-text"),
          time: bridge.property("time-pos"),
        })}`,
      );
    }

    const tracks = bridge.property("track-list", []);
    const primaryTrack = firstTrack(tracks, bridge.property("sid"));
    const secondaryTrack = firstTrack(tracks, bridge.property("secondary-sid"));
    const primaryText = bridge.property("sub-text/ass-full", "");
    const secondaryText = bridge.property("secondary-sub-text", "");
    const initial = bridge.geometryInput();
    if (!primaryTrack || !secondaryTrack)
      throw new Error(
        "selected primary and secondary subtitle tracks were not exposed",
      );
    if (!primaryText.includes("Primary"))
      throw new Error("stock mpv returned unexpected primary subtitle text");
    if (secondaryText && !secondaryText.includes("Secondary"))
      throw new Error("stock mpv returned unexpected secondary subtitle text");
    if (primaryText === secondaryText)
      throw new Error("primary and secondary subtitle properties were conflated");
    if (initial.primary.source?.path !== primaryPath)
      throw new Error("primary subtitle source identity was not preserved");
    if (initial.secondary.source?.path !== secondaryPath)
      throw new Error("secondary subtitle source identity was not preserved");

    const initialWindow = {
      primaryStartMs: initial.primary.startMs,
      primaryEndMs: initial.primary.endMs,
      secondaryStartMs: initial.secondary.startMs,
      secondaryEndMs: initial.secondary.endMs,
      timeMs: initial.timeMs,
    };
    if (!(initialWindow.primaryStartMs >= 1000 && initialWindow.primaryEndMs <= 4000))
      throw new Error(`unexpected subtitle timing: ${JSON.stringify(initialWindow)}`);
    const secondaryTimingReported =
      Number.isFinite(initialWindow.secondaryStartMs) &&
      Number.isFinite(initialWindow.secondaryEndMs);
    if (
      secondaryTimingReported &&
      !(initialWindow.secondaryStartMs >= 500 && initialWindow.secondaryEndMs <= 4500)
    )
      throw new Error(
        `unexpected secondary subtitle timing: ${JSON.stringify(initialWindow)}`,
      );

    async function setTimingProperty(name, value) {
      const generationBefore = bridge.identity().geometryGeneration;
      await bridge.ipc.setProperty(name, value);
      await waitFor(
        async () =>
          Math.abs(Number(bridge.property(name)) - value) < 0.000001 &&
          bridge.identity().geometryGeneration > generationBefore,
        5000,
        `${name} geometry invalidation`,
      );
      return {
        generationBefore,
        generationAfter: bridge.identity().geometryGeneration,
        observed: Number(bridge.property(name)),
      };
    }

    const timingControls = {
      primaryDelay: await setTimingProperty("sub-delay", 0.25),
      secondaryDelay: await setTimingProperty("secondary-sub-delay", -0.1),
      subtitleSpeed: await setTimingProperty("sub-speed", 1.05),
    };
    await bridge.ipc.setProperty("sub-delay", 0);
    await bridge.ipc.setProperty("secondary-sub-delay", 0);
    await bridge.ipc.setProperty("sub-speed", 1);
    await waitFor(
      async () =>
        Math.abs(Number(bridge.property("sub-delay"))) < 0.000001 &&
        Math.abs(Number(bridge.property("secondary-sub-delay"))) < 0.000001 &&
        Math.abs(Number(bridge.property("sub-speed")) - 1) < 0.000001,
      5000,
      "subtitle timing controls restore",
    );

    await bridge.ipc.setProperty("secondary-sid", 0);
    await waitFor(
      async () => Number(bridge.property("secondary-sid")) === 0,
      5000,
      "secondary track disable",
    );
    const secondaryWasDisabled = Number(bridge.property("secondary-sid")) === 0;

    await bridge.ipc.setProperty("secondary-sid", 2);
    await waitFor(
      async () => Number(bridge.property("secondary-sid")) === 2,
      5000,
      "secondary track restore",
    );

    await bridge.ipc.setProperty("time-pos", 5);
    await waitFor(
      async () => bridge.property("sub-text/ass-full", "").includes("After seek"),
      5000,
      "primary subtitle after seek",
    );
    const afterSeek = bridge.geometryInput();
    if (
      afterSeek.primary.startMs < 4500 ||
      !afterSeek.primary.assFull.includes("After seek")
    )
      throw new Error("seek did not expose the later primary subtitle event");

    console.log(
      publicDiagnostic(
        JSON.stringify(
          {
            mpv: version.stdout.split(/\r?\n/)[0],
            ffmpeg: ffmpegVersion.stdout.split(/\r?\n/)[0],
            descriptor: {
              sessionId: descriptor.sessionId,
              pid: descriptor.pid,
              ipcEndpoint: descriptor.ipcEndpoint,
            },
            tracks: {
              primary: {
                id: bridge.property("sid"),
                title: primaryTrack.title || null,
                externalFilename: primaryTrack["external-filename"] || null,
              },
              secondary: {
                id: bridge.property("secondary-sid"),
                title: secondaryTrack.title || null,
                externalFilename: secondaryTrack["external-filename"] || null,
              },
            },
            simultaneous: {
              primaryText,
              secondaryText,
              secondaryTextAvailable: !!secondaryText,
              secondaryTimingReported,
              secondaryAssFull: initial.secondary.assFull || null,
              secondaryPlainText: initial.secondary.plainText,
              ...initialWindow,
            },
            transitions: {
              secondaryDisabled: secondaryWasDisabled,
              secondaryRestored: Number(bridge.property("secondary-sid")) === 2,
              seekText: afterSeek.primary.assFull,
              seekStartMs: afterSeek.primary.startMs,
            },
            timingControls,
            mode: "headless-stock-mpv-subtitle-property-smoke",
          },
          null,
          2,
        ),
      ),
    );
  } finally {
    bridge?.close();
    if (child) await stopProcess(child, processPid || child.pid);
    if (descriptorPath) {
      // SIGTERM is not guaranteed to run Lua's shutdown callback on Windows.
      // The process is confirmed dead above, so remove only this test's file.
      await fs.rm(descriptorPath, { force: true });
      await fs.rm(`${descriptorPath}.next`, { force: true });
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(
      `mpv emitted diagnostics during subtitle smoke: ${publicDiagnostic(stderr.trim())}`,
    );
}

main().catch((error) => {
  console.error(`STOCK MPV SUBTITLE SMOKE FAILED: ${publicDiagnostic(error.message)}`);
  process.exitCode = 1;
});
