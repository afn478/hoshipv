"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

function requestId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id))
    throw new Error("invalid native geometry request id");
  return id;
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
  throw new Error("native geometry backend returned no JSON result");
}

async function writeRequest(filePath, body) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.next`;
  await fs.writeFile(temporary, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

class NativeGeometryWorker {
  constructor(options = {}) {
    if (!options.executable)
      throw new TypeError("native geometry executable is required");
    if (!options.root) throw new TypeError("native geometry request root is required");
    this.executable = options.executable;
    this.root = path.resolve(options.root);
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    this.execFileProcess = options.execFileProcess || execFile;
  }

  async lookup(request) {
    const id = requestId(request?.requestId);
    const filePath = path.join(this.root, `${id}.json`);
    await writeRequest(filePath, request);
    return new Promise((resolve, reject) => {
      this.execFileProcess(
        this.executable,
        ["ass-geometry", filePath],
        { timeout: this.timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          fs.rm(filePath, { force: true }).catch(() => {});
          if (error) {
            error.stderr = stderr;
            const details = [
              error.code !== undefined ? `code=${error.code}` : "",
              error.signal ? `signal=${error.signal}` : "",
              error.killed ? "killed=true" : "",
              stderr ? `stderr=${String(stderr).trim()}` : "",
            ].filter(Boolean);
            if (details.length)
              error.message = `${error.message.trim()} (${details.join(", ")})`;
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

module.exports = { NativeGeometryWorker, parseLastJson, requestId, writeRequest };
