"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const allowedRequests = new Set([
  "get-state",
  "save-profile",
  "set-active-profile",
  "create-profile",
  "delete-profile",
  "reset-profile",
  "anki-inspect",
  "import-dictionary",
  "download-recommended",
  "set-dictionary-enabled",
  "remove-dictionary",
  "reorder-dictionaries",
  "export-backup",
  "restore-backup",
]);

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

contextBridge.exposeInMainWorld("iinatanSettings", {
  request(type, payload = {}) {
    if (!allowedRequests.has(type) || !plainObject(payload))
      return Promise.reject(new TypeError("invalid settings request"));
    const serialized = JSON.stringify(payload);
    if (serialized.length > 1024 * 1024)
      return Promise.reject(new Error("settings request is too large"));
    return ipcRenderer.invoke("settings-request", { protocol: 1, type, payload });
  },
});
