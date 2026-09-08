"use strict";

const assert = require("node:assert/strict");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");
const { NativeWindowAdapter } = require("../../src/platform/native-window-adapter");
const { defaultSessionDirectory } = require("../../src/player/session-directory");
const {
  listDescriptors,
  readDescriptor,
} = require("../../src/player/session-descriptor");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../..");
const DEFAULT_MEDIA_PATH =
  "/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv";
const EXPECTED_COMPANION_ROOT = path.join(root, "dist");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function processRows() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean);
}

function companionRows(rows) {
  return rows.filter(
    (row) =>
      row.command.includes("/Contents/MacOS/iinatan for mpv") &&
      !row.command.includes("Helper"),
  );
}

async function stopCompanion(rows) {
  const pids = new Set(rows.map((row) => row.pid));
  if (!pids.size) return;
  for (const row of companionRows(rows)) {
    try {
      process.kill(row.pid, "SIGTERM");
    } catch (_) {}
  }
  try {
    await waitFor(
      async () => {
        const current = await processRows();
        return !current.some((row) => pids.has(row.pid));
      },
      10000,
      "the existing iinatan companion to stop",
    );
  } catch {
    for (const row of rows) {
      try {
        process.kill(row.pid, "SIGKILL");
      } catch (_) {}
    }
    await waitFor(
      async () => {
        const current = await processRows();
        return !current.some((row) => pids.has(row.pid));
      },
      5000,
      "forced companion shutdown",
    );
    return;
  }
}

async function stopMpv(child) {
  if (child.exitCode === null) child.kill("SIGTERM");
  try {
    await waitFor(() => child.exitCode !== null, 10000, "mpv shutdown");
  } catch {
    if (child.exitCode === null) child.kill("SIGKILL");
    await waitFor(() => child.exitCode !== null, 5000, "forced mpv shutdown");
    return;
  }
}

