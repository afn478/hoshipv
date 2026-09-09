"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  ApplicationController,
  coalesceHighlightRects,
  controllerTargetForDirection,
  controllerTargetsForSnapshot,
  flattenSubtitleText,
  lookupGeometryForHit,
  lookupHighlightRects,
  subtitleLookupText,
} = require("../../src/player/application-controller");
const { CoordinateMapper } = require("../../src/geometry/coordinate-mapper");
const { createGeometrySnapshot, hitTest } = require("../../src/geometry/snapshot");
const { DictionaryService } = require("../../src/services/dictionary-service");
const fs = require("node:fs/promises");

class FakeBrowserHost extends EventEmitter {
  constructor() {
    super();
    this.popupVisible = false;
    this.sessionFocused = false;
    this.highlights = [];
    this.popups = [];
    this.closeCount = 0;
    this.active = false;
    this.createCount = 0;
    this.interactiveInputCount = 0;
  }

  async create() {
    this.active = true;
    this.createCount++;
  }
  setSessionContext() {}
  setContentBounds(value) {
    this.contentBounds = value;
  }
  send(surface, type, payload) {
    this.events = [...(this.events || []), { surface, type, payload }];
  }
  showHighlight(payload) {
    this.highlights.push(payload);
  }
  hideHighlight() {
    this.highlightHidden = true;
  }
  showPopup(payload) {
    this.popupVisible = true;
    this.popups.push(payload);
  }
  hidePopup() {
    this.popupVisible = false;
    this.popupHidden = true;
  }
  setPassiveInput() {}
  setInteractiveInput() {
    this.interactiveInputCount++;
  }
  hasSessionFocus() {
    return this.sessionFocused;
  }
  close() {
    if (this.active) this.closeCount++;
    this.active = false;
    this.popupVisible = false;
  }
}

test("flattened subtitle lookup text preserves UTF-16 hit offsets", () => {
  const raw = "猫\n犬  鳥";
  assert.equal(flattenSubtitleText(raw), "猫 犬 鳥");
  assert.deepEqual(subtitleLookupText(raw, 5, true), {
    text: "猫 犬 鳥",
    utf16Start: 4,
  });
});

test("controller target navigation does not resolve overlapping spans backwards", () => {
  const track = { id: "track" };
  const event = { id: "event" };
  const units = ["A", "B", "C"].map((text, index) => ({
    id: `unit-${index}`,
    text,
  }));
  const hit = (index) => ({ track, event, unit: units[index] });
  const targets = [
    { key: "target-a", hit: hit(0), units: units.slice(0, 3) },
    { key: "target-b", hit: hit(1), units: units.slice(1, 3) },
    { key: "target-c", hit: hit(2), units: units.slice(2, 3) },
  ];

  assert.equal(
    controllerTargetForDirection(targets, hit(1), "right", "target-b")?.key,
    "target-c",
  );
});

test("Japanese controller targets remain traversable beyond the second character", () => {
  const sourceText = "日本語";
  const snapshot = createGeometrySnapshot({
    sessionId: "controller-japanese-session",
    mediaGeneration: 0,
    geometryGeneration: 1,
    content: { x: 0, y: 0, width: 300, height: 120 },
    osd: { width: 300, height: 120 },
    source: { exact: true },
    tracks: [
      {
        id: "primary",
        role: "primary",
        selected: true,
        events: [
          {
            id: "event",
            sourceText,
            units: [...sourceText].map((text, index) => ({
              id: `unit-${index}`,
              text,
              sourceText,
              utf16Range: [index, index + 1],
              utf8Range: [index * 3, index * 3 + 3],
              rects: [{ x: 20 + index * 30, y: 70, width: 24, height: 24 }],
              position: index,
            })),
          },
        ],
      },
    ],
  });
  const targets = controllerTargetsForSnapshot(snapshot, {
    lookupLanguage: "ja",
    scanLength: 24,
  });

  assert.deepEqual(
    targets.map((target) => target.hit.unit.id),
    ["unit-0", "unit-1", "unit-2"],
  );
  const first = controllerTargetForDirection(targets, null, "right");
  const second = controllerTargetForDirection(targets, first.hit, "right", first.key);
  const third = controllerTargetForDirection(targets, second.hit, "right", second.key);
  assert.equal(first.hit.unit.id, "unit-0");
  assert.equal(second.hit.unit.id, "unit-1");
  assert.equal(third.hit.unit.id, "unit-2");
  assert.equal(
    controllerTargetForDirection(targets, third.hit, "right", third.key),
    null,
  );
});

test("lookup highlights coalesce character boxes and cover approximate wide glyphs", () => {
  const rects = coalesceHighlightRects(
    ["日", "本", "語"].map((text, index) => ({
      rect: { x: index * 13, y: 100, width: 13, height: 29 },
      unitId: `unit-${index}`,
      text,
    })),
    { approximate: true },
  );
  assert.equal(rects.length, 1);
  assert.ok(rects[0].x < 0);
  assert.ok(rects[0].width > 39);
  assert.ok(rects[0].height > 29);
});

test("native visible envelopes expand highlights without widening hit testing", () => {
  const snapshot = createGeometrySnapshot({
    sessionId: "envelope-session",
    mediaGeneration: 0,
    geometryGeneration: 1,
    content: { x: 0, y: 0, width: 200, height: 100 },
    osd: { width: 200, height: 100 },
    source: { exact: true },
    tracks: [
      {
        id: "primary",
        role: "primary",
        events: [
          {
            id: "event",
            units: [
              {
                id: "unit",
                text: "語",
                sourceText: "語",
                utf16Range: [0, 1],
                utf8Range: [0, 3],
                rect: { x: 20, y: 70, width: 20, height: 20 },
                envelopeRects: [{ x: 18, y: 68, width: 24, height: 24 }],
              },
            ],
          },
        ],
      },
    ],
  });
  const hit = hitTest(snapshot, { x: 25, y: 75 });
  assert.equal(hit.unit.id, "unit");
  assert.equal(hitTest(snapshot, { x: 19, y: 69 }), null);
  assert.deepEqual(lookupHighlightRects(snapshot, hit, [hit.unit]), [
    { x: 18, y: 68, width: 24, height: 24 },
  ]);
});

