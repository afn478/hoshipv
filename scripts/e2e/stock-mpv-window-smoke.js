"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  listDescriptors,
  readDescriptor,
} = require("../../src/player/session-descriptor");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");

const root = path.resolve(__dirname, "../..");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function requestQuit(socketPath) {
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
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ command: ["quit"] })}\n`, finish);
    });
  });
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

async function stopProcess(child, socketPath) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await requestQuit(socketPath);
  await Promise.race([exited, delay(4000)]);
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([exited, delay(1000)]);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(1000)]);
  }
}

function candidateProbe() {
  const executableName =
    process.platform === "win32" ? "iinatan-window-probe.exe" : "iinatan-window-probe";
  return (
    process.env.IINATAN_WINDOW_PROBE ||
    [
      path.join(root, "bin", executableName),
      path.join(root, "build", "native", executableName),
      path.join(root, "build", "native", "Release", executableName),
    ].find((value) => fsSync.existsSync(value)) ||
    ""
  );
}

async function main() {
  if (process.env.IINATAN_NATIVE_WINDOW !== "1") {
    console.log(
      "SKIP: native stock-mpv window evidence requires IINATAN_NATIVE_WINDOW=1 in an isolated graphical session.",
    );
    console.log(
      "This checks window identity and scalar frame geometry only; it is not combined compositor or input evidence.",
    );
    return;
  }

  const executable = process.env.IINATAN_MPV || "mpv";
  const nativeShim = process.env.IINATAN_NATIVE_SHIM || "";
  const loadShimViaSession = process.env.IINATAN_NATIVE_SHIM_VIA_SESSION === "1";
  const fullscreen = process.env.IINATAN_NATIVE_WINDOW_FULLSCREEN === "1";
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0)
    throw new Error(
      `stock mpv is unavailable: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const probeExecutable = candidateProbe();
  if (!probeExecutable)
    throw new Error("the native window probe executable is unavailable");

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-mpv-window-smoke-"),
  );
  const sessionDirectory = path.join(temporaryRoot, "sessions");
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\iinatan-mpv-window-${process.pid}-${Date.now()}`
      : path.join(temporaryRoot, "mpv.sock");
  await fs.mkdir(sessionDirectory);
  const mpvEnvironment = {
    ...process.env,
    IINATAN_SESSION_DIR: sessionDirectory,
  };
  if (!loadShimViaSession) delete mpvEnvironment.IINATAN_NATIVE_SHIM;

  const child = spawn(
    executable,
    [
      "--no-config",
      // Immediate creation keeps the Cocoa event loop and JSON IPC live while
      // the opt-in probe waits for the real stock-mpv window.
      "--force-window=immediate",
      "--vo=gpu-next",
      "--idle=yes",
      "--keep-open=yes",
      "--no-terminal",
      ...(fullscreen ? ["--fs=yes"] : []),
      `--input-ipc-server=${socketPath}`,
      `--script-opts=iinatan-session-dir=${sessionDirectory},iinatan-ipc-endpoint=${socketPath}`,
      ...(nativeShim && !loadShimViaSession ? [`--script=${nativeShim}`] : []),
      `--script=${path.join(root, "mpv", "iinatan-session.lua")}`,
      "--title=iinatan-mpv-window-smoke",
    ],
    {
      env: mpvEnvironment,
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
  let ipc = null;

  try {
    await waitForValue(
      async () => (await listDescriptors(sessionDirectory)).length === 1,
      10000,
      "mpv session descriptor",
    );
    // The native shim writes a sibling JSON sidecar; select the Lua descriptor
    // by its PID-named contract instead of relying on directory ordering.
    const descriptorFile = `${child.pid}.json`;
    const descriptorPath = path.join(sessionDirectory, descriptorFile);
    const descriptor = await readDescriptor(descriptorPath);
    if (descriptor.pid !== child.pid)
      throw new Error(
        `descriptor PID ${descriptor.pid} does not match mpv PID ${child.pid}`,
      );

    ipc = new MpvJsonIpc(descriptor.ipcEndpoint, { timeoutMs: 3000 });
    const fullscreenState = await waitForValue(
      async () => {
        const value = await ipc.getProperty("fullscreen");
        return value === fullscreen ? { value } : null;
      },
      5000,
      `mpv fullscreen property to become ${fullscreen}`,
    );

    const adapter = new NativeWindowAdapter({
      probeExecutable,
      resourceRoot: root,
      sessionDirectory,
      timeoutMs: 3000,
    });
    const geometry = await waitForValue(
      () => adapter.read(descriptor),
      10000,
      "native stock-mpv window geometry",
    );
    const shimGeometryPath = path.join(
      sessionDirectory,
      `${descriptor.pid}.geometry.json`,
    );
    const shimGeometry = nativeShim
      ? await waitForValue(
          () => readOptionalJson(shimGeometryPath),
          2000,
          "in-process content geometry shim",
        )
      : null;
    if (
      !geometry.content ||
      geometry.content.width <= 0 ||
      geometry.content.height <= 0
    )
      throw new Error("native window probe returned a non-positive content frame");
    if (nativeShim) {
      if (typeof geometry.fullscreenObserved !== "boolean")
        throw new Error(
          "in-process content shim did not report AppKit fullscreen state",
        );
      if (geometry.fullscreenObserved !== fullscreen)
        throw new Error(
          `AppKit fullscreen state ${geometry.fullscreenObserved} did not match requested ${fullscreen} (mpv fullscreen property=${fullscreenState.value}; geometry=${JSON.stringify(geometry)}; shim=${JSON.stringify(shimGeometry)})`,
        );
    }

    let activation = null;
    if (process.env.IINATAN_NATIVE_WINDOW_ACTIVATE === "1") {
      activation = await adapter.focus(descriptor);
      let foreground;
      try {
        foreground = await waitForValue(
          async () => {
            const next = await adapter.read(descriptor);
            return next.isForeground === true ? next : null;
          },
          5000,
          "mpv foreground state after native activation",
        );
      } catch (error) {
        throw new Error(`${error.message}; activation=${JSON.stringify(activation)}`);
      }
      activation = { ...activation, isForeground: foreground.isForeground };
    }

    console.log(
      JSON.stringify(
        {
          mpv: version.stdout.split(/\r?\n/)[0],
          descriptor: {
            sessionId: descriptor.sessionId,
            pid: descriptor.pid,
            windowId: descriptor.windowId,
          },
          probe: {
            executable: probeExecutable,
            windowId: geometry.windowId,
            content: geometry.content,
            contentSource: geometry.contentSource,
            contentExact: geometry.contentExact,
            isForeground: geometry.isForeground,
            displayAsleep: geometry.displayAsleep,
            displayVisible: geometry.displayVisible,
            capability: geometry.capability,
          },
          shimGeometry,
          activation,
          fullscreenRequested: fullscreen,
          fullscreenObserved:
            typeof geometry.fullscreenObserved === "boolean"
              ? geometry.fullscreenObserved
              : fullscreenState.value,
          fullscreenEvidence: geometry.fullscreenEvidence || "mpv-property-only",
          mode: "native-stock-mpv-window-probe-only",
        },
        null,
        2,
      ),
    );
  } finally {
    ipc?.close();
    await stopProcess(child, socketPath);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(`mpv emitted diagnostics during window smoke: ${stderr.trim()}`);
  if (process.env.IINATAN_E2E_DEBUG === "1" && stderr)
    console.error(`mpv stderr during window smoke:\n${stderr.trim()}`);
}

main().catch((error) => {
  console.error(`STOCK MPV WINDOW SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
