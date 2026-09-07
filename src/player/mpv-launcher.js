"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function absolutePath(value, label) {
  const result = String(value || "");
  if (!result || !path.isAbsolute(result))
    throw new Error(`${label} must be an absolute path`);
  return result;
}

function launchToken() {
  return crypto.randomBytes(8).toString("hex");
}

function ipcEndpointFor({ platform = process.platform, temporaryDirectory, token }) {
  if (platform === "win32") return `\\\\.\\pipe\\iinatan-${token}`;
  return path.join(
    absolutePath(temporaryDirectory, "temporary directory"),
    `i-${token}.sock`,
  );
}

function createMpvLaunchPlan(options = {}) {
  const platform = String(options.platform || process.platform);
  if (!["darwin", "linux", "win32"].includes(platform))
    throw new Error(`unsupported mpv launcher platform: ${platform}`);
  const resourceRoot = absolutePath(options.resourceRoot, "resource root");
  const sessionDirectory = absolutePath(options.sessionDirectory, "session directory");
  const temporaryDirectory = absolutePath(
    options.temporaryDirectory || os.tmpdir(),
    "temporary directory",
  );
  const mediaPath = absolutePath(options.mediaPath, "media path");
  const token = String(options.token || launchToken());
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(token))
    throw new Error("invalid mpv launcher token");
  const executable = String(
    options.executable || (platform === "win32" ? "mpv.exe" : "mpv"),
  );
  if (!executable) throw new Error("mpv executable is required");
  const sessionScript = path.join(resourceRoot, "mpv", "iinatan-session.lua");
  const nativeShimPath = options.nativeShimPath
    ? absolutePath(options.nativeShimPath, "native shim path")
    : null;
  const ipcEndpoint = ipcEndpointFor({
    platform,
    temporaryDirectory,
    token,
  });
  return Object.freeze({
    platform,
    executable,
    mediaPath,
    resourceRoot,
    sessionDirectory,
    temporaryDirectory,
    sessionScript,
    nativeShimPath,
    ipcEndpoint,
    args: Object.freeze([
      `--script=${sessionScript}`,
      `--input-ipc-server=${ipcEndpoint}`,
      "--",
      mediaPath,
    ]),
    spawnOptions: Object.freeze({
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    }),
  });
}

async function requireRegularFile(filePath, label) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
}

async function removeMatchingDescriptor(filePath, pid, ipcEndpoint) {
  let value;
  try {
    const body = await fs.readFile(filePath, "utf8");
    if (Buffer.byteLength(body, "utf8") > 64 * 1024) return;
    value = JSON.parse(body);
  } catch (_) {
    return;
  }
  if (
    Number(value?.pid) !== Number(pid) ||
    String(value?.ipcEndpoint || "") !== ipcEndpoint
  )
    return;
  await fs.rm(filePath, { force: true }).catch(() => {});
}

async function cleanupLaunchArtifacts(plan, pid) {
  if (Number.isInteger(pid) && pid > 0) {
    await removeMatchingDescriptor(
      path.join(plan.sessionDirectory, `${pid}.json`),
      pid,
      plan.ipcEndpoint,
    );
    await removeMatchingDescriptor(
      path.join(plan.sessionDirectory, `${pid}.geometry.json`),
      pid,
      plan.ipcEndpoint,
    );
  }
  if (plan.platform !== "win32")
    await fs.rm(plan.ipcEndpoint, { force: true }).catch(() => {});
}

async function launchMpv(options = {}) {
  const plan = createMpvLaunchPlan(options);
  await requireRegularFile(plan.mediaPath, "selected media");
  await requireRegularFile(plan.sessionScript, "bundled mpv session script");
  await fs.mkdir(plan.sessionDirectory, { recursive: true, mode: 0o700 });
  if (plan.platform !== "win32")
    await fs.mkdir(path.dirname(plan.ipcEndpoint), { recursive: true, mode: 0o700 });

  const environment = {
    ...process.env,
    IINATAN_SESSION_DIR: plan.sessionDirectory,
  };
  if (plan.nativeShimPath) environment.IINATAN_NATIVE_SHIM = plan.nativeShimPath;
  const spawnProcess = options.spawnProcess || spawn;
  let child;
  try {
    child = spawnProcess(plan.executable, plan.args, {
      ...plan.spawnOptions,
      env: environment,
    });
  } catch (error) {
    throw new Error(`could not start mpv: ${error.message}`);
  }
  if (!child || typeof child.once !== "function")
    throw new Error("mpv launcher received an invalid child process");

  const closePromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      cleanupLaunchArtifacts(plan, child.pid)
        .catch(() => {})
        .then(() => resolve({ code, signal }));
    });
  });
  const handle = {
    child,
    plan,
    closePromise,
  };
  await new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`could not start mpv: ${error.message}`));
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
  return handle;
}

module.exports = {
  cleanupLaunchArtifacts,
  createMpvLaunchPlan,
  ipcEndpointFor,
  launchMpv,
};
