"use strict";

const fsPromises = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { rect } = require("../geometry/coordinate-mapper");

function runProbe(executable, descriptor, timeoutMs, activate = false) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        "--pid",
        String(descriptor.pid),
        ...(descriptor.windowId ? ["--window-id", descriptor.windowId] : []),
        ...(activate ? ["--activate"] : []),
      ],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop()));
        } catch (parseError) {
          parseError.stdout = stdout;
          reject(parseError);
        }
      },
    );
  });
}

class NativeWindowAdapter {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.screen = options.screen || null;
    this.sessionType = String(
      options.sessionType || process.env.XDG_SESSION_TYPE || "",
    ).toLowerCase();
    this.sessionDirectory = options.sessionDirectory
      ? path.resolve(String(options.sessionDirectory))
      : "";
    const executableName =
      this.platform === "win32" ? "iinatan-window-probe.exe" : "iinatan-window-probe";
    const root = options.resourceRoot || process.cwd();
    const candidates = [
      path.join(root, "bin", executableName),
      path.join(root, "build", "native", executableName),
      path.join(root, "build", "native", "Release", executableName),
    ];
    this.probeExecutable =
      options.probeExecutable ||
      candidates.find((value) => fs.existsSync(value)) ||
      candidates[0];
    this.probe =
      options.probe ||
      ((descriptor) =>
        runProbe(this.probeExecutable, descriptor, options.timeoutMs || 1200));
    this.activate =
      options.activate ||
      ((descriptor) =>
        runProbe(this.probeExecutable, descriptor, options.timeoutMs || 1200, true));
    this.last = null;
  }

  #toDesktopLogical(result) {
    if (
      !["win32", "linux"].includes(this.platform) ||
      result.coordinateSpace !== "desktop-physical"
    )
      return result;
    if (typeof this.screen?.screenToDipPoint !== "function") {
      const error = new Error(
        "physical window geometry requires Electron DIP conversion",
      );
      error.code = "WINDOW_COORDINATE_CONVERSION_UNAVAILABLE";
      throw error;
    }
    let physical;
    try {
      physical = rect(result.content, "physical player content");
    } catch (error) {
      error.code = "INVALID_PLAYER_WINDOW_GEOMETRY";
      throw error;
    }
    let topLeft;
    let bottomRight;
    try {
      topLeft = this.screen.screenToDipPoint({ x: physical.x, y: physical.y });
      bottomRight = this.screen.screenToDipPoint({
        x: physical.x + physical.width,
        y: physical.y + physical.height,
      });
    } catch (error) {
      const conversionError = new Error(
        `physical window geometry could not be converted to DIP: ${error.message}`,
      );
      conversionError.code = "WINDOW_COORDINATE_CONVERSION_FAILED";
      throw conversionError;
    }
    const content = {
      x: Number(topLeft?.x),
      y: Number(topLeft?.y),
      width: Number(bottomRight?.x) - Number(topLeft?.x),
      height: Number(bottomRight?.y) - Number(topLeft?.y),
    };
    try {
      return {
        ...result,
        content: rect(content, "logical player content"),
        coordinateSpace: "desktop-logical",
      };
    } catch (error) {
      error.code = "INVALID_PLAYER_WINDOW_GEOMETRY";
      throw error;
    }
  }

  async #readInProcessGeometry(descriptor, observed = {}) {
    if (this.platform !== "darwin" || !this.sessionDirectory) return null;
    const pid = Number(descriptor.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const filePath = path.join(this.sessionDirectory, `${pid}.geometry.json`);
    try {
      const stat = await fsPromises.stat(filePath);
      if (!stat.isFile() || stat.size > 64 * 1024) return null;
      const value = JSON.parse(await fsPromises.readFile(filePath, "utf8"));
      if (
        !value ||
        value.protocol !== 1 ||
        Number(value.pid) !== pid ||
        value.windowId === undefined ||
        value.windowId === null ||
        value.contentExact !== true ||
        value.contentSource !== "appkit-content-view"
      )
        return null;
      if (descriptor.windowId && String(value.windowId) !== String(descriptor.windowId))
        return null;
      if (
        observed.windowId !== undefined &&
        observed.windowId !== null &&
        String(value.windowId) !== String(observed.windowId)
      )
        return null;
      const content = rect(value.content, "in-process player content");
      return {
        content,
        contentSource: value.contentSource,
        contentExact: true,
        isForeground:
          typeof value.isForeground === "boolean"
            ? value.isForeground
            : observed.isForeground,
        windowId: value.windowId,
        inProcessShim: true,
        ...(typeof value.fullscreenObserved === "boolean"
          ? {
              fullscreenObserved: value.fullscreenObserved,
              fullscreenEvidence: String(
                value.fullscreenEvidence || "appkit-window-style-mask",
              ),
            }
          : {}),
      };
    } catch (_) {
      return null;
    }
  }

  capability() {
    if (this.platform === "darwin")
      return {
        backend: "macos-window-list",
        exactContent: false,
        needsPlayerShimForWindowed: true,
      };
    if (this.platform === "win32")
      return {
        backend: "windows-client-area",
        exactContent: true,
        needsPlayerShimForWindowed: false,
      };
    if (this.sessionType === "wayland")
      return {
        backend: "wayland",
        supported: false,
        reason:
          "generic Wayland does not provide a universal cross-client exact attachment mechanism",
      };
    return {
      backend: "x11-or-xwayland",
      exactContent: false,
      needsPlayerShimForWindowed: true,
    };
  }

  async read(descriptor) {
    const capability = this.capability();
    if (capability.supported === false) {
      const error = new Error(capability.reason);
      error.code = "UNSUPPORTED_WINDOW_BACKEND";
      throw error;
    }
    // mpv can expose a small auxiliary CoreGraphics window while its real
    // fullscreen content window is in a separate native window. The
    // in-process AppKit sidecar carries that window's identity, so use it to
    // target the external probe before falling back to the unqualified scan.
    const inProcessCandidate = await this.#readInProcessGeometry(descriptor);
    const probeDescriptors =
      inProcessCandidate && !descriptor.windowId
        ? [{ ...descriptor, windowId: String(inProcessCandidate.windowId) }, descriptor]
        : [descriptor];
    let result = null;
    let probeError = null;
    for (const probeDescriptor of probeDescriptors) {
      try {
        const observed = await this.probe(probeDescriptor);
        if (observed?.ok === true && observed.content) {
          result = observed;
          break;
        }
        result = observed;
      } catch (error) {
        probeError = error;
      }
    }
    if (!result || result.ok !== true || !result.content) {
      if (inProcessCandidate) {
        const fallback = {
          ...inProcessCandidate,
          capability: {
            ...capability,
            backend: "macos-appkit-content-shim",
            exactContent: true,
            needsPlayerShimForWindowed: false,
          },
          windowProbeFallback: true,
        };
        this.last = Object.freeze(fallback);
        return this.last;
      }
      if (probeError) throw probeError;
      const error = new Error(
        (result && result.reason) || "player window was not found",
      );
      error.code = "PLAYER_WINDOW_NOT_FOUND";
      throw error;
    }
    const logicalResult = this.#toDesktopLogical(result);
    let content;
    try {
      content = rect(logicalResult.content, "player content");
    } catch (error) {
      error.code = "INVALID_PLAYER_WINDOW_GEOMETRY";
      throw error;
    }
    const inProcess = await this.#readInProcessGeometry(descriptor, logicalResult);
    const effectiveCapability = inProcess
      ? {
          ...capability,
          backend: "macos-appkit-content-shim",
          exactContent: true,
          needsPlayerShimForWindowed: false,
        }
      : capability;
    const geometry = {
      ...logicalResult,
      content,
      ...inProcess,
      capability: effectiveCapability,
    };
    this.last = Object.freeze(geometry);
    return this.last;
  }

  async focus(descriptor) {
    if (!descriptor) return { ok: false, reason: "missing-descriptor" };
    return this.activate(descriptor);
  }
}

module.exports = { NativeWindowAdapter, runProbe };
