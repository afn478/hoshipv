"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readFileBounded } = require("../services/bounded-file");

const MAX_DESCRIPTOR_BYTES = 64 * 1024;
const GEOMETRY_SIDECAR_PATTERN = /^(\d+)\.geometry\.json(?:\.next)?$/u;

function validString(value, max = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function normalizeDescriptor(value) {
  if (!value || typeof value !== "object")
    throw new TypeError("session descriptor must be an object");
  const sessionId = String(value.sessionId || "");
  const ipcEndpoint = String(value.ipcEndpoint || "");
  const pid = Number(value.pid);
  const windowId =
    value.windowId === undefined || value.windowId === null
      ? null
      : String(value.windowId);
  if (!validString(sessionId, 160) || !/^[A-Za-z0-9._:-]+$/.test(sessionId))
    throw new Error("invalid session id");
  if (!validString(ipcEndpoint, 1024)) throw new Error("invalid mpv IPC endpoint");
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("invalid mpv pid");
  if (windowId !== null && windowId.length > 256)
    throw new Error("invalid window identity");
  return Object.freeze({
    sessionId,
    pid,
    windowId,
    ipcEndpoint,
    startedAt: String(value.startedAt || ""),
    protocol: Number(value.protocol) || 1,
    backend: String(value.backend || "unknown"),
  });
}

async function readDescriptor(filePath) {
  const value = JSON.parse(
    await readFileBounded(filePath, MAX_DESCRIPTOR_BYTES, "utf8"),
  );
  return normalizeDescriptor(value);
}

async function reapStaleGeometrySidecars(directory, names) {
  await Promise.all(
    names.map(async (name) => {
      const match = GEOMETRY_SIDECAR_PATTERN.exec(name);
      if (!match || isProcessAlive(Number(match[1]))) return;
      try {
        await fs.unlink(path.join(directory, name));
      } catch (error) {
        if (error.code !== "ENOENT") return;
      }
    }),
  );
}

async function listDescriptors(directory) {
  const names = await fs.readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  await reapStaleGeometrySidecars(directory, names);
  const descriptors = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    try {
      descriptors.push(await readDescriptor(path.join(directory, name)));
    } catch (_) {
      // A sidecar writes descriptors atomically; a partial or stale file is not
      // a player identity and is intentionally ignored.
    }
  }
  return descriptors;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function sameSession(left, right) {
  return (
    !!left &&
    !!right &&
    left.sessionId === right.sessionId &&
    left.pid === right.pid &&
    left.windowId === right.windowId
  );
}

module.exports = {
  isProcessAlive,
  listDescriptors,
  normalizeDescriptor,
  reapStaleGeometrySidecars,
  readDescriptor,
  sameSession,
};
