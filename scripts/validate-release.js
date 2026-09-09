"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "package.json",
  "app/main.js",
  "app/preload.js",
  "app/renderer.js",
  "app/settings-preload.js",
  "app/settings-renderer.js",
  "app/settings.html",
  "app/settings.css",
  "src/services/bounded-file.js",
  "src/services/storage-layout.js",
  "docs/architecture-decision-record.md",
  "docs/coordinate-geometry.md",
  "docs/deinflection.md",
  "docs/dictionary-sources.md",
  "docs/feature-matrix.json",
  "docs/native-geometry.md",
  "docs/native-backend.md",
  "docs/mpv-compatibility.md",
  "docs/ocr-limitations.md",
  "docs/platform-capability-matrix.md",
  "docs/security.md",
  "docs/validation.md",
  "docs/iina-popup-parity.md",
  "docs/iina-popup-parity.json",
  "mpv/iinatan.lua",
  "native/window_probe.hpp",
  "native/window_probe_main.cpp",
  "native/desktop_test.hpp",
  "native/desktop_test_main.cpp",
  "native/desktop_test_macos.mm",
  "native/desktop_test_x11.cpp",
  "native/desktop_test_windows.cpp",
  "native/png_writer.hpp",
  "native/png_writer.cpp",
  "native/mpv-cplugin-api.h",
  "native/mpv_window_shim_macos.mm",
  "native/window_probe_windows.manifest",
  "native/window_probe_windows.rc",
  "native/portable_hoshi_main.cpp",
  "native/portable_geometry_main.cpp",
  "native/portable_geometry_media_demux.cpp",
  "native/companion_launcher.cpp",
  "native/native-geometry-dependencies.lock.json",
  "native/patches/libass-0.17.4-iinatan-geometry-v2.patch",
  "scripts/build-native-geometry.sh",
  "scripts/prepare-runtime-tools.js",
  "scripts/prepare-native-package.js",
  "scripts/assemble-mpv-plugin.js",
  "scripts/build-windows-companion-launcher.js",
  "scripts/validate-popup-parity.js",
  "scripts/e2e/portable-hoshi-smoke.js",
  "scripts/e2e/anki-connect-smoke.js",
  "scripts/e2e/mpv-launcher-smoke.js",
  "scripts/e2e/settings-native-window-smoke.js",
  "scripts/e2e/native-selection-main.js",
  "scripts/e2e/native-selection-smoke.js",
  "scripts/e2e/native-overlay-selection-main.js",
  "scripts/e2e/x11-window-probe-main.js",
  "scripts/e2e/x11-window-probe-smoke.js",
  "scripts/e2e/windows-window-probe-main.js",
  "scripts/e2e/windows-window-probe-smoke.js",
  "scripts/e2e/windows-installer-smoke.js",
  "scripts/e2e/windows-plugin-autostart-smoke.js",
  "tests/storage-layout.test.js",
  "scripts/e2e/stock-mpv-real-media-ass-smoke.js",
  "scripts/e2e/stock-mpv-glyph-equivalence-diagnostic.js",
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative)))
    throw new Error(`missing release artifact: ${relative}`);
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (packageJson.license !== "GPL-3.0-only")
  throw new Error("package license must remain GPL-3.0-only");
if (packageJson.devDependencies?.electron !== "44.2.0")
  throw new Error("Electron version must remain pinned to the reviewed runtime");
if (packageJson.devDependencies?.["ffmpeg-static"] !== "5.3.0")
  throw new Error("ffmpeg-static must remain pinned to the reviewed binary package");
if (packageJson.build?.nsis?.deleteAppDataOnUninstall !== false)
  throw new Error("NSIS uninstall must preserve application data by default");

function hasExtraResource(platform, source, destination) {
  return (packageJson.build?.[platform]?.extraResources || []).some(
    (entry) => entry.from === source && entry.to === destination,
  );
}
for (const [platform, extension] of [
  ["win", ".exe"],
  ["linux", ""],
]) {
  if (
    !hasExtraResource(
      platform,
      `build/package-resources/iina-hoshi-dicts${extension}`,
      `bin/iina-hoshi-dicts${extension}`,
    ) ||
    !hasExtraResource(
      platform,
      `build/package-resources/iinatan-native-geometry${extension}`,
      `bin/iinatan-native-geometry${extension}`,
    ) ||
    !hasExtraResource(
      platform,
      "vendor/iina-hoshi-dicts-native-source.tar.gz",
      "vendor/iina-hoshi-dicts-native-source.tar.gz",
    )
  )
    throw new Error(`${platform} package is missing the portable HoshiDicts resources`);
  if (
    platform === "win" &&
    !hasExtraResource(
      platform,
      "build/package-resources/iinatan-native-geometry-libass-0.17.4.exe",
      "bin/iinatan-native-geometry-libass-0.17.4.exe",
    )
  )
    throw new Error("win package is missing the libass 0.17.4 compatibility helper");
}
if (
  !hasExtraResource("mac", "bin/iina-hoshi-dicts", "bin/iina-hoshi-dicts") ||
  !hasExtraResource(
    "mac",
    "vendor/iina-hoshi-dicts-native-source.tar.gz",
    "vendor/iina-hoshi-dicts-native-source.tar.gz",
  )
)
  throw new Error("mac package is missing the HoshiDicts resources");

