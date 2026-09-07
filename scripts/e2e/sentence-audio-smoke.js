"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { SentenceAudioService } = require("../../src/services/sentence-audio-service");

const root = path.resolve(__dirname, "../..");

function resolveExecutable() {
  const executable = process.env.IINATAN_FFMPEG || "ffmpeg";
  const result = spawnSync(executable, ["-version"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return executable;
}

async function main() {
  const executable = resolveExecutable();
  if (!executable) {
    console.log(
      "SKIP: sentence-audio smoke requires ffmpeg or IINATAN_FFMPEG=/absolute/path/to/ffmpeg",
    );
    return;
  }
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-sentence-audio-smoke-"),
  );
  const inputPath = path.join(temporaryRoot, "fixture.wav");
  const outputPath = path.join(temporaryRoot, "sentence.mp3");
  try {
    const fixture = spawnSync(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=3",
        "-c:a",
        "pcm_s16le",
        "-y",
        inputPath,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (fixture.status !== 0)
      throw new Error(`fixture generation failed: ${fixture.stderr || fixture.error}`);

    const service = new SentenceAudioService({ executable });
    const result = await service.capture({
      sourcePath: inputPath,
      startMs: 800,
      endMs: 1800,
      paddingMs: 100,
      format: "mp3",
      bitrateKbps: 64,
      outputPath,
    });
    if (!(result.bytes > 0 && result.bytes <= 8 * 1024 * 1024))
      throw new Error(`invalid captured media size: ${result.bytes}`);
    console.log(
      JSON.stringify(
        {
          ok: true,
          executable,
          format: result.format,
          startMs: result.startMs,
          endMs: result.endMs,
          durationMs: result.durationMs,
          bytes: result.bytes,
          mode: "real-ffmpeg-sentence-audio-smoke",
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
  console.error(`SENTENCE AUDIO SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
