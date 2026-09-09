"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  SubtitleGeometryProvider,
} = require("../../src/geometry/subtitle-geometry-provider");
const {
  NativeSubtitleGeometryService,
} = require("../../src/geometry/native-subtitle-geometry-service");
const { NativeGeometryClient } = require("../../src/services/native-geometry-client");
const { NativeGeometryWorker } = require("../../src/services/native-geometry-worker");

const root = path.resolve(__dirname, "../..");
const fixture = path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass");
const stripFixture = path.join(
  root,
  "tests",
  "fixtures",
  "native-ass-geometry-secondary-strip-smoke.ass",
);
const unicodeFixture = path.join(
  root,
  "tests",
  "fixtures",
  "native-ass-geometry-unicode-smoke.ass",
);

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

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function geometryExecutableCandidates() {
  const executableName =
    process.platform === "darwin"
      ? "iina-hoshi-dicts"
      : process.platform === "win32"
        ? "iinatan-native-geometry.exe"
        : "iinatan-native-geometry";
  const buildPlatform = process.platform === "win32" ? "windows" : "linux";
  return [
    path.join(root, "bin", executableName),
    path.join(root, "build", "native", executableName),
    path.join(root, "build", "native", "Release", executableName),
    path.join(root, "build", `native-geometry-${buildPlatform}-x86_64`, executableName),
    path.join(
      root,
      "build",
      `native-geometry-${buildPlatform}-x86_64`,
      "Release",
      executableName,
    ),
    path.join(
      root,
      "build",
      `native-geometry-${buildPlatform}-cmake`,
      "Release",
      executableName,
    ),
  ];
}

async function firstExisting(candidates) {
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return "";
}

