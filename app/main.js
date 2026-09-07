"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  shell,
} = require("electron");
const { BrowserHost } = require("../src/platform/browser-host");
const { NativeWindowAdapter } = require("../src/platform/native-window-adapter");
const { ApplicationController } = require("../src/player/application-controller");
const {
  DictionaryService,
  HoshiDictionaryService,
} = require("../src/services/dictionary-service");
const { HoshiWorker } = require("../src/services/hoshi-worker");
const { DictionaryCatalog } = require("../src/services/dictionary-catalog");
const { SettingsStore } = require("../src/settings/settings-store");
const {
  normalizeGlobalSettings,
  normalizePreferences,
} = require("../src/settings/defaults");
const { AnkiConnectClient } = require("../src/services/anki-connect");
const { normalizeTemplates } = require("../src/services/anki-card");
const { NativeGeometryClient } = require("../src/services/native-geometry-client");
const { NativeGeometryWorker } = require("../src/services/native-geometry-worker");
const { SentenceAudioService } = require("../src/services/sentence-audio-service");
const {
  sanitizeDiagnosticError,
  sanitizeDiagnosticMessage,
} = require("../src/services/diagnostics");
const { launchMpv } = require("../src/player/mpv-launcher");
const { requestedMediaPath } = require("../src/player/launch-arguments");
const {
  NativeSubtitleGeometryService,
} = require("../src/geometry/native-subtitle-geometry-service");
const {
  SubtitleGeometryProvider,
} = require("../src/geometry/subtitle-geometry-provider");
const { listDescriptors, isProcessAlive } = require("../src/player/session-descriptor");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "iinatan",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function argumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

function hasArgument(name) {
  return process.argv.includes(name);
}

function createAnkiClient(preferences) {
  if (!preferences?.ankiEnabled) return null;
  try {
    return new AnkiConnectClient({
      url: preferences.ankiConnectUrl,
      timeoutMs: preferences.ankiConnectTimeoutSeconds * 1000,
    });
  } catch (error) {
    console.warn("[iinatan] AnkiConnect disabled", error.message);
    return null;
  }
}

function ankiConfigFor(preferences, client) {
  return {
    enabled: !!preferences?.ankiEnabled,
    configured:
      !!client &&
      !!String(preferences?.ankiDeckName || "").trim() &&
      !!String(preferences?.ankiModelName || "").trim() &&
      Object.keys(normalizeTemplates(preferences?.ankiFieldTemplatesJson)).length > 0,
    duplicateCheck: preferences?.ankiDuplicateCheck !== false,
    duplicateMode: preferences?.ankiDuplicateMode || "prevent",
    duplicateScope: preferences?.ankiDuplicateScope || "deck",
    deckName: preferences?.ankiDeckName || "",
    modelName: preferences?.ankiModelName || "",
    fieldTemplatesJson: preferences?.ankiFieldTemplatesJson || "{}",
    tags: preferences?.ankiTags || "",
    audioFormat: preferences?.ankiAudioFormat || "mp3",
    audioBitrateKbps: preferences?.ankiAudioBitrateKbps || 96,
    imageQuality: preferences?.ankiImageQuality || 85,
    sentenceAudioPaddingMs: preferences?.ankiSentenceAudioPaddingMs || 250,
  };
}

function controllerConfigFor(preferences, overrides = {}) {
  return {
    controllerEnabled: preferences.controllerEnabled,
    controllerBindings: {
      noPopup: preferences.controllerNoPopupBindingsJson,
      popup: preferences.controllerPopupBindingsJson,
      audio: preferences.controllerAudioBindingsJson,
    },
    pauseWhilePopupVisible: preferences.pauseWhilePopupVisible,
    subtitleLookupMode: preferences.subtitleLookupMode,
    lookupLanguage: overrides.lookupLanguage || preferences.lookupLanguage,
    scanLength: preferences.scanLength,
    flattenSubtitleLineBreaks: preferences.flattenSubtitleLineBreaks,
    popupMinWidth: preferences.popupMinWidth,
    popupMaxWidth: preferences.popupMaxWidth,
    popupMaxHeight: Math.max(
      220,
      Math.round((preferences.popupMaxHeightVh / 100) * 1080),
    ),
    popupTheme: preferences.popupTheme,
    customCss: preferences.customPopupCss,
    audioSources: preferences.audioSourcesJson,
    audioAutoPlay: preferences.audioAutoPlay,
    popupGap: preferences.popupSubtitleGapPx,
    popupScale: preferences.popupScale,
    fontScale: preferences.fontScale,
    nestedPopupMode: preferences.nestedPopupMode,
    nestedPopupMaxDepth: preferences.nestedPopupMaxDepth,
    etymologyCollapseDefault: preferences.etymologyCollapseDefault,
    wiktionaryEtymologyCollapseOverride:
      preferences.wiktionaryEtymologyCollapseOverride,
    lookupTimeoutMs: preferences.lookupTimeoutMs,
    hoverRequestTimeoutMs: preferences.hoverRequestTimeoutMs,
    backendTimeoutMs: preferences.backendTimeoutMs,
    subtitlePollMs: preferences.subtitlePollMs,
  };
}