test("lookup geometry spans the complete word used by an English lookup", () => {
  const sourceText = "I walked home";
  const units = [...sourceText].map((text, index) => ({
    id: `unit-${index}`,
    text,
    sourceText,
    utf16Range: [index, index + 1],
    lookupable: !/\s/.test(text),
    rects: [{ x: index * 10, y: 100, width: 10, height: 20 }],
  }));
  const hit = {
    unit: units[3],
    event: { sourceText, units },
  };
  const geometry = lookupGeometryForHit(hit, {
    lookupLanguage: "en",
    scanLength: 24,
  });
  assert.equal(geometry.request.lookupText, "walked");
  assert.equal(geometry.units.map((unit) => unit.text).join(""), "walked");
});

test("demo controller uses one geometry snapshot for highlight, lookup, popup, and owned pause", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { lookupLanguage: "ja", pauseWhilePopupVisible: true },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.ok(browserHost.highlights.length > 0);
    assert.equal(browserHost.popupVisible, true);
    assert.equal(browserHost.interactiveInputCount, 1);
    assert.equal(browserHost.popups[0].result.entries[0].headword, "日本語");
    assert.equal(controller.interaction.state, "popup-active");
    await controller.closePopup("test");
    assert.equal(browserHost.popupVisible, false);
  } finally {
    await controller.detach("test");
  }
});

test("renderer bootstrap failure dismisses the popup and releases owned pause", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { lookupLanguage: "ja", pauseWhilePopupVisible: true },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(browserHost.popupVisible, true);
    assert.equal(controller.bridge.property("pause"), true);

    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "diagnostic",
        payload: {
          code: "surface-bootstrap-failed",
          script: "./iina-popup-renderer.js",
          message: "renderer asset failed to load",
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(browserHost.popupVisible, false);
    assert.equal(controller.bridge.property("pause"), false);
    assert.deepEqual(controller.surfaceBootstrapError, {
      surface: "popup",
      code: "surface-bootstrap-failed",
      script: "./iina-popup-renderer.js",
      message: "renderer asset failed to load",
    });
  } finally {
    await controller.detach("renderer-bootstrap-failure-test");
  }
});

test("controller lookup and right-stick navigation do not require a pointer hit", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { controllerEnabled: true, lookupLanguage: "ja" },
  });
  const state = (buttons, axes = []) => ({
    source: "browser-gamepad",
    connected: true,
    id: "cursor-free-pad",
    index: 0,
    buttons,
    axes,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(controller.lastHit, null);

    await controller.handleControllerState(state([]));
    await controller.handleControllerState(state([{ pressed: true, value: 1 }]));
    assert.equal(controller.browserHost.popupVisible, true);
    assert.ok(controller.controllerTarget);
    assert.ok(controller.browserHost.highlights.at(-1).rects.length > 0);
    const firstTargetId = controller.popupContext.hit.unit.id;

    await controller.handleControllerState(state([]));
    await controller.handleControllerState(state([], [0, 0, 0.9, 0]));
    assert.equal(controller.browserHost.popupVisible, true);
    assert.notEqual(controller.popupContext.hit.unit.id, firstTargetId);
    assert.ok(controller.browserHost.popups.length >= 2);
    assert.equal(browserHost.interactiveInputCount, 2);
  } finally {
    await controller.detach("cursor-free-controller-test");
  }
});