async function main() {
  const configuredExecutable = process.env.IINATAN_NATIVE_GEOMETRY
    ? path.resolve(process.env.IINATAN_NATIVE_GEOMETRY)
    : "";
  const executable =
    configuredExecutable || (await firstExisting(geometryExecutableCandidates()));
  const required = process.env.IINATAN_NATIVE_GEOMETRY_REQUIRED === "1";
  if (!(await exists(executable))) {
    if (required)
      throw new Error(`native geometry executable is unavailable: ${executable}`);
    console.log("SKIP: no bundled or configured native geometry helper is available");
    return;
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-native-geometry-smoke-"),
  );
  try {
    const client = new NativeGeometryClient(
      new NativeGeometryWorker({
        executable,
        root: temporaryRoot,
        timeoutMs: 30000,
      }),
    );
    const capabilities = await client.negotiate();
    if (
      capabilities.assGeometry?.available !== true ||
      capabilities.assGeometry?.protocol !== 1
    )
      throw new Error("native geometry helper did not negotiate ASS geometry");
    const response = await client.measure({
      requestId: "geometry-smoke-1",
      source: { path: fixture, ffIndex: 0, external: true },
      cue: {
        timeMs: 2000,
        startMs: 1000,
        endMs: 3000,
        observedAss: "A careful reader",
        observedFormat: "ass",
      },
      units: [
        { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
        { position: 2, displayStartUtf16: 2, displayEndUtf16: 9 },
        { position: 10, displayStartUtf16: 10, displayEndUtf16: 16 },
      ],
      renderer: {
        width: 1280,
        height: 720,
        storageWidth: 1280,
        storageHeight: 720,
        pixelAspect: 1,
        fontScale: 1,
        linePosition: 0,
        defaultFamily: "Arial",
        overrideMode: "yes",
        embeddedFonts: true,
        useStorageSize: true,
        fontProvider: "auto",
        hinting: "none",
        shaper: "complex",
      },
    });
    if (!response.ok || response.protocol !== 1 || response.units.length !== 3)
      throw new Error("native geometry helper returned an invalid smoke response");
    if (
      response.units.some(
        (unit) =>
          !Number.isInteger(unit.position) ||
          !Array.isArray(unit.rects) ||
          !unit.rects.length ||
          !Array.isArray(unit.envelopeRects) ||
          !unit.envelopeRects.length ||
          unit.rects.some(
            (rect) =>
              ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ||
              rect.w <= 0 ||
              rect.h <= 0,
          ) ||
          unit.envelopeRects.some(
            (rect) =>
              ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ||
              rect.w <= 0 ||
              rect.h <= 0,
          ),
      )
    )
      throw new Error("native geometry helper returned an invalid unit rectangle");

    const stripContents = await fs.readFile(stripFixture, "utf8");
    const stripDialogue = stripContents
      .split(/\r?\n/)
      .find((line) => line.startsWith("Dialogue:"));
    if (!stripDialogue) throw new Error("secondary strip fixture has no dialogue");
    const stripDialogueOffset = stripContents.indexOf("Dialogue:");
    const stripInput = new SubtitleGeometryProvider().snapshotInput(
      {
        sessionId: "native-geometry-strip-smoke",
        mediaGeneration: 0,
        geometryGeneration: 0,
        timeMs: 2000,
        osd: { width: 1280, height: 720 },
        primary: {},
        secondary: {
          selected: true,
          assFull: stripDialogue,
          extradata: stripContents.slice(0, stripDialogueOffset),
          startMs: 1000,
          endMs: 3000,
          source: { path: stripFixture, ffIndex: 0, external: true },
          renderer: {
            overrideMode: "strip",
            linePosition: 100,
            storageWidth: 1280,
            storageHeight: 720,
            defaultFamily: "sans-serif",
            fontSize: 38,
            outlineSize: 1.65,
            shadowOffset: 0,
            marginX: 19,
            marginY: 34,
            alignX: "center",
            useMargins: true,
          },
        },
      },
      { content: { x: 0, y: 0, width: 1280, height: 720 } },
    );
    const stripResult = await new NativeSubtitleGeometryService({
      client,
      geometryProvider: new SubtitleGeometryProvider(),
    }).apply(stripInput);
    if (
      stripResult.source.exact !== true ||
      stripResult.source.mode !== "native-libass-instrumented"
    )
      throw new Error("native geometry strip observation was not exact");
    const stripUnits = stripResult.tracks
      .flatMap((track) => track.events)
      .flatMap((event) => event.units)
      .filter((unit) => unit.lookupable);

    const unicodeContents = await fs.readFile(unicodeFixture, "utf8");
    const unicodeDialogue = unicodeContents
      .split(/\r?\n/)
      .find((line) => line.startsWith("Dialogue:"));
    if (!unicodeDialogue) throw new Error("unicode fixture has no dialogue");
    const unicodeDialogueOffset = unicodeContents.indexOf("Dialogue:");
    const unicodeInput = new SubtitleGeometryProvider().snapshotInput(
      {
        sessionId: "native-geometry-unicode-smoke",
        mediaGeneration: 0,
        geometryGeneration: 0,
        timeMs: 2000,
        osd: { width: 1280, height: 720 },
        primary: {
          selected: true,
          assFull: unicodeDialogue,
          extradata: unicodeContents.slice(0, unicodeDialogueOffset),
          startMs: 1000,
          endMs: 3000,
          source: { path: unicodeFixture, ffIndex: 0, external: true },
          renderer: {
            overrideMode: "yes",
            linePosition: 0,
            storageWidth: 1280,
            storageHeight: 720,
            defaultFamily: "Arial",
            fontProvider: "auto",
            embeddedFonts: true,
            useStorageSize: true,
          },
        },
        secondary: {},
      },
      { content: { x: 0, y: 0, width: 1280, height: 720 } },
    );
    const unicodeResult = await new NativeSubtitleGeometryService({
      client,
      geometryProvider: new SubtitleGeometryProvider(),
    }).apply(unicodeInput);
    const unicodeUnits = unicodeResult.tracks
      .flatMap((track) => track.events)
      .flatMap((event) => event.units)
      .filter((unit) => unit.lookupable);
    if (unicodeResult.source.exact !== true || unicodeUnits.length !== 7)
      throw new Error("native geometry unicode mapping was not exact");

    console.log(
      publicDiagnostic(
        JSON.stringify(
          {
            executable,
            fixture,
            unitPositions: response.units.map((unit) => unit.position),
            units: response.units,
            secondaryStrip: {
              unitCount: stripUnits.length,
              source: stripResult.source,
            },
            unicode: {
              unitCount: unicodeUnits.length,
              source: unicodeResult.source,
            },
            diagnostics: response.diagnostics || null,
            capabilities: capabilities.assGeometry,
            mode: "bundled-native-ass-geometry-smoke",
          },
          null,
          2,
        ),
      ),
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`NATIVE GEOMETRY SMOKE FAILED: ${publicDiagnostic(error.message)}`);
  process.exitCode = 1;
});