function controllerValues(controllers) {
  if (controllers instanceof Map) return [...controllers.values()];
  return controllers ? [controllers] : [];
}

function displaySessionType() {
  const explicit = String(process.env.XDG_SESSION_TYPE || "")
    .trim()
    .toLowerCase();
  if (explicit) return explicit;
  if (process.env.WAYLAND_DISPLAY) return "wayland";
  if (process.env.DISPLAY) return "x11";
  return "unknown";
}

function settingsDiagnostics(runtime, controllers) {
  const sessionType = displaySessionType();
  const windowCapability = new NativeWindowAdapter({ sessionType }).capability();
  const catalogEntries = runtime.catalog.list({ includeDisabled: true });
  const sessions = controllerValues(controllers).map((controller) => {
    const snapshot = controller.snapshot;
    const source = snapshot?.source || null;
    const subtitleSource = source
      ? {
          mode: String(source.mode || "unknown").slice(0, 80),
          exact: source.exact === true,
          reason: source.reason ? sanitizeDiagnosticMessage(source.reason) : null,
        }
      : null;
    return {
      sessionId: String(controller.descriptor?.sessionId || "unknown").slice(0, 120),
      interaction: String(controller.interaction?.state || "unknown"),
      foreground: typeof source?.foreground === "boolean" ? source.foreground : null,
      geometry: {
        available: !!snapshot?.content,
        contentExact: source?.contentExact === true,
        nativeSubtitleGeometry: source?.mode === "native-libass-instrumented",
        subtitleSource,
        contentSource: String(source?.contentSource || "unknown"),
        nativeGeometryError: sanitizeDiagnosticError(controller.nativeGeometryError),
      },
    };
  });
  return {
    protocol: 1,
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      displaySession: sessionType,
    },
    player: {
      backend: hasArgument("--demo") ? "demo" : "stock-mpv-json-ipc",
      nativeSubtitles: "mpv",
      activeSessions: sessions.length,
    },
    dictionary: {
      backend: runtime.worker
        ? "hoshidicts"
        : hasArgument("--demo")
          ? "demo"
          : "unavailable",
      installed: catalogEntries.length,
      enabled: catalogEntries.filter((entry) => entry.enabled !== false).length,
    },
    window: {
      backend: String(windowCapability.backend || "unknown"),
      exactContentCapability: windowCapability.exactContent === true,
      supported: windowCapability.supported !== false,
      needsPlayerShim: windowCapability.needsPlayerShimForWindowed === true,
      reason: windowCapability.reason
        ? String(windowCapability.reason).slice(0, 240)
        : null,
    },
    subtitleGeometry: {
      nativeHelper: runtime.nativeGeometry
        ? "configured; session evidence is required"
        : "unavailable",
      source:
        sessions.map((session) => session.geometry.subtitleSource).find(Boolean) ||
        null,
      exactSessionCount: sessions.filter(
        (session) =>
          session.geometry.contentExact && session.geometry.nativeSubtitleGeometry,
      ).length,
      evidenceBoundary:
        "Settings diagnostics do not prove stock-mpv glyph geometry, compositor placement, or native input.",
    },
    sessions,
  };
}

function settingsState(runtime, controllers) {
  const document = runtime.settingsStore.current();
  const profile = document.profiles[document.activeProfileId];
  const preferences = profile?.preferences || normalizePreferences({});
  return JSON.parse(
    JSON.stringify({
      schemaVersion: document.schemaVersion,
      activeProfileId: document.activeProfileId,
      global: document.global,
      profiles: Object.values(document.profiles),
      dictionaries: runtime.catalog.list({ includeDisabled: true }),
      recommendedDictionaries: runtime.catalog.recommended(preferences.lookupLanguage),
      diagnostics: settingsDiagnostics(runtime, controllers),
    }),
  );
}

function runtimeDictionaryFingerprint(
  runtime,
  document = runtime.settingsStore.current(),
) {
  const profile = document.profiles[document.activeProfileId];
  return JSON.stringify({
    profileId: document.activeProfileId,
    language: profile?.preferences?.lookupLanguage || "ja",
    dictionaries: runtime.catalog.activePaths(),
  });
}

