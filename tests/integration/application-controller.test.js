"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  ApplicationController,
  flattenSubtitleText,
  subtitleLookupText,
} = require("../../src/player/application-controller");
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
    assert.equal(browserHost.popups[0].result.entries[0].headword, "日本語");
    assert.equal(controller.interaction.state, "popup-active");
    await controller.closePopup("test");
    assert.equal(browserHost.popupVisible, false);
  } finally {
    await controller.detach("test");
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
    ["sub-text/ass-full", "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,startup"],
    ["osd-dimensions", { w: 0, h: 0, par: 1 }],
  ]);
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
  const controller = new ApplicationController({
    browserHost,
    screen: {
      getCursorScreenPoint: () => ({ x: 590, y: 740 }),
      getDisplayNearestPoint: () => ({ scaleFactor: 1 }),
    },
    dictionary: new DictionaryService({ demo: true }),
    audio: {
      fetch: async () => ({
        ok: true,
        headers: {
          get(name) {
            return name === "content-length" ? "10" : "audio/mpeg";
          },
        },
        arrayBuffer: async () => Uint8Array.from(Buffer.from("word-audio")).buffer,
      }),
      async resolve() {
        return [{ url: "https://audio.example/word.mp3" }];
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
        type: "anki-action",
        payload: { action: "add-note", entryId: entry.id },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(screenshotCalls.length, 1);
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

test("controller keeps nested lookup results inside the same popup and restores the parent", async () => {
  const browserHost = new FakeBrowserHost();
  const dictionary = new DictionaryService({
    handler: async (request) => ({
      lookupString: request.text,
      entries: [
        {
          id: `entry-${request.text}`,
          headword: request.text,
          glossaries: [{ content: [{ type: "paragraph", text: "definition" }] }],
        },
      ],
    }),
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
    browserHost.emit("request", {
      message: {
        type: "popup-action",
        payload: { action: "selection-changed", text: "parent selection" },
      },
    });
    browserHost.emit("request", {
      message: { type: "nested-lookup", payload: { term: "猫" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(controller.interaction.state, "nested-popup-active");
    assert.equal(controller.popupSelectionText, "");
    assert.equal(browserHost.events.at(-1).payload.result.entries[0].headword, "猫");

    browserHost.emit("request", {
      message: { type: "dismiss-popup", payload: { reason: "back" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(controller.interaction.state, "popup-active");
    assert.equal(
      browserHost.events.at(-1).payload.result.entries[0].headword,
      "日本語",
    );
    assert.equal(controller.popupSelectionText, "parent selection");
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
      nestedPopupMode: "click",
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
          buttons: [{}, {}, {}, { pressed: true, value: 1 }],
          axes: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(controller.interaction.state, "audio-menu-active");
    assert.deepEqual(browserHost.events.at(-1).payload.candidates, [
      { url: "https://audio.example/one.mp3", name: "One" },
      { url: "https://audio.example/two.mp3", name: "Two" },
    ]);

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
