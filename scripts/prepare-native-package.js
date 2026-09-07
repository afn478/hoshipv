"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const targetPlatform = String(process.env.IINATAN_PACKAGE_PLATFORM || process.platform);

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (_) {
    return false;
  }
}

async function main() {
  if (targetPlatform === "darwin") {
    console.log(
      JSON.stringify({
        mode: "portable-hoshi-not-required",
        platform: targetPlatform,
      }),
    );
    return;
  }
  if (!["linux", "win32"].includes(targetPlatform))
    throw new Error(`unsupported package platform: ${targetPlatform}`);

  const extension = targetPlatform === "win32" ? ".exe" : "";
  const configured = process.env.IINATAN_HOSHI_HELPER
    ? [path.resolve(process.env.IINATAN_HOSHI_HELPER)]
    : [
        path.join(root, "build", "native", `iina-hoshi-dicts${extension}`),
        path.join(root, "build", "native", "Release", `iina-hoshi-dicts${extension}`),
      ];
  let source = null;
  for (const candidate of configured) {
    if (await isFile(candidate)) {
      source = candidate;
      break;
    }
  }
  if (!source)
    throw new Error(
      `portable HoshiDicts helper is missing; build target iina-hoshi-dicts first (checked ${configured.join(", ")})`,
    );

  const destinationDirectory = path.join(root, "build", "package-resources");
  const destination = path.join(destinationDirectory, `iina-hoshi-dicts${extension}`);
  await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  await fs.copyFile(source, destination);
  await fs.chmod(destination, 0o755);
  const stat = await fs.stat(destination);
  console.log(
    JSON.stringify({
      source,
      output: destination,
      bytes: stat.size,
      mode: "portable-hoshi-package-preparation",
    }),
  );
}

main().catch((error) => {
  console.error(`NATIVE PACKAGE PREPARATION FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
