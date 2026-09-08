"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function parseLastJson(stdout, label) {
  const lines = String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(lines[index]);
    } catch (_) {}
  }
  throw new Error(`${label} returned no JSON result`);
}

function runHelper(executable, args, label) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${label} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  return parseLastJson(result.stdout, label);
}

function signingSummary(executable) {
  const result = spawnSync("codesign", ["-dvvv", executable], {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    authority: output.match(/^Authority=(.+)$/m)?.[1] || "",
    teamIdentifier: output.match(/^TeamIdentifier=(.+)$/m)?.[1] || "",
    cdHash: output.match(/^CDHash=(.+)$/m)?.[1] || "",
    adHoc: /Signature=adhoc\b/m.test(output),
    verified: result.status === 0,
  };
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("SKIP: native controller smoke is macOS-only");
    return;
  }
  const executable = path.resolve(
    process.env.IINATAN_HOSHI_HELPER || path.join(root, "bin", "iina-hoshi-dicts"),
  );
  const required = process.env.IINATAN_NATIVE_CONTROLLER_REQUIRED === "1";
  if (!(await exists(executable))) {
    if (required) throw new Error(`native helper is unavailable: ${executable}`);
    console.log("SKIP: native HoshiDicts helper is unavailable");
    return;
  }

  const signing = signingSummary(executable);
  const requireStableSigning =
    process.env.IINATAN_NATIVE_CONTROLLER_REQUIRE_STABLE_SIGNING === "1" ||
    process.env.IINATAN_E2E_REQUIRE_STABLE_SIGNING === "1";
  if (
    requireStableSigning &&
    (!signing.verified ||
      signing.adHoc ||
      !/^(Apple Development|Developer ID Application):/.test(signing.authority))
  )
    throw new Error(`native helper is not stably signed: ${JSON.stringify(signing)}`);

  const version = runHelper(executable, ["version"], "native helper version");
  const capability = version.controller || {};
  if (
    capability.protocol !== 1 ||
    capability.source !== "native-hid" ||
    !Array.isArray(capability.products) ||
    !capability.products.includes("gamepad")
  )
    throw new Error(
      `native helper controller capability is invalid: ${JSON.stringify(capability)}`,
    );

  const state = runHelper(executable, ["controller-state"], "native controller state");
  const requiredButtons = [
    "primary",
    "back",
    "square",
    "audio",
    "leftShoulder",
    "rightShoulder",
    "leftTrigger",
    "rightTrigger",
    "dpadUp",
    "dpadDown",
    "dpadLeft",
    "dpadRight",
  ];
  if (
    state.protocol !== 1 ||
    state.source !== "native-hid" ||
    typeof state.connected !== "boolean" ||
    !state.buttons ||
    typeof state.buttons !== "object" ||
    requiredButtons.some((name) => !(name in state.buttons)) ||
    !state.axes ||
    typeof state.axes !== "object"
  )
    throw new Error(`native controller state is invalid: ${JSON.stringify(state)}`);

  if (
    process.env.IINATAN_NATIVE_CONTROLLER_REQUIRE_CONNECTED === "1" &&
    !state.connected
  )
    throw new Error("no physical native controller was connected during the smoke");

  console.log(
    JSON.stringify(
      {
        ok: true,
        executable,
        signing,
        capability,
        state: {
          connected: state.connected,
          id: state.id || "",
          buttonNames: Object.keys(state.buttons),
          axes: state.axes,
        },
        physicalDeviceAcceptance: state.connected ? "observed" : "not-observed",
        mode: "macos-native-controller-contract-smoke",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`NATIVE CONTROLLER SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
