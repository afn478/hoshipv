"use strict";

const { EventEmitter } = require("node:events");
const path = require("node:path");
const { makeEnvelope, validateHostRequest } = require("../bridge/protocol");
const { roundNativeBounds } = require("../geometry/coordinate-mapper");

function normalizeControllerSource(source) {
  const value = String(source || "");
  if (value === "native-hid" || value === "native-hid+browser-gamepad") return value;
  return "browser-gamepad";
}

class BrowserHost extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.BrowserWindow) throw new TypeError("BrowserWindow is required");
    this.BrowserWindow = options.BrowserWindow;
    this.platform = options.platform || process.platform;
    this.globalShortcut = options.globalShortcut || null;
    this.ipcMain = options.ipcMain || null;
    this.preloadPath =
      options.preloadPath || path.join(process.cwd(), "app", "preload.js");
    this.overlayUrl = options.overlayUrl || "iinatan://overlay/overlay.html";
    this.highlightWindow = null;
    this.popupWindow = null;
    this.sessionId = null;
    this.geometryGeneration = 0;
    this.contentBounds = null;
    this.popupVisible = false;
    this.playerForeground = false;
    this.closeRequested = false;
    this.requestsBound = false;
    this.ipcListener = null;
    this.readySurfaces = new Set();
    this.controllerSource = normalizeControllerSource(options.controllerSource);
    this.popupEscapeRegistered = false;
    this.#bindIpc();
  }

  #sendCapabilities(surface) {
    const window = surface === "popup" ? this.popupWindow : this.highlightWindow;
    if (!window || window.isDestroyed() || !this.readySurfaces.has(surface)) return;
    this.send(surface, "capabilities", {
      surface,
      host: "electron-browser-window",
      transport: "dom",
      transparent: true,
      offscreen: false,
      bitmapTransport: false,
      inputMode: surface === "popup" ? "interactive-native" : "passive-forwarded",
      wholeWindowIgnoreMouseEvents: typeof window.setIgnoreMouseEvents === "function",
      browserSelection: surface === "popup",
      pointerCapture: surface === "popup",
      controller: { source: this.controllerSource },
    });
  }

  setControllerSource(source) {
    this.controllerSource = normalizeControllerSource(source);
    this.#sendCapabilities("highlight");
    this.#sendCapabilities("popup");
  }

  #bindIpc() {
    if (!this.ipcMain || this.requestsBound) return;
    this.requestsBound = true;
    this.ipcListener = (event, raw) => {
      const window = [this.highlightWindow, this.popupWindow].find(
        (candidate) => candidate && candidate.webContents.id === event.sender.id,
      );
      if (!window) return;
      const message = {
        ...(raw && typeof raw === "object" ? raw : {}),
        sessionId: this.sessionId || undefined,
        geometryGeneration: this.geometryGeneration,
      };
      try {
        validateHostRequest(message);
      } catch (error) {
        this.emit("protocol-error", error, raw);
        return;
      }
      if (message.type === "ready") {
        const surface = window === this.popupWindow ? "popup" : "highlight";
        this.readySurfaces.add(surface);
        this.#sendCapabilities(surface);
        if (surface === "popup" && this.popupVisible) {
          window.setIgnoreMouseEvents(false);
          window.showInactive();
          window.focus();
        }
      }
      this.emit("request", {
        surface: window === this.popupWindow ? "popup" : "highlight",
        message,
        window,
      });
    };
    this.ipcMain.on("host-request", this.ipcListener);
  }

  #windowOptions(surface) {
    return {
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: surface === "popup",
      fullscreenable: false,
      alwaysOnTop: false,
      // Electron maps the macOS panel type to NSWindowStyleMaskNonactivatingPanel.
      // This lets an interactive popup cover a native fullscreen player without
      // activating the companion application when the panel is shown or clicked.
      ...(this.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    };
  }

  async create() {
    this.#bindIpc();
    this.closeRequested = false;
    const loads = [];
    if (!this.highlightWindow) {
      this.highlightWindow = this.#createWindow("highlight");
      loads.push(this.highlightWindow.loadURL(`${this.overlayUrl}?surface=highlight`));
    }
    if (!this.popupWindow) {
      this.popupWindow = this.#createWindow("popup");
      loads.push(this.popupWindow.loadURL(`${this.overlayUrl}?surface=popup`));
    }
    await Promise.all(loads);
    this.setPassiveInput();
    return this;
  }

  #createWindow(surface) {
    const window = new this.BrowserWindow(this.#windowOptions(surface));
    window.setMenuBarVisibility(false);
    window.setAlwaysOnTop(false);
    window.on("closed", () => {
      this.readySurfaces.delete(surface);
      if (surface === "highlight" && this.highlightWindow === window)
        this.highlightWindow = null;
      if (surface === "popup") {
        const wasVisible = this.popupVisible;
        this.#unregisterPopupEscape();
        if (this.popupWindow === window) this.popupWindow = null;
        this.popupVisible = false;
        if (wasVisible) this.emit("popup-closed");
      }
      this.emit("closed", surface);
      if (!this.closeRequested) this.emit("surface-closed", surface);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    return window;
  }

  #registerPopupEscape() {
    if (
      this.platform !== "darwin" ||
      this.popupEscapeRegistered ||
      typeof this.globalShortcut?.register !== "function"
    )
      return;
    const registered = this.globalShortcut.register("Escape", () => {
      if (!this.popupVisible) return;
      this.emit("request", {
        surface: "popup",
        window: this.popupWindow,
        message: makeEnvelope(
          "popup-action",
          { action: "escape" },
          {
            sessionId: this.sessionId || undefined,
            geometryGeneration: this.geometryGeneration,
          },
        ),
      });
    });
    if (registered === true) this.popupEscapeRegistered = true;
  }

  #unregisterPopupEscape() {
    if (!this.popupEscapeRegistered) return;
    this.globalShortcut?.unregister?.("Escape");
    this.popupEscapeRegistered = false;
  }

  setSessionContext(sessionId, geometryGeneration) {
    this.sessionId = sessionId || null;
    this.geometryGeneration = Number.isInteger(geometryGeneration)
      ? geometryGeneration
      : 0;
    this.#sendCapabilities("highlight");
    this.#sendCapabilities("popup");
  }

  setContentBounds(value) {
    if (!value) return;
    this.contentBounds = roundNativeBounds(value);
    for (const window of [this.highlightWindow, this.popupWindow]) {
      if (window && !window.isDestroyed() && !this.popupVisible)
        window.setBounds(this.contentBounds, false);
    }
    if (this.popupVisible && this.popupWindow && !this.popupWindow.isDestroyed())
      this.popupWindow.setBounds(this.contentBounds, false);
  }

  setPlayerForeground(value) {
    this.playerForeground = value === true;
    this.#updateStacking();
  }

  #updateStacking() {
    const ownedForeground = this.playerForeground || this.hasSessionFocus();
    for (const window of [this.highlightWindow, this.popupWindow]) {
      if (
        !window ||
        window.isDestroyed() ||
        typeof window.setAlwaysOnTop !== "function"
      )
        continue;
      try {
        const popupOwnsInput = this.popupVisible && window === this.popupWindow;
        window.setAlwaysOnTop(
          ownedForeground &&
            (window === this.highlightWindow || !this.popupVisible || popupOwnsInput),
          "floating",
        );
      } catch (error) {
        this.emit("stacking-error", error);
      }
    }
    if (this.popupVisible) this.#raisePopup();
  }

  #raisePopup() {
    if (
      !this.popupVisible ||
      !this.popupWindow ||
      this.popupWindow.isDestroyed() ||
      typeof this.popupWindow.moveTop !== "function"
    )
      return;
    try {
      this.popupWindow.moveTop();
    } catch (error) {
      this.emit("stacking-error", error);
    }
  }

  send(surface, type, payload, context = {}) {
    const window = surface === "popup" ? this.popupWindow : this.highlightWindow;
    if (!window || window.isDestroyed()) return false;
    const message = makeEnvelope(type, payload, {
      sessionId: context.sessionId || this.sessionId || undefined,
      geometryGeneration:
        context.geometryGeneration === undefined
          ? this.geometryGeneration
          : context.geometryGeneration,
      requestId: context.requestId,
    });
    window.webContents.send("host-event", message);
    return true;
  }

  showHighlight(payload) {
    if (!this.highlightWindow || this.highlightWindow.isDestroyed()) return;
    this.#updateStacking();
    if (this.popupVisible) this.highlightWindow.setIgnoreMouseEvents(true);
    else this.highlightWindow.setIgnoreMouseEvents(true, { forward: true });
    this.highlightWindow.showInactive();
    if (this.popupVisible) this.#raisePopup();
    this.send("highlight", "geometry", payload);
  }

  hideHighlight() {
    if (this.highlightWindow && !this.highlightWindow.isDestroyed())
      this.highlightWindow.hide();
  }

  showPopup(payload) {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return;
    this.popupVisible = true;
    if (this.highlightWindow && !this.highlightWindow.isDestroyed()) {
      this.highlightWindow.setIgnoreMouseEvents(true);
      this.highlightWindow.showInactive();
    }
    if (this.contentBounds) this.popupWindow.setBounds(this.contentBounds, false);
    // Keep the full transparent window hidden until the renderer has sent its
    // readiness message. This closes the startup/recovery race where a blank
    // popup surface could otherwise receive native input before its DOM event
    // handlers and capability contract were installed.
    if (this.readySurfaces.has("popup")) {
      this.popupWindow.setIgnoreMouseEvents(false);
      this.popupWindow.showInactive();
      this.popupWindow.focus();
    } else {
      this.popupWindow.hide();
    }
    this.#registerPopupEscape();
    this.#updateStacking();
    this.#raisePopup();
    this.send("popup", "popup-state", { visible: true, ...payload });
  }

  hidePopup({ focusPlayer = true } = {}) {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return;
    this.popupVisible = false;
    this.#unregisterPopupEscape();
    this.send("popup", "popup-state", { visible: false });
    this.popupWindow.hide();
    if (this.highlightWindow && !this.highlightWindow.isDestroyed()) {
      this.highlightWindow.setIgnoreMouseEvents(true, { forward: true });
      this.highlightWindow.showInactive();
    }
    this.#updateStacking();
    if (focusPlayer) this.emit("focus-player");
  }

  setPassiveInput() {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.setIgnoreMouseEvents(true, { forward: true });
      if (!this.popupVisible) this.popupWindow.hide();
    }
    if (this.highlightWindow && !this.highlightWindow.isDestroyed())
      this.highlightWindow.setIgnoreMouseEvents(true, { forward: true });
    this.#updateStacking();
  }

  setInteractiveInput() {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return;
    if (this.readySurfaces.has("popup")) {
      this.popupWindow.setIgnoreMouseEvents(false);
      this.#updateStacking();
      this.#raisePopup();
    }
  }

  hasSessionFocus() {
    return !!(
      this.popupVisible &&
      this.popupWindow &&
      !this.popupWindow.isDestroyed() &&
      typeof this.popupWindow.isFocused === "function" &&
      this.popupWindow.isFocused()
    );
  }

  surfaceReadiness() {
    return Object.freeze({
      highlight: this.readySurfaces.has("highlight"),
      popup: this.readySurfaces.has("popup"),
    });
  }

  close() {
    this.closeRequested = true;
    this.#unregisterPopupEscape();
    if (this.ipcMain && this.ipcListener) {
      this.ipcMain.removeListener("host-request", this.ipcListener);
      this.ipcListener = null;
      this.requestsBound = false;
    }
    for (const window of [this.highlightWindow, this.popupWindow]) {
      if (window && !window.isDestroyed()) window.close();
    }
    this.highlightWindow = null;
    this.popupWindow = null;
    this.popupVisible = false;
    this.playerForeground = false;
    this.readySurfaces.clear();
  }
}

module.exports = { BrowserHost };
