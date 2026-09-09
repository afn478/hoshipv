"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const http = require("node:http");
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
const { requestFor } = require("../../src/services/language-registry");
const { decodePng } = require("./stock-mpv-pixel-oracle");
const { listDescriptors } = require("../../src/player/session-descriptor");

const root = path.resolve(__dirname, "../..");
const fixture = path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass");
const secondaryFixture = path.join(
  root,
  "tests",
  "fixtures",
  "native-ass-geometry-secondary-smoke.ass",
);
const DEMO_LANGUAGE_TEXT = Object.freeze({
  ja: "日本語",
  en: "careful",
  de: "lesen",
  fr: "bonjour",
  ko: "한국어",
  zh: "中文",
});

function demoLanguageAss(text) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Geometry,Arial,48,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,0,0,2,24,24,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Geometry,,0,0,0,,${text}
`;
}

function trace(stage, details = "") {
  if (process.env.IINATAN_E2E_DEBUG === "1")
    console.error(`[iinatan-e2e] ${stage}${details ? `: ${details}` : ""}`);
}

function redactPathVariants(value, source, replacement) {
  let result = String(value);
  let variant = String(source || "");
  for (let depth = 0; variant && depth < 5; depth++) {
    result = result.replaceAll(variant, replacement);
    variant = variant.replaceAll("\\", "\\\\");
  }
  const slashVariant = String(source || "").replaceAll("\\", "/");
  if (slashVariant) result = result.replaceAll(slashVariant, replacement);
  return result;
}

function publicDiagnostic(value) {
  let text = String(value);
  text = redactPathVariants(text, root, "<repo>");
  text = redactPathVariants(text, os.homedir(), "<home>");
  return text;
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

async function synthesizeNativeControllerInput(
  statePath,
  { buttons = {}, axes = {}, pressedMs = 700, releaseMs = 450 } = {},
) {
  const normalizedStatePath = path.resolve(statePath);
  const temporaryPath = `${normalizedStatePath}.e2e-${process.pid}.next`;
  async function replaceStateFile() {
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporaryPath, normalizedStatePath);
        return;
      } catch (error) {
        const retryableWindowsLock =
          process.platform === "win32" &&
          ["EACCES", "EBUSY", "EPERM"].includes(error?.code);
        if (!retryableWindowsLock || attempt >= 80) throw error;
        await delay(25);
      }
    }
  }
  let sequence = Date.now();
  const writeState = async (pressed) => {
    const state = {
      protocol: 1,
      sequence: ++sequence,
      updatedAt: Date.now(),
      source: "native-hid",
      connected: true,
      id: "e2e-native-controller",
      buttons: pressed ? { ...buttons } : {},
      axes: pressed ? { leftY: 0, rightX: 0, rightY: 0, ...axes } : {},
    };
    await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await replaceStateFile();
  };
  // The live worker may have just reported a physical controller with a
  // different id. Prime the synthetic replacement with neutral state so the
  // router's iinatan-compatible device-swap gate can observe neutral before
  // accepting the first injected action.
  const neutralUntil = Date.now() + 120;
  while (Date.now() < neutralUntil) {
    await writeState(false);
    await delay(25);
  }
  const pressedUntil = Date.now() + Math.max(120, pressedMs);
  while (Date.now() < pressedUntil) {
    await writeState(true);
    await delay(25);
  }
  const releasedUntil = Date.now() + Math.max(120, releaseMs);
  while (Date.now() < releasedUntil) {
    await writeState(false);
    await delay(25);
  }
}

async function synthesizeNativeControllerButton(statePath, button, holdMs = 700) {
  return synthesizeNativeControllerInput(statePath, {
    buttons: { [button]: true },
    pressedMs: holdMs,
  });
}

function isBitmapSubtitleTrack(track) {
  return /pgs|hdmv|dvd|dvb|vobsub|xsub|bitmap/i.test(
    String(track?.codec || track?.["codec-desc"] || ""),
  );
}

function stockSubtitleEventReady(bridge) {
  if (bridge.property("sub-text/ass-full", "") || bridge.property("sub-text", ""))
    return true;
  const selectedId = bridge.property("sid");
  const selectedTrack = (bridge.property("track-list", []) || []).find(
    (track) => track?.type === "sub" && String(track.id) === String(selectedId),
  );
  if (!isBitmapSubtitleTrack(selectedTrack)) return false;
  const input = bridge.geometryInput();
  return Number.isFinite(input.primary.startMs) && Number.isFinite(input.primary.endMs);
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

function activateUnrelatedMacosApplication(applicationName) {
  const result = spawnSync("open", ["-a", applicationName], {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `could not activate unrelated macOS application ${applicationName}: ${
        result.error?.message || result.stderr || `exit ${result.status}`
      }`,
    );
  return {
    application: applicationName,
    command: "open -a",
    status: result.status,
  };
}

function windowsProcessIds(imageName) {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^"[^"]+","(\d+)"/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function terminateWindowsProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopUnrelatedWindowsApplication(application) {
  if (!application) return;
  await stopProcess(application.process);
  const before = new Set(application.beforePids || []);
  const cleanupPids = new Set(application.cleanupPids || []);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (const pid of windowsProcessIds("Notepad.exe")) {
      if (!before.has(pid)) cleanupPids.add(pid);
    }
    for (const pid of cleanupPids) {
      if (!before.has(pid)) terminateWindowsProcessTree(pid);
    }
    const remaining = windowsProcessIds("Notepad.exe").filter(
      (pid) => !before.has(pid),
    );
    if (!remaining.length) return;
    await delay(100);
  }
  const remaining = windowsProcessIds("Notepad.exe").filter((pid) => !before.has(pid));
  if (remaining.length)
    throw new Error(
      `unrelated Windows application cleanup left Notepad processes: ${remaining.join(",")}`,
    );
}

async function activateUnrelatedWindowsApplication(windowProbe) {
  const before = new Set(windowsProcessIds("Notepad.exe"));
  const application = spawn("notepad.exe", [], {
    // Keep Windows' spelling-service side effects out of the repository.
    cwd: os.tmpdir(),
    stdio: "ignore",
    windowsHide: false,
  });
  const cleanupPids = new Set([application.pid]);
  try {
    const activation = await waitForValue(
      async () => {
        const candidates = [application.pid, ...windowsProcessIds("Notepad.exe")];
        for (const pid of [...new Set(candidates)]) {
          const result = commandOutput(
            windowProbe,
            ["--pid", String(pid), "--activate"],
            "unrelated Windows application activation",
          );
          if (result?.foregroundVerified !== true) continue;
          if (!before.has(pid)) cleanupPids.add(pid);
          return { ...result, pid };
        }
        return null;
      },
      5000,
      "unrelated Windows application activation",
    );
    // Notepad remembers a maximized state on some Windows installations. Keep
    // the unrelated application visibly overlapping the player while leaving
    // a real player coordinate exposed for the native user-click recovery.
    // This uses the same Win32 window boundary as the production probe rather
    // than relying on a shell-specific window-management command.
    const windowPid = activation.pid || application.pid;
    const positioned = commandOutput(
      windowProbe,
      ["--pid", String(windowPid), "--set-bounds", "80", "80", "640", "360"],
      "unrelated Windows application positioning",
    );
    if (positioned?.ok !== true)
      throw new Error(
        `unrelated Windows application could not be positioned: ${JSON.stringify(
          positioned,
        )}`,
      );
    return {
      process: application,
      beforePids: [...before],
      evidence: {
        application: "Notepad",
        command: "notepad.exe",
        processPid: application.pid,
        windowPid,
        activation,
        positioned,
      },
      cleanupPids: [...cleanupPids],
    };
  } catch (error) {
    await stopUnrelatedWindowsApplication({ process: application, cleanupPids });
    throw error;
  }
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

function startAnkiConnectMock() {
  const calls = [];
  const server = http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ result: null, error: "method not allowed" }));
      return;
    }
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    request.on("end", () => {
      let message;
      try {
        if (size > 1024 * 1024) throw new Error("request too large");
        message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: null, error: error.message }));
        return;
      }
      const action = String(message.action || "");
      calls.push(action);
      let result = null;
      if (action === "version") result = 6;
      else if (action === "findNotes") result = [];
      else if (action === "addNote") result = 424242;
      else if (action === "storeMediaFile") result = message.params?.filename || null;
      else if (action === "guiBrowse") result = [424242];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ result, error: null }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        server,
        calls,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function startAudioSourceMock() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    if (requestUrl.pathname.startsWith("/audio/")) {
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end(Buffer.alloc(0));
      return;
    }
    const term = requestUrl.searchParams.get("term") || "";
    const reading = requestUrl.searchParams.get("reading") || "";
    requests.push({ term, reading });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        audioSources: Array.from({ length: 5 }, (_, index) => ({
          url: `http://127.0.0.1:${server.address().port}/audio/${index + 1}.mp3`,
          type: "audio/mpeg",
          name: `E2E voice ${index + 1}`,
        })),
      }),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${address.port}/?term={term}&reading={reading}`,
      });
    });
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
      detached: process.platform !== "win32",
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
  const timeoutMs = recording.durationSeconds * 1000 + 10000;
  let timeout;
  let timedOut = false;
  let exit = await new Promise((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, timeoutMs);
    recording.exited.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
  if (timedOut) {
    await stopProcess(recording.child);
    exit = await Promise.race([recording.exited, delay(1000)]);
  }
  const stat = await fs.stat(recording.outputPath).catch(() => null);
  return {
    enabled: true,
    durationSeconds: recording.durationSeconds,
    timeoutMs,
    timedOut,
    exitCode: exit?.code ?? null,
    signal: exit?.signal ?? null,
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

function recordPopupForeground(session, stage, samples) {
  if (process.platform !== "darwin") return;
  const foreground = session?.source?.foreground === true;
  samples.push({ stage, foreground });
  if (!foreground)
    throw new Error(
      `mpv lost foreground ownership while the non-activating popup was active at ${stage}: ${JSON.stringify(
        session?.source || null,
      )}`,
    );
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

const PUBLIC_TEXT_EVIDENCE_EXTENSIONS = new Set([".conf", ".json", ".log", ".txt"]);

async function copyPublicEvidence(source, target) {
  if (!source || !target) return false;
  if (path.resolve(source) === path.resolve(target)) return true;
  const extension = path.extname(String(source)).toLowerCase();
  if (!PUBLIC_TEXT_EVIDENCE_EXTENSIONS.has(extension))
    return copyIfPresent(source, target);
  try {
    const contents = await fs.readFile(source, "utf8");
    await fs.writeFile(target, publicDiagnostic(contents), { mode: 0o600 });
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
    await copyPublicEvidence(source, path.join(directory, name));
  await fs.writeFile(
    path.join(directory, "result.json"),
    `${publicDiagnostic(JSON.stringify(report, null, 2))}\n`,
    { mode: 0o600 },
  );
}

function sessionStatus(status, sessionId) {
  return status?.sessions?.find((session) => session.sessionId === sessionId) || null;
}

async function waitForStablePopupMetrics(
  statusPath,
  sessionId,
  regionNames,
  predicate,
  timeoutMs,
  description,
) {
  let previousSignature = null;
  let stableSince = 0;
  return waitForValue(
    async () => {
      const status = await statusAt(statusPath);
      const session = sessionStatus(status, sessionId);
      if (!session || (predicate && !predicate(session))) {
        previousSignature = null;
        stableSince = 0;
        return null;
      }
      const signature = JSON.stringify({
        popupPlacement: session.popupPlacement,
        popupMeasuredSize: session.popupMeasuredSize,
        regions: Object.fromEntries(
          regionNames.map((name) => [name, session.popupRegions?.[name] || null]),
        ),
      });
      if (signature !== previousSignature) {
        previousSignature = signature;
        stableSince = Date.now();
        return null;
      }
      return Date.now() - stableSince >= 225 ? session : null;
    },
    timeoutMs,
    description,
  );
}

function lookupableUnits(session) {
  return (session?.tracks || []).flatMap((track) =>
    (track.events || []).flatMap((event) =>
      (event.units || [])
        .filter(
          (unit) =>
            unit.lookupable !== false &&
            /[\p{L}\p{N}]/u.test(String(unit.text || "")) &&
            unit.rects?.[0],
        )
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

function lookupCompatibleUnit(candidate, language) {
  const unit = candidate?.unit;
  if (!unit) return false;
  const sourceText = unit.sourceText || candidate.event?.sourceText || unit.text;
  return !!requestFor(
    language,
    sourceText,
    Array.isArray(unit.utf16Range) ? unit.utf16Range[0] : 0,
    24,
  );
}

async function externalSubtitleCueCount(filePath) {
  if (!filePath) return null;
  try {
    const text = await fs.readFile(filePath, "utf8");
    return (text.match(/^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+/gmu) || []).length;
  } catch (_) {
    return null;
  }
}

function pointerResetTarget(session) {
  const content = session?.content;
  const osd = session?.osd;
  if (!content || !osd)
    throw new Error("cannot build pointer reset target without player geometry");
  const scaleX = content.width / osd.width;
  const scaleY = content.height / osd.height;
  const unitRects = lookupableUnits(session)
    .map(({ unit }) => unit)
    .flatMap((unit) => unit.rects?.slice(0, 1) || [])
    .map((rect) => ({
      x: content.x + rect.x * scaleX,
      y: content.y + rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    }));
  const inset = 8;
  const candidates = [
    { x: content.x + inset, y: content.y + inset },
    { x: content.x + content.width - inset, y: content.y + inset },
    { x: content.x + inset, y: content.y + content.height - inset },
    {
      x: content.x + content.width - inset,
      y: content.y + content.height - inset,
    },
    { x: content.x + content.width / 2, y: content.y + inset },
    { x: content.x + content.width / 2, y: content.y + content.height - inset },
  ];
  const point = candidates.find(
    (candidate) =>
      pointInRect(candidate, content) &&
      !unitRects.some((rect) => pointInRect(candidate, rect)),
  );
  if (!point)
    throw new Error(
      `player has no native-testable reset region outside subtitle units: ${JSON.stringify(
        { content, unitRects },
      )}`,
    );
  return point;
}

function nativePoint(value, desktopScale = 1) {
  if (process.platform !== "win32") return value;
  const scale = Math.max(1, Number(desktopScale) || 1);
  return { x: value.x * scale, y: value.y * scale };
}

function desktopCaptureArguments(outputPath, playerWindow) {
  const content = playerWindow?.content;
  if (process.platform !== "darwin" || !content) return ["--capture", outputPath];
  // CGWindowListCreateImage captures one display at a time on macOS. Select
  // the display containing the stock player so a test window on a secondary
  // monitor is compared against the matching capture instead of the main
  // display's empty pixels.
  return [
    "--capture-at",
    outputPath,
    String(Number(content.x) + Number(content.width) / 2),
    String(Number(content.y) + Number(content.height) / 2),
  ];
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
  captureScale = null,
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
  const pixelScale = Number(captureScale) > 0 ? Number(captureScale) : scale;
  const requested = {
    x: Math.floor(Number(placement.x) * pixelScale - Number(captureOrigin?.x || 0)),
    y: Math.floor(Number(placement.y) * pixelScale - Number(captureOrigin?.y || 0)),
    width: Math.ceil(Number(placement.width) * pixelScale),
    height: Math.ceil(Number(placement.height) * pixelScale),
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

function packagedApplicationExecutable(value) {
  const application = path.resolve(value);
  if (!application.endsWith(".app")) {
    if (fsSync.existsSync(application) && fsSync.statSync(application).isDirectory()) {
      const executableNames =
        process.platform === "win32"
          ? ["iinatan for mpv.exe", "iinatan-mp.exe"]
          : ["iinatan for mpv", "iinatan-mp"];
      for (const name of executableNames) {
        const executable = path.join(application, name);
        if (fsSync.existsSync(executable)) return executable;
      }
    }
    return application;
  }
  const executableNames = [path.basename(application, ".app"), "iinatan for mpv"];
  for (const name of new Set(executableNames)) {
    const executable = path.join(application, "Contents", "MacOS", name);
    if (fsSync.existsSync(executable)) return executable;
  }
  return application;
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
  const nativeFeatureParityRequested = process.env.IINATAN_E2E_FEATURE_PARITY === "1";
  const nativeNestedReplayRequested = process.env.IINATAN_E2E_NATIVE_NESTED === "1";
  const nativeControllerParity = process.env.IINATAN_E2E_CONTROLLER === "1";
  const manualControllerOnly = process.env.IINATAN_E2E_MANUAL_CONTROLLER === "1";
  const syntheticNativeController =
    process.env.IINATAN_E2E_CONTROLLER_SYNTHETIC === "1";
  const nativeResizeTransition = process.env.IINATAN_E2E_RESIZE_TRANSITION === "1";
  const nativeLifecycleCycles = Math.max(
    0,
    Math.min(
      24,
      Math.floor(Number(process.env.IINATAN_E2E_NATIVE_LIFECYCLE_CYCLES) || 0),
    ),
  );
  const demoLanguage = process.env.IINATAN_E2E_DEMO_LANGUAGE || "";
  const requestedFixtureLanguage = process.env.IINATAN_E2E_FIXTURE_LANGUAGE || "";
  const fixtureLanguage = requestedFixtureLanguage || demoLanguage;
  const smoothPopupApproach = process.env.IINATAN_E2E_SMOOTH_POPUP_APPROACH === "1";
  const packagedApplication = process.env.IINATAN_E2E_PACKAGED_APP
    ? packagedApplicationExecutable(process.env.IINATAN_E2E_PACKAGED_APP)
    : "";
  const screenRecordingEnabled = process.env.IINATAN_E2E_RECORD_SCREEN === "1";
  const screenRecordingSeconds = Math.max(
    5,
    Math.min(120, Math.ceil(Number(process.env.IINATAN_E2E_RECORD_SECONDS) || 20)),
  );
  const popupCaptureTimeoutMs = Math.max(
    1000,
    Math.floor(Number(process.env.IINATAN_E2E_POPUP_CAPTURE_TIMEOUT_MS) || 8000),
  );
  // A fresh live Hoshi worker can take several seconds to start on macOS.
  // Keep the cold lookup wait bounded, but do not turn worker startup variance
  // into a false native-input failure.
  const popupOpenTimeoutMs = Math.max(
    1000,
    Math.min(
      30000,
      Math.floor(Number(process.env.IINATAN_E2E_POPUP_OPEN_TIMEOUT_MS) || 15000),
    ),
  );
  if (screenRecordingEnabled && process.platform !== "darwin")
    throw new Error("IINATAN_E2E_RECORD_SCREEN currently requires macOS screencapture");
  if (nativeFeatureParityRequested && !["darwin", "win32"].includes(process.platform))
    throw new Error("IINATAN_E2E_FEATURE_PARITY currently requires macOS or Windows");
  if (nativeFeatureParityRequested && !nativeInteractionMatrix)
    throw new Error(
      "IINATAN_E2E_FEATURE_PARITY requires IINATAN_E2E_NATIVE_INTERACTION=1",
    );
  if (nativeNestedReplayRequested && !["darwin", "win32"].includes(process.platform))
    throw new Error("IINATAN_E2E_NATIVE_NESTED currently requires macOS or Windows");
  if (nativeNestedReplayRequested && !nativeInteractionMatrix)
    throw new Error(
      "IINATAN_E2E_NATIVE_NESTED requires IINATAN_E2E_NATIVE_INTERACTION=1",
    );
  if (nativeControllerParity && !["darwin", "win32"].includes(process.platform))
    throw new Error("IINATAN_E2E_CONTROLLER currently requires macOS or Windows");
  if (nativeControllerParity && !nativeInteractionMatrix)
    throw new Error("IINATAN_E2E_CONTROLLER requires IINATAN_E2E_NATIVE_INTERACTION=1");
  if (nativeResizeTransition && !["darwin", "win32"].includes(process.platform))
    throw new Error(
      "IINATAN_E2E_RESIZE_TRANSITION requires macOS or Windows native desktop evidence",
    );
  if (nativeLifecycleCycles > 0 && !["darwin", "win32"].includes(process.platform))
    throw new Error(
      "IINATAN_E2E_NATIVE_LIFECYCLE_CYCLES requires macOS or Windows native desktop evidence",
    );
  if (nativeLifecycleCycles > 0 && !nativeInteractionMatrix)
    throw new Error(
      "IINATAN_E2E_NATIVE_LIFECYCLE_CYCLES requires IINATAN_E2E_NATIVE_INTERACTION=1",
    );
  const lookupLanguage = process.env.IINATAN_E2E_LOOKUP_LANGUAGE || "en";
  const liveDictionaryId = process.env.IINATAN_E2E_DICTIONARY_DOWNLOAD_ID || "";
  const liveDictionary = liveDictionaryId.length > 0;
  if (nativeControllerParity && !liveDictionary)
    throw new Error(
      "IINATAN_E2E_CONTROLLER requires a live Hoshi dictionary so the native HID worker is active",
    );
  if (manualControllerOnly && !nativeControllerParity)
    throw new Error("IINATAN_E2E_MANUAL_CONTROLLER requires IINATAN_E2E_CONTROLLER=1");
  if (manualControllerOnly && syntheticNativeController)
    throw new Error(
      "IINATAN_E2E_MANUAL_CONTROLLER is for physical input; omit IINATAN_E2E_CONTROLLER_SYNTHETIC",
    );
  if (syntheticNativeController && !nativeControllerParity)
    throw new Error(
      "IINATAN_E2E_CONTROLLER_SYNTHETIC requires IINATAN_E2E_CONTROLLER=1",
    );
  if (
    requestedFixtureLanguage &&
    demoLanguage &&
    requestedFixtureLanguage !== demoLanguage
  )
    throw new Error(
      "IINATAN_E2E_DEMO_LANGUAGE and IINATAN_E2E_FIXTURE_LANGUAGE must match when both are set",
    );
  if (fixtureLanguage && !Object.hasOwn(DEMO_LANGUAGE_TEXT, fixtureLanguage))
    throw new Error(
      `IINATAN_E2E_*_LANGUAGE must be one of ${Object.keys(DEMO_LANGUAGE_TEXT).join(", ")}`,
    );
  const externalMediaPath = process.env.IINATAN_E2E_MEDIA_PATH
    ? path.resolve(process.env.IINATAN_E2E_MEDIA_PATH)
    : "";
  const externalSubtitlePath = process.env.IINATAN_E2E_SUBTITLE_PATH
    ? path.resolve(process.env.IINATAN_E2E_SUBTITLE_PATH)
    : "";
  if (fixtureLanguage && externalMediaPath)
    throw new Error(
      "IINATAN_E2E_*_LANGUAGE requires the generated deterministic demo media",
    );
  const subtitleId =
    process.env.IINATAN_E2E_SUBTITLE_ID ||
    (externalSubtitlePath ? "auto" : externalMediaPath ? "1" : "");
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
      ...(process.platform === "win32"
        ? [
            `build/native/windows-ninja/${nativeWindowExecutableName}`,
            `build/native/windows-ninja/Release/${nativeWindowExecutableName}`,
          ]
        : [
            `build/native/linux-ninja/${nativeWindowExecutableName}`,
            `build/native/linux-ninja/Release/${nativeWindowExecutableName}`,
          ]),
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
            `build/native/${process.platform === "win32" ? "windows-ninja" : "linux-ninja"}/${nativeDesktopExecutableName}`,
            `build/native/${process.platform === "win32" ? "windows-ninja" : "linux-ninja"}/Release/${nativeDesktopExecutableName}`,
          ],
  });
  const mpvVersion = spawnSync(mpv, ["--no-config", "--version"], {
    encoding: "utf8",
  });
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
  if (packagedApplication && !fsSync.existsSync(packagedApplication))
    throw new Error(
      `packaged Electron application is unavailable: ${packagedApplication}`,
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
  const primaryFixture = fixtureLanguage
    ? path.join(temporaryRoot, "demo-language.ass")
    : fixture;
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-e2e-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  const mpvLogPath = path.join(temporaryRoot, "mpv.log");
  const inputConf = path.join(temporaryRoot, "input.conf");
  const statusPath = path.join(temporaryRoot, "electron-status.json");
  const userDataPath = path.join(temporaryRoot, "electron-data");
  const iinatanDataRoot = path.join(userDataPath, "iinatan");
  const syntheticControllerStatePath = path.join(userDataPath, "controller-e2e.json");
  const explicitCapture = process.env.IINATAN_E2E_CAPTURE_PATH
    ? path.resolve(process.env.IINATAN_E2E_CAPTURE_PATH)
    : null;
  const captureAfter = explicitCapture || path.join(temporaryRoot, "desktop-after.png");
  const captureNested = path.join(temporaryRoot, "desktop-nested.png");
  const captureBefore = explicitCapture
    ? beforeCapturePath(explicitCapture)
    : path.join(temporaryRoot, "desktop-before.png");
  const screenRecordingPath = path.join(temporaryRoot, "desktop-interaction.mov");
  await fs.mkdir(sessionDirectory);
  if (fixtureLanguage)
    await fs.writeFile(
      primaryFixture,
      demoLanguageAss(DEMO_LANGUAGE_TEXT[fixtureLanguage]),
      {
        mode: 0o600,
      },
    );
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
  let nestedCaptureResult = null;
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
  let dismissalFocusResult = null;
  let popupStatus = null;
  let clickPause = null;
  let dismissalPause = null;
  let aliveAfterEscape = null;
  let outsideClickResult = null;
  let outsideResetMove = null;
  let outsideFocusResult = null;
  let outsideDismissalPause = null;
  let aliveAfterOutsidePopupClick = null;
  let nativeInteraction = null;
  let nativeHoverReplacement = null;
  let nativeFeatureParity = null;
  let nativeNestedReplay = null;
  let nativeController = null;
  let windowTransition = null;
  let controllerPointerReset = null;
  const popupForegroundSamples = [];
  const nativeLifecycle = [];
  let keyboardFocus = null;
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
    nativeLifecyclePopupMs: [],
    nativeLifecycleDismissalMs: [],
    additionalPointerPopupMs: [],
    popupDismissalMs: [],
    outsidePopupDismissalMs: [],
  };
  let fullscreenObserved = null;
  let fullscreenEvidence = "mpv-property-only";
  let liveDictionaryWorker = null;
  let liveDictionaryEvidence = null;
  let ankiMock = null;
  let ankiMockEvidence = null;
  let audioMock = null;
  let audioMockEvidence = null;
  let unrelatedWindowsProcess = null;
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
          `build/package-resources/${
            process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts"
          }`,
        ],
      });
      if (!hoshiExecutable)
        throw new Error(
          "live dictionary E2E requires the bundled HoshiDicts executable",
        );
      const dictionarySettings = new SettingsStore(
        path.join(iinatanDataRoot, "config.json"),
      );
      liveDictionaryWorker = new HoshiWorker({
        executable: hoshiExecutable,
        root: path.join(temporaryRoot, "dictionary-import-worker"),
        timeoutMs: Number(process.env.IINATAN_DICTIONARY_IMPORT_TIMEOUT_MS) || 1800000,
        pollMs: 4,
      });
      const dictionaryCatalog = new DictionaryCatalog({
        settingsStore: dictionarySettings,
        installRoot: path.join(iinatanDataRoot, "dictionaries"),
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
        managedPath: path.relative(iinatanDataRoot, entry.path),
        downloadAndImportMs: Date.now() - downloadStarted,
      };
      await liveDictionaryWorker.stop();
      liveDictionaryWorker = null;
    }
    if (
      nativeFeatureParityRequested ||
      nativeControllerParity ||
      nativeNestedReplayRequested
    ) {
      if (nativeFeatureParityRequested) ankiMock = await startAnkiConnectMock();
      if (nativeFeatureParityRequested || nativeControllerParity)
        audioMock = await startAudioSourceMock();
      const featureSettings = new SettingsStore(
        path.join(iinatanDataRoot, "config.json"),
      );
      await featureSettings.load();
      const activeProfileId = featureSettings.current().activeProfileId;
      await featureSettings.updateProfile(activeProfileId, (profile) => {
        // A live dictionary may intentionally exercise a language other than
        // the default Japanese profile. Keep the persisted worker language in
        // sync with the controller override; passing only --lookup-language
        // changes request routing but cannot reconfigure HoshiDicts.
        if (liveDictionary) profile.preferences.lookupLanguage = lookupLanguage;
        if (audioMock)
          profile.preferences.audioSourcesJson = JSON.stringify([
            { url: audioMock.url },
          ]);
        if (nativeNestedReplayRequested) {
          profile.preferences.nestedPopupMode = "click";
          profile.preferences.nestedPopupMaxDepth = 2;
        }
        if (nativeFeatureParityRequested) {
          profile.preferences.ankiEnabled = true;
          profile.preferences.ankiConnectUrl = ankiMock.url;
          profile.preferences.ankiDeckName = "Iinatan E2E";
          profile.preferences.ankiModelName = "Basic";
          profile.preferences.ankiFieldTemplatesJson = JSON.stringify({
            Front: "{expression}",
          });
          profile.preferences.customPopupCss = [
            "#popup {",
            "  background-color: rgb(236, 253, 245) !important;",
            "  border: 1px solid rgb(13, 148, 136) !important;",
            "}",
          ].join("\n");
        }
        if (nativeControllerParity) profile.preferences.controllerEnabled = true;
      });
    }
    if (externalMediaPath) {
      const mediaStat = await fs.stat(externalMediaPath);
      if (!mediaStat.isFile())
        throw new Error(
          `IINATAN_E2E_MEDIA_PATH is not a regular file: ${externalMediaPath}`,
        );
      if (externalSubtitlePath) {
        const subtitleStat = await fs.stat(externalSubtitlePath);
        if (!subtitleStat.isFile())
          throw new Error(
            `IINATAN_E2E_SUBTITLE_PATH is not a regular file: ${externalSubtitlePath}`,
          );
      }
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
          ...(externalSubtitlePath ? [`--sub-file=${externalSubtitlePath}`] : []),
          ...(subtitleId ? [`--sid=${subtitleId}`] : []),
          ...(secondarySubtitleId
            ? [
                `--secondary-sid=${secondarySubtitleId}`,
                "--secondary-sub-visibility=yes",
              ]
            : []),
        ]
      : [
          `--sub-file=${primaryFixture}`,
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
        `--script=${path.join(root, "mpv", "iinatan.lua")}`,
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
    const initialDescriptors = await waitForValue(
      async () => {
        const candidates = await listDescriptors(sessionDirectory);
        return candidates.length === 1 ? candidates : null;
      },
      10000,
      "stock mpv session descriptor",
    );
    trace("descriptor-ready");
    // The Lua descriptor carries the authoritative mpv PID. On Windows a
    // launcher can cause ChildProcess.pid to refer to an intermediate process,
    // so use the PID-named file when it matches and otherwise use the sole
    // descriptor in this isolated session directory.
    descriptor =
      initialDescriptors.find((candidate) => candidate.pid === mpvProcess.pid) ||
      initialDescriptors[0] ||
      null;
    if (!descriptor)
      throw new Error("stock mpv session descriptor identity was ambiguous");
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
        () => stockSubtitleEventReady(bridge),
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
          subtitle: {
            assFull: bridge.property("sub-text/ass-full"),
            plainText: bridge.property("sub-text"),
            startMs: bridge.geometryInput().primary.startMs,
            endMs: bridge.geometryInput().primary.endMs,
          },
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
      desktopCaptureArguments(captureBefore, playerWindow),
      "desktop capture before Electron",
    );

    const electronArguments = [
      ...(process.env.IINATAN_E2E_DISABLE_GPU === "1" ? ["--disable-gpu"] : []),
      ...(packagedApplication
        ? []
        : [path.join(root, "scripts", "run-electron.js"), "."]),
      ...(liveDictionary || nativeNestedReplayRequested ? [] : ["--demo"]),
      ...(allowApproximateGeometry ? ["--allow-approximate-geometry"] : []),
      `--lookup-language=${lookupLanguage}`,
      "--enable-patched-native-geometry",
      `--mpv-ipc=${descriptor.ipcEndpoint}`,
      `--mpv-pid=${descriptor.pid}`,
      `--session-id=${descriptor.sessionId}`,
      `--runtime-dir=${sessionDirectory}`,
      `--e2e-status-file=${statusPath}`,
      `--user-data-dir=${userDataPath}`,
    ];
    electronProcess = spawn(
      packagedApplication || process.execPath,
      electronArguments,
      {
        cwd: root,
        env: {
          ...process.env,
          ...(nativeNestedReplayRequested && !liveDictionary
            ? { IINATAN_E2E_DEMO_DICTIONARY: "1" }
            : {}),
          ...(syntheticNativeController
            ? { IINATAN_E2E_CONTROLLER_STATE_FILE: syntheticControllerStatePath }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      },
    );
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
    if (nativeControllerParity) {
      finalStatus = await waitForValue(
        async () => {
          const status = await statusAt(statusPath);
          const state = status?.controller?.state;
          const buttons = state?.buttons || {};
          return status?.controller?.source === "native-hid" &&
            state?.connected === true &&
            !Object.values(buttons).some(Boolean)
            ? status
            : null;
        },
        15000,
        "connected and released native HID controller",
      );
      nativeController = {
        capability: finalStatus.controller?.capability || null,
        initialState: finalStatus.controller?.state || null,
      };
    }
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
    const primaryLookupUnits = lookupableUnits(initialSession).filter(
      ({ track }) => track.role === "primary",
    );
    const initialLookup =
      primaryLookupUnits.find((candidate) =>
        lookupCompatibleUnit(candidate, lookupLanguage),
      ) || primaryLookupUnits[0];
    const unit = initialLookup?.unit;
    if (!initialLookup)
      throw new Error("Electron status did not publish a primary lookup unit");
    if (!lookupCompatibleUnit(initialLookup, lookupLanguage))
      throw new Error(
        `primary subtitle track has no unit compatible with lookup language ${lookupLanguage}`,
      );
    let activeLookup = initialLookup;
    let target = pointerTarget(initialSession, unit);
    const inputScale = Math.max(1, Number(initialSession.desktopScale) || 1);
    let nativeTarget = nativePoint(target, inputScale);
    trace(
      "native-pointer-target",
      JSON.stringify({ target, nativeTarget, unit: unit.text }),
    );

    if (manualControllerOnly)
      console.log(
        `MANUAL CONTROLLER SEQUENCE: the next prompts require physical input from the connected controller; the harness will assert each native-HID state and write normal evidence JSON. The initial subtitle target is ${nativeTarget.x},${nativeTarget.y}.`,
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
    trace("native-pointer-move-result", JSON.stringify(moveResult));
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
      popupOpenTimeoutMs,
      "dictionary popup after native pointer move",
    ).catch(() => null);
    if (!popupStatus) {
      const timeoutStatus = await statusAt(statusPath);
      const timeoutSession = sessionStatus(timeoutStatus, descriptor.sessionId);
      trace(
        "native-pointer-move-timeout",
        JSON.stringify({
          move: moveResult,
          session: timeoutSession
            ? {
                source: timeoutSession.source,
                cursorDiagnostic: timeoutSession.cursorDiagnostic,
                geometryGeneration: timeoutSession.geometryGeneration,
                popupVisible: timeoutSession.popupVisible,
                highlightWindow: timeoutSession.highlightWindow,
                popupWindow: timeoutSession.popupWindow,
              }
            : null,
        }),
      );
    }
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
      recordPopupForeground(popupStatus, "popup-open", popupForegroundSamples);
    if (popupStatus)
      latencySamples.pointerToPopupMs.push(performance.now() - initialPointerStartedAt);

    if (popupStatus && inputCapability.nativeInputReady) {
      const captureDeadline = Date.now() + popupCaptureTimeoutMs;
      do {
        popupCaptureAttempts++;
        captureAfterResult = commandOutput(
          desktopTest,
          desktopCaptureArguments(captureAfter, playerWindow),
          "desktop capture with Electron popup",
        );
        popupVisualEvidence = await compareCaptureRegion(
          captureBefore,
          captureAfter,
          popupStatus.popupPlacement,
          initialSession.desktopScale,
          captureAfterResult?.origin,
          captureAfterResult?.scale,
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
      if (nativeNestedReplayRequested) {
        let nestedRootStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupRegions?.["nested-reference"] &&
              session.popupRegions.panel
              ? session
              : null;
          },
          5000,
          "native nested lookup reference region",
        );
        let nestedReference = nestedRootStatus.popupRegions["nested-reference"];
        let nestedReferencePoint = popupRegionPoint(
          nestedRootStatus,
          nestedReference,
          0.5,
          0.5,
        );
        let nestedPanelBounds = popupRegionDesktopRect(
          nestedRootStatus,
          nestedRootStatus.popupRegions.panel,
        );
        let nestedScroll = null;
        if (!pointInRect(nestedReferencePoint, nestedPanelBounds)) {
          const scrollPoint = popupRegionPoint(
            nestedRootStatus,
            nestedRootStatus.popupRegions.panel,
            0.5,
            0.75,
          );
          if (!pointInRect(scrollPoint, nestedPanelBounds))
            throw new Error(
              `native nested-reference scroll coordinate escaped the root popup: ${JSON.stringify(
                { scrollPoint, nestedPanelBounds },
              )}`,
            );
          const scrollBefore = Number(nestedRootStatus.popupScroll?.top) || 0;
          const delta = nestedReferencePoint.y > nestedPanelBounds.y ? -480 : 480;
          const nativeScrollPoint = nativePoint(scrollPoint, inputScale);
          const scrollInput = commandOutput(
            desktopTest,
            [
              "--scroll",
              String(nativeScrollPoint.x),
              String(nativeScrollPoint.y),
              String(delta),
            ],
            "native scroll to nested lookup reference",
          );
          nestedRootStatus = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              const reference = session?.popupRegions?.["nested-reference"];
              const panel = session?.popupRegions?.panel;
              if (!reference || !panel) return null;
              const point = popupRegionPoint(session, reference, 0.5, 0.5);
              const bounds = popupRegionDesktopRect(session, panel);
              const scrollTop = Number(session.popupScroll?.top) || 0;
              const moved =
                (delta < 0 && scrollTop > scrollBefore) ||
                (delta > 0 && scrollTop < scrollBefore);
              return moved && pointInRect(point, bounds) ? session : null;
            },
            5000,
            "native nested lookup reference scroll",
          );
          nestedReference = nestedRootStatus.popupRegions["nested-reference"];
          nestedReferencePoint = popupRegionPoint(
            nestedRootStatus,
            nestedReference,
            0.5,
            0.5,
          );
          nestedPanelBounds = popupRegionDesktopRect(
            nestedRootStatus,
            nestedRootStatus.popupRegions.panel,
          );
          nestedScroll = {
            point: scrollPoint,
            input: scrollInput,
            before: scrollBefore,
            after: nestedRootStatus.popupScroll,
          };
        }
        if (
          !pointInRect(nestedReferencePoint, nestedRootStatus.popupWindow?.bounds) ||
          !pointInRect(nestedReferencePoint, nestedPanelBounds)
        )
          throw new Error(
            `native nested-reference coordinate escaped the root popup: ${JSON.stringify(
              { nestedReferencePoint, nestedPanelBounds },
            )}`,
          );
        const nestedPauseBefore = bridge.property("pause");
        const nativeNestedPoint = nativePoint(nestedReferencePoint, inputScale);
        const nestedClick = commandOutput(
          desktopTest,
          ["--click", String(nativeNestedPoint.x), String(nativeNestedPoint.y), "left"],
          "native nested lookup reference click",
        );
        const nestedResultStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.nestedPopupResult?.ok === true &&
              session.nestedPopupResult.depth === 1 &&
              session.popupRegions?.["nested-panel"]
              ? session
              : null;
          },
          5000,
          "native nested dictionary result",
        );
        const nestedPauseAfter = bridge.property("pause");
        if (nestedPauseAfter !== nestedPauseBefore)
          throw new Error(
            `native nested popup click changed player pause state: before=${nestedPauseBefore}, after=${nestedPauseAfter}`,
          );
        nestedCaptureResult = commandOutput(
          desktopTest,
          desktopCaptureArguments(captureNested, playerWindow),
          "desktop capture with native nested popup",
        );
        const nestedPanelCapture = await compareCaptureRegion(
          captureBefore,
          captureNested,
          popupRegionDesktopRect(
            nestedResultStatus,
            nestedResultStatus.popupRegions["nested-panel"],
          ),
          initialSession.desktopScale,
          nestedCaptureResult?.origin,
          nestedCaptureResult?.scale,
        );
        if (!nestedPanelCapture.ok)
          throw new Error(
            `combined desktop capture did not show the native nested popup: ${JSON.stringify(
              nestedPanelCapture,
            )}`,
          );
        recordPopupForeground(
          nestedResultStatus,
          "nested-popup",
          popupForegroundSamples,
        );
        const nestedEscape = commandOutput(
          desktopTest,
          ["--key", "escape"],
          "native Escape for nested popup",
        );
        const nestedClosedStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupVisible === true && session.nestedPopupResult === null
              ? session
              : null;
          },
          5000,
          "native nested popup Escape dismissal",
        );
        nativeNestedReplay = {
          mode: "native-click-and-capture",
          rootReference: nestedReference,
          scroll: nestedScroll,
          result: nestedResultStatus.nestedPopupResult,
          rootClick: nestedClick,
          nestedPanel: nestedResultStatus.popupRegions["nested-panel"],
          capture: nestedPanelCapture,
          pause: { before: nestedPauseBefore, after: nestedPauseAfter },
          escape: nestedEscape,
          closed: nestedClosedStatus.nestedPopupResult === null,
        };
      }
      if (!nativeNestedReplayRequested) {
        if (nativeInteractionMatrix) {
          let interactionStatus = await waitForValue(
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
          if (
            interactionStatus.highlightWindow?.visible !== true ||
            interactionStatus.highlightWindow?.alwaysOnTop !== true
          )
            throw new Error(
              `subtitle highlight did not remain visible with the popup open: ${JSON.stringify(
                interactionStatus.highlightWindow,
              )}`,
            );
          const initialPanelBounds = popupRegionDesktopRect(
            interactionStatus,
            interactionStatus.popupRegions.panel,
          );
          const replacement = lookupableUnits(interactionStatus)
            .filter(
              (candidate) =>
                candidate.unit.id !== activeLookup.unit.id ||
                candidate.event.id !== activeLookup.event.id,
            )
            .filter((candidate) => lookupCompatibleUnit(candidate, lookupLanguage))
            .map((candidate) => ({
              ...candidate,
              target: pointerTarget(interactionStatus, candidate.unit),
            }))
            .filter((candidate) => !pointInRect(candidate.target, initialPanelBounds))
            .sort((left, right) => {
              const leftDifferentEvent =
                left.event.id !== activeLookup.event.id ||
                left.track.id !== activeLookup.track.id;
              const rightDifferentEvent =
                right.event.id !== activeLookup.event.id ||
                right.track.id !== activeLookup.track.id;
              return Number(rightDifferentEvent) - Number(leftDifferentEvent);
            })[0];
          if (!replacement)
            throw new Error(
              `no second subtitle unit was reachable outside the open popup panel: ${JSON.stringify(
                initialPanelBounds,
              )}`,
            );
          const replacementNativeTarget = nativePoint(replacement.target, inputScale);
          trace(
            "native-hover-replacement-target",
            JSON.stringify({
              from: { unitId: activeLookup.unit.id, text: activeLookup.unit.text },
              to: { unitId: replacement.unit.id, text: replacement.unit.text },
              target: replacement.target,
              nativeTarget: replacementNativeTarget,
              inputScale,
              cursor: interactionStatus.cursorDiagnostic,
              popupPlacement: interactionStatus.popupPlacement,
              panelBounds: initialPanelBounds,
            }),
          );
          const replacementStartedAt = performance.now();
          const replacementMove = commandOutput(
            desktopTest,
            [
              "--move",
              String(replacementNativeTarget.x),
              String(replacementNativeTarget.y),
            ],
            "native pointer move to another subtitle unit while popup is open",
          );
          let replacementStatus;
          try {
            replacementStatus = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.popupVisible === true &&
                  session.popupWindow?.visible === true &&
                  session.popupWindow?.focused === true &&
                  session.popupHit?.unitId === replacement.unit.id &&
                  session.popupHit?.eventId === replacement.event.id &&
                  session.highlightWindow?.visible === true
                  ? session
                  : null;
              },
              5000,
              "popup replacement after hovering another subtitle unit",
            );
          } catch (error) {
            const latestStatus = await statusAt(statusPath);
            const latestSession = sessionStatus(latestStatus, descriptor.sessionId);
            trace(
              "native-hover-replacement-timeout",
              JSON.stringify({
                error: error.message,
                expected: {
                  unitId: replacement.unit.id,
                  eventId: replacement.event.id,
                },
                observed: latestSession
                  ? {
                      cursorDiagnostic: latestSession.cursorDiagnostic,
                      interaction: latestSession.interaction,
                      popupVisible: latestSession.popupVisible,
                      popupHit: latestSession.popupHit,
                      popupHeadword: latestSession.popupHeadword,
                      popupWindow: latestSession.popupWindow,
                      highlightWindow: latestSession.highlightWindow,
                      lastPopupCloseReason: latestSession.lastPopupCloseReason,
                    }
                  : null,
              }),
            );
            throw error;
          }
          nativeHoverReplacement = {
            from: {
              trackId: activeLookup.track.id,
              eventId: activeLookup.event.id,
              unitId: activeLookup.unit.id,
              text: activeLookup.unit.text,
            },
            to: {
              trackId: replacement.track.id,
              eventId: replacement.event.id,
              unitId: replacement.unit.id,
              text: replacement.unit.text,
            },
            target: replacement.target,
            input: replacementMove,
            popupHit: replacementStatus.popupHit,
            popupHeadword: replacementStatus.popupHeadword,
            highlightWindow: replacementStatus.highlightWindow,
            latencyMs: Number((performance.now() - replacementStartedAt).toFixed(3)),
          };
          trace("native-hover-replacement", JSON.stringify(nativeHoverReplacement));
          activeLookup = replacement;
          target = replacement.target;
          nativeTarget = replacementNativeTarget;
          popupStatus = replacementStatus;
          recordPopupForeground(
            replacementStatus,
            "hover-replacement",
            popupForegroundSamples,
          );
          interactionStatus = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupHit?.unitId === replacement.unit.id &&
                session.popupRegions?.headword &&
                session.popupRegions.panel
                ? session
                : null;
            },
            5000,
            "replacement popup native-interaction regions",
          );
          popupStatus = interactionStatus;
          let panelRegion = interactionStatus.popupRegions.panel;
          let contentRegion = interactionStatus.popupRegions.content;
          // The scroll viewport can contain large blank areas around a short
          // dictionary entry. Prefer the renderer's measured non-control text
          // range so the native drag begins on selectable text rather than an
          // arbitrary point in the popup.
          const selectionRegion =
            interactionStatus.popupRegions.selection ||
            interactionStatus.popupRegions.headword ||
            contentRegion;
          const selectionStart = popupRegionPoint(
            interactionStatus,
            selectionRegion,
            0.02,
            0.5,
          );
          const selectionEnd = popupRegionPoint(
            interactionStatus,
            selectionRegion,
            0.8,
            0.5,
          );
          const nativeSelectionStart = nativePoint(selectionStart, inputScale);
          const nativeSelectionEnd = nativePoint(selectionEnd, inputScale);
          let popupWindowBounds = interactionStatus.popupWindow?.bounds;
          let popupPanelBounds = popupRegionDesktopRect(interactionStatus, panelRegion);
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
          if (nativeFeatureParityRequested) {
            const featureStatus = await waitForStablePopupMetrics(
              statusPath,
              descriptor.sessionId,
              ["panel", "action-audio-source"],
              (session) =>
                session.popupStyle?.customCssApplied === true &&
                session.popupRegions?.["action-audio-source"],
              5000,
              "native popup custom CSS and measured action region",
            );
            const expectedPopupStyle = {
              customCssApplied: true,
              backgroundColor: "rgb(236, 253, 245)",
              borderTopColor: "rgb(13, 148, 136)",
              borderTopWidth: "1px",
            };
            if (
              featureStatus.popupStyle.customCssApplied !==
                expectedPopupStyle.customCssApplied ||
              featureStatus.popupStyle.backgroundColor !==
                expectedPopupStyle.backgroundColor ||
              featureStatus.popupStyle.borderTopColor !==
                expectedPopupStyle.borderTopColor ||
              featureStatus.popupStyle.borderTopWidth !==
                expectedPopupStyle.borderTopWidth
            )
              throw new Error(
                `native popup custom CSS did not reach the live panel: ${JSON.stringify(
                  {
                    expected: expectedPopupStyle,
                    observed: featureStatus.popupStyle,
                  },
                )}`,
              );
            nativeFeatureParity = {
              customCss: {
                selector: "#popup",
                remappedSelector: ":is(#popup, .nested-popup)",
                expected: expectedPopupStyle,
                observed: featureStatus.popupStyle,
              },
            };
            recordPopupForeground(
              featureStatus,
              "feature-popup",
              popupForegroundSamples,
            );
            popupWindowBounds = featureStatus.popupWindow?.bounds;
            popupPanelBounds = popupRegionDesktopRect(
              featureStatus,
              featureStatus.popupRegions.panel,
            );
            const audioRegion = featureStatus.popupRegions["action-audio-source"];
            if (!audioRegion)
              throw new Error(
                "native popup audio action region is unavailable before selection",
              );
            const audioPoint = popupRegionPoint(featureStatus, audioRegion, 0.5, 0.5);
            if (
              !pointInRect(audioPoint, featureStatus.popupWindow?.bounds) ||
              !pointInRect(audioPoint, popupPanelBounds)
            )
              throw new Error(
                `native audio action coordinate escaped the open popup: ${JSON.stringify(
                  {
                    audioPoint,
                    popupWindowBounds: featureStatus.popupWindow?.bounds,
                    popupPanelBounds,
                  },
                )}`,
              );
            const nativeAudioPoint = nativePoint(audioPoint, inputScale);
            trace(
              "native-feature-audio-target",
              JSON.stringify({
                audioPoint,
                nativeAudioPoint,
                inputScale,
                audioRegion,
                popupWindowBounds,
                popupPanelBounds,
              }),
            );
            const audioMove = commandOutput(
              desktopTest,
              ["--move", String(nativeAudioPoint.x), String(nativeAudioPoint.y)],
              "native popup audio action pointer move",
            );
            await delay(100);
            const audioStartedAt = performance.now();
            const audioClick = commandOutput(
              desktopTest,
              [
                "--click",
                String(nativeAudioPoint.x),
                String(nativeAudioPoint.y),
                "left",
              ],
              "native popup audio action click",
            );
            const audioPlaybackStatus = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.interactionSnapshot?.state === "audio-menu-active" &&
                  session.audioResult
                  ? session
                  : null;
              },
              5000,
              "native popup reference audio playback",
            );
            recordPopupForeground(
              audioPlaybackStatus,
              "audio-playback",
              popupForegroundSamples,
            );
            nativeFeatureParity.audio = {
              point: audioPoint,
              input: { move: audioMove, click: audioClick },
              state: audioPlaybackStatus.interactionSnapshot.state,
              result: audioPlaybackStatus.audioResult,
              latencyMs: Number((performance.now() - audioStartedAt).toFixed(3)),
            };
            const audioSourceMenuClick = commandOutput(
              desktopTest,
              [
                "--click",
                String(nativeAudioPoint.x),
                String(nativeAudioPoint.y),
                "right",
              ],
              "native popup reference audio source menu context click",
            );
            const audioSourceMenuStatus = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.interactionSnapshot?.state === "audio-menu-active" &&
                  session.popupRegions?.["action-audio-close"]
                  ? session
                  : null;
              },
              5000,
              "native popup reference audio source menu",
            );
            recordPopupForeground(
              audioSourceMenuStatus,
              "audio-source-menu",
              popupForegroundSamples,
            );
            nativeFeatureParity.audio.sourceMenu = {
              point: audioPoint,
              region: audioSourceMenuStatus.popupRegions["action-audio-close"],
              input: audioSourceMenuClick,
            };
            const audioClose = commandOutput(
              desktopTest,
              ["--key", "escape"],
              "native popup reference audio source menu Escape",
            );
            nativeFeatureParity.audio.close = audioClose;
            const afterAudioStatus = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.popupVisible === true &&
                  session.interactionSnapshot?.state === "popup-active" &&
                  session.popupRegions?.["action-anki-add"]
                  ? session
                  : null;
              },
              5000,
              "native popup after audio menu dismissal",
            );
            popupWindowBounds = afterAudioStatus.popupWindow?.bounds;
            popupPanelBounds = popupRegionDesktopRect(
              afterAudioStatus,
              afterAudioStatus.popupRegions.panel,
            );
            const ankiRegion = afterAudioStatus.popupRegions["action-anki-add"];
            if (!ankiRegion)
              throw new Error("native popup Anki action region is unavailable");
            const ankiPoint = popupRegionPoint(afterAudioStatus, ankiRegion, 0.5, 0.5);
            if (
              !pointInRect(ankiPoint, popupWindowBounds) ||
              !pointInRect(ankiPoint, popupPanelBounds)
            )
              throw new Error(
                `native Anki action coordinate escaped the open popup: ${JSON.stringify(
                  {
                    ankiPoint,
                    popupWindowBounds,
                    popupPanelBounds,
                  },
                )}`,
              );
            const nativeAnkiPoint = nativePoint(ankiPoint, inputScale);
            trace(
              "native-feature-anki-target",
              JSON.stringify({
                ankiPoint,
                nativeAnkiPoint,
                inputScale,
                ankiRegion,
                popupWindowBounds,
                popupPanelBounds,
              }),
            );
            const ankiMove = commandOutput(
              desktopTest,
              ["--move", String(nativeAnkiPoint.x), String(nativeAnkiPoint.y)],
              "native popup Anki action pointer move",
            );
            await delay(100);
            const ankiStartedAt = performance.now();
            const ankiClick = commandOutput(
              desktopTest,
              ["--click", String(nativeAnkiPoint.x), String(nativeAnkiPoint.y), "left"],
              "native popup Anki action click",
            );
            const ankiStatus = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.ankiResult?.state === "added" &&
                  session.ankiResult.ok === true
                  ? session
                  : null;
              },
              5000,
              "native popup Anki note",
            );
            recordPopupForeground(ankiStatus, "anki-action", popupForegroundSamples);
            nativeFeatureParity.anki = {
              point: ankiPoint,
              input: { move: ankiMove, click: ankiClick },
              result: ankiStatus.ankiResult,
              latencyMs: Number((performance.now() - ankiStartedAt).toFixed(3)),
            };
          }
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
            const smoothStatus = await waitForValue(
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
            recordPopupForeground(
              smoothStatus,
              "smooth-approach",
              popupForegroundSamples,
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
          recordPopupForeground(
            selectedStatus,
            "text-selection",
            popupForegroundSamples,
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
          if (["darwin", "win32"].includes(process.platform)) {
            const focusedPanel = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.popupVisible &&
                  session.popupWindow?.visible === true &&
                  session.popupWindow?.focused === true &&
                  session.popupFocusTarget === "popup-panel" &&
                  Number.isInteger(session.popupFocusRevision)
                  ? session
                  : null;
              },
              5000,
              "native popup panel focus",
            );
            recordPopupForeground(
              focusedPanel,
              "keyboard-focus",
              popupForegroundSamples,
            );
            const tab = commandOutput(desktopTest, ["--key", "tab"], "native Tab");
            if (!nativeInputReady(tab))
              throw new Error(`native Tab lost trusted input: ${JSON.stringify(tab)}`);
            const tabFocused = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.popupVisible &&
                  session.popupWindow?.visible === true &&
                  session.popupWindow?.focused === true &&
                  session.popupFocusTarget &&
                  Number(session.popupFocusRevision) >
                    Number(focusedPanel.popupFocusRevision)
                  ? session
                  : null;
              },
              5000,
              "native Tab focus transition",
            );
            recordPopupForeground(tabFocused, "tab-focus", popupForegroundSamples);
            const shiftTab = commandOutput(
              desktopTest,
              ["--shortcut", "shift", "tab"],
              "native Shift-Tab",
            );
            if (!nativeInputReady(shiftTab))
              throw new Error(
                `native Shift-Tab lost trusted input: ${JSON.stringify(shiftTab)}`,
              );
            const shiftTabFocused = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.popupVisible &&
                  session.popupWindow?.visible === true &&
                  session.popupWindow?.focused === true &&
                  session.popupFocusTarget &&
                  Number(session.popupFocusRevision) >
                    Number(tabFocused.popupFocusRevision)
                  ? session
                  : null;
              },
              5000,
              "native Shift-Tab focus transition",
            );
            recordPopupForeground(
              shiftTabFocused,
              "shift-tab-focus",
              popupForegroundSamples,
            );
            keyboardFocus = {
              initial: focusedPanel.popupFocusTarget,
              tab: {
                input: tab,
                target: tabFocused.popupFocusTarget,
              },
              shiftTab: {
                input: shiftTab,
                target: shiftTabFocused.popupFocusTarget,
                wrapped:
                  shiftTabFocused.popupFocusTarget === tabFocused.popupFocusTarget,
              },
            };
            nativeInteraction.keyboard = keyboardFocus;
            trace("native-popup-keyboard-focus", JSON.stringify(keyboardFocus));
          } else {
            keyboardFocus = {
              skipped: true,
              reason: "macOS-native-focus-evidence-only",
            };
            nativeInteraction.keyboard = keyboardFocus;
          }
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
                `native popup scroll coordinate escaped the open popup: ${JSON.stringify(
                  {
                    popupWindowBounds,
                    popupPanelBounds,
                    scrollPoint,
                  },
                )}`,
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
            recordPopupForeground(
              scrolledStatus,
              "wheel-scroll",
              popupForegroundSamples,
            );
            latencySamples.nativeScrollMs.push(performance.now() - scrollStartedAt);
            nativeInteraction.scroll = {
              point: scrollPoint,
              input: scroll,
              state: scrolledStatus.popupScroll,
            };
          }
        }
        const clickTargetStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupVisible === true &&
              session.popupWindow?.visible === true &&
              session.popupRegions?.panel &&
              (session.popupRegions.selection ||
                session.popupRegions.headword ||
                session.popupRegions.content)
              ? session
              : null;
          },
          5000,
          "popup semantic click region",
        );
        const clickPanelBounds = popupRegionDesktopRect(
          clickTargetStatus,
          clickTargetStatus.popupRegions.panel,
        );
        const clickRegionCandidates = [
          ["selection", clickTargetStatus.popupRegions.selection],
          ["headword", clickTargetStatus.popupRegions.headword],
          ["content", clickTargetStatus.popupRegions.content],
        ];
        const clickTarget = clickRegionCandidates
          .filter(([, region]) => region)
          .map(([name, region]) => ({
            name,
            region,
            point: popupRegionPoint(clickTargetStatus, region, 0.5, 0.5),
          }))
          .find(
            (candidate) =>
              pointInRect(candidate.point, clickTargetStatus.popupWindow?.bounds) &&
              pointInRect(candidate.point, clickPanelBounds),
          );
        if (!clickTarget)
          throw new Error(
            `native popup semantic click region was outside the open panel: ${JSON.stringify(
              {
                windowBounds: clickTargetStatus.popupWindow?.bounds,
                panelBounds: clickPanelBounds,
                regions: clickTargetStatus.popupRegions,
              },
            )}`,
          );
        const clickPoint = clickTarget.point;
        trace(
          "native-popup-semantic-click-target",
          JSON.stringify({
            region: clickTarget.name,
            bounds: clickTarget.region,
            point: clickPoint,
            panelBounds: clickPanelBounds,
          }),
        );
        const nativeClickPoint = nativePoint(clickPoint, inputScale);
        clickResult = commandOutput(
          desktopTest,
          ["--click", String(nativeClickPoint.x), String(nativeClickPoint.y), "left"],
          "native popup click",
        );
        await delay(300);
        const clickedPopupStatus = await waitForValue(
          async () => {
            const status = await statusAt(statusPath);
            const session = sessionStatus(status, descriptor.sessionId);
            return session?.popupVisible === true ? session : null;
          },
          2000,
          "popup status after native click",
        );
        recordPopupForeground(
          clickedPopupStatus,
          "popup-click",
          popupForegroundSamples,
        );
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
        if (nativeInteractionMatrix) {
          dismissalFocusResult = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              const activation = session?.focusPlayer;
              if (
                activation?.isForeground !== true ||
                activation?.foregroundVerified !== true
              )
                return null;
              let readback;
              try {
                readback = await nativeWindow.read(descriptor);
              } catch (error) {
                readback = { ok: false, reason: String(error?.message || error) };
              }
              return { activation, readback };
            },
            5000,
            "app-reported stock mpv foreground after native Escape",
          );
        }
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
        aliveAfterEscape = true;

        if (nativeResizeTransition) {
          const beforeWindow = await nativeWindow.read(descriptor);
          const beforeStatus = await statusAt(statusPath);
          const beforeSession = sessionStatus(beforeStatus, descriptor.sessionId);
          const configuredScale = Number(await bridge.ipc.getProperty("window-scale"));
          const currentScale = Number(
            await bridge.ipc.getProperty("current-window-scale"),
          );
          const beforeScale =
            Number.isFinite(currentScale) && currentScale > 0
              ? currentScale
              : Number.isFinite(configuredScale) && configuredScale > 0
                ? configuredScale
                : 1;
          if (!Number.isFinite(configuredScale) || configuredScale < 0)
            throw new Error(
              `stock mpv did not expose a usable configured window-scale before resize: ${JSON.stringify(
                {
                  configuredScale,
                  currentScale,
                },
              )}`,
            );
          const resizedScale = Number((beforeScale * 0.75).toFixed(3));
          if (resizedScale <= 0 || Math.abs(resizedScale - beforeScale) < 0.01)
            throw new Error(
              `stock mpv resize probe could not choose a distinct scale: ${JSON.stringify(
                {
                  beforeScale,
                  resizedScale,
                },
              )}`,
            );
          await bridge.ipc.setProperty("window-scale", resizedScale);
          const resized = await waitForValue(
            async () => {
              const nextWindow = await nativeWindow.read(descriptor);
              return nextWindow.content &&
                Math.abs(nextWindow.content.width - beforeWindow.content.width) > 1
                ? nextWindow
                : null;
            },
            10000,
            "stock mpv content resize",
          );
          const resizedStatus = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.source?.contentExact === true &&
                Number(session.geometryGeneration) >
                  Number(beforeSession?.geometryGeneration || 0) &&
                session.content &&
                Math.abs(session.content.width - resized.content.width) <= 1 &&
                Math.abs(session.content.height - resized.content.height) <= 1
                ? session
                : null;
            },
            10000,
            "Electron geometry refresh after stock mpv resize",
          );
          if (resizedStatus.popupVisible === true)
            throw new Error("stock mpv resize unexpectedly reopened the popup");
          // mpv commonly reports an automatic configured scale of 0 while
          // current-window-scale reports the effective value. Restore the
          // effective scale first so Windows does not leave the client rect at
          // the reduced size while the automatic-scale setting is being
          // re-established.
          // Restore the effective scale that produced the original client
          // rectangle. A configured value of 1 can mean "automatic" on mpv;
          // assigning it here makes Windows choose a new natural window size
          // instead of returning to the observed geometry.
          const restoreScale = beforeScale;
          await bridge.ipc.setProperty("window-scale", restoreScale);
          let restored;
          try {
            restored = await waitForValue(
              async () => {
                const nextWindow = await nativeWindow.read(descriptor);
                return nextWindow.content &&
                  Math.abs(nextWindow.content.width - beforeWindow.content.width) <=
                    1 &&
                  Math.abs(nextWindow.content.height - beforeWindow.content.height) <= 1
                  ? nextWindow
                  : null;
              },
              10000,
              "stock mpv content resize recovery",
            );
          } catch (error) {
            const observedWindow = await nativeWindow
              .read(descriptor)
              .catch(() => null);
            const observedScale = await bridge.ipc
              .getProperty("current-window-scale")
              .catch(() => null);
            throw new Error(
              `${error.message}; resize=${JSON.stringify({
                configuredScale,
                beforeScale,
                resizedScale,
                restoreScale,
                beforeContent: beforeWindow.content,
                observedContent: observedWindow?.content || null,
                observedScale,
              })}`,
            );
          }
          const restoredStatus = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.source?.contentExact === true &&
                session.content &&
                Math.abs(session.content.width - restored.content.width) <= 1 &&
                Math.abs(session.content.height - restored.content.height) <= 1
                ? session
                : null;
            },
            10000,
            "Electron geometry refresh after stock mpv resize recovery",
          );
          if (restoredStatus.popupVisible === true)
            throw new Error(
              "stock mpv resize recovery unexpectedly reopened the popup",
            );
          windowTransition = {
            property: "window-scale",
            configuredScale,
            restoreScale,
            currentScale,
            beforeScale,
            resizedScale,
            before: {
              window: beforeWindow.content,
              geometryGeneration: beforeSession?.geometryGeneration ?? null,
            },
            resized: {
              window: resized.content,
              geometryGeneration: resizedStatus.geometryGeneration,
              popupVisible: resizedStatus.popupVisible,
            },
            restored: {
              window: restored.content,
              geometryGeneration: restoredStatus.geometryGeneration,
              popupVisible: restoredStatus.popupVisible,
            },
          };
          trace("native-window-resize-transition", JSON.stringify(windowTransition));
        }

        if (nativeControllerParity) {
          const waitForControllerButton = (button, pressed, timeoutMs, description) =>
            waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const state = status?.controller?.state;
                return state?.source === "native-hid" &&
                  state.connected === true &&
                  state.buttons?.[button] === pressed
                  ? status
                  : null;
              },
              timeoutMs,
              description,
            );
          const controllerResetPoint = pointerResetTarget(initialSession);
          const nativeControllerResetPoint = nativePoint(
            controllerResetPoint,
            inputScale,
          );
          controllerPointerReset = commandOutput(
            desktopTest,
            [
              "--move",
              String(nativeControllerResetPoint.x),
              String(nativeControllerResetPoint.y),
            ],
            "native controller cursor-free reset move",
          );
          await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible === false && !session?.controllerTarget
                ? session
                : null;
            },
            5000,
            "cursor-free controller reset",
          );
          let primarySignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID primary/Cross through the live worker state file.",
            );
            primarySignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "primary",
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: press and release the connected DualSense primary/Cross button to open the popup.",
            );
          }
          let primaryPressed;
          try {
            primaryPressed = await waitForControllerButton(
              "primary",
              true,
              syntheticNativeController ? 10000 : 30000,
              "native controller primary press",
            );
          } finally {
            await primarySignal;
          }
          const controllerPopup = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible &&
                session.popupWindow?.visible === true &&
                session.popupWindow?.focused === true
                ? session
                : null;
            },
            popupOpenTimeoutMs,
            "popup opened by native controller primary",
          );
          const primaryReleased = await waitForControllerButton(
            "primary",
            false,
            5000,
            "native controller primary release",
          );
          const controllerFirstTarget = controllerPopup.popupHit?.unitId || null;
          let rightStickSignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID right-stick navigation.",
            );
            rightStickSignal = synthesizeNativeControllerInput(
              syntheticControllerStatePath,
              { axes: { rightX: 0.9 }, pressedMs: 220 },
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: move the connected DualSense right stick right to target the next subtitle unit.",
            );
          }
          const controllerMoved = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible === true &&
                session.controllerTarget &&
                session.popupHit?.unitId &&
                session.popupHit.unitId !== controllerFirstTarget
                ? session
                : null;
            },
            syntheticNativeController ? 10000 : 30000,
            "cursor-free native controller right-stick target movement",
          );
          if (syntheticNativeController) await rightStickSignal;

          let selectSignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID Cross entry selection.",
            );
            selectSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "primary",
              180,
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: press Cross to select the visible dictionary entry, then press D-pad right to move to the next entry.",
            );
          }
          const popupSelection = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.controllerEntryIndex >= 0 ? session : null;
            },
            syntheticNativeController ? 10000 : 30000,
            "native controller popup entry selection",
          );
          if (syntheticNativeController) await selectSignal;
          const selectedEntryIndex = popupSelection.controllerEntryIndex;
          let popupEntryNavigation = null;
          if (selectedEntryIndex >= 0) {
            let nextEntrySignal = null;
            if (syntheticNativeController)
              nextEntrySignal = synthesizeNativeControllerInput(
                syntheticControllerStatePath,
                { buttons: { dpadRight: true }, pressedMs: 180 },
              );
            popupEntryNavigation = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.controllerEntryIndex > selectedEntryIndex
                  ? session
                  : null;
              },
              syntheticNativeController ? 5000 : 10000,
              "native controller popup entry navigation",
            ).catch(() => null);
            if (syntheticNativeController) await nextEntrySignal;
          }

          const initialControllerScrollTop =
            Number(popupSelection.popupScroll?.top) || 0;
          let leftStickSignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID left-stick proportional popup scroll.",
            );
            leftStickSignal = synthesizeNativeControllerInput(
              syntheticControllerStatePath,
              { axes: { leftY: 0.9 }, pressedMs: 260 },
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: move the connected DualSense left stick down to scroll the popup proportionally.",
            );
          }
          const controllerScrolled = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return Number(session?.popupScroll?.top) > initialControllerScrollTop + 1
                ? session
                : null;
            },
            syntheticNativeController ? 10000 : 30000,
            "native controller proportional left-stick popup scroll",
          );
          if (syntheticNativeController) await leftStickSignal;

          let audioHoldSignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID Triangle/audio hold.",
            );
            audioHoldSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "audio",
              800,
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: hold Triangle/audio to open the audio list, then press Circle/back to close it.",
            );
          }
          const audioMenuStatus = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.interactionSnapshot?.state === "audio-menu-active" &&
                session.audioResult &&
                (!nativeFeatureParityRequested ||
                  Number(session.audioResult.candidateCount) >= 2)
                ? session
                : null;
            },
            syntheticNativeController ? 10000 : 30000,
            "native controller audio hold",
          );
          if (syntheticNativeController) await audioHoldSignal;

          let audioControllerSelection = null;
          if (nativeFeatureParityRequested && syntheticNativeController) {
            const candidateCount = Number(audioMenuStatus.audioResult?.candidateCount);
            if (candidateCount < 2)
              throw new Error(
                `native controller audio menu did not expose two Anki-capable candidates: ${JSON.stringify(
                  audioMenuStatus.audioResult,
                )}`,
              );
            const rowSignal = synthesizeNativeControllerInput(
              syntheticControllerStatePath,
              { buttons: { dpadDown: true }, pressedMs: 180 },
            );
            await rowSignal;
            const columnSignal = synthesizeNativeControllerInput(
              syntheticControllerStatePath,
              { buttons: { dpadRight: true }, pressedMs: 180 },
            );
            await columnSignal;
            const activateSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "primary",
              180,
            );
            const selectedAudioStatus = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.audioSelection?.url ? session : null;
              },
              5000,
              "native controller audio Anki-column selection",
            );
            await activateSignal;
            audioControllerSelection = {
              candidateCount,
              row: 1,
              column: 1,
              selected: selectedAudioStatus.audioSelection,
            };
          }

          let audioBackSignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID Circle/audio-list close.",
            );
            audioBackSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "back",
              180,
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: press Circle/back once to close the audio list.",
            );
          }
          const audioMenuClosed = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.interactionSnapshot?.state === "popup-active"
                ? session
                : null;
            },
            syntheticNativeController ? 10000 : 30000,
            "native controller audio-list close",
          );
          if (syntheticNativeController) await audioBackSignal;

          let backSignal = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID back/Circle through the live worker state file.",
            );
            backSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "back",
            );
          } else {
            console.log(
              "CONTROLLER ACTION REQUIRED: press and release the connected DualSense back/Circle button to close the popup.",
            );
          }
          let backPressed;
          try {
            backPressed = await waitForControllerButton(
              "back",
              true,
              syntheticNativeController ? 10000 : 30000,
              "native controller back press",
            );
          } finally {
            await backSignal;
          }
          const controllerClosed = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible === false ? session : null;
            },
            5000,
            "popup closed by native controller back",
          );
          const backReleased = await waitForControllerButton(
            "back",
            false,
            5000,
            "native controller back release",
          );
          if (mpvProcess.exitCode !== null)
            throw new Error("native controller popup actions leaked a quit to mpv");
          if (bridge.property("pause") !== startPaused)
            throw new Error(
              `native controller popup actions changed pause ownership (expected ${startPaused}, observed ${bridge.property("pause")})`,
            );
          let noPopupNavigation = null;
          if (syntheticNativeController) {
            console.log(
              "SYNTHETIC CONTROLLER INPUT: injecting native-HID shoulder subtitle stepping and no-popup D-pad seeking.",
            );
            const subtitleFingerprint = () =>
              JSON.stringify({
                sid: bridge.property("sid"),
                secondarySid: bridge.property("secondary-sid"),
                start: bridge.property("sub-start/full"),
                end: bridge.property("sub-end/full"),
                ass: bridge.property("sub-text/ass-full"),
                text: bridge.property("sub-text"),
              });
            const initialSubtitleFingerprint = subtitleFingerprint();
            const initialTimePosition = Number(bridge.property("time-pos"));
            if (initialSubtitleFingerprint === "{}")
              throw new Error(
                "stock mpv did not expose an active primary subtitle fingerprint before controller stepping",
              );
            if (!Number.isFinite(initialTimePosition))
              throw new Error(
                `stock mpv did not expose a numeric time position before controller seeking: ${bridge.property("time-pos")}`,
              );

            const externalCueCount =
              await externalSubtitleCueCount(externalSubtitlePath);
            const subtitleSeekSupported =
              externalCueCount === null || externalCueCount > 1;
            let subtitleNavigation = {
              supported: subtitleSeekSupported,
              cueCount: externalCueCount,
              next: null,
              previous: null,
            };
            if (subtitleSeekSupported) {
              const subtitleNextSignal = synthesizeNativeControllerButton(
                syntheticControllerStatePath,
                "rightShoulder",
                180,
              );
              const subtitleNextPosition = await waitForValue(
                () => {
                  const value = subtitleFingerprint();
                  return value !== initialSubtitleFingerprint ? value : null;
                },
                5000,
                "native controller right-shoulder subtitle-next",
              );
              await subtitleNextSignal;

              const subtitlePreviousSignal = synthesizeNativeControllerButton(
                syntheticControllerStatePath,
                "leftShoulder",
                180,
              );
              const subtitlePreviousPosition = await waitForValue(
                () => {
                  const value = subtitleFingerprint();
                  return value === initialSubtitleFingerprint ? value : null;
                },
                5000,
                "native controller left-shoulder subtitle-previous",
              );
              await subtitlePreviousSignal;
              subtitleNavigation = {
                ...subtitleNavigation,
                next: subtitleNextPosition,
                previous: subtitlePreviousPosition,
              };
            }

            const seekForwardSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "dpadRight",
              180,
            );
            const seekForwardPosition = await waitForValue(
              () => {
                const value = Number(bridge.property("time-pos"));
                return Number.isFinite(value) && value > initialTimePosition + 1
                  ? value
                  : null;
              },
              5000,
              "native controller no-popup d-pad-right seek-forward",
            );
            await seekForwardSignal;

            const seekBackwardSignal = synthesizeNativeControllerButton(
              syntheticControllerStatePath,
              "dpadLeft",
              180,
            );
            const seekBackwardPosition = await waitForValue(
              () => {
                const value = Number(bridge.property("time-pos"));
                return Number.isFinite(value) && value < seekForwardPosition - 1
                  ? value
                  : null;
              },
              5000,
              "native controller no-popup d-pad-left seek-backward",
            );
            await seekBackwardSignal;
            noPopupNavigation = {
              subtitle: {
                initial: initialSubtitleFingerprint,
                ...subtitleNavigation,
              },
              seek: {
                initial: initialTimePosition,
                forward: seekForwardPosition,
                backward: seekBackwardPosition,
              },
            };
          }
          nativeController = {
            ...nativeController,
            cursorReset: controllerPointerReset,
            primary: {
              pressed: primaryPressed.controller?.state || null,
              popupState: controllerPopup.interactionSnapshot?.state || null,
              released: primaryReleased.controller?.state || null,
            },
            rightStick: {
              initialTarget: controllerFirstTarget,
              movedTarget: controllerMoved.controllerTarget || null,
            },
            popupSelection: {
              selectedEntryIndex,
              selected: popupSelection.controllerEntryIndex,
              entryNavigation: popupEntryNavigation?.controllerEntryIndex ?? null,
            },
            leftStickScroll: {
              initialTop: initialControllerScrollTop,
              finalTop: controllerScrolled.popupScroll?.top ?? null,
            },
            audioHold: {
              state: audioMenuStatus.interactionSnapshot?.state || null,
              result: audioMenuStatus.audioResult || null,
              closedState: audioMenuClosed.interactionSnapshot?.state || null,
              ...(audioControllerSelection
                ? { controllerSelection: audioControllerSelection }
                : {}),
            },
            back: {
              pressed: backPressed.controller?.state || null,
              popupState: controllerClosed.interactionSnapshot?.state || null,
              released: backReleased.controller?.state || null,
            },
            ...(noPopupNavigation ? { noPopupNavigation } : {}),
            noMpvLeak: true,
            pausePreserved: true,
            synthetic: syntheticNativeController,
          };
        }

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
          const resetPoint = pointerResetTarget(initialSession);
          const nativeResetPoint = nativePoint(resetPoint, inputScale);
          outsideResetMove = commandOutput(
            desktopTest,
            ["--move", String(nativeResetPoint.x), String(nativeResetPoint.y)],
            "native pointer leave before outside-click popup reopen",
          );
          await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible === false &&
                session.cursorDiagnostic?.hit == null
                ? session
                : null;
            },
            5000,
            "pointer leave before outside-click popup reopen",
          );
          // The controller path intentionally retains its selected target after
          // closing the popup so Cross can reopen it without cursor movement.
          // Reopen the mouse path on a different subtitle unit to verify that a
          // real pointer target still takes ownership cleanly.
          const outsideReopenTarget = pointerTarget(initialSession, initialLookup.unit);
          const nativeOutsideReopenTarget = nativePoint(
            outsideReopenTarget,
            inputScale,
          );
          const reopenMove = commandOutput(
            desktopTest,
            [
              "--move",
              String(nativeOutsideReopenTarget.x),
              String(nativeOutsideReopenTarget.y),
            ],
            "native pointer move to reopen popup for outside-click test",
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
          await delay(150);
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
          aliveAfterOutsidePopupClick = true;
          outsideClickResult = {
            focus: outsideFocusResult,
            reopenMove,
            windowBounds: outsideWindowBounds,
            panelBounds: outsidePanelBounds,
            point: outsidePoint,
            input: outsideClick,
          };
        }
        if (nativeFeatureParityRequested) {
          const backgroundFocus = await focusNativeWindow(nativeWindow, descriptor);
          if (
            backgroundFocus.isForeground !== true ||
            backgroundFocus.foregroundVerified !== true
          )
            throw new Error(
              `stock mpv foreground was not verified before unrelated-app deactivation: ${JSON.stringify(
                backgroundFocus,
              )}`,
            );
          const backgroundMove = commandOutput(
            desktopTest,
            ["--move", String(nativeTarget.x), String(nativeTarget.y)],
            "native pointer move before unrelated-app deactivation",
          );
          const backgroundPopup = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible && session.popupWindow?.focused === true
                ? session
                : null;
            },
            popupOpenTimeoutMs,
            "dictionary popup before unrelated-app deactivation",
          );
          let unrelatedApplication;
          if (process.platform === "darwin") {
            unrelatedApplication = activateUnrelatedMacosApplication("Finder");
          } else {
            const unrelatedWindows =
              await activateUnrelatedWindowsApplication(windowProbe);
            unrelatedWindowsProcess = unrelatedWindows;
            unrelatedApplication = unrelatedWindows.evidence;
          }
          const deactivated = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              if (
                session?.source?.foreground !== false ||
                session.popupVisible !== false ||
                session.popupWindow?.visible !== false ||
                session.popupWindow?.alwaysOnTop !== false ||
                session.highlightWindow?.alwaysOnTop !== false
              )
                return null;
              return session;
            },
            8000,
            "companion surfaces to leave the stack after unrelated-app activation",
          );
          // macOS treats activation as user-intent driven. After Finder has
          // become frontmost, restore the player with the same native click a
          // user would make on the underlying player rather than treating an
          // accepted programmatic activation request as proof of focus.
          const recoveryPoint = pointerResetTarget(initialSession);
          const recoveryNativePoint = nativePoint(recoveryPoint, inputScale);
          const recoveryPauseBeforeClick = bridge.property("pause");
          const recoveryClick = commandOutput(
            desktopTest,
            [
              "--click",
              String(recoveryNativePoint.x),
              String(recoveryNativePoint.y),
              "left",
            ],
            "native player click after unrelated-app deactivation",
          );
          const recoveryFocus = await waitForValue(
            async () => {
              const observed = await nativeWindow.read(descriptor);
              return observed.isForeground === true
                ? {
                    ...observed,
                    foregroundVerified: true,
                    activationMethod: "native-user-click",
                  }
                : null;
            },
            5000,
            "stock mpv foreground after native user click",
          );
          await delay(100);
          const recoveryPauseAfterClick = bridge.property("pause");
          // This click is intentionally on the player to model a user bringing
          // an overlapped mpv window forward. The disposable input.conf maps a
          // left click to pause, so require exactly that player action, then
          // restore the state before the remaining focus assertions.
          if (recoveryPauseAfterClick !== !recoveryPauseBeforeClick)
            throw new Error(
              `native focus-restoration click did not reach the expected mpv binding (expected pause ${!recoveryPauseBeforeClick}, observed ${recoveryPauseAfterClick})`,
            );
          await bridge.setPause(recoveryPauseBeforeClick);
          await waitForValue(
            () => bridge.property("pause") === recoveryPauseBeforeClick,
            2000,
            "stock mpv pause restoration after native focus click",
          );
          if (mpvProcess.exitCode !== null)
            throw new Error("native focus-restoration click leaked a quit to mpv");
          if (
            recoveryFocus.isForeground !== true ||
            recoveryFocus.foregroundVerified !== true
          )
            throw new Error(
              `stock mpv foreground was not restored after unrelated-app deactivation: ${JSON.stringify(
                recoveryFocus,
              )}`,
            );
          const recoveryMove = commandOutput(
            desktopTest,
            ["--move", String(nativeTarget.x), String(nativeTarget.y)],
            "native pointer move after unrelated-app recovery",
          );
          const recovered = await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible &&
                session.popupWindow?.visible === true &&
                session.popupWindow?.focused === true &&
                session.source?.foreground === true
                ? session
                : null;
            },
            popupOpenTimeoutMs,
            "dictionary popup after unrelated-app recovery",
          );
          const recoveryEscape = commandOutput(
            desktopTest,
            ["--key", "escape"],
            "native Escape after unrelated-app recovery",
          );
          await waitForValue(
            async () => {
              const status = await statusAt(statusPath);
              const session = sessionStatus(status, descriptor.sessionId);
              return session?.popupVisible === false ? session : null;
            },
            5000,
            "popup dismissal after unrelated-app recovery",
          );
          if (unrelatedWindowsProcess) {
            await stopUnrelatedWindowsApplication(unrelatedWindowsProcess);
            unrelatedWindowsProcess = null;
          }
          nativeFeatureParity.backgrounding = {
            unrelatedApplication,
            before: {
              focus: backgroundFocus,
              move: backgroundMove,
              popup: {
                visible: backgroundPopup.popupVisible,
                focused: backgroundPopup.popupWindow?.focused === true,
              },
            },
            deactivated: {
              foreground: deactivated.source?.foreground === true,
              popupVisible: deactivated.popupVisible,
              popupWindow: deactivated.popupWindow,
              highlightWindow: deactivated.highlightWindow,
            },
            recovery: {
              focus: recoveryFocus,
              click: recoveryClick,
              point: recoveryPoint,
              pauseBeforeClick: recoveryPauseBeforeClick,
              pauseAfterClick: recoveryPauseAfterClick,
              pauseRestored: bridge.property("pause"),
              move: recoveryMove,
              popupVisible: recovered.popupVisible,
              popupFocused: recovered.popupWindow?.focused === true,
              foreground: recovered.source?.foreground === true,
              escape: recoveryEscape,
            },
          };
        }
        if (nativeLifecycleCycles > 0) {
          for (let cycle = 1; cycle <= nativeLifecycleCycles; cycle++) {
            const cycleFocus = await focusNativeWindow(nativeWindow, descriptor);
            if (
              cycleFocus.isForeground !== true ||
              cycleFocus.foregroundVerified !== true
            )
              throw new Error(
                `native lifecycle cycle ${cycle} could not verify mpv foreground: ${JSON.stringify(
                  cycleFocus,
                )}`,
              );
            await delay(100);
            const cycleTargetSession = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return (session?.source?.exact === true ||
                  (allowApproximateGeometry &&
                    session?.source?.contentExact === true)) &&
                  session.highlightWindow &&
                  session.popupVisible === false
                  ? session
                  : null;
              },
              5000,
              `native lifecycle cycle ${cycle} target geometry`,
            );
            const cycleCandidates = lookupableUnits(cycleTargetSession).filter(
              (candidate) => candidate.track.role === "primary",
            );
            const retainedCycleLookup = cycleCandidates.find(
              (candidate) =>
                candidate.track.id === activeLookup?.track.id &&
                candidate.event.id === activeLookup?.event.id &&
                candidate.unit.id === activeLookup?.unit.id,
            );
            const cycleLookup =
              retainedCycleLookup ||
              cycleCandidates.find((candidate) =>
                lookupCompatibleUnit(candidate, lookupLanguage),
              ) ||
              cycleCandidates[0];
            if (!cycleLookup)
              throw new Error(
                `native lifecycle cycle ${cycle} has no current primary lookup unit`,
              );
            const cycleTarget = pointerTarget(cycleTargetSession, cycleLookup.unit);
            const cycleInputScale = Math.max(
              1,
              Number(cycleTargetSession.desktopScale) || inputScale,
            );
            const cycleNativeTarget = nativePoint(cycleTarget, cycleInputScale);
            trace(
              "native-lifecycle-target",
              JSON.stringify({
                cycle,
                unitId: cycleLookup.unit.id,
                text: cycleLookup.unit.text,
                target: cycleTarget,
                nativeTarget: cycleNativeTarget,
              }),
            );
            const cycleStartedAt = performance.now();
            const cycleMove = commandOutput(
              desktopTest,
              ["--move", String(cycleNativeTarget.x), String(cycleNativeTarget.y)],
              `native lifecycle cycle ${cycle} pointer move`,
            );
            if (!nativeInputReady(cycleMove))
              throw new Error(
                `native lifecycle cycle ${cycle} lost trusted pointer input: ${JSON.stringify(
                  cycleMove,
                )}`,
              );
            const cyclePopup = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session?.popupVisible &&
                  session.popupWindow?.visible === true &&
                  session.popupWindow?.focused === true &&
                  typeof session.popupHeadword === "string" &&
                  session.popupHeadword.length > 0 &&
                  session.cursorDiagnostic?.hit?.unitId === cycleLookup.unit.id
                  ? session
                  : null;
              },
              popupOpenTimeoutMs,
              `native lifecycle cycle ${cycle} popup`,
            );
            latencySamples.nativeLifecyclePopupMs.push(
              performance.now() - cycleStartedAt,
            );
            const cycleDismissalStartedAt = performance.now();
            const cycleEscape = commandOutput(
              desktopTest,
              ["--key", "escape"],
              `native lifecycle cycle ${cycle} Escape`,
            );
            if (!nativeInputReady(cycleEscape))
              throw new Error(
                `native lifecycle cycle ${cycle} lost trusted keyboard input: ${JSON.stringify(
                  cycleEscape,
                )}`,
              );
            const cycleClosed = await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session && session.popupVisible === false ? session : null;
              },
              5000,
              `native lifecycle cycle ${cycle} dismissal`,
            );
            latencySamples.nativeLifecycleDismissalMs.push(
              performance.now() - cycleDismissalStartedAt,
            );
            const cyclePause = bridge.property("pause");
            if (cyclePause !== startPaused)
              throw new Error(
                `native lifecycle cycle ${cycle} changed pause ownership (expected ${startPaused}, observed ${cyclePause})`,
              );
            if (mpvProcess.exitCode !== null)
              throw new Error(`native lifecycle cycle ${cycle} leaked Escape to mpv`);
            const resetPoint = pointerResetTarget(cycleClosed);
            const resetInputScale = Math.max(
              1,
              Number(cycleClosed.desktopScale) || inputScale,
            );
            const resetNativePoint = nativePoint(resetPoint, resetInputScale);
            const resetMove = commandOutput(
              desktopTest,
              ["--move", String(resetNativePoint.x), String(resetNativePoint.y)],
              `native lifecycle cycle ${cycle} pointer reset`,
            );
            if (!nativeInputReady(resetMove))
              throw new Error(
                `native lifecycle cycle ${cycle} lost trusted reset input: ${JSON.stringify(
                  resetMove,
                )}`,
              );
            await waitForValue(
              async () => {
                const status = await statusAt(statusPath);
                const session = sessionStatus(status, descriptor.sessionId);
                return session &&
                  session.popupVisible === false &&
                  session.cursorDiagnostic?.hit === null
                  ? session
                  : null;
              },
              5000,
              `native lifecycle cycle ${cycle} pointer reset`,
            );
            nativeLifecycle.push({
              cycle,
              target: {
                trackId: cycleLookup.track.id,
                eventId: cycleLookup.event.id,
                unitId: cycleLookup.unit.id,
                text: cycleLookup.unit.text,
                point: cycleTarget,
              },
              focus: cycleFocus,
              move: cycleMove,
              popup: {
                state: cyclePopup.interactionSnapshot?.state || null,
                hit: cyclePopup.cursorDiagnostic?.hit || null,
                headword: cyclePopup.popupHeadword || null,
              },
              escape: cycleEscape,
              closedState: cycleClosed.interactionSnapshot?.state || null,
              pause: cyclePause,
              mpvAlive: mpvProcess.exitCode === null,
              reset: {
                point: resetPoint,
                input: resetMove,
              },
            });
          }
        }
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

    if (additionalPointerProbeCount > 0 && !nativeNestedReplayRequested) {
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
      publicDiagnostic(
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
            demoLanguage: demoLanguage || null,
            demoLanguageText: demoLanguage ? DEMO_LANGUAGE_TEXT[demoLanguage] : null,
            fixtureLanguage: fixtureLanguage || null,
            fixtureLanguageText: fixtureLanguage
              ? DEMO_LANGUAGE_TEXT[fixtureLanguage]
              : null,
            dictionaryMode: liveDictionary ? "live-hoshi" : "demo",
            dictionary: liveDictionaryEvidence,
            ankiMock: ankiMock
              ? {
                  calls: [...ankiMock.calls],
                  addNoteCount: ankiMock.calls.filter((action) => action === "addNote")
                    .length,
                }
              : null,
            audioMock: audioMock
              ? {
                  requests: [...audioMock.requests],
                }
              : null,
            fullscreenRequested: fullscreen,
            fullscreenObserved,
            fullscreenEvidence,
            allowApproximateGeometry,
            additionalPointerProbeCount,
            nativeInteractionMatrix,
            nativeFeatureParityRequested,
            nativeNestedReplayRequested,
            nativeControllerParity,
            syntheticNativeController,
            nativeResizeTransition,
            nativeLifecycleCycles,
            nativeLifecycle,
            nativeInteraction,
            popupForegroundSamples,
            nativeHoverReplacement,
            nativeNestedReplay,
            nativeController,
            windowTransition,
            nativeFeatureParity,
            windowTransitionState:
              sessionStatus(finalStatus, descriptor.sessionId)?.windowTransitions ||
              null,
            latency: summarizeLatencies(latencySamples),
            pointerProbes,
            pointerProbeEscapes,
            requireStableSigning,
            testHelperSignature,
            electronLaunch: packagedApplication || process.execPath,
            packagedApplication: !!packagedApplication,
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
              escapeFocus: dismissalFocusResult,
              outsideReset: outsideResetMove,
              outsideClick: outsideClickResult,
            },
            capture: {
              before: captureBeforeResult,
              after: captureAfterResult,
              nested: nestedCaptureResult,
              popupVisualEvidence,
              popupCaptureAttempts,
              combinedVisiblePopup: popupVisualEvidence?.ok === true,
            },
            screenRecording: screenRecordingResult,
            player: {
              pauseAfterPopupClick: clickPause,
              pauseAfterPopupDismiss: dismissalPause,
              pauseAfterOutsidePopupDismiss: outsideDismissalPause,
              aliveAfterEscape,
              aliveAfterOutsidePopupClick,
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
    if (ankiMock) {
      ankiMockEvidence = {
        calls: [...ankiMock.calls],
        addNoteCount: ankiMock.calls.filter((action) => action === "addNote").length,
      };
      await new Promise((resolve) => ankiMock.server.close(resolve));
      ankiMock = null;
    }
    if (audioMock) {
      audioMockEvidence = {
        requests: [...audioMock.requests],
      };
      await new Promise((resolve) => audioMock.server.close(resolve));
      audioMock = null;
    }
    await stopUnrelatedWindowsApplication(unrelatedWindowsProcess);
    unrelatedWindowsProcess = null;
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
        "desktop-nested.png": captureNested,
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
        demoLanguage: demoLanguage || null,
        demoLanguageText: demoLanguage ? DEMO_LANGUAGE_TEXT[demoLanguage] : null,
        fixtureLanguage: fixtureLanguage || null,
        fixtureLanguageText: fixtureLanguage
          ? DEMO_LANGUAGE_TEXT[fixtureLanguage]
          : null,
        dictionaryMode: liveDictionary ? "live-hoshi" : "demo",
        dictionary: liveDictionaryEvidence,
        ankiMock: ankiMockEvidence,
        audioMock: audioMockEvidence,
        fullscreenRequested: fullscreen,
        fullscreenObserved,
        fullscreenEvidence,
        allowApproximateGeometry,
        additionalPointerProbeCount,
        nativeInteractionMatrix,
        nativeFeatureParityRequested,
        nativeNestedReplayRequested,
        nativeControllerParity,
        syntheticNativeController,
        nativeResizeTransition,
        nativeLifecycleCycles,
        nativeLifecycle,
        nativeInteraction,
        popupForegroundSamples,
        nativeController,
        nativeNestedReplay,
        windowTransition,
        nativeFeatureParity,
        windowTransitionState:
          sessionStatus(finalStatus || lastElectronStatus, descriptor?.sessionId)
            ?.windowTransitions || null,
        latency: summarizeLatencies(latencySamples),
        pointerProbes,
        pointerProbeEscapes,
        requireStableSigning,
        testHelperSignature,
        electronLaunch: packagedApplication || process.execPath,
        packagedApplication: !!packagedApplication,
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
          escapeFocus: dismissalFocusResult,
          outsideClick: outsideClickResult,
        },
        capture: {
          before: captureBeforeResult,
          after: captureAfterResult,
          nested: nestedCaptureResult,
          popupVisualEvidence,
          popupCaptureAttempts,
          combinedVisiblePopup: popupVisualEvidence?.ok === true,
        },
        screenRecording: screenRecordingResult,
        player: {
          pauseAfterPopupClick: clickPause,
          pauseAfterPopupDismiss: dismissalPause,
          pauseAfterOutsidePopupDismiss: outsideDismissalPause,
          aliveAfterEscape,
          aliveAfterOutsidePopupClick,
        },
        mode: `native-desktop-combined-${process.platform}-e2e`,
        claim:
          popupVisualEvidence?.ok === true
            ? foregroundStatus?.source?.exact === true
              ? "real-stock-mpv-real-electron-windows-combined-capture-and-native-input"
              : "real-stock-mpv-real-electron-windows-combined-capture-and-native-input-with-approximate-geometry"
            : "blocked-before-native-input-or-combined-popup-capture",
        stderr: {
          mpv: mpvStderr.slice(-4000),
          electron: electronStderr.slice(-4000),
          mpvLogTail: mpvLog.slice(-4000),
        },
      },
    );
    if (evidenceDirectory) {
      await fs.writeFile(
        path.join(evidenceDirectory, "mpv-stderr.log"),
        publicDiagnostic(mpvStderr),
        { mode: 0o600 },
      );
      await fs.writeFile(
        path.join(evidenceDirectory, "electron-stderr.log"),
        publicDiagnostic(electronStderr),
        { mode: 0o600 },
      );
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    trace("cleanup-done");
  }

  if (failure) {
    console.error(
      publicDiagnostic(
        `NATIVE DESKTOP E2E BLOCKED: ${failure}\nevidence: ${evidenceDirectory || "none"}\nmpv stderr: ${mpvStderr.trim()}\nmpv log: ${mpvLog.slice(-4000).trim()}\nElectron stderr: ${electronStderr.trim()}`,
      ),
    );
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`NATIVE DESKTOP E2E BLOCKED: ${publicDiagnostic(error.message)}`);
  process.exitCode = 2;
});
