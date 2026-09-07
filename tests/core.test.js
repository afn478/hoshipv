"use strict";

const test = require("node:test");
const { EventEmitter } = require("node:events");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  validateHostRequest,
  validateHostEvent,
  makeEnvelope,
} = require("../src/bridge/protocol");
const { CoordinateMapper } = require("../src/geometry/coordinate-mapper");
const { placePopup } = require("../src/geometry/popup-placement");
const {
  createGeometrySnapshot,
  highlightForHit,
  hitTest,
  isSnapshotCurrent,
} = require("../src/geometry/snapshot");
const { createTextIndex } = require("../src/geometry/unicode-index");
const {
  SubtitleGeometryProvider,
  parseAssTime,
} = require("../src/geometry/subtitle-geometry-provider");
const {
  EVENTS,
  InteractionController,
  STATES,
} = require("../src/interaction/interaction-controller");
const { PauseOwnership } = require("../src/interaction/pause-ownership");
const { ControllerRouter } = require("../src/interaction/controller-runtime");
const {
  ACTIONS,
  BUTTONS,
  normalizeBindings,
} = require("../src/interaction/controller-bindings");
const {
  PROFILE_PREFERENCE_DEFAULTS,
  PROFILE_PREFERENCE_KEYS,
  GLOBAL_SETTINGS_KEYS,
  normalizePreferences,
  normalizeSettingsDocument,
} = require("../src/settings/defaults");
const { SettingsStore } = require("../src/settings/settings-store");
const { readFileBounded } = require("../src/services/bounded-file");
const {
  customCss,
  externalUrl,
  normalizeDictionaryResult,
} = require("../src/services/content-security");
const {
  DictionaryCatalog,
  managedRootForEntry,
  normalizeDictionaryEntry,
  resolveImportedDictionaryPath,
  validateDictionaryZip,
  within,
} = require("../src/services/dictionary-catalog");
const {
  RECOMMENDED_DICTIONARIES,
  recommendedDictionariesForLanguage,
} = require("../src/services/recommended-dictionaries");
const {
  downloadFile,
  safeDictionaryDownloadUrl,
} = require("../src/services/dictionary-download");
const { requestFor } = require("../src/services/language-registry");
const {
  AudioSourceService,
  readBoundedText,
  safeAudioUrl,
} = require("../src/services/audio-service");
const {
  AnkiConnectClient,
  normalizeNote,
  safeAnkiUrl,
} = require("../src/services/anki-connect");
const {
  buildAnkiNote,
  contextForEntry,
  normalizeTemplates,
  renderTemplate,
} = require("../src/services/anki-card");
const { fetchMedia, mediaRequirements } = require("../src/services/anki-media");
const {
  SentenceAudioService,
  buildFfmpegArguments,
  sentenceAudioWindow,
} = require("../src/services/sentence-audio-service");
const {
  HoshiWorker,
  normalizeNativeControllerState,
} = require("../src/services/hoshi-worker");
const {
  sanitizeDiagnosticError,
  sanitizeDiagnosticMessage,
} = require("../src/services/diagnostics");
const {
  DictionaryService,
  HoshiDictionaryService,
} = require("../src/services/dictionary-service");
const { compareGeometryFixture, edgeError, iou } = require("../src/geometry/oracle");
const {
  NativeGeometryClient,
  geometryRequest,
} = require("../src/services/native-geometry-client");
const {
  NativeSubtitleGeometryService,
  nativeDisplayIndex,
  nativeStrippedDisplayIndex,
  rendererForTrack,
  secondaryStripObservation,
  trackRequest,
} = require("../src/geometry/native-subtitle-geometry-service");
const { NativeWindowAdapter } = require("../src/platform/native-window-adapter");
const { PlayerBridge } = require("../src/player/player-bridge");
const { BrowserHost } = require("../src/platform/browser-host");
const { requestedMediaPath } = require("../src/player/launch-arguments");
const {
  assTimestampMilliseconds,
  parseAssDialogue,
  visibleGraphemeUnits,
  wordUnits,
} = require("../scripts/e2e/stock-mpv-real-media-ass-smoke");

test("diagnostic errors redact paths and stay bounded", () => {
  const result = sanitizeDiagnosticError({
    code: "native geometry:invalid",
    message: "failed to read /private/fixture/request.json and C:\\tmp\\secret.json",
    geometryGeneration: 4,
  });
  assert.deepEqual(result, {
    code: "native_geometry:invalid",
    message: "failed to read <path> and <path>",
    geometryGeneration: 4,
  });
});

test("diagnostic messages redact paths without hiding the geometry reason", () => {
  assert.equal(
    sanitizeDiagnosticMessage("stock mpv rejected /Users/test/private.ass"),
    "stock mpv rejected <path>",
  );
  assert.equal(sanitizeDiagnosticMessage(""), "");
});

test("media launch arguments resolve both packaged-file and explicit forms", () => {
  assert.equal(
    requestedMediaPath(["electron", ".", "--open-media=/media/episode.mkv"]),
    "/media/episode.mkv",
  );
  assert.equal(
    requestedMediaPath(["electron", ".", "--open-media", "media/episode.mkv"]),
    path.resolve("media/episode.mkv"),
  );
  assert.equal(requestedMediaPath(["electron", ".", "--open-media"]), null);
  assert.equal(requestedMediaPath(["electron", ".", "--settings"]), null);
});

class FakeWebContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.sent = [];
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  send(channel, message) {
    this.sent.push({ channel, message });
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  static reset() {
    FakeBrowserWindow.instances = [];
  }

  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents(FakeBrowserWindow.instances.length + 1);
    this.bounds = null;
    this.visible = false;
    this.focused = false;
    this.destroyed = false;
    this.ignoreMouse = null;
    this.alwaysOnTop = null;
    this.topMoves = 0;
    FakeBrowserWindow.instances.push(this);
  }

  setMenuBarVisibility() {}
  setAlwaysOnTop(flag, level) {
    this.alwaysOnTop = { flag, level };
  }
  moveTop() {
    this.topMoves += 1;
  }
  async loadURL(url) {
    this.url = url;
  }
  setBounds(value) {
    this.bounds = { ...value };
  }
  showInactive() {
    this.visible = true;
    this.focused = false;
  }
  show() {
    this.visible = true;
  }
  focus() {
    this.focused = true;
  }
  hide() {
    this.visible = false;
    this.focused = false;
  }
  setIgnoreMouseEvents(ignore, options) {
    this.ignoreMouse = { ignore, options };
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  isFocused() {
    return this.focused;
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.focused = false;
    this.emit("closed");
  }
}

test("coordinate transforms round trip with fractional scale and negative desktop coordinates", () => {
  const mapper = new CoordinateMapper({
    content: { x: -1440.5, y: 72.25, width: 1280, height: 720 },
    osd: { width: 1920, height: 1080 },
    desktopScale: 2,
    browserScale: 1.25,
  });
  const source = { x: 640.25, y: 540.5 };
  const desktop = mapper.osdToDesktop(source);
  const roundTrip = mapper.desktopToOsd(desktop);
  assert.ok(Math.abs(roundTrip.x - source.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - source.y) < 1e-9);
  assert.deepEqual(mapper.nativeBounds({ x: -1.4, y: 2.6, width: 9.4, height: 10.2 }), {
    x: -1,
    y: 3,
    width: 9,
    height: 10,
  });
  assert.deepEqual(mapper.desktopToPhysical({ x: -1, y: 2 }), { x: -2, y: 4 });
});

test("coordinate transforms remain inverses across deterministic fractional cases", () => {
  let seed = 0x1a17a7a;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 256; index++) {
    const mapper = new CoordinateMapper({
      content: {
        x: -1800 + next() * 3000,
        y: -200 + next() * 1000,
        width: 320 + next() * 1600,
        height: 240 + next() * 1000,
      },
      osd: {
        width: 640 + next() * 1920,
        height: 360 + next() * 1080,
      },
      desktopScale: 1 + next() * 2,
      browserScale: 0.75 + next() * 1.5,
    });
    const osdPoint = {
      x: next() * mapper.osd.width,
      y: next() * mapper.osd.height,
    };
    const desktop = mapper.osdToDesktop(osdPoint);
    const roundTrip = mapper.desktopToOsd(desktop);
    assert.ok(Math.abs(roundTrip.x - osdPoint.x) < 0.000001);
    assert.ok(Math.abs(roundTrip.y - osdPoint.y) < 0.000001);
  }
});

test("unicode index preserves grapheme, UTF-16, and UTF-8 ranges", () => {
  const index = createTextIndex("Á😀‍👩‍👩‍👧");
  assert.equal(index.units[0].text, "Á");
  assert.equal(index.units[1].text, "😀‍👩‍👩‍👧");
  assert.equal(index.units[1].utf16Start, 2);
  assert.equal(index.units[1].utf16End, "Á😀‍👩‍👩‍👧".length);
  assert.equal(index.unitAtUtf16(3).text, index.units[1].text);
  assert.equal(index.unitAtUtf8(4).text, index.units[1].text);
  assert.equal(index.utf8Length, Buffer.byteLength("Á😀‍👩‍👩‍👧"));
});

function snapshotFixture() {
  return createGeometrySnapshot({
    sessionId: "session-a",
    mediaGeneration: 2,
    geometryGeneration: 8,
    content: { x: -100, y: 50, width: 1280, height: 720 },
    osd: { width: 1280, height: 720 },
    tracks: [
      {
        id: "primary-track",
        role: "primary",
        events: [
          {
            id: "primary-event-1",
            sourceText: "日本語",
            layer: 0,
            units: [
              {
                id: "primary-unit-0",
                text: "日",
                sourceText: "日本語",
                utf16Range: [0, 1],
                utf8Range: [0, 3],
                rect: { x: 100, y: 600, width: 40, height: 50 },
              },
              {
                id: "primary-unit-1",
                text: "本",
                sourceText: "日本語",
                utf16Range: [1, 2],
                utf8Range: [3, 6],
                rect: { x: 140, y: 600, width: 40, height: 50 },
              },
            ],
          },
        ],
      },
      {
        id: "secondary-track",
        role: "secondary",
        events: [
          {
            id: "secondary-event-1",
            sourceText: "English",
            layer: 0,
            units: [
              {
                id: "secondary-unit-0",
                text: "E",
                sourceText: "English",
                utf16Range: [0, 1],
                utf8Range: [0, 1],
                rect: { x: 100, y: 600, width: 80, height: 35 },
              },
            ],
          },
        ],
      },
    ],
  });
}

test("hit testing keeps tracks, events, and unit identity separate", () => {
  const snapshot = snapshotFixture();
  const hit = hitTest(snapshot, { x: 40, y: 660 });
  assert.equal(hit.track.id, "primary-track");
  assert.equal(hit.event.id, "primary-event-1");
  assert.equal(hit.unit.id, "primary-unit-0");
  assert.deepEqual(highlightForHit(snapshot, hit), [
    { x: 0, y: 650, width: 40, height: 50 },
  ]);
  assert.equal(
    isSnapshotCurrent(snapshot, {
      sessionId: "session-a",
      mediaGeneration: 2,
      geometryGeneration: 8,
    }),
    true,
  );
  assert.equal(
    isSnapshotCurrent(snapshot, {
      sessionId: "session-a",
      mediaGeneration: 2,
      geometryGeneration: 9,
    }),
    false,
  );
});

test("placement is deterministic and prefers a previous side within hysteresis", () => {
  const input = {
    anchor: { x: 460, y: 330, width: 30, height: 30 },
    popupSize: { width: 240, height: 180 },
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    obstacles: [{ x: 380, y: 370, width: 220, height: 180 }],
    cursor: { x: 475, y: 345 },
    gap: 14,
    preferredSide: "below",
    corridorPadding: 10,
  };
  const first = placePopup(input);
  const second = placePopup({
    ...input,
    previous: first,
    previousSide: first.side,
    hysteresis: 1000,
  });
  assert.equal(second.side, first.side);
  assert.ok(second.x >= 0 && second.y >= 0);
  assert.equal(second.cursorCorridor.width > 0, true);
});

test("interaction state machine consumes popup input and closes deepest UI first", () => {
  const controller = new InteractionController();
  controller.dispatch(EVENTS.SESSION_READY, {
    sessionId: "session-a",
    geometryGeneration: 1,
  });
  controller.dispatch(EVENTS.POINTER_TARGET, { hit: { unitId: "u" } });
  controller.dispatch(EVENTS.LOOKUP_REQUESTED, { requestId: "r1" });
  assert.deepEqual(
    controller.dispatch(EVENTS.LOOKUP_SUCCEEDED, { requestId: "stale", result: {} }),
    ["discard-stale-result"],
  );
  controller.dispatch(EVENTS.LOOKUP_SUCCEEDED, { requestId: "r1", result: {} });
  assert.deepEqual(
    controller.dispatch(EVENTS.POINTER_TARGET, { hit: { unitId: "crossed-word" } }),
    [],
  );
  assert.equal(controller.state, STATES.POPUP_ACTIVE);
  controller.dispatch(EVENTS.NESTED_OPENED, { id: "nested" });
  assert.equal(controller.state, STATES.NESTED_POPUP_ACTIVE);
  assert.ok(
    controller.dispatch(EVENTS.POINTER_DOWN, { button: 0 }).includes("consume-input"),
  );
  controller.dispatch(EVENTS.ESCAPE);
  assert.equal(controller.state, STATES.POPUP_ACTIVE);
  controller.dispatch(EVENTS.ESCAPE);
  assert.equal(controller.state, STATES.PLAYER_INTERACTION);
  assert.equal(controller.capture, null);
});

