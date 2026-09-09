"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  captureFrame,
  exists,
  iou,
  rectBounds,
  run,
  subripNativeRequest,
  subtitleMask,
} = require("./stock-mpv-pixel-oracle");
const { NativeGeometryClient } = require("../../src/services/native-geometry-client");
const { NativeGeometryWorker } = require("../../src/services/native-geometry-worker");

const root = path.resolve(__dirname, "../..");

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function timestampMilliseconds(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return (
    Number(match[1]) * 3600000 +
    Number(match[2]) * 60000 +
    Number(match[3]) * 1000 +
    Number(match[4])
  );
}

async function readSubripCue(filePath, timeMs) {
  const source = await fs.readFile(filePath, "utf8");
  const blocks = source.replaceAll("\r", "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes(" --> "));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/^\s*(\S+)\s+-->\s+(\S+)/);
    if (!timing) continue;
    const startMs = timestampMilliseconds(timing[1]);
    const endMs = timestampMilliseconds(timing[2]);
    if (startMs === null || endMs === null || timeMs < startMs || timeMs >= endMs)
      continue;
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (!text) continue;
    return { startMs, endMs, text };
  }
  throw new Error(`no SubRip cue covers ${timeMs} ms in ${filePath}`);
}

function graphemeUnits(text) {
  const value = String(text || "");
  const segments =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(value)].map(
          (entry) => entry.segment,
        )
      : Array.from(value);
  const units = [];
  let offset = 0;
  for (const segment of segments) {
    const start = offset;
    offset += segment.length;
    if (/^\s+$/u.test(segment)) continue;
    units.push({
      position: start,
      displayStartUtf16: start,
      displayEndUtf16: offset,
    });
  }
  return units;
}

function unitCoverage(mask, units) {
  return units.map((unit) => {
    const rect = unit.rects?.[0];
    let changedPixels = 0;
    if (rect) {
      for (
        let y = Math.max(0, Math.floor(rect.y));
        y < Math.min(mask.height, Math.ceil(rect.y + rect.h));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(rect.x));
          x < Math.min(mask.width, Math.ceil(rect.x + rect.w));
          x++
        )
          changedPixels += mask.mask[y * mask.width + x];
    }
    return {
      position: unit.position,
      text: unit.text || null,
      changedPixels,
    };
  });
}

function skip(message) {
  console.log(`SKIP: ${message}`);
}

