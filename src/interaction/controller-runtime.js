"use strict";

const { normalizeBindings, BUTTONS } = require("./controller-bindings");

const STANDARD_BUTTON_INDEX = Object.freeze({
  primary: 0,
  back: 1,
  square: 2,
  audio: 3,
  leftShoulder: 4,
  rightShoulder: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
});

const REPEATABLE_ACTIONS = new Set([
  "popup-up",
  "popup-down",
  "popup-left",
  "popup-right",
  "popup-scroll-up",
  "popup-scroll-down",
  "audio-up",
  "audio-down",
  "audio-left",
  "audio-right",
]);

const NATIVE_BUTTON_INDEX = Object.freeze({
  primary: 0,
  back: 1,
  square: 2,
  audio: 3,
  leftShoulder: 4,
  rightShoulder: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
});

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeButton(value) {
  if (!value || typeof value !== "object") return { pressed: false, value: 0 };
  return {
    pressed: !!value.pressed || numeric(value.value) >= 0.5,
    value: Math.max(0, Math.min(1, numeric(value.value))),
  };
}

function normalizeNativeButtons(value) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const source = value && typeof value === "object" ? value : {};
  for (const [name, index] of Object.entries(NATIVE_BUTTON_INDEX)) {
    const pressed = source[name] === true;
    buttons[index] = { pressed, value: pressed ? 1 : 0 };
  }
  return buttons;
}

function normalizeAxes(value) {
  if (Array.isArray(value))
    return value.slice(0, 8).map((axis) => Math.max(-1, Math.min(1, numeric(axis))));
  const source = value && typeof value === "object" ? value : {};
  // Native HID state follows the reference controller contract: the right
  // stick navigates subtitle/popup actions, while leftY is retained for
  // future continuous-scroll handling.
  return [
    Math.max(-1, Math.min(1, numeric(source.rightX))),
    Math.max(-1, Math.min(1, numeric(source.rightY))),
    Math.max(-1, Math.min(1, numeric(source.leftY))),
  ];
}

function normalizeGamepad(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    connected: !!source.connected,
    id: String(source.id || "").slice(0, 240),
    index: Number.isInteger(source.index) ? source.index : 0,
    buttons: Array.isArray(source.buttons)
      ? source.buttons.slice(0, 32).map(normalizeButton)
      : normalizeNativeButtons(source.buttons),
    axes: normalizeAxes(source.axes),
  };
}

class ControllerRouter {
  constructor(options = {}) {
    this.initialRepeatMs = Math.max(100, numeric(options.initialRepeatMs, 360));
    this.repeatMs = Math.max(50, numeric(options.repeatMs, 120));
    this.deadzone = Math.max(0.1, Math.min(0.8, numeric(options.deadzone, 0.35)));
    this.bindings = {};
    this.previous = new Map();
    this.nextRepeat = new Map();
    this.activeDeviceKey = null;
    this.setBindings(options.bindings || {});
  }

  setBindings(bindings = {}) {
    this.bindings = {
      noPopup: normalizeBindings(bindings.noPopup, "noPopup"),
      popup: normalizeBindings(bindings.popup, "popup"),
      audio: normalizeBindings(bindings.audio, "audio"),
    };
    this.previous.clear();
    this.nextRepeat.clear();
    this.activeDeviceKey = null;
  }

  reset() {
    this.previous.clear();
    this.nextRepeat.clear();
    this.activeDeviceKey = null;
  }

  contextFor(state) {
    if (state === "audio-menu-active") return "audio";
    if (
      state === "popup-active" ||
      state === "nested-popup-active" ||
      state === "text-selection-drag-capture"
    )
      return "popup";
    return "noPopup";
  }

  actionsFor(gamepad, context, now = Date.now()) {
    const normalized = normalizeGamepad(gamepad);
    if (!normalized.connected) {
      this.reset();
      return [];
    }
    const deviceKey = `${normalized.index}:${normalized.id}`;
    if (this.activeDeviceKey !== deviceKey) {
      this.previous.clear();
      this.nextRepeat.clear();
      this.activeDeviceKey = deviceKey;
    }
    const selectedContext = this.bindings[context] ? context : "noPopup";
    const binding = this.bindings[selectedContext];
    const axis = normalized.axes;
    const axisPressed = {
      dpadUp: axis[1] <= -this.deadzone,
      dpadDown: axis[1] >= this.deadzone,
      dpadLeft: axis[0] <= -this.deadzone,
      dpadRight: axis[0] >= this.deadzone,
    };
    const actions = [];
    for (const button of BUTTONS) {
      const index = STANDARD_BUTTON_INDEX[button];
      const current = normalizeButton(normalized.buttons[index]);
      if (axisPressed[button]) current.pressed = true;
      const wasPressed = this.previous.get(button) === true;
      const action = binding[button];
      if (current.pressed && !wasPressed) {
        this.nextRepeat.set(button, now + this.initialRepeatMs);
        if (action && action !== "none")
          actions.push({ action, button, phase: "press" });
      } else if (current.pressed && wasPressed) {
        const due = this.nextRepeat.get(button) || Number.POSITIVE_INFINITY;
        if (REPEATABLE_ACTIONS.has(action) && now >= due) {
          this.nextRepeat.set(button, now + this.repeatMs);
          actions.push({ action, button, phase: "repeat" });
        }
      } else if (!current.pressed) {
        this.nextRepeat.delete(button);
      }
      this.previous.set(button, current.pressed);
    }
    return actions;
  }
}

module.exports = {
  ControllerRouter,
  REPEATABLE_ACTIONS,
  STANDARD_BUTTON_INDEX,
  normalizeGamepad,
};