test("interaction state machine owns native text-selection drag capture", () => {
  const controller = new InteractionController();
  controller.dispatch(EVENTS.SESSION_READY, {
    sessionId: "session-selection",
    geometryGeneration: 1,
  });
  controller.dispatch(EVENTS.POINTER_TARGET, { hit: { unitId: "u" } });
  controller.dispatch(EVENTS.LOOKUP_REQUESTED, { requestId: "selection-lookup" });
  controller.dispatch(EVENTS.LOOKUP_SUCCEEDED, {
    requestId: "selection-lookup",
    result: {},
  });

  assert.ok(
    controller
      .dispatch(EVENTS.SELECTION_START, { pointerId: 7, button: 0 })
      .includes("capture-pointer"),
  );
  assert.equal(controller.state, STATES.TEXT_SELECTION);
  assert.deepEqual(controller.capture, {
    kind: "text-selection",
    pointerId: 7,
    button: 0,
    startedAt: controller.capture.startedAt,
  });
  assert.ok(
    controller
      .dispatch(EVENTS.POINTER_UP, { pointerId: 7 })
      .includes("release-pointer"),
  );
  assert.equal(controller.state, STATES.POPUP_ACTIVE);
  assert.equal(controller.capture, null);

  controller.dispatch(EVENTS.SELECTION_START, { pointerId: 8, button: 0 });
  assert.equal(controller.state, STATES.TEXT_SELECTION);
  assert.ok(
    controller
      .dispatch(EVENTS.POINTER_CANCEL, { pointerId: 8 })
      .includes("release-pointer"),
  );
  assert.equal(controller.state, STATES.POPUP_ACTIVE);
  assert.equal(controller.capture, null);
});

test("pause ownership never resumes a user-paused session", () => {
  const ownership = new PauseOwnership();
  assert.deepEqual(ownership.open({ wasPaused: false, generation: 4 }), ["pause"]);
  ownership.notePluginPause(true, 4);
  assert.deepEqual(
    ownership.observePauseChange({ paused: true, source: "unknown", generation: 4 }),
    [],
  );
  assert.deepEqual(ownership.close({ generation: 4 }), ["resume"]);

  assert.deepEqual(ownership.open({ wasPaused: false, generation: 5 }), ["pause"]);
  ownership.notePluginPause(true, 5);
  assert.deepEqual(
    ownership.observePauseChange({ paused: false, source: "unknown", generation: 5 }),
    [],
  );
  assert.deepEqual(ownership.close({ generation: 5 }), []);

  assert.deepEqual(ownership.open({ wasPaused: false, generation: 6 }), ["pause"]);
  ownership.observePauseChange({ paused: true, source: "user", generation: 6 });
  assert.deepEqual(ownership.close({ generation: 6 }), []);
  assert.deepEqual(ownership.open({ wasPaused: true, generation: 7 }), []);
  assert.deepEqual(ownership.close({ generation: 7 }), []);
});

test("controller binding normalization preserves all contexts and rejects unknown actions", () => {
  for (const context of Object.keys(ACTIONS)) {
    const bindings = normalizeBindings(
      { primary: "unknown", dpadUp: ACTIONS[context][1] },
      context,
    );
    assert.equal(bindings.primary, "none");
    assert.equal(bindings.dpadUp, ACTIONS[context][1]);
    assert.equal(Object.keys(bindings).length, BUTTONS.length);
  }
});

test("controller router emits one action per press and bounded repeat events", () => {
  const router = new ControllerRouter({
    bindings: {
      noPopup: { primary: "lookup", dpadDown: "volume-down" },
    },
  });
  const pad = {
    connected: true,
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    axes: [],
  };
  pad.buttons[0] = { pressed: true, value: 1 };
  assert.deepEqual(router.actionsFor(pad, "noPopup", 100), [
    { action: "lookup", button: "primary", phase: "press" },
  ]);
  assert.deepEqual(router.actionsFor(pad, "noPopup", 200), []);
  pad.buttons[0] = { pressed: false, value: 0 };
  assert.deepEqual(router.actionsFor(pad, "noPopup", 201), []);

  pad.buttons[13] = { pressed: true, value: 1 };
  assert.deepEqual(router.actionsFor(pad, "noPopup", 300), [
    { action: "volume-down", button: "dpadDown", phase: "press" },
  ]);
  pad.buttons[13] = { pressed: false, value: 0 };
  router.actionsFor(pad, "noPopup", 301);
  pad.buttons[13] = { pressed: true, value: 1 };
  assert.deepEqual(router.actionsFor(pad, "popup", 400), [
    { action: "popup-scroll-down", button: "dpadDown", phase: "press" },
  ]);
  assert.deepEqual(router.actionsFor(pad, "popup", 760), [
    { action: "popup-scroll-down", button: "dpadDown", phase: "repeat" },
  ]);
  assert.deepEqual(router.actionsFor(pad, "popup", 880), [
    { action: "popup-scroll-down", button: "dpadDown", phase: "repeat" },
  ]);

  const stickRouter = new ControllerRouter({
    bindings: { popup: { dpadRight: "popup-right" } },
    deadzone: 0.4,
  });
  const stick = {
    connected: true,
    buttons: [],
    axes: [0.35, 0],
  };
  assert.deepEqual(stickRouter.actionsFor(stick, "popup", 100), []);
  stick.axes[0] = 0.5;
  assert.deepEqual(stickRouter.actionsFor(stick, "popup", 200), [
    { action: "popup-right", button: "dpadRight", phase: "press" },
  ]);
});

test("controller router resets edge state when a gamepad hot-swaps", () => {
  const router = new ControllerRouter({
    bindings: { noPopup: { primary: "lookup" } },
  });
  const pad = (id, index) => ({
    connected: true,
    id,
    index,
    buttons: [{ pressed: true, value: 1 }],
    axes: [],
  });

  assert.deepEqual(router.actionsFor(pad("first", 0), "noPopup", 100), [
    { action: "lookup", button: "primary", phase: "press" },
  ]);
  assert.deepEqual(router.actionsFor(pad("first", 0), "noPopup", 200), []);
  assert.deepEqual(router.actionsFor(pad("second", 1), "noPopup", 300), [
    { action: "lookup", button: "primary", phase: "press" },
  ]);
  assert.deepEqual(
    router.actionsFor({ connected: false, id: "second", index: 1 }, "noPopup", 400),
    [],
  );
  assert.deepEqual(router.actionsFor(pad("second", 1), "noPopup", 500), [
    { action: "lookup", button: "primary", phase: "press" },
  ]);
});

test("controller router accepts the native HID state contract", () => {
  const router = new ControllerRouter({
    bindings: { popup: { primary: "lookup", dpadRight: "popup-right" } },
  });
  const snapshot = normalizeNativeControllerState({
    protocol: 1,
    sequence: 4,
    updatedAt: Date.now(),
    source: "native-hid",
    connected: true,
    id: "DualSense Wireless Controller",
    buttons: { primary: true },
    axes: { leftY: 0, rightX: 0.6, rightY: 0 },
  });
  assert.equal(snapshot.id, "DualSense Wireless Controller");
  assert.deepEqual(router.actionsFor(snapshot, "popup", 100), [
    { action: "lookup", button: "primary", phase: "press" },
    { action: "popup-right", button: "dpadRight", phase: "press" },
  ]);
  assert.equal(normalizeNativeControllerState({ protocol: 1 }), null);
});

test("settings inventory has the reference 59 profile and 2 global preferences", () => {
  assert.equal(PROFILE_PREFERENCE_KEYS.length, 59);
  assert.equal(Object.keys(PROFILE_PREFERENCE_DEFAULTS).length, 59);
  assert.equal(GLOBAL_SETTINGS_KEYS.length, 2);
  const normalized = normalizePreferences({
    lookupLanguage: "not-a-language",
    popupMaxWidth: 100,
    controllerPopupBindingsJson: "{}",
  });
  assert.equal(normalized.lookupLanguage, "ja");
  assert.equal(
    normalizePreferences({ subtitleLookupMode: "modifier-hover" }).subtitleLookupMode,
    "shift-hover",
  );
  assert.equal(
    normalizePreferences({ wiktionaryEtymologyCollapseOverride: "inherit" })
      .wiktionaryEtymologyCollapseOverride,
    "inherit",
  );
  assert.ok(normalized.popupMaxWidth >= normalized.popupMinWidth);
  assert.equal(JSON.parse(normalized.controllerPopupBindingsJson).primary, "lookup");
  assert.equal(
    normalizeSettingsDocument({}).profiles.default.preferences.lookupLanguage,
    "ja",
  );
});

test("settings store writes atomically, preserves a backup, and restores a validated export", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-settings-"));
  const filePath = path.join(root, "settings.json");
  const exportPath = path.join(root, "export.json");
  const store = new SettingsStore(filePath);
  const initial = await store.load();
  initial.profiles.default.preferences.lookupLanguage = "de";
  await store.save(initial);
  await store.exportBackup(exportPath);
  const next = await store.update((value) => {
    value.profiles.default.preferences.lookupLanguage = "fr";
  });
  assert.equal(next.profiles.default.preferences.lookupLanguage, "fr");
  await store.restoreBackup(exportPath);
  assert.equal(store.current().profiles.default.preferences.lookupLanguage, "de");
  assert.ok((await fs.stat(`${filePath}.backup`)).isFile());
  await store.createProfile("study", "Study");
  await store.setActiveProfile("study");
  await store.updateProfile("study", (profile) => {
    profile.preferences.lookupLanguage = "de";
  });
  assert.equal(store.current().activeProfileId, "study");
  assert.equal(store.current().profiles.study.preferences.lookupLanguage, "de");
  await store.deleteProfile("study");
  assert.equal(store.current().activeProfileId, "default");
  await fs.rm(root, { recursive: true, force: true });
});