async function main() {
  const required = process.env.IINATAN_STOCK_PIXEL_REAL_REQUIRED === "1";
  const mediaPath = process.env.IINATAN_STOCK_PIXEL_MEDIA_PATH
    ? path.resolve(process.env.IINATAN_STOCK_PIXEL_MEDIA_PATH)
    : "";
  if (!mediaPath) {
    skip(
      "set IINATAN_STOCK_PIXEL_MEDIA_PATH to compare native geometry against supplied stock-mpv media pixels",
    );
    return;
  }

  const mpv = process.env.IINATAN_MPV || "mpv";
  const helper = path.resolve(
    process.env.IINATAN_NATIVE_GEOMETRY ||
      path.join(
        root,
        "bin",
        process.platform === "darwin"
          ? "iina-hoshi-dicts"
          : process.platform === "win32"
            ? "iinatan-native-geometry.exe"
            : "iinatan-native-geometry",
      ),
  );
  const subtitlePath = path.resolve(
    process.env.IINATAN_STOCK_PIXEL_SUBTITLE_PATH ||
      mediaPath.replace(/\.[^.]+$/, ".ja.hi.srt"),
  );
  const subtitleId = String(process.env.IINATAN_STOCK_PIXEL_SUBTITLE_ID || "15");
  const startSeconds = numberFromEnvironment("IINATAN_STOCK_PIXEL_START_SECONDS", 19);
  const timeMs = Math.round(startSeconds * 1000);
  const mpvVersion = spawnSync(mpv, ["--no-config", "--version"], {
    encoding: "utf8",
  });
  if (
    mpvVersion.error ||
    mpvVersion.status !== 0 ||
    !(await exists(mediaPath)) ||
    !(await exists(subtitlePath)) ||
    !(await exists(helper))
  ) {
    if (required)
      throw new Error(
        "stock-mpv real-media oracle requires mpv, media, subtitle, and helper",
      );
    skip("stock-mpv real-media oracle inputs are unavailable");
    return;
  }

  const cue = await readSubripCue(subtitlePath, timeMs);
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-stock-mpv-real-pixel-oracle-"),
  );
  try {
    const baseline = await captureFrame(
      mpv,
      mediaPath,
      path.join(temporaryRoot, "baseline"),
      null,
      {
        startSeconds,
        forceRgb24: true,
        extraArgs: ["--sid=no"],
      },
    );
    const withSubtitle = await captureFrame(
      mpv,
      mediaPath,
      path.join(temporaryRoot, "subtitle"),
      null,
      {
        startSeconds,
        forceRgb24: true,
        extraArgs: [`--sid=${subtitleId}`],
      },
    );
    const mask = subtitleMask(baseline, withSubtitle);
    if (!mask.bounds)
      throw new Error("stock mpv real-media capture contained no subtitle difference");

    const track = {
      id: "primary",
      role: "primary",
      fixture: subtitlePath,
      text: cue.text,
      startMs: cue.startMs,
      endMs: cue.endMs,
      units: graphemeUnits(cue.text),
    };
    if (!track.units.length)
      throw new Error("real-media cue contains no lookupable graphemes");
    const request = subripNativeRequest(
      {
        id: "real-media",
        width: baseline.width,
        height: baseline.height,
        timeMs,
        primaryAssOverride: "scale",
      },
      track,
    );
    if (!request) throw new Error("real-media SubRip geometry request was rejected");
    const client = new NativeGeometryClient(
      new NativeGeometryWorker({
        executable: helper,
        root: path.join(temporaryRoot, "geometry"),
        timeoutMs: 30000,
      }),
    );
    const capabilities = await client.negotiate();
    const response = await client.measure(request);
    const predictedBounds = rectBounds(response.units);
    const predictedEnvelopeBounds = rectBounds(response.units, "envelopeRects");
    const score = iou(predictedBounds, mask.bounds);
    const envelopeScore = predictedEnvelopeBounds
      ? iou(predictedEnvelopeBounds, mask.bounds)
      : null;
    const coverage = unitCoverage(mask, response.units);
    if (score < 0.8)
      throw new Error(
        `real-media stock pixel/native geometry IoU ${score.toFixed(4)} is below 0.8`,
      );
    if (envelopeScore !== null && envelopeScore < 0.8)
      throw new Error(
        `real-media visible-envelope/native geometry IoU ${envelopeScore.toFixed(4)} is below 0.8`,
      );
    if (coverage.some((unit) => unit.changedPixels === 0))
      throw new Error(
        `real-media stock pixels did not overlap every predicted unit: ${JSON.stringify(
          {
            actualBounds: mask.bounds,
            predictedBounds,
            coverage,
          },
        )}`,
      );

    console.log(
      JSON.stringify(
        {
          mpv: mpvVersion.stdout.split(/\r?\n/)[0],
          mediaPath,
          subtitlePath,
          subtitleId,
          cue,
          frame: { width: baseline.width, height: baseline.height },
          actualBounds: mask.bounds,
          predictedBounds,
          predictedEnvelopeBounds,
          iou: score,
          envelopeIou: envelopeScore,
          maskPixels: mask.pixels,
          unitCoverage: coverage,
          diagnostics: response.diagnostics || null,
          capabilities: capabilities.assGeometry,
          mode: "independent-stock-mpv-pixel-oracle-supplied-media",
        },
        null,
        2,
      ),
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`STOCK MPV REAL-MEDIA PIXEL ORACLE FAILED: ${error.message}`);
  process.exitCode = 1;
});
