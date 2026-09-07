"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { CoordinateMapper } = require("../geometry/coordinate-mapper");
const {
  createGeometrySnapshot,
  highlightForHit,
  hitTest,
  isSnapshotCurrent,
} = require("../geometry/snapshot");
const { placePopup } = require("../geometry/popup-placement");
const { SubtitleGeometryProvider } = require("../geometry/subtitle-geometry-provider");
const { DictionaryService } = require("../services/dictionary-service");
const { AudioSourceService } = require("../services/audio-service");
const { buildAnkiNote, normalizeTemplates } = require("../services/anki-card");
const {
  MEDIA_LIMIT_BYTES,
  mediaFilename,
  mediaRequirements,
  storeRemoteMedia,
} = require("../services/anki-media");
const {
  normalizeDictionaryResult,
  externalUrl,
} = require("../services/content-security");
const {
  InteractionController,
  EVENTS,
  STATES,
} = require("../interaction/interaction-controller");
const { PauseOwnership } = require("../interaction/pause-ownership");
const { ControllerRouter } = require("../interaction/controller-runtime");
const { PlayerBridge } = require("./player-bridge");
const { requestFor } = require("../services/language-registry");

function requestId() {
  return `lookup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function lookupTimeoutError(message = "Lookup request timed out") {
  const error = new Error(message);
  error.name = "TimeoutError";
  error.code = "LOOKUP_REQUEST_TIMEOUT";
  return error;
}

function withLookupTimeout(promise, controller, timeoutMs, message) {
  const duration = Number(timeoutMs);
  if (!Number.isFinite(duration) || duration <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        reject(lookupTimeoutError(message));
        controller.abort();
      },
      Math.max(250, duration),
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function flattenSubtitleText(text) {
  return flattenedSubtitle(text).text;
}

function subtitleLookupText(text, utf16Start, flattenLineBreaks) {
  const raw = String(text || "");
  if (!flattenLineBreaks) return { text: raw, utf16Start };
  const flattened = flattenedSubtitle(raw);
  return {
    text: flattened.text,
    utf16Start:
      flattened.map[Math.max(0, Math.min(raw.length, Number(utf16Start) || 0))],
  };
}

function flattenedSubtitle(text) {
  const raw = String(text || "");
  const map = new Array(raw.length + 1).fill(0);
  let intermediate = "";
  let outputLength = 0;
  let index = 0;
  const appendCollapsed = (start, end) => {
    map[start] = outputLength;
    for (let position = start + 1; position < end; position++)
      map[position] = outputLength;
    intermediate += " ";
    outputLength++;
    map[end] = outputLength;
  };
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\r") {
      map[index] = outputLength;
      index++;
      map[index] = outputLength;
      continue;
    }
    if (character === "\n") {
      const start = index;
      while (index < raw.length && raw[index] === "\n") index++;
      appendCollapsed(start, index);
      continue;
    }
    if (/[ \t\f\v]/.test(character)) {
      const start = index;
      while (index < raw.length && /[ \t\f\v]/.test(raw[index])) index++;
      if (index - start > 1) {
        appendCollapsed(start, index);
        continue;
      }
      index = start;
    }
    map[index] = outputLength;
    intermediate += raw[index];
    outputLength++;
    index++;
    map[index] = outputLength;
  }
  const leading = intermediate.length - intermediate.trimStart().length;
  const textValue = intermediate.trim();
  const normalizedLength = textValue.length;
  return {
    text: textValue,
    map: map.map((value) => Math.max(0, Math.min(normalizedLength, value - leading))),
  };
}

function unionRects(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((value) => value.x));
  const y = Math.min(...rects.map((value) => value.y));
  const right = Math.max(...rects.map((value) => value.x + value.width));
  const bottom = Math.max(...rects.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

class ApplicationController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.browserHost = options.browserHost;
    this.windowAdapter = options.windowAdapter;
    this.screen = options.screen || null;
    this.shell = options.shell || null;
    this.dictionary =
      options.dictionary || new DictionaryService({ demo: !!options.demo });
    this.audio = options.audio || new AudioSourceService({ fetch: options.fetch });
    this.sentenceAudio = options.sentenceAudio || null;
    this.anki = options.anki || null;
    this.ankiConfig = {
      enabled: !!options.anki,
      configured: false,
      duplicateCheck: true,
      duplicateMode: "prevent",
      duplicateScope: "deck",
      ...(options.ankiConfig || {}),
    };
    this.geometryProvider = options.geometryProvider || new SubtitleGeometryProvider();
    this.nativeGeometry = options.nativeGeometry || null;
    this.interaction = options.interaction || new InteractionController();
    this.pauseOwnership = new PauseOwnership();
    this.controllerRouter =
      options.controllerRouter ||
      new ControllerRouter({ bindings: options.controllerBindings });
    this.descriptor = null;
    this.bridge = null;
    this.snapshot = null;
    this.lastHit = null;
    this.cursorTimer = null;
    this.geometryTimer = null;
    this.geometryRefreshSerial = 0;
    this.geometryRefreshPromise = null;
    this.detachPromise = null;
    this.lookupAbort = null;
    this.audioAbort = null;
    this.surfaceRecoveryPromise = null;
    this.ankiPending = new Set();
    this.lookupSerial = 0;
    this.popupPlacement = null;
    this.popupMeasuredSize = null;
    this.popupRegions = Object.freeze({});
    this.popupScroll = Object.freeze({ left: 0, top: 0 });
    this.popupContext = null;
    this.popupSelectionText = "";
    this.lastPopupCloseReason = null;
    this.windowUnavailable = false;
    this.nativeGeometryErrorKey = null;
    this.nativeGeometryError = null;
    this.modifierPressed = false;
    this.cursorPoint = null;
    this.cursorDiagnostic = null;
    this.config = {
      allowApproximateGeometry: !!options.allowApproximateGeometry,
      subtitleLookupMode: "hover",
      pauseWhilePopupVisible: true,
      popupGap: 18,
      popupMinWidth: 250,
      popupMaxWidth: 440,
      popupMaxHeight: 540,
      popupTheme: "inherit",
      customCss: "",
      audioSources: [],
      audioAutoPlay: false,
      flattenSubtitleLineBreaks: false,
      nestedPopupMode: "off",
      nestedPopupMaxDepth: 3,
      etymologyCollapseDefault: "collapsed",
      wiktionaryEtymologyCollapseOverride: "collapsed",
      lookupTimeoutMs: 9000,
      hoverRequestTimeoutMs: 15000,
      backendTimeoutMs: 30000,
      subtitlePollMs: 120,
      preferredSide: "below",
      lookupLanguage: "ja",
      scanLength: 24,
      ...(options.config || {}),
    };
    this.controllerRouter.setBindings(this.config.controllerBindings || {});
    this.#bindHost();
  }

  #bindHost() {
    if (!this.browserHost) return;
    this.browserHost.on("request", (event) =>
      this.#onHostRequest(event).catch((error) => this.emit("error", error)),
    );
    this.browserHost.on("focus-player", () => this.emit("focus-player"));
    this.browserHost.on("popup-closed", () =>
      this.closePopup("popup-window-closed", { focusPlayer: false }).catch((error) =>
        this.emit("error", error),
      ),
    );
    this.browserHost.on("surface-closed", (surface) => {
      this.#recoverBrowserSurface(surface).catch((error) => this.emit("error", error));
    });
  }

  async #recoverBrowserSurface(surface) {
    if (!this.descriptor || !this.bridge || !this.browserHost) return;
    if (this.surfaceRecoveryPromise) return this.surfaceRecoveryPromise;
    const promise = (async () => {
      await this.browserHost.create();
      if (!this.descriptor || !this.bridge || !this.snapshot) return;
      this.browserHost.setSessionContext(
        this.descriptor.sessionId,
        this.snapshot.geometryGeneration,
      );
      this.browserHost.setContentBounds(this.snapshot.content);
      this.browserHost.setPassiveInput();
      this.browserHost.send("highlight", "session-state", {
        connected: true,
        identity: this.bridge.identity(),
        resumed: true,
        recoveredSurface: surface,
      });
      this.browserHost.send("highlight", "geometry", {
        rects: [],
        exact: this.snapshot.source?.exact !== false,
        source: this.snapshot.source,
      });
      this.emit("surface-ready", surface);
    })();
    this.surfaceRecoveryPromise = promise;
    try {
      await promise;
    } finally {
      if (this.surfaceRecoveryPromise === promise) this.surfaceRecoveryPromise = null;
    }
  }

  async attach(descriptor, options = {}) {
    await this.detach("replace-session");
    this.descriptor = descriptor;
    this.config = { ...this.config, ...(options.config || {}) };
    const bridgeOptions = { ...(options.bridgeOptions || {}) };
    if (
      bridgeOptions.timeoutMs === undefined &&
      this.config.backendTimeoutMs !== undefined
    )
      bridgeOptions.timeoutMs = this.config.backendTimeoutMs;
    this.bridge = new PlayerBridge(descriptor, bridgeOptions);
    this.#bindBridge();
    await this.browserHost.create();
    await this.bridge.connect();
    await this.#refreshGeometry();
    this.#startLoops();
    return this.bridge.identity();
  }

  async attachDemo() {
    const descriptor = {
      sessionId: "demo-session",
      pid: process.pid,
      windowId: "demo-window",
      ipcEndpoint: "demo://session",
    };
    const demoBridge = {
      descriptor,
      mediaGeneration: 0,
      geometryGeneration: 0,
      connected: true,
      properties: new Map([
        ["time-pos", 0],
        ["pause", false],
        ["path", "demo://deterministic-test-video"],
        ["osd-dimensions", { w: 1280, h: 720, par: 1 }],
        [
          "sub-text/ass-full",
          "Dialogue: 0,0:00:00.00,0:00:30.00,Default,,0,0,0,,日本語 dictionary",
        ],
        [
          "secondary-sub-text/ass-full",
          "Dialogue: 0,0:00:00.00,0:00:30.00,Default,,0,0,0,,English subtitle",
        ],
      ]),
      property(name, fallback = null) {
        return this.properties.has(name) ? this.properties.get(name) : fallback;
      },
      geometryInput() {
        const dimensions = this.property("osd-dimensions");
        return {
          sessionId: descriptor.sessionId,
          mediaGeneration: 0,
          geometryGeneration: this.geometryGeneration,
          timeMs: 0,
          osd: { width: dimensions.w, height: dimensions.h },
          primary: { assFull: this.property("sub-text/ass-full") },
          secondary: { assFull: this.property("secondary-sub-text/ass-full") },
        };
      },
      identity() {
        return {
          ...descriptor,
          mediaGeneration: 0,
          geometryGeneration: this.geometryGeneration,
        };
      },
      async setPause(value) {
        this.properties.set("pause", !!value);
      },
      async command() {},
      close() {},
      on() {},
    };
    await this.detach("replace-demo");
    this.descriptor = descriptor;
    this.bridge = demoBridge;
    this.windowAdapter = {
      read: async () => ({
        ok: true,
        backend: "demo",
        content: { x: 120, y: 80, width: 1280, height: 720 },
        desktopScale: 1,
        browserScale: 1,
        contentExact: true,
        contentSource: "demo-content",
      }),
    };
    this.config.allowApproximateGeometry = true;
    await this.browserHost.create();
    await this.#refreshGeometry();
    this.#startLoops();
    return descriptor;
  }

  async updateConfiguration(config = {}, ankiConfig = null) {
    this.config = { ...this.config, ...config };
    if (config.backendTimeoutMs !== undefined && this.bridge?.ipc)
      this.bridge.ipc.timeoutMs = Math.max(
        100,
        Number(config.backendTimeoutMs) || 3000,
      );
    if (ankiConfig) this.ankiConfig = { ...this.ankiConfig, ...ankiConfig };
    if (config.controllerBindings)
      this.controllerRouter.setBindings(config.controllerBindings);
    if (config.controllerEnabled === false) this.controllerRouter.reset();
    this.lookupSerial++;
    this.lookupAbort?.abort();
    if (this.browserHost?.popupVisible)
      await this.closePopup("settings-changed", { focusPlayer: false, closeAll: true });
    if (this.snapshot) await this.#refreshGeometry();
    if (this.bridge) this.#startLoops();
  }

  async handleControllerState(payload) {
    if (this.config.controllerEnabled !== true) return;
    if (
      this.snapshot?.source?.foreground === false &&
      !this.browserHost?.hasSessionFocus?.()
    )
      return;
    const context = this.controllerRouter.contextFor(this.interaction.state);
    const actions = this.controllerRouter.actionsFor(payload, context);
    for (const action of actions)
      await this.#performControllerAction(action.action, action);
  }

  #bindBridge() {
    if (!this.bridge || typeof this.bridge.on !== "function") return;
    this.bridge.on("geometry-invalidated", () =>
      this.#refreshGeometry().catch((error) => this.emit("error", error)),
    );
    this.bridge.on("disconnected", () =>
      this.detach("player-disconnected").catch((error) => this.emit("error", error)),
    );
    this.bridge.on("property", (name, value, previous) => {
      if (name === "pause" && previous !== value && this.snapshot)
        this.pauseOwnership.observePauseChange({
          paused: !!value,
          source: "unknown",
          generation: this.snapshot.geometryGeneration,
        });
    });
  }

  #startLoops() {
    clearInterval(this.cursorTimer);
    clearInterval(this.geometryTimer);
    this.cursorTimer = setInterval(
      () => this.#pollCursor().catch((error) => this.emit("error", error)),
      16,
    );
    this.geometryTimer = setInterval(
      () => this.#refreshGeometry().catch((error) => this.emit("error", error)),
      Math.max(30, Number(this.config.subtitlePollMs) || 120),
    );
  }

  async #refreshGeometry() {
    if (this.geometryRefreshPromise) return this.geometryRefreshPromise;
    const promise = this.#refreshGeometryOnce();
    this.geometryRefreshPromise = promise;
    try {
      await promise;
    } finally {
      if (this.geometryRefreshPromise === promise) this.geometryRefreshPromise = null;
    }
  }

  async #refreshGeometryOnce() {
    if (!this.bridge || !this.descriptor) return;
    const refreshSerial = ++this.geometryRefreshSerial;
    const bridge = this.bridge;
    let windowGeometry;
    try {
      windowGeometry = await this.windowAdapter.read(this.descriptor);
    } catch (error) {
      if (!this.snapshot) throw error;
      await this.#suspendForUnavailableWindow(error);
      return;
    }
    if (
      refreshSerial !== this.geometryRefreshSerial ||
      bridge !== this.bridge ||
      !this.descriptor
    )
      return;
    const wasUnavailable = this.windowUnavailable;
    this.windowUnavailable = false;
    if (
      windowGeometry.isForeground === false &&
      this.browserHost?.hasSessionFocus?.()
    ) {
      windowGeometry = { ...windowGeometry, isForeground: true };
    }
    if (
      windowGeometry.isForeground === false &&
      this.browserHost?.popupVisible &&
      !this.browserHost?.hasSessionFocus?.()
    ) {
      await this.closePopup("player-backgrounded", { focusPlayer: false }).catch(
        () => {},
      );
    }
    this.browserHost.setPlayerForeground?.(windowGeometry.isForeground !== false);
    const display =
      this.screen && this.screen.getDisplayNearestPoint
        ? this.screen.getDisplayNearestPoint(windowGeometry.content)
        : null;
    const desktopScale = Number(
      windowGeometry.desktopScale || display?.scaleFactor || 1,
    );
    const browserScale = Number(windowGeometry.browserScale || 1);
    const bridgeInput = bridge.geometryInput();
    const input = this.geometryProvider.snapshotInput(
      bridgeInput,
      { ...windowGeometry, desktopScale, browserScale },
      { layout: this.config.subtitleLayout },
    );
    let snapshotInput = input;
    if (this.nativeGeometry) {
      try {
        const exact = await this.nativeGeometry.apply(input);
        if (exact) {
          snapshotInput = exact;
          this.nativeGeometryErrorKey = null;
          this.nativeGeometryError = null;
        } else {
          this.nativeGeometryErrorKey = null;
          this.nativeGeometryError = null;
        }
      } catch (error) {
        const key = `${bridgeInput.geometryGeneration}:${error.code || "error"}:${error.message}`;
        this.nativeGeometryError = {
          code: String(error.code || "NATIVE_GEOMETRY_UNAVAILABLE"),
          message: String(error.message || "native subtitle geometry unavailable"),
          geometryGeneration: bridgeInput.geometryGeneration,
        };
        if (this.nativeGeometryErrorKey !== key) {
          this.nativeGeometryErrorKey = key;
          this.emit("native-geometry-unavailable", error);
        }
      }
    }
    if (
      refreshSerial !== this.geometryRefreshSerial ||
      bridge !== this.bridge ||
      !this.descriptor
    )
      return;
    const next = createGeometrySnapshot(snapshotInput);
    const previousSnapshot = this.snapshot;
    const stableSource = (source) => {
      if (!source) return source;
      const copy = { ...source };
      delete copy.foreground;
      // Diagnostics contain timing, cache, and packet counters. They are
      // useful status telemetry but must not invalidate an active popup when
      // a later geometry refresh reports different measurements.
      delete copy.diagnostics;
      return copy;
    };
    const changed =
      !previousSnapshot ||
      next.geometryGeneration !== previousSnapshot.geometryGeneration ||
      JSON.stringify(next.content) !== JSON.stringify(previousSnapshot.content) ||
      JSON.stringify(stableSource(next.source)) !==
        JSON.stringify(stableSource(previousSnapshot.source)) ||
      JSON.stringify(next.tracks) !== JSON.stringify(previousSnapshot.tracks);
    this.snapshot = next;
    this.browserHost.setSessionContext(
      this.descriptor.sessionId,
      next.geometryGeneration,
    );
    this.browserHost.setContentBounds(next.content);
    if (this.interaction.sessionId !== this.descriptor.sessionId) {
      this.interaction.dispatch(EVENTS.SESSION_READY, {
        sessionId: this.descriptor.sessionId,
        geometryGeneration: next.geometryGeneration,
      });
      this.browserHost.send("highlight", "session-state", {
        connected: true,
        identity: this.bridge.identity(),
        resumed: wasUnavailable,
      });
    }
    if (changed) {
      const previousGeneration = previousSnapshot?.geometryGeneration;
      if (this.interaction.state === STATES.LOOKUP_PENDING) {
        this.lookupSerial++;
        this.lookupAbort?.abort();
        await this.#releasePause("geometry-invalidated", previousGeneration);
      } else if (
        [STATES.POPUP_ACTIVE, STATES.NESTED_POPUP_ACTIVE, STATES.AUDIO_MENU].includes(
          this.interaction.state,
        )
      ) {
        await this.closePopup("geometry-invalidated", {
          generation: previousGeneration,
          closeAll: true,
        });
      }
      this.interaction.dispatch(EVENTS.GEOMETRY_INVALIDATED, {
        geometryGeneration: next.geometryGeneration,
      });
      this.lastHit = null;
      this.browserHost.send("highlight", "geometry", {
        rects: [],
        exact: next.source?.exact !== false,
        source: next.source,
      });
    }
    this.emit("geometry", next);
  }

  async #suspendForUnavailableWindow(error) {
    if (this.windowUnavailable) return;
    this.windowUnavailable = true;
    this.lookupSerial++;
    this.lookupAbort?.abort();
    if (this.browserHost?.popupVisible) {
      await this.closePopup("player-window-unavailable", { focusPlayer: false }).catch(
        () => {},
      );
    }
    this.browserHost?.setPlayerForeground?.(false);
    this.browserHost?.hideHighlight();
    this.browserHost?.setPassiveInput();
    this.snapshot = null;
    this.lastHit = null;
    this.popupPlacement = null;
    if (this.interaction.sessionId) {
      this.interaction.dispatch(EVENTS.SESSION_LOST, {
        reason: "player-window-unavailable",
      });
    }
    this.emit("window-unavailable", error);
  }

  async #pollCursor() {
    if (
      !this.snapshot ||
      this.windowUnavailable ||
      !this.browserHost ||
      this.browserHost.popupVisible
    )
      return;
    if (this.snapshot.source?.foreground === false) {
      if (this.lastHit) {
        this.lastHit = null;
        this.browserHost.send("highlight", "geometry", { rects: [] });
        this.interaction.dispatch(EVENTS.POINTER_NONE);
      }
      return;
    }
    if (this.config.subtitleLookupMode === "shift-hover" && !this.modifierPressed) {
      if (this.lastHit) {
        this.lastHit = null;
        this.browserHost.send("highlight", "geometry", { rects: [] });
        this.interaction.dispatch(EVENTS.POINTER_NONE);
      }
      return;
    }
    const point =
      this.screen && this.screen.getCursorScreenPoint
        ? this.screen.getCursorScreenPoint()
        : null;
    if (!point) return;
    this.cursorPoint = { x: point.x, y: point.y };
    const hit = hitTest(this.snapshot, point);
    const diagnostic = {
      point: { ...this.cursorPoint },
      geometryGeneration: this.snapshot.geometryGeneration,
      content: this.snapshot.content,
      osd: this.snapshot.osd,
      desktopScale: this.snapshot.desktopScale,
      sourceExact: this.snapshot.source?.exact !== false,
      hit: hit
        ? {
            trackId: hit.track.id,
            eventId: hit.event.id,
            unitId: hit.unit.id,
            text: hit.unit.text,
          }
        : null,
    };
    const previous = this.cursorDiagnostic;
    this.cursorDiagnostic = diagnostic;
    if (
      !previous ||
      previous.geometryGeneration !== diagnostic.geometryGeneration ||
      previous.point.x !== diagnostic.point.x ||
      previous.point.y !== diagnostic.point.y ||
      previous.hit?.unitId !== diagnostic.hit?.unitId
    )
      this.emit("cursor-diagnostic", diagnostic);
    if (
      !hit ||
      (this.snapshot.source &&
        this.snapshot.source.exact === false &&
        !this.config.allowApproximateGeometry)
    ) {
      if (this.lastHit) {
        this.lastHit = null;
        this.browserHost.send("highlight", "geometry", { rects: [] });
        this.interaction.dispatch(EVENTS.POINTER_NONE);
      }
      return;
    }
    if (
      this.lastHit &&
      this.lastHit.unit.id === hit.unit.id &&
      this.lastHit.event.id === hit.event.id
    )
      return;
    this.lastHit = hit;
    const highlightRects = highlightForHit(this.snapshot, hit);
    const mapper = new CoordinateMapper(this.snapshot);
    this.browserHost.showHighlight({
      rects: highlightRects.map((value) => this.#desktopRectToBrowser(value, mapper)),
      exact: this.snapshot.source?.exact !== false,
    });
    this.interaction.dispatch(EVENTS.POINTER_TARGET, {
      hit: { trackId: hit.track.id, eventId: hit.event.id, unitId: hit.unit.id },
    });
    if (["hover", "shift-hover"].includes(this.config.subtitleLookupMode))
      await this.#beginLookup(hit);
  }

  #desktopRectToBrowser(value, mapper) {
    const origin = mapper.desktopToBrowserCss({ x: value.x, y: value.y });
    return {
      x: origin.x,
      y: origin.y,
      width: value.width * mapper.browserScale,
      height: value.height * mapper.browserScale,
    };
  }

  async #beginLookup(hit) {
    if (
      !this.bridge ||
      !this.snapshot ||
      !hit ||
      this.interaction.state === STATES.POPUP_ACTIVE ||
      this.interaction.state === STATES.LOOKUP_PENDING
    )
      return;
    const currentSnapshot = this.snapshot;
    const id = requestId();
    const serial = ++this.lookupSerial;
    if (this.lookupAbort) this.lookupAbort.abort();
    this.lookupAbort = new AbortController();
    this.interaction.dispatch(EVENTS.LOOKUP_REQUESTED, { requestId: id, hit });
    const pauseGeneration = currentSnapshot.geometryGeneration;
    try {
      if (this.config.pauseWhilePopupVisible) {
        const actions = this.pauseOwnership.open({
          wasPaused: !!this.bridge.property("pause"),
          generation: pauseGeneration,
        });
        if (actions.includes("pause")) {
          this.pauseOwnership.notePluginPause(true, pauseGeneration);
          await this.bridge.setPause(true);
        }
      }
      const rawSourceText =
        hit.unit.sourceText || hit.event.sourceText || hit.unit.text;
      const sourceText = subtitleLookupText(
        rawSourceText,
        hit.unit.utf16Range[0],
        this.config.flattenSubtitleLineBreaks === true,
      );
      const languageRequest = requestFor(
        this.config.lookupLanguage || "ja",
        sourceText.text,
        sourceText.utf16Start,
        this.config.scanLength || 24,
      );
      if (!languageRequest) {
        await this.#releasePause("unsupported-language");
        this.interaction.dispatch(EVENTS.LOOKUP_FAILED, {
          requestId: id,
          error: "No lookupable language span",
        });
        return;
      }
      const text = languageRequest.lookupText;
      const lookupController = this.lookupAbort;
      const lookupPromise = this.dictionary.lookup(
        {
          requestId: id,
          text,
          utf16Start: languageRequest.utf16Start,
          language: this.config.lookupLanguage || "ja",
          mode: languageRequest.mode,
          scanLength: this.config.scanLength || 24,
          candidates: languageRequest.candidates,
          sessionId: currentSnapshot.sessionId,
          geometryGeneration: currentSnapshot.geometryGeneration,
        },
        lookupController.signal,
      );
      const boundedLookup = withLookupTimeout(
        lookupPromise,
        lookupController,
        this.config.lookupTimeoutMs,
        "Dictionary lookup timed out",
      );
      const result = await withLookupTimeout(
        boundedLookup,
        lookupController,
        this.config.hoverRequestTimeoutMs,
        "Hover lookup timed out",
      );
      if (
        serial !== this.lookupSerial ||
        !this.snapshot ||
        !isSnapshotCurrent(this.snapshot, currentSnapshot)
      ) {
        await this.#releasePause("stale-result");
        return;
      }
      this.interaction.dispatch(EVENTS.LOOKUP_SUCCEEDED, { requestId: id, result });
      await this.#showPopup(
        hit,
        this.#normalizeDictionaryResult(result),
        currentSnapshot,
      );
    } catch (error) {
      if (error && error.name === "AbortError") {
        if (serial === this.lookupSerial) await this.#releasePause("cancelled");
        return;
      }
      if (serial !== this.lookupSerial) {
        await this.#releasePause("stale-error");
        return;
      }
      this.interaction.dispatch(EVENTS.LOOKUP_FAILED, {
        requestId: id,
        error: error.message,
      });
      this.browserHost.send(
        "popup",
        "popup-error",
        { message: error.message || "Lookup failed" },
        { requestId: id },
      );
      await this.#releasePause("lookup-failed", pauseGeneration);
    }
  }

  #normalizeDictionaryResult(result) {
    return normalizeDictionaryResult(result, {
      etymologyCollapseDefault: this.config.etymologyCollapseDefault,
      wiktionaryEtymologyCollapseOverride:
        this.config.wiktionaryEtymologyCollapseOverride,
    });
  }

  #placePopup(snapshot, anchor, popupSize = null) {
    const mapper = new CoordinateMapper(snapshot);
    const obstacles = [];
    snapshot.tracks.forEach((track) =>
      track.events.forEach((event) =>
        event.units.forEach((unit) =>
          unit.rects.forEach((unitRect) =>
            obstacles.push(mapper.osdRectToDesktop(unitRect)),
          ),
        ),
      ),
    );
    return placePopup({
      anchor,
      popupSize: popupSize || {
        width: this.config.popupMaxWidth * (Number(this.config.popupScale) || 1),
        height: this.config.popupMaxHeight * (Number(this.config.popupScale) || 1),
      },
      bounds: snapshot.content,
      obstacles,
      cursor: this.cursorPoint || anchor,
      gap: this.config.popupGap,
      previous: this.popupPlacement,
      previousSide: this.popupPlacement?.side,
      preferredSide: this.config.preferredSide,
      hysteresis: 28,
      corridorPadding: 8,
    });
  }

  async #showPopup(hit, result, snapshot) {
    const anchor = unionRects(highlightForHit(snapshot, hit));
    this.lastPopupCloseReason = null;
    this.popupMeasuredSize = null;
    const placement = this.#placePopup(snapshot, anchor);
    this.popupPlacement = placement;
    this.popupRegions = Object.freeze({});
    this.popupScroll = Object.freeze({ left: 0, top: 0 });
    this.popupContext = {
      result,
      hit,
      snapshot,
      anchor,
      stack: [],
      ankiNoteIds: Object.create(null),
    };
    this.popupSelectionText = "";
    this.browserHost.showPopup(this.#popupPayload(result, snapshot));
  }

  #popupLayoutPayload(snapshot) {
    const mapper = new CoordinateMapper(snapshot);
    const placement = this.popupPlacement;
    return {
      position: mapper.desktopToBrowserCss({ x: placement.x, y: placement.y }),
      width:
        (placement.width * mapper.browserScale) / (Number(this.config.popupScale) || 1),
      maxHeight:
        (placement.height * mapper.browserScale) /
        (Number(this.config.popupScale) || 1),
      side: placement.side,
    };
  }

  #handlePopupSize(surface, payload) {
    if (
      surface !== "popup" ||
      !this.popupContext ||
      !this.snapshot ||
      !this.browserHost?.popupVisible
    )
      return;
    const width = Number(payload.width);
    const height = Number(payload.height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return;
    const mapper = new CoordinateMapper(this.snapshot);
    const measured = {
      width: width / mapper.browserScale,
      height: height / mapper.browserScale,
      scrollable: payload.scrollable === true,
    };
    if (
      this.popupMeasuredSize &&
      Math.abs(this.popupMeasuredSize.width - measured.width) <= 0.5 &&
      Math.abs(this.popupMeasuredSize.height - measured.height) <= 0.5 &&
      this.popupMeasuredSize.scrollable === measured.scrollable
    )
      return;
    this.popupMeasuredSize = measured;
    const next = this.#placePopup(this.snapshot, this.popupContext.anchor, measured);
    const previous = this.popupPlacement;
    const changed =
      !previous ||
      previous.side !== next.side ||
      ["x", "y", "width", "height"].some(
        (key) => Math.abs(previous[key] - next[key]) > 0.5,
      );
    this.popupPlacement = next;
    if (changed)
      this.browserHost.send(
        "popup",
        "popup-layout",
        this.#popupLayoutPayload(this.snapshot),
      );
  }

  #popupPayload(result, snapshot) {
    const mapper = new CoordinateMapper(snapshot);
    const layout = this.#popupLayoutPayload(snapshot);
    const anchor =
      this.popupContext?.anchor || unionRects(highlightForHit(snapshot, this.lastHit));
    return {
      ...layout,
      result,
      theme: this.config.popupTheme,
      customCss: this.config.customCss,
      audioSources: this.config.audioSources,
      audioAutoPlay: this.config.audioAutoPlay,
      popupScale: this.config.popupScale,
      popupMinWidth: (Number(this.config.popupMinWidth) || 250) * mapper.browserScale,
      popupMaxWidth: (Number(this.config.popupMaxWidth) || 440) * mapper.browserScale,
      fontScale: this.config.fontScale,
      anki: {
        enabled: this.ankiConfig.enabled,
        configured: this.ankiConfig.configured,
      },
      anchor: this.#desktopRectToBrowser(anchor, mapper),
      geometryGeneration: snapshot.geometryGeneration,
    };
  }

  async #beginNestedLookup(term) {
    if (
      !this.popupContext ||
      !this.snapshot ||
      this.config.nestedPopupMode === "off" ||
      (this.popupContext.stack?.length || 0) >= (this.config.nestedPopupMaxDepth || 3)
    )
      return;
    const text = String(term || "").trim();
    if (!text) return;
    const languageRequest = requestFor(
      this.config.lookupLanguage || "ja",
      text,
      0,
      this.config.scanLength || 24,
    );
    if (!languageRequest) return;
    const currentSnapshot = this.snapshot;
    const serial = ++this.lookupSerial;
    this.lookupAbort?.abort();
    this.lookupAbort = new AbortController();
    try {
      const lookupController = this.lookupAbort;
      const lookupPromise = this.dictionary.lookup(
        {
          requestId: requestId(),
          text: languageRequest.lookupText,
          utf16Start: languageRequest.utf16Start,
          language: this.config.lookupLanguage || "ja",
          mode: languageRequest.mode,
          scanLength: this.config.scanLength || 24,
          candidates: languageRequest.candidates,
          sessionId: currentSnapshot.sessionId,
          geometryGeneration: currentSnapshot.geometryGeneration,
        },
        lookupController.signal,
      );
      const boundedLookup = withLookupTimeout(
        lookupPromise,
        lookupController,
        this.config.lookupTimeoutMs,
        "Dictionary lookup timed out",
      );
      const result = await withLookupTimeout(
        boundedLookup,
        lookupController,
        this.config.hoverRequestTimeoutMs,
        "Nested lookup timed out",
      );
      if (
        serial !== this.lookupSerial ||
        !this.popupContext ||
        !this.snapshot ||
        !isSnapshotCurrent(this.snapshot, currentSnapshot)
      )
        return;
      this.interaction.dispatch(EVENTS.NESTED_OPENED, { text });
      this.popupContext.stack.push({
        result: this.popupContext.result,
        selectionText: this.popupSelectionText,
      });
      this.popupContext.result = this.#normalizeDictionaryResult(result);
      this.popupSelectionText = "";
      this.popupMeasuredSize = null;
      this.popupRegions = Object.freeze({});
      this.popupScroll = Object.freeze({ left: 0, top: 0 });
      this.browserHost.send("popup", "popup-state", {
        visible: true,
        ...this.#popupPayload(this.popupContext.result, currentSnapshot),
      });
    } catch (error) {
      if (error?.name !== "AbortError" && serial === this.lookupSerial)
        this.browserHost.send("popup", "popup-error", {
          message: error.message || "Nested lookup failed",
        });
    }
  }

  async #onHostRequest({ message, surface }) {
    const payload = message.payload || {};
    switch (message.type) {
      case "pointer-move":
        this.modifierPressed = message.payload?.shiftKey === true;
        break;
      case "dismiss-popup":
        await this.closePopup(payload.reason || "dismissed");
        break;
      case "popup-action":
        if (payload.action === "selection-start") {
          this.interaction.dispatch(EVENTS.SELECTION_START, {
            pointerId: payload.pointerId,
            button: payload.button,
            time: Date.now(),
          });
        } else if (
          payload.action === "selection-end" ||
          payload.action === "selection-cancel"
        ) {
          this.interaction.dispatch(
            payload.action === "selection-cancel"
              ? EVENTS.POINTER_CANCEL
              : EVENTS.SELECTION_END,
            { pointerId: payload.pointerId, time: Date.now() },
          );
        } else if (payload.action === "pointer-down") {
          this.interaction.dispatch(EVENTS.POINTER_DOWN, {
            button: payload.button,
            time: Date.now(),
          });
        } else if (payload.action === "pointer-up") {
          this.interaction.dispatch(EVENTS.POINTER_UP, {
            button: payload.button,
            time: Date.now(),
          });
        } else if (payload.action === "escape") {
          if (this.interaction.state === STATES.AUDIO_MENU)
            await this.#closeAudioMenu("escape");
          else await this.closePopup("escape");
        } else if (payload.action === "close-audio-list") {
          await this.#closeAudioMenu("popup-action");
        } else if (payload.action === "audio-menu") {
          await this.#requestAudioForEntry(this.popupContext?.result?.entries?.[0]);
        } else if (payload.action === "selection-changed") {
          this.popupSelectionText = String(payload.text || "").slice(0, 20000);
          this.emit("popup-selection", this.popupSelectionText);
        } else if (payload.action === "close-popup") {
          await this.closePopup("escape");
        }
        break;
      case "player-command":
        await this.bridge?.command(payload.command);
        break;
      case "external-link": {
        const url = externalUrl(payload.url);
        if (url && this.shell?.openExternal) await this.shell.openExternal(url);
        break;
      }
      case "nested-lookup":
        await this.#beginNestedLookup(payload.term);
        break;
      case "audio-source": {
        await this.#requestAudio(payload, message.requestId || payload.requestId);
        break;
      }
      case "anki-action": {
        if (
          !this.anki ||
          !this.ankiConfig.configured ||
          !["add-note", "add-anyway", "open"].includes(payload.action) ||
          !this.popupContext
        )
          break;
        const entryId = String(payload.entryId || "");
        if (payload.action !== "open") {
          if (this.ankiPending.has(entryId)) break;
          this.ankiPending.add(entryId);
        }
        try {
          if (payload.action === "open") {
            const noteIds = this.popupContext.ankiNoteIds?.[entryId] || [];
            if (!noteIds.length || typeof this.anki.guiBrowse !== "function")
              throw new Error("No duplicate Anki note is available to open");
            await this.anki.guiBrowse(`nid:${noteIds[0]}`);
            this.browserHost.send("popup", "anki-result", {
              entryId,
              ok: true,
              state: "opened",
              noteIds,
            });
            break;
          }
          const popupContext = this.popupContext;
          const entry = popupContext.result.entries.find(
            (value) => String(value.id) === entryId,
          );
          if (!entry) throw new Error("Anki entry is no longer available");
          const hit = popupContext.hit;
          const timingRole = hit?.track?.role === "secondary" ? "secondary" : "primary";
          const timingPrefix = timingRole === "secondary" ? "secondary-sub-" : "sub-";
          const noteContext = {
            entry,
            result: popupContext.result,
            sentence: hit.event.sourceText,
            selectedText: this.popupSelectionText || hit.unit.text,
            documentTitle: this.bridge?.property("media-title", ""),
            sourcePath: this.bridge?.property("path", ""),
            timestamp: this.bridge?.property("time-pos", ""),
            subtitleStartMs: hit.event.startMs,
            subtitleEndMs: hit.event.endMs,
            subtitleDelayMs:
              Number(this.bridge?.property(`${timingPrefix}delay`, 0)) * 1000,
            subtitleSpeed: Number(this.bridge?.property(`${timingPrefix}speed`, 1)),
          };
          let note = buildAnkiNote(this.ankiConfig, noteContext);
          const forceAdd = payload.action === "add-anyway";
          if (
            this.ankiConfig.duplicateCheck &&
            !forceAdd &&
            typeof this.anki.findNotes === "function"
          ) {
            const field = Object.values(note.fields)[0] || "";
            const escaped = String(field).replace(/[\\"]/g, "\\$&");
            const scope =
              note.options.duplicateScope === "deck"
                ? `deck:"${note.deckName.replace(/"/g, '\\"')}" `
                : "";
            const duplicateIds = await this.anki.findNotes(`${scope}"${escaped}"`);
            if (
              this.popupContext !== popupContext ||
              !this.snapshot ||
              !isSnapshotCurrent(this.snapshot, popupContext.snapshot)
            )
              throw new Error("Anki export became stale while checking duplicates");
            if (Array.isArray(duplicateIds) && duplicateIds.length) {
              this.browserHost.send("popup", "anki-result", {
                entryId,
                ok: false,
                state: "duplicate",
                noteIds: duplicateIds.slice(0, 32),
                message: "A matching Anki note already exists.",
              });
              this.popupContext.ankiNoteIds ||= {};
              this.popupContext.ankiNoteIds[entryId] = duplicateIds.slice(0, 32);
              break;
            }
          }
          const resolvedMedia = await this.#resolveAnkiMedia(entry, noteContext);
          if (
            this.popupContext !== popupContext ||
            !this.snapshot ||
            !isSnapshotCurrent(this.snapshot, popupContext.snapshot)
          )
            throw new Error("Anki export became stale while media was prepared");
          note = buildAnkiNote(this.ankiConfig, noteContext, resolvedMedia.media);
          const result = await this.anki.addNote(note);
          this.browserHost.send("popup", "anki-result", {
            entryId,
            ok: true,
            state: "added",
            result,
            warnings: resolvedMedia.warnings,
          });
        } catch (error) {
          this.browserHost.send("popup", "anki-result", {
            entryId,
            ok: false,
            error: error.message,
          });
        } finally {
          if (payload.action !== "open") this.ankiPending.delete(entryId);
        }
        break;
      }
      case "controller-state": {
        await this.handleControllerState(payload);
        break;
      }
      case "popup-size":
        this.#handlePopupSize(surface, payload);
        this.emit("popup-size", payload);
        break;
      case "popup-region":
        if (
          surface === "popup" &&
          this.popupContext &&
          this.snapshot &&
          message.geometryGeneration === this.snapshot.geometryGeneration
        ) {
          this.popupRegions = Object.freeze({
            ...this.popupRegions,
            [payload.name]: Object.freeze({
              x: payload.x,
              y: payload.y,
              width: payload.width,
              height: payload.height,
            }),
          });
          this.emit("popup-region", {
            name: payload.name,
            ...this.popupRegions[payload.name],
          });
        }
        break;
      case "popup-scroll":
        if (surface === "popup" && this.popupContext) {
          this.popupScroll = Object.freeze({
            left: Number.isFinite(payload.left) ? payload.left : 0,
            top: Number.isFinite(payload.top) ? payload.top : 0,
          });
          this.emit("popup-scroll", this.popupScroll);
        }
        break;
      case "ready":
        this.emit("surface-ready", payload.surface);
        break;
      default:
        break;
    }
  }

  async closePopup(reason = "dismissed", options = {}) {
    if (!this.bridge || !this.snapshot) return;
    this.lastPopupCloseReason = String(reason);
    if (process.env.IINATAN_E2E_DEBUG === "1")
      console.error(`[iinatan] popup-close: ${String(reason)}`);
    this.lookupSerial++;
    if (this.lookupAbort) this.lookupAbort.abort();
    this.audioAbort?.abort();
    if (this.interaction.state === STATES.TEXT_SELECTION)
      this.interaction.dispatch(EVENTS.POINTER_CANCEL, { time: Date.now() });
    if (this.interaction.state === STATES.AUDIO_MENU) {
      this.interaction.dispatch(EVENTS.CLOSE_TRANSIENT, { reason });
      this.browserHost.send("popup", "controller-command", {
        command: "close-audio-menu",
      });
    }
    if (
      !options.closeAll &&
      this.interaction.state === STATES.NESTED_POPUP_ACTIVE &&
      this.popupContext?.stack?.length
    ) {
      this.interaction.dispatch(EVENTS.CLOSE_POPUP, { reason });
      const previous = this.popupContext.stack.pop();
      this.popupContext.result = previous.result;
      this.popupSelectionText = previous.selectionText || "";
      this.popupRegions = Object.freeze({});
      this.popupScroll = Object.freeze({ left: 0, top: 0 });
      this.browserHost.send("popup", "popup-state", {
        visible: true,
        ...this.#popupPayload(this.popupContext.result, this.popupContext.snapshot),
      });
      return;
    }
    if (options.closeAll) {
      while (this.interaction.state === STATES.NESTED_POPUP_ACTIVE)
        this.interaction.dispatch(EVENTS.CLOSE_POPUP, { reason });
    }
    const state = this.interaction.state;
    if (
      [STATES.POPUP_ACTIVE, STATES.NESTED_POPUP_ACTIVE, STATES.AUDIO_MENU].includes(
        state,
      )
    )
      this.interaction.dispatch(EVENTS.CLOSE_POPUP, { reason });
    this.browserHost.hidePopup({ focusPlayer: options.focusPlayer !== false });
    await this.#releasePause(
      reason,
      options.generation ?? this.snapshot.geometryGeneration,
    );
    this.browserHost.setPassiveInput();
    this.popupPlacement = null;
    this.popupMeasuredSize = null;
    this.popupRegions = Object.freeze({});
    this.popupScroll = Object.freeze({ left: 0, top: 0 });
    this.popupContext = null;
    this.popupSelectionText = "";
  }

  async #releasePause(reason, generation = this.snapshot?.geometryGeneration) {
    if (!this.bridge || generation === undefined || generation === null) return;
    const actions = this.pauseOwnership.close({ generation, reason });
    for (const action of actions)
      if (action === "resume") await this.bridge.setPause(false);
  }

  async #performControllerAction(action) {
    switch (action) {
      case "lookup":
        if (this.lastHit && !this.browserHost?.popupVisible)
          await this.#beginLookup(this.lastHit);
        break;
      case "toggle-pause":
        await this.bridge?.command("toggle-pause");
        break;
      case "resume-playback":
        await this.bridge?.setPause(false, "user");
        break;
      case "seek-backward":
      case "seek-forward":
      case "subtitle-previous":
      case "subtitle-next":
      case "frame-step-backward":
      case "frame-step-forward":
      case "volume-down":
      case "volume-up":
      case "speed-down":
      case "speed-up":
        await this.bridge?.command(action);
        break;
      case "audio-menu":
      case "play-audio":
        await this.#requestAudioForEntry(this.popupContext?.result?.entries?.[0]);
        break;
      case "close-audio-list":
        await this.#closeAudioMenu("controller");
        break;
      case "audio-up":
      case "audio-down":
      case "audio-left":
      case "audio-right":
      case "audio-activate":
        this.browserHost?.send("popup", "controller-command", { command: action });
        break;
      case "close-popup":
        await this.closePopup("controller");
        break;
      case "popup-scroll-up":
      case "popup-up":
        this.browserHost?.send("popup", "controller-command", { command: "scroll-up" });
        break;
      case "popup-scroll-down":
      case "popup-down":
        this.browserHost?.send("popup", "controller-command", {
          command: "scroll-down",
        });
        break;
      case "popup-left":
      case "popup-right":
        this.browserHost?.send("popup", "controller-command", { command: action });
        break;
      case "anki-primary":
      case "anki-force-add":
        await this.#submitAnkiFromController(action === "anki-force-add");
        break;
      default:
        break;
    }
  }

  async #submitAnkiFromController(forceAdd) {
    const entry = this.popupContext?.result?.entries?.[0];
    if (!entry) return;
    await this.#onHostRequest({
      message: {
        type: "anki-action",
        payload: {
          action: forceAdd ? "add-anyway" : "add-note",
          entryId: entry.id,
        },
      },
    });
  }

  async #requestAudioForEntry(entry) {
    if (!entry) return;
    await this.#requestAudio({
      term: entry.headword,
      reading: entry.reading,
      sources: this.config.audioSources,
      requestId: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  async #requestAudio(payload = {}, requestId = payload.requestId) {
    if (
      !this.audio ||
      !this.popupContext ||
      ![STATES.POPUP_ACTIVE, STATES.NESTED_POPUP_ACTIVE, STATES.AUDIO_MENU].includes(
        this.interaction.state,
      )
    )
      return;
    if (this.interaction.state !== STATES.AUDIO_MENU)
      this.interaction.dispatch(EVENTS.AUDIO_OPENED, { term: payload.term });
    this.audioAbort?.abort();
    const audioAbort = new AbortController();
    this.audioAbort = audioAbort;
    this.browserHost.send(
      "popup",
      "audio-result",
      { candidates: [], loading: true },
      { requestId },
    );
    try {
      const candidates = await this.audio.resolve(payload, audioAbort.signal);
      this.browserHost.send("popup", "audio-result", { candidates }, { requestId });
    } catch (error) {
      if (error?.name !== "AbortError")
        this.browserHost.send(
          "popup",
          "audio-result",
          { candidates: [], error: error.message || "Audio lookup failed" },
          { requestId },
        );
    } finally {
      if (this.audioAbort === audioAbort) this.audioAbort = null;
    }
  }

  async #closeAudioMenu(reason) {
    this.audioAbort?.abort();
    if (this.interaction.state !== STATES.AUDIO_MENU) return;
    this.interaction.dispatch(EVENTS.CLOSE_TRANSIENT, { reason });
    this.browserHost.send("popup", "controller-command", {
      command: "close-audio-menu",
    });
  }

  async #resolveAnkiMedia(entry, context = {}) {
    const requirements = mediaRequirements(
      normalizeTemplates(this.ankiConfig.fieldTemplatesJson),
    );
    const media = {};
    const warnings = [];
    if (requirements.sentenceAudio) {
      if (!this.sentenceAudio) {
        warnings.push(
          "Sentence audio is unavailable: no packaged ffmpeg capability is configured.",
        );
      } else {
        let temporaryRoot = null;
        try {
          temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-anki-"));
          const format = this.ankiConfig.audioFormat === "opus" ? "opus" : "mp3";
          const outputPath = path.join(temporaryRoot, `sentence.${format}`);
          const capture = await this.sentenceAudio.capture({
            sourcePath: context.sourcePath,
            startMs: context.subtitleStartMs,
            endMs: context.subtitleEndMs,
            timeMs: Number(context.timestamp) * 1000,
            subtitleDelayMs: context.subtitleDelayMs,
            subtitleSpeed: context.subtitleSpeed,
            paddingMs: this.ankiConfig.sentenceAudioPaddingMs,
            format,
            bitrateKbps: this.ankiConfig.audioBitrateKbps,
            outputPath,
            signal: this.lookupAbort?.signal,
          });
          const data = (await fs.readFile(capture.path)).toString("base64");
          const filename = mediaFilename(
            "iinatan-sentence",
            `${context.sourcePath}:${capture.startMs}:${capture.endMs}:${capture.format}:${capture.bitrateKbps}`,
            capture.format,
          );
          await this.anki.storeMediaFile(filename, data, { overwrite: false });
          media.sentenceAudio = filename;
        } catch (error) {
          if (error?.name !== "AbortError") {
            warnings.push(`Sentence audio unavailable: ${error.message}`);
            this.emit("anki-media-unavailable", error);
          }
        } finally {
          if (temporaryRoot)
            await fs.rm(temporaryRoot, { recursive: true, force: true });
        }
      }
    }
    if (requirements.wordAudio && this.audio && this.anki) {
      try {
        const candidates = await this.audio.resolve(
          {
            term: entry.headword,
            reading: entry.reading,
            sources: this.config.audioSources,
          },
          this.lookupAbort?.signal,
        );
        const candidate = candidates[0];
        if (candidate?.url)
          media.wordAudio = await storeRemoteMedia(this.anki, candidate.url, {
            fetch: this.audio.fetch,
            prefix: "iinatan-word",
            signal: this.lookupAbort?.signal,
          });
      } catch (error) {
        if (error?.name !== "AbortError") {
          warnings.push(`Word audio unavailable: ${error.message}`);
          this.emit("anki-media-unavailable", error);
        }
      }
    }
    if (requirements.screenshot && this.bridge && this.anki) {
      let temporaryRoot = null;
      try {
        if (typeof this.bridge.screenshotToFile !== "function")
          throw new Error("mpv screenshot command is unavailable");
        temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-anki-"));
        const screenshotPath = path.join(temporaryRoot, "frame.jpg");
        await this.bridge.screenshotToFile(
          screenshotPath,
          this.ankiConfig.imageQuality,
        );
        const screenshotStat = await fs.stat(screenshotPath);
        if (screenshotStat.size > MEDIA_LIMIT_BYTES)
          throw new Error("Screenshot exceeds the Anki media size limit");
        const data = (await fs.readFile(screenshotPath)).toString("base64");
        const filename = mediaFilename(
          "iinatan-screenshot",
          `${this.bridge.property("path", "")}:${this.bridge.property("time-pos", "")}`,
          "jpg",
        );
        await this.anki.storeMediaFile(filename, data, { overwrite: false });
        media.screenshot = filename;
      } catch (error) {
        if (error?.name !== "AbortError") {
          warnings.push(`Screenshot unavailable: ${error.message}`);
          this.emit("anki-media-unavailable", error);
        }
      } finally {
        if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
    }
    return { media, warnings };
  }

  async detach(reason = "detached") {
    if (this.detachPromise) return this.detachPromise;
    const promise = this.#detach(reason);
    this.detachPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.detachPromise === promise) this.detachPromise = null;
    }
  }

  async #detach(reason) {
    this.geometryRefreshSerial++;
    this.geometryRefreshPromise = null;
    clearInterval(this.cursorTimer);
    clearInterval(this.geometryTimer);
    this.cursorTimer = null;
    this.geometryTimer = null;
    if (this.lookupAbort) this.lookupAbort.abort();
    this.audioAbort?.abort();
    if (this.surfaceRecoveryPromise) await this.surfaceRecoveryPromise.catch(() => {});
    this.lookupAbort = null;
    if (this.bridge) {
      try {
        await this.closePopup(reason, { closeAll: true });
      } catch (_) {}
      this.bridge.close();
    }
    // The dictionary service is shared by live mpv sessions. Aborting this
    // controller's request above is sufficient and must not cancel another
    // session's lookup.
    this.interaction.dispatch(EVENTS.SESSION_LOST, { reason });
    this.browserHost?.close();
    this.bridge = null;
    this.descriptor = null;
    this.snapshot = null;
    this.lastHit = null;
    this.cursorPoint = null;
    this.popupContext = null;
    this.popupSelectionText = "";
    this.popupRegions = Object.freeze({});
    this.popupScroll = Object.freeze({ left: 0, top: 0 });
    this.windowUnavailable = false;
    this.nativeGeometryErrorKey = null;
    this.nativeGeometryError = null;
    this.modifierPressed = false;
  }
}

module.exports = {
  ApplicationController,
  flattenSubtitleText,
  subtitleLookupText,
  unionRects,
};
