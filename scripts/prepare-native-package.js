"use strict";

const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
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

async function firstFile(candidates) {
  for (const candidate of candidates) if (await isFile(candidate)) return candidate;
  return null;
}

function displayPath(filePath) {
  return path.relative(root, filePath) || ".";
}

function diagnosticText(error) {
  return String(error?.stack || error?.message || error).replaceAll(root, "<repo>");
}

function verifyGeometryHelper(executable, target, expected = {}) {
  const result = spawnSync(executable, ["version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`native geometry helper could not run: ${displayPath(executable)}`);
  let version;
  try {
    version = JSON.parse(
      String(result.stdout || "")
        .trim()
        .split(/\r?\n/u)
        .at(-1),
    );
  } catch (_) {
    throw new Error("native geometry helper returned invalid version JSON");
  }
  if (
    version.assGeometry?.available !== true ||
    version.assGeometry?.libass !== (expected.libass || "0.17.5") ||
    version.assGeometry?.ffmpeg !== (expected.ffmpeg || "9.0.1") ||
    version.assGeometry?.patch !==
      (expected.patch || "libass-0.17.5-iinatan-unit-ids-v2") ||
    version.assGeometry?.envelopeRects !== true ||
    version.assGeometry?.architecture !== "x86-64" ||
    version.assGeometry?.fontProvider !==
      (target === "win32" ? "directwrite" : "fontconfig")
  )
    throw new Error(
      "native geometry helper did not report the reviewed capability tuple",
    );
  return version;
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
        path.join(
          root,
          "build",
          "native",
          "windows-ninja",
          `iina-hoshi-dicts${extension}`,
        ),
      ];
  const source = await firstFile(configured);
  if (!source)
    throw new Error(
      `portable HoshiDicts helper is missing; build target iina-hoshi-dicts first (checked ${configured.map(displayPath).join(", ")})`,
    );

  const destinationDirectory = path.join(root, "build", "package-resources");
  const dictionaryDestination = path.join(
    destinationDirectory,
    `iina-hoshi-dicts${extension}`,
  );
  await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  await fs.copyFile(source, dictionaryDestination);
  await fs.chmod(dictionaryDestination, 0o755);
  const dictionaryStat = await fs.stat(dictionaryDestination);

  const geometryName = `iinatan-native-geometry${extension}`;
  const geometryBuildName =
    targetPlatform === "win32" ? "windows-x86_64" : "linux-x86_64";
  const geometryCandidates = process.env.IINATAN_NATIVE_GEOMETRY
    ? [path.resolve(process.env.IINATAN_NATIVE_GEOMETRY)]
    : [
        path.join(root, "build", "native", geometryName),
        path.join(root, "build", "native", "Release", geometryName),
        path.join(root, "build", `native-geometry-${geometryBuildName}`, geometryName),
        path.join(
          root,
          "build",
          `native-geometry-${geometryBuildName}`,
          "Release",
          geometryName,
        ),
        path.join(
          root,
          "build",
          `native-geometry-${geometryBuildName}-cmake`,
          "Release",
          geometryName,
        ),
        path.join(
          root,
          "build",
          `native-geometry-${targetPlatform === "win32" ? "windows" : "linux"}-cmake`,
          "Release",
          geometryName,
        ),
      ];
  const geometrySource = await firstFile(geometryCandidates);
  if (!geometrySource)
    throw new Error(
      `instrumented native geometry helper is missing (checked ${geometryCandidates.map(displayPath).join(", ")})`,
    );
  const geometryDestination = path.join(destinationDirectory, geometryName);
  await fs.copyFile(geometrySource, geometryDestination);
  await fs.chmod(geometryDestination, 0o755);
  const geometryStat = await fs.stat(geometryDestination);
  const geometryVersion = verifyGeometryHelper(geometryDestination, targetPlatform);

  let compatibility = null;
  if (targetPlatform === "win32") {
    const compatibilityCandidates = process.env.IINATAN_NATIVE_GEOMETRY_COMPAT
      ? [path.resolve(process.env.IINATAN_NATIVE_GEOMETRY_COMPAT)]
      : [
          path.join(
            root,
            "build",
            "native",
            "iinatan-native-geometry-libass-0.17.4.exe",
          ),
          path.join(
            root,
            "build",
            "native",
            "Release",
            "iinatan-native-geometry-libass-0.17.4.exe",
          ),
          path.join(
            root,
            "build",
            "native-geometry-windows-compat-cmake2",
            "Release",
            "iinatan-native-geometry-libass-0.17.4.exe",
          ),
          path.join(
            root,
            "build",
            "native-geometry-windows-compat-cmake",
            "Release",
            "iinatan-native-geometry.exe",
          ),
        ];
    const compatibilitySource = await firstFile(compatibilityCandidates);
    if (!compatibilitySource)
      throw new Error(
        `Windows libass 0.17.4 compatibility helper is missing (checked ${compatibilityCandidates
          .map(displayPath)
          .join(", ")})`,
      );
    const compatibilityDestination = path.join(
      destinationDirectory,
      "iinatan-native-geometry-libass-0.17.4.exe",
    );
    await fs.copyFile(compatibilitySource, compatibilityDestination);
    await fs.chmod(compatibilityDestination, 0o755);
    const compatibilityStat = await fs.stat(compatibilityDestination);
    const compatibilityVersion = verifyGeometryHelper(
      compatibilityDestination,
      targetPlatform,
      {
        libass: "0.17.4",
        ffmpeg: "9.0.1",
        patch: "libass-0.17.4-iinatan-unit-ids-v2",
      },
    );
    compatibility = {
      source: displayPath(compatibilitySource),
      output: displayPath(compatibilityDestination),
      bytes: compatibilityStat.size,
      version: compatibilityVersion.assGeometry,
    };
  }

  console.log(
    JSON.stringify({
      dictionary: {
        source: displayPath(source),
        output: displayPath(dictionaryDestination),
        bytes: dictionaryStat.size,
      },
      geometry: {
        source: displayPath(geometrySource),
        output: displayPath(geometryDestination),
        bytes: geometryStat.size,
        version: geometryVersion.assGeometry,
      },
      compatibility,
      mode: "portable-native-package-preparation",
    }),
  );
}

main().catch((error) => {
  console.error(`NATIVE PACKAGE PREPARATION FAILED: ${diagnosticText(error)}`);
  process.exitCode = 1;
});
