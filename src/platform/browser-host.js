"use strict";

const { EventEmitter } = require("node:events");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeEnvelope, validateHostRequest } = require("../bridge/protocol");
const { roundNativeBounds } = require("../geometry/coordinate-mapper");

const WINDOWS_POPUP_FOCUS_HANDOFF_GRACE_MS = 1500;

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
    this.windowTransitionProbe =
      options.windowTransitionProbe &&
      fs.existsSync(String(options.windowTransitionProbe))
        ? String(options.windowTransitionProbe)
        : "";
    this.preloadPath =
      options.preloadPath || path.join(process.cwd(), "app", "preload.js");
    this.overlayUrl = options.overlayUrl || "iinatan://overlay/overlay.html";
    this.highlightWindow = null;
    this.popupWindow = null;
    this.sessionId = null;
    this.geometryGeneration = 0;
    this.contentBounds = null;
    this.popupVisible = false;
    this.popupPainted = false;
    this.playerForeground = false;
    this.popupFocusHandoffUntil = 0;
    this.closeRequested = false;
    this.requestsBound = false;
    this.ipcListener = null;
    this.windowTransitionStates = new Map();
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
      const surface = window === this.popupWindow ? "popup" : "highlight";
      if (message.type === "ready") {
        this.readySurfaces.add(surface);
        this.#sendCapabilities(surface);
        if (surface === "popup" && this.platform === "win32") {
          this.#setPopupOpacity(this.popupVisible && this.popupPainted ? 1 : 0);
          this.#ensurePopupSurfaceVisible();
        }
        if (surface === "popup" && this.popupVisible) {
          if (this.popupPainted) this.#revealPopup();
          else {
            window.setIgnoreMouseEvents(true, { forward: true });
            if (this.platform === "win32") this.#setPopupOpacity(0);
            else window.hide();
          }
        }
      }
      if (surface === "popup" && message.type === "popup-painted") {
        this.popupPainted = true;
        this.#revealPopup();
      }
      if (
        surface === "popup" &&
        this.popupVisible &&
        ["popup-action", "popup-selection"].includes(message.type)
      ) {
        // Native mouse selection and wheel delivery can leave a transparent
        // Windows surface visually active while the OS focus owner changes.
        // Reassert ownership at the host boundary before forwarding the
        // action so keyboard input cannot fall through to mpv.
        this.#ensurePopupInputFocus();
      }
      this.emit("request", {
        surface,
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
      ...(this.platform === "win32"
        ? {
            // Electron's Windows frameless default retains WS_THICKFRAME,
            // which enables native window animations even when CSS
            // transitions are disabled.
            backgroundColor: "#00000000",
            backgroundMaterial: "none",
            accentColor: false,
            thickFrame: false,
            roundedCorners: false,
            opacity: 1,
          }
        : {}),
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
    this.#disableWindowTransitions(window, surface);
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
        this.popupPainted = false;
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

  #setPopupOpacity(value) {
    if (
      this.platform !== "win32" ||
      !this.popupWindow ||
      this.popupWindow.isDestroyed() ||
      typeof this.popupWindow.setOpacity !== "function"
    )
      return;
    this.popupWindow.setOpacity(Math.max(0, Math.min(1, Number(value) || 0)));
  }

  #ensurePopupSurfaceVisible() {
    if (
      this.platform !== "win32" ||
      !this.popupWindow ||
      this.popupWindow.isDestroyed()
    )
      return;
    if (
      typeof this.popupWindow.isVisible === "function" &&
      this.popupWindow.isVisible()
    )
      return;
    if (typeof this.popupWindow.showInactive === "function")
      this.popupWindow.showInactive();
    else this.popupWindow.show();
  }

  #setWindowTransitionState(surface, state) {
    if (!surface) return;
    this.windowTransitionStates.set(
      surface,
      Object.freeze({
        surface,
        supported: false,
        requested: false,
        applied: false,
        verified: false,
        reason: null,
        ...state,
      }),
    );
  }

  #disableWindowTransitions(window, surface = null) {
    if (this.platform !== "win32") {
      this.#setWindowTransitionState(surface, {
        reason: "platform-not-windows",
      });
      return;
    }
    if (!this.windowTransitionProbe) {
      this.#setWindowTransitionState(surface, {
        reason: "probe-unavailable",
      });
      return;
    }
    if (!window || typeof window.getNativeWindowHandle !== "function") {
      this.#setWindowTransitionState(surface, {
        reason: "native-window-handle-unavailable",
      });
      return;
    }
    let handle;
    try {
      handle = window.getNativeWindowHandle();
      if (!Buffer.isBuffer(handle) || handle.length < 4) {
        this.#setWindowTransitionState(surface, {
          reason: "native-window-handle-invalid",
        });
        return;
      }
      const windowId =
        handle.length >= 8
          ? handle.readBigUInt64LE(0).toString()
          : String(handle.readUInt32LE(0));
      if (!windowId || windowId === "0") {
        this.#setWindowTransitionState(surface, {
          reason: "native-window-id-invalid",
        });
        return;
      }
      const output = execFileSync(
        this.windowTransitionProbe,
        ["--window-id", windowId, "--disable-transitions"],
        {
          timeout: 1000,
          windowsHide: true,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      let result = null;
      try {
        result = JSON.parse(String(output || "").trim());
      } catch (_) {
        // Keep the explicit failure state below. A probe that does not return
        // its structured result cannot prove that the attribute was applied.
      }
      const applied = result?.ok === true && result?.transitionsDisabled === true;
      this.#setWindowTransitionState(surface, {
        supported: true,
        requested: true,
        applied,
        verified: result?.transitionsVerified === true,
        reason: applied ? null : result?.reason || "probe-rejected-request",
        backend: result?.backend || "windows",
      });
      if (!applied)
        this.emit(
          "window-transition-error",
          new Error("Windows transition suppression was not applied"),
        );
    } catch (error) {
      this.#setWindowTransitionState(surface, {
        supported: true,
        requested: true,
        reason: "probe-failed",
      });
      this.emit("window-transition-error", error);
    }
  }

  #activateWindowForInput(window) {
    if (
      this.platform !== "win32" ||
      !this.windowTransitionProbe ||
      !window ||
      typeof window.getNativeWindowHandle !== "function"
    )
      return;
    try {
      const handle = window.getNativeWindowHandle();
      if (!Buffer.isBuffer(handle) || handle.length < 4) return;
      const windowId =
        handle.length >= 8
          ? handle.readBigUInt64LE(0).toString()
          : String(handle.readUInt32LE(0));
      if (!windowId || windowId === "0") return;
      execFile(
        this.windowTransitionProbe,
        ["--pid", String(process.pid), "--window-id", windowId, "--activate"],
        {
          timeout: 1000,
          windowsHide: true,
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          if (error) {
            this.emit("window-focus-error", error);
            return;
          }
          let result = null;
          try {
            result = JSON.parse(String(stdout || "").trim());
          } catch (_) {}
          if (result?.foregroundVerified !== true) {
            this.emit(
              "window-focus-error",
              new Error(
                `popup foreground activation was not verified: ${JSON.stringify(result)}`,
              ),
            );
            return;
          }
          this.popupFocusHandoffUntil = 0;
          if (this.popupVisible && this.popupWindow === window && !window.isDestroyed())
            window.focus();
        },
      );
    } catch (error) {
      this.emit("window-focus-error", error);
    }
  }

  #ensurePopupInputFocus() {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return;
    if (this.platform === "win32") {
      this.#ensurePopupSurfaceVisible();
      this.#setPopupOpacity(1);
      this.#activateWindowForInput(this.popupWindow);
    }
    this.popupWindow.focus();
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
    // An active popup must stay above a borderless/fullscreen player even
    // while Windows is still resolving the focus transition. Waiting for
    // isFocused() here leaves the first visible popup at the normal z-order,
    // where a fullscreen mpv window can cover it before the next refresh.
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
        const shouldBeAlwaysOnTop =
          ownedForeground &&
          (window === this.highlightWindow || !this.popupVisible || popupOwnsInput);
        const alwaysOnTopLevel =
          this.platform === "win32" && shouldBeAlwaysOnTop
            ? "screen-saver"
            : "floating";
        window.setAlwaysOnTop(shouldBeAlwaysOnTop, alwaysOnTopLevel);
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

  #revealPopup() {
    if (
      !this.popupVisible ||
      !this.popupPainted ||
      !this.readySurfaces.has("popup") ||
      !this.popupWindow ||
      this.popupWindow.isDestroyed()
    )
      return;
    this.popupWindow.setIgnoreMouseEvents(false);
    this.#disableWindowTransitions(this.popupWindow, "popup");
    this.popupFocusHandoffUntil =
      this.platform === "win32" ? Date.now() + WINDOWS_POPUP_FOCUS_HANDOFF_GRACE_MS : 0;
    // Windows must activate an interactive companion surface before it can
    // own Tab, Escape, and selection input. macOS retains the nonactivating
    // panel contract so the player remains the foreground application there.
    // The Windows surface is made resident while transparent. This avoids a
    // native hide/show cycle, which can animate independently of the DOM.
    if (this.platform === "win32") {
      this.#ensurePopupSurfaceVisible();
      this.#setPopupOpacity(1);
    } else this.popupWindow.show();
    this.popupWindow.focus();
    this.#updateStacking();
    this.#raisePopup();
    this.#ensurePopupInputFocus();
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
    this.#disableWindowTransitions(this.highlightWindow, "highlight");
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
    this.popupPainted = false;
    if (this.highlightWindow && !this.highlightWindow.isDestroyed()) {
      this.highlightWindow.setIgnoreMouseEvents(true);
      this.highlightWindow.showInactive();
    }
    if (this.contentBounds) this.popupWindow.setBounds(this.contentBounds, false);
    // Keep the Windows surface resident and transparent until the renderer
    // has painted the new DOM state. A native hide/show cycle can animate
    // even when the DOM has no transition.
    this.popupWindow.setIgnoreMouseEvents(true, { forward: true });
    if (this.platform === "win32") {
      this.#setPopupOpacity(0);
      this.#ensurePopupSurfaceVisible();
    } else this.popupWindow.hide();
    this.#registerPopupEscape();
    this.#updateStacking();
    this.#raisePopup();
    this.send("popup", "popup-state", { visible: true, ...payload });
  }

  hidePopup({ focusPlayer = true } = {}) {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return;
    this.popupVisible = false;
    this.popupPainted = false;
    this.popupFocusHandoffUntil = 0;
    this.#unregisterPopupEscape();
    this.send("popup", "popup-state", { visible: false });
    if (this.platform === "win32") this.#setPopupOpacity(0);
    else this.popupWindow.hide();
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
      if (this.platform === "win32") {
        this.#setPopupOpacity(0);
        this.#ensurePopupSurfaceVisible();
      } else if (!this.popupVisible) this.popupWindow.hide();
    }
    if (this.highlightWindow && !this.highlightWindow.isDestroyed())
      this.highlightWindow.setIgnoreMouseEvents(true, { forward: true });
    this.#updateStacking();
  }

  setInteractiveInput() {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return;
    if (this.readySurfaces.has("popup") && this.popupPainted) {
      this.#revealPopup();
      this.#updateStacking();
      this.#raisePopup();
    }
  }

  hasSessionFocus() {
    const focused = !!(
      this.popupVisible &&
      this.popupWindow &&
      !this.popupWindow.isDestroyed() &&
      typeof this.popupWindow.isFocused === "function" &&
      this.popupWindow.isFocused()
    );
    if (focused) return true;
    return (
      this.platform === "win32" &&
      this.popupVisible &&
      Date.now() < this.popupFocusHandoffUntil
    );
  }

  surfaceReadiness() {
    return Object.freeze({
      highlight: this.readySurfaces.has("highlight"),
      popup: this.readySurfaces.has("popup"),
    });
  }

  windowTransitionState() {
    return Object.freeze(
      Object.fromEntries(
        [...this.windowTransitionStates.entries()].map(([surface, state]) => [
          surface,
          { ...state },
        ]),
      ),
    );
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
    this.popupPainted = false;
    this.popupFocusHandoffUntil = 0;
    this.playerForeground = false;
    this.windowTransitionStates.clear();
    this.readySurfaces.clear();
  }
}

module.exports = { BrowserHost };
