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
  subtitleMask,
  subtitleColorMask,
} = require("./stock-mpv-pixel-oracle");
const { NativeGeometryClient } = require("../../src/services/native-geometry-client");
const { NativeGeometryWorker } = require("../../src/services/native-geometry-worker");
const { createTextIndex } = require("../../src/geometry/unicode-index");

const root = path.resolve(__dirname, "../..");

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function assTimestampMilliseconds(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/u);
  if (!match) return null;
  return (
    Number(match[1]) * 3600000 +
    Number(match[2]) * 60000 +
    Number(match[3]) * 1000 +
    Number(match[4]) * 10
  );
}

function parseAssDialogue(line) {
  if (!String(line).startsWith("Dialogue:")) return null;
  const fields = String(line).slice("Dialogue:".length).split(",");
  if (fields.length < 10) return null;
  const startMs = assTimestampMilliseconds(fields[1]);
  const endMs = assTimestampMilliseconds(fields[2]);
  const text = fields.slice(9).join(",");
  if (startMs === null || endMs === null || endMs <= startMs || !text) return null;
  return { startMs, endMs, style: fields[3], text };
}

function assColorToRgb(value) {
  const match = String(value || "")
    .trim()
    .match(/^&H([0-9a-f]{6,8})&?$/iu);
  if (!match) return null;
  const hex = match[1].padStart(8, "0");
  return [
    Number.parseInt(hex.slice(6, 8), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    Number.parseInt(hex.slice(2, 4), 16),
  ];
}

function parseAssStyle(line) {
  if (!String(line).startsWith("Style:")) return null;
  const fields = String(line).slice("Style:".length).split(",");
  if (fields.length < 4) return null;
  const primaryColor = assColorToRgb(fields[3]);
  return primaryColor ? { name: fields[0].trim(), primaryColor } : null;
}

function readAssCue(mediaPath, ffIndex, timeMs, ffmpeg) {
  const result = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mediaPath,
      "-map",
      `0:${ffIndex}`,
      "-f",
      "ass",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `ffmpeg ASS extraction failed: ${result.error?.message || result.stderr}`,
    );
  const lines = String(result.stdout || "").split(/\r?\n/u);
  const styles = new Map(
    lines
      .map(parseAssStyle)
      .filter(Boolean)
      .map((style) => [style.name, style.primaryColor]),
  );
  const events = lines.map(parseAssDialogue).filter(Boolean);
  const cue = events.find((event) => timeMs >= event.startMs && timeMs < event.endMs);
  if (!cue) throw new Error(`no ASS cue covers ${timeMs} ms on stream ${ffIndex}`);
  return { ...cue, primaryColor: styles.get(cue.style) || null };
}

function plainAssText(rawText) {
  const text = String(rawText || "")
    .replace(/\{[^{}]*\}/gu, "")
    .replaceAll("\\N", "\n")
    .replaceAll("\\n", "\n");
  if (/\\/u.test(text))
    throw new Error("real-media ASS smoke encountered an unsupported escape");
  return text;
}

function wordUnits(text, locale) {
  const value = String(text || "");
  const units = [];
  if (typeof Intl.Segmenter === "function") {
    for (const entry of new Intl.Segmenter(locale, { granularity: "word" }).segment(
      value,
    )) {
      if (!entry.isWordLike) continue;
      units.push({
        position: entry.index,
        displayStartUtf16: entry.index,
        displayEndUtf16: entry.index + entry.segment.length,
      });
    }
    return units;
  }
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index;
    units.push({
      position: start,
      displayStartUtf16: start,
      displayEndUtf16: start + match[0].length,
    });
  }
  return units;
}

function visibleGraphemeUnits(text) {
  return createTextIndex(text)
    .units.filter((unit) => !/^\s+$/u.test(unit.text))
    .map((unit) => ({
      position: unit.index,
      displayStartUtf16: unit.utf16Start,
      displayEndUtf16: unit.utf16End,
    }));
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
    return { position: unit.position, changedPixels };
  });
}

function version(executable, args = ["--version"]) {
  return spawnSync(executable, args, { encoding: "utf8" });
}