test("mouse motion through empty space does not steal a controller-selected target", async () => {
  const browserHost = new FakeBrowserHost();
  let cursor = { x: 0, y: 0 };
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => cursor,
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { controllerEnabled: true, lookupLanguage: "ja" },
  });
  const state = (buttons) => ({
    source: "browser-gamepad",
    connected: true,
    id: "modality-pad",
    index: 0,
    buttons,
    axes: [],
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await controller.handleControllerState(state([]));
    await controller.handleControllerState(state([{ pressed: true, value: 1 }]));
    const selectedKey = controller.controllerTarget?.key;
    assert.ok(selectedKey);
    assert.equal(controller.browserHost.popupVisible, true);

    await controller.handleControllerState(state([]));
    cursor = { x: 0, y: 0 };
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(
      controller.controllerTarget?.key,
      selectedKey,
      "empty-space mouse motion must not cancel cursor-free controller selection",
    );

    const selectedUnit = controller.controllerTarget.hit.unit;
    const mapper = new CoordinateMapper(controller.snapshot);
    const rect = selectedUnit.rects[0];
    cursor = mapper.osdToDesktop({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(
      controller.controllerTarget?.key,
      selectedKey,
      "returning over the selected unit must not switch input modality",
    );
  } finally {
    await controller.detach("controller-mouse-modality-test");
  }
});

test("controller audio hold opens the menu or plays on early release", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    audio: {
      async resolve() {
        return [{ url: "https://audio.example/selected.mp3", name: "Selected" }];
      },
    },
    allowApproximateGeometry: true,
    config: { controllerEnabled: true, lookupLanguage: "ja" },
  });
  const state = (buttons) => ({
    source: "browser-gamepad",
    connected: true,
    id: "hold-pad",
    index: 0,
    buttons,
    axes: [],
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await controller.handleControllerState(state([]));
    await controller.handleControllerState(state([{ pressed: true, value: 1 }]));
    await controller.handleControllerState(state([]));
    await controller.handleControllerState(
      state([{}, {}, {}, { pressed: true, value: 1 }]),
    );
    assert.equal(controller.controllerHold?.action, "audio-menu");
    await controller.handleControllerState(state([]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(controller.interaction.state, "popup-active");
    const audioResult = browserHost.events
      .slice()
      .reverse()
      .find((event) => event.type === "audio-result" && !event.payload.loading);
    assert.deepEqual(audioResult.payload, {
      candidates: [{ url: "https://audio.example/selected.mp3", name: "Selected" }],
      autoPlay: true,
      showMenu: false,
    });
  } finally {
    await controller.detach("controller-audio-hold-test");
  }
});

test("hovering a different subtitle unit replaces the active popup and highlight", async () => {
  const browserHost = new FakeBrowserHost();
  let cursor = { x: 590, y: 740 };
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => cursor,
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { lookupLanguage: "ja", pauseWhilePopupVisible: true },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(browserHost.popupVisible, true);
    const snapshot = controller.snapshot;
    const mapper = new CoordinateMapper(snapshot);
    const primaryUnits = snapshot.tracks
      .filter((track) => track.role === "primary")
      .flatMap((track) => track.events.flatMap((event) => event.units))
      .filter((unit) => unit.lookupable && unit.text.trim());
    const nextUnit = primaryUnits.find(
      (unit) => unit.id !== controller.lastHit.unit.id,
    );
    assert.ok(nextUnit);
    const nextRect = nextUnit.rects[0];
    cursor = mapper.osdToDesktop({
      x: nextRect.x + nextRect.width / 2,
      y: nextRect.y + nextRect.height / 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(controller.popupContext?.hit.unit.id, nextUnit.id);
    assert.equal(browserHost.popupVisible, true);
    assert.equal(browserHost.popups.length, 2);
    assert.notEqual(
      browserHost.popups[0].result.entries[0].headword,
      browserHost.popups[1].result.entries[0].headword,
    );
    assert.ok(
      browserHost.highlights.some(
        (payload) => payload.rects[0]?.x !== browserHost.highlights[0].rects[0]?.x,
      ),
    );
    assert.ok(
      controller.interaction.transitionLog.some(
        (entry) => entry.event === "close-popup" && entry.to === "player-interaction",
      ),
    );

    await controller.closePopup("escape");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(browserHost.popupVisible, false);
    assert.equal(browserHost.popups.length, 2);

    cursor = { x: 0, y: 0 };
    await new Promise((resolve) => setTimeout(resolve, 60));
    cursor = mapper.osdToDesktop({
      x: nextRect.x + nextRect.width / 2,
      y: nextRect.y + nextRect.height / 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(browserHost.popupVisible, true);
    assert.equal(browserHost.popups.length, 3);
  } finally {
    await controller.detach("hover-target-change-test");
  }
});

test("rapid hover changes cancel a pending lookup and keep the latest target", async () => {
  const browserHost = new FakeBrowserHost();
  let cursor = { x: 0, y: 0 };
  const requests = [];
  const dictionary = new DictionaryService({
    handler: async (request) => {
      requests.push(request.text);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        lookupString: request.text,
        entries: [{ headword: request.text, readings: [], senses: [] }],
      };
    },
  });
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => cursor,
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary,
    allowApproximateGeometry: true,
    config: { lookupLanguage: "ja", pauseWhilePopupVisible: true },
  });
  try {
    await controller.attachDemo();
    const mapper = new CoordinateMapper(controller.snapshot);
    const units = controller.snapshot.tracks
      .filter((track) => track.role === "primary")
      .flatMap((track) => track.events.flatMap((event) => event.units))
      .filter((unit) => unit.lookupable && unit.text.trim());
    const centerOf = (unit) => {
      const value = unit.rects[0];
      return mapper.osdToDesktop({
        x: value.x + value.width / 2,
        y: value.y + value.height / 2,
      });
    };
    cursor = centerOf(units[0]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    cursor = centerOf(units[1]);
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.ok(requests.length >= 2);
    assert.equal(controller.popupContext?.hit.unit.id, units[1].id);
    assert.equal(browserHost.popupVisible, true);
  } finally {
    await controller.detach("rapid-hover-test");
  }
});

test("controller promotes macOS bitmap OCR into lookupable approximate geometry", async () => {
  const browserHost = new FakeBrowserHost();
  const values = new Map([
    ["pid", 42],
    ["path", "/tmp/bitmap-episode.mkv"],
    [
      "track-list",
      [
        {
          type: "sub",
          id: 7,
          selected: true,
          codec: "hdmv_pgs_subtitle",
          "ff-index": 4,
        },
      ],
    ],
    ["sid", 7],
    ["pause", true],
    ["time-pos", 1.25],
    ["sub-start/full", 1000],
    ["sub-end/full", 2000],
    ["osd-dimensions", { w: 1280, h: 720, par: 1 }],
    ["video-out-params", { w: 1920, h: 1080 }],
  ]);
  class FakeIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      return values.get(name);
    }
    async observeProperty() {}
    async setProperty(name, value) {
      values.set(name, value);
    }
    async command() {}
    close() {}
  }
  const requests = [];
  const controller = new ApplicationController({
    browserHost,
    windowAdapter: {
      async read() {
        return {
          content: { x: 0, y: 0, width: 1280, height: 720 },
          contentExact: true,
          contentSource: "test-window",
          desktopScale: 1,
          browserScale: 1,
          isForeground: true,
        };
      },
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 250, y: 630 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    bitmapOcr: {
      async recognize(request) {
        requests.push(request);
        return {
          ok: true,
          protocol: 1,
          mode: "decoded-subtitle",
          rendererWidth: request.renderer.width,
          rendererHeight: request.renderer.height,
          text: "猫を見る",
          confidence: 0.91,
          cueStartMs: request.cueStartMs,
          cueEndMs: request.cueEndMs,
          units: [0, 1, 2, 3].map((index) => ({
            displayStartUtf16: index,
            displayEndUtf16: index + 1,
            rects: [{ x: 240 + index * 32, y: 620, w: 28, h: 42 }],
          })),
        };
      },
    },
    config: { lookupLanguage: "ja", bitmapSubtitleOcrEnabled: true },
  });
  try {
    await controller.attach(
      { sessionId: "bitmap-session", pid: 42, ipcEndpoint: "ipc://bitmap" },
      { bridgeOptions: { ipc: new FakeIpc() } },
    );
    for (
      let attempt = 0;
      attempt < 20 && !controller.snapshot?.source?.bitmapOcr;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].source.ffIndex, 4);
    assert.equal(controller.snapshot.source.mode, "bitmap-ocr");
    assert.equal(controller.snapshot.source.exact, false);
    assert.equal(controller.snapshot.source.lookupAllowed, true);
    assert.equal(controller.snapshot.tracks[0].events[0].units[0].text, "猫");
    assert.ok(controller.lastHit);
  } finally {
    await controller.detach("bitmap-ocr-test");
  }
});

