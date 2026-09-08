"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { readFileBounded } = require("./bounded-file");

const NATIVE_CONTROLLER_STATE_STALE_MS = 500;
const MAX_WORKER_STATE_BYTES = 64 * 1024;
const MAX_WORKER_RESPONSE_BYTES = 8 * 1024 * 1024;

function normalizeNativeControllerState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.protocol !== 1 ||
    value.source !== "native-hid"
  )
    return null;
  const inputButtons =
    value.buttons && typeof value.buttons === "object" ? value.buttons : {};
  const inputAxes = value.axes && typeof value.axes === "object" ? value.axes : {};
  const buttonNames = [
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
  const buttons = {};
  for (const name of buttonNames) buttons[name] = inputButtons[name] === true;
  const axis = (name) => {
    const number = Number(inputAxes[name]);
    return Number.isFinite(number) ? Math.max(-1, Math.min(1, number)) : 0;
  };
  return {
    protocol: 1,
    sequence: Math.max(0, Number(value.sequence) || 0),
    updatedAt: Number(value.updatedAt),
    source: "native-hid",
    connected: value.connected === true,
    id: String(value.id || "").slice(0, 160),
    buttons,
    axes: {
      leftY: axis("leftY"),
      rightX: axis("rightX"),
      rightY: axis("rightY"),
    },
  };
}

function requestId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id))
    throw new Error("invalid HoshiDicts request id");
  return id;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseLastJson(stdout) {
  const lines = String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(lines[index]);
    } catch (_) {}
  }
  throw new Error("HoshiDicts backend returned no JSON result");
}

