"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const output = path.join(dist, "mpv-plugin");
const sessionScript = path.join(root, "mpv", "iinatan.lua");

function targetConfiguration() {
  const platform = process.env.IINATAN_PACKAGE_PLATFORM || process.platform;
  if (platform === "win32")
    return {
      platform,
      sourcePattern: /^iinatan for mpv.*\.exe$/i,
      outputName: "iinatan-companion.exe",
      executable: false,
    };
  if (platform === "linux")
    return {
      platform,
      sourcePattern: /^iinatan for mpv.*\.AppImage$/i,
      outputName: "iinatan-companion",
      executable: true,
    };
  throw new Error("the drop-in mpv plugin bundle currently targets Windows and Linux");
}

function diagnosticText(error) {
  return String(error?.stack || error?.message || error).replaceAll(root, "<repo>");
}

async function main() {
  const configuration = targetConfiguration();

  const entries = await fs.readdir(dist, { withFileTypes: true });
  const portable = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        configuration.sourcePattern.test(entry.name) &&
        !/setup/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!portable)
    throw new Error(
      `electron-builder did not produce the ${configuration.platform} portable companion`,
    );

  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(sessionScript, path.join(output, "iinatan.lua"));
  const companionPath = path.join(output, configuration.outputName);
  if (configuration.platform === "win32") {
    const launcherBuild = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "build-windows-companion-launcher.js")],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (launcherBuild.status !== 0)
      throw new Error(
        `Windows companion launcher build failed: ${String(
          launcherBuild.stderr || launcherBuild.error || "unknown error",
        ).trim()}`,
      );
  } else {
    await fs.copyFile(path.join(dist, portable), companionPath);
  }
  if (configuration.executable) await fs.chmod(companionPath, 0o755);

  const files = await fs.readdir(output, { withFileTypes: true });
  const fileNames = files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (
    fileNames.length !== 2 ||
    !fileNames.includes("iinatan.lua") ||
    !fileNames.includes(configuration.outputName)
  )
    throw new Error(
      "the mpv plugin bundle did not contain exactly its script and companion",
    );

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "mpv-plugin-bundle",
        platform: configuration.platform,
        output: path.relative(root, output),
        files: fileNames,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`MPV PLUGIN BUNDLE FAILED: ${diagnosticText(error)}`);
  process.exitCode = 1;
});