test("controller falls back to paused mpv screenshot-diff OCR for bitmap subtitles", async () => {
  const browserHost = new FakeBrowserHost();
  const values = new Map([
    ["pid", 43],
    ["path", "/tmp/bitmap-screenshot-episode.mkv"],
    [
      "track-list",
      [
        {
          type: "sub",
          id: 8,
          selected: true,
          codec: "dvd_subtitle",
          "ff-index": 5,
        },
      ],
    ],
    ["sid", 8],
    ["pause", true],
    ["time-pos", 4.25],
    ["sub-start/full", 4000],
    ["sub-end/full", 5000],
    ["osd-dimensions", { w: 1280, h: 720, par: 1 }],
    ["video-out-params", { w: 1920, h: 1080 }],
  ]);
  const commands = [];
  class FakeIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      return values.get(name);
    }
    async observeProperty() {}
    async setProperty(name, value) {
      values.set(name, value);
    }
    async command(...args) {
      commands.push(args);
    }
    close() {}
  }
  const requests = [];
  const controller = new ApplicationController({
    browserHost,
    windowAdapter: {
      async read() {
        return {
          content: { x: 0, y: 0, width: 1280, height: 720 },
          contentExact: true,
          contentSource: "test-window",
          desktopScale: 1,
          browserScale: 1,
          isForeground: true,
        };
      },
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 400, y: 620 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    bitmapOcr: {
      async recognize(request) {
        requests.push(request);
        if (request.mode === "decoded-subtitle")
          throw new Error("decoded subtitle demux unavailable");
        return {
          ok: true,
          protocol: 1,
          mode: "screenshot-diff",
          rendererWidth: request.renderer.width,
          rendererHeight: request.renderer.height,
          text: "猫を見る",
          confidence: 0.72,
          cueStartMs: 4000,
          cueEndMs: 5000,
          units: [0, 1, 2, 3].map((index) => ({
            displayStartUtf16: index,
            displayEndUtf16: index + 1,
            rects: [{ x: 360 + index * 32, y: 600, w: 28, h: 42 }],
          })),
        };
      },
    },
    config: {
      lookupLanguage: "ja",
      bitmapSubtitleOcrEnabled: true,
      bitmapSubtitleOcrScreenshotFallbackEnabled: true,
    },
  });
  try {
    await controller.attach(
      {
        sessionId: "bitmap-screenshot-session",
        pid: 43,
        ipcEndpoint: "ipc://bitmap-screenshot",
      },
      { bridgeOptions: { ipc: new FakeIpc() } },
    );
    for (
      let attempt = 0;
      attempt < 20 && !controller.snapshot?.source?.bitmapOcr;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      requests.map((request) => request.mode),
      ["decoded-subtitle", "screenshot-diff"],
    );
    assert.deepEqual(
      commands
        .filter((command) => command[0] === "screenshot-to-file")
        .map((command) => command[2]),
      ["video", "subtitles"],
    );
    assert.equal(controller.snapshot.source.recognitionMode, "screenshot-diff");
    assert.equal(controller.snapshot.source.recognitionConfidence, 0.72);
    assert.equal(controller.snapshot.tracks[0].track.codec, "dvd_subtitle");
  } finally {
    await controller.detach("bitmap-screenshot-fallback-test");
  }
});

test("controller reflows popup placement from the rendered popup size", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "test-pad",
          index: 0,
          buttons: [],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "test-pad",
          index: 0,
          buttons: [],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "test-pad",
          index: 0,
          buttons: [],
          axes: [],
        },
      },
    });
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "popup-size",
        payload: { width: 240, height: 160, scrollable: true },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const layout = browserHost.events.find((event) => event.type === "popup-layout");
    assert.ok(layout);
    assert.equal(layout.payload.width, 240);
    assert.equal(layout.payload.maxHeight, 160);
    assert.equal(controller.popupMeasuredSize.scrollable, true);
  } finally {
    await controller.detach("popup-layout-test");
  }
});

test("controller records popup regions, scroll, and selection telemetry for native interaction", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    const generation = controller.snapshot.geometryGeneration;
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "popup-region",
        geometryGeneration: generation,
        payload: { name: "headword", x: 14, y: 12, width: 96, height: 28 },
      },
    });
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "popup-scroll",
        payload: { left: 0, top: 180 },
      },
    });
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "popup-style",
        geometryGeneration: generation,
        payload: {
          customCssApplied: true,
          backgroundColor: "rgb(236, 253, 245)",
          borderTopColor: "rgb(13, 148, 136)",
          borderTopWidth: "6px",
        },
      },
    });
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "popup-action",
        payload: { action: "selection-changed", text: "selected definition" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(controller.popupRegions.headword, {
      x: 14,
      y: 12,
      width: 96,
      height: 28,
    });
    assert.deepEqual(controller.popupScroll, { left: 0, top: 180 });
    assert.deepEqual(controller.popupStyle, {
      customCssApplied: true,
      backgroundColor: "rgb(236, 253, 245)",
      borderTopColor: "rgb(13, 148, 136)",
      borderTopWidth: "6px",
    });
    assert.equal(controller.popupSelectionText, "selected definition");
  } finally {
    await controller.detach("popup-telemetry-test");
  }
});

test("controller cancels text selection before host-driven popup dismissal", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "popup-action",
        payload: { action: "selection-start", pointerId: 31, button: 0 },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(controller.interaction.state, "text-selection-drag-capture");
    assert.equal(controller.interaction.capture.pointerId, 31);
    await controller.closePopup("selection-dismissal");
    assert.equal(controller.interaction.state, "player-interaction");
    assert.equal(controller.interaction.capture, null);
    assert.equal(browserHost.popupVisible, false);
  } finally {
    await controller.detach("selection-dismissal-test");
  }
});

test("controller publishes an injected exact geometry snapshot before lookup", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    nativeGeometry: {
      async apply(input) {
        return {
          ...input,
          source: {
            ...input.source,
            mode: "test-native",
            exact: true,
          },
        };
      },
    },
    config: { lookupLanguage: "ja", pauseWhilePopupVisible: true },
  });
  try {
    await controller.attachDemo();
    controller.config.allowApproximateGeometry = false;
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(controller.snapshot.source.exact, true);
    assert.equal(browserHost.popupVisible, true);
  } finally {
    await controller.detach("test");
  }
});

