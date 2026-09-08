"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");
const {
  isProcessAlive,
  listDescriptors,
} = require("../../src/player/session-descriptor");

const root = path.resolve(__dirname, "../..");
const suppliedMedia =
  "/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, description) {
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

function executablePath(environmentName, candidates) {
  const configured = String(process.env[environmentName] || "").trim();
  if (configured) return path.resolve(configured);
  return (
    candidates
      .map((value) => path.join(root, value))
      .find((value) => fsSync.existsSync(value)) || ""
  );
}

function parseLastJson(stdout, label) {
  const lines = String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(lines[index]);
    } catch (_) {}
  }
  throw new Error(`${label} returned no JSON result`);
}

function spawnMpv({
  executable,
  sessionDirectory,
  nativeShim,
  mediaPath,
  id,
  geometry,
  inputConf,
}) {
  // macOS limits AF_UNIX paths to a little over 100 bytes. Keep the IPC
  // endpoint beside the session directory with a short stable name; the
  // descriptor still carries the full endpoint and session identity.
  const socketPath = path.join(path.dirname(sessionDirectory), `${id.slice(-1)}.sock`);
  const child = spawn(
    executable,
    [
      "--no-config",
      "--force-window=immediate",
      "--vo=gpu-next",
      "--idle=no",
      "--keep-open=yes",
      "--no-terminal",
      "--no-osc",
      "--input-default-bindings=no",
      "--start=19",
      "--sid=1",
      `--geometry=${geometry}`,
      `--input-conf=${inputConf}`,
      `--input-ipc-server=${socketPath}`,
      `--script-opts=iinatan-session-id=${id},iinatan-session-dir=${sessionDirectory},iinatan-ipc-endpoint=${socketPath}`,
      `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
      "--",
      mediaPath,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        IINATAN_SESSION_DIR: sessionDirectory,
        IINATAN_NATIVE_SHIM: nativeShim,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stdout.resume();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    id,
    child,
    socketPath,
    stderr: () => stderr,
  };
}

function processAlive(child) {
  // A child can remain addressable by PID for a short interval after its exit
  // event. Treat the observed exit code as authoritative so cleanup never
  // signals a recycled or unrelated process group.
  if (!child?.pid || child.exitCode !== null) return false;
  if (isProcessAlive(child.pid)) return true;
  if (process.platform === "win32") return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || !processAlive(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const target = process.platform === "win32" ? child.pid : -child.pid;
  try {
    process.kill(target, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exited, delay(4000)]);
  if (processAlive(child)) {
    try {
      process.kill(target, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([exited, delay(1000)]);
  }
}

async function stopMpv(session) {
  if (!processAlive(session?.child)) return;
  const ipc = new MpvJsonIpc(session.socketPath, { timeoutMs: 1000 });
  try {
    await ipc.command("quit");
  } catch (_) {
    // The process may already be closing its IPC socket.
  } finally {
    ipc.close();
  }
  await new Promise((resolve) => {
    if (session.child.exitCode !== null) {
      resolve();
      return;
    }
    session.child.once("exit", resolve);
    setTimeout(resolve, 10000);
  });
  await stopProcess(session.child);
}

async function connectMpv(session) {
  const ipc = new MpvJsonIpc(session.socketPath, { timeoutMs: 3000 });
  try {
    await waitFor(
      async () => {
        try {
          await ipc.getProperty("path");
          return true;
        } catch (_) {
          return false;
        }
      },
      15000,
      `${session.id} JSON IPC`,
    );
  } catch (error) {
    ipc.close();
    throw new Error(
      `${error.message}; socket=${fsSync.existsSync(session.socketPath)}; childExit=${session.child.exitCode}; signal=${session.child.signalCode}; mpv stderr: ${session.stderr().trim().slice(-3000)}`,
    );
  }
  await waitFor(
    async () => {
      const [media, subtitle] = await Promise.all([
        ipc.getProperty("path"),
        ipc.getProperty("sub-text/ass-full"),
      ]);
      return media && subtitle ? true : false;
    },
    20000,
    `${session.id} media and subtitle readiness`,
  );
  return ipc;
}

async function waitForAppSessions(statusPath, expectedIds, description) {
  return waitFor(
    async () => {
      const status = await statusAt(statusPath);
      const sessions = status?.sessions || [];
      const byId = new Map(sessions.map((session) => [session.sessionId, session]));
      if (
        expectedIds.some((id) => !byId.has(id)) ||
        sessions.length !== expectedIds.length
      )
        return null;
      if (
        expectedIds.some((id) => {
          const session = byId.get(id);
          return (
            session.source?.exact !== true ||
            session.source?.contentExact !== true ||
            session.source?.contentSource !== "appkit-content-view"
          );
        })
      )
        return null;
      return { status, sessions: expectedIds.map((id) => byId.get(id)) };
    },
    30000,
    description,
  );
}

async function setAndReadVolume(ipc, value, id) {
  await ipc.setProperty("volume", value);
  const observed = Number(await ipc.getProperty("volume"));
  if (observed !== value)
    throw new Error(
      `${id} volume crossed an IPC/session boundary: ${observed} !== ${value}`,
    );
  return observed;
}

function runNativeInput(executable, args, id) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${id} native input failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  return parseLastJson(result.stdout, id);
}

async function nativeClick(executable, point, id) {
  const move = runNativeInput(
    executable,
    ["--move", String(point.x), String(point.y)],
    `${id} native pointer move`,
  );
  if (move.accessibilityTrusted !== true || move.postEventTrusted !== true)
    throw new Error(`${id} native move helper is not trusted: ${JSON.stringify(move)}`);
  await delay(24);
  const click = runNativeInput(
    executable,
    ["--click", String(point.x), String(point.y), "left"],
    `${id} native click`,
  );
  if (click.accessibilityTrusted !== true || click.postEventTrusted !== true)
    throw new Error(
      `${id} native click helper is not trusted: ${JSON.stringify(click)}`,
    );
  return { move, click };
}

async function clickAndProbe(desktopTest, adapter, descriptor, session, id) {
  const point = {
    x: session.content.x + session.content.width / 2,
    y: session.content.y + session.content.height / 2,
  };
  const click = await nativeClick(desktopTest, point, id);
  let lastObserved = null;
  let observed;
  try {
    observed = await waitFor(
      async () => {
        const value = await adapter.read(descriptor);
        lastObserved = value;
        return value.isForeground === true ? value : null;
      },
      8000,
      `${id} native foreground ownership`,
    );
  } catch (error) {
    throw new Error(
      `${error.message}; point=${JSON.stringify(point)}; click=${JSON.stringify(click)}; lastObserved=${JSON.stringify(lastObserved)}`,
    );
  }
  return { point, click, observed };
}

async function main() {
  if (process.platform !== "darwin" || process.env.IINATAN_E2E !== "1") {
    console.log(
      "SKIP: macOS multi-session desktop evidence requires IINATAN_E2E=1 on an unlocked graphical session.",
    );
    return;
  }

  const mpv = process.env.IINATAN_MPV || "mpv";
  const mediaPath = path.resolve(process.env.IINATAN_E2E_MEDIA_PATH || suppliedMedia);
  const nativeShim = executablePath("IINATAN_NATIVE_SHIM", [
    "bin/iinatan-mpv-window-shim.so",
    "build/native/iinatan-mpv-window-shim.so",
  ]);
  const windowProbe = executablePath("IINATAN_WINDOW_PROBE", [
    "bin/iinatan-window-probe",
    "build/native/iinatan-window-probe",
  ]);
  const desktopTest = executablePath("IINATAN_DESKTOP_TEST", [
    "build/native/iinatan-desktop-test.app/Contents/MacOS/iinatan-desktop-test",
    "build/native/iinatan-desktop-test",
  ]);
  if (!nativeShim || !windowProbe || !desktopTest)
    throw new Error(
      "macOS native shim, window probe, or desktop-test helper is unavailable; run npm run build:native",
    );
  await fs.access(mediaPath);
  const versionResult = spawnSync(mpv, ["--version"], { encoding: "utf8" });
  if (versionResult.error || versionResult.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${versionResult.error?.message || versionResult.stderr || "unknown error"}`,
    );
  const version = { line: String(versionResult.stdout || "").split(/\r?\n/)[0] };
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-native-multi-session-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const userDataDirectory = path.join(temporaryRoot, "user-data");
  const statusPath = path.join(temporaryRoot, "electron-status.json");
  const inputConf = path.join(temporaryRoot, "input.conf");
  await fs.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    inputConf,
    "MOUSE_BTN0 ignore\nMOUSE_BTN1 ignore\nMOUSE_BTN2 ignore\n",
    { mode: 0o600 },
  );
  const sessions = new Map();
  const bridges = new Map();
  let electron = null;
  let report;
  try {
    const startSession = (id, geometry) => {
      const session = spawnMpv({
        executable: mpv,
        sessionDirectory,
        nativeShim,
        mediaPath,
        id,
        geometry,
        inputConf,
      });
      sessions.set(id, session);
      return session;
    };
    startSession("native-multi-a", "640x360+20+60");
    startSession("native-multi-b", "640x360+700+60");
    await waitFor(
      async () => {
        const descriptors = await listDescriptors(sessionDirectory);
        return descriptors.length === 2 && descriptors.every((item) => item.sessionId);
      },
      20000,
      "two real stock-mpv descriptors",
    );
    for (const session of sessions.values())
      bridges.set(session.id, await connectMpv(session));
    const descriptors = await listDescriptors(sessionDirectory);
    const descriptorById = new Map(descriptors.map((item) => [item.sessionId, item]));
    if (new Set(descriptors.map((item) => item.pid)).size !== 2)
      throw new Error("the native sessions did not have distinct PIDs");
    electron = spawn(
      process.execPath,
      [
        path.join(root, "scripts", "run-electron.js"),
        ".",
        "--enable-patched-native-geometry",
        `--runtime-dir=${sessionDirectory}`,
        `--e2e-status-file=${statusPath}`,
        `--user-data-dir=${userDataDirectory}`,
      ],
      {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        windowsHide: true,
      },
    );
    let electronStderr = "";
    electron.stdout.resume();
    electron.stderr.setEncoding("utf8");
    electron.stderr.on("data", (chunk) => (electronStderr += chunk));

    const attached = await waitForAppSessions(
      statusPath,
      ["native-multi-a", "native-multi-b"],
      "Electron attachment to both native sessions",
    );
    const adapter = new NativeWindowAdapter({
      probeExecutable: windowProbe,
      resourceRoot: root,
      sessionDirectory,
      timeoutMs: 3000,
    });
    // The Codex desktop window may cover the disposable test players. Raise
    // them only after exact Electron attachment has been established, so the
    // visibility guard does not affect the attachment race itself.
    await Promise.all(
      [...bridges.values()].map((ipc) => ipc.setProperty("ontop", true)),
    );
    await delay(250);
    const volume = {
      a: await setAndReadVolume(bridges.get("native-multi-a"), 17, "native-multi-a"),
      b: await setAndReadVolume(bridges.get("native-multi-b"), 63, "native-multi-b"),
    };
    const clickFocusA = await clickAndProbe(
      desktopTest,
      adapter,
      descriptorById.get("native-multi-a"),
      attached.sessions.find((session) => session.sessionId === "native-multi-a"),
      "native-multi-a",
    );
    const clickFocusB = await clickAndProbe(
      desktopTest,
      adapter,
      descriptorById.get("native-multi-b"),
      attached.sessions.find((session) => session.sessionId === "native-multi-b"),
      "native-multi-b",
    );
    await stopMpv(sessions.get("native-multi-a"));
    await waitFor(
      async () => {
        const descriptorsAfter = await listDescriptors(sessionDirectory);
        return descriptorsAfter.every(
          (item) => item.sessionId !== "native-multi-a" || !isProcessAlive(item.pid),
        );
      },
      20000,
      "closed native session is no longer live",
    );
    const replacement = startSession("native-multi-c", "640x360+20+460");
    bridges.set(replacement.id, await connectMpv(replacement));
    await bridges.get(replacement.id).setProperty("ontop", true);
    const afterReplacement = await waitForAppSessions(
      statusPath,
      ["native-multi-b", "native-multi-c"],
      "replacement session attachment after first player shutdown",
    );
    const afterRemoval = await waitForAppSessions(
      statusPath,
      ["native-multi-b", "native-multi-c"],
      "Electron removal of the closed session",
    );
    const replacementVolume = {
      b: await setAndReadVolume(bridges.get("native-multi-b"), 29, "native-multi-b"),
      c: await setAndReadVolume(bridges.get("native-multi-c"), 77, "native-multi-c"),
    };
    const replacementDescriptor = await waitFor(
      async () =>
        (await listDescriptors(sessionDirectory)).find(
          (item) => item.sessionId === "native-multi-c",
        ) || null,
      10000,
      "replacement native session descriptor",
    );
    const clickFocusC = await clickAndProbe(
      desktopTest,
      adapter,
      replacementDescriptor,
      afterReplacement.sessions.find(
        (session) => session.sessionId === "native-multi-c",
      ),
      "native-multi-c",
    );
    report = {
      ok: true,
      mpv: version.line,
      mediaPath,
      initial: {
        sessionIds: attached.sessions.map((session) => session.sessionId),
        pids: descriptors.map((descriptor) => descriptor.pid),
        sourceExact: attached.sessions.map((session) => session.source),
        contentBounds: attached.sessions.map((session) => session.content),
        volume,
        clickFocusA,
        clickFocusB,
      },
      replacement: {
        sessionIds: afterReplacement.sessions.map((session) => session.sessionId),
        volume: replacementVolume,
        clickFocusC,
      },
      removal: {
        sessionIds: afterRemoval.sessions.map((session) => session.sessionId),
        closedSessionRemoved: !afterRemoval.sessions.some(
          (session) => session.sessionId === "native-multi-a",
        ),
      },
      electronStderr: electronStderr || null,
      mode: "macos-native-stock-mpv-multi-session-ownership",
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const bridge of bridges.values()) bridge.close();
    if (electron) await stopProcess(electron);
    for (const session of sessions.values()) await stopMpv(session);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  const evidenceDirectory = String(
    process.env.IINATAN_E2E_MULTI_EVIDENCE_DIR || "",
  ).trim();
  if (evidenceDirectory && report) {
    await fs.mkdir(path.resolve(evidenceDirectory), { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(path.resolve(evidenceDirectory), "result.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}

main().catch((error) => {
  console.error(`NATIVE MACOS MULTI-SESSION SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