async function main() {
  const required = process.env.IINATAN_STOCK_PIXEL_ASS_REQUIRED === "1";
  const mediaPath = process.env.IINATAN_STOCK_PIXEL_MEDIA_PATH
    ? path.resolve(process.env.IINATAN_STOCK_PIXEL_MEDIA_PATH)
    : "";
  if (!mediaPath) {
    if (required)
      throw new Error(
        "set IINATAN_STOCK_PIXEL_MEDIA_PATH for the real-media ASS smoke",
      );
    console.log("SKIP: real-media ASS smoke has no media path");
    return;
  }

  const mpv = process.env.IINATAN_MPV || "mpv";
  const ffmpeg = process.env.IINATAN_FFMPEG || "ffmpeg";
  const helper = path.resolve(
    process.env.IINATAN_NATIVE_GEOMETRY ||
      path.join(
        root,
        "bin",
        process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts",
      ),
  );
  const ffIndex = Math.max(
    0,
    Math.floor(numberFromEnvironment("IINATAN_STOCK_PIXEL_ASS_FF_INDEX", 2)),
  );
  const subtitleId = String(process.env.IINATAN_STOCK_PIXEL_ASS_ID || "1");
  const startSeconds = numberFromEnvironment("IINATAN_STOCK_PIXEL_START_SECONDS", 19);
  const timeMs = Math.round(startSeconds * 1000);
  const mpvVersion = version(mpv);
  const ffmpegVersion = version(ffmpeg, ["-version"]);
  if (
    mpvVersion.error ||
    mpvVersion.status !== 0 ||
    ffmpegVersion.error ||
    ffmpegVersion.status !== 0 ||
    !(await exists(mediaPath)) ||
    !(await exists(helper))
  ) {
    if (required)
      throw new Error("real-media ASS smoke requires mpv, ffmpeg, media, and helper");
    console.log("SKIP: real-media ASS smoke inputs are unavailable");
    return;
  }

  const cue = readAssCue(mediaPath, ffIndex, timeMs, ffmpeg);
  const displayText = plainAssText(cue.text);
  const locale = process.env.IINATAN_STOCK_PIXEL_ASS_LOCALE || "en";
  const wordProbeUnits = wordUnits(displayText, locale);
  const units = visibleGraphemeUnits(displayText);
  if (!units.length)
    throw new Error("real-media ASS cue contains no visible grapheme units");

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-stock-mpv-real-ass-smoke-"),
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
      throw new Error("real-media ASS capture contained no subtitle difference");
    const fillMask = cue.primaryColor
      ? subtitleColorMask(baseline, withSubtitle, cue.primaryColor)
      : null;
    if (!fillMask?.bounds)
      throw new Error("real-media ASS capture contained no primary-colour fill");

    const client = new NativeGeometryClient(
      new NativeGeometryWorker({
        executable: helper,
        root: path.join(temporaryRoot, "geometry"),
        timeoutMs: 30000,
      }),
    );
    const response = await client.measure({
      requestId: "real-media-ass-embedded-fonts",
      source: { path: mediaPath, ffIndex, external: false },
      cue: {
        timeMs,
        startMs: cue.startMs,
        endMs: cue.endMs,
        observedAss: cue.text,
        observedFormat: "ass",
      },
      units,
      renderer: {
        width: baseline.width,
        height: baseline.height,
        storageWidth: baseline.width,
        storageHeight: baseline.height,
        pixelAspect: 1,
        fontScale: 1,
        lineSpacing: 0,
        forceMargins: false,
        linePosition: 0,
        embeddedFonts: true,
        useStorageSize: true,
        overrideMode: process.env.IINATAN_STOCK_PIXEL_ASS_OVERRIDE || "scale",
        defaultFamily: "sans-serif",
        fontProvider: "auto",
        assJustify: false,
        hinting: "none",
        shaper: "complex",
      },
    });
    const predictedBounds = rectBounds(response.units);
    const predictedEnvelopeBounds = rectBounds(response.units, "envelopeRects");
    const coverage = unitCoverage(mask, response.units);
    const fillCoverage = unitCoverage(fillMask, response.units);
    const fillIou = iou(predictedBounds, fillMask.bounds);
    const envelopeIou = predictedEnvelopeBounds
      ? iou(predictedEnvelopeBounds, mask.bounds)
      : null;
    if (fillIou < 0.9 || fillCoverage.some((unit) => unit.changedPixels === 0))
      throw new Error(
        `real-media ASS fill geometry did not register: ${JSON.stringify({
          fillBounds: fillMask.bounds,
          predictedBounds,
          fillIou,
          fillCoverage,
        })}`,
      );
    if (envelopeIou !== null && envelopeIou < 0.8)
      throw new Error(
        `real-media ASS visible-envelope geometry did not register: ${JSON.stringify({
          actualBounds: mask.bounds,
          predictedEnvelopeBounds,
          envelopeIou,
        })}`,
      );
    const responseByPosition = new Map(
      response.units.map((unit) => [Number(unit.position), unit]),
    );
    const wordCoverage = unitCoverage(
      mask,
      wordProbeUnits.map((unit) => responseByPosition.get(unit.position) || unit),
    );
    if (wordCoverage.some((unit) => unit.changedPixels === 0))
      throw new Error(
        `real-media ASS pixels missed a requested word: ${JSON.stringify(wordCoverage)}`,
      );
    const embeddedFontCount = Number(response.diagnostics?.embeddedFontCount || 0);
    if (embeddedFontCount <= 0)
      throw new Error("real-media ASS helper did not report embedded font attachments");

    console.log(
      JSON.stringify(
        {
          mpv: mpvVersion.stdout.split(/\r?\n/u)[0],
          ffmpeg: ffmpegVersion.stdout.split(/\r?\n/u)[0],
          mediaPath,
          ffIndex,
          subtitleId,
          cue: { ...cue, displayText },
          frame: { width: baseline.width, height: baseline.height },
          requestedUnitCount: units.length,
          actualBounds: mask.bounds,
          primaryColor: cue.primaryColor,
          fillBounds: fillMask.bounds,
          predictedBounds,
          predictedEnvelopeBounds,
          iou: iou(predictedBounds, mask.bounds),
          fillIou,
          envelopeIou,
          embeddedFontCount,
          wordUnitCount: wordProbeUnits.length,
          wordUnitCoverage: wordCoverage,
          unitCoverage: coverage,
          fillUnitCoverage: fillCoverage,
          diagnostics: response.diagnostics || null,
          mode: "real-stock-mpv-ass-attachment-demux-and-unit-coverage",
        },
        null,
        2,
      ),
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`STOCK MPV REAL-MEDIA ASS SMOKE FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assTimestampMilliseconds,
  parseAssDialogue,
  visibleGraphemeUnits,
  wordUnits,
};
