"use strict";

const net = require("node:net");
const { EventEmitter } = require("node:events");

const MAX_IPC_MESSAGE_BYTES = 8 * 1024 * 1024;

function timeoutError(message) {
  const error = new Error(message);
  error.code = "MPV_IPC_TIMEOUT";
  return error;
}

class MpvJsonIpc extends EventEmitter {
  constructor(endpoint, options = {}) {
    super();
    if (!endpoint || typeof endpoint !== "string")
      throw new TypeError("mpv IPC endpoint is required");
    this.endpoint = endpoint;
    this.timeoutMs = Math.max(100, Number(options.timeoutMs) || 3000);
    this.createConnection =
      options.createConnection || ((value) => net.createConnection(value));
    this.socket = null;
    this.buffer = "";
    this.nextRequestId = 1;
    this.pending = new Map();
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;
    await new Promise((resolve, reject) => {
      const socket = this.createConnection(this.endpoint);
      let timer;
      const fail = (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      };
      timer = setTimeout(
        () => fail(timeoutError("mpv IPC connection timed out")),
        this.timeoutMs,
      );
      socket.once("error", fail);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.removeListener("error", fail);
        this.socket = socket;
        this.connected = true;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => this.#onData(chunk));
        socket.on("error", (error) => this.#fail(error));
        socket.on("close", () => this.#fail(new Error("mpv IPC connection closed")));
        resolve();
      });
    });
  }

  async request(command, ...args) {
    await this.connect();
    const requestId = this.nextRequestId++;
    const message = { command: [command, ...args], request_id: requestId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(timeoutError(`mpv IPC request timed out: ${command}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify(message)}\n`);
    });
  }

  async observeProperty(name) {
    const observerId = this.nextRequestId;
    return this.request("observe_property", observerId, String(name));
  }

  async command(...args) {
    // JSON IPC commands are already expressed as the top-level command
    // array. Wrapping `args` in a second `command` entry produces
    // `["command", ["seek", ...]]`, which mpv rejects as an invalid
    // parameter. Property requests use `request()` directly; input commands
    // must preserve their flat shape here.
    return this.request(...args);
  }

  async getProperty(name) {
    const result = await this.request("get_property", String(name));
    return result.data;
  }

  async setProperty(name, value) {
    const result = await this.request("set_property", String(name), value);
    return result.data;
  }

  close() {
    if (this.socket) this.socket.destroy();
    this.#fail(new Error("mpv IPC client closed"));
  }

  #onData(chunk) {
    this.buffer += String(chunk || "");
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_IPC_MESSAGE_BYTES) {
      this.buffer = "";
      const error = new Error("mpv IPC message exceeds the size limit");
      error.code = "MPV_IPC_MESSAGE_TOO_LARGE";
      this.#fail(error);
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_IPC_MESSAGE_BYTES) {
        const error = new Error("mpv IPC message exceeds the size limit");
        error.code = "MPV_IPC_MESSAGE_TOO_LARGE";
        this.#fail(error);
        return;
      }
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.emit("protocol-error", error, line);
        continue;
      }
      if (message.request_id !== undefined && this.pending.has(message.request_id)) {
        const pending = this.pending.get(message.request_id);
        this.pending.delete(message.request_id);
        clearTimeout(pending.timer);
        if (message.error && message.error !== "success") {
          const error = new Error(
            `mpv rejected ${message.request_id}: ${message.error}`,
          );
          error.code = message.error;
          pending.reject(error);
        } else {
          pending.resolve(message);
        }
      } else if (message.event) {
        this.emit("event", message);
        if (message.event === "property-change")
          this.emit("property-change", message.name, message.data);
      }
    }
  }

  #fail(error) {
    if (!this.connected && !this.pending.size) return;
    this.connected = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit("closed", error);
  }
}

module.exports = { MpvJsonIpc, timeoutError };