const sourceArchive = path.join(
  root,
  "vendor",
  "iina-hoshi-dicts-native-source.tar.gz",
);
if (!fs.existsSync(sourceArchive))
  throw new Error("the corresponding HoshiDicts source archive is missing");
const sha256 = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
if (
  sha256(sourceArchive) !==
  "77292ffd1aa3e2ecc0f99f7c1973040a8261ecf4111bda76a5f8238c139d7326"
)
  throw new Error(
    "HoshiDicts corresponding-source archive checksum does not match the reviewed artifact",
  );

if (process.platform === "darwin") {
  const helper = path.join(root, "bin", "iina-hoshi-dicts");
  if (!fs.existsSync(helper))
    throw new Error("macOS release requires the bundled HoshiDicts helper");
  const verification = spawnSync("codesign", ["--verify", "--strict", helper], {
    encoding: "utf8",
  });
  const details = spawnSync("codesign", ["-dvvv", helper], {
    encoding: "utf8",
  });
  const signingOutput = `${details.stdout || ""}\n${details.stderr || ""}`;
  const authority = signingOutput.match(/^Authority=(.+)$/m)?.[1] || "";
  if (
    verification.status !== 0 ||
    !/^(Apple Development|Developer ID Application):/.test(authority)
  )
    throw new Error(
      `bundled HoshiDicts helper must have a verified Apple Development or Developer ID signature (authority=${authority || "none"})`,
    );
}

const featureMatrix = JSON.parse(
  fs.readFileSync(path.join(root, "docs/feature-matrix.json"), "utf8"),
);
if (featureMatrix.interpretation.x86 !== "x86-64 / AMD64, not 32-bit IA-32")
  throw new Error("x86 interpretation is missing");
if (!Array.isArray(featureMatrix.features) || featureMatrix.features.length < 20)
  throw new Error("feature matrix is incomplete");

const runtimeFiles = [
  "app/main.js",
  "app/preload.js",
  "app/renderer.js",
  "app/settings-preload.js",
  "app/settings-renderer.js",
  ...fs
    .readdirSync(path.join(root, "src"), { recursive: true })
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join("src", file)),
];
const forbidden = [
  "overlay-add",
  "setParent(",
  "offscreen: true",
  "setAlwaysOnTop(true)",
];
for (const relative of runtimeFiles) {
  const body = fs.readFileSync(path.join(root, relative), "utf8");
  for (const token of forbidden)
    if (body.includes(token))
      throw new Error(`${relative} contains forbidden runtime mechanism: ${token}`);
}

const preload = fs.readFileSync(path.join(root, "app/preload.js"), "utf8");
const main = fs.readFileSync(path.join(root, "app/main.js"), "utf8");
const browserHost = fs.readFileSync(
  path.join(root, "src/platform/browser-host.js"),
  "utf8",
);
const overlayHtml = fs.readFileSync(path.join(root, "app/overlay.html"), "utf8");
const settingsHtml = fs.readFileSync(path.join(root, "app/settings.html"), "utf8");
if (
  !preload.includes("contextIsolation") &&
  !fs
    .readFileSync(path.join(root, "src/platform/browser-host.js"), "utf8")
    .includes("contextIsolation: true")
)
  throw new Error("context isolation is not enforced");
if (
  !fs
    .readFileSync(path.join(root, "src/platform/browser-host.js"), "utf8")
    .includes("nodeIntegration: false")
)
  throw new Error("Node integration must be disabled in document content");

for (const [label, source] of [
  ["Electron main process", main],
  ["BrowserHost", browserHost],
]) {
  for (const token of [
    "nodeIntegration: false",
    "contextIsolation: true",
    "sandbox: true",
    "webSecurity: true",
    "allowRunningInsecureContent: false",
    'setWindowOpenHandler(() => ({ action: "deny" }))',
    'on("will-navigate", (event) => event.preventDefault())',
    'on("will-redirect", (event) => event.preventDefault())',
  ]) {
    if (!source.includes(token))
      throw new Error(`${label} is missing security contract: ${token}`);
  }
}
for (const forbiddenToken of [
  "webSecurity: false",
  "nodeIntegration: true",
  "contextIsolation: false",
  "sandbox: false",
  "--remote-debugging-port",
  "--inspect",
]) {
  if ([main, browserHost, preload].some((source) => source.includes(forbiddenToken)))
    throw new Error(
      `release security contract contains forbidden token: ${forbiddenToken}`,
    );
}
for (const [label, html, mediaRequired] of [
  ["overlay", overlayHtml, true],
  ["settings", settingsHtml, false],
]) {
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]) {
    if (!html.includes(directive))
      throw new Error(`${label} CSP is missing ${directive}`);
  }
  if (mediaRequired && !html.includes("media-src https:"))
    throw new Error("overlay CSP is missing its explicit media policy");
}

console.log(
  `validated ${featureMatrix.features.length} feature-matrix rows and ${runtimeFiles.length} runtime files`,
);
