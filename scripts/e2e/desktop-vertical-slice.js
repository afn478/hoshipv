"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { spawn, spawnSync } = require("node:child_process");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");
const { PlayerBridge } = require("../../src/player/player-bridge");
const { DictionaryCatalog } = require("../../src/services/dictionary-catalog");
const {
  recommendedDictionaryById,
} = require("../../src/services/recommended-dictionaries");
const { SettingsStore } = require("../../src/settings/settings-store");
const { HoshiWorker } = require("../../src/services/hoshi-worker");
const { decodePng } = require("./stock-mpv-pixel-oracle");
const {
  listDescriptors,
  readDescriptor,
} = require("../../src/player/session-descriptor");

const root = path.resolve(__dirname, "../..");
const fixture = path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass");
const secondaryFixture = path.join(
  root,
  "tests",
  "fixtures",
  "native-ass-geometry-secondary-smoke.ass",
);

function trace(stage, details = "") {
  if (process.env.IINATAN_E2E_DEBUG === "1")
    console.error(`[iinatan-e2e] ${stage}${details ? `: ${details}` : ""}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function summarizeLatencies(samples) {
  const summary = {};
  for (const [name, values] of Object.entries(samples)) {
    if (!values.length) continue;
    const sorted = [...values].sort((left, right) => left - right);
    const quantile = (fraction) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
    summary[name] = {
      count: sorted.length,
      minMs: Number(sorted[0].toFixed(3)),
      p50Ms: Number(quantile(0.5).toFixed(3)),
      p95Ms: Number(quantile(0.95).toFixed(3)),
      maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
      samplesMs: sorted.map((value) => Number(value.toFixed(3))),
    };
  }
  return summary;
}

function beforeCapturePath(value) {
  const extension = String(value).match(/(\.[^./]+)$/)?.[1] || "";
  return extension
    ? `${value.slice(0, -extension.length)}.before${extension}`
    : `${value}.before`;
}

async function waitForValue(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(75);
  }
  throw new Error(
    `timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function commandOutput(executable, args, description) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${description} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  const lines = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(lines[index]);
    } catch (_) {}
  }
  throw new Error(`${description} returned no JSON result`);
}

function run(executable, args, description) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(new Error(`${description}: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
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

function startScreenRecording(outputPath, durationSeconds) {
  if (process.platform !== "darwin") return null;
  const child = spawn(
    "screencapture",
    ["-m", "-v", `-V${durationSeconds}`, "-C", "-k", "-x", outputPath],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    durationSeconds,
    outputPath,
    stderr: () => stderr,
    exited,
  };
}

async function finishScreenRecording(recording) {
  if (!recording) return null;
  const exit = await recording.exited;
  const stat = await fs.stat(recording.outputPath).catch(() => null);
  return {
    enabled: true,
    durationSeconds: recording.durationSeconds,
    exitCode: exit.code,
    signal: exit.signal,
    bytes: stat?.size || 0,
    output: "desktop-interaction.mov",
    stderr: recording.stderr(),
  };
}

function processAlive(child) {
  if (!child?.pid) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (error) {
    if (error.code !== "ESRCH" || process.platform === "win32")
      return error.code !== "ESRCH";
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (groupError) {
      return groupError.code !== "ESRCH";
    }
  }
}

function signalProcessGroup(child, signal) {
  const target = process.platform === "win32" ? child.pid : -child.pid;
  process.kill(target, signal);
}

async function stopProcess(child) {
  if (!processAlive(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    signalProcessGroup(child, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exited, delay(4000)]);
  if (processAlive(child)) {
    try {
      signalProcessGroup(child, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([exited, delay(1000)]);
  }
}

async function requestMpvQuit(socketPath) {
  await new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve();
    };
    timer = setTimeout(finish, 1000);
    socket.once("error", finish);
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ command: ["quit"] })}\n`, finish),
    );
  });
}

async function probeMpvIpc(endpoint) {
  const ipc = new MpvJsonIpc(endpoint, { timeoutMs: 2000 });
  try {
    return await ipc.getProperty("pause");
  } finally {
    ipc.close();
  }
}

async function waitForMpvIpc(endpoint, timeoutMs = 10000) {
  return waitForValue(
    async () => {
      try {
        await probeMpvIpc(endpoint);
        return true;
      } catch (error) {
        trace("probe-ipc-retry", error.message);
        throw error;
      }
    },
    timeoutMs,
    "stock mpv JSON IPC readiness",
  );
}

async function focusNativeWindow(nativeWindow, descriptor, attempts = 5) {
  let lastResult = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      lastResult = await nativeWindow.focus(descriptor);
      if (lastResult.isForeground === true && lastResult.foregroundVerified === true)
        return lastResult;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await delay(250);
  }
  if (lastResult) return lastResult;
  throw lastError || new Error("native player focus failed without a result");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function statusAt(filePath) {
  try {
    return await readJson(filePath);
  } catch (_) {
    return null;
  }
}

