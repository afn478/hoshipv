"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray,
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
const {
  ACTIONS: CONTROLLER_ACTIONS,
  BUTTONS: CONTROLLER_BUTTONS,
  DEFAULTS: CONTROLLER_DEFAULTS,
} = require("../src/interaction/controller-bindings");

function nativeControllerSupportedOnPlatform() {
  return ["darwin", "win32"].includes(process.platform);
}

const { AnkiConnectClient } = require("../src/services/anki-connect");
const { normalizeTemplates } = require("../src/services/anki-card");
const { NativeGeometryClient } = require("../src/services/native-geometry-client");
const { NativeGeometryWorker } = require("../src/services/native-geometry-worker");
const { NativeBitmapOcrClient } = require("../src/services/native-bitmap-ocr-client");
const { NativeBitmapOcrWorker } = require("../src/services/native-bitmap-ocr-worker");
const { SentenceAudioService } = require("../src/services/sentence-audio-service");
const {
  sanitizeDiagnosticError,
  sanitizeDiagnosticMessage,
} = require("../src/services/diagnostics");
const { launchMpv } = require("../src/player/mpv-launcher");
const { requestedMediaPath } = require("../src/player/launch-arguments");
const { defaultSessionDirectory } = require("../src/player/session-directory");
const {
  NativeSubtitleGeometryService,
  VALIDATED_PLAYER_CAPABILITY,
  WINDOWS_LIBASS_0174_EMBEDDED_ASS_PROFILE,
  WINDOWS_LIBASS_0174_SUBRIP_PROFILE,
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

function demoDictionaryEnabled() {
  return hasArgument("--demo") || process.env.IINATAN_E2E_DEMO_DICTIONARY === "1";
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
    nestedPopupMode: preferences.nestedPopupMode,
    nestedPopupMaxDepth: preferences.nestedPopupMaxDepth,
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
    bitmapSubtitleOcrEnabled: preferences.bitmapSubtitleOcrEnabled,
    bitmapSubtitleOcrPrefetchEnabled: preferences.bitmapSubtitleOcrPrefetchEnabled,
    bitmapSubtitleOcrScreenshotFallbackEnabled:
      preferences.bitmapSubtitleOcrScreenshotFallbackEnabled,
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
        : demoDictionaryEnabled()
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
      controllerBindings: {
        buttons: CONTROLLER_BUTTONS,
        actions: CONTROLLER_ACTIONS,
        defaults: CONTROLLER_DEFAULTS,
      },
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
        (nativeControllerSupportedOnPlatform() &&
          preferences.controllerEnabled === true));
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
      "highlight-renderer.js",
      "host-overlay-adapter.js",
      "iina-popup-renderer.js",
      "mpv-popup-integration.js",
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

function createTrayIcon() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">',
    '<path fill="black" d="M2 2.5h14v10H9l-4.5 3.5v-3.5H2z"/>',
    '<circle fill="white" cx="6" cy="7.5" r="1"/>',
    '<circle fill="white" cx="9" cy="7.5" r="1"/>',
    '<circle fill="white" cx="12" cy="7.5" r="1"/>',
    "</svg>",
  ].join("");
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  icon.setTemplateImage(true);
  return icon;
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
  const hoshiName =
    process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts";
  const explicitExecutable =
    argumentValue("--hoshi-executable") ||
    String(process.env.IINATAN_HOSHI || "").trim();
  const executableCandidates = explicitExecutable
    ? [path.resolve(explicitExecutable)]
    : [
        path.join(resourceRoot(), "bin", hoshiName),
        ...(app.isPackaged
          ? []
          : [path.join(resourceRoot(), "build", "package-resources", hoshiName)]),
      ];
  let executable = executableCandidates[0];
  if (!explicitExecutable) {
    for (const candidate of executableCandidates) {
      try {
        await fs.access(candidate);
        executable = candidate;
        break;
      } catch (_) {}
    }
  }
  let worker = null;
  if (!demoDictionaryEnabled()) {
    try {
      await fs.access(executable);
      worker = new HoshiWorker({
        executable,
        root: path.join(app.getPath("userData"), "hoshi-worker"),
        timeoutMs: preferences.backendTimeoutMs,
        pollMs: preferences.directIpcPollMs,
        sleepMs: preferences.workerIdleSleepMs,
        nativeControllerSupported: nativeControllerSupportedOnPlatform(),
        controllerStatePath: process.env.IINATAN_E2E_CONTROLLER_STATE_FILE || "",
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
        demo: demoDictionaryEnabled(),
        timeoutMs: preferences.lookupTimeoutMs,
      });
  const anki = createAnkiClient(preferences);
  catalog.setWorker(worker);
  const runtime = {
    dictionary,
    catalog,
    settingsStore,
    worker,
    anki,
    preferences,
    lastControllerState: null,
  };
  runtime.dictionaryFingerprint = runtimeDictionaryFingerprint(runtime);
  return runtime;
}

async function createNativeGeometryRuntime(geometryProvider) {
  const explicitExecutable =
    argumentValue("--native-geometry-executable") ||
    String(process.env.IINATAN_NATIVE_GEOMETRY || "").trim();
  const nativeGeometryDisabled =
    process.env.IINATAN_DISABLE_NATIVE_GEOMETRY === "1" ||
    hasArgument("--disable-patched-native-geometry");
  const helperName =
    process.platform === "win32"
      ? "iinatan-native-geometry.exe"
      : "iinatan-native-geometry";
  const compatibilityHelperName =
    process.platform === "win32" ? "iinatan-native-geometry-libass-0.17.4.exe" : "";
  const developmentHelperName =
    process.platform === "darwin" ? "iina-hoshi-dicts" : helperName;
  const sourceRoot = path.join(__dirname, "..");
  const packagedHelper =
    process.platform === "darwin"
      ? path.join(resourceRoot(), "bin", "iina-hoshi-dicts")
      : path.join(resourceRoot(), "bin", helperName);
  const packagedCompatibilityHelper = compatibilityHelperName
    ? path.join(resourceRoot(), "bin", compatibilityHelperName)
    : "";
  const developmentHelpers = [
    path.join(sourceRoot, "build", "native", developmentHelperName),
    path.join(sourceRoot, "build", "native", "Release", developmentHelperName),
    path.join(
      sourceRoot,
      "build",
      `native-geometry-${process.platform === "win32" ? "windows" : "linux"}-x86_64`,
      developmentHelperName,
    ),
    path.join(
      sourceRoot,
      "build",
      `native-geometry-${process.platform === "win32" ? "windows" : "linux"}-x86_64`,
      "Release",
      developmentHelperName,
    ),
    path.join(
      sourceRoot,
      "build",
      "native-geometry-windows-cmake",
      "Release",
      developmentHelperName,
    ),
    path.join(
      sourceRoot,
      "build",
      "native-geometry-linux-cmake",
      "Release",
      developmentHelperName,
    ),
    path.join(sourceRoot, "build", "package-resources", developmentHelperName),
  ];
  const developmentCompatibilityHelpers = compatibilityHelperName
    ? [
        path.join(
          sourceRoot,
          "build",
          "native-geometry-windows-compat-cmake2",
          "Release",
          compatibilityHelperName,
        ),
        path.join(
          sourceRoot,
          "build",
          "native-geometry-windows-compat-cmake",
          "Release",
          compatibilityHelperName,
        ),
        path.join(sourceRoot, "build", "package-resources", compatibilityHelperName),
      ]
    : [];
  const candidates = explicitExecutable
    ? [path.resolve(explicitExecutable)]
    : nativeGeometryDisabled
      ? []
      : app.isPackaged
        ? [packagedHelper, packagedCompatibilityHelper].filter(Boolean)
        : hasArgument("--enable-patched-native-geometry")
          ? [
              packagedHelper,
              packagedCompatibilityHelper,
              ...developmentHelpers,
              ...developmentCompatibilityHelpers,
            ].filter(Boolean)
          : [];
  const uniqueCandidates = [...new Set(candidates)];
  if (!uniqueCandidates.length) return null;
  const root =
    argumentValue("--native-geometry-root") ||
    path.join(app.getPath("userData"), "native-geometry");
  const profiles = [];
  for (const executable of uniqueCandidates) {
    try {
      await fs.access(executable);
      const worker = new NativeGeometryWorker({ executable, root });
      const client = new NativeGeometryClient(worker);
      const version = await client.negotiate();
      const assGeometry = version.assGeometry || {};
      const expectedFontProvider =
        process.platform === "win32"
          ? "directwrite"
          : process.platform === "darwin"
            ? "coretext"
            : "fontconfig";
      const expectedArchitecture = process.platform === "darwin" ? "arm64" : "x86-64";
      const common =
        assGeometry.available === true &&
        assGeometry.protocol === 1 &&
        assGeometry.envelopeRects === true &&
        assGeometry.architecture === expectedArchitecture &&
        assGeometry.fontProvider === expectedFontProvider;
      if (!common) continue;
      if (
        assGeometry.libass === VALIDATED_PLAYER_CAPABILITY.libassVersion &&
        assGeometry.ffmpeg === VALIDATED_PLAYER_CAPABILITY.ffmpegVersion &&
        assGeometry.patch === "libass-0.17.5-iinatan-unit-ids-v2"
      ) {
        profiles.push({
          id: "mpv-0.41.0-libass-0.17.5",
          client,
          playerCompatibility: VALIDATED_PLAYER_CAPABILITY,
          inputScope: "all-supported",
        });
      } else if (
        process.platform === "win32" &&
        assGeometry.libass === "0.17.4" &&
        assGeometry.patch === "libass-0.17.4-iinatan-unit-ids-v2"
      ) {
        profiles.push({
          ...WINDOWS_LIBASS_0174_SUBRIP_PROFILE,
          client,
        });
        profiles.push({
          ...WINDOWS_LIBASS_0174_EMBEDDED_ASS_PROFILE,
          client,
        });
      }
    } catch (error) {
      console.warn(
        "[iinatan] native subtitle geometry helper unavailable",
        String(error?.message || error),
      );
    }
  }
  if (!profiles.length) return null;
  return new NativeSubtitleGeometryService({ profiles, geometryProvider });
}

async function createBitmapOcrRuntime(preferences) {
  if (process.platform !== "darwin") return null;
  const executable =
    argumentValue("--bitmap-ocr-executable") ||
    argumentValue("--hoshi-executable") ||
    path.join(resourceRoot(), "bin", "iina-hoshi-dicts");
  try {
    await fs.access(executable);
    const worker = new NativeBitmapOcrWorker({
      executable,
      root: path.join(app.getPath("userData"), "bitmap-ocr"),
      timeoutMs: preferences?.backendTimeoutMs,
    });
    return new NativeBitmapOcrClient(worker);
  } catch (error) {
    console.warn("[iinatan] bitmap subtitle OCR unavailable", error.message);
    return null;
  }
}

async function main() {
  app.setName("iinatan for mpv");
  if (process.env.IINATAN_E2E_DISABLE_GPU === "1") app.disableHardwareAcceleration();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  if (process.platform === "darwin" && app.dock) app.dock.hide();
  await app.whenReady();
  await registerAppProtocol();

  const runtime = await createDictionaryRuntime();
  const geometryProvider = new SubtitleGeometryProvider();
  const nativeGeometry = await createNativeGeometryRuntime(geometryProvider);
  const bitmapOcr = await createBitmapOcrRuntime(runtime.preferences);
  runtime.nativeGeometry = nativeGeometry;
  runtime.bitmapOcr = bitmapOcr;
  const sentenceAudio = await createSentenceAudioRuntime();
  const controllerOverrides = {
    lookupLanguage: argumentValue("--lookup-language"),
  };
  runtime.controllerOverrides = controllerOverrides;
  const runtimeDir =
    argumentValue("--runtime-dir") ||
    process.env.IINATAN_SESSION_DIR ||
    defaultSessionDirectory();
  const controllers = new Map();
  const syncControllerSource = () => {
    const source = runtime.worker?.nativeControllerAvailable
      ? "native-hid+browser-gamepad"
      : "browser-gamepad";
    for (const controller of controllers.values())
      controller.browserHost?.setControllerSource?.(source);
  };
  runtime.worker?.on("controller-capability", syncControllerSource);
  runtime.worker?.on("controller-state", (state) => {
    runtime.lastControllerState = state;
    for (const controller of controllers.values())
      controller
        .handleControllerState(state)
        .catch((error) => controller.emit("error", error));
  });
  const e2eStatusPath = argumentValue("--e2e-status-file");
  let e2eStatusSerial = Promise.resolve();
  let e2eStatusTimer = null;
  let settingsControlRegions = null;
  let settingsDialog = null;

  function windowStatus(window, visibleOverride) {
    if (!window || window.isDestroyed()) return null;
    const nativeVisible = typeof window.isVisible === "function" && window.isVisible();
    return {
      visible: visibleOverride === undefined ? nativeVisible : visibleOverride,
      nativeVisible,
      focused: typeof window.isFocused === "function" && window.isFocused(),
      alwaysOnTop: typeof window.isAlwaysOnTop === "function" && window.isAlwaysOnTop(),
      bounds: typeof window.getBounds === "function" ? window.getBounds() : null,
      contentBounds:
        typeof window.getContentBounds === "function"
          ? window.getContentBounds()
          : null,
    };
  }

  function e2eStatus() {
    const catalogEntries = runtime.catalog.list({ includeDisabled: true });
    const applicationMenu = Menu.getApplicationMenu();
    const applicationMenuItem = applicationMenu?.items?.find(
      (item) => item.label === "iinatan",
    );
    const openMediaMenuItem = applicationMenuItem?.submenu?.items?.find(
      (item) => item.label === "Open media in mpv…",
    );
    const settingsMenuItem = applicationMenuItem?.submenu?.items?.find(
      (item) => item.label === "Settings…",
    );
    return {
      protocol: 1,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      applicationMenu: {
        openMedia: openMediaMenuItem
          ? {
              label: openMediaMenuItem.label,
              accelerator: openMediaMenuItem.accelerator || null,
              enabled: openMediaMenuItem.enabled !== false,
              visible: openMediaMenuItem.visible !== false,
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
      settingsControlRegions,
      settingsDialog,
      settings: {
        activeProfileId: runtime.settingsStore.current().activeProfileId,
        profiles: Object.values(runtime.settingsStore.current().profiles).map(
          (profile) => ({ id: profile.id, name: profile.name }),
        ),
      },
      dictionary: {
        backend: runtime.worker
          ? "hoshidicts"
          : demoDictionaryEnabled()
            ? "demo"
            : "unavailable",
        fingerprint: runtime.dictionaryFingerprint || null,
        installed: catalogEntries.length,
        enabled: catalogEntries.filter((entry) => entry.enabled !== false).length,
        ids: catalogEntries.map((entry) => entry.id),
      },
      controller: {
        requested: runtime.worker?.controllerRequested === true,
        source: runtime.worker?.nativeControllerAvailable
          ? "native-hid"
          : "browser-gamepad",
        capability: runtime.worker?.controllerCapability || null,
        state: runtime.lastControllerState
          ? {
              protocol: runtime.lastControllerState.protocol,
              sequence: runtime.lastControllerState.sequence,
              updatedAt: runtime.lastControllerState.updatedAt,
              source: runtime.lastControllerState.source,
              connected: runtime.lastControllerState.connected === true,
              id: runtime.lastControllerState.id || "",
              buttons: runtime.lastControllerState.buttons || {},
              axes: runtime.lastControllerState.axes || {},
            }
          : null,
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
        popupStyle: controller.popupStyle || null,
        popupScroll: controller.popupScroll || null,
        popupSelectionText: controller.popupSelectionText || "",
        popupFocusTarget: controller.popupFocusTarget || "",
        popupFocusRevision: controller.popupFocusRevision || 0,
        nestedPopupResult: controller.nestedPopupResult || null,
        controllerEntryIndex: Number.isInteger(controller.controllerEntryIndex)
          ? controller.controllerEntryIndex
          : -1,
        controllerTarget: controller.controllerTarget
          ? {
              key: controller.controllerTarget.key,
              hit: controller.controllerTarget.hit
                ? {
                    trackId: controller.controllerTarget.hit.track?.id || null,
                    eventId: controller.controllerTarget.hit.event?.id || null,
                    unitId: controller.controllerTarget.hit.unit?.id || null,
                    text: controller.controllerTarget.hit.unit?.text || "",
                  }
                : null,
            }
          : null,
        controllerHold: controller.controllerHold
          ? {
              action: controller.controllerHold.action,
              completed: controller.controllerHold.completed === true,
            }
          : null,
        popupHit: controller.popupContext?.hit
          ? {
              trackId: controller.popupContext.hit.track.id,
              eventId: controller.popupContext.hit.event.id,
              unitId: controller.popupContext.hit.unit.id,
              text: controller.popupContext.hit.unit.text,
            }
          : null,
        popupHeadword: controller.popupContext?.result?.entries?.[0]?.headword || null,
        audioResult: controller.lastAudioResult || null,
        audioSelection: controller.popupContext?.audioSelection
          ? {
              url: controller.popupContext.audioSelection.url || "",
              name: controller.popupContext.audioSelection.name || "",
            }
          : null,
        ankiResult: controller.lastAnkiResult || null,
        lastPopupCloseReason: controller.lastPopupCloseReason || null,
        surfaceReadiness: controller.browserHost?.surfaceReadiness?.() || null,
        windowTransitions: controller.browserHost?.windowTransitionState?.() || null,
        popupPlacement: controller.popupPlacement || null,
        focusPlayer: controller.focusPlayerResult || null,
        highlightWindow: windowStatus(controller.browserHost?.highlightWindow),
        popupWindow: windowStatus(
          controller.browserHost?.popupWindow,
          controller.browserHost?.popupVisible === true,
        ),
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
        if (process.platform !== "win32") {
          await fs.rename(temporary, e2eStatusPath);
          return;
        }
        let lastError = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            // Windows does not replace an existing destination with rename.
            // The status writer is serialized, so removing this process's
            // previous snapshot is safe; readers already tolerate a brief
            // missing file while the replacement is written.
            await fs.rm(e2eStatusPath, { force: true });
            await fs.rename(temporary, e2eStatusPath);
            return;
          } catch (error) {
            lastError = error;
            if (!["EPERM", "EEXIST", "EBUSY", "ENOTEMPTY"].includes(error?.code))
              throw error;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        throw lastError || new Error("could not replace E2E status file");
      })
      .finally(() =>
        fs.rm(`${e2eStatusPath}.${process.pid}.next`, { force: true }).catch(() => {}),
      );
    return e2eStatusSerial;
  }

  function createController() {
    const windowProbeName =
      process.platform === "win32"
        ? "iinatan-window-probe.exe"
        : "iinatan-window-probe";
    const windowTransitionProbe =
      String(process.env.IINATAN_WINDOW_PROBE || "").trim() ||
      [
        path.join(resourceRoot(), "bin", windowProbeName),
        path.join(resourceRoot(), "build", "native", windowProbeName),
        path.join(resourceRoot(), "build", "native", "Release", windowProbeName),
      ].find((candidate) => fsSync.existsSync(candidate));
    const browserHost = new BrowserHost({
      BrowserWindow,
      globalShortcut,
      ipcMain,
      windowTransitionProbe,
      preloadPath: path.join(__dirname, "preload.js"),
      overlayUrl: "iinatan://app/overlay.html",
      controllerSource: runtime.worker?.nativeControllerAvailable
        ? "native-hid"
        : "browser-gamepad",
    });
    const nativeWindow = new NativeWindowAdapter({
      probeExecutable:
        String(process.env.IINATAN_WINDOW_PROBE || "").trim() || undefined,
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
      bitmapOcr: runtime.bitmapOcr,
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
    controller.on("popup-style", () => publishE2EStatus("popup-style"));
    controller.on("popup-scroll", () => publishE2EStatus("popup-scroll"));
    controller.on("popup-selection", () => publishE2EStatus("popup-selection"));
    controller.on("popup-focus", () => publishE2EStatus("popup-focus"));
    controller.on("nested-result", () => publishE2EStatus("nested-result"));
    controller.on("nested-closed", () => publishE2EStatus("nested-closed"));
    controller.on("audio-result", () => publishE2EStatus("audio-result"));
    controller.on("anki-result", () => publishE2EStatus("anki-result"));
    controller.on("cursor-diagnostic", () => publishE2EStatus("cursor-diagnostic"));
    browserHost.on("popup-closed", () => publishE2EStatus("popup-closed"));
    browserHost.on("stacking-error", (error) =>
      console.warn("[iinatan] companion-window stacking failed", error.message),
    );
    browserHost.on("window-transition-error", (error) => {
      console.warn(
        "[iinatan] companion-window transition suppression failed",
        error.message,
      );
      publishE2EStatus("window-transition-error");
    });
    browserHost.on("window-focus-error", (error) => {
      console.warn(
        "[iinatan] companion-window foreground activation failed",
        error.message,
      );
      publishE2EStatus("window-focus-error");
    });
    controller.on("focus-player", () => {
      if (process.platform === "darwin" && typeof app.hide === "function") app.hide();
      nativeWindow
        .focus(controller.descriptor)
        .then((result) => {
          controller.focusPlayerResult = result;
          if (process.env.IINATAN_E2E_DEBUG === "1")
            console.error(`[iinatan] focus-player result: ${JSON.stringify(result)}`);
          publishE2EStatus("focus-player");
        })
        .catch((error) => {
          controller.focusPlayerResult = {
            ok: false,
            reason: String(error?.message || error),
          };
          console.warn("[iinatan] player activation failed", error);
          publishE2EStatus("focus-player-error");
        });
    });
    return controller;
  }

  let settingsWindow = null;
  let tray = null;
  const launchedMpv = new Set();

  async function refreshSettingsControlRegions() {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      settingsControlRegions = null;
      return;
    }
    try {
      const regions = await settingsWindow.webContents.executeJavaScript(
        `(() => {
          const names = {
            activeProfile: "#active-profile",
            profileName: "#profile-name",
            newProfileId: "#new-profile-id",
            newProfileName: "#new-profile-name",
            createProfile: "#create-profile",
            deleteProfile: "#delete-profile",
            save: "#save",
            exportBackup: "#export-backup",
            restoreBackup: "#restore-backup",
          };
          const result = {};
          for (const [name, selector] of Object.entries(names)) {
            const element = document.querySelector(selector);
            if (!element) continue;
            const rect = element.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0)) continue;
            result[name] = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          }
          result.recommended = [...document.querySelectorAll(
            "#recommended-list .recommended-row",
          )]
            .map((row) => {
              const button = row.querySelector("button");
              if (!button) return null;
              const rect = button.getBoundingClientRect();
              if (!(rect.width > 0 && rect.height > 0)) return null;
              return {
                id: row.dataset.dictionaryId || button.dataset.dictionaryId || "",
                title: row.querySelector("strong")?.textContent || "",
                text: button.textContent || "",
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              };
            })
            .filter(Boolean);
          return Object.keys(result).length ? result : null;
        })()`,
        true,
      );
      if (regions && typeof regions === "object") settingsControlRegions = regions;
    } catch (_) {
      // The settings document may be between navigation and teardown.
    }
  }

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
      if (process.platform === "darwin") app.focus?.({ steal: true });
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
      settingsControlRegions = null;
      if (process.env.IINATAN_E2E_AUTOSTART_HIDE_AFTER_SETTINGS === "1") app.hide?.();
    });
    try {
      await settingsWindow.loadURL("iinatan://app/settings.html");
      settingsWindow.show();
      settingsWindow.focus();
      if (process.platform === "darwin") app.focus?.({ steal: true });
      await refreshSettingsControlRegions();
    } catch (error) {
      settingsWindow.close();
      throw error;
    }
  }

  app.on("second-instance", (_event, commandLine) => {
    if (!commandLine.includes("--settings")) return;
    openSettings().catch((error) => console.error("[iinatan] settings", error));
  });

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
        settingsWindow.show();
        settingsWindow.focus();
        if (process.platform === "darwin") app.focus?.({ steal: true });
        settingsDialog = "export-backup";
        await publishE2EStatus("settings-dialog-export-open");
        try {
          const configuredPath = String(
            process.env.IINATAN_NATIVE_SETTINGS_BACKUP_PATH || "",
          ).trim();
          const selection = await dialog.showSaveDialog(settingsWindow, {
            defaultPath: path.isAbsolute(configuredPath)
              ? configuredPath
              : "iinatan-settings.json",
            filters: [{ name: "JSON settings backup", extensions: ["json"] }],
          });
          if (selection.canceled || !selection.filePath)
            return { state: settingsState(runtime, controllers), cancelled: true };
          await runtime.settingsStore.exportBackup(selection.filePath);
          return {
            state: settingsState(runtime, controllers),
            path: selection.filePath,
          };
        } finally {
          settingsDialog = null;
          await publishE2EStatus("settings-dialog-export-closed");
        }
      }
      case "restore-backup": {
        settingsWindow.show();
        settingsWindow.focus();
        if (process.platform === "darwin") app.focus?.({ steal: true });
        settingsDialog = "restore-backup";
        await publishE2EStatus("settings-dialog-restore-open");
        try {
          const configuredPath = String(
            process.env.IINATAN_NATIVE_SETTINGS_BACKUP_PATH || "",
          ).trim();
          const selection = await dialog.showOpenDialog(settingsWindow, {
            defaultPath: path.isAbsolute(configuredPath) ? configuredPath : undefined,
            properties: ["openFile"],
            filters: [{ name: "JSON settings backup", extensions: ["json"] }],
          });
          if (selection.canceled || !selection.filePaths[0])
            return { state: settingsState(runtime, controllers), cancelled: true };
          await runtime.settingsStore.restoreBackup(selection.filePaths[0]);
          await applyRuntimePreferences(runtime, controllers);
          return { state: settingsState(runtime, controllers) };
        } finally {
          settingsDialog = null;
          await publishE2EStatus("settings-dialog-restore-closed");
        }
      }
      default:
        throw new Error(`unknown settings request: ${raw.type}`);
    }
  });

  const openMediaItem = {
    label: "Open media in mpv…",
    accelerator: "CmdOrCtrl+O",
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
  if (process.platform === "darwin") {
    tray = new Tray(createTrayIcon());
    tray.setToolTip("iinatan for mpv");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Settings…",
          click: () =>
            openSettings().catch((error) => console.error("[iinatan] settings", error)),
        },
        {
          label: "Open media in mpv…",
          click: () =>
            openMediaInMpv().catch((error) =>
              dialog.showErrorBox("Could not start mpv", error.message),
            ),
        },
        { type: "separator" },
        { label: "Quit iinatan", click: () => app.quit() },
      ]),
    );
  }
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
  if (e2eStatusPath)
    e2eStatusTimer = setInterval(() => {
      refreshSettingsControlRegions()
        .catch(() => {})
        .finally(() => publishE2EStatus("poll"));
    }, 100);

  app.on("before-quit", () => {
    clearInterval(discoveryTimer);
    clearInterval(e2eStatusTimer);
    for (const controller of controllers.values())
      controller.detach("shutdown").catch(() => {});
    runtime.worker?.stop().catch(() => {});
    tray?.destroy();
    tray = null;
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