async function applyRuntimePreferences(
  runtime,
  controllers,
  overrides = runtime.controllerOverrides || {},
) {
  const activeControllers = controllerValues(controllers);
  const beforeFingerprint = runtime.dictionaryFingerprint;
  await runtime.catalog.load();
  const document = runtime.settingsStore.current();
  const profile = document.profiles[document.activeProfileId];
  const preferences = profile?.preferences || normalizePreferences({});
  const nextFingerprint = runtimeDictionaryFingerprint(runtime, document);
  runtime.preferences = preferences;

  const anki = createAnkiClient(preferences);
  runtime.anki = anki;
  if (runtime.dictionary?.timeoutMs !== undefined)
    runtime.dictionary.timeoutMs = Math.max(
      250,
      Number(preferences.lookupTimeoutMs) || 9000,
    );
  if (runtime.worker) {
    runtime.worker.timeoutMs = Math.max(
      1000,
      Number(preferences.backendTimeoutMs) || 30000,
    );
    runtime.worker.pollMs = Math.max(1, Number(preferences.directIpcPollMs) || 2);
  }
  for (const controller of activeControllers) {
    controller.anki = anki;
    await controller.updateConfiguration(
      controllerConfigFor(preferences, overrides),
      ankiConfigFor(preferences, anki),
    );
  }

  if (runtime.dictionary instanceof HoshiDictionaryService) {
    runtime.dictionary.maxResults = Math.max(1, Number(preferences.maxEntries) || 8);
    runtime.dictionary.maxGlossaries = Math.max(
      1,
      Number(preferences.maxGlossesPerEntry) || 4,
    );
    runtime.dictionary.scanLength = Math.max(1, Number(preferences.scanLength) || 24);
  }
  const workerSleepMs = Math.max(1, Number(preferences.workerIdleSleepMs) || 2);
  const workerConfigurationChanged =
    runtime.worker &&
    (nextFingerprint !== beforeFingerprint ||
      runtime.worker.sleepMs !== workerSleepMs ||
      runtime.worker.controllerRequested !==
        (process.platform === "darwin" && preferences.controllerEnabled === true));
  if (runtime.worker && workerConfigurationChanged) {
    const paths = runtime.catalog.activePaths();
    if (paths.length) {
      await runtime.worker.configure({
        language: preferences.lookupLanguage || "ja",
        dictionaries: paths,
        fingerprint: nextFingerprint,
        sleepMs: workerSleepMs,
        controllerEnabled: preferences.controllerEnabled === true,
      });
      if (!(runtime.dictionary instanceof HoshiDictionaryService)) {
        runtime.dictionary = new HoshiDictionaryService({
          worker: runtime.worker,
          maxResults: preferences.maxEntries,
          maxGlossaries: preferences.maxGlossesPerEntry,
          scanLength: preferences.scanLength,
          timeoutMs: preferences.lookupTimeoutMs,
        });
        for (const controller of activeControllers)
          controller.dictionary = runtime.dictionary;
      }
    } else {
      await runtime.worker.stop();
      runtime.dictionary = new DictionaryService({
        demo: hasArgument("--demo"),
        timeoutMs: preferences.lookupTimeoutMs,
      });
      for (const controller of activeControllers)
        controller.dictionary = runtime.dictionary;
    }
  }
  runtime.dictionaryFingerprint = nextFingerprint;
}

function descriptorFromArguments() {
  const ipcEndpoint = argumentValue("--mpv-ipc");
  if (!ipcEndpoint) return null;
  const pid = Number(argumentValue("--mpv-pid"));
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error("--mpv-pid is required with --mpv-ipc");
  return {
    sessionId: argumentValue("--session-id") || `manual-${pid}`,
    pid,
    windowId: argumentValue("--mpv-window-id") || null,
    ipcEndpoint,
    startedAt: "manual",
    backend: "manual",
  };
}

async function registerAppProtocol() {
  const appRoot = path.join(app.getAppPath(), "app");
  await protocol.handle("iinatan", async (request) => {
    const url = new URL(request.url);
    if (
      url.protocol !== "iinatan:" ||
      !["app", "overlay"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return new Response("Not found", { status: 404 });
    let relative;
    try {
      relative = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch (_) {
      return new Response("Bad request", { status: 400 });
    }
    const allowed = new Set([
      "overlay.html",
      "overlay.css",
      "renderer.js",
      "settings.html",
      "settings.css",
      "settings-renderer.js",
    ]);
    if (!allowed.has(relative)) return new Response("Not found", { status: 404 });
    const filePath = path.join(appRoot, relative);
    const body = await fs.readFile(filePath);
    const type = relative.endsWith(".html")
      ? "text/html; charset=utf-8"
      : relative.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/javascript; charset=utf-8";
    const contentSecurityPolicy =
      relative === "overlay.html"
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src https: http://127.0.0.1 http://localhost; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    return new Response(body, {
      headers: {
        "content-type": type,
        "cache-control": "no-store",
        "content-security-policy": contentSecurityPolicy,
      },
    });
  });
}

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
}

