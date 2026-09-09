"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "build", "runtime-tools");
const outputPath = path.join(outputDirectory, "ffmpeg.exe");

function displayPath(value) {
  return path.relative(root, value) || ".";
}

function diagnosticText(error) {
  return String(error?.stack || error?.message || error).replaceAll(root, "<repo>");
}

async function main() {
  let sourcePath;
  try {
    sourcePath = require("ffmpeg-static");
  } catch (error) {
    throw new Error(`ffmpeg-static is unavailable: ${error.message}`);
  }
  if (!sourcePath) throw new Error("ffmpeg-static has no binary for this platform");
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size <= 0)
    throw new Error("ffmpeg-static did not provide a usable binary");
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await fs.copyFile(sourcePath, outputPath);
  await fs.chmod(outputPath, 0o755);
  console.log(
    JSON.stringify({
      source: displayPath(sourcePath),
      output: displayPath(outputPath),
      bytes: stat.size,
      mode: "bundled-runtime-tool-preparation",
    }),
  );
}

main().catch((error) => {
  console.error(`RUNTIME TOOL PREPARATION FAILED: ${diagnosticText(error)}`);
  process.exitCode = 1;
});