async function readStatus(statusPath) {
  try {
    return JSON.parse(await fs.readFile(statusPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function sessionStatus(status, sessionId) {
  return status?.sessions?.find((session) => session.sessionId === sessionId) || null;
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

function nativeDesktopExecutable() {
  return (
    process.env.IINATAN_DESKTOP_TEST ||
    [
      path.join(
        root,
        "build",
        "native",
        "iinatan-desktop-test.app",
        "Contents",
        "MacOS",
        "iinatan-desktop-test",
      ),
      path.join(root, "build", "native", "iinatan-desktop-test"),
    ].find((candidate) => {
      return fsSync.existsSync(candidate);
    }) ||
    ""
  );
}

function nativeWindowProbeExecutable() {
  return (
    process.env.IINATAN_WINDOW_PROBE ||
    [
      path.join(root, "build", "native", "iinatan-window-probe"),
      path.join(root, "bin", "iinatan-window-probe"),
    ].find((candidate) => fsSync.existsSync(candidate)) ||
    ""
  );
}

function nativeCommand(executable, args, description) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${description} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  try {
    return JSON.parse(
      String(result.stdout || "")
        .trim()
        .split(/\r?\n/)
        .pop(),
    );
  } catch (error) {
    throw new Error(`${description} returned invalid JSON: ${error.message}`);
  }
}

async function main() {
  if (process.env.IINATAN_E2E_AUTOSTART_REQUIRED !== "1") {
    console.log(
      "SKIP: set IINATAN_E2E_AUTOSTART_REQUIRED=1 to run the real macOS autostart smoke.",
    );
    return;
  }
  if (process.platform !== "darwin") {
    console.log(
      "SKIP: direct companion autostart is currently a macOS LaunchServices smoke.",
    );
    return;
  }
  if (process.env.IINATAN_E2E_AUTOSTART_RESTART !== "1") {
    throw new Error(
      "set IINATAN_E2E_AUTOSTART_RESTART=1 so the smoke can verify a fresh LaunchServices launch",
    );
  }

  const livePopup = process.env.IINATAN_E2E_AUTOSTART_LIVE_POPUP === "1";
  const liveDictionaryId =
    process.env.IINATAN_E2E_AUTOSTART_DICTIONARY_ID || "jitendex-ja-en";

  const mediaPath = path.resolve(
    process.env.IINATAN_E2E_AUTOSTART_MEDIA_PATH || DEFAULT_MEDIA_PATH,
  );
  const executable = process.env.IINATAN_MPV || "mpv";
  const mediaStat = await fs.stat(mediaPath);
  assert.equal(mediaStat.isFile(), true, `media path is not a file: ${mediaPath}`);
  const sessionDirectory = defaultSessionDirectory();
  const scriptPath = path.join(root, "mpv", "iinatan-session.lua");
  await fs.access(scriptPath);
  const beforeDescriptors = new Set(
    (await listDescriptors(sessionDirectory)).map((value) => `${value.pid}.json`),
  );
  const beforeCompanion = companionRows(await processRows());
  const hadCompanion = beforeCompanion.length > 0;
  await stopCompanion(beforeCompanion);

  const environment = { ...process.env, IINATAN_AUTO_START_COMPANION: "1" };
  delete environment.IINATAN_SESSION_DIR;
  delete environment.IINATAN_IPC_ENDPOINT;
  delete environment.IINATAN_COMPANION_APP;
  if (process.env.IINATAN_E2E_AUTOSTART_COMPANION_APP)
    environment.IINATAN_COMPANION_APP = process.env.IINATAN_E2E_AUTOSTART_COMPANION_APP;
  const companionApplication =
    process.env.IINATAN_E2E_AUTOSTART_COMPANION_APP || "iinatan for mpv";
  const nativeGeometryRequired =
    process.env.IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY_REQUIRED === "1" ||
    process.env.IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY_DEFAULT_REQUIRED === "1" ||
    livePopup;
  const failClosedRequired =
    process.env.IINATAN_E2E_AUTOSTART_FAIL_CLOSED_REQUIRED === "1";
  const forceNativeGeometry =
    process.env.IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY_REQUIRED === "1";
  if (forceNativeGeometry) environment.IINATAN_E2E_AUTOSTART_NATIVE_GEOMETRY = "1";
  const e2eStatusPath = path.join(
    os.tmpdir(),
    `iinatan-autostart-${process.pid}-${Date.now()}.json`,
  );
  const evidenceDirectory = process.env.IINATAN_E2E_EVIDENCE_DIR
    ? path.resolve(process.env.IINATAN_E2E_EVIDENCE_DIR)
    : "";
  const userDataPath = livePopup
    ? await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-autostart-user-data-"))
    : "";
  environment.IINATAN_E2E_AUTOSTART_STATUS_FILE = e2eStatusPath;
  if (userDataPath) {
    environment.IINATAN_E2E_AUTOSTART_USER_DATA_DIR = userDataPath;
    environment.IINATAN_E2E_AUTOSTART_OPEN_SETTINGS = "1";
    environment.IINATAN_E2E_AUTOSTART_HIDE_AFTER_SETTINGS = "1";
  } else {
    delete environment.IINATAN_E2E_AUTOSTART_USER_DATA_DIR;
    delete environment.IINATAN_E2E_AUTOSTART_OPEN_SETTINGS;
    delete environment.IINATAN_E2E_AUTOSTART_HIDE_AFTER_SETTINGS;
  }
  const mpvArguments = [
    "--no-config",
    "--terminal=no",
    "--force-window=yes",
    "--keep-open=no",
    `--script=${scriptPath}`,
    ...(nativeGeometryRequired ? ["--start=19"] : []),
    "--",
    mediaPath,
  ];
  const child = spawn(executable, mpvArguments, {
    env: environment,
    stdio: "ignore",
    shell: false,
  });
  let descriptor = null;
  const descriptorPath = path.join(sessionDirectory, `${child.pid}.json`);
  let ipc = null;
  let freshCompanion = [];
  let latestStatus = null;
  let livePopupEvidence = null;
  try {
    await waitFor(
      async () =>
        fs
          .access(descriptorPath)
          .then(() => true)
          .catch(() => false),
      15000,
      "the direct mpv session descriptor",
    );
    descriptor = await readDescriptor(descriptorPath);
    assert.equal(descriptor.pid, child.pid);
    ipc = new MpvJsonIpc(descriptor.ipcEndpoint, { timeoutMs: 3000 });
    assert.equal(Number(await ipc.getProperty("pid")), child.pid);

    await waitFor(
      async () => {
        freshCompanion = companionRows(await processRows());
        return freshCompanion.length > 0;
      },
      20000,
      "a fresh companion process from LaunchServices",
    );
    const expectedApplication =
      process.env.IINATAN_E2E_AUTOSTART_EXPECTED_APP || EXPECTED_COMPANION_ROOT;
    assert.ok(
      freshCompanion.some(
        (row) =>
          row.command.startsWith(expectedApplication) &&
          row.command.includes("iinatan for mpv.app/Contents/MacOS/iinatan for mpv"),
      ),
      `LaunchServices started an unexpected companion: ${freshCompanion.map((row) => row.command).join(" | ")}`,
    );

    let attachedStatus = null;
    await waitFor(
      async () => {
        try {
          attachedStatus = JSON.parse(await fs.readFile(e2eStatusPath, "utf8"));
          latestStatus = attachedStatus;
        } catch (_) {
          return false;
        }
        return attachedStatus?.sessions?.some(
          (session) =>
            session.sessionId === descriptor.sessionId &&
            session.identity?.pid === descriptor.pid,
        );
      },
      20000,
      "the fresh companion to attach to the direct mpv session",
    );

    let geometryStatus = null;
    if (nativeGeometryRequired) {
      await waitFor(
        async () => {
          try {
            geometryStatus = JSON.parse(await fs.readFile(e2eStatusPath, "utf8"));
            latestStatus = geometryStatus;
          } catch (_) {
            return false;
          }
          return geometryStatus?.sessions?.some(
            (session) =>
              session.sessionId === descriptor.sessionId &&
              session.source?.mode === "native-libass-instrumented" &&
              session.source?.exact === true,
          );
        },
        30000,
        "validated native geometry for the direct mpv session",
      );
    }

    let failClosedEvidence = null;
    if (failClosedRequired) {
      const unsupportedRendererCases = [
        {
          option: "sub-ass-style-overrides",
          value: ["DefaultStyle=FontSize=42"],
        },
        { option: "sub-ass", value: false },
        { option: "sub-ass-scale-with-window", value: true },
        { option: "sub-ass-justify", value: true },
        { option: "sub-justify", value: "left" },
        { option: "sub-font-provider", value: "none" },
        { option: "sub-fix-timing", value: true },
        { option: "sub-fix-timing-threshold", value: 100 },
        { option: "sub-fix-timing-keep", value: 100 },
        { option: "sub-fps", value: 23.976 },
        { option: "sub-stretch-durations", value: true },
        { option: "sub-clear-on-seek", value: true },
        { option: "sub-past-video-end", value: true },
        { option: "sub-filter-regex", value: ["opensubtitles"] },
        { option: "sub-filter-jsre", value: ["opensubtitles"] },
        { option: "sub-filter-sdh-enclosures", value: ["<>"] },
      ];
      failClosedEvidence = [];
      for (const testCase of unsupportedRendererCases) {
        const restoreValue = await ipc.getProperty(testCase.option);
        const before = sessionStatus(latestStatus, descriptor.sessionId);
        const generationBefore = before?.geometryGeneration ?? null;
        const setResult = await ipc.setProperty(testCase.option, testCase.value);
        const invalidated = await waitFor(
          async () => {
            const observed = await ipc.getProperty(testCase.option);
            const status = await readStatus(e2eStatusPath);
            if (status) latestStatus = status;
            const session = sessionStatus(status, descriptor.sessionId);
            const observedUnsupported = Array.isArray(testCase.value)
              ? Array.isArray(observed) &&
                testCase.value.every((value) => observed.includes(value))
              : observed === testCase.value;
            return observedUnsupported &&
              session?.source?.exact === false &&
              session?.nativeGeometryError?.code === "NATIVE_GEOMETRY_INPUT_UNSUPPORTED"
              ? { observed, status, session }
              : null;
          },
          15000,
          `native geometry to fail closed after setting ${testCase.option}`,
        );
        const restoreResult = await ipc.setProperty(testCase.option, restoreValue);
        const recovered = await waitFor(
          async () => {
            const observed = await ipc.getProperty(testCase.option);
            const status = await readStatus(e2eStatusPath);
            if (status) latestStatus = status;
            const session = sessionStatus(status, descriptor.sessionId);
            return JSON.stringify(observed) === JSON.stringify(restoreValue) &&
              session?.source?.mode === "native-libass-instrumented" &&
              session?.source?.exact === true &&
              session?.nativeGeometryError == null
              ? { observed, status, session }
              : null;
          },
          15000,
          `native geometry to recover after restoring ${testCase.option}`,
        );
        failClosedEvidence.push({
          option: testCase.option,
          value: testCase.value,
          restoreValue,
          generationBefore,
          setResult,
          invalidated: {
            observed: invalidated.observed,
            geometryGeneration: invalidated.session?.geometryGeneration ?? null,
            source: invalidated.session?.source || null,
            nativeGeometryError: invalidated.session?.nativeGeometryError || null,
          },
          restoreResult,
          recovered: {
            observed: recovered.observed,
            geometryGeneration: recovered.session?.geometryGeneration ?? null,
            source: recovered.session?.source || null,
          },
        });
      }
    }

    let supportedRendererEvidence = null;
    if (failClosedRequired) {
      const supportedRendererCases = [{ option: "embeddedfonts", value: false }];
      supportedRendererEvidence = [];
      for (const testCase of supportedRendererCases) {
        const restoreValue = await ipc.getProperty(testCase.option);
        const before = sessionStatus(latestStatus, descriptor.sessionId);
        const generationBefore = before?.geometryGeneration ?? null;
        const setResult = await ipc.setProperty(testCase.option, testCase.value);
        const changed = await waitFor(
          async () => {
            const observed = await ipc.getProperty(testCase.option);
            const status = await readStatus(e2eStatusPath);
            if (status) latestStatus = status;
            const session = sessionStatus(status, descriptor.sessionId);
            return observed === testCase.value &&
              session?.geometryGeneration > generationBefore &&
              session?.source?.mode === "native-libass-instrumented" &&
              session?.source?.exact === true &&
              session?.nativeGeometryError == null
              ? { observed, status, session }
              : null;
          },
          15000,
          `native geometry to remain exact after setting ${testCase.option}`,
        );
        const restoreResult = await ipc.setProperty(testCase.option, restoreValue);
        const recovered = await waitFor(
          async () => {
            const observed = await ipc.getProperty(testCase.option);
            const status = await readStatus(e2eStatusPath);
            if (status) latestStatus = status;
            const session = sessionStatus(status, descriptor.sessionId);
            return JSON.stringify(observed) === JSON.stringify(restoreValue) &&
              session?.geometryGeneration > changed.session.geometryGeneration &&
              session?.source?.mode === "native-libass-instrumented" &&
              session?.source?.exact === true &&
              session?.nativeGeometryError == null
              ? { observed, status, session }
              : null;
          },
          15000,
          `native geometry to recover after restoring ${testCase.option}`,
        );
        supportedRendererEvidence.push({
          option: testCase.option,
          value: testCase.value,
          restoreValue,
          generationBefore,
          setResult,
          changed: {
            observed: changed.observed,
            geometryGeneration: changed.session?.geometryGeneration ?? null,
            source: changed.session?.source || null,
          },
          restoreResult,
          recovered: {
            observed: recovered.observed,
            geometryGeneration: recovered.session?.geometryGeneration ?? null,
            source: recovered.session?.source || null,
          },
        });
      }
    }

    if (livePopup) {
      const desktopTest = nativeDesktopExecutable();
      if (!desktopTest)
        throw new Error(
          "live direct-autostart popup evidence requires the signed native desktop-test helper",
        );

      await ipc.setProperty("pause", true);
      await waitFor(
        async () => (await ipc.getProperty("pause")) === true,
        5000,
        "direct mpv pause before dictionary download",
      );

      const companionPid = freshCompanion.find((row) =>
        row.command.includes("iinatan for mpv.app/Contents/MacOS/iinatan for mpv"),
      )?.pid;
      if (!companionPid) throw new Error("fresh companion PID is unavailable");
      const activateCompanion = nativeCommand(
        desktopTest,
        ["--activate", String(companionPid)],
        "native direct companion activation for Settings",
      );
      assert.equal(activateCompanion.ok, true);

      const settingsWindowReady = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (!status) return null;
          latestStatus = status;
          const bounds = status.settingsWindow?.contentBounds;
          return status.settingsWindow?.visible === true &&
            bounds?.width > 0 &&
            bounds?.height > 0
            ? { status, bounds }
            : null;
        },
        30000,
        "direct companion Settings window",
      );
      const settingsScrollPoint = {
        x: settingsWindowReady.bounds.x + settingsWindowReady.bounds.width / 2,
        y: settingsWindowReady.bounds.y + settingsWindowReady.bounds.height / 2,
      };
      const settingsScroll = nativeCommand(
        desktopTest,
        [
          "--scroll",
          String(settingsScrollPoint.x),
          String(settingsScrollPoint.y),
          "-5000",
        ],
        "native Settings scroll to recommended dictionaries",
      );
      assert.equal(settingsScroll.ok, true);

      const settingsReady = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (!status) return null;
          latestStatus = status;
          const bounds = status.settingsWindow?.contentBounds;
          const recommended = status.settingsControlRegions?.recommended || [];
          const download = recommended.find((entry) => entry.id === liveDictionaryId);
          const visible =
            download &&
            download.x >= 0 &&
            download.y >= 0 &&
            download.x + download.width <= bounds?.width &&
            download.y + download.height <= bounds?.height;
          return status.settingsWindow?.visible === true &&
            bounds?.width > 0 &&
            bounds?.height > 0 &&
            visible
            ? { status, bounds, download }
            : null;
        },
        10000,
        "visible recommended dictionary control in Settings",
      );
      const downloadPoint = {
        x:
          settingsReady.bounds.x +
          settingsReady.download.x +
          settingsReady.download.width / 2,
        y:
          settingsReady.bounds.y +
          settingsReady.download.y +
          settingsReady.download.height / 2,
      };
      const downloadClick = nativeCommand(
        desktopTest,
        ["--click", String(downloadPoint.x), String(downloadPoint.y), "left"],
        "native recommended-dictionary download click",
      );
      assert.equal(downloadClick.ok, true);
      assert.equal(downloadClick.accessibilityTrusted, true);
      assert.equal(downloadClick.postEventTrusted, true);
      const downloadStartedAt = Date.now();
      const downloadTimeoutMs = Math.max(
        60000,
        Number(process.env.IINATAN_E2E_AUTOSTART_DICTIONARY_TIMEOUT_MS) || 1800000,
      );
      const downloadedStatus = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (!status) return null;
          latestStatus = status;
          const ids = status.dictionary?.ids || [];
          return ids.includes(liveDictionaryId) && status.dictionary?.enabled > 0
            ? status
            : null;
        },
        downloadTimeoutMs,
        `plugin Settings download of ${liveDictionaryId}`,
      );

      const closeSettings = nativeCommand(
        desktopTest,
        [
          "--click",
          String(settingsReady.status.settingsWindow.bounds.x + 16),
          String(settingsReady.status.settingsWindow.bounds.y + 16),
          "left",
        ],
        "native Settings titlebar close",
      );
      assert.equal(closeSettings.ok, true);
      await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (status) latestStatus = status;
          return status?.settingsWindow?.visible !== true;
        },
        10000,
        "direct companion Settings window close",
      );
      const windowProbe = nativeWindowProbeExecutable();
      if (!windowProbe)
        throw new Error("direct live popup evidence requires the native window probe");
      const nativeWindow = new NativeWindowAdapter({
        probeExecutable: windowProbe,
        resourceRoot: root,
        sessionDirectory,
        timeoutMs: 3000,
      });
      const activatePlayer = await nativeWindow.focus(descriptor);
      assert.equal(activatePlayer.ok, true);
      assert.equal(activatePlayer.foregroundVerified, true);
      const foregroundStatus = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (status) latestStatus = status;
          return sessionStatus(status, descriptor.sessionId)?.source?.foreground ===
            true
            ? status
            : null;
        },
        3000,
        "direct mpv foreground ownership after Settings",
      ).catch(() => readStatus(e2eStatusPath));

      const liveSession = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (status) latestStatus = status;
          const session = sessionStatus(status, descriptor.sessionId);
          return session?.source?.exact === true &&
            session.content?.width > 0 &&
            session.osd?.width > 0 &&
            lookupableUnits(session).length
            ? session
            : null;
        },
        30000,
        "live direct-autostart subtitle geometry after dictionary download",
      );
      const lookup = lookupableUnits(liveSession)[0];
      const target = pointerTarget(liveSession, lookup.unit);
      const move = nativeCommand(
        desktopTest,
        ["--move", String(target.x), String(target.y)],
        "native direct-autostart subtitle lookup move",
      );
      assert.equal(move.ok, true);
      assert.equal(move.accessibilityTrusted, true);
      assert.equal(move.postEventTrusted, true);
      const popup = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (status) latestStatus = status;
          const session = sessionStatus(status, descriptor.sessionId);
          return session?.popupVisible === true &&
            session.popupWindow?.visible === true &&
            session.popupWindow?.focused === true &&
            session.highlightWindow?.visible === true &&
            session.popupHit?.unitId === lookup.unit.id &&
            session.popupHeadword
            ? session
            : null;
        },
        30000,
        "dictionary popup from the direct auto-started companion",
      );

      let capture = null;
      if (evidenceDirectory) {
        await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
        const capturePath = path.join(evidenceDirectory, "direct-live-popup.png");
        const center = {
          x: liveSession.content.x + liveSession.content.width / 2,
          y: liveSession.content.y + liveSession.content.height / 2,
        };
        capture = nativeCommand(
          desktopTest,
          ["--capture-at", capturePath, String(center.x), String(center.y)],
          "direct live popup desktop capture",
        );
        capture.path = capturePath;
      }

      const dismiss = nativeCommand(
        desktopTest,
        ["--key", "escape"],
        "native direct popup dismissal",
      );
      assert.equal(dismiss.ok, true);
      const dismissedStatus = await waitFor(
        async () => {
          const status = await readStatus(e2eStatusPath);
          if (status) latestStatus = status;
          const session = sessionStatus(status, descriptor.sessionId);
          return session?.popupVisible === false &&
            session?.popupWindow?.visible !== true
            ? status
            : null;
        },
        10000,
        "direct popup dismissal without passing input to mpv",
      );
      assert.equal(await ipc.getProperty("pause"), true);
      livePopupEvidence = {
        dictionary: {
          id: liveDictionaryId,
          installed: downloadedStatus.dictionary?.ids || [],
          downloadMs: Date.now() - downloadStartedAt,
          initiatedBy: "settings-window-download-button",
        },
        settings: {
          window: settingsReady.status.settingsWindow,
          activation: activateCompanion,
          scroll: settingsScroll,
          downloadControl: settingsReady.download,
          click: downloadClick,
          close: closeSettings,
        },
        playerActivation: activatePlayer,
        foregroundStatus:
          sessionStatus(foregroundStatus, descriptor.sessionId)?.source?.foreground ??
          null,
        lookup: {
          trackId: lookup.track.id,
          eventId: lookup.event.id,
          unitId: lookup.unit.id,
          text: lookup.unit.text,
          target,
          move,
          popup: {
            headword: popup.popupHeadword,
            hit: popup.popupHit,
            highlightWindow: popup.highlightWindow,
            popupWindow: popup.popupWindow,
          },
          capture,
          dismiss,
          dismissed: {
            reason: sessionStatus(dismissedStatus, descriptor.sessionId)
              ?.lastPopupCloseReason,
            pauseStillOwnedByTest: true,
          },
        },
      };
    }

    const result = {
      ok: true,
      mode: livePopup
        ? "macos-direct-mpv-launchservices-autostart-live-settings-popup"
        : "macos-direct-mpv-launchservices-autostart",
      mpv: executable,
      mediaPath,
      sessionDirectory,
      descriptor: {
        sessionId: descriptor.sessionId,
        pid: descriptor.pid,
        ipcEndpoint: descriptor.ipcEndpoint,
      },
      companion: freshCompanion.map((row) => ({
        pid: row.pid,
        command: row.command,
      })),
      attachment: {
        sessionId: descriptor.sessionId,
        pid: descriptor.pid,
        statusReason: attachedStatus?.reason || null,
        nativeGeometry:
          geometryStatus?.sessions?.find(
            (session) => session.sessionId === descriptor.sessionId,
          )?.source || null,
      },
      failClosed: failClosedEvidence,
      supportedRenderer: supportedRendererEvidence,
      livePopup: livePopupEvidence,
      preservedDescriptorNames: [...beforeDescriptors],
    };
    if (evidenceDirectory) {
      await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(evidenceDirectory, "result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        { mode: 0o600 },
      );
      if (attachedStatus) {
        await fs.writeFile(
          path.join(evidenceDirectory, "attached-status.json"),
          `${JSON.stringify(attachedStatus, null, 2)}\n`,
          { mode: 0o600 },
        );
      }
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    ipc?.close();
    await stopMpv(child).catch(() => {});
    await waitFor(
      async () => {
        const current = await listDescriptors(sessionDirectory);
        return !current.some((value) => value.pid === child.pid);
      },
      10000,
      "the direct mpv descriptor cleanup",
    ).catch(() => {});
    // SIGTERM is not guaranteed to run Lua's shutdown callback when mpv is
    // being terminated by a test. Remove only this process's known artifacts
    // after its PID is confirmed dead; never sweep the shared session folder.
    await fs.rm(descriptorPath, { force: true });
    if (descriptor?.ipcEndpoint) await fs.rm(descriptor.ipcEndpoint, { force: true });
    const testCompanion = freshCompanion.filter((row) =>
      row.command.includes(`--e2e-status-file=${e2eStatusPath}`),
    );
    await stopCompanion(testCompanion).catch(() => {});
    if (evidenceDirectory && latestStatus) {
      await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(evidenceDirectory, "last-status.json"),
        `${JSON.stringify(latestStatus, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    await fs.rm(e2eStatusPath, { force: true });
    if (userDataPath) await fs.rm(userDataPath, { recursive: true, force: true });
    const afterDescriptors = new Set(
      (await listDescriptors(sessionDirectory)).map((value) => `${value.pid}.json`),
    );
    for (const name of beforeDescriptors)
      assert.equal(
        afterDescriptors.has(name),
        true,
        `pre-existing descriptor disappeared: ${name}`,
      );
    if (hadCompanion) {
      await execFileAsync("open", ["-g", "-a", companionApplication]);
      await waitFor(
        async () =>
          companionRows(await processRows()).some(
            (row) => !row.command.includes("--e2e-status-file="),
          ),
        10000,
        "the restored normal companion",
      );
    }
  }
}

main().catch((error) => {
  console.error(`MACOS AUTOSTART SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