async function copyIfPresent(source, target) {
  if (!source || !target) return false;
  if (path.resolve(source) === path.resolve(target)) return true;
  try {
    await fs.copyFile(source, target);
    await fs.chmod(target, 0o600);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function preserveEvidence(directory, files, report) {
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, source] of Object.entries(files))
    await copyIfPresent(source, path.join(directory, name));
  await fs.writeFile(
    path.join(directory, "result.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function sessionStatus(status, sessionId) {
  return status?.sessions?.find((session) => session.sessionId === sessionId) || null;
}

function lookupableUnits(session) {
  return (session?.tracks || []).flatMap((track) =>
    (track.events || []).flatMap((event) =>
      (event.units || [])
        .filter((unit) => unit.lookupable !== false && unit.rects?.[0])
        .map((unit) => ({ track, event, unit })),
    ),
  );
}

function sampleUnits(units, count) {
  if (!units.length || count <= 0) return [];
  if (count >= units.length) return units;
  if (count === 1) return [units[0]];
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < count; index++) {
    const candidate = Math.round((index * (units.length - 1)) / (count - 1));
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    selected.push(units[candidate]);
  }
  return selected;
}

function pointerTarget(session, unit) {
  const content = session?.content;
  const osd = session?.osd;
  const rect = unit?.rects?.[0];
  if (!content || !osd || !rect)
    throw new Error(`cannot build pointer target for unit ${unit?.id || "unknown"}`);
  return {
    x: content.x + (rect.x + rect.width / 2) * (content.width / osd.width),
    y: content.y + (rect.y + rect.height / 2) * (content.height / osd.height),
  };
}

function nativePoint(value, desktopScale = 1) {
  if (process.platform !== "win32") return value;
  const scale = Math.max(1, Number(desktopScale) || 1);
  return { x: value.x * scale, y: value.y * scale };
}

function nativeInputReady(value) {
  return (
    value?.nativeInputReady === true ||
    (value?.accessibilityTrusted === true && value?.postEventTrusted === true)
  );
}

async function movePointerSmoothly(
  executable,
  start,
  end,
  steps = 12,
  statusPath = null,
  sessionId = null,
) {
  let finalMove = null;
  const samples = [];
  for (let index = 1; index <= steps; index++) {
    const fraction = index / steps;
    const x = start.x + (end.x - start.x) * fraction;
    const y = start.y + (end.y - start.y) * fraction;
    finalMove = commandOutput(
      executable,
      ["--move", String(x), String(y)],
      "native smooth popup-approach move",
    );
    await delay(16);
    if (statusPath && sessionId) {
      const session = sessionStatus(await statusAt(statusPath), sessionId);
      const sample = {
        step: index,
        x,
        y,
        popupVisible: session?.popupVisible === true,
        popupWindow: session?.popupWindow
          ? {
              visible: session.popupWindow.visible === true,
              focused: session.popupWindow.focused === true,
            }
          : null,
        interaction: session?.interaction || null,
        popupCloseReason: session?.lastPopupCloseReason || null,
        playerForeground: session?.source?.foreground !== false,
      };
      samples.push(sample);
      trace("native-popup-selection-approach-step", JSON.stringify(sample));
    }
  }
  return { steps, final: finalMove, samples };
}

function popupRegionDesktopRect(session, region) {
  const content = session?.content;
  const browserScale = Number(session?.browserScale) || 1;
  if (!content || !region) throw new Error("popup region telemetry is unavailable");
  return {
    x: content.x + region.x / browserScale,
    y: content.y + region.y / browserScale,
    width: region.width / browserScale,
    height: region.height / browserScale,
  };
}

function popupRegionPoint(session, region, horizontal = 0.5, vertical = 0.5) {
  const bounds = popupRegionDesktopRect(session, region);
  return {
    x: bounds.x + bounds.width * horizontal,
    y: bounds.y + bounds.height * vertical,
  };
}

function pointInRect(value, bounds) {
  return (
    Number.isFinite(value?.x) &&
    Number.isFinite(value?.y) &&
    Number.isFinite(bounds?.x) &&
    Number.isFinite(bounds?.y) &&
    Number.isFinite(bounds?.width) &&
    Number.isFinite(bounds?.height) &&
    value.x >= bounds.x &&
    value.x <= bounds.x + bounds.width &&
    value.y >= bounds.y &&
    value.y <= bounds.y + bounds.height
  );
}

function popupOutsidePanelPoint(windowBounds, panelBounds) {
  const inset = 10;
  const candidates = [
    { x: windowBounds?.x + inset, y: windowBounds?.y + inset },
    {
      x: windowBounds?.x + windowBounds?.width - inset,
      y: windowBounds?.y + inset,
    },
    {
      x: windowBounds?.x + inset,
      y: windowBounds?.y + windowBounds?.height - inset,
    },
    {
      x: windowBounds?.x + windowBounds?.width - inset,
      y: windowBounds?.y + windowBounds?.height - inset,
    },
    {
      x: windowBounds?.x + windowBounds?.width / 2,
      y: windowBounds?.y + windowBounds?.height - inset,
    },
  ];
  const point = candidates.find(
    (candidate) =>
      pointInRect(candidate, windowBounds) && !pointInRect(candidate, panelBounds),
  );
  if (!point)
    throw new Error(
      `popup has no native-testable outside-panel region: ${JSON.stringify({
        windowBounds,
        panelBounds,
      })}`,
    );
  return point;
}

async function compareCaptureRegion(
  beforePath,
  afterPath,
  placement,
  scale,
  captureOrigin = null,
) {
  if (!placement || !Number.isFinite(Number(scale)) || Number(scale) <= 0)
    return { ok: false, reason: "popup-placement-or-scale-unavailable" };
  const [beforeBuffer, afterBuffer] = await Promise.all([
    fs.readFile(beforePath),
    fs.readFile(afterPath),
  ]);
  const before = decodePng(beforeBuffer);
  const after = decodePng(afterBuffer);
  if (before.width !== after.width || before.height !== after.height)
    return {
      ok: false,
      reason: "capture-dimensions-differ",
      before: { width: before.width, height: before.height },
      after: { width: after.width, height: after.height },
    };
  const requested = {
    x: Math.floor(Number(placement.x) * scale - Number(captureOrigin?.x || 0)),
    y: Math.floor(Number(placement.y) * scale - Number(captureOrigin?.y || 0)),
    width: Math.ceil(Number(placement.width) * scale),
    height: Math.ceil(Number(placement.height) * scale),
  };
  const region = {
    x: Math.max(0, Math.min(after.width, requested.x)),
    y: Math.max(0, Math.min(after.height, requested.y)),
    width: Math.max(
      0,
      Math.min(after.width, requested.x + requested.width) - Math.max(0, requested.x),
    ),
    height: Math.max(
      0,
      Math.min(after.height, requested.y + requested.height) - Math.max(0, requested.y),
    ),
  };
  let changedPixels = 0;
  const threshold = 24;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const beforeOffset = y * before.stride + x * before.bytesPerPixel;
      const afterOffset = y * after.stride + x * after.bytesPerPixel;
      const delta =
        Math.abs(before.pixels[beforeOffset] - after.pixels[afterOffset]) +
        Math.abs(before.pixels[beforeOffset + 1] - after.pixels[afterOffset + 1]) +
        Math.abs(before.pixels[beforeOffset + 2] - after.pixels[afterOffset + 2]);
      if (delta > threshold) changedPixels++;
    }
  }
  const area = region.width * region.height;
  const minimumChangedPixels = Math.max(250, Math.floor(area * 0.02));
  return {
    ok: area > 0 && changedPixels >= minimumChangedPixels,
    threshold,
    requested,
    region,
    changedPixels,
    regionArea: area,
    changedFraction: area ? changedPixels / area : 0,
    minimumChangedPixels,
  };
}

function requiredExecutable(relative) {
  const configured = process.env[relative.env];
  const candidates = configured
    ? [path.resolve(configured)]
    : relative.paths.map((value) => path.join(root, value));
  return candidates.find((value) => fsSync.existsSync(value)) || "";
}

