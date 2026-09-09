"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { listDescriptors } = require("../../src/player/session-descriptor");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");

const root = path.resolve(__dirname, "../..");

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
  const requireAutoShim = process.env.IINATAN_NATIVE_SHIM_AUTO_REQUIRED === "1";
  const expectNativeShim = !!nativeShim || requireAutoShim;
  const fullscreen = process.env.IINATAN_NATIVE_WINDOW_FULLSCREEN === "1";
  const version = spawnSync(executable, ["--no-config", "--version"], {
    encoding: "utf8",
  });
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
      `--script=${path.join(root, "mpv", "iinatan.lua")}`,
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
    // On Windows, invoking the `mpv` command can create a launcher process
    // before the actual mpv executable. The session descriptor records the
    // player PID, so discover it instead of assuming it equals child.pid.
    const descriptor = await waitForValue(
      async () => {
        const descriptors = await listDescriptors(sessionDirectory);
        return descriptors.length === 1 ? descriptors[0] : null;
      },
      10000,
      "mpv session descriptor",
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
    if (process.platform !== "darwin") {
      // This standalone Node smoke has no Electron screen module. Calibrate
      // the same physical-to-DIP conversion from the probe's per-window DPI
      // before asking the adapter for logical placement geometry.
      const rawWindow = await waitForValue(
        async () => {
          const value = await adapter.probe(descriptor);
          return value?.ok === true && value.content ? value : null;
        },
        10000,
        "stock mpv native window probe",
      );
      const desktopScale = Math.max(1, Number(rawWindow.desktopScale) || 1);
      adapter.screen = {
        screenToDipPoint: ({ x, y }) => ({
          x: Number(x) / desktopScale,
          y: Number(y) / desktopScale,
        }),
      };
    }
    const shimGeometryPath = path.join(
      sessionDirectory,
      `${descriptor.pid}.geometry.json`,
    );
    // Runtime-loaded C plugins initialize asynchronously. Wait for the
    // in-process AppKit sidecar before the first adapter read so that the
    // adapter cannot win a race with the less precise CoreGraphics fallback.
    const shimGeometry = expectNativeShim
      ? await waitForValue(
          () => readOptionalJson(shimGeometryPath),
          2000,
          "in-process content geometry shim",
        )
      : null;
    const geometry = await waitForValue(
      () => adapter.read(descriptor),
      10000,
      "native stock-mpv window geometry",
    );
    if (
      !geometry.content ||
      geometry.content.width <= 0 ||
      geometry.content.height <= 0
    )
      throw new Error("native window probe returned a non-positive content frame");
    if (expectNativeShim) {
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
      publicDiagnostic(
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
            shimRequested: expectNativeShim,
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
      ),
    );
  } finally {
    ipc?.close();
    await stopProcess(child, socketPath);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  if (stderr && /error|fatal/i.test(stderr))
    console.warn(
      `mpv emitted diagnostics during window smoke: ${publicDiagnostic(stderr.trim())}`,
    );
  if (process.env.IINATAN_E2E_DEBUG === "1" && stderr)
    console.error(
      `mpv stderr during window smoke:\n${publicDiagnostic(stderr.trim())}`,
    );
}

main().catch((error) => {
  console.error(`STOCK MPV WINDOW SMOKE FAILED: ${publicDiagnostic(error.message)}`);
  process.exitCode = 1;
});
