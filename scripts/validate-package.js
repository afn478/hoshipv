"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { listPackage } = require("@electron/asar");

const root = path.resolve(__dirname, "..");
const productName = "iinatan for mpv";
const SOURCE_ARCHIVE_SHA256 =
  "77292ffd1aa3e2ecc0f99f7c1973040a8261ecf4111bda76a5f8238c139d7326";
const MAC_HELPER_BUILD_SHA256 =
  "1036f1c96b83db5ce400dc67de6281008627ca40c20dc296e55aa40564e1b736";
const HOSHIDICTS_REVISION = "a28d82eb0f169b8ceff79e8c99ffe0b96709ab27";
const LIBASS_VERSION = "0.17.5";
const FFMPEG_VERSION = "9.0.1";
const LIBASS_PATCH = "libass-0.17.5-iinatan-unit-ids-v2";

function targetPlatform() {
  const value = String(process.env.IINATAN_PACKAGE_PLATFORM || process.platform);
  if (!["darwin", "win32", "linux"].includes(value))
    throw new Error(`unsupported package platform: ${value}`);
  return value;
}

function packageLayout(platform) {
  const appPath = path.resolve(
    process.env.IINATAN_PACKAGE_DIR ||
      (platform === "darwin"
        ? path.join(root, "dist", "mac-arm64", `${productName}.app`)
        : path.join(
            root,
            "dist",
            platform === "win32" ? "win-unpacked" : "linux-unpacked",
          )),
  );
  const resources =
    platform === "darwin"
      ? path.join(appPath, "Contents", "Resources")
      : path.join(appPath, "resources");
  const executable =
    platform === "darwin"
      ? path.join(appPath, "Contents", "MacOS", productName)
      : path.join(appPath, `${productName}${platform === "win32" ? ".exe" : ""}`);
  const externalResources =
    platform === "darwin"
      ? [
          [path.join(resources, "bin", "iinatan-window-probe"), "window probe"],
          [path.join(resources, "bin", "ffmpeg.exe"), "bundled ffmpeg helper"],
          [
            path.join(resources, "bin", "iinatan-mpv-window-shim.so"),
            "macOS mpv content-geometry shim",
          ],
          [path.join(resources, "bin", "iina-hoshi-dicts"), "HoshiDicts helper"],
          [
            path.join(resources, "vendor", "iina-hoshi-dicts-native-source.tar.gz"),
            "corresponding source archive",
          ],
          [path.join(resources, "mpv", "iinatan-session.lua"), "mpv session script"],
        ]
      : [
          [
            path.join(
              resources,
              "bin",
              platform === "win32"
                ? "iinatan-window-probe.exe"
                : "iinatan-window-probe",
            ),
            "window probe",
          ],
          [path.join(resources, "bin", "ffmpeg.exe"), "bundled ffmpeg helper"],
          [
            path.join(
              resources,
              "bin",
              platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts",
            ),
            "portable HoshiDicts helper",
          ],
          [
            path.join(resources, "vendor", "iina-hoshi-dicts-native-source.tar.gz"),
            "portable HoshiDicts source archive",
          ],
          [path.join(resources, "mpv", "iinatan-session.lua"), "mpv session script"],
        ];
  return {
    appPath,
    asarPath: path.join(resources, "app.asar"),
    executable,
    externalResources,
  };
}

async function requireFile(filePath, label) {
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true, `${label} is not a file`);
  return stat;
}

async function sha256(filePath) {
  const body = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(body).digest("hex");
}

