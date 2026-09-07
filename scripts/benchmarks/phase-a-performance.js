"use strict";

const os = require("node:os");
const { performance } = require("node:perf_hooks");
const packageJson = require("../../package.json");
const { CoordinateMapper } = require("../../src/geometry/coordinate-mapper");
const { buildPlainSubtitleGeometry } = require("../../src/geometry/plain-subtitle");
const { placePopup } = require("../../src/geometry/popup-placement");
const { createGeometrySnapshot, hitTest } = require("../../src/geometry/snapshot");
const { normalizeDictionaryResult } = require("../../src/services/content-security");

function quantile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function measure(name, operation, options = {}) {
  const samples = options.samples || 120;
  const batch = options.batch || 500;
  for (let index = 0; index < 20; index++) operation();
  const values = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let index = 0; index < batch; index++) operation();
    values.push((performance.now() - start) / batch);
  }
  return {
    name,
    samples,
    batch,
    unit: "ms/op",
    min: Number(Math.min(...values).toFixed(6)),
    p50: Number(quantile(values, 0.5).toFixed(6)),
    p95: Number(quantile(values, 0.95).toFixed(6)),
    p99: Number(quantile(values, 0.99).toFixed(6)),
    max: Number(Math.max(...values).toFixed(6)),
  };
}

function createSnapshot() {
  const tracks = ["primary", "secondary"].map((role, trackIndex) => ({
    id: role,
    role,
    selected: true,
    events: Array.from({ length: 4 }, (_, eventIndex) => ({
      id: `${role}-event-${eventIndex}`,
      sourceText: "performance fixture",
      startMs: eventIndex * 1000,
      endMs: eventIndex * 1000 + 900,
      layer: eventIndex,
      units: Array.from({ length: 60 }, (_, unitIndex) => {
        const column = unitIndex % 30;
        const row = Math.floor(unitIndex / 30);
        return {
          id: `${role}-event-${eventIndex}-unit-${unitIndex}`,
          text: unitIndex % 11 === 0 ? "語" : "a",
          sourceText: "performance fixture",
          utf16Range: [unitIndex * 2 + 1, unitIndex * 2 + 2],
          utf8Range: [unitIndex * 2 + 1, unitIndex * 2 + 2],
          rects: [
            {
              x: column * 36,
              y: trackIndex * 90 + row * 42,
              width: 30,
              height: 34,
            },
          ],
          position: unitIndex,
        };
      }),
    })),
  }));
  return createGeometrySnapshot({
    sessionId: "performance-session",
    mediaGeneration: 4,
    geometryGeneration: 8,
    timeMs: 2200,
    content: { x: -125, y: 48, width: 1536, height: 864 },
    osd: { width: 1920, height: 1080 },
    desktopScale: 1.5,
    browserScale: 1.25,
    source: { exact: true, contentExact: true },
    tracks,
  });
}

function createDictionaryFixture() {
  return {
    lookupString: "日本語",
    matched: "日本語",
    entries: Array.from({ length: 32 }, (_, entryIndex) => ({
      id: `entry-${entryIndex}`,
      expression: "日本語",
      reading: "にほんご",
      tags: ["noun", "common"],
      frequencies: [{ dictionary: "fixture", frequencies: [{ displayValue: "100" }] }],
      glossaries: Array.from({ length: 8 }, (_, glossaryIndex) => ({
        dictionary: `fixture-${glossaryIndex}`,
        tags: ["N1"],
        content: [
          { type: "paragraph", text: "the Japanese language" },
          { type: "cross-reference", text: "言語", lookup: "言語" },
          {
            type: "section",
            title: "Examples",
            content: [
              {
                type: "list",
                rows: [
                  ["one", "two"],
                  ["three", "four"],
                ],
              },
              { type: "table", rows: [["key", "value"]] },
            ],
          },
        ],
      })),
    })),
  };
}

function main() {
  const snapshot = createSnapshot();
  const mapper = new CoordinateMapper(snapshot);
  const target = mapper.osdToDesktop({ x: 18, y: 104 });
  const subtitleInput = {
    text: "日本語 e\u0301lan\n한국어 中文 English",
    osdWidth: 1920,
    osdHeight: 1080,
    fontSize: 48,
    charWidth: 26,
    lineHeight: 58,
    marginX: 32,
    marginY: 42,
    align: "center",
    position: "bottom",
    eventId: "performance-event",
  };
  const placementInput = {
    anchor: { x: 520, y: 680, width: 86, height: 40 },
    popupSize: { width: 620, height: 420 },
    bounds: { x: -125, y: 48, width: 1536, height: 864 },
    obstacles: [
      { x: 0, y: 620, width: 1536, height: 120 },
      { x: 420, y: 48, width: 240, height: 160 },
    ],
    cursor: { x: 592, y: 700 },
    cursorCorridor: 24,
    gap: 16,
    hysteresis: 32,
    preferredSide: "above",
  };
  const dictionaryFixture = createDictionaryFixture();
  const measurements = [
    measure("coordinate-roundtrip", () => {
      const desktop = mapper.osdToDesktop({ x: 911.25, y: 441.5 });
      const osd = mapper.desktopToOsd(desktop);
      if (Math.abs(osd.x - 911.25) > 0.000001) throw new Error("coordinate drift");
    }),
    measure("hit-test", () => {
      if (!hitTest(snapshot, target)) throw new Error("fixture target was not hit");
    }),
    measure("popup-placement", () => {
      if (!placePopup(placementInput).side) throw new Error("placement failed");
    }),
    measure(
      "plain-subtitle-geometry",
      () => {
        if (!buildPlainSubtitleGeometry(subtitleInput).units.length)
          throw new Error("subtitle fixture produced no units");
      },
      { batch: 100 },
    ),
    measure(
      "structured-dictionary-normalization",
      () => {
        if (!normalizeDictionaryResult(dictionaryFixture).entries.length)
          throw new Error("dictionary fixture produced no entries");
      },
      { batch: 20 },
    ),
  ];
  console.log(
    JSON.stringify(
      {
        mode: "phase-a-javascript-performance",
        environment: {
          date: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          osRelease: os.release(),
          node: process.version,
          electron: packageJson.devDependencies?.electron || null,
          cpu: os.cpus()[0]?.model || "unknown",
          cpuCount: os.cpus().length,
          displayBackend:
            process.env.XDG_SESSION_TYPE || process.env.DISPLAY || "unknown",
        },
        fixture: {
          tracks: snapshot.tracks.length,
          events: snapshot.tracks.reduce(
            (total, track) => total + track.events.length,
            0,
          ),
          units: snapshot.tracks.reduce(
            (total, track) =>
              total +
              track.events.reduce(
                (eventTotal, event) => eventTotal + event.units.length,
                0,
              ),
            0,
          ),
          dictionaryEntries: dictionaryFixture.entries.length,
          dictionaryGlossaries: dictionaryFixture.entries.length * 8,
        },
        measurements,
        limitation:
          "These are host/geometry/browser-independent microbenchmarks; native pointer-to-presentation and compositor latency require an unblocked graphical runner.",
      },
      null,
      2,
    ),
  );
}

main();
