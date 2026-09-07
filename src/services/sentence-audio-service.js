"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const MAX_AUDIO_SECONDS = 35;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_PADDING_MS = 2000;
const MIN_AUDIO_SECONDS = 0.25;

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAudioFormat(value) {
  return String(value || "").toLowerCase() === "opus" ? "opus" : "mp3";
}

function normalizeBitrateKbps(value) {
  const number = finite(value, 96);
  return Math.round(Math.max(24, Math.min(320, number)));
}

function normalizePaddingMs(value) {
  const number = finite(value, 250);
  return Math.round(Math.max(0, Math.min(MAX_PADDING_MS, number)));
}

function normalizeSubtitleSpeed(value) {
  const number = finite(value, 1);
  return Math.max(0.1, Math.min(10, number));
}

function normalizeSource(value) {
  const source = String(value || "").trim();
  if (!source || source.includes("\0"))
    throw new Error("current media source is unavailable");
  if (path.isAbsolute(source)) return source;
  let url;
  try {
    url = new URL(source);
  } catch (_) {
    throw new Error("current media source is not an absolute path or URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("current media source uses an unsupported URL scheme");
  return url.href;
}

function sentenceAudioWindow(input = {}) {
  const currentMs = Math.max(0, finite(input.timeMs, 0));
  const speed = normalizeSubtitleSpeed(input.subtitleSpeed);
  const delayMs = finite(input.subtitleDelayMs, 0);
  const paddingMs = normalizePaddingMs(input.paddingMs);
  const rawStart = finite(input.startMs, currentMs - 1500);
  const rawEnd = finite(input.endMs, currentMs + 2500);

  // mpv's sub-speed multiplies subtitle event timestamps. Apply the same
  // documented transformation before adding the current subtitle delay.
  let startMs = rawStart * speed + delayMs - paddingMs;
  let endMs = rawEnd * speed + delayMs + paddingMs;
  startMs = Math.max(0, startMs);
  endMs = Math.max(startMs + MIN_AUDIO_SECONDS * 1000, endMs);
  if (endMs - startMs > MAX_AUDIO_SECONDS * 1000)
    endMs = startMs + MAX_AUDIO_SECONDS * 1000;

  return Object.freeze({
    startMs,
    endMs,
    durationMs: endMs - startMs,
    speed,
    delayMs,
    paddingMs,
  });
}

function seconds(value) {
  return (Math.max(0, Number(value) || 0) / 1000).toFixed(3);
}

function buildFfmpegArguments(input = {}) {
  const source = normalizeSource(input.sourcePath);
  const window = input.window || sentenceAudioWindow(input);
  const format = normalizeAudioFormat(input.format);
  const bitrateKbps = normalizeBitrateKbps(input.bitrateKbps);
  const outputPath = String(input.outputPath || "");
  if (!path.isAbsolute(outputPath) || outputPath.includes("\0"))
    throw new Error("sentence audio output path must be absolute");

  const codec =
    format === "opus"
      ? ["-c:a", "libopus", "-b:a", `${bitrateKbps}k`]
      : ["-c:a", "libmp3lame", "-b:a", `${bitrateKbps}k`];
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    seconds(window.startMs),
    "-i",
    source,
    "-t",
    seconds(window.durationMs),
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-threads",
    "2",
    ...codec,
    outputPath,
  ];
}

class SentenceAudioService {
  constructor(options = {}) {
    if (!options.executable)
      throw new TypeError("sentence audio executable is required");
    this.executable = String(options.executable);
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    this.maxBytes = Math.max(1, Number(options.maxBytes) || MAX_AUDIO_BYTES);
    this.execFileProcess = options.execFileProcess || execFile;
  }

  async capture(input = {}) {
    const window = sentenceAudioWindow(input);
    const format = normalizeAudioFormat(input.format);
    const bitrateKbps = normalizeBitrateKbps(input.bitrateKbps);
    const outputPath = String(input.outputPath || "");
    const args = buildFfmpegArguments({
      ...input,
      format,
      bitrateKbps,
      window,
    });
    await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    await new Promise((resolve, reject) => {
      this.execFileProcess(
        this.executable,
        args,
        {
          timeout: this.timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          ...(input.signal ? { signal: input.signal } : {}),
        },
        (error, _stdout, stderr) => {
          if (error) {
            error.stderr = String(stderr || "").slice(0, 4096);
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
    const stat = await fs.stat(outputPath);
    if (!stat.isFile() || stat.size <= 0)
      throw new Error("ffmpeg produced no sentence audio");
    if (stat.size > this.maxBytes)
      throw new Error("sentence audio exceeds the Anki media size limit");
    return Object.freeze({
      path: outputPath,
      format,
      bitrateKbps,
      ...window,
      bytes: stat.size,
    });
  }
}

module.exports = {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MAX_PADDING_MS,
  MIN_AUDIO_SECONDS,
  SentenceAudioService,
  buildFfmpegArguments,
  normalizeAudioFormat,
  normalizeBitrateKbps,
  normalizePaddingMs,
  normalizeSource,
  normalizeSubtitleSpeed,
  sentenceAudioWindow,
};