function runVersion(executable, label) {
  const result = spawnSync(executable, ["version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, `${label} could not be executed`);
  assert.equal(result.status, 0, `${label} version command failed`);
  const line = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .at(-1);
  assert.ok(line, `${label} version command returned no JSON`);
  return JSON.parse(line);
}

async function main() {
  const platform = targetPlatform();
  const layout = packageLayout(platform);
  await requireFile(layout.executable, "app binary");
  for (const [filePath, label] of layout.externalResources) {
    const stat = await requireFile(filePath, label);
    if (
      label === "HoshiDicts helper" ||
      label === "portable HoshiDicts helper" ||
      label === "bundled ffmpeg helper"
    )
      assert.ok(stat.mode & 0o111, `${label} is not executable`);
  }
  const sourceArchive = layout.externalResources.find(([, label]) =>
    label.toLowerCase().includes("source archive"),
  )?.[0];
  assert.ok(sourceArchive, "package is missing the HoshiDicts source archive");
  assert.equal(
    await sha256(sourceArchive),
    SOURCE_ARCHIVE_SHA256,
    "packaged HoshiDicts source archive checksum changed",
  );
  if (platform === "darwin") {
    const helper = layout.externalResources.find(
      ([, label]) => label === "HoshiDicts helper",
    )?.[0];
    assert.ok(helper, "macOS package is missing the HoshiDicts helper");
    const rawHelper = path.join(root, "bin", "iina-hoshi-dicts");
    assert.equal(
      await sha256(rawHelper),
      MAC_HELPER_BUILD_SHA256,
      "macOS HoshiDicts build helper checksum changed",
    );
    const signature = spawnSync("codesign", ["--verify", "--strict", helper], {
      encoding: "utf8",
    });
    assert.equal(
      signature.error,
      undefined,
      "packaged HoshiDicts signature could not be checked",
    );
    assert.equal(
      signature.status,
      0,
      "packaged HoshiDicts helper signature is invalid",
    );
    const version = runVersion(helper, "packaged HoshiDicts helper");
    assert.equal(version.hoshidictsRevision, HOSHIDICTS_REVISION);
    assert.equal(version.assGeometry?.available, true);
    assert.equal(version.assGeometry?.libass, LIBASS_VERSION);
    assert.equal(version.assGeometry?.ffmpeg, FFMPEG_VERSION);
    assert.equal(version.assGeometry?.patch, LIBASS_PATCH);
    assert.equal(version.assGeometry?.envelopeRects, true);
    assert.equal(version.assGeometry?.architecture, "arm64");
    assert.equal(version.controller?.protocol, 1);
    assert.equal(version.controller?.source, "native-hid");
    assert.ok(version.controller?.products?.includes("gamepad"));
  } else {
    const helper = layout.externalResources.find(
      ([, label]) => label === "portable HoshiDicts helper",
    )?.[0];
    assert.ok(helper, `${platform} package is missing the portable HoshiDicts helper`);
    const version = runVersion(helper, "portable HoshiDicts helper");
    assert.equal(version.backend, "Manhhao/hoshidicts");
    assert.equal(version.hoshidictsRevision, HOSHIDICTS_REVISION);
    assert.equal(version.worker, true);
    assert.equal(version.assGeometry?.available, false);
  }

  const files = await listPackage(layout.asarPath);
  const requiredEntries = [
    "/app/main.js",
    "/app/preload.js",
    "/app/renderer.js",
    "/app/settings.html",
    "/docs/architecture-decision-record.md",
    "/docs/coordinate-geometry.md",
    "/docs/security.md",
    "/docs/dictionary-sources.md",
    "/docs/deinflection.md",
    "/docs/feature-matrix.json",
    "/docs/input-state-machine.md",
    "/docs/mpv-compatibility.md",
    "/docs/native-geometry.md",
    "/docs/platform-capability-matrix.md",
    "/docs/settings-migration.md",
    "/docs/validation.md",
    "/src/geometry/coordinate-mapper.js",
    "/src/player/session-directory.js",
    "/src/player/mpv-launcher.js",
    "/src/player/application-controller.js",
    "/src/services/dictionary-service.js",
    "/src/services/sentence-audio-service.js",
    "/package.json",
  ];
  for (const entry of requiredEntries)
    assert.ok(files.includes(entry), `app.asar is missing ${entry}`);

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-package-layout-"),
  );
  const installRoot = path.join(temporaryRoot, "Applications");
  const installedApp = path.join(installRoot, path.basename(layout.appPath));
  const userData = path.join(temporaryRoot, "user-data");
  try {
    await fs.mkdir(installRoot, { recursive: true, mode: 0o700 });
    await fs.cp(layout.appPath, installedApp, { recursive: true, force: false });
    await fs.mkdir(path.join(userData, "dictionaries"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(path.join(userData, "settings.json"), '{"sentinel":true}\n', {
      mode: 0o600,
    });
    await fs.writeFile(
      path.join(userData, "dictionaries", "keep-me.txt"),
      "user dictionary sentinel\n",
      { mode: 0o600 },
    );
    await fs.rm(installedApp, { recursive: true, force: false });
    assert.equal(
      await fs.readFile(path.join(userData, "settings.json"), "utf8"),
      '{"sentinel":true}\n',
    );
    assert.equal(
      await fs.readFile(path.join(userData, "dictionaries", "keep-me.txt"), "utf8"),
      "user dictionary sentinel\n",
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        package: layout.appPath,
        platform,
        arch: process.arch,
        asarEntries: files.length,
        checkedExternalResources: layout.externalResources.length,
        installLayout: "copy-and-remove-sandbox",
        userDataPreserved: true,
        limitation:
          "This validates the directory-package layout and non-destructive removal scope; signed installers, notarization, and native GUI behavior remain separate gates.",
        mode: `${platform}-directory-package-validation`,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`PACKAGE VALIDATION FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