async function writeAtomic(filePath, body) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.next`;
  await fs.writeFile(temporary, body, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

class HoshiWorker extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.executable) throw new TypeError("HoshiDicts executable is required");
    if (!options.root) throw new TypeError("HoshiDicts worker root is required");
    this.executable = options.executable;
    this.root = options.root;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    this.pollMs = Math.max(1, Number(options.pollMs) || 4);
    this.sleepMs = Math.max(1, Number(options.sleepMs) || 2);
    this.spawnProcess = options.spawnProcess || spawn;
    this.execFileProcess = options.execFileProcess || execFile;
    this.process = null;
    this.generation = 0;
    this.active = new Map();
    this.configFingerprint = "";
    this.nativeControllerSupported =
      options.nativeControllerSupported ?? process.platform === "darwin";
    // Match iinatan's display-frame native controller polling cadence while
    // still allowing a slower bounded cadence for constrained environments.
    this.controllerPollMs = Math.max(16, Number(options.controllerPollMs) || 16);
    this.controllerRequested = false;
    this.nativeControllerAvailable = false;
    this.controllerCapability = null;
    this.controllerStateTimer = null;
    this.controllerPollInFlight = false;
    this.controllerLastSequence = -1;
    this.controllerDisconnected = false;
    this.controllerStatePath = path.isAbsolute(
      String(options.controllerStatePath || ""),
    )
      ? path.resolve(String(options.controllerStatePath))
      : "";
  }

  async configure({
    language,
    dictionaries,
    fingerprint,
    sleepMs = this.sleepMs,
    ownerPid = process.pid,
    controllerEnabled = false,
  }) {
    const dicts = Array.isArray(dictionaries)
      ? dictionaries.map(String).filter(Boolean)
      : [];
    this.generation++;
    this.sleepMs = Math.max(1, Number(sleepMs) || 2);
    this.controllerRequested =
      this.nativeControllerSupported && controllerEnabled === true;
    await this.stop();
    for (const directory of [
      "queue",
      "responses",
      "state",
      "state/acks",
      "cancellations",
    ])
      await fs.mkdir(path.join(this.root, directory), { recursive: true, mode: 0o700 });
    await fs.rm(path.join(this.root, "state", "ready.json"), { force: true });
    await fs.rm(path.join(this.root, "state", "controller.json"), { force: true });
    const config =
      [
        `fingerprint\t${String(fingerprint || `${language}:${dicts.join("|")}`)}`,
        ...dicts.map((value) => `dict\t${value}`),
      ].join("\n") + "\n";
    await writeAtomic(path.join(this.root, "config.tsv"), config);
    await fs.rm(path.join(this.root, "stop"), { force: true });
    const workerArgs = [
      "worker",
      this.root,
      "--sleep-ms",
      String(this.sleepMs),
      "--owner-pid",
      String(ownerPid),
    ];
    if (this.controllerRequested) workerArgs.push("--controller-enabled", "true");
    this.process = this.spawnProcess(this.executable, workerArgs, {
      stdio: "ignore",
      windowsHide: true,
    });
    const generation = this.generation;
    const deadline = Date.now() + this.timeoutMs;
    try {
      while (Date.now() < deadline) {
        if (generation !== this.generation)
          throw new Error("HoshiDicts worker configuration was superseded");
        try {
          const ready = JSON.parse(
            await readFileBounded(
              path.join(this.root, "state", "ready.json"),
              MAX_WORKER_STATE_BYTES,
              "utf8",
            ),
          );
          if (ready && ready.ok) {
            this.configFingerprint = String(fingerprint || "");
            this.controllerCapability = ready.controller || null;
            this.nativeControllerAvailable =
              this.controllerRequested &&
              this.controllerCapability?.source === "native-hid" &&
              this.controllerCapability?.enabled === true;
            if (this.nativeControllerAvailable) this.#startControllerPolling();
            else this.#stopControllerPolling();
            this.emit("controller-capability", {
              source: this.nativeControllerAvailable ? "native-hid" : "browser-gamepad",
              capability: this.controllerCapability,
            });
            return ready;
          }
        } catch (_) {}
        if (this.process.exitCode !== null)
          throw new Error("HoshiDicts worker exited before becoming ready");
        await delay(this.pollMs);
      }
      throw new Error("HoshiDicts worker did not become ready before timeout");
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async lookup(payload) {
    const id = requestId(payload.requestId);
    if (!this.process) throw new Error("HoshiDicts worker is not running");
    const body = { ...payload, requestId: id };
    const requestPath = path.join(this.root, "queue", `${id}.request`);
    const markerPath = path.join(this.root, "queue", `${id}.json`);
    const responsePath = path.join(this.root, "responses", `${id}.json`);
    const generation = this.generation;
    await fs.rm(responsePath, { force: true });
    await writeAtomic(requestPath, `${JSON.stringify(body)}\n`);
    await fs.writeFile(markerPath, "committed\n", { mode: 0o600 });
    const deadline = Date.now() + this.timeoutMs;
    this.active.set(id, generation);
    try {
      while (Date.now() < deadline) {
        if (generation !== this.generation)
          throw new Error("HoshiDicts lookup became stale");
        try {
          const response = JSON.parse(
            await readFileBounded(responsePath, MAX_WORKER_RESPONSE_BYTES, "utf8"),
          );
          if (response && response.ok === false) {
            const error = new Error(
              response.error || response.reason || "HoshiDicts lookup failed",
            );
            error.code = response.reason || "HOSHI_LOOKUP_FAILED";
            throw error;
          }
          return response;
        } catch (error) {
          if (error.code && error.code !== "ENOENT") throw error;
        }
        await delay(this.pollMs);
      }
      const error = new Error("HoshiDicts lookup timed out");
      error.code = "HOSHI_LOOKUP_TIMEOUT";
      throw error;
    } finally {
      this.active.delete(id);
      await Promise.all([
        fs.rm(requestPath, { force: true }),
        fs.rm(markerPath, { force: true }),
        fs.rm(responsePath, { force: true }),
      ]);
    }
  }

  async cancel(id) {
    const request = requestId(id);
    await fs.mkdir(path.join(this.root, "cancellations"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(
      path.join(this.root, "cancellations", `${request}.cancel`),
      "cancelled\n",
      { mode: 0o600 },
    );
  }

  async stop() {
    this.#stopControllerPolling();
    const worker = this.process;
    this.process = null;
    this.generation++;
    this.controllerCapability = null;
    this.nativeControllerAvailable = false;
    this.emit("controller-capability", {
      source: "browser-gamepad",
      capability: null,
    });
    if (!worker) return;
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 }).catch(() => {});
    await fs
      .writeFile(path.join(this.root, "stop"), "stop\n", { mode: 0o600 })
      .catch(() => {});
    const deadline = Date.now() + 1500;
    while (worker.exitCode === null && Date.now() < deadline) await delay(20);
    if (worker.exitCode === null) worker.kill();
    await delay(20);
  }

  #emitDisconnectedController() {
    if (this.controllerDisconnected) return;
    this.controllerDisconnected = true;
    this.emit("controller-state", {
      protocol: 1,
      sequence: 0,
      updatedAt: Date.now(),
      source: "native-hid",
      connected: false,
      id: "",
      buttons: {},
      axes: {},
    });
  }

  #stopControllerPolling() {
    const wasActive =
      this.controllerStateTimer !== null || this.controllerLastSequence >= 0;
    if (this.controllerStateTimer !== null) clearInterval(this.controllerStateTimer);
    this.controllerStateTimer = null;
    this.controllerPollInFlight = false;
    this.controllerLastSequence = -1;
    if (wasActive) this.#emitDisconnectedController();
  }

  #startControllerPolling() {
    this.#stopControllerPolling();
    this.controllerDisconnected = false;
    this.controllerStateTimer = setInterval(
      () => this.#pollControllerState(),
      this.controllerPollMs,
    );
    this.controllerStateTimer.unref?.();
    void this.#pollControllerState();
  }

  async #pollControllerState() {
    if (this.controllerPollInFlight || !this.process || !this.nativeControllerAvailable)
      return;
    this.controllerPollInFlight = true;
    try {
      const statePaths = [
        ...(this.controllerStatePath ? [this.controllerStatePath] : []),
        path.join(this.root, "state", "controller.json"),
      ];
      let value = null;
      for (const statePath of statePaths) {
        try {
          value = JSON.parse(
            await readFileBounded(statePath, MAX_WORKER_STATE_BYTES, "utf8"),
          );
          break;
        } catch (_) {}
      }
      if (!value) {
        this.#emitDisconnectedController();
        return;
      }
      const snapshot = normalizeNativeControllerState(value);
      if (!snapshot) {
        this.#emitDisconnectedController();
        return;
      }
      const age = Date.now() - snapshot.updatedAt;
      if (
        !Number.isFinite(snapshot.updatedAt) ||
        age > NATIVE_CONTROLLER_STATE_STALE_MS
      ) {
        this.#emitDisconnectedController();
        return;
      }
      // The native HID helper may keep an analog axis at the same value for
      // several polls. Forward the current snapshot at the worker cadence
      // instead of waiting for the helper's file sequence to change; the
      // renderer needs those steady samples to integrate proportional stick
      // scrolling without 250 ms jumps.
      this.controllerLastSequence = snapshot.sequence;
      if (snapshot.connected || !this.controllerDisconnected)
        this.emit("controller-state", snapshot);
      this.controllerDisconnected = snapshot.connected === false;
    } finally {
      this.controllerPollInFlight = false;
    }
  }

  async importDictionary(zipPath, dictionaryRoot, options = {}) {
    const rawSource = String(zipPath || "");
    const rawTarget = String(dictionaryRoot || "");
    if (!path.isAbsolute(rawSource) || !path.isAbsolute(rawTarget))
      throw new Error("dictionary paths must be absolute");
    const source = path.normalize(rawSource);
    const target = path.normalize(rawTarget);
    if (!source.toLowerCase().endsWith(".zip"))
      throw new Error("dictionary import requires a .zip file");
    const args = [
      "import",
      source,
      target,
      options.lowRam === false ? "--normal-ram" : "--low-ram",
    ];
    return new Promise((resolve, reject) => {
      this.execFileProcess(
        this.executable,
        args,
        {
          timeout: Number(options.timeoutMs) || 1800000,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            error.stderr = stderr;
            reject(error);
            return;
          }
          try {
            resolve(parseLastJson(stdout));
          } catch (parseError) {
            parseError.stderr = stderr;
            reject(parseError);
          }
        },
      );
    });
  }
}

module.exports = {
  HoshiWorker,
  normalizeNativeControllerState,
  parseLastJson,
  requestId,
  writeAtomic,
};