test("host-side JSON file reads reject oversized and non-regular inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-bounded-file-"));
  const filePath = path.join(root, "value.json");
  await fs.writeFile(filePath, '{"ok":true}\n');
  assert.equal(await readFileBounded(filePath, 1024, "utf8"), '{"ok":true}\n');
  await assert.rejects(() => readFileBounded(filePath, 4, "utf8"), {
    code: "FILE_SIZE_LIMIT",
  });
  await assert.rejects(() => readFileBounded(root, 1024, "utf8"), {
    code: "FILE_SIZE_LIMIT",
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("protocol validates sender-facing messages and external URL policy", () => {
  const request = makeEnvelope(
    "lookup",
    { text: "term", utf16Start: 0 },
    { sessionId: "s-1", requestId: "r-1", geometryGeneration: 2 },
  );
  assert.doesNotThrow(() => validateHostRequest(request));
  assert.throws(
    () =>
      validateHostRequest(
        makeEnvelope("player-command", { command: "quit" }, { sessionId: "s-1" }),
      ),
    /not allowed/,
  );
  assert.doesNotThrow(() =>
    validateHostRequest(
      makeEnvelope("pointer-move", { shiftKey: true }, { sessionId: "s-1" }),
    ),
  );
  assert.doesNotThrow(() =>
    validateHostRequest(
      makeEnvelope("popup-size", { width: 320, height: 240 }, { sessionId: "s-1" }),
    ),
  );
  assert.doesNotThrow(() =>
    validateHostRequest(
      makeEnvelope(
        "popup-region",
        { name: "headword", x: 12, y: 18, width: 80, height: 24 },
        { sessionId: "s-1", geometryGeneration: 2 },
      ),
    ),
  );
  assert.throws(
    () =>
      validateHostRequest(
        makeEnvelope(
          "popup-region",
          { name: "headword", x: 12, y: 18, width: 0, height: 24 },
          { sessionId: "s-1" },
        ),
      ),
    /positive finite number/,
  );
  assert.throws(
    () =>
      validateHostRequest(
        makeEnvelope(
          "popup-region",
          { name: "unexpected", x: 12, y: 18, width: 80, height: 24 },
          { sessionId: "s-1" },
        ),
      ),
    /allowed popup region/,
  );
  assert.doesNotThrow(() =>
    validateHostRequest(
      makeEnvelope("popup-scroll", { left: 0, top: 180 }, { sessionId: "s-1" }),
    ),
  );
  assert.throws(
    () =>
      validateHostRequest(
        makeEnvelope("popup-scroll", { left: -1, top: 180 }, { sessionId: "s-1" }),
      ),
    /non-negative finite number/,
  );
  assert.throws(
    () =>
      validateHostRequest(
        makeEnvelope("popup-size", { width: 0, height: 240 }, { sessionId: "s-1" }),
      ),
    /positive finite number/,
  );
  assert.throws(
    () =>
      validateHostRequest(
        makeEnvelope("pointer-move", { shiftKey: "yes" }, { sessionId: "s-1" }),
      ),
    /must be a boolean/,
  );
  assert.doesNotThrow(() =>
    validateHostEvent(makeEnvelope("geometry", { rects: [] }, { sessionId: "s-1" })),
  );
  assert.doesNotThrow(() =>
    validateHostEvent(
      makeEnvelope(
        "popup-layout",
        { position: { x: 10, y: 20 }, width: 320, maxHeight: 240 },
        { sessionId: "s-1" },
      ),
    ),
  );
  assert.throws(
    () =>
      validateHostEvent(
        makeEnvelope(
          "popup-layout",
          { position: { x: 10, y: 20 }, width: 0, maxHeight: 240 },
          { sessionId: "s-1" },
        ),
      ),
    /positive finite number/,
  );
  assert.equal(externalUrl("https://example.com/source"), "https://example.com/source");
  assert.equal(externalUrl("https://user:password@example.com/source"), "");
  assert.equal(externalUrl("https://"), "");
  assert.equal(externalUrl("javascript:alert(1)"), "");
  assert.throws(() => customCss("@import url(https://evil.test/x.css);"), /may not/);
  assert.throws(() => customCss("-moz-binding: url(javascript:alert(1));"), /may not/);
  const normalized = normalizeDictionaryResult({
    entries: [
      { headword: "x", glossaries: [{ content: [{ type: "script", text: "bad" }] }] },
    ],
  });
  assert.equal(normalized.entries[0].glossaries[0].content[0].type, "paragraph");
  const crossReference = normalizeDictionaryResult({
    entries: [
      {
        glossaries: [
          {
            content: [{ type: "cross-reference", text: "猫", term: "猫" }],
          },
        ],
      },
    ],
  });
  assert.equal(crossReference.entries[0].glossaries[0].content[0].lookup, "猫");
  const audioNode = normalizeDictionaryResult({
    entries: [
      {
        glossaries: [
          {
            content: [
              {
                type: "audio",
                name: "pronunciation",
                url: "https://audio.example/a.mp3",
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(
    audioNode.entries[0].glossaries[0].content[0].url,
    "https://audio.example/a.mp3",
  );
  assert.doesNotThrow(() =>
    normalizeDictionaryResult({
      entries: [
        null,
        { glossaries: [{ content: { type: "paragraph", text: "safe" } }] },
      ],
    }),
  );
});

test("dictionary presentation preserves scoped etymology collapse rules", () => {
  const sectionResult = (dictionary) =>
    normalizeDictionaryResult(
      {
        entries: [
          {
            glossaries: [
              {
                dict: dictionary,
                content: [
                  {
                    type: "section",
                    title: "Etymology",
                    content: [{ type: "paragraph", text: "origin" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        etymologyCollapseDefault: "expanded",
        wiktionaryEtymologyCollapseOverride: "inherit",
      },
    );

  const genericSection = sectionResult("Local dictionary");
  assert.equal(genericSection.entries[0].glossaries[0].sourceKind, "generic");
  assert.equal(genericSection.entries[0].glossaries[0].content[0].collapsed, false);

  const wiktionarySection = normalizeDictionaryResult(
    {
      entries: [
        {
          glossaries: [
            {
              dict: "Kaikki English",
              content: [
                {
                  type: "section",
                  title: "Etymology",
                  content: ["origin"],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      etymologyCollapseDefault: "expanded",
      wiktionaryEtymologyCollapseOverride: "collapsed",
    },
  );
  assert.equal(wiktionarySection.entries[0].glossaries[0].sourceKind, "kaikki");
  assert.equal(wiktionarySection.entries[0].glossaries[0].content[0].collapsed, true);

  const structured = normalizeDictionaryResult(
    {
      entries: [
        {
          glossaries: [
            {
              dict: "Wiktionary English",
              glossary: JSON.stringify({
                type: "structured-content",
                content: [
                  {
                    tag: "details",
                    data: { content: "details-entry-etymology" },
                    content: [
                      { tag: "summary", content: "Etymology" },
                      { tag: "p", content: "origin" },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      ],
    },
    {
      etymologyCollapseDefault: "expanded",
      wiktionaryEtymologyCollapseOverride: "inherit",
    },
  );
  const details = structured.entries[0].glossaries[0].content[0].content[0];
  assert.equal(details.tag, "details");
  assert.equal(details.open, true);
});

test("Wiktionary grammar and non-lemma payloads stay structured and bounded", () => {
  const tuple = normalizeDictionaryResult({
    entries: [
      {
        glossaries: [
          {
            dict: "wty-de-en",
            definitionTags: "non-lemma",
            glossary: JSON.stringify([["keine", ["nominative singular masculine"]]]),
          },
        ],
      },
    ],
  });
  const tupleContent = tuple.entries[0].glossaries[0].content[0];
  assert.equal(tupleContent.type, "non-lemma-list");
  assert.deepEqual(tupleContent.rows[0], {
    label: "Form of",
    lemma: "keine",
    text: "nominative singular masculine",
  });

  const plain = normalizeDictionaryResult({
    entries: [
      {
        glossaries: [
          {
            dict: "Kaikki German",
            glossary:
              "a/languages A to Lgenitive/dative/accusative singulara/languages A to Lnominative/genitive/dative/accusative plural definite",
          },
        ],
      },
    ],
  });
  const plainContent = plain.entries[0].glossaries[0].content[0];
  assert.equal(plainContent.type, "non-lemma-list");
  assert.ok(plainContent.rows.some((row) => row.label === "Inflection"));
  assert.ok(plainContent.rows.every((row) => !row.text.includes("a/languages")));

  const grammar = normalizeDictionaryResult({
    entries: [
      {
        glossaries: [
          {
            dict: "wty-en-en",
            glossary: JSON.stringify({
              type: "structured-content",
              content: [
                {
                  tag: "details",
                  data: { content: "details-entry-grammar" },
                  content: [
                    { tag: "summary", content: "Grammar" },
                    { tag: "p", content: "past participle" },
                  ],
                },
              ],
            }),
          },
        ],
      },
    ],
  });
  const grammarNode = grammar.entries[0].glossaries[0].content[0].content[0];
  assert.equal(grammarNode.tag, "details");
  assert.equal(grammarNode.data.content, "details-entry-grammar");
});

test("BrowserHost keeps passive and popup surfaces separate and validates senders", async () => {
  FakeBrowserWindow.reset();
  const ipcMain = new EventEmitter();
  const host = new BrowserHost({
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    preloadPath: "/tmp/iinatan-preload.js",
    overlayUrl: "iinatan://app/overlay.html",
  });
  const requests = [];
  const focusEvents = [];
  host.on("request", (value) => requests.push(value));
  host.on("focus-player", () => focusEvents.push(true));
  host.setSessionContext("session-a", 7);

  try {
    await host.create();
    assert.equal(FakeBrowserWindow.instances.length, 2);
    const [highlight, popup] = FakeBrowserWindow.instances;
    assert.equal(highlight.options.focusable, false);
    assert.equal(popup.options.focusable, true);
    assert.deepEqual(highlight.ignoreMouse, {
      ignore: true,
      options: { forward: true },
    });
    assert.equal(popup.visible, false);

    host.setContentBounds({ x: -20, y: 40, width: 800, height: 600 });
    assert.deepEqual(highlight.bounds, { x: -20, y: 40, width: 800, height: 600 });
    assert.deepEqual(popup.bounds, { x: -20, y: 40, width: 800, height: 600 });

    host.setPlayerForeground(true);
    host.showHighlight({ rects: [{ x: 1, y: 2, width: 3, height: 4 }] });
    assert.equal(highlight.visible, true);
    assert.equal(highlight.focused, false);
    assert.deepEqual(highlight.alwaysOnTop, { flag: true, level: "floating" });
    assert.deepEqual(popup.alwaysOnTop, { flag: true, level: "floating" });
    assert.equal(highlight.webContents.sent.at(-1).channel, "host-event");

    host.showPopup({ position: { x: 10, y: 12 }, result: { entries: [] } });
    assert.equal(host.popupVisible, true);
    assert.equal(popup.visible, false);
    assert.equal(popup.focused, false);
    ipcMain.emit(
      "host-request",
      { sender: popup.webContents },
      { protocol: 1, type: "ready", payload: { surface: "popup" } },
    );
    assert.equal(popup.visible, true);
    assert.equal(popup.focused, true);
    assert.deepEqual(popup.ignoreMouse, { ignore: false, options: undefined });
    assert.deepEqual(popup.alwaysOnTop, { flag: true, level: "floating" });
    assert.deepEqual(highlight.alwaysOnTop, { flag: false, level: "floating" });
    assert.ok(popup.topMoves >= 1);
    assert.deepEqual(highlight.ignoreMouse, { ignore: true, options: undefined });
    assert.equal(highlight.visible, false);
    assert.equal(host.hasSessionFocus(), true);
    requests.splice(0, requests.length);

    ipcMain.emit(
      "host-request",
      {
        sender: highlight.webContents,
      },
      { protocol: 1, type: "pointer-move", payload: { shiftKey: true } },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].surface, "highlight");
    assert.equal(requests[0].message.sessionId, "session-a");
    assert.equal(requests[0].message.geometryGeneration, 7);

    ipcMain.emit(
      "host-request",
      {
        sender: { id: 999 },
      },
      { protocol: 1, type: "pointer-move", payload: { shiftKey: true } },
    );
    assert.equal(requests.length, 1);

    host.setPlayerForeground(false);
    host.hidePopup();
    host.setPassiveInput();
    assert.equal(host.popupVisible, false);
    assert.equal(popup.visible, false);
    assert.deepEqual(popup.ignoreMouse, {
      ignore: true,
      options: { forward: true },
    });
    assert.deepEqual(highlight.ignoreMouse, {
      ignore: true,
      options: { forward: true },
    });
    assert.equal(highlight.visible, true);
    assert.deepEqual(popup.alwaysOnTop, { flag: false, level: "floating" });
    assert.equal(focusEvents.length, 1);
  } finally {
    host.close();
  }
  assert.equal(ipcMain.listenerCount("host-request"), 0);
  assert.equal(
    FakeBrowserWindow.instances.every((window) => window.destroyed),
    true,
  );
});

test("BrowserHost negotiates DOM and native-input capabilities after surface readiness", async () => {
  FakeBrowserWindow.reset();
  const ipcMain = new EventEmitter();
  const host = new BrowserHost({
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    preloadPath: "/tmp/iinatan-preload.js",
    overlayUrl: "iinatan://app/overlay.html",
  });
  host.setSessionContext("session-capabilities", 3);

  try {
    await host.create();
    const [highlight] = FakeBrowserWindow.instances;
    assert.deepEqual(host.surfaceReadiness(), { highlight: false, popup: false });
    ipcMain.emit(
      "host-request",
      { sender: highlight.webContents },
      { protocol: 1, type: "ready", payload: { surface: "highlight" } },
    );
    const message = highlight.webContents.sent.at(-1).message;
    assert.deepEqual(host.surfaceReadiness(), { highlight: true, popup: false });
    assert.equal(message.type, "capabilities");
    assert.deepEqual(message.payload, {
      surface: "highlight",
      host: "electron-browser-window",
      transport: "dom",
      transparent: true,
      offscreen: false,
      bitmapTransport: false,
      inputMode: "passive-forwarded",
      wholeWindowIgnoreMouseEvents: true,
      browserSelection: false,
      pointerCapture: false,
      controller: { source: "browser-gamepad" },
    });
    assert.equal(message.sessionId, "session-capabilities");
    assert.equal(message.geometryGeneration, 3);
  } finally {
    host.close();
  }
});

test("BrowserHost recreates an unexpectedly closed surface without reloading its sibling", async () => {
  FakeBrowserWindow.reset();
  const host = new BrowserHost({
    BrowserWindow: FakeBrowserWindow,
    preloadPath: "/tmp/iinatan-preload.js",
    overlayUrl: "iinatan://app/overlay.html",
  });
  const unexpected = [];
  host.on("surface-closed", (surface) => unexpected.push(surface));
  await host.create();
  const originalHighlight = host.highlightWindow;
  const originalPopup = host.popupWindow;
  originalHighlight.close();
  assert.deepEqual(unexpected, ["highlight"]);
  assert.equal(host.highlightWindow, null);
  await host.create();
  assert.notEqual(host.highlightWindow, originalHighlight);
  assert.equal(host.popupWindow, originalPopup);
  host.close();
  assert.deepEqual(unexpected, ["highlight"]);
});

test("subtitle provider keeps primary and secondary events independent and parses ASS timing", () => {
  assert.equal(parseAssTime("0:01:02.50"), 62500);
  const provider = new SubtitleGeometryProvider({ charWidth: 20 });
  const value = provider.snapshotInput(
    {
      sessionId: "s",
      mediaGeneration: 0,
      geometryGeneration: 1,
      timeMs: 1000,
      osd: { width: 1280, height: 720 },
      primary: { assFull: "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,日本語" },
      secondary: {
        assFull: "Dialogue: 1,0:00:00.00,0:00:02.00,Default,,0,0,0,,English",
      },
    },
    { content: { x: 0, y: 0, width: 1280, height: 720 } },
  );
  assert.equal(value.tracks.length, 2);
  assert.equal(value.tracks[0].role, "primary");
  assert.equal(value.tracks[1].role, "secondary");
  assert.equal(value.source.exact, false);
  const capabilityInexact = provider.snapshotInput(
    {
      sessionId: "s",
      mediaGeneration: 0,
      geometryGeneration: 1,
      timeMs: 1000,
      osd: { width: 1280, height: 720 },
      primary: { assFull: "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,日本語" },
    },
    {
      content: { x: 0, y: 0, width: 1280, height: 720 },
      capability: { exactContent: false },
    },
  );
  assert.equal(capabilityInexact.source.contentExact, false);
  assert.equal(value.tracks[0].events[0].units[0].position, 0);
  assert.equal(
    value.tracks[1].events[0].units[0].position >
      value.tracks[0].events[0].units.at(-1).position,
    true,
  );
  const response = {
    ok: true,
    protocol: 1,
    rendererWidth: 1280,
    rendererHeight: 720,
    units: value.tracks.flatMap((track) =>
      track.events.flatMap((event) =>
        event.units.map((unit) => ({
          position: unit.position,
          rects: [{ x: 10 + unit.position, y: 20, w: 12, h: 20 }],
        })),
      ),
    ),
    diagnostics: { validationEnabled: true },
  };
  const native = provider.applyNativeResponse(value, response);
  assert.equal(native.source.exact, true);
  assert.equal(native.source.contentExact, true);
  assert.equal(native.source.foreground, null);
  assert.deepEqual(native.tracks[0].events[0].units[0].rects, [
    { x: 10, y: 20, width: 12, height: 20 },
  ]);
  const inexactWindow = provider.applyNativeResponse(
    { ...value, source: { ...value.source, contentExact: false } },
    response,
  );
  assert.equal(inexactWindow.source.exact, false);
  assert.equal(inexactWindow.source.contentExact, false);
  assert.match(inexactWindow.source.reason, /content bounds are not authoritative/);
  assert.equal(
    provider.applyNativeResponse(value, {
      ...response,
      units: response.units.slice(1),
    }),
    null,
  );
});

test("native subtitle geometry maps browser graphemes to validated libass units", async () => {
  const provider = new SubtitleGeometryProvider();
  const input = provider.snapshotInput(
    {
      sessionId: "native-session",
      mediaGeneration: 2,
      geometryGeneration: 4,
      timeMs: 1500,
      osd: { width: 1280, height: 720 },
      primary: {
        assFull: "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,A careful reader",
        extradata: "[Script Info]\\nPlayResX: 1280\\nPlayResY: 720\\n",
        source: { path: "/tmp/video.mkv", ffIndex: 0, external: false },
        startMs: 1000,
        endMs: 3000,
        renderer: { storageWidth: 1920, storageHeight: 1080 },
      },
      secondary: {},
    },
    { content: { x: 10, y: 20, width: 1280, height: 720 } },
  );
  let request;
  const service = new NativeSubtitleGeometryService({
    geometryProvider: provider,
    client: {
      async measure(value) {
        request = value;
        return {
          ok: true,
          protocol: 1,
          rendererWidth: 1280,
          rendererHeight: 720,
          units: value.units.map((unit) => ({
            position: unit.position,
            rects: [{ x: 100 + unit.position, y: 200, w: 10, h: 20 }],
          })),
          diagnostics: { validationEnabled: true },
        };
      },
    },
  });
  const exact = await service.apply(input);
  assert.equal(exact.source.exact, true);
  assert.equal(request.cue.observedAss, "A careful reader");
  assert.equal(request.cue.startMs, 1000);
  assert.equal(request.renderer.storageWidth, 1920);
  assert.deepEqual(request.units[0], {
    position: 0,
    displayStartUtf16: 0,
    displayEndUtf16: 1,
  });
  assert.equal(
    exact.tracks[0].events[0].units.find((unit) => unit.text === " ").lookupable,
    false,
  );
  assert.deepEqual(nativeDisplayIndex("{\\i1}日本\\N語"), {
    plain: "日本\n語",
    logicalLength: 4,
    plainToLogical: [0, 1, 2, 3, 4],
    supported: true,
  });
  assert.deepEqual(nativeDisplayIndex("{\\c&H000000FF&}Red {\\alpha&H80&}blue"), {
    plain: "Red blue",
    logicalLength: 8,
    plainToLogical: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    supported: true,
  });
  const unicodeIndex = nativeDisplayIndex("{\\i1}A😀é\\Nline");
  assert.equal(unicodeIndex.supported, true);
  assert.equal(unicodeIndex.plain, "A😀é\nline");
  assert.equal(unicodeIndex.logicalLength, 10);
  assert.deepEqual(unicodeIndex.plainToLogical, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const strippedUnicodeIndex = nativeStrippedDisplayIndex("A😀é\\Nline");
  assert.equal(strippedUnicodeIndex.supported, true);
  assert.equal(strippedUnicodeIndex.logicalLength, 10);
});

test("native geometry preserves ASS event metadata when extradata is empty", () => {
  const request = trackRequest(
    {
      sessionId: "metadata-session",
      mediaGeneration: 0,
      geometryGeneration: 1,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
    },
    {
      id: "metadata-track",
      role: "primary",
      selected: true,
      source: { path: "/tmp/subtitles.ass", ffIndex: 0, external: true },
      assFull: "Dialogue: 2,0:00:01.00,0:00:03.00,Red,,0,0,0,,Metadata event",
      assExtradata: "",
      startMs: 1000,
      endMs: 3000,
      events: [
        {
          rawText: "Metadata event",
          startMs: 1000,
          endMs: 3000,
          layer: 2,
          drawing: false,
          units: [{ position: 0, utf16Range: [0, 8], lookupable: true }],
        },
      ],
      renderer: { overrideMode: "no" },
    },
    2,
  );
  assert.deepEqual(request.cue, {
    timeMs: 2000,
    startMs: 1000,
    endMs: 3000,
    observedAss: "Metadata event",
    observedFormat: "ass",
    assFull: "Dialogue: 2,0:00:01.00,0:00:03.00,Red,,0,0,0,,Metadata event",
    assExtradata: "",
  });
});

test("real-media ASS smoke parses timing, commas, and word UTF-16 ranges", () => {
  assert.equal(assTimestampMilliseconds("0:00:18.17"), 18170);
  assert.deepEqual(
    parseAssDialogue(
      'Dialogue: 0,0:00:18.17,0:00:20.58,Default,Speaker,0,0,0,,With "A, human"',
    ),
    {
      startMs: 18170,
      endMs: 20580,
      style: "Default",
      text: 'With "A, human"',
    },
  );
  assert.deepEqual(wordUnits("With A human", "en"), [
    { position: 0, displayStartUtf16: 0, displayEndUtf16: 4 },
    { position: 5, displayStartUtf16: 5, displayEndUtf16: 6 },
    { position: 7, displayStartUtf16: 7, displayEndUtf16: 12 },
  ]);
  assert.deepEqual(visibleGraphemeUnits("A, B"), [
    { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
    { position: 1, displayStartUtf16: 1, displayEndUtf16: 2 },
    { position: 3, displayStartUtf16: 3, displayEndUtf16: 4 },
  ]);
});

test("native geometry observes simple external SubRip through stock mpv conversion", () => {
  const snapshotInput = {
    sessionId: "subrip-observation-session",
    mediaGeneration: 0,
    geometryGeneration: 0,
    timeMs: 2000,
    osd: { width: 1280, height: 720 },
  };
  const track = {
    id: "subrip-track",
    role: "primary",
    selected: true,
    source: { path: "/tmp/subtitles.srt", ffIndex: 0, external: true },
    assFull: "",
    assExtradata: "",
    startMs: 1000,
    endMs: 4000,
    events: [
      {
        rawText: "Primary 日本語",
        startMs: 1000,
        endMs: 4000,
        layer: 0,
        drawing: false,
        units: [
          { position: 0, utf16Range: [0, 7], lookupable: true },
          { position: 8, utf16Range: [8, 11], lookupable: true },
        ],
      },
    ],
    renderer: { overrideMode: "no" },
  };
  const request = trackRequest(snapshotInput, track, 1);
  assert.equal(request.source.path, "iinatan-observed-subrip");
  assert.equal(request.renderer.useStorageSize, false);
  assert.equal(request.renderer.forceMargins, true);
  assert.match(request.cue.assExtradata, /PlayResX: 512/);
  assert.match(request.cue.assExtradata, /PlayResY: 288/);
  assert.match(request.cue.assExtradata, /Style: Default,sans-serif,15\.2,/);
  assert.equal(
    request.cue.assFull,
    "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Primary 日本語",
  );

  const unsupported = trackRequest(
    snapshotInput,
    {
      ...track,
      events: [
        {
          ...track.events[0],
          rawText: "{\\pos(200,200)}Primary 日本語",
        },
      ],
    },
    2,
  );
  assert.equal(unsupported, null);
});

test("native geometry preserves simultaneous events and explicit line breaks", async () => {
  const assFull = [
    "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,First line\\Nwrap",
    "Dialogue: 1,0:00:01.00,0:00:03.00,Default,,0,0,0,,Second event",
  ].join("\n");
  const provider = new SubtitleGeometryProvider();
  const input = provider.snapshotInput(
    {
      sessionId: "multi-event-session",
      mediaGeneration: 0,
      geometryGeneration: 1,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
      primary: {
        assFull,
        extradata: "[Script Info]\nPlayResX: 1280\nPlayResY: 720\n",
        source: { path: "/tmp/video.mkv", ffIndex: 0, external: false },
        startMs: 1000,
        endMs: 3000,
        renderer: { storageWidth: 1280, storageHeight: 720 },
      },
      secondary: {},
    },
    { content: { x: 0, y: 0, width: 1280, height: 720 }, contentExact: true },
  );
  assert.equal(input.tracks[0].events.length, 2);
  let request;
  const service = new NativeSubtitleGeometryService({
    geometryProvider: provider,
    client: {
      async measure(value) {
        request = value;
        return {
          ok: true,
          protocol: 1,
          rendererWidth: 1280,
          rendererHeight: 720,
          units: value.units.map((unit) => ({
            position: unit.position,
            rects: [{ x: 100 + unit.position, y: 200, w: 10, h: 20 }],
          })),
          diagnostics: { validationEnabled: true },
        };
      },
    },
  });
  const exact = await service.apply(input);
  assert.equal(request.cue.observedAss, "First line\\Nwrap\nSecond event");
  assert.equal(request.cue.assFull, assFull);
  assert.equal(request.units.length, 24);
  assert.deepEqual(request.units[0], {
    position: 0,
    displayStartUtf16: 0,
    displayEndUtf16: 1,
  });
  assert.deepEqual(
    request.units.find((unit) => unit.position === 15),
    {
      position: 15,
      displayStartUtf16: 16,
      displayEndUtf16: 17,
    },
  );
  assert.deepEqual(request.units.at(-1), {
    position: 26,
    displayStartUtf16: 27,
    displayEndUtf16: 28,
  });
  assert.equal(exact.source.exact, true);
  assert.equal(exact.tracks[0].events.length, 2);
  assert.ok(exact.tracks[0].events[1].units.some((unit) => unit.lookupable));
});

test("native geometry keeps repeated subtitle text on distinct event identities", () => {
  const provider = new SubtitleGeometryProvider();
  const input = provider.snapshotInput(
    {
      sessionId: "repeated-event-session",
      mediaGeneration: 0,
      geometryGeneration: 1,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
      primary: {
        assFull: [
          "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Repeated",
          "Dialogue: 1,0:00:01.00,0:00:03.00,Default,,0,0,0,,Repeated",
        ].join("\n"),
      },
      secondary: {},
    },
    { content: { x: 0, y: 0, width: 1280, height: 720 } },
  );
  const events = input.tracks[0].events;
  assert.equal(events.length, 2);
  assert.equal(events[0].sourceText, events[1].sourceText);
  assert.notEqual(events[0].id, events[1].id);
});

test("native geometry preserves valid explicit ASS positioning", () => {
  const request = trackRequest(
    {
      sessionId: "unsupported-position-session",
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
    },
    {
      id: "unsupported-position",
      role: "primary",
      selected: true,
      source: { path: "/tmp/positioned.ass", ffIndex: 0, external: true },
      startMs: 1000,
      endMs: 3000,
      events: [
        {
          rawText: "{\\pos(200,200)}Explicit position",
          startMs: 1000,
          endMs: 3000,
          layer: 0,
          drawing: false,
          units: [
            {
              position: 0,
              utf16Range: [0, 8],
              lookupable: true,
            },
          ],
        },
      ],
      renderer: { overrideMode: "no" },
    },
    1,
  );
  assert.ok(request);
  assert.equal(request.cue.observedAss, "{\\pos(200,200)}Explicit position");
  assert.deepEqual(request.units, [
    { position: 0, displayStartUtf16: 0, displayEndUtf16: 8 },
  ]);
});

test("native geometry preserves valid explicit ASS movement", () => {
  const request = trackRequest(
    {
      sessionId: "moving-position-session",
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
    },
    {
      id: "moving-position",
      role: "primary",
      selected: true,
      source: { path: "/tmp/moving.ass", ffIndex: 0, external: true },
      startMs: 1000,
      endMs: 3000,
      events: [
        {
          rawText: "{\\move(100,200,500,200,200,1800)}Moving position",
          startMs: 1000,
          endMs: 3000,
          layer: 0,
          drawing: false,
          units: [{ position: 0, utf16Range: [0, 15], lookupable: true }],
        },
      ],
      renderer: { overrideMode: "no" },
    },
    1,
  );
  assert.ok(request);
  assert.equal(
    request.cue.observedAss,
    "{\\move(100,200,500,200,200,1800)}Moving position",
  );
  assert.deepEqual(request.units, [
    { position: 0, displayStartUtf16: 0, displayEndUtf16: 15 },
  ]);
});

test("native geometry preserves bounded ASS transforms", () => {
  const request = trackRequest(
    {
      sessionId: "transform-session",
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
    },
    {
      id: "transform-position",
      role: "primary",
      selected: true,
      source: { path: "/tmp/transform.ass", ffIndex: 0, external: true },
      startMs: 1000,
      endMs: 3000,
      events: [
        {
          rawText: "{\\t(0,500,\\fs48\\bord2)}Transform position",
          startMs: 1000,
          endMs: 3000,
          layer: 0,
          drawing: false,
          units: [{ position: 0, utf16Range: [0, 17], lookupable: true }],
        },
      ],
      renderer: { overrideMode: "no" },
    },
    1,
  );
  assert.ok(request);
  assert.equal(request.cue.observedAss, "{\\t(0,500,\\fs48\\bord2)}Transform position");
  assert.deepEqual(request.units, [
    { position: 0, displayStartUtf16: 0, displayEndUtf16: 17 },
  ]);
});

test("native geometry fails closed for malformed or nested ASS transforms", () => {
  const malformed = [
    "{\\t(0,500)}Transform position",
    "{\\t(0,500,late,\\fs48)}Transform position",
    "{\\t(0,500,\\unknown1)}Transform position",
    "{\\t(0,500,\\t(\\fs48))}Transform position",
  ];
  for (const [index, rawText] of malformed.entries()) {
    const request = trackRequest(
      {
        sessionId: "malformed-transform-session",
        mediaGeneration: 0,
        geometryGeneration: 0,
        timeMs: 2000,
        osd: { width: 1280, height: 720 },
      },
      {
        id: `malformed-transform-${index}`,
        role: "primary",
        selected: true,
        source: { path: "/tmp/transform.ass", ffIndex: 0, external: true },
        startMs: 1000,
        endMs: 3000,
        events: [
          {
            rawText,
            startMs: 1000,
            endMs: 3000,
            layer: 0,
            drawing: false,
            units: [{ position: 0, utf16Range: [0, 8], lookupable: true }],
          },
        ],
        renderer: { overrideMode: "no" },
      },
      index + 1,
    );
    assert.equal(request, null, `malformed ASS transform accepted: ${rawText}`);
  }
});

test("native geometry fails closed for malformed explicit ASS positioning", () => {
  const malformed = [
    "{\\pos(200)}Explicit position",
    "{\\pos(200,nan)}Explicit position",
    "{\\move(100,200,500)}Moving position",
    "{\\move(100,200,500,200,late,100)}Moving position",
  ];
  for (const [index, rawText] of malformed.entries()) {
    const request = trackRequest(
      {
        sessionId: "malformed-position-session",
        mediaGeneration: 0,
        geometryGeneration: 0,
        timeMs: 2000,
        osd: { width: 1280, height: 720 },
      },
      {
        id: `malformed-position-${index}`,
        role: "primary",
        selected: true,
        source: { path: "/tmp/positioned.ass", ffIndex: 0, external: true },
        startMs: 1000,
        endMs: 3000,
        events: [
          {
            rawText,
            startMs: 1000,
            endMs: 3000,
            layer: 0,
            drawing: false,
            units: [{ position: 0, utf16Range: [0, 8], lookupable: true }],
          },
        ],
        renderer: { overrideMode: "no" },
      },
      index + 1,
    );
    assert.equal(request, null, `malformed ASS position accepted: ${rawText}`);
  }
});

test("native geometry fails closed for unsupported ASS renderer modes", () => {
  const unsupported = [
    "{\\clip(m 0 0 l 400 300)}Vector clipped event",
    "{\\p1}Drawing event",
    "{\\unknown1}Unknown event",
  ];
  const snapshotInput = {
    sessionId: "unsupported-ass-modes-session",
    mediaGeneration: 0,
    geometryGeneration: 0,
    timeMs: 2000,
    osd: { width: 1280, height: 720 },
  };
  for (const [index, rawText] of unsupported.entries()) {
    const request = trackRequest(
      snapshotInput,
      {
        id: `unsupported-mode-${index}`,
        role: "primary",
        selected: true,
        source: { path: "/tmp/unsupported-modes.ass", ffIndex: 0, external: true },
        startMs: 1000,
        endMs: 3000,
        events: [
          {
            rawText,
            startMs: 1000,
            endMs: 3000,
            layer: 0,
            drawing: false,
            units: [{ position: 0, utf16Range: [0, 4], lookupable: true }],
          },
        ],
        renderer: { overrideMode: "no" },
      },
      index + 1,
    );
    assert.equal(request, null, `unsupported ASS mode accepted: ${rawText}`);
  }
});

test("native geometry synthesizes stock secondary strip styling from mpv options", async () => {
  const provider = new SubtitleGeometryProvider();
  const input = provider.snapshotInput(
    {
      sessionId: "strip-session",
      mediaGeneration: 0,
      geometryGeneration: 1,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
      primary: {},
      secondary: {
        assFull: "Dialogue: 0,0:00:01.00,0:00:03.00,TopGeometry,,0,0,0,,Top 日本語",
        source: { path: "/tmp/secondary.ass", ffIndex: 0, external: true },
        renderer: {
          overrideMode: "strip",
          linePosition: 100,
          storageWidth: 1280,
          storageHeight: 720,
          defaultFamily: "sans-serif",
          fontSize: 38,
          outlineSize: 1.65,
          shadowOffset: 0,
          spacing: 0,
          marginX: 19,
          marginY: 34,
          alignX: "center",
          useMargins: true,
        },
      },
    },
    { content: { x: 0, y: 0, width: 1280, height: 720 } },
  );
  const observation = secondaryStripObservation(
    input.tracks[0],
    { timeMs: 2000, startMs: 1000, endMs: 3000 },
    rendererForTrack(input.tracks[0], input),
  );
  assert.ok(observation);
  assert.equal(observation.source.path, "iinatan-observed-secondary-ass");
  assert.equal(observation.cue.observedAss, "Top 日本語");
  assert.match(observation.cue.assExtradata, /Style: IinatanSecondaryStrip/);
  assert.match(observation.cue.assFull, /Dialogue: 0,0:00:01\.00,0:00:03\.00/);
  assert.equal(observation.renderer.overrideMode, "no");
  assert.equal(
    secondaryStripObservation(
      input.tracks[0],
      { timeMs: 2000, startMs: 1000, endMs: 3000 },
      {
        ...rendererForTrack(input.tracks[0], input),
        alignX: "left",
      },
    ),
    null,
  );
  for (const override of [
    { fontSize: 40 },
    { fontScale: 1.1 },
    { primaryColor: "#FFFF0000" },
  ]) {
    assert.equal(
      secondaryStripObservation(
        input.tracks[0],
        { timeMs: 2000, startMs: 1000, endMs: 3000 },
        { ...rendererForTrack(input.tracks[0], input), ...override },
      ),
      null,
    );
  }
});

test("player bridge exports exact-geometry track and renderer inputs", async () => {
  const values = new Map([
    ["pid", 42],
    ["path", "/tmp/movie.mkv"],
    ["track-list", [{ type: "sub", id: 3, "ff-index": 7 }]],
    ["sid", 3],
    ["osd-dimensions", { w: 1280, h: 720, ml: 4, mr: 5, mt: 6, mb: 7 }],
    ["osd-par", 1.25],
    ["video-out-params", { w: 1920, h: 1080 }],
    ["sub-text/ass-full", "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,猫"],
    ["sub-ass-extradata", "[Script Info]"],
    ["sub-start", 1],
    ["sub-end", 3],
    ["sub-start/full", 1000],
    ["sub-end/full", 3000],
    ["sub-scale", 1.1],
    ["sub-pos", 82],
    ["sub-font", "Noto Sans"],
    ["sub-ass-override", "scale"],
  ]);
  class FakeIpc extends EventEmitter {
    constructor() {
      super();
      this.commands = [];
    }
    async connect() {}
    async getProperty(name) {
      return values.get(name);
    }
    async observeProperty() {}
    async setProperty(name, value) {
      this.commands.push(["set-property", name, value]);
    }
    async command(...args) {
      this.commands.push(args);
    }
    close() {}
  }
  const ipc = new FakeIpc();
  const bridge = new PlayerBridge(
    {
      sessionId: "bridge-session",
      pid: 42,
      ipcEndpoint: "ipc://bridge",
    },
    { ipc },
  );
  await bridge.connect();
  const input = bridge.geometryInput();
  assert.deepEqual(input.primary.source, {
    path: "/tmp/movie.mkv",
    ffIndex: 7,
    external: false,
    autoAssStream: false,
    cacheExcerpt: false,
  });
  assert.equal(input.primary.startMs, 1000);
  assert.equal(input.primary.endMs, 3000);
  assert.equal(input.primary.renderer.storageWidth, 1920);
  assert.equal(input.primary.renderer.pixelAspect, 1.25);
  assert.equal(input.primary.renderer.linePosition, 18);
  assert.equal(input.primary.renderer.overrideMode, "scale");
  assert.equal(input.secondary.renderer.overrideMode, "strip");
  assert.equal(input.secondary.selected, false);
  await bridge.screenshotToFile("/tmp/iinatan-frame.jpg", 90);
  assert.deepEqual(ipc.commands.at(-1), [
    "screenshot-to-file",
    "/tmp/iinatan-frame.jpg",
    "video",
  ]);
  bridge.close();
});

test("player bridge observes before reading already-active subtitle state", async () => {
  const activeSubtitle = "Dialogue: 0,0:00:18.17,0:00:20.58,Default,,0,0,0,,active";
  let subtitleObserved = false;
  class FakeIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      if (name === "pid") return 42;
      if (name === "sub-text/ass-full") return subtitleObserved ? activeSubtitle : null;
      return undefined;
    }
    async observeProperty(name) {
      if (name === "sub-text/ass-full") subtitleObserved = true;
    }
    close() {}
  }
  const bridge = new PlayerBridge(
    { sessionId: "active-subtitle", pid: 42, ipcEndpoint: "ipc://active-subtitle" },
    { ipc: new FakeIpc() },
  );
  await bridge.connect();
  assert.equal(bridge.property("sub-text/ass-full"), activeSubtitle);
  bridge.close();
});

test("player bridge normalizes mpv legacy full timing values from JSON IPC", async () => {
  const values = new Map([
    ["pid", 42],
    ["path", "/tmp/movie.mkv"],
    ["track-list", [{ type: "sub", id: 3, "ff-index": 7 }]],
    ["sid", 3],
    ["osd-dimensions", { w: 640, h: 360 }],
    ["sub-text/ass-full", "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,猫"],
    ["sub-start", 1],
    ["sub-end", 3],
    ["sub-start/full", 1],
    ["sub-end/full", 3],
  ]);
  class FakeIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      return values.get(name);
    }
    async observeProperty() {}
    close() {}
  }
  const bridge = new PlayerBridge(
    { sessionId: "legacy-timing", pid: 42, ipcEndpoint: "ipc://legacy-timing" },
    { ipc: new FakeIpc() },
  );
  await bridge.connect();
  const input = bridge.geometryInput();
  assert.equal(input.primary.startMs, 1000);
  assert.equal(input.primary.endMs, 3000);
  bridge.close();
});

test("player bridge invalidates geometry when subtitle timing controls change", async () => {
  const values = new Map([
    ["pid", 42],
    ["path", "/tmp/movie.mkv"],
    ["osd-dimensions", { w: 640, h: 360 }],
  ]);
  class FakeIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      return values.get(name);
    }
    async observeProperty() {}
    close() {}
  }
  const ipc = new FakeIpc();
  const bridge = new PlayerBridge(
    {
      sessionId: "timing-session",
      pid: 42,
      ipcEndpoint: "ipc://timing",
    },
    { ipc },
  );
  await bridge.connect();
  const initialGeneration = bridge.identity().geometryGeneration;
  ipc.emit("property-change", "sub-delay", 0.25);
  assert.equal(bridge.identity().geometryGeneration, initialGeneration + 1);
  ipc.emit("property-change", "secondary-sub-delay", -0.1);
  assert.equal(bridge.identity().geometryGeneration, initialGeneration + 2);
  ipc.emit("property-change", "sub-speed", 1.05);
  assert.equal(bridge.identity().geometryGeneration, initialGeneration + 3);
  bridge.close();
});

test("player bridge aborts a stalled property bridge instead of swallowing IPC timeouts", async () => {
  class StalledIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      if (name === "pid") return 42;
      const error = new Error("mpv IPC request timed out: get_property");
      error.code = "MPV_IPC_TIMEOUT";
      throw error;
    }
    async observeProperty() {}
    close() {}
  }
  const bridge = new PlayerBridge(
    { sessionId: "stalled-session", pid: 42, ipcEndpoint: "ipc://stalled" },
    { ipc: new StalledIpc() },
  );
  await assert.rejects(() => bridge.connect(), {
    code: "MPV_IPC_TIMEOUT",
    message: "mpv property bridge timed out for time-pos",
    property: "time-pos",
  });
});

test("drawing-only ASS events never become lookupable geometry", () => {
  const provider = new SubtitleGeometryProvider();
  const input = provider.snapshotInput(
    {
      sessionId: "drawing-session",
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs: 500,
      osd: { width: 640, height: 360 },
      primary: {
        assFull:
          "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 0 l 10 10{\\p0}",
      },
      secondary: {},
    },
    { content: { x: 0, y: 0, width: 640, height: 360 } },
  );
  assert.equal(input.tracks[0].events[0].drawing, true);
  assert.deepEqual(input.tracks[0].events[0].units, []);
});

test("dictionary catalog preserves profile order and refuses paths outside its install root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-dictionaries-"));
  const settings = new SettingsStore(path.join(root, "settings.json"));
  const catalog = new DictionaryCatalog({
    settingsStore: settings,
    installRoot: path.join(root, "installed"),
  });
  await catalog.load();
  await catalog.register(
    normalizeDictionaryEntry({
      id: "late",
      title: "Late",
      path: path.join(root, "installed", "late"),
    }),
  );
  await catalog.register(
    normalizeDictionaryEntry({
      id: "early",
      title: "Early",
      path: path.join(root, "installed", "early"),
    }),
  );
  await catalog.reorder(["early", "late"]);
  assert.deepEqual(
    catalog.list().map((entry) => entry.id),
    ["early", "late"],
  );
  await catalog.setEnabled("early", false);
  assert.deepEqual(
    catalog.list().map((entry) => entry.id),
    ["late"],
  );
  assert.equal(
    catalog.list({ includeDisabled: true }).find((entry) => entry.id === "early")
      .enabled,
    false,
  );
  assert.equal(
    within(path.join(root, "installed"), path.join(root, "installed", "late")),
    true,
  );
  assert.equal(within(path.join(root, "installed"), path.join(root, "outside")), false);
  await catalog.register(
    normalizeDictionaryEntry({
      id: "external",
      title: "External",
      path: path.join(root, "outside"),
    }),
  );
  await assert.rejects(
    () => catalog.remove("external", { deleteFiles: true }),
    /managed install root/,
  );
  await catalog.register(
    normalizeDictionaryEntry({
      id: "root-entry",
      title: "Root entry",
      path: path.join(root, "installed"),
    }),
  );
  await assert.rejects(
    () => catalog.remove("root-entry", { deleteFiles: true }),
    /managed directory/,
  );
  const invalidZip = path.join(root, "invalid.zip");
  await fs.writeFile(invalidZip, "not-a-zip");
  await assert.rejects(() => validateDictionaryZip(invalidZip), /end record/);
  const centralOnlyZip = (names, externalAttributes = 0) => {
    const records = names.map((name) => {
      const encoded = Buffer.from(name, "utf8");
      const record = Buffer.alloc(46 + encoded.length);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(encoded.length, 28);
      record.writeUInt32LE(externalAttributes, 38);
      encoded.copy(record, 46);
      return record;
    });
    const central = Buffer.concat(records);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(central.length, 12);
    return Buffer.concat([central, end]);
  };
  const traversalZip = path.join(root, "traversal.zip");
  await fs.writeFile(traversalZip, centralOnlyZip(["../escape.txt"]));
  await assert.rejects(() => validateDictionaryZip(traversalZip), /traversal/);
  const duplicateZip = path.join(root, "duplicate.zip");
  await fs.writeFile(duplicateZip, centralOnlyZip(["same.txt", "same.txt"]));
  await assert.rejects(() => validateDictionaryZip(duplicateZip), /duplicate/);
  const specialZip = path.join(root, "special.zip");
  await fs.writeFile(specialZip, centralOnlyZip(["pipe"], 0o010000 << 16));
  await assert.rejects(() => validateDictionaryZip(specialZip), /unsafe special/);
  await fs.rm(root, { recursive: true, force: true });
});

test("dictionary catalog resolves Hoshi's titled import directory", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-dictionary-import-path-"),
  );
  const output = path.join(root, "requested-id");
  const imported = path.join(output, "Jitendex");
  await fs.mkdir(imported, { recursive: true });
  await fs.writeFile(path.join(imported, "index.json"), "{}\n");
  assert.equal(await resolveImportedDictionaryPath(output), imported);
  await fs.rm(root, { recursive: true, force: true });
});

test("recommended dictionary downloads are HTTPS-only, bounded, and replace managed updates", async () => {
  assert.equal(safeDictionaryDownloadUrl("http://example.com/dict.zip"), "");
  assert.match(
    safeDictionaryDownloadUrl("https://example.com/dict.zip"),
    /^https:\/\//,
  );
  assert.equal(RECOMMENDED_DICTIONARIES.length >= 6, true);
  assert.equal(recommendedDictionariesForLanguage("ja").length >= 1, true);

  const emptyZip = Buffer.alloc(22);
  emptyZip.writeUInt32LE(0x06054b50, 0);
  const responseFor = (body = emptyZip) => ({
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name === "content-length" ? String(body.length) : null),
    },
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true };
            done = true;
            return { done: false, value: body };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-recommended-"));
  const target = path.join(root, "download.zip");
  try {
    await assert.rejects(
      () =>
        downloadFile("https://example.com/dict.zip", "relative.zip", {
          fetch: async () => responseFor(),
        }),
      /absolute/,
    );
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await assert.rejects(
      () =>
        downloadFile("https://example.com/dict.zip", path.join(root, "aborted.zip"), {
          fetch: async () => responseFor(),
          signal: alreadyAborted.signal,
        }),
      { name: "AbortError" },
    );
    const progress = [];
    const downloaded = await downloadFile("https://example.com/dict.zip", target, {
      fetch: async () => responseFor(),
      onProgress: (value) => progress.push(value.bytes),
    });
    assert.equal(downloaded.bytes, emptyZip.length);
    assert.deepEqual(progress, [emptyZip.length]);
    assert.deepEqual(await fs.readFile(target), emptyZip);

    const settings = new SettingsStore(path.join(root, "settings.json"));
    const installRoot = path.join(root, "installed");
    const worker = {
      async importDictionary(_zipPath, dictionaryRoot) {
        const imported = path.join(dictionaryRoot, "Jitendex");
        await fs.mkdir(imported, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(imported, "index.json"), "{}\n", { mode: 0o600 });
        return { title: "Jitendex", revision: "fixture" };
      },
    };
    const catalog = new DictionaryCatalog({
      settingsStore: settings,
      installRoot,
      worker,
    });
    await catalog.load();
    const first = await catalog.downloadRecommended("jitendex-ja-en", {
      fetch: async () => responseFor(),
      maximumBytes: 1024,
    });
    assert.equal(first.id, "jitendex-ja-en");
    assert.equal(
      managedRootForEntry(installRoot, first),
      path.join(installRoot, first.id),
    );
    assert.deepEqual(
      catalog.list().map((entry) => entry.id),
      ["jitendex-ja-en"],
    );
    const second = await catalog.downloadRecommended("jitendex-ja-en", {
      update: true,
      fetch: async () => responseFor(),
      maximumBytes: 1024,
    });
    assert.equal(second.id, first.id);
    assert.equal(catalog.list({ includeDisabled: true }).length, 1);
    assert.equal(await fs.stat(second.path).then((value) => value.isDirectory()), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("language registry emits language-specific spans and conservative candidates", () => {
  const japanese = requestFor("ja", "Hello 日本語", 0, 3);
  assert.equal(japanese, null);
  const japaneseAtCharacter = requestFor("ja", "Hello 日本語", 6, 2);
  assert.equal(japaneseAtCharacter.lookupText, "日本");
  const english = requestFor("en", "They walked", 6, 24);
  assert.equal(english.lookupText, "walked");
  assert.ok(english.candidates.some((candidate) => candidate.text === "walk"));
  const chinese = requestFor("zh", "汉字 test", 0, 2);
  assert.equal(chinese.mode, "prefix");
  assert.equal(chinese.lookupText, "汉字");
});

test("language registry carries deinflection and furigana candidates to lookup", () => {
  const running = requestFor("en", "They are running", 10, 24);
  assert.ok(running.candidates.some((candidate) => candidate.text === "run"));

  const french = requestFor("fr", "L’Homme", 2, 24);
  assert.ok(french.candidates.some((candidate) => candidate.text === "l’homme"));
  assert.ok(french.candidates.some((candidate) => candidate.text === "l'homme"));
  assert.ok(french.candidates.some((candidate) => candidate.text === "homme"));

  const germanSplit = requestFor("de", "Ich stehe schnell auf", 5, 24);
  assert.ok(germanSplit.candidates.some((candidate) => candidate.text === "aufstehen"));
  const germanParticiple = requestFor("de", "Sie ist gegangen", 10, 24);
  assert.ok(
    germanParticiple.candidates.some((candidate) => candidate.text === "gehen"),
  );
  const germanCapitalization = requestFor("de", "Erben", 0, 24);
  assert.equal(germanCapitalization.candidates[0].text, "Erben");
  assert.ok(
    germanCapitalization.candidates.some((candidate) => candidate.text === "erben"),
  );

  const furigana = requestFor("ja", "伺（うか）う", 0, 24);
  assert.equal(furigana.lookupText, "伺う");
});

test("audio and Anki services keep network destinations bounded and parse structured responses", async () => {
  assert.equal(safeAudioUrl("http://example.com/a.mp3"), "");
  assert.equal(safeAudioUrl("https://user:password@example.com/a.mp3"), "");
  assert.equal(
    safeAudioUrl("http://127.0.0.1:5050/a.mp3"),
    "http://127.0.0.1:5050/a.mp3",
  );
  assert.equal(safeAnkiUrl("http://127.0.0.1:8765"), "http://127.0.0.1:8765/");
  assert.equal(safeAnkiUrl("http://example.com"), "");
  assert.equal(safeAnkiUrl("https://user:password@example.com"), "");
  const audio = new AudioSourceService({
    fetch: async () => ({
      ok: true,
      headers: { get: () => "512" },
      text: async () =>
        JSON.stringify({ audioSources: [{ url: "https://audio.example/term.mp3" }] }),
    }),
  });
  const candidates = await audio.resolve({
    term: "猫",
    sources: [{ url: "https://audio.example/lookup?term={term}" }],
  });
  assert.equal(candidates[0].url, "https://audio.example/term.mp3");
  assert.equal(
    await readBoundedText(
      {
        headers: { get: () => "8" },
        body: { getReader: () => ({}) },
        text: async () => "too large",
      },
      4,
    ),
    null,
  );
  let unboundedTextRead = false;
  assert.equal(
    await readBoundedText(
      {
        headers: { get: () => null },
        text: async () => {
          unboundedTextRead = true;
          return "should not be read";
        },
      },
      1024,
    ),
    null,
  );
  assert.equal(unboundedTextRead, false);
  const anki = new AnkiConnectClient({
    fetch: async (_url, init) => {
      const body = JSON.stringify({
        result: JSON.parse(init.body).action === "version" ? 6 : 42,
        error: null,
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(Buffer.byteLength(body, "utf8")) },
        text: async () => body,
      };
    },
  });
  assert.equal(await anki.versionInfo(), 6);
  assert.equal(await anki.addNote({ deckName: "Default" }), 42);
  const oversizedAnki = new AnkiConnectClient({
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(512 * 1024 + 1) },
      body: { getReader: () => ({}) },
      text: async () => "{}",
    }),
  });
  await assert.rejects(
    () => oversizedAnki.versionInfo(),
    /response exceeds the size limit/,
  );
  assert.deepEqual(
    normalizeNote({
      deckName: "D",
      modelName: "M",
      fields: { Front: "猫" },
      tags: ["iinatan"],
    }).fields,
    { Front: "猫" },
  );
});

test("sentence audio bounds subtitle timing and uses an argument-vector encoder", async () => {
  const window = sentenceAudioWindow({
    startMs: 1000,
    endMs: 3000,
    subtitleDelayMs: 250,
    subtitleSpeed: 1.05,
    paddingMs: 250,
  });
  assert.deepEqual(
    {
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: window.durationMs,
    },
    { startMs: 1050, endMs: 3650, durationMs: 2600 },
  );
  const args = buildFfmpegArguments({
    sourcePath: "/tmp/video.mkv",
    outputPath: "/tmp/sentence.mp3",
    window,
    format: "mp3",
    bitrateKbps: 128,
  });
  assert.deepEqual(args.slice(0, 14), [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "1.050",
    "-i",
    "/tmp/video.mkv",
    "-t",
    "2.600",
    "-map",
    "0:a:0",
    "-vn",
  ]);
  assert.equal(args.at(-1), "/tmp/sentence.mp3");
  assert.throws(
    () => buildFfmpegArguments({ sourcePath: "-", outputPath: "/tmp/out.mp3" }),
    /absolute path or URL/,
  );

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-sentence-audio-"));
  try {
    const outputPath = path.join(root, "nested", "sentence.opus");
    const calls = [];
    const service = new SentenceAudioService({
      executable: "ffmpeg-test",
      execFileProcess: (_executable, callArgs, options, callback) => {
        calls.push({ callArgs, options });
        fs.writeFile(outputPath, Buffer.from("audio")).then(() =>
          callback(null, "", ""),
        );
      },
    });
    const captured = await service.capture({
      sourcePath: "/tmp/video.mkv",
      startMs: 1000,
      endMs: 2000,
      format: "opus",
      bitrateKbps: 64,
      outputPath,
    });
    assert.equal(captured.format, "opus");
    assert.equal(captured.bytes, 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].callArgs.at(-1), outputPath);
    assert.equal(calls[0].options.windowsHide, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Anki card templates stay host-rendered and escape dictionary context", async () => {
  assert.deepEqual(normalizeTemplates('{"Front":"{expression}"}'), {
    Front: "{expression}",
  });
  assert.equal(
    renderTemplate("{popup-selection-text} · {missing}", {
      "popup-selection-text": "<selected>",
    }),
    "&lt;selected&gt; · ",
  );
  assert.equal(
    renderTemplate(
      "{audio} {screenshot}",
      {},
      {
        wordAudio: "word.mp3",
        screenshot: "shot.jpg",
      },
    ),
    '[sound:word.mp3] <img src="shot.jpg">',
  );
  const note = buildAnkiNote(
    {
      deckName: "Study",
      modelName: "Basic",
      fieldTemplatesJson: JSON.stringify({
        Front: "{expression} / {reading}",
        Back: "{glossary-plain}<br>{sentence}",
      }),
      tags: "iinatan japanese,beginner",
      duplicateCheck: true,
    },
    {
      entry: {
        headword: "猫",
        reading: "ねこ",
        tags: ["noun"],
        glossaries: [
          {
            dictionary: "JMdict",
            content: [{ type: "paragraph", text: "cat <pet>" }],
          },
        ],
      },
      sentence: "猫を見る",
      selectedText: "猫",
    },
  );
  assert.deepEqual(note.tags, ["iinatan", "japanese", "beginner"]);
  assert.equal(note.fields.Front, "猫 / ねこ");
  assert.equal(note.fields.Back, "JMdict\ncat &lt;pet&gt;<br>猫を見る");
  assert.equal(note.options.allowDuplicate, false);
  assert.deepEqual(
    mediaRequirements({ Front: "{expression}", Back: "{audio}{screenshot}" }),
    { screenshot: true, sentenceAudio: false, wordAudio: true },
  );
  const media = await fetchMedia("https://audio.example/cat.mp3", {
    fetch: async () => ({
      ok: true,
      headers: { get: (name) => (name === "content-type" ? "audio/mpeg" : "3") },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }),
  });
  assert.match(media.filename, /^iinatan-/);
});

test("Hoshi-shaped metadata and structured glossary content survive normalization", () => {
  const structuredGlossary = JSON.stringify({
    type: "structured-content",
    content: [
      {
        tag: "div",
        data: { "sc-content": "example" },
        content: [
          "cat",
          { tag: "a", href: "https://example.com/source", content: " source" },
          { tag: "script", content: "ignored" },
        ],
      },
    ],
  });
  const normalized = normalizeDictionaryResult({
    lookupString: "猫",
    results: [
      {
        matched: "猫を",
        deinflected: "猫",
        term: {
          expression: "猫",
          reading: "ねこ",
          glossaries: [
            {
              dict: "Jitendex",
              glossary: structuredGlossary,
              definitionTags: "noun",
              termTags: "common",
            },
          ],
          frequencies: [
            { dict: "Frequency", frequencies: [{ value: 12, displayValue: "12" }] },
          ],
          pitches: [{ positions: [2], transcriptions: ["LHH"] }],
        },
      },
    ],
  });
  const entry = normalized.entries[0];
  assert.equal(entry.matched, "猫を");
  assert.deepEqual(entry.tags, ["noun", "common"]);
  assert.deepEqual(entry.frequency, ["12"]);
  assert.equal(entry.glossaries[0].content[0].type, "structured-content");
  assert.equal(entry.glossaries[0].content[0].content[0].tag, "div");
  assert.equal(
    entry.glossaries[0].content[0].content[0].content[1].href,
    "https://example.com/source",
  );
  assert.equal(entry.glossaries[0].content[0].content[0].content.length, 2);

  const context = contextForEntry({
    entry,
    sentence: "猫を見る",
    selectedText: "猫",
    timestamp: 65,
  });
  assert.equal(context["frequency-harmonic-rank"], "12");
  assert.equal(context["pitch-accent-positions"], "2");
  assert.equal(context["pitch-accent-categories"], "nakadaka");
  assert.equal(context["phonetic-transcriptions"], "LHH");
  assert.equal(context.timestamp, "1:05");
  const note = buildAnkiNote(
    {
      deckName: "Study",
      modelName: "Basic",
      fieldTemplatesJson: JSON.stringify({
        Front: "{furigana}|{frequency-harmonic-rank}",
        Back: "{selected-glossary}|{pitch-accent-categories}|{phonetic-transcriptions}",
      }),
    },
    { entry, sentence: "猫を見る", selectedText: "猫" },
  );
  assert.equal(note.fields.Front, "<ruby>猫<rt>ねこ</rt></ruby>|12");
  assert.match(note.fields.Back, /cat/);
  assert.match(note.fields.Back, /nakadaka\|LHH/);
});

test("Hoshi dictionary import uses the validated backend command contract", async () => {
  let invocation = null;
  const worker = new HoshiWorker({
    executable: "fake-hoshi",
    root: "/tmp/iinatan-hoshi-import-test",
    execFileProcess(executable, args, options, callback) {
      invocation = { executable, args, options };
      callback(null, '{"ok":true,"title":"fixture"}\n', "");
    },
  });
  await assert.rejects(
    () => worker.importDictionary("relative.zip", "/tmp/dictionaries/fixture"),
    /absolute/,
  );
  const result = await worker.importDictionary(
    "/tmp/fixture.zip",
    "/tmp/dictionaries/fixture",
    { lowRam: false },
  );
  assert.equal(result.title, "fixture");
  assert.deepEqual(invocation, {
    executable: "fake-hoshi",
    args: ["import", "/tmp/fixture.zip", "/tmp/dictionaries/fixture", "--normal-ram"],
    options: {
      timeout: 1800000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  });
});

test("Hoshi worker adapter publishes a request only after the body is written", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-hoshi-"));
  const spawnProcess = (_executable, args) => {
    const workerRoot = args[1];
    const processState = {
      exitCode: null,
      killed: false,
      kill() {
        this.killed = true;
        this.exitCode = 137;
      },
    };
    (async () => {
      await fs.mkdir(path.join(workerRoot, "state"), { recursive: true });
      await fs.writeFile(
        path.join(workerRoot, "state", "ready.json"),
        JSON.stringify({ ok: true, protocol: 1 }),
      );
      while (processState.exitCode === null && !processState.killed) {
        if (
          await fs
            .stat(path.join(workerRoot, "stop"))
            .then(() => true)
            .catch(() => false)
        ) {
          processState.exitCode = 0;
          break;
        }
        const markers = await fs
          .readdir(path.join(workerRoot, "queue"))
          .catch(() => []);
        for (const marker of markers.filter((value) => value.endsWith(".json"))) {
          const id = marker.slice(0, -5);
          const requestPath = path.join(workerRoot, "queue", `${id}.request`);
          const responsePath = path.join(workerRoot, "responses", `${id}.json`);
          if (
            await fs
              .stat(requestPath)
              .then(() => true)
              .catch(() => false)
          )
            await fs.writeFile(
              responsePath,
              JSON.stringify({
                ok: true,
                requestId: id,
                results: [{ headword: "猫" }],
              }),
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();
    return processState;
  };
  const worker = new HoshiWorker({
    executable: "fake-hoshi",
    root,
    timeoutMs: 1000,
    pollMs: 2,
    spawnProcess,
  });
  await worker.configure({
    language: "ja",
    dictionaries: [path.join(root, "dict")],
    fingerprint: "test",
  });
  await fs.writeFile(
    path.join(root, "responses", "lookup-1.json"),
    JSON.stringify({
      ok: true,
      requestId: "lookup-1",
      results: [{ headword: "stale" }],
    }),
  );
  const result = await worker.lookup({ requestId: "lookup-1", text: "猫" });
  assert.equal(result.results[0].headword, "猫");
  await worker.stop();
  await fs.rm(root, { recursive: true, force: true });
});

test("Hoshi worker forwards fresh native HID state when enabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-hoshi-controller-"));
  const spawnProcess = (_executable, args) => {
    const workerRoot = args[1];
    const processState = {
      exitCode: null,
      killed: false,
      kill() {
        this.killed = true;
        this.exitCode = 137;
      },
    };
    (async () => {
      await fs.mkdir(path.join(workerRoot, "state"), { recursive: true });
      await fs.writeFile(
        path.join(workerRoot, "state", "ready.json"),
        JSON.stringify({
          ok: true,
          protocol: 1,
          controller: { protocol: 1, source: "native-hid", enabled: true },
        }),
      );
      await fs.writeFile(
        path.join(workerRoot, "state", "controller.json"),
        JSON.stringify({
          protocol: 1,
          sequence: 1,
          updatedAt: Date.now(),
          source: "native-hid",
          connected: true,
          id: "test-native-pad",
          buttons: { primary: true },
          axes: { leftY: 0, rightX: 0, rightY: 0 },
        }),
      );
      while (processState.exitCode === null && !processState.killed) {
        if (
          await fs
            .stat(path.join(workerRoot, "stop"))
            .then(() => true)
            .catch(() => false)
        ) {
          processState.exitCode = 0;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();
    return processState;
  };
  const worker = new HoshiWorker({
    executable: "fake-hoshi",
    root,
    timeoutMs: 1000,
    pollMs: 2,
    controllerPollMs: 16,
    nativeControllerSupported: true,
    spawnProcess,
  });
  const statePromise = new Promise((resolve) =>
    worker.once("controller-state", resolve),
  );
  await worker.configure({
    language: "ja",
    dictionaries: [path.join(root, "dict")],
    fingerprint: "controller-test",
    controllerEnabled: true,
  });
  const state = await Promise.race([
    statePromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("controller state timeout")), 500),
    ),
  ]);
  assert.equal(worker.nativeControllerAvailable, true);
  assert.equal(state.connected, true);
  assert.equal(state.buttons.primary, true);
  await worker.stop();
  await fs.rm(root, { recursive: true, force: true });
});

test("Hoshi worker keeps native HID polling alive across stale state", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-hoshi-controller-recovery-"),
  );
  const controllerPath = path.join(root, "state", "controller.json");
  const events = [];
  const spawnProcess = (_executable, args) => {
    const workerRoot = args[1];
    const processState = {
      exitCode: null,
      killed: false,
      kill() {
        this.killed = true;
        this.exitCode = 137;
      },
    };
    (async () => {
      await fs.mkdir(path.join(workerRoot, "state"), { recursive: true });
      await fs.writeFile(
        path.join(workerRoot, "state", "ready.json"),
        JSON.stringify({
          ok: true,
          protocol: 1,
          controller: { protocol: 1, source: "native-hid", enabled: true },
        }),
      );
      await fs.writeFile(
        controllerPath,
        JSON.stringify({
          protocol: 1,
          sequence: 1,
          updatedAt: Date.now() - 2000,
          source: "native-hid",
          connected: true,
          id: "stale-native-pad",
          buttons: { primary: true },
          axes: { leftY: 0, rightX: 0, rightY: 0 },
        }),
      );
      while (processState.exitCode === null && !processState.killed) {
        if (
          await fs
            .stat(path.join(workerRoot, "stop"))
            .then(() => true)
            .catch(() => false)
        ) {
          processState.exitCode = 0;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();
    return processState;
  };
  const worker = new HoshiWorker({
    executable: "fake-hoshi",
    root,
    timeoutMs: 1000,
    pollMs: 2,
    controllerPollMs: 16,
    nativeControllerSupported: true,
    spawnProcess,
  });
  worker.on("controller-state", (state) => events.push(state));
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("controller state recovery timed out");
  };
  try {
    await worker.configure({
      language: "ja",
      dictionaries: [path.join(root, "dict")],
      fingerprint: "controller-recovery-test",
      controllerEnabled: true,
    });
    await waitFor(() => events.some((state) => state.connected === false));
    assert.equal(worker.nativeControllerAvailable, true);
    assert.notEqual(worker.controllerStateTimer, null);
    await fs.writeFile(
      controllerPath,
      JSON.stringify({
        protocol: 1,
        sequence: 2,
        updatedAt: Date.now(),
        source: "native-hid",
        connected: true,
        id: "reconnected-native-pad",
        buttons: { primary: true },
        axes: { leftY: 0, rightX: 0, rightY: 0 },
      }),
    );
    await waitFor(() =>
      events.some(
        (state) => state.connected === true && state.id === "reconnected-native-pad",
      ),
    );
  } finally {
    await worker.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Hoshi dictionary service queries and merges bounded language candidates", async () => {
  const calls = [];
  const worker = {
    active: new Map(),
    async lookup(request) {
      calls.push(request);
      if (request.text === "walked")
        return {
          ok: true,
          results: [
            {
              matched: "walked",
              deinflected: "walked",
              term: {
                expression: "walked",
                reading: "",
                rules: "non-lemma",
                glossaries: [],
              },
            },
          ],
        };
      return {
        ok: true,
        results: [
          {
            matched: "walk",
            deinflected: "walk",
            term: {
              expression: "walk",
              reading: "",
              rules: "v",
              glossaries: [],
            },
          },
        ],
      };
    },
    async cancel(requestId) {
      calls.push({ cancel: requestId });
    },
  };
  const service = new HoshiDictionaryService({ worker, maxResults: 3 });
  const result = await service.lookup({
    requestId: "lookup-1",
    text: "walked",
    mode: "exact",
    candidates: [
      { text: "walked", source: "surface" },
      { text: "walk", source: "deinflection" },
      { text: "walk", source: "duplicate" },
    ],
  });
  assert.deepEqual(
    calls.filter((value) => value.text).map((value) => value.text),
    ["walked", "walk"],
  );
  assert.deepEqual(
    calls.filter((value) => value.text).map((value) => value.mode),
    ["exact", "exact"],
  );
  assert.deepEqual(
    result.results.map((value) => value.term.expression),
    ["walked", "walk"],
  );
  assert.equal(result.lookupString, "walked");
  assert.equal(result.candidateUsed.text, "walked");
  assert.equal(result.lookupCandidates.length, 2);
});

test("Hoshi dictionary service follows bounded non-lemma references", async () => {
  const calls = [];
  const worker = {
    active: new Map(),
    async lookup(request) {
      calls.push(request);
      if (request.text === "walked")
        return {
          ok: true,
          results: [
            {
              matched: "walked",
              deinflected: "walked",
              term: {
                expression: "walked",
                reading: "",
                rules: "non-lemma",
                glossaries: [
                  {
                    definitionTags: "non-lemma",
                    termTags: "",
                    glossary: JSON.stringify([["walk", ["past participle"]]]),
                  },
                ],
              },
            },
          ],
        };
      return {
        ok: true,
        results: [
          {
            matched: "walk",
            deinflected: "walk",
            term: {
              expression: "walk",
              reading: "",
              rules: "v",
              glossaries: [
                {
                  definitionTags: "",
                  termTags: "",
                  glossary: "to walk",
                },
              ],
            },
          },
        ],
      };
    },
    async cancel() {},
  };
  const service = new HoshiDictionaryService({ worker, maxResults: 3 });
  const result = await service.lookup({
    requestId: "lookup/non-lemma",
    text: "walked",
    mode: "exact",
    candidates: [{ text: "walked", source: "surface" }],
  });
  assert.deepEqual(
    calls.map((value) => value.text),
    ["walked", "walk"],
  );
  assert.ok(calls.every((value) => /^[A-Za-z0-9_-]+$/.test(value.requestId)));
  assert.equal(result.candidateUsed.text, "walk");
  assert.deepEqual(
    result.results.map((value) => value.term.expression),
    ["walk"],
  );
  assert.equal(result.lookupCandidates.at(-1).source, "non-lemma-reference");
});

test("Hoshi dictionary service preserves a non-lemma fallback when no lemma exists", async () => {
  const worker = {
    active: new Map(),
    async lookup() {
      return {
        ok: true,
        results: [
          {
            matched: "walked",
            term: {
              expression: "walked",
              glossaries: [
                {
                  definitionTags: "non-lemma",
                  glossary: JSON.stringify([["walk", ["past participle"]]]),
                },
              ],
            },
          },
        ],
      };
    },
    async cancel() {},
  };
  const service = new HoshiDictionaryService({ worker, maxResults: 3 });
  const result = await service.lookup({
    requestId: "lookup-fallback",
    text: "walked",
    mode: "exact",
    candidates: [{ text: "walked", source: "surface" }],
  });
  assert.equal(result.candidateUsed.text, "walked");
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].term.expression, "walked");
});

test("dictionary service distinguishes a configured lookup timeout from cancellation", async () => {
  const service = new DictionaryService({
    timeoutMs: 250,
    handler: async () => new Promise(() => {}),
  });
  await assert.rejects(
    service.lookup({ requestId: "lookup-timeout", text: "猫" }),
    (error) =>
      error.name === "TimeoutError" && error.code === "DICTIONARY_LOOKUP_TIMEOUT",
  );
  assert.equal(service.active.size, 0);
});

test("Hoshi dictionary service cancels a backend request when its lookup deadline expires", async () => {
  const cancelled = [];
  const service = new HoshiDictionaryService({
    timeoutMs: 250,
    worker: {
      active: new Map(),
      async lookup() {
        return new Promise(() => {});
      },
      async cancel(requestId) {
        cancelled.push(requestId);
      },
    },
  });
  await assert.rejects(
    service.lookup({ requestId: "lookup-hoshi-timeout", text: "猫" }),
    (error) =>
      error.name === "TimeoutError" && error.code === "DICTIONARY_LOOKUP_TIMEOUT",
  );
  assert.ok(cancelled.includes("lookup-hoshi-timeout"));
});

test("independent geometry oracle rejects missing or mismatched unit boxes", () => {
  assert.equal(
    iou({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }),
    1,
  );
  const result = compareGeometryFixture({
    threshold: 0.98,
    cases: [
      {
        id: "exact",
        predicted: [{ x: 0, y: 0, width: 10, height: 10 }],
        observed: [{ x: 0, y: 0, width: 10, height: 10 }],
      },
      {
        id: "missing",
        predicted: [{ x: 0, y: 0, width: 10, height: 10 }],
        observed: [],
      },
    ],
  });
  assert.equal(result.pass, false);
  assert.equal(result.cases[0].pass, true);
  assert.equal(result.cases[1].pass, false);
});

test("independent geometry oracle reports physical edge error", () => {
  assert.equal(
    edgeError(
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 11, y: 19, width: 31, height: 39 },
    ),
    2,
  );
  assert.equal(
    edgeError({ x: 10, y: 20, w: 30, h: 40 }, { x: 10, y: 20, width: 30, height: 40 }),
    0,
  );
  assert.equal(edgeError(null, { x: 0, y: 0, width: 1, height: 1 }), Infinity);
});

test("native geometry client sends the reviewed ASS geometry schema", async () => {
  let request;
  const client = new NativeGeometryClient({
    lookup: async (value) => {
      request = value;
      return { ok: true, protocol: 1, units: [] };
    },
  });
  assert.deepEqual(
    geometryRequest({
      requestId: "g-1",
      source: { path: "/tmp/video.mkv", ffIndex: 0 },
      cue: {
        timeMs: 1000,
        startMs: 0,
        endMs: 2000,
        observedAss: "{\\an8}猫",
        observedFormat: "ass",
      },
      units: [{ position: 4, utf16Start: 0, utf16End: 1 }],
      renderer: { width: 1280, height: 720 },
    }).units[0],
    { position: 4, displayStartUtf16: 0, displayEndUtf16: 1 },
  );
  await client.measure({
    requestId: "g-1",
    source: { path: "/tmp/video.mkv", ffIndex: 0 },
    cue: {
      timeMs: 1000,
      startMs: 0,
      endMs: 2000,
      observedAss: "猫",
      observedFormat: "ass",
    },
    units: [{ position: 4, utf16Start: 0, utf16End: 1 }],
    renderer: { width: 1280, height: 720 },
  });
  assert.equal(request.type, "ass-geometry");
  assert.equal(request.renderer.overrideMode, "yes");
  assert.equal(request.units[0].position, 4);
});

test("native window adapter preserves foreground state and keeps focus behind an explicit boundary", async () => {
  const calls = [];
  const adapter = new NativeWindowAdapter({
    platform: "win32",
    probe: async () => ({
      ok: true,
      content: { x: 1, y: 2, width: 800, height: 450 },
      isForeground: false,
    }),
    activate: async (descriptor) => {
      calls.push(descriptor.sessionId);
      return { ok: true, activated: true };
    },
  });
  const descriptor = {
    sessionId: "s-1",
    pid: 42,
    windowId: "hwnd",
    ipcEndpoint: "ipc://test",
  };
  const geometry = await adapter.read(descriptor);
  assert.equal(geometry.isForeground, false);
  assert.deepEqual(await adapter.focus(descriptor), { ok: true, activated: true });
  assert.deepEqual(calls, ["s-1"]);
});

test("native window adapter converts Windows physical bounds into Electron DIP bounds", async () => {
  const adapter = new NativeWindowAdapter({
    platform: "win32",
    screen: {
      screenToDipPoint: ({ x, y }) => ({ x: x / 1.5, y: y / 1.5 }),
    },
    probe: async () => ({
      ok: true,
      coordinateSpace: "desktop-physical",
      desktopScale: 1.5,
      content: { x: 150, y: 300, width: 1200, height: 600 },
      isForeground: true,
    }),
  });
  const geometry = await adapter.read({
    sessionId: "s-physical",
    pid: 43,
    windowId: "hwnd",
    ipcEndpoint: "ipc://physical",
  });
  assert.deepEqual(geometry.content, { x: 100, y: 200, width: 800, height: 400 });
  assert.equal(geometry.coordinateSpace, "desktop-logical");
  assert.equal(geometry.desktopScale, 1.5);
});

test("native window adapter refuses Windows physical bounds without DIP conversion", async () => {
  const adapter = new NativeWindowAdapter({
    platform: "win32",
    probe: async () => ({
      ok: true,
      coordinateSpace: "desktop-physical",
      content: { x: 0, y: 0, width: 800, height: 450 },
    }),
  });
  await assert.rejects(
    () =>
      adapter.read({
        sessionId: "s-physical",
        pid: 43,
        ipcEndpoint: "ipc://physical",
      }),
    (error) => error.code === "WINDOW_COORDINATE_CONVERSION_UNAVAILABLE",
  );
});

test("native window adapter converts X11 physical bounds through the same DIP contract", async () => {
  const adapter = new NativeWindowAdapter({
    platform: "linux",
    sessionType: "x11",
    screen: {
      screenToDipPoint: ({ x, y }) => ({ x: x / 2, y: y / 2 }),
    },
    probe: async () => ({
      ok: true,
      backend: "linux-x11",
      coordinateSpace: "desktop-physical",
      content: { x: -400, y: 100, width: 1600, height: 900 },
      contentExact: false,
      isForeground: true,
    }),
  });
  const geometry = await adapter.read({
    sessionId: "s-x11",
    pid: 44,
    windowId: "123",
    ipcEndpoint: "ipc://x11",
  });
  assert.deepEqual(geometry.content, { x: -200, y: 50, width: 800, height: 450 });
  assert.equal(geometry.coordinateSpace, "desktop-logical");
  assert.equal(geometry.contentExact, false);
});

test("native window adapter promotes only matching in-process macOS content geometry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-window-shim-"));
  try {
    const descriptor = {
      sessionId: "s-1",
      pid: 42,
      windowId: "99",
      ipcEndpoint: "ipc://test",
    };
    await fs.writeFile(
      path.join(root, "42.geometry.json"),
      JSON.stringify({
        protocol: 1,
        pid: 42,
        windowId: 99,
        content: { x: 11, y: 22, width: 800, height: 450 },
        contentSource: "appkit-content-view",
        contentExact: true,
        isForeground: true,
        fullscreenObserved: true,
        fullscreenEvidence: "appkit-window-style-mask",
      }),
      { mode: 0o600 },
    );
    const adapter = new NativeWindowAdapter({
      platform: "darwin",
      sessionDirectory: root,
      probe: async () => ({
        ok: true,
        windowId: 99,
        content: { x: 1, y: 2, width: 800, height: 450 },
        contentSource: "window-frame",
        contentExact: false,
        isForeground: false,
      }),
    });
    const geometry = await adapter.read(descriptor);
    assert.deepEqual(geometry.content, { x: 11, y: 22, width: 800, height: 450 });
    assert.equal(geometry.contentExact, true);
    assert.equal(geometry.contentSource, "appkit-content-view");
    assert.equal(geometry.inProcessShim, true);
    assert.equal(geometry.fullscreenObserved, true);
    assert.equal(geometry.fullscreenEvidence, "appkit-window-style-mask");
    assert.equal(geometry.capability.backend, "macos-appkit-content-shim");
    assert.equal(geometry.capability.exactContent, true);
    assert.equal(geometry.capability.needsPlayerShimForWindowed, false);

    await fs.writeFile(
      path.join(root, "42.geometry.json"),
      JSON.stringify({
        protocol: 1,
        pid: 42,
        windowId: 100,
        content: { x: 11, y: 22, width: 800, height: 450 },
        contentSource: "appkit-content-view",
        contentExact: true,
      }),
      { mode: 0o600 },
    );
    const stale = await adapter.read(descriptor);
    assert.equal(stale.contentExact, false);
    assert.equal(stale.inProcessShim, undefined);
    assert.equal(stale.capability.backend, "macos-window-list");
    assert.equal(stale.capability.exactContent, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("native window adapter targets a macOS sidecar window before the unqualified probe", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-window-sidecar-target-"),
  );
  try {
    const calls = [];
    const adapter = new NativeWindowAdapter({
      platform: "darwin",
      sessionDirectory: root,
      probe: async (descriptor) => {
        calls.push(descriptor.windowId || null);
        return descriptor.windowId === "99"
          ? {
              ok: true,
              windowId: 99,
              content: { x: 0, y: 0, width: 1470, height: 923 },
              contentSource: "window-frame",
              contentExact: false,
              isForeground: true,
            }
          : {
              ok: true,
              windowId: 88,
              content: { x: 0, y: 33, width: 1470, height: 32 },
              contentSource: "window-frame",
              contentExact: false,
              isForeground: true,
            };
      },
    });
    await fs.writeFile(
      path.join(root, "42.geometry.json"),
      JSON.stringify({
        protocol: 1,
        pid: 42,
        windowId: 99,
        content: { x: 0, y: 33, width: 1470, height: 923 },
        contentSource: "appkit-content-view",
        contentExact: true,
        isForeground: true,
        fullscreenObserved: true,
      }),
      { mode: 0o600 },
    );

    const geometry = await adapter.read({
      sessionId: "s-fullscreen",
      pid: 42,
      ipcEndpoint: "ipc://fullscreen",
    });
    assert.deepEqual(calls, ["99"]);
    assert.deepEqual(geometry.content, { x: 0, y: 33, width: 1470, height: 923 });
    assert.equal(geometry.contentExact, true);
    assert.equal(geometry.inProcessShim, true);
    assert.equal(geometry.fullscreenObserved, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("native window adapter keeps an identity-checked macOS sidecar during probe gaps", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-window-sidecar-fallback-"),
  );
  try {
    await fs.writeFile(
      path.join(root, "42.geometry.json"),
      JSON.stringify({
        protocol: 1,
        pid: 42,
        windowId: 99,
        content: { x: 0, y: 33, width: 1470, height: 923 },
        contentSource: "appkit-content-view",
        contentExact: true,
        isForeground: true,
        fullscreenObserved: true,
      }),
      { mode: 0o600 },
    );
    const adapter = new NativeWindowAdapter({
      platform: "darwin",
      sessionDirectory: root,
      probe: async () => {
        throw new Error("window-not-found");
      },
    });

    const geometry = await adapter.read({
      sessionId: "s-fullscreen",
      pid: 42,
      ipcEndpoint: "ipc://fullscreen",
    });
    assert.deepEqual(geometry.content, { x: 0, y: 33, width: 1470, height: 923 });
    assert.equal(geometry.contentExact, true);
    assert.equal(geometry.inProcessShim, true);
    assert.equal(geometry.windowProbeFallback, true);
    assert.equal(geometry.capability.backend, "macos-appkit-content-shim");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("native window adapter rejects malformed probe geometry before it reaches transforms", async () => {
  const adapter = new NativeWindowAdapter({
    platform: "win32",
    probe: async () => ({ ok: true, content: { x: 0, y: 0, width: 0, height: 450 } }),
  });
  await assert.rejects(
    () => adapter.read({ sessionId: "s-1", pid: 42, ipcEndpoint: "ipc://test" }),
    (error) => error.code === "INVALID_PLAYER_WINDOW_GEOMETRY",
  );
});

test("native window capability rejects generic Wayland without probing", () => {
  const wayland = new NativeWindowAdapter({
    platform: "linux",
    sessionType: "wayland",
  });
  assert.deepEqual(wayland.capability(), {
    backend: "wayland",
    supported: false,
    reason:
      "generic Wayland does not provide a universal cross-client exact attachment mechanism",
  });
  const x11 = new NativeWindowAdapter({ platform: "linux", sessionType: "x11" });
  assert.equal(x11.capability().backend, "x11-or-xwayland");
  assert.equal(x11.capability().supported, undefined);
});