async function createSentenceAudioRuntime() {
  const explicit = argumentValue("--ffmpeg") || process.env.IINATAN_FFMPEG || "";
  const bundled = path.join(resourceRoot(), "bin", "ffmpeg.exe");
  const executable = explicit || bundled;
  try {
    await fs.access(executable);
    return new SentenceAudioService({ executable });
  } catch (_) {
    return null;
  }
}

async function createDictionaryRuntime() {
  const settingsStore = new SettingsStore(
    SettingsStore.defaultPath(app.getPath("userData")),
  );
  const catalog = new DictionaryCatalog({
    settingsStore,
    installRoot: path.join(app.getPath("userData"), "dictionaries"),
  });
  await catalog.load();
  const document = settingsStore.current();
  const profile = document.profiles[document.activeProfileId];
  const preferences = normalizePreferences(profile?.preferences || {});
  const executable =
    argumentValue("--hoshi-executable") ||
    path.join(
      resourceRoot(),
      "bin",
      process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts",
    );
  let worker = null;
  if (!hasArgument("--demo")) {
    try {
      await fs.access(executable);
      worker = new HoshiWorker({
        executable,
        root: path.join(app.getPath("userData"), "hoshi-worker"),
        timeoutMs: preferences.backendTimeoutMs,
        pollMs: preferences.directIpcPollMs,
        sleepMs: preferences.workerIdleSleepMs,
        nativeControllerSupported: process.platform === "darwin",
      });
      const dictionaryPaths = catalog.activePaths();
      if (dictionaryPaths.length)
        await worker.configure({
          language: preferences.lookupLanguage || "ja",
          dictionaries: dictionaryPaths,
          fingerprint: dictionaryPaths.join("\n"),
          sleepMs: preferences.workerIdleSleepMs,
          controllerEnabled: preferences.controllerEnabled === true,
        });
      else {
        await worker.stop();
      }
    } catch (error) {
      console.warn("[iinatan] HoshiDicts backend unavailable", error.message);
      await worker?.stop().catch(() => {});
      worker = null;
    }
  }
  const dictionary = worker
    ? new HoshiDictionaryService({
        worker,
        maxResults: preferences.maxEntries,
        maxGlossaries: preferences.maxGlossesPerEntry,
        scanLength: preferences.scanLength,
        timeoutMs: preferences.lookupTimeoutMs,
      })
    : new DictionaryService({
        demo: hasArgument("--demo"),
        timeoutMs: preferences.lookupTimeoutMs,
      });
  const anki = createAnkiClient(preferences);
  catalog.setWorker(worker);
  const runtime = { dictionary, catalog, settingsStore, worker, anki, preferences };
  runtime.dictionaryFingerprint = runtimeDictionaryFingerprint(runtime);
  return runtime;
}

async function createNativeGeometryRuntime(geometryProvider) {
  const explicitExecutable = argumentValue("--native-geometry-executable");
  const bundledPatchedExecutable =
    process.platform === "darwin" && hasArgument("--enable-patched-native-geometry")
      ? path.join(resourceRoot(), "bin", "iina-hoshi-dicts")
      : "";
  const executable = explicitExecutable || bundledPatchedExecutable;
  if (!executable) return null;
  try {
    await fs.access(executable);
    const root =
      argumentValue("--native-geometry-root") ||
      path.join(app.getPath("userData"), "native-geometry");
    const worker = new NativeGeometryWorker({ executable, root });
    return new NativeSubtitleGeometryService({
      client: new NativeGeometryClient(worker),
      geometryProvider,
    });
  } catch (error) {
    console.warn("[iinatan] native subtitle geometry unavailable", error.message);
    return null;
  }
}