function codeSignature(executable) {
  if (process.platform !== "darwin" || !executable) return null;
  const marker = ".app/Contents/MacOS/";
  const markerIndex = executable.indexOf(marker);
  const bundle =
    markerIndex >= 0 ? executable.slice(0, markerIndex + ".app".length) : executable;
  const result = spawnSync("codesign", ["-dvvv", bundle], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return {
      bundle,
      available: false,
      error: result.error?.message || String(result.stderr || "codesign failed").trim(),
    };
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const field = (name) =>
    output.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() || null;
  const signature = field("Signature") || field("Authority");
  const teamIdentifier = field("TeamIdentifier");
  return {
    bundle,
    available: true,
    identifier: field("Identifier"),
    signature,
    teamIdentifier,
    cdHash: field("CDHash"),
    adHoc: signature === "adhoc" || /flags=.*adhoc/.test(output),
  };
}

async function main() {
  if (process.env.IINATAN_E2E !== "1") {
    console.log(
      "SKIP: native desktop evidence requires IINATAN_E2E=1 in an isolated graphical session.",
    );
    console.log(
      "This command refuses to treat DOM events or separate screenshots as desktop proof.",
    );
    return;
  }
  if (!["darwin", "linux", "win32"].includes(process.platform))
    throw new Error(
      `native desktop vertical slice does not support ${process.platform}`,
    );
  if (process.platform === "linux" && !process.env.DISPLAY)
    throw new Error("native desktop vertical slice requires an X11 DISPLAY on Linux");

  const mpv =
    process.env.IINATAN_MPV || (process.platform === "win32" ? "mpv.exe" : "mpv");
  const ffmpeg =
    process.env.IINATAN_FFMPEG ||
    (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const videoOutput = process.env.IINATAN_E2E_VO || "gpu-next";
  const gpuContext = process.env.IINATAN_E2E_GPU_CONTEXT || "";
  const macosRenderTimer = process.env.IINATAN_E2E_MACOS_RENDER_TIMER || "";
  const startPaused = process.env.IINATAN_E2E_START_PAUSED !== "0";
  const fullscreen = process.env.IINATAN_E2E_FULLSCREEN === "1";
  const allowApproximateGeometry = process.env.IINATAN_E2E_ALLOW_APPROXIMATE === "1";
  const requireStableSigning = process.env.IINATAN_E2E_REQUIRE_STABLE_SIGNING === "1";
  const additionalPointerProbeCount = Math.max(
    0,
    Math.floor(Number(process.env.IINATAN_E2E_ADDITIONAL_POINTER_PROBES) || 0),
  );
  const nativeInteractionMatrix = process.env.IINATAN_E2E_NATIVE_INTERACTION === "1";
  const smoothPopupApproach = process.env.IINATAN_E2E_SMOOTH_POPUP_APPROACH === "1";
  const screenRecordingEnabled = process.env.IINATAN_E2E_RECORD_SCREEN === "1";
  const screenRecordingSeconds = Math.max(
    5,
    Math.min(120, Math.ceil(Number(process.env.IINATAN_E2E_RECORD_SECONDS) || 20)),
  );
  const popupCaptureTimeoutMs = Math.max(
    1000,
    Math.floor(Number(process.env.IINATAN_E2E_POPUP_CAPTURE_TIMEOUT_MS) || 8000),
  );
  if (screenRecordingEnabled && process.platform !== "darwin")
    throw new Error("IINATAN_E2E_RECORD_SCREEN currently requires macOS screencapture");
  const lookupLanguage = process.env.IINATAN_E2E_LOOKUP_LANGUAGE || "en";
  const liveDictionaryId = process.env.IINATAN_E2E_DICTIONARY_DOWNLOAD_ID || "";
  const liveDictionary = liveDictionaryId.length > 0;
  const externalMediaPath = process.env.IINATAN_E2E_MEDIA_PATH
    ? path.resolve(process.env.IINATAN_E2E_MEDIA_PATH)
    : "";
  const subtitleId =
    process.env.IINATAN_E2E_SUBTITLE_ID || (externalMediaPath ? "1" : "");
  const secondarySubtitleId = process.env.IINATAN_E2E_SECONDARY_SUBTITLE_ID || "";
  const startSeconds = Number(
    process.env.IINATAN_E2E_START_SECONDS || (externalMediaPath ? "19" : "2"),
  );
  if (!Number.isFinite(startSeconds) || startSeconds < 0)
    throw new Error("IINATAN_E2E_START_SECONDS must be a non-negative number");
  const evidenceRoot = process.env.IINATAN_E2E_EVIDENCE_DIR
    ? path.resolve(process.env.IINATAN_E2E_EVIDENCE_DIR)
    : "";
  const nativeShim =
    process.platform === "darwin"
      ? requiredExecutable({
          env: "IINATAN_NATIVE_SHIM",
          paths: [
            "bin/iinatan-mpv-window-shim.so",
            "build/native/iinatan-mpv-window-shim.so",
          ],
        })
      : "";
  const nativeWindowExecutableName =
    process.platform === "win32" ? "iinatan-window-probe.exe" : "iinatan-window-probe";
  const windowProbe = requiredExecutable({
    env: "IINATAN_WINDOW_PROBE",
    paths: [
      `bin/${nativeWindowExecutableName}`,
      `build/native/${nativeWindowExecutableName}`,
      `build/native/Release/${nativeWindowExecutableName}`,
    ],
  });
  const nativeDesktopExecutableName =
    process.platform === "win32" ? "iinatan-desktop-test.exe" : "iinatan-desktop-test";
  const desktopTest = requiredExecutable({
    env: "IINATAN_DESKTOP_TEST",
    paths:
      process.platform === "darwin"
        ? [
            "build/native/iinatan-desktop-test.app/Contents/MacOS/iinatan-desktop-test",
            "build/native/iinatan-desktop-test",
          ]
        : [
            `build/native/${nativeDesktopExecutableName}`,
            `build/native/Release/${nativeDesktopExecutableName}`,
          ],
  });
  const mpvVersion = spawnSync(mpv, ["--version"], { encoding: "utf8" });
  const ffmpegVersion = externalMediaPath
    ? null
    : spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
  if (mpvVersion.error || mpvVersion.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${mpvVersion.error?.message || mpvVersion.stderr}`,
    );
  if (ffmpegVersion && (ffmpegVersion.error || ffmpegVersion.status !== 0))
    throw new Error(
      `ffmpeg is unavailable: ${ffmpegVersion.error?.message || ffmpegVersion.stderr}`,
    );
  if (!windowProbe || !desktopTest)
    throw new Error(
      "native window or desktop-test helper is unavailable; run npm run build:native",
    );
  const testHelperSignature = codeSignature(desktopTest);
  if (
    requireStableSigning &&
    (!testHelperSignature?.available || testHelperSignature.adHoc)
  )
    throw new Error(
      "stable macOS TCC evidence requires a non-ad-hoc signed iinatan-desktop-test.app; run npm run sign:native:macos first",
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-native-desktop-e2e-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const videoPath = externalMediaPath || path.join(temporaryRoot, "video.mkv");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-e2e-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  const mpvLogPath = path.join(temporaryRoot, "mpv.log");
  const inputConf = path.join(temporaryRoot, "input.conf");
  const statusPath = path.join(temporaryRoot, "electron-status.json");
  const userDataPath = path.join(temporaryRoot, "electron-data");
  const explicitCapture = process.env.IINATAN_E2E_CAPTURE_PATH
    ? path.resolve(process.env.IINATAN_E2E_CAPTURE_PATH)
    : null;
  const captureAfter = explicitCapture || path.join(temporaryRoot, "desktop-after.png");
  const captureBefore = explicitCapture
    ? beforeCapturePath(explicitCapture)
    : path.join(temporaryRoot, "desktop-before.png");
  const screenRecordingPath = path.join(temporaryRoot, "desktop-interaction.mov");
  await fs.mkdir(sessionDirectory);
  await fs.writeFile(inputConf, "MOUSE_BTN0 cycle pause\nESC quit\n", { mode: 0o600 });
  const mpvEnvironment = {
    ...process.env,
    IINATAN_SESSION_DIR: sessionDirectory,
  };
  delete mpvEnvironment.IINATAN_NATIVE_SHIM;

  let mpvProcess = null;
  let electronProcess = null;
  let bridge = null;
  let mpvStderr = "";
  let mpvLog = "";
  let electronStderr = "";
  let captureBeforeResult = null;
  let captureAfterResult = null;
  let popupVisualEvidence = null;
  let popupCaptureAttempts = 0;
  let inputCapability = null;
  let focusResult = null;
  let recordingFocusResult = null;
  let additionalFocusResult = null;
  let foregroundStatus = null;
  let lastElectronStatus = null;
  let lastElectronSession = null;
  let moveResult = null;
  const pointerProbes = [];
  const pointerProbeEscapes = [];
  let clickResult = null;
  let escapeResult = null;
  let popupStatus = null;
  let clickPause = null;
  let dismissalPause = null;
  let outsideClickResult = null;
  let outsideFocusResult = null;
  let outsideDismissalPause = null;
  let nativeInteraction = null;
  let selectionApproach = null;
  let screenRecorder = null;
  let screenRecordingResult = screenRecordingEnabled
    ? {
        enabled: true,
        durationSeconds: screenRecordingSeconds,
        output: "desktop-interaction.mov",
      }
    : { enabled: false };
  const latencySamples = {
    pointerToPopupMs: [],
    combinedCapturePopupMs: [],
    nativeSelectionMs: [],
    nativeScrollMs: [],
    additionalPointerPopupMs: [],
    popupDismissalMs: [],
    outsidePopupDismissalMs: [],
  };
  let fullscreenObserved = null;
  let fullscreenEvidence = "mpv-property-only";
  let liveDictionaryWorker = null;
  let liveDictionaryEvidence = null;
  let finalStatus = null;
  let descriptor = null;
  let playerWindow = null;
  let evidenceDirectory = "";
  let failure = null;
  try {
    if (liveDictionary) {
      const recommended = recommendedDictionaryById(liveDictionaryId);
      if (!recommended)
        throw new Error(`unknown live E2E dictionary: ${liveDictionaryId}`);
      if (lookupLanguage !== recommended.language)
        throw new Error(
          `live E2E dictionary ${liveDictionaryId} requires lookup language ${recommended.language}`,
        );
      const hoshiExecutable = requiredExecutable({
        env: "IINATAN_HOSHI",
        paths: [
          `bin/${process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts"}`,
        ],
      });
      if (!hoshiExecutable)
        throw new Error(
          "live dictionary E2E requires the bundled HoshiDicts executable",
        );
      const dictionarySettings = new SettingsStore(
        path.join(userDataPath, "settings.json"),
      );
      liveDictionaryWorker = new HoshiWorker({
        executable: hoshiExecutable,
        root: path.join(temporaryRoot, "dictionary-import-worker"),
        timeoutMs: Number(process.env.IINATAN_DICTIONARY_IMPORT_TIMEOUT_MS) || 1800000,
        pollMs: 4,
      });
      const dictionaryCatalog = new DictionaryCatalog({
        settingsStore: dictionarySettings,
        installRoot: path.join(userDataPath, "dictionaries"),
        worker: liveDictionaryWorker,
      });
      await dictionaryCatalog.load();
      let lastProgressAt = 0;
      const downloadStarted = Date.now();
      const entry = await dictionaryCatalog.downloadRecommended(liveDictionaryId, {
        downloadTimeoutMs:
          Number(process.env.IINATAN_DICTIONARY_DOWNLOAD_TIMEOUT_MS) || 900000,
        importTimeoutMs:
          Number(process.env.IINATAN_DICTIONARY_IMPORT_TIMEOUT_MS) || 1800000,
        lowRam: true,
        onProgress(progress) {
          const now = Date.now();
          if (now - lastProgressAt < 1000) return;
          lastProgressAt = now;
          trace(
            "dictionary-download",
            `${progress.bytes}/${progress.totalBytes || "?"} bytes`,
          );
        },
      });
      liveDictionaryEvidence = {
        id: entry.id,
        title: entry.title,
        language: entry.language,
        managedPath: path.relative(userDataPath, entry.path),
        downloadAndImportMs: Date.now() - downloadStarted,
      };
      await liveDictionaryWorker.stop();
      liveDictionaryWorker = null;
    }
    if (externalMediaPath) {
      const mediaStat = await fs.stat(externalMediaPath);
      if (!mediaStat.isFile())
        throw new Error(
          `IINATAN_E2E_MEDIA_PATH is not a regular file: ${externalMediaPath}`,
        );
      trace("external-media", `${externalMediaPath}; start=${startSeconds}s`);
    } else {
      trace("generate-video");
      await run(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x101820:s=1280x720:r=24:d=12",
          "-an",
          "-c:v",
          "ffv1",
          "-level",
          "3",
          "-pix_fmt",
          "yuv420p",
          "-y",
          videoPath,
        ],
        "deterministic desktop video generation",
      );
    }
    trace("video-ready");
    const subtitleArguments = externalMediaPath
      ? [
          ...(subtitleId ? [`--sid=${subtitleId}`] : []),
          ...(secondarySubtitleId
            ? [
                `--secondary-sid=${secondarySubtitleId}`,
                "--secondary-sub-visibility=yes",
              ]
            : []),
        ]
      : [
          `--sub-file=${fixture}`,
          `--sub-file=${secondaryFixture}`,
          "--sid=1",
          "--secondary-sid=2",
          "--secondary-sub-visibility=yes",
        ];
    mpvProcess = spawn(
      mpv,
      [
        "--no-config",
        // Create the stock-mpv window before initialization so the native
        // desktop probe can attach without stalling JSON IPC.
        "--force-window=immediate",
        "--no-osc",
        "--keep-open=yes",
        "--no-audio",
        "--no-terminal",
        ...(process.env.IINATAN_E2E_DEBUG === "1"
          ? [`--log-file=${mpvLogPath}`, "--msg-level=all=debug"]
          : []),
        ...(fullscreen ? ["--fs=yes"] : []),
        `--vo=${videoOutput}`,
        ...(gpuContext ? [`--gpu-context=${gpuContext}`] : []),
        ...(process.platform === "darwin" && macosRenderTimer
          ? [`--macos-render-timer=${macosRenderTimer}`]
          : []),
        "--pause=no",
        `--start=${startSeconds}`,
        "--geometry=1280x720+320+180",
        `--input-conf=${inputConf}`,
        `--input-ipc-server=${socketPath}`,
        ...(nativeShim ? [`--script=${nativeShim}`] : []),
        `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
        `--script-opts=iinatan-session-dir=${sessionDirectory},iinatan-ipc-endpoint=${socketPath}`,
        ...subtitleArguments,
        "--title=iinatan-native-desktop-e2e",
        videoPath,
      ],
      {
        cwd: root,
        env: mpvEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      },
    );
    trace("mpv-started", `pid=${mpvProcess.pid}`);
    mpvProcess.stdout.resume();
    mpvProcess.stderr.setEncoding("utf8");
    mpvProcess.stderr.on("data", (chunk) => {
      mpvStderr += chunk;
    });
    await waitForValue(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      10000,
      "stock mpv session descriptor",
    );
    trace("descriptor-ready");
    // The native shim writes a sibling JSON sidecar; select the Lua descriptor
    // by its PID-named contract instead of relying on directory ordering.
    const descriptorFile = `${mpvProcess.pid}.json`;
    const descriptorPath = path.join(sessionDirectory, descriptorFile);
    descriptor = await readDescriptor(descriptorPath);
    trace("probe-ipc");
    try {
      await waitForMpvIpc(descriptor.ipcEndpoint);
    } catch (error) {
      throw new Error(
        `stock mpv JSON IPC was unavailable with video output ${videoOutput}: ${error.message}`,
      );
    }
    trace("ipc-ready");
    if (startPaused) {
      const startupIpc = new MpvJsonIpc(descriptor.ipcEndpoint, { timeoutMs: 3000 });
      try {
        await startupIpc.setProperty("pause", true);
        trace("paused-before-bridge");
      } finally {
        startupIpc.close();
      }
    }
    const nativeWindow = new NativeWindowAdapter({
      probeExecutable: windowProbe,
      resourceRoot: root,
      sessionDirectory,
      timeoutMs: 3000,
    });
    if (process.platform !== "darwin") {
      const rawWindow = await waitForValue(
        async () => {
          const value = await nativeWindow.probe(descriptor);
          return value?.ok === true && value.content ? value : null;
        },
        10000,
        "stock mpv native window probe",
      );
      const desktopScale = Math.max(1, Number(rawWindow.desktopScale) || 1);
      nativeWindow.screen = {
        screenToDipPoint: ({ x, y }) => ({
          x: Number(x) / desktopScale,
          y: Number(y) / desktopScale,
        }),
      };
    }
    bridge = new PlayerBridge(descriptor, { timeoutMs: 3000 });
    try {
      await bridge.connect();
    } catch (error) {
      throw new Error(
        `stock mpv JSON IPC stalled during property bridge with video output ${videoOutput}: ${error.message}`,
      );
    }
    await focusNativeWindow(nativeWindow, descriptor);
    fullscreenObserved = bridge.property("fullscreen");
    try {
      await waitForValue(
        () => bridge.property("sub-text/ass-full", ""),
        5000,
        "stock mpv subtitle event",
      );
      if (startPaused) {
        await bridge.setPause(true);
        await waitForValue(
          () => bridge.property("pause") === true,
          2000,
          "stock mpv pause ownership",
        );
      }
    } catch (error) {
      throw new Error(
        `${error.message}; videoOutput=${videoOutput}; observed=${JSON.stringify({
          time: bridge.property("time-pos"),
          path: bridge.property("path"),
          sid: bridge.property("sid"),
          tracks: bridge.property("track-list"),
          subtitle: bridge.property("sub-text/ass-full"),
        })}`,
      );
    }

    playerWindow = await waitForValue(
      async () => {
        const value = await nativeWindow.read(descriptor);
        return typeof value.fullscreenObserved === "boolean" &&
          value.fullscreenObserved !== fullscreen
          ? null
          : value;
      },
      10000,
      "stock mpv native window in the requested fullscreen state",
    );
    if (typeof playerWindow.fullscreenObserved === "boolean") {
      fullscreenObserved = playerWindow.fullscreenObserved;
      fullscreenEvidence = playerWindow.fullscreenEvidence || "native-window-probe";
      if (fullscreenObserved !== fullscreen)
        throw new Error(
          `native fullscreen state ${fullscreenObserved} did not match requested ${fullscreen}`,
        );
    }
    captureBeforeResult = commandOutput(
      desktopTest,
      ["--capture", captureBefore],
      "desktop capture before Electron",
    );

    const electronArguments = [
      path.join(root, "scripts", "run-electron.js"),
      ".",
      ...(liveDictionary ? [] : ["--demo"]),
      `--lookup-language=${lookupLanguage}`,
      "--enable-patched-native-geometry",
      `--mpv-ipc=${descriptor.ipcEndpoint}`,
      `--mpv-pid=${descriptor.pid}`,
      `--session-id=${descriptor.sessionId}`,
      `--runtime-dir=${sessionDirectory}`,
      `--e2e-status-file=${statusPath}`,
      `--user-data-dir=${userDataPath}`,
    ];
    electronProcess = spawn(process.execPath, electronArguments, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    electronProcess.stdout.resume();
    electronProcess.stderr.setEncoding("utf8");
    electronProcess.stderr.on("data", (chunk) => {
      electronStderr += chunk;
    });

    finalStatus = await waitForValue(
      async () => {
        const status = await statusAt(statusPath);
        const session = sessionStatus(status, descriptor.sessionId);
        lastElectronStatus = status;
        lastElectronSession = session;
        const hasLookupUnit = session?.tracks?.some((track) =>
          track.events?.some((event) =>
            event.units?.some((unit) => unit.lookupable !== false),
          ),
        );
        const geometryReady =
          session?.source?.exact === true ||
          (allowApproximateGeometry && hasLookupUnit === true);
        return geometryReady && session.highlightWindow ? status : null;
      },
      20000,
      "Electron native geometry session",
    );
    if (liveDictionary && finalStatus.dictionary?.backend !== "hoshidicts")
      throw new Error(
        `live dictionary E2E expected the Hoshi backend, observed ${JSON.stringify(finalStatus.dictionary)}`,
      );
    focusResult = await focusNativeWindow(nativeWindow, descriptor);
    finalStatus = await waitForValue(
      async () => {
        const status = await statusAt(statusPath);
        const session = sessionStatus(status, descriptor.sessionId);
        if (session) foregroundStatus = session;
        return session?.source?.foreground === true ? status : null;
      },
      15000,
      "stock mpv foreground ownership",
    );
    const initialSession = sessionStatus(finalStatus, descriptor.sessionId);
    const track = initialSession.tracks?.find((value) => value.role === "primary");
    const unit = track?.events?.flatMap((event) => event.units || [])[0];
    if (!unit) throw new Error("Electron status did not publish a primary lookup unit");
    const target = pointerTarget(initialSession, unit);
    const inputScale = Math.max(1, Number(initialSession.desktopScale) || 1);
    const nativeTarget = nativePoint(target, inputScale);
    trace(
      "native-pointer-target",
      JSON.stringify({ target, nativeTarget, unit: unit.text }),
    );

    if (screenRecordingEnabled) {
      screenRecorder = startScreenRecording(
        screenRecordingPath,
        screenRecordingSeconds,
      );
      await delay(300);
      if (screenRecorder.child.exitCode !== null)
        throw new Error(
          `screen recording exited before the native interaction began: ${JSON.stringify(
            {
              exitCode: screenRecorder.child.exitCode,
              stderr: screenRecorder.stderr(),
            },
          )}`,
        );
      trace(
        "screen-recording-started",
        `${screenRecordingSeconds}s -> ${screenRecordingPath}`,
      );
      recordingFocusResult = await focusNativeWindow(nativeWindow, descriptor);
      if (
        recordingFocusResult.isForeground !== true ||
        recordingFocusResult.foregroundVerified !== true
      )
        throw new Error(
          `stock mpv foreground was not verified after starting screen recording: ${JSON.stringify(
            recordingFocusResult,
          )}`,
        );
      await delay(250);
    }
    const initialPointerStartedAt = performance.now();
    moveResult = commandOutput(
      desktopTest,
      ["--move", String(nativeTarget.x), String(nativeTarget.y)],
      "native pointer move",
    );
    inputCapability = {
      accessibilityTrusted: moveResult.accessibilityTrusted ?? null,
      postEventTrusted: moveResult.postEventTrusted ?? null,
      nativeInputReady: nativeInputReady(moveResult),
      permissionModel: moveResult.permissionModel || null,
    };
    popupStatus = await waitForValue(
      async () => {
        const status = await statusAt(statusPath);
        const session = sessionStatus(status, descriptor.sessionId);
        return session?.popupVisible &&
          session.popupWindow?.visible === true &&
          session.popupWindow?.focused === true &&
          session.popupMeasuredSize?.width > 0 &&
          session.popupMeasuredSize?.height > 0 &&
          session.popupPlacement &&
          session.cursorDiagnostic?.hit?.unitId === unit.id
          ? session
          : null;
      },
      5000,
      "dictionary popup after native pointer move",
    ).catch(() => null);
    if (popupStatus)
      trace(
        "popup-ready",
        JSON.stringify({
          placement: popupStatus.popupPlacement,
          measuredSize: popupStatus.popupMeasuredSize,
          popupWindow: popupStatus.popupWindow,
          surfaceReadiness: popupStatus.surfaceReadiness,
        }),
      );
    if (popupStatus)
      latencySamples.pointerToPopupMs.push(performance.now() - initialPointerStartedAt);

    if (popupStatus && inputCapability.nativeInputReady) {
      const captureDeadline = Date.now() + popupCaptureTimeoutMs;
      do {
        popupCaptureAttempts++;
        captureAfterResult = commandOutput(
          desktopTest,
          ["--capture", captureAfter],
          "desktop capture with Electron popup",
        );
        popupVisualEvidence = await compareCaptureRegion(
          captureBefore,
          captureAfter,
          popupStatus.popupPlacement,
          initialSession.desktopScale,
          captureAfterResult?.origin,
        );
        if (popupVisualEvidence.ok) {
          latencySamples.combinedCapturePopupMs.push(
            performance.now() - initialPointerStartedAt,
          );
          break;
        }
        trace("popup-capture-retry", JSON.stringify(popupVisualEvidence));
        if (Date.now() >= captureDeadline) break;
        await delay(150);
      } while (true);
      if (!popupVisualEvidence?.ok)
        throw new Error(
          `combined desktop capture did not show measurable popup pixels: ${JSON.stringify(
            popupVisualEvidence,
          )}`,
        );
      await waitForValue(
        async () => {
          const status = await statusAt(statusPath);
          const session = sessionStatus(status, descriptor.sessionId);
          return session?.popupVisible &&
            session.popupWindow?.visible === true &&
            session.popupWindow?.focused === true &&
            session.surfaceReadiness?.popup === true
            ? session
            : null;
        },
        5000,
        "interactive popup readiness before native click",
      );
      await delay(200);
      if (nativeInteractionMatrix) {
        const interactionStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupRegions?.headword && session.popupRegions.panel
              ? session
              : null;
          },
          5000,
          "popup native-interaction regions",
        );
        const panelRegion = interactionStatus.popupRegions.panel;
        const contentRegion = interactionStatus.popupRegions.content;
        const selectionRegion = contentRegion;
        const selectionStart = popupRegionPoint(
          interactionStatus,
          selectionRegion,
          0.08,
          0.5,
        );
        const selectionEnd = popupRegionPoint(
          interactionStatus,
          selectionRegion,
          0.92,
          0.5,
        );
        const nativeSelectionStart = nativePoint(selectionStart, inputScale);
        const nativeSelectionEnd = nativePoint(selectionEnd, inputScale);
        const popupWindowBounds = interactionStatus.popupWindow?.bounds;
        const popupPanelBounds = popupRegionDesktopRect(interactionStatus, panelRegion);
        if (
          !pointInRect(selectionStart, popupWindowBounds) ||
          !pointInRect(selectionEnd, popupWindowBounds) ||
          !pointInRect(selectionStart, popupPanelBounds) ||
          !pointInRect(selectionEnd, popupPanelBounds)
        )
          throw new Error(
            `native popup selection coordinates escaped the open popup: ${JSON.stringify(
              {
                popupWindowBounds,
                popupPanelBounds,
                selectionStart,
                selectionEnd,
              },
            )}`,
          );
        trace(
          "native-popup-selection-target",
          JSON.stringify({ selectionRegion, selectionStart, selectionEnd }),
        );
        if (smoothPopupApproach) {
          selectionApproach = await movePointerSmoothly(
            desktopTest,
            nativeTarget,
            nativeSelectionStart,
            12,
            statusPath,
            descriptor.sessionId,
          );
          trace("native-popup-selection-approach", JSON.stringify(selectionApproach));
          await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible &&
                session.popupWindow?.visible === true &&
                session.popupWindow?.focused === true
                ? session
                : null;
            },
            5000,
            "popup focus after smooth native approach",
          );
        }
        const selectionStartedAt = performance.now();
        const drag = commandOutput(
          desktopTest,
          [
            "--drag",
            String(nativeSelectionStart.x),
            String(nativeSelectionStart.y),
            String(nativeSelectionEnd.x),
            String(nativeSelectionEnd.y),
          ],
          "native popup text selection drag",
        );
        const selectedStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupSelectionText ? session : null;
          },
          5000,
          "native popup text selection",
        );
        latencySamples.nativeSelectionMs.push(performance.now() - selectionStartedAt);
        nativeInteraction = {
          regions: interactionStatus.popupRegions,
          inputBounds: {
            window: popupWindowBounds,
            panel: popupPanelBounds,
          },
          selection: {
            region: selectionRegion,
            start: selectionStart,
            end: selectionEnd,
            approach: selectionApproach,
            drag,
            text: selectedStatus.popupSelectionText,
          },
        };
        const popupScrollable =
          interactionStatus.popupMeasuredSize?.scrollable === true;
        nativeInteraction.scrollable = popupScrollable;
        if (!popupScrollable) {
          nativeInteraction.scroll = {
            skipped: true,
            reason: "popup-content-not-scrollable",
          };
        } else {
          const scrollPoint = popupRegionPoint(
            interactionStatus,
            panelRegion,
            0.5,
            0.75,
          );
          const nativeScrollPoint = nativePoint(scrollPoint, inputScale);
          if (
            !pointInRect(scrollPoint, popupWindowBounds) ||
            !pointInRect(scrollPoint, popupPanelBounds)
          )
            throw new Error(
              `native popup scroll coordinate escaped the open popup: ${JSON.stringify({
                popupWindowBounds,
                popupPanelBounds,
                scrollPoint,
              })}`,
            );
          const scrollStartedAt = performance.now();
          const scroll = commandOutput(
            desktopTest,
            [
              "--scroll",
              String(nativeScrollPoint.x),
              String(nativeScrollPoint.y),
              "-480",
            ],
            "native popup wheel scroll",
          );
          const scrolledStatus = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupScroll?.top > 0 ? session : null;
            },
            5000,
            "native popup scroll state",
          );
          latencySamples.nativeScrollMs.push(performance.now() - scrollStartedAt);
          nativeInteraction.scroll = {
            point: scrollPoint,
            input: scroll,
            state: scrolledStatus.popupScroll,
          };
        }
      }
      const placement = popupStatus.popupPlacement;
      const clickPoint = {
        x: Number(placement?.x) + 20,
        y: Number(placement?.y) + 20,
      };
      const nativeClickPoint = nativePoint(clickPoint, inputScale);
      clickResult = commandOutput(
        desktopTest,
        ["--click", String(nativeClickPoint.x), String(nativeClickPoint.y), "left"],
        "native popup click",
      );
      await delay(300);
      clickPause = bridge.property("pause");
      const dismissalStartedAt = performance.now();
      escapeResult = commandOutput(desktopTest, ["--key", "escape"], "native Escape");
      await waitForValue(
        async () => {
          const status = await statusAt(statusPath);
          const session = sessionStatus(status, descriptor.sessionId);
          return session && session.popupVisible === false ? session : null;
        },
        5000,
        "popup dismissal after native Escape",
      );
      latencySamples.popupDismissalMs.push(performance.now() - dismissalStartedAt);
      dismissalPause = bridge.property("pause");
      if (dismissalPause !== startPaused)
        throw new Error(
          "popup dismissal changed pause ownership unexpectedly (expected " +
            startPaused +
            ", observed " +
            dismissalPause +
            ")",
        );
      if (mpvProcess.exitCode !== null)
        throw new Error("native Escape leaked to mpv and closed the player");

      if (nativeInteractionMatrix) {
        outsideFocusResult = await focusNativeWindow(nativeWindow, descriptor);
        if (
          outsideFocusResult.isForeground !== true ||
          outsideFocusResult.foregroundVerified !== true
        )
          throw new Error(
            `stock mpv foreground was not verified before outside-click popup reopen: ${JSON.stringify(
              outsideFocusResult,
            )}`,
          );
        await delay(250);
        const reopenMove = commandOutput(
          desktopTest,
          ["--move", String(nativeTarget.x), String(nativeTarget.y)],
          "native pointer move to reopen popup for outside-click test",
        );
        await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupVisible && session.popupWindow?.visible === true
              ? session
              : null;
          },
          5000,
          "dictionary popup reopen for outside-click test",
        );
        const reopenedRegions = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupRegions?.panel ? session : null;
          },
          5000,
          "popup outside-click regions",
        );
        const outsideWindowBounds = reopenedRegions.popupWindow?.bounds;
        const outsidePanelBounds = popupRegionDesktopRect(
          reopenedRegions,
          reopenedRegions.popupRegions.panel,
        );
        const outsidePoint = popupOutsidePanelPoint(
          outsideWindowBounds,
          outsidePanelBounds,
        );
        const nativeOutsidePoint = nativePoint(outsidePoint, inputScale);
        if (
          !pointInRect(outsidePoint, outsideWindowBounds) ||
          pointInRect(outsidePoint, outsidePanelBounds)
        )
          throw new Error(
            `native outside-click coordinate was not outside the popup panel: ${JSON.stringify(
              {
                outsideWindowBounds,
                outsidePanelBounds,
                outsidePoint,
              },
            )}`,
          );
        const outsideDismissalStartedAt = performance.now();
        const outsideClick = commandOutput(
          desktopTest,
          [
            "--click",
            String(nativeOutsidePoint.x),
            String(nativeOutsidePoint.y),
            "left",
          ],
          "native popup outside-panel click",
        );
        await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session && session.popupVisible === false ? session : null;
          },
          5000,
          "popup dismissal after native outside-panel click",
        );
        latencySamples.outsidePopupDismissalMs.push(
          performance.now() - outsideDismissalStartedAt,
        );
        outsideDismissalPause = bridge.property("pause");
        if (outsideDismissalPause !== startPaused)
          throw new Error(
            "outside popup click changed pause ownership unexpectedly (expected " +
              startPaused +
              ", observed " +
              outsideDismissalPause +
              ")",
          );
        if (mpvProcess.exitCode !== null)
          throw new Error(
            "native outside popup click leaked to mpv and closed the player",
          );
        outsideClickResult = {
          focus: outsideFocusResult,
          reopenMove,
          windowBounds: outsideWindowBounds,
          panelBounds: outsidePanelBounds,
          point: outsidePoint,
          input: outsideClick,
        };
      }
    } else if (!inputCapability.nativeInputReady) {
      const missing = [];
      if (inputCapability.accessibilityTrusted === false) missing.push("Accessibility");
      if (inputCapability.postEventTrusted === false) missing.push("post-event access");
      if (!missing.length) missing.push("platform input helper");
      failure = `${process.platform} native input is unavailable (${missing.join(", ")})`;
    } else {
      failure = "native pointer move did not open the popup";
    }

    if (additionalPointerProbeCount > 0) {
      if (!popupStatus || !inputCapability.nativeInputReady)
        throw new Error(
          "additional native pointer probes require the initial popup and trusted native input",
        );
      additionalFocusResult = await focusNativeWindow(nativeWindow, descriptor);
      await waitForValue(
        async () => {
          const next = await nativeWindow.read(descriptor);
          return next.isForeground === true ? next : null;
        },
        15000,
        "stock mpv foreground before additional pointer probes",
      );
      await delay(250);
      const additionalUnits = lookupableUnits(initialSession).filter(
        (value) => value.unit.id !== unit.id,
      );
      const probes = sampleUnits(additionalUnits, additionalPointerProbeCount);
      if (!probes.length)
        throw new Error(
          "no additional lookupable subtitle units were available for probing",
        );
      for (const probe of probes) {
        const probeTarget = pointerTarget(initialSession, probe.unit);
        const nativeProbeTarget = nativePoint(probeTarget, inputScale);
        trace(
          "additional-pointer-probe-target",
          JSON.stringify({
            text: probe.unit.text,
            target: probeTarget,
            nativeTarget: nativeProbeTarget,
          }),
        );
        const probeStartedAt = performance.now();
        const probeMove = commandOutput(
          desktopTest,
          ["--move", String(nativeProbeTarget.x), String(nativeProbeTarget.y)],
          `native pointer probe for ${probe.unit.text}`,
        );
        trace("additional-pointer-probe-move", JSON.stringify(probeMove));
        if (!nativeInputReady(probeMove))
          throw new Error(
            `native pointer probe lost native input for ${probe.unit.text}: ${JSON.stringify(probeMove)}`,
          );
        const probeStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            const hit = session?.cursorDiagnostic?.hit;
            return session?.popupVisible &&
              session.popupMeasuredSize?.width > 0 &&
              session.popupMeasuredSize?.height > 0 &&
              hit?.unitId === probe.unit.id
              ? session
              : null;
          },
          5000,
          `dictionary popup for native pointer probe ${probe.unit.text}`,
        );
        latencySamples.additionalPointerPopupMs.push(
          performance.now() - probeStartedAt,
        );
        const observedHit = probeStatus.cursorDiagnostic?.hit;
        if (
          observedHit?.trackId !== probe.track.id ||
          observedHit?.eventId !== probe.event.id ||
          observedHit?.unitId !== probe.unit.id ||
          observedHit?.text !== probe.unit.text
        )
          throw new Error(
            `native pointer probe resolved the wrong source unit: ${JSON.stringify({
              expected: {
                trackId: probe.track.id,
                eventId: probe.event.id,
                unitId: probe.unit.id,
                text: probe.unit.text,
              },
              observed: observedHit,
            })}`,
          );
        pointerProbes.push({
          target: probeTarget,
          expected: {
            trackId: probe.track.id,
            eventId: probe.event.id,
            unitId: probe.unit.id,
            text: probe.unit.text,
          },
          observed: observedHit,
          geometryGeneration: probeStatus.geometryGeneration,
        });
        const probeEscape = commandOutput(
          desktopTest,
          ["--key", "escape"],
          `native Escape for pointer probe ${probe.unit.text}`,
        );
        pointerProbeEscapes.push(probeEscape);
        await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session && session.popupVisible === false ? session : null;
          },
          5000,
          `popup dismissal after native pointer probe ${probe.unit.text}`,
        );
        const probePause = bridge.property("pause");
        if (probePause !== startPaused)
          throw new Error(
            `pointer probe changed pause ownership (expected ${startPaused}, observed ${probePause})`,
          );
        if (mpvProcess.exitCode !== null)
          throw new Error(
            "native pointer probe Escape leaked to mpv and closed the player",
          );
        await focusNativeWindow(nativeWindow, descriptor);
      }
    }

    if (screenRecorder) {
      screenRecordingResult = await finishScreenRecording(screenRecorder);
      screenRecorder = null;
      if (screenRecordingResult.exitCode !== 0 || screenRecordingResult.bytes === 0)
        throw new Error(
          `screen recording did not produce a usable movie: ${JSON.stringify(
            screenRecordingResult,
          )}`,
        );
    }

    console.log(
      JSON.stringify(
        {
          mpv: mpvVersion.stdout.split(/\r?\n/)[0],
          ffmpeg: ffmpegVersion ? ffmpegVersion.stdout.split(/\r?\n/)[0] : null,
          mediaPath: externalMediaPath || null,
          startSeconds,
          subtitleId: subtitleId || null,
          secondarySubtitleId: secondarySubtitleId || null,
          videoOutput,
          gpuContext: gpuContext || null,
          macosRenderTimer: macosRenderTimer || null,
          startPaused,
          lookupLanguage,
          dictionaryMode: liveDictionary ? "live-hoshi" : "demo",
          dictionary: liveDictionaryEvidence,
          fullscreenRequested: fullscreen,
          fullscreenObserved,
          fullscreenEvidence,
          allowApproximateGeometry,
          additionalPointerProbeCount,
          nativeInteractionMatrix,
          nativeInteraction,
          latency: summarizeLatencies(latencySamples),
          pointerProbes,
          pointerProbeEscapes,
          requireStableSigning,
          testHelperSignature,
          descriptor: {
            sessionId: descriptor.sessionId,
            pid: descriptor.pid,
            ipcEndpoint: descriptor.ipcEndpoint,
          },
          playerWindow,
          electron: finalStatus,
          input: {
            capability: inputCapability,
            playerFocus: focusResult,
            recordingFocus: recordingFocusResult,
            move: moveResult,
            click: clickResult,
            escape: escapeResult,
            outsideClick: outsideClickResult,
          },
          capture: {
            before: captureBeforeResult,
            after: captureAfterResult,
            popupVisualEvidence,
            popupCaptureAttempts,
            combinedVisiblePopup: popupVisualEvidence?.ok === true,
          },
          screenRecording: screenRecordingResult,
          player: {
            pauseAfterPopupClick: clickPause,
            pauseAfterPopupDismiss: dismissalPause,
            pauseAfterOutsidePopupDismiss: outsideDismissalPause,
            aliveAfterEscape: mpvProcess.exitCode === null,
            aliveAfterOutsidePopupClick: mpvProcess.exitCode === null,
          },
          stderr: electronStderr.slice(-4000),
          platform: process.platform,
          mode: `native-desktop-combined-${process.platform}-e2e`,
          claim:
            popupVisualEvidence?.ok === true
              ? initialSession.source?.exact === true
                ? "real-stock-mpv-real-electron-windows-combined-capture-and-native-input"
                : "real-stock-mpv-real-electron-windows-combined-capture-and-native-input-with-approximate-geometry"
              : "blocked-before-native-input-or-combined-popup-capture",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const focusDetails = focusResult ? `; focus=${JSON.stringify(focusResult)}` : "";
    const additionalFocusDetails = additionalFocusResult
      ? `; additionalFocus=${JSON.stringify(additionalFocusResult)}`
      : "";
    const foregroundDetails = foregroundStatus
      ? `; observedForeground=${JSON.stringify(foregroundStatus.source?.foreground ?? null)}`
      : "";
    const electronDetails = lastElectronSession
      ? `; electronSource=${JSON.stringify(lastElectronSession.source)}; electronHighlight=${JSON.stringify(lastElectronSession.highlightWindow)}`
      : lastElectronStatus
        ? "; electronStatusHadNoMatchingSession=true"
        : "";
    const fullscreenDetails =
      fullscreenObserved === null ? "" : `; fullscreenObserved=${fullscreenObserved}`;
    failure ||= `${error.message}${focusDetails}${additionalFocusDetails}${foregroundDetails}${fullscreenDetails}${electronDetails}`;
    trace("failure", failure);
  } finally {
    trace("cleanup-start");
    if (screenRecorder) {
      try {
        screenRecordingResult = await finishScreenRecording(screenRecorder);
      } catch (error) {
        screenRecordingResult = {
          enabled: true,
          durationSeconds: screenRecordingSeconds,
          output: "desktop-interaction.mov",
          error: error.message,
        };
      }
      screenRecorder = null;
    }
    await liveDictionaryWorker?.stop().catch(() => {});
    bridge?.close();
    await stopProcess(electronProcess);
    await requestMpvQuit(socketPath).catch(() => {});
    await stopProcess(mpvProcess);
    if (process.env.IINATAN_E2E_DEBUG === "1")
      mpvLog = await fs.readFile(mpvLogPath, "utf8").catch(() => "");
    evidenceDirectory = evidenceRoot
      ? path.join(evidenceRoot, `run-${process.pid}-${Date.now()}`)
      : "";
    await preserveEvidence(
      evidenceDirectory,
      {
        "mpv.log": mpvLogPath,
        "mpv-stderr.log": path.join(temporaryRoot, "mpv-stderr.log"),
        "electron-status.json": statusPath,
        "electron-stderr.log": path.join(temporaryRoot, "electron-stderr.log"),
        "desktop-before.png": captureBefore,
        "desktop-after.png": captureAfter,
        "input.conf": inputConf,
        "desktop-interaction.mov": screenRecordingPath,
      },
      {
        protocol: 1,
        platform: process.platform,
        evidenceDirectory: evidenceDirectory || null,
        ok: !failure,
        failure,
        mpv: mpvVersion.stdout.split(/\r?\n/)[0],
        ffmpeg: ffmpegVersion ? ffmpegVersion.stdout.split(/\r?\n/)[0] : null,
        mediaPath: externalMediaPath || null,
        startSeconds,
        subtitleId: subtitleId || null,
        secondarySubtitleId: secondarySubtitleId || null,
        videoOutput,
        gpuContext: gpuContext || null,
        macosRenderTimer: macosRenderTimer || null,
        startPaused,
        lookupLanguage,
        dictionaryMode: liveDictionary ? "live-hoshi" : "demo",
        dictionary: liveDictionaryEvidence,
        fullscreenRequested: fullscreen,
        fullscreenObserved,
        fullscreenEvidence,
        allowApproximateGeometry,
        additionalPointerProbeCount,
        nativeInteractionMatrix,
        nativeInteraction,
        latency: summarizeLatencies(latencySamples),
        pointerProbes,
        pointerProbeEscapes,
        requireStableSigning,
        testHelperSignature,
        descriptor,
        playerWindow,
        electron: finalStatus || lastElectronStatus,
        foreground: foregroundStatus,
        focus: focusResult,
        recordingFocus: recordingFocusResult,
        additionalFocus: additionalFocusResult,
        input: {
          capability: inputCapability,
          move: moveResult,
          click: clickResult,
          escape: escapeResult,
          outsideClick: outsideClickResult,
        },
        capture: {
          before: captureBeforeResult,
          after: captureAfterResult,
          popupVisualEvidence,
          popupCaptureAttempts,
          combinedVisiblePopup: popupVisualEvidence?.ok === true,
        },
        screenRecording: screenRecordingResult,
        player: {
          pauseAfterPopupClick: clickPause,
          pauseAfterPopupDismiss: dismissalPause,
          pauseAfterOutsidePopupDismiss: outsideDismissalPause,
          aliveAfterEscape: mpvProcess?.exitCode === null,
          aliveAfterOutsidePopupClick: mpvProcess?.exitCode === null,
        },
        stderr: {
          mpv: mpvStderr.slice(-4000),
          electron: electronStderr.slice(-4000),
          mpvLogTail: mpvLog.slice(-4000),
        },
      },
    );
    if (evidenceDirectory) {
      await fs.writeFile(path.join(evidenceDirectory, "mpv-stderr.log"), mpvStderr, {
        mode: 0o600,
      });
      await fs.writeFile(
        path.join(evidenceDirectory, "electron-stderr.log"),
        electronStderr,
        { mode: 0o600 },
      );
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    trace("cleanup-done");
  }

  if (failure) {
    console.error(
      `NATIVE DESKTOP E2E BLOCKED: ${failure}\nevidence: ${evidenceDirectory || "none"}\nmpv stderr: ${mpvStderr.trim()}\nmpv log: ${mpvLog.slice(-4000).trim()}\nElectron stderr: ${electronStderr.trim()}`,
    );
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`NATIVE DESKTOP E2E BLOCKED: ${error.message}`);
  process.exitCode = 2;
});
