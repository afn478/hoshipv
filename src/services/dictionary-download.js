"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_DOWNLOAD_LIMIT = 2 * 1024 * 1024 * 1024;
const DEFAULT_REDIRECT_LIMIT = 5;

function cancellationError() {
  return Object.assign(new Error("dictionary download cancelled"), {
    name: "AbortError",
  });
}

function declaredContentLength(response) {
  const raw = response.headers?.get?.("content-length");
  if (raw === null || raw === undefined || String(raw).trim() === "") return NaN;
  const length = Number(raw);
  return Number.isFinite(length) && length >= 0 ? length : NaN;
}

function safeDictionaryDownloadUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.href;
  } catch (_) {
    return "";
  }
}

async function downloadFile(url, destination, options = {}) {
  const firstUrl = safeDictionaryDownloadUrl(url);
  if (!firstUrl) throw new Error("recommended dictionary URL must use HTTPS");
  const rawDestination = String(destination || "").trim();
  if (!path.isAbsolute(rawDestination))
    throw new Error("dictionary download path must be absolute");
  const target = path.normalize(rawDestination);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw new TypeError("dictionary download fetch is unavailable");
  const requestedMaximumBytes = Number(options.maximumBytes);
  const maximumBytes =
    Number.isFinite(requestedMaximumBytes) && requestedMaximumBytes > 0
      ? requestedMaximumBytes
      : DEFAULT_DOWNLOAD_LIMIT;
  const maximumRedirects = Math.max(
    0,
    Number.isInteger(options.maximumRedirects)
      ? options.maximumRedirects
      : DEFAULT_REDIRECT_LIMIT,
  );
  const controller = new AbortController();
  const requestedTimeoutMs = Number(options.timeoutMs);
  const timeoutMs =
    Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? Math.max(1000, requestedTimeoutMs)
      : 300000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.download`,
  );
  let handle = null;
  try {
    let currentUrl = firstUrl;
    let response;
    for (let redirect = 0; redirect <= maximumRedirects; redirect++) {
      response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "application/zip, application/octet-stream" },
      });
      if (controller.signal.aborted) throw cancellationError();
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirect === maximumRedirects)
        throw new Error("recommended dictionary download redirected too many times");
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("recommended dictionary redirect has no location");
      const next = safeDictionaryDownloadUrl(new URL(String(location), currentUrl));
      if (!next) throw new Error("recommended dictionary redirect is not HTTPS");
      currentUrl = next;
    }
    if (!response?.ok)
      throw new Error(`dictionary download HTTP ${response?.status || 0}`);
    const length = declaredContentLength(response);
    if (Number.isFinite(length) && length > maximumBytes)
      throw new Error("recommended dictionary exceeds the download size limit");
    const reader = response.body?.getReader?.();
    if (!reader)
      throw new Error("dictionary download does not expose a bounded stream");
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    handle = await fs.open(temporary, "wx", 0o600);
    let total = 0;
    try {
      while (true) {
        if (controller.signal.aborted) throw cancellationError();
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        total += chunk.length;
        if (total > maximumBytes) {
          await reader.cancel();
          throw new Error("recommended dictionary exceeds the download size limit");
        }
        await handle.write(chunk);
        options.onProgress?.({
          bytes: total,
          totalBytes: Number.isFinite(length) ? length : null,
        });
      }
    } finally {
      reader.releaseLock?.();
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
    return { url: currentUrl, path: target, bytes: total };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (options.signal?.aborted || error?.name === "AbortError") {
      throw cancellationError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

module.exports = {
  DEFAULT_DOWNLOAD_LIMIT,
  DEFAULT_REDIRECT_LIMIT,
  downloadFile,
  safeDictionaryDownloadUrl,
};