test("volatile native geometry diagnostics do not invalidate an active popup", async () => {
  const browserHost = new FakeBrowserHost();
  let observation = 0;
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    nativeGeometry: {
      async apply(input) {
        observation += 1;
        return {
          ...input,
          source: {
            ...input.source,
            mode: "test-native",
            exact: true,
            contentExact: true,
            diagnostics: {
              validationEnabled: true,
              observation,
            },
          },
        };
      },
    },
    config: { lookupLanguage: "ja", pauseWhilePopupVisible: true },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 360));
    assert.ok(observation >= 2);
    assert.equal(browserHost.popupVisible, true);
    assert.equal(controller.interaction.state, "popup-active");
    assert.equal(controller.lastPopupCloseReason, null);
  } finally {
    await controller.detach("volatile-diagnostics-test");
  }
});

test("controller exposes and clears native geometry failure diagnostics", async () => {
  const browserHost = new FakeBrowserHost();
  let fail = true;
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    nativeGeometry: {
      async apply() {
        if (fail) {
          const error = new Error("unsupported ASS tag");
          error.code = "NATIVE_GEOMETRY_INPUT_UNSUPPORTED";
          throw error;
        }
        return null;
      },
    },
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    controller.config.allowApproximateGeometry = false;
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.deepEqual(controller.nativeGeometryError, {
      code: "NATIVE_GEOMETRY_INPUT_UNSUPPORTED",
      message: "unsupported ASS tag",
      geometryGeneration: 0,
    });
    assert.equal(controller.snapshot.source.exact, false);
    assert.equal(browserHost.popupVisible, false);
    fail = false;
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(controller.nativeGeometryError, null);
  } finally {
    await controller.detach("test");
  }
});

test("controller suspends surfaces while the player window is unavailable and resumes on recovery", async () => {
  const browserHost = new FakeBrowserHost();
  let cursor = { x: 590, y: 740 };
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => cursor,
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    const availableRead = controller.windowAdapter.read;
    let available = false;
    controller.windowAdapter.read = async (...args) => {
      if (!available) {
        const error = new Error("window not found");
        error.code = "PLAYER_WINDOW_NOT_FOUND";
        throw error;
      }
      return availableRead(...args);
    };
    await new Promise((resolve) => setTimeout(resolve, 210));
    assert.equal(controller.snapshot, null);
    assert.equal(controller.interaction.state, "suspended");
    assert.equal(browserHost.highlightHidden, true);

    available = true;
    cursor = { x: 0, y: 0 };
    await new Promise((resolve) => setTimeout(resolve, 210));
    assert.ok(controller.snapshot);
    assert.notEqual(controller.interaction.state, "suspended");
    assert.equal(controller.interaction.sessionId, "demo-session");
  } finally {
    await controller.detach("test");
  }
});

