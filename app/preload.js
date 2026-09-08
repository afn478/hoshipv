"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();
const allowedTypes = new Set([
  "ready",
  "pointer-move",
  "lookup",
  "nested-lookup",
  "nested-lookup-cancel",
  "popup-action",
  "popup-region",
  "popup-scroll",
  "popup-size",
  "popup-style",
  "dismiss-popup",
  "player-command",
  "external-link",
  "audio-source",
  "audio-anki-selection",
  "anki-action",
  "controller-state",
  "settings-open",
  "diagnostic",
]);

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

ipcRenderer.on("host-event", (_event, message) => {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (_) {
      // Renderer listeners must not prevent delivery to the remaining surface.
    }
  }
});

contextBridge.exposeInMainWorld("iinatanHost", {
  send(type, payload = {}) {
    if (!allowedTypes.has(type) || !plainObject(payload))
      throw new TypeError("invalid iinatan host request");
    const serialized = JSON.stringify(payload);
    if (serialized.length > 512 * 1024)
      throw new Error("iinatan host request is too large");
    ipcRenderer.send("host-request", { protocol: 1, type, payload });
  },
  onEvent(listener) {
    if (typeof listener !== "function")
      throw new TypeError("event listener must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});
