#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appPath = path.resolve(
  process.env.IINATAN_DESKTOP_TEST_APP ||
    path.join(root, "build", "native", "iinatan-desktop-test.app"),
);

function argumentValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function run(executable, args, description) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${description} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  }
  return result.stdout || "";
}

function runCombined(executable, args, description) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      description +
        " failed: " +
        (result.error?.message || result.stderr || "exit " + result.status),
    );
  }
  return String(result.stdout || "") + "\n" + String(result.stderr || "");
}

function signingIdentities() {
  const output = run(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    "listing macOS code-signing identities",
  );
  return Array.from(output.matchAll(/\"([^\"]+)\"/g), (match) => match[1]);
}

function selectIdentity() {
  const explicit =
    argumentValue("--identity") || process.env.IINATAN_MACOS_CODESIGN_IDENTITY || "";
  if (explicit) return { identity: explicit, available: [] };
  const available = signingIdentities();
  const identity =
    available.find((value) => value.startsWith("Apple Development:")) ||
    available.find((value) => value.startsWith("Developer ID Application:")) ||
    "";
  return { identity, available };
}

function main() {
  if (process.platform !== "darwin")
    throw new Error("the macOS desktop-test helper can only be signed on macOS");
  const { identity, available } = selectIdentity();
  if (!identity || identity === "-") {
    const details = available.length
      ? `Available identities: ${available.join(", ")}`
      : "security find-identity reported zero valid code-signing identities";
    throw new Error(
      `${details}. Install/select an Apple Development certificate, then rerun ` +
        "npm run sign:native:macos; this command never falls back to ad-hoc signing.",
    );
  }
  // CMake may leave a linker-created ad-hoc signature on this resource-less
  // bundle. The forced signing step replaces it; the final strict verification
  // below is the meaningful validity check.
  run(
    "codesign",
    ["--force", "--deep", "--timestamp=none", "--sign", identity, appPath],
    `signing ${appPath}`,
  );
  run(
    "codesign",
    ["--verify", "--deep", "--strict", appPath],
    "verifying the signed helper",
  );
  const details = runCombined(
    "codesign",
    ["-dvvv", appPath],
    "reading the signed helper identity",
  );
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        app: appPath,
        identity,
        signature: details
          .split(/\r?\n/)
          .filter((line) =>
            /^(Identifier|TeamIdentifier|Authority|CDHash)=/.test(line),
          ),
        next: "Re-add this finished bundle to macOS Accessibility, relaunch it, and run the E2E probe again.",
      },
      null,
      2,
    ) + "\n",
  );
}

try {
  main();
} catch (error) {
  console.error(`macOS helper signing unavailable: ${error.message}`);
  process.exitCode = 2;
}