test("controller waits for mpv OSD geometry during startup and resize recovery", async () => {
  const browserHost = new FakeBrowserHost();
  const values = new Map([
    ["pid", 42],
    ["path", "/tmp/startup-race.mkv"],
    ["track-list", [{ type: "sub", id: 1, "ff-index": 0 }]],
    ["sid", 1],
    ["window-minimized", false],
    ["sub-text/ass-full", "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,startup"],
    ["osd-dimensions", { w: 0, h: 0, par: 1 }],
  ]);
  let displayAsleep = false;
  class FakeIpc extends EventEmitter {
    async connect() {}
    async getProperty(name) {
      return values.get(name);
    }
    async observeProperty() {}
    async setProperty(name, value) {
      values.set(name, value);
      this.emit("property-change", name, value);
    }
    close() {}
  }
  const ipc = new FakeIpc();
  const controller = new ApplicationController({
    browserHost,
    windowAdapter: {
      async read() {
        return {
          content: { x: 320, y: 180, width: 1280, height: 720 },
          contentExact: true,
          contentSource: "test-window",
          desktopScale: 1,
          browserScale: 1,
          displayAsleep,
          displayVisible: !displayAsleep,
          isForeground: true,
        };
      },
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  const descriptor = {
    sessionId: "startup-race",
    pid: 42,
    ipcEndpoint: "ipc://startup-race",
  };
  try {
    await controller.attach(descriptor, { bridgeOptions: { ipc } });
    assert.equal(controller.snapshot, null);
    assert.equal(controller.windowUnavailable, true);
    assert.equal(browserHost.highlightHidden, true);

    values.set("osd-dimensions", { w: 1280, h: 720, par: 1 });
    ipc.emit("property-change", "osd-dimensions", values.get("osd-dimensions"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(controller.snapshot.osd.width, 1280);
    assert.equal(controller.snapshot.osd.height, 720);
    assert.equal(controller.windowUnavailable, false);

    values.set("window-minimized", true);
    ipc.emit("property-change", "window-minimized", true);
    assert.equal(controller.bridge.property("window-minimized"), true);
    await new Promise((resolve) => setTimeout(resolve, 210));
    assert.equal(controller.snapshot, null);
    assert.equal(controller.interaction.state, "suspended");
    assert.equal(browserHost.highlightHidden, true);

    values.set("window-minimized", false);
    ipc.emit("property-change", "window-minimized", false);
    await new Promise((resolve) => setTimeout(resolve, 210));
    assert.ok(controller.snapshot);
    assert.equal(controller.windowUnavailable, false);

    displayAsleep = true;
    await new Promise((resolve) => setTimeout(resolve, 210));
    assert.equal(controller.snapshot, null);
    assert.equal(controller.interaction.state, "suspended");

    displayAsleep = false;
    await new Promise((resolve) => setTimeout(resolve, 210));
    assert.ok(controller.snapshot);
    assert.equal(controller.windowUnavailable, false);

    values.set("osd-dimensions", { w: 0, h: 0, par: 1 });
    ipc.emit("property-change", "osd-dimensions", values.get("osd-dimensions"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(controller.snapshot, null);
    assert.equal(controller.windowUnavailable, true);

    values.set("osd-dimensions", { w: 1280, h: 720, par: 1 });
    ipc.emit("property-change", "osd-dimensions", values.get("osd-dimensions"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(controller.snapshot.osd.width, 1280);
    assert.equal(controller.windowUnavailable, false);
  } finally {
    await controller.detach("startup-race-test");
  }
});

test("popup focus counts as session foreground while mpv itself is unfocused", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(browserHost.popupVisible, true);
    browserHost.sessionFocused = true;
    const availableRead = controller.windowAdapter.read;
    controller.windowAdapter.read = async (...args) => ({
      ...(await availableRead(...args)),
      isForeground: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(controller.snapshot.source.foreground, true);
    assert.equal(browserHost.popupVisible, true);
    assert.equal(controller.interaction.state, "popup-active");
    browserHost.sessionFocused = false;
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(browserHost.popupVisible, false);
  } finally {
    await controller.detach("test");
  }
});

test("shift-hover keeps the passive surface idle until Shift is reported", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { subtitleLookupMode: "shift-hover" },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(browserHost.popupVisible, false);
    browserHost.emit("request", {
      message: { type: "pointer-move", payload: { shiftKey: true } },
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(browserHost.popupVisible, true);
  } finally {
    await controller.detach("test");
  }
});

test("controller renders Anki notes in the host and requires explicit duplicate override", async () => {
  const browserHost = new FakeBrowserHost();
  const ankiNotes = [];
  const openedQueries = [];
  let duplicate = true;
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    anki: {
      async findNotes() {
        return duplicate ? [42] : [];
      },
      async addNote(note) {
        ankiNotes.push(note);
        return 99;
      },
      async guiBrowse(query) {
        openedQueries.push(query);
        return [42];
      },
    },
    ankiConfig: {
      enabled: true,
      configured: true,
      deckName: "Study",
      modelName: "Basic",
      fieldTemplatesJson: JSON.stringify({
        Front: "{expression}",
        Back: "{popup-selection-text}",
      }),
      duplicateCheck: true,
      duplicateMode: "prevent",
      duplicateScope: "deck",
    },
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    const entry = browserHost.popups[0].result.entries[0];
    browserHost.emit("request", {
      message: {
        type: "popup-action",
        payload: { action: "selection-changed", text: "selected definition" },
      },
    });
    browserHost.emit("request", {
      message: {
        type: "anki-action",
        payload: { action: "add-note", entryId: entry.id },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(ankiNotes.length, 0);
    assert.equal(browserHost.events.at(-1).payload.state, "duplicate");

    browserHost.emit("request", {
      message: {
        type: "anki-action",
        payload: { action: "open", entryId: entry.id },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(openedQueries, ["nid:42"]);
    assert.equal(browserHost.events.at(-1).payload.state, "opened");

    duplicate = false;
    browserHost.emit("request", {
      message: {
        type: "anki-action",
        payload: { action: "add-anyway", entryId: entry.id },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(ankiNotes.length, 1);
    assert.equal(ankiNotes[0].fields.Back, "selected definition");
    assert.equal(browserHost.events.at(-1).payload.state, "added");
  } finally {
    await controller.detach("test");
  }
});

test("controller captures bounded sentence audio before rendering an Anki note", async () => {
  const browserHost = new FakeBrowserHost();
  const ankiNotes = [];
  const storedMedia = [];
  const captures = [];
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    sentenceAudio: {
      async capture(options) {
        captures.push(options);
        await fs.writeFile(options.outputPath, Buffer.from("captured-audio"));
        return {
          path: options.outputPath,
          startMs: 0,
          endMs: 30000,
          durationMs: 30000,
          format: "mp3",
          bitrateKbps: 128,
          bytes: 14,
        };
      },
    },
    anki: {
      async findNotes() {
        return [];
      },
      async storeMediaFile(filename, data) {
        storedMedia.push({ filename, data });
        return filename;
      },
      async addNote(note) {
        ankiNotes.push(note);
        return 99;
      },
    },
    ankiConfig: {
      enabled: true,
      configured: true,
      deckName: "Study",
      modelName: "Basic",
      fieldTemplatesJson: JSON.stringify({
        Front: "{expression}",
        Back: "{sentence-audio}",
      }),
      duplicateCheck: true,
      duplicateMode: "prevent",
      duplicateScope: "deck",
      audioFormat: "mp3",
      audioBitrateKbps: 128,
      sentenceAudioPaddingMs: 250,
    },
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    const entry = browserHost.popups[0].result.entries[0];
    browserHost.emit("request", {
      message: {
        type: "anki-action",
        payload: { action: "add-note", entryId: entry.id },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(captures.length, 1);
    assert.equal(captures[0].sourcePath, "demo://deterministic-test-video");
    assert.equal(captures[0].startMs, 0);
    assert.equal(captures[0].endMs, 30000);
    assert.equal(storedMedia.length, 1);
    assert.equal(
      Buffer.from(storedMedia[0].data, "base64").toString(),
      "captured-audio",
    );
    assert.equal(ankiNotes.length, 1);
    assert.match(
      ankiNotes[0].fields.Back,
      /^\[sound:iinatan-sentence-[a-f0-9]{20}\.mp3\]$/,
    );
    assert.equal(browserHost.events.at(-1).payload.state, "added");
  } finally {
    await controller.detach("test");
  }
});

test("controller stores word audio and an mpv screenshot before rendering an Anki note", async () => {
  const browserHost = new FakeBrowserHost();
  const ankiNotes = [];
  const storedMedia = [];
  const screenshotCalls = [];
  const resolvedAudioUrls = [];
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    audio: {
      fetch: async (url) => {
        resolvedAudioUrls.push(url);
        return {
          ok: true,
          headers: {
            get(name) {
              return name === "content-length" ? "10" : "audio/mpeg";
            },
          },
          arrayBuffer: async () => Uint8Array.from(Buffer.from("word-audio")).buffer,
        };
      },
      async resolve() {
        return [
          { url: "https://audio.example/word.mp3", name: "Default" },
          { url: "https://audio.example/alternate.mp3", name: "Alternate" },
        ];
      },
    },
    anki: {
      async findNotes() {
        return [];
      },
      async storeMediaFile(filename, data) {
        storedMedia.push({ filename, data });
        return filename;
      },
      async addNote(note) {
        ankiNotes.push(note);
        return 101;
      },
    },
    ankiConfig: {
      enabled: true,
      configured: true,
      deckName: "Study",
      modelName: "Basic",
      fieldTemplatesJson: JSON.stringify({
        Front: "{expression}",
        Back: "{audio} | {screenshot}",
      }),
      duplicateCheck: true,
      duplicateMode: "prevent",
      duplicateScope: "deck",
      imageQuality: 82,
    },
    config: {
      audioSources: [{ url: "https://audio.example/lookup?term={term}" }],
    },
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    controller.bridge.screenshotToFile = async (outputPath, quality) => {
      screenshotCalls.push({ outputPath, quality });
      await fs.writeFile(outputPath, Buffer.from("screenshot"));
    };
    await new Promise((resolve) => setTimeout(resolve, 90));
    const entry = browserHost.popups[0].result.entries[0];
    browserHost.emit("request", {
      message: {
        type: "audio-source",
        requestId: "audio-controller-selection",
        payload: {
          requestId: "audio-controller-selection",
          term: entry.headword,
          reading: entry.reading,
          sources: [{ url: "https://audio.example/lookup?term={term}" }],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    browserHost.emit("request", {
      message: {
        type: "audio-anki-selection",
        payload: {
          url: "https://audio.example/alternate.mp3",
          candidateIndex: 1,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    browserHost.emit("request", {
      message: {
        type: "anki-action",
        payload: { action: "add-note", entryId: entry.id },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(screenshotCalls.length, 1);
    assert.equal(
      resolvedAudioUrls.at(-1),
      "https://audio.example/alternate.mp3",
      "Anki word audio should use the controller-selected candidate",
    );
    assert.equal(screenshotCalls[0].quality, 82);
    assert.equal(storedMedia.length, 2);
    assert.match(storedMedia[0].filename, /^iinatan-word-[a-f0-9]{20}\.mp3$/);
    assert.equal(Buffer.from(storedMedia[0].data, "base64").toString(), "word-audio");
    assert.match(storedMedia[1].filename, /^iinatan-screenshot-[a-f0-9]{20}\.jpg$/);
    assert.equal(Buffer.from(storedMedia[1].data, "base64").toString(), "screenshot");
    assert.equal(ankiNotes.length, 1);
    assert.match(
      ankiNotes[0].fields.Back,
      /^\[sound:iinatan-word-[a-f0-9]{20}\.mp3\] \| <img src="iinatan-screenshot-[a-f0-9]{20}\.jpg">$/,
    );
    assert.equal(browserHost.events.at(-1).payload.state, "added");
  } finally {
    await controller.detach("test");
  }
});

test("controller routes nested lookups and cancels stale child requests", async () => {
  const browserHost = new FakeBrowserHost();
  const requests = [];
  let cancelObserved = false;
  const dictionary = new DictionaryService({
    handler: async (request) => {
      requests.push(request);
      return {
        lookupString: request.text,
        entries: [
          {
            id: `entry-${request.text}`,
            headword: request.text,
            glossaries: [{ content: [{ type: "paragraph", text: "definition" }] }],
          },
        ],
      };
    },
  });
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary,
    allowApproximateGeometry: true,
    config: {
      lookupLanguage: "ja",
      nestedPopupMode: "click",
      nestedPopupMaxDepth: 2,
    },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(controller.interaction.state, "popup-active");
    const sessionId = controller.popupSessionId;
    assert.ok(sessionId);
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "nested-lookup",
        payload: {
          requestId: "nested-controller-1",
          popupSessionId: sessionId,
          depth: 1,
          text: "猫",
          utf16Start: 0,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests.at(-1)?.text, "猫");
    const nestedResult = browserHost.events.find(
      (event) =>
        event.type === "nested-lookup-result" &&
        event.payload.requestId === "nested-controller-1",
    );
    assert.equal(nestedResult.payload.ok, true);
    assert.equal(nestedResult.payload.popupSessionId, sessionId);
    assert.equal(nestedResult.payload.depth, 1);
    assert.equal(nestedResult.payload.result.entries[0].headword, "猫");

    const pendingDictionary = new DictionaryService({
      handler: async (request) => {
        if (request.requestId !== "nested-controller-cancel")
          return nestedResult.payload.result;
        request.signal.addEventListener("abort", () => {
          cancelObserved = true;
        });
        return new Promise(() => {});
      },
    });
    controller.dictionary = pendingDictionary;
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "nested-lookup",
        payload: {
          requestId: "nested-controller-cancel",
          popupSessionId: sessionId,
          depth: 1,
          text: "犬",
          utf16Start: 0,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    browserHost.emit("request", {
      surface: "popup",
      message: {
        type: "nested-lookup-cancel",
        payload: {
          requestId: "nested-controller-cancel",
          popupSessionId: sessionId,
          depth: 1,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cancelObserved, true);
    assert.equal(
      browserHost.events.some(
        (event) =>
          event.type === "nested-lookup-result" &&
          event.payload.requestId === "nested-controller-cancel",
      ),
      false,
    );
    await controller.closePopup("test");
  } finally {
    await controller.detach("test");
  }
});

test("controller owns audio menus and routes configured gamepad actions", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    audio: {
      async resolve() {
        return [
          { url: "https://audio.example/one.mp3", name: "One" },
          { url: "https://audio.example/two.mp3", name: "Two" },
        ];
      },
    },
    allowApproximateGeometry: true,
    config: {
      controllerEnabled: true,
    },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 90));
    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "test-pad",
          index: 0,
          buttons: [],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "test-pad",
          index: 0,
          buttons: [{}, {}, {}, { pressed: true, value: 1 }],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(controller.interaction.state, "audio-menu-active");
    assert.deepEqual(browserHost.events.at(-1).payload.candidates, [
      { url: "https://audio.example/one.mp3", name: "One" },
      { url: "https://audio.example/two.mp3", name: "Two" },
    ]);

    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "test-pad",
          index: 0,
          buttons: [],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    browserHost.emit("request", {
      message: { type: "popup-action", payload: { action: "escape" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(controller.interaction.state, "popup-active");
    assert.equal(browserHost.events.at(-1).payload.command, "close-audio-menu");
  } finally {
    await controller.detach("test");
  }
});

test("native controller input takes priority while browser gamepad remains a macOS fallback", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { controllerEnabled: true },
  });
  const commands = [];
  try {
    await controller.attachDemo();
    controller.bridge.command = async (action) => commands.push(action);

    await controller.handleControllerState({
      source: "native-hid",
      connected: true,
      id: "native-pad",
      buttons: {},
      axes: {},
    });
    await controller.handleControllerState({
      source: "native-hid",
      connected: true,
      id: "native-pad",
      buttons: { square: true },
      axes: {},
    });
    assert.deepEqual(commands, ["toggle-pause"]);

    await controller.handleControllerState({
      source: "browser-gamepad",
      connected: true,
      id: "same-pad-through-browser",
      index: 0,
      buttons: [{}, {}, { pressed: true, value: 1 }],
      axes: [],
    });
    assert.deepEqual(commands, ["toggle-pause"]);

    await controller.handleControllerState({
      source: "native-hid",
      connected: false,
      id: "native-pad",
      buttons: {},
      axes: {},
    });
    await controller.handleControllerState({
      source: "browser-gamepad",
      connected: true,
      id: "fallback-pad",
      index: 0,
      buttons: [],
      axes: [],
    });
    await controller.handleControllerState({
      source: "browser-gamepad",
      connected: true,
      id: "fallback-pad",
      index: 0,
      buttons: [{}, {}, { pressed: true, value: 1 }],
      axes: [],
    });
    assert.deepEqual(commands, ["toggle-pause", "toggle-pause"]);
  } finally {
    await controller.detach("test");
  }
});

test("controller ignores gamepad input from a background session", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
    config: { controllerEnabled: true },
  });
  try {
    await controller.attachDemo();
    controller.snapshot = {
      ...controller.snapshot,
      source: { ...controller.snapshot.source, foreground: false },
    };
    const commands = [];
    controller.bridge.command = async (action) => commands.push(action);
    await controller.handleControllerState({
      source: "browser-gamepad",
      connected: true,
      id: "background-pad",
      index: 0,
      buttons: [],
      axes: [],
    });
    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "background-pad",
          index: 0,
          buttons: [{}, {}, { pressed: true, value: 1 }],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(commands, []);

    controller.snapshot = {
      ...controller.snapshot,
      source: { ...controller.snapshot.source, foreground: true },
    };
    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "background-pad",
          index: 0,
          buttons: [{}, {}, { pressed: true, value: 1 }],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(commands, []);
    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "background-pad",
          index: 0,
          buttons: [],
          axes: [],
        },
      },
    });
    browserHost.emit("request", {
      message: {
        type: "controller-state",
        payload: {
          connected: true,
          id: "background-pad",
          index: 0,
          buttons: [{}, {}, { pressed: true, value: 1 }],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(commands, ["toggle-pause"]);
  } finally {
    await controller.detach("test");
  }
});

test("shared dictionary cancellation remains scoped to the requesting session", async () => {
  const dictionary = new DictionaryService({
    handler: async ({ requestId, signal }) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 30);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            const error = new Error("lookup cancelled");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
      return { lookupString: requestId, entries: [] };
    },
  });
  const firstAbort = new AbortController();
  const first = dictionary.lookup(
    { requestId: "first", text: "一" },
    firstAbort.signal,
  );
  const second = dictionary.lookup({ requestId: "second", text: "二" });
  firstAbort.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal((await second).lookupString, "second");
});

test("controller reports a bounded hover timeout and releases the owned pause", async () => {
  const browserHost = new FakeBrowserHost();
  const dictionary = new DictionaryService({
    handler: async () => new Promise(() => {}),
    timeoutMs: 30000,
  });
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary,
    allowApproximateGeometry: true,
    config: { lookupTimeoutMs: 250, hoverRequestTimeoutMs: 500 },
  });
  try {
    await controller.attachDemo();
    await new Promise((resolve) => setTimeout(resolve, 360));
    assert.ok(
      browserHost.events.some(
        (event) =>
          event.type === "popup-error" &&
          event.payload.message === "Dictionary lookup timed out",
      ),
    );
    assert.notEqual(controller.interaction.state, "lookup-pending");
    assert.equal(controller.bridge.property("pause"), false);
    assert.equal(dictionary.active.size, 0);
  } finally {
    await controller.detach("timeout-test");
  }
});

test("concurrent controller detaches close one bridge without racing it to null", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({ browserHost });
  let closeCount = 0;
  controller.bridge = {
    close() {
      closeCount++;
    },
  };

  await Promise.all([
    controller.detach("player-disconnected"),
    controller.detach("shutdown"),
  ]);
  assert.equal(closeCount, 1);
  assert.equal(controller.bridge, null);
  assert.equal(controller.descriptor, null);
});

test("controller survives repeated attach and detach cycles without stale surfaces", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    for (let cycle = 0; cycle < 12; cycle++) {
      await controller.attachDemo();
      await new Promise((resolve) => setTimeout(resolve, 25));
      await controller.detach(`stress-${cycle}`);
      assert.equal(controller.bridge, null);
      assert.equal(controller.descriptor, null);
      assert.equal(controller.snapshot, null);
      assert.equal(controller.browserHost.popupVisible, false);
    }
    assert.equal(browserHost.closeCount, 12);
  } finally {
    await controller.detach("stress-cleanup");
  }
});

test("controller restores a surface after an unexpected browser-window close", async () => {
  const browserHost = new FakeBrowserHost();
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    allowApproximateGeometry: true,
  });
  try {
    await controller.attachDemo();
    const createCount = browserHost.createCount;
    browserHost.emit("surface-closed", "highlight");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(browserHost.createCount, createCount + 1);
    assert.ok(
      browserHost.events.some(
        (event) =>
          event.type === "session-state" &&
          event.payload.recoveredSurface === "highlight",
      ),
    );
    assert.equal(controller.snapshot.source.exact, false);
  } finally {
    await controller.detach("surface-recovery-test");
  }
});
