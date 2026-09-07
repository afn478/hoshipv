"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

function requestId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id))
    throw new Error("invalid bitmap OCR request id");
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
  throw new Error("bitmap OCR backend returned no JSON result");
}

async function writeRequest(filePath, body) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.next`;
  await fs.writeFile(temporary, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

function abortError() {
  const error = new Error("bitmap OCR request was cancelled");
  error.name = "AbortError";
  error.code = "BITMAP_OCR_ABORTED";
  return error;
}

class NativeBitmapOcrWorker {
  constructor(options = {}) {
    if (!options.executable) throw new TypeError("bitmap OCR executable is required");
    if (!options.root) throw new TypeError("bitmap OCR request root is required");
    this.executable = options.executable;
    this.root = path.resolve(options.root);
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    this.execFileProcess = options.execFileProcess || execFile;
  }

  async lookup(request, options = {}) {
    const id = requestId(request?.requestId);
    const filePath = path.join(this.root, `${id}.json`);
    await writeRequest(filePath, request);
    const signal = options.signal;
    if (signal?.aborted) {
      await fs.rm(filePath, { force: true });
      throw abortError();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let child = null;
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        fs.rm(filePath, { force: true }).catch(() => {});
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => {
        child?.kill?.();
        finish(reject, abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child = this.execFileProcess(
        this.executable,
        ["bitmap-subtitle-ocr", filePath],
        {
          timeout: this.timeoutMs,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            error.stderr = stderr;
            finish(reject, error);
            return;
          }
          try {
            finish(resolve, parseLastJson(stdout));
          } catch (parseError) {
            parseError.stderr = stderr;
            finish(reject, parseError);
          }
        },
      );
    });
  }
}

module.exports = {
  NativeBitmapOcrWorker,
  abortError,
  parseLastJson,
  requestId,
  writeRequest,
};