async function main() {
  if (process.platform === "darwin" && app.dock) app.dock.hide();
  await app.whenReady();
  await registerAppProtocol();

  const runtime = await createDictionaryRuntime();
  const geometryProvider = new SubtitleGeometryProvider();
  const nativeGeometry = await createNativeGeometryRuntime(geometryProvider);
  runtime.nativeGeometry = nativeGeometry;
  const sentenceAudio = await createSentenceAudioRuntime();
  const controllerOverrides = {
    lookupLanguage: argumentValue("--lookup-language"),
  };
  runtime.controllerOverrides = controllerOverrides;
  const runtimeDir =
    argumentValue("--runtime-dir") ||
    process.env.IINATAN_SESSION_DIR ||
    path.join(app.getPath("userData"), "sessions");
  const controllers = new Map();
  const syncControllerSource = () => {
    const source = runtime.worker?.nativeControllerAvailable
      ? "native-hid"
      : "browser-gamepad";
    for (const controller of controllers.values())
      controller.browserHost?.setControllerSource?.(source);
  };
  runtime.worker?.on("controller-capability", syncControllerSource);
  runtime.worker?.on("controller-state", (state) => {
    for (const controller of controllers.values())
      controller
        .handleControllerState(state)
        .catch((error) => controller.emit("error", error));
  });
  const e2eStatusPath = argumentValue("--e2e-status-file");
  let e2eStatusSerial = Promise.resolve();
  let e2eStatusTimer = null;

  function windowStatus(window) {
    if (!window || window.isDestroyed()) return null;
    return {
      visible: typeof window.isVisible === "function" && window.isVisible(),
      focused: typeof window.isFocused === "function" && window.isFocused(),
      alwaysOnTop: typeof window.isAlwaysOnTop === "function" && window.isAlwaysOnTop(),
      bounds: typeof window.getBounds === "function" ? window.getBounds() : null,
    };
  }

  function e2eStatus() {
    const catalogEntries = runtime.catalog.list({ includeDisabled: true });
    const applicationMenu = Menu.getApplicationMenu();
    const applicationMenuItem = applicationMenu?.items?.find(
      (item) => item.label === "iinatan",
    );
    const settingsMenuItem = applicationMenuItem?.submenu?.items?.find(
      (item) => item.label === "Settings…",
    );
    return {
      protocol: 1,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      applicationMenu: {
        openMedia: applicationMenuItem?.submenu?.items?.find(
          (item) => item.label === "Open media in mpv…",
        )
          ? {
              label: "Open media in mpv…",
              enabled: true,
              visible: true,
            }
          : null,
        settings: settingsMenuItem
          ? {
              label: settingsMenuItem.label,
              accelerator: settingsMenuItem.accelerator || null,
              enabled: settingsMenuItem.enabled === true,
              visible: settingsMenuItem.visible !== false,
            }
          : null,
      },
      settingsWindow: windowStatus(settingsWindow),
      dictionary: {
        backend: runtime.worker
          ? "hoshidicts"
          : hasArgument("--demo")
            ? "demo"
            : "unavailable",
        fingerprint: runtime.dictionaryFingerprint || null,
        installed: catalogEntries.length,
        enabled: catalogEntries.filter((entry) => entry.enabled !== false).length,
      },
      sessions: [...controllers.values()].map((controller) => ({
        sessionId: controller.descriptor?.sessionId || null,
        identity: controller.bridge?.identity?.() || null,
        interaction: controller.interaction.state,
        interactionSnapshot: controller.interaction.snapshot?.() || null,
        cursorDiagnostic: controller.cursorDiagnostic || null,
        geometryGeneration: controller.snapshot?.geometryGeneration ?? null,
        content: controller.snapshot?.content || null,
        osd: controller.snapshot?.osd || null,
        desktopScale: controller.snapshot?.desktopScale ?? null,
        browserScale: controller.snapshot?.browserScale ?? null,
        source: controller.snapshot?.source || null,
        nativeGeometryError: controller.nativeGeometryError || null,
        tracks: controller.snapshot?.tracks || null,
        popupVisible: !!controller.browserHost?.popupVisible,
        popupMeasuredSize: controller.popupMeasuredSize || null,
        popupRegions: controller.popupRegions || null,
        popupScroll: controller.popupScroll || null,
        popupSelectionText: controller.popupSelectionText || "",
        lastPopupCloseReason: controller.lastPopupCloseReason || null,
        surfaceReadiness: controller.browserHost?.surfaceReadiness?.() || null,
        popupPlacement: controller.popupPlacement || null,
        highlightWindow: windowStatus(controller.browserHost?.highlightWindow),
        popupWindow: windowStatus(controller.browserHost?.popupWindow),
      })),
    };
  }

  function publishE2EStatus(reason) {
    if (!e2eStatusPath) return e2eStatusSerial;
    e2eStatusSerial = e2eStatusSerial
      .catch(() => {})
      .then(async () => {
        const directory = path.dirname(e2eStatusPath);
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${e2eStatusPath}.${process.pid}.next`;
        await fs.writeFile(
          temporary,
          `${JSON.stringify({ ...e2eStatus(), reason: String(reason || "update") })}\n`,
          { mode: 0o600 },
        );
        await fs.rename(temporary, e2eStatusPath);
      });
    return e2eStatusSerial;
  }

  function createController() {
    const browserHost = new BrowserHost({
      BrowserWindow,
      ipcMain,
      preloadPath: path.join(__dirname, "preload.js"),
      overlayUrl: "iinatan://app/overlay.html",
      controllerSource: runtime.worker?.nativeControllerAvailable
        ? "native-hid"
        : "browser-gamepad",
    });
    const nativeWindow = new NativeWindowAdapter({
      resourceRoot: resourceRoot(),
      sessionDirectory: runtimeDir,
      screen,
    });
    const controller = new ApplicationController({
      browserHost,
      windowAdapter: nativeWindow,
      screen,
      shell,
      dictionary: runtime.dictionary,
      sentenceAudio,
      anki: runtime.anki,
      ankiConfig: ankiConfigFor(runtime.preferences, runtime.anki),
      geometryProvider,
      nativeGeometry,
      config: controllerConfigFor(runtime.preferences, controllerOverrides),
      demo: hasArgument("--demo"),
      allowApproximateGeometry:
        hasArgument("--allow-approximate-geometry") || hasArgument("--demo"),
    });
    controller.on("error", (error) => console.error("[iinatan]", error));
    controller.on("native-geometry-unavailable", (error) =>
      console.warn("[iinatan] native subtitle geometry skipped", error.message),
    );
    controller.on("geometry", () => publishE2EStatus("geometry"));
    controller.on("window-unavailable", () => publishE2EStatus("window-unavailable"));
    controller.on("surface-ready", () => publishE2EStatus("surface-ready"));
    controller.on("popup-size", () => publishE2EStatus("popup-size"));
    controller.on("popup-region", () => publishE2EStatus("popup-region"));
    controller.on("popup-scroll", () => publishE2EStatus("popup-scroll"));
    controller.on("popup-selection", () => publishE2EStatus("popup-selection"));
    controller.on("cursor-diagnostic", () => publishE2EStatus("cursor-diagnostic"));
    browserHost.on("popup-closed", () => publishE2EStatus("popup-closed"));
    browserHost.on("stacking-error", (error) =>
      console.warn("[iinatan] companion-window stacking failed", error.message),
    );
    controller.on("focus-player", () => {
      if (process.platform === "darwin" && typeof app.hide === "function") app.hide();
      nativeWindow
        .focus(controller.descriptor)
        .catch((error) => console.warn("[iinatan] player activation failed", error));
    });
    return controller;
  }

  let settingsWindow = null;
  const launchedMpv = new Set();

  async function bundledNativeShimPath() {
    if (process.platform !== "darwin") return null;
    const candidates = [
      path.join(resourceRoot(), "bin", "iinatan-mpv-window-shim.so"),
      path.join(resourceRoot(), "build", "native", "iinatan-mpv-window-shim.so"),
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch (_) {}
    }
    return null;
  }

  async function openMediaInMpv(mediaPath = null) {
    let selectedPath = String(mediaPath || "").trim();
    if (!selectedPath) {
      const selection = await dialog.showOpenDialog({
        title: "Open media in mpv",
        properties: ["openFile"],
      });
      if (selection.canceled || !selection.filePaths[0]) return;
      selectedPath = selection.filePaths[0];
    }
    const nativeShimPath = await bundledNativeShimPath();
    try {
      const launch = await launchMpv({
        executable:
          argumentValue("--mpv-executable") ||
          process.env.IINATAN_MPV ||
          (process.platform === "win32" ? "mpv.exe" : "mpv"),
        mediaPath: selectedPath,
        nativeShimPath,
        resourceRoot: resourceRoot(),
        sessionDirectory: runtimeDir,
        temporaryDirectory: app.getPath("temp"),
      });
      launchedMpv.add(launch);
      launch.closePromise.finally(() => launchedMpv.delete(launch)).catch(() => {});
    } catch (error) {
      dialog.showErrorBox("Could not start mpv", error.message);
    }
  }

  async function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
      return;
    }
    settingsWindow = new BrowserWindow({
      width: 1080,
      height: 820,
      minWidth: 720,
      minHeight: 560,
      show: false,
      title: "iinatan settings",
      webPreferences: {
        preload: path.join(__dirname, "settings-preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
      },
    });
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    settingsWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    settingsWindow.webContents.on("will-redirect", (event) => event.preventDefault());
    settingsWindow.on("closed", () => {
      settingsWindow = null;
    });
    try {
      await settingsWindow.loadURL("iinatan://app/settings.html");
      settingsWindow.show();
      settingsWindow.focus();
    } catch (error) {
      settingsWindow.close();
      throw error;
    }
  }

  ipcMain.handle("settings-request", async (event, raw) => {
    if (!settingsWindow || settingsWindow.isDestroyed())
      throw new Error("settings window is not available");
    if (event.sender.id !== settingsWindow.webContents.id)
      throw new Error("settings request sender is not authorized");
    if (!raw || raw.protocol !== 1 || typeof raw.type !== "string")
      throw new Error("invalid settings request envelope");
    const payload =
      raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
        ? raw.payload
        : {};
    if (JSON.stringify(payload).length > 1024 * 1024)
      throw new Error("settings request is too large");
    switch (raw.type) {
      case "get-state":
        return { state: settingsState(runtime, controllers) };
      case "save-profile":
        if (!payload.preferences || typeof payload.preferences !== "object")
          throw new Error("profile preferences must be an object");
        await runtime.settingsStore.updateProfile(
          payload.profileId,
          (profile, document) => {
            if (payload.name !== undefined)
              profile.name = String(payload.name || profile.name || profile.id)
                .trim()
                .slice(0, 120);
            profile.preferences = normalizePreferences(payload.preferences);
            if (payload.global && typeof payload.global === "object")
              document.global = normalizeGlobalSettings(payload.global);
          },
        );
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "set-active-profile":
        await runtime.settingsStore.setActiveProfile(payload.profileId);
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "create-profile":
        await runtime.settingsStore.createProfile(payload.id, payload.name);
        await runtime.settingsStore.setActiveProfile(payload.id);
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "delete-profile":
        await runtime.settingsStore.deleteProfile(payload.profileId);
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "reset-profile":
        await runtime.settingsStore.updateProfile(payload.profileId, (profile) => {
          profile.preferences = normalizePreferences({});
        });
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "anki-inspect": {
        const client = createAnkiClient({
          ankiEnabled: true,
          ankiConnectUrl: payload.url,
          ankiConnectTimeoutSeconds: payload.timeoutSeconds,
        });
        if (!client) throw new Error("AnkiConnect URL is not allowed");
        const [version, deckNames, modelNames, fields] = await Promise.all([
          client.versionInfo(),
          client.deckNames(),
          client.modelNames(),
          String(payload.modelName || "").trim()
            ? client.modelFieldNames(payload.modelName)
            : Promise.resolve([]),
        ]);
        return {
          version: Number(version) || 0,
          deckNames: Array.isArray(deckNames)
            ? deckNames.slice(0, 1000).map(String)
            : [],
          modelNames: Array.isArray(modelNames)
            ? modelNames.slice(0, 1000).map(String)
            : [],
          fields: Array.isArray(fields) ? fields.slice(0, 128).map(String) : [],
        };
      }
      case "import-dictionary": {
        if (!runtime.worker)
          throw new Error("Dictionary import backend is unavailable");
        const selection = await dialog.showOpenDialog(settingsWindow, {
          properties: ["openFile"],
          filters: [{ name: "Dictionary archives", extensions: ["zip"] }],
        });
        if (selection.canceled || !selection.filePaths[0])
          return { state: settingsState(runtime, controllers), cancelled: true };
        await runtime.catalog.import(selection.filePaths[0], {
          timeoutMs: runtime.settingsStore.current().global.importTimeoutMs,
        });
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      }
      case "download-recommended": {
        if (!runtime.worker)
          throw new Error("Dictionary download backend is unavailable");
        const document = runtime.settingsStore.current();
        const result = await runtime.catalog.downloadRecommended(payload.id, {
          update: payload.update === true,
          importTimeoutMs: document.global.importTimeoutMs,
          lowRam: document.global.lowRamImport,
        });
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers), entry: result };
      }
      case "set-dictionary-enabled":
        await runtime.catalog.setEnabled(payload.id, payload.enabled);
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "remove-dictionary":
        await runtime.catalog.remove(payload.id, { deleteFiles: true });
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "reorder-dictionaries":
        await runtime.catalog.reorder(payload.ids);
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      case "export-backup": {
        const selection = await dialog.showSaveDialog(settingsWindow, {
          defaultPath: "iinatan-settings.json",
          filters: [{ name: "JSON settings backup", extensions: ["json"] }],
        });
        if (selection.canceled || !selection.filePath)
          return { state: settingsState(runtime, controllers), cancelled: true };
        await runtime.settingsStore.exportBackup(selection.filePath);
        return {
          state: settingsState(runtime, controllers),
          path: selection.filePath,
        };
      }
      case "restore-backup": {
        const selection = await dialog.showOpenDialog(settingsWindow, {
          properties: ["openFile"],
          filters: [{ name: "JSON settings backup", extensions: ["json"] }],
        });
        if (selection.canceled || !selection.filePaths[0])
          return { state: settingsState(runtime, controllers), cancelled: true };
        await runtime.settingsStore.restoreBackup(selection.filePaths[0]);
        await applyRuntimePreferences(runtime, controllers);
        return { state: settingsState(runtime, controllers) };
      }
      default:
        throw new Error(`unknown settings request: ${raw.type}`);
    }
  });

  const openMediaItem = {
    label: "Open media in mpv…",
    click: () =>
      openMediaInMpv().catch((error) =>
        dialog.showErrorBox("Could not start mpv", error.message),
      ),
  };
  const openSettingsItem = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () =>
      openSettings().catch((error) => console.error("[iinatan] settings", error)),
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "iinatan",
        submenu: [openMediaItem, openSettingsItem, { role: "quit" }],
      },
    ]),
  );
  const startupMediaPath = requestedMediaPath();
  if (startupMediaPath)
    openMediaInMpv(startupMediaPath).catch((error) =>
      dialog.showErrorBox("Could not start mpv", error.message),
    );
  if (hasArgument("--settings")) await openSettings();

  const explicit = descriptorFromArguments();
  const explicitFile = argumentValue("--session-file");

  function descriptorMatches(controller, descriptor) {
    const current = controller?.descriptor;
    return !!(
      current &&
      current.sessionId === descriptor.sessionId &&
      current.pid === descriptor.pid &&
      current.windowId === descriptor.windowId &&
      current.ipcEndpoint === descriptor.ipcEndpoint
    );
  }

  async function removeController(sessionId, reason) {
    const controller = controllers.get(sessionId);
    if (!controller) return;
    controllers.delete(sessionId);
    await controller
      .detach(reason)
      .catch((error) => console.warn("[iinatan] session detach failed", error.message));
  }

  async function attachDescriptor(descriptor) {
    const existing = controllers.get(descriptor.sessionId);
    if (existing && descriptorMatches(existing, descriptor)) return;
    if (existing) await removeController(descriptor.sessionId, "replace-session");
    const controller = createController();
    controllers.set(descriptor.sessionId, controller);
    try {
      await controller.attach(descriptor);
      await publishE2EStatus("session-attached");
    } catch (error) {
      controllers.delete(descriptor.sessionId);
      await controller.detach("attach-failed").catch(() => {});
      throw error;
    }
  }

  async function synchronize(descriptors) {
    const desired = new Map();
    for (const descriptor of descriptors) {
      if (!desired.has(descriptor.sessionId))
        desired.set(descriptor.sessionId, descriptor);
    }
    for (const descriptor of desired.values()) await attachDescriptor(descriptor);
    for (const sessionId of controllers.keys()) {
      if (!desired.has(sessionId))
        await removeController(sessionId, "player-not-found");
    }
  }

  let discoveryPromise = null;
  async function discoverOnce() {
    if (explicit) {
      await synchronize(isProcessAlive(explicit.pid) ? [explicit] : []);
      return;
    }
    if (hasArgument("--demo")) {
      if (!controllers.has("demo-session")) {
        const controller = createController();
        controllers.set("demo-session", controller);
        try {
          await controller.attachDemo();
        } catch (error) {
          controllers.delete("demo-session");
          await controller.detach("demo-attach-failed").catch(() => {});
          throw error;
        }
      }
      for (const sessionId of controllers.keys()) {
        if (sessionId !== "demo-session")
          await removeController(sessionId, "demo-mode");
      }
      return;
    }
    const candidates = explicitFile
      ? [await require("../src/player/session-descriptor").readDescriptor(explicitFile)]
      : await listDescriptors(runtimeDir);
    await synchronize(candidates.filter((value) => isProcessAlive(value.pid)));
  }

  async function discover() {
    if (discoveryPromise) return discoveryPromise;
    const promise = discoverOnce();
    discoveryPromise = promise;
    try {
      await promise;
    } finally {
      if (discoveryPromise === promise) discoveryPromise = null;
    }
  }

  try {
    await discover();
    await publishE2EStatus("initial-discovery");
  } catch (error) {
    console.error("[iinatan] initial attach failed", error);
  }
  const discoveryTimer = setInterval(
    () =>
      discover().catch((error) => console.error("[iinatan] discovery failed", error)),
    1000,
  );
  if (e2eStatusPath) e2eStatusTimer = setInterval(() => publishE2EStatus("poll"), 100);

  app.on("before-quit", () => {
    clearInterval(discoveryTimer);
    clearInterval(e2eStatusTimer);
    for (const controller of controllers.values())
      controller.detach("shutdown").catch(() => {});
    runtime.worker?.stop().catch(() => {});
  });
  app.on("window-all-closed", (event) => event.preventDefault());
  app.on("activate", () =>
    discover().catch((error) => console.error("[iinatan] activate failed", error)),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => app.quit());
}

main().catch((error) => {
  console.error("[iinatan] fatal", error);
  app.quit();
});
