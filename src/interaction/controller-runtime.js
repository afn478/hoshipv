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

const RIGHT_STICK_ACTIONS = Object.freeze({
  left: "controller-target-left",
  right: "controller-target-right",
  up: "controller-target-up",
  down: "controller-target-down",
});

const STICK_SCROLL_AXIS_ACTION = "popup-scroll-axis";

const HOLDABLE_ACTIONS = new Set(["audio-menu", "anki-primary", "anki-force-add"]);
const BUTTON_PRESS_THRESHOLD = 0.65;

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
    // Match iinatan's browser Gamepad normalization. Native HID snapshots
    // already expose debounced booleans and therefore arrive with value 0/1.
    pressed: !!value.pressed || numeric(value.value) >= BUTTON_PRESS_THRESHOLD,
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
  // Normalize native HID state to the browser Gamepad standard ordering:
  // left X/Y, then right X/Y. D-pad buttons are still carried separately in
  // the button array; stick axes must never masquerade as D-pad presses.
  return [
    Math.max(-1, Math.min(1, numeric(source.leftX))),
    Math.max(-1, Math.min(1, numeric(source.leftY))),
    Math.max(-1, Math.min(1, numeric(source.rightX))),
    Math.max(-1, Math.min(1, numeric(source.rightY))),
  ];
}

function stickDirection(horizontal, vertical, threshold) {
  const x = numeric(horizontal);
  const y = numeric(vertical);
  const magnitude = Math.max(Math.abs(x), Math.abs(y));
  if (magnitude < threshold) return "";
  // Keep the vertical choice on an exact diagonal, matching iinatan's
  // `horizontal > vertical` comparison.
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? "left" : "right";
  return y < 0 ? "up" : "down";
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

function gamepadIsNeutral(gamepad, deadzone) {
  const buttonPressed = BUTTONS.some((button) => {
    const index = STANDARD_BUTTON_INDEX[button];
    return normalizeButton(gamepad.buttons[index]).pressed;
  });
  if (buttonPressed) return false;
  return gamepad.axes.every((axis) => Math.abs(axis) <= deadzone);
}

class ControllerRouter {
  constructor(options = {}) {
    // Match iinatan's 340 ms first-repeat delay; subsequent repeats remain
    // 120 ms apart.
    this.initialRepeatMs = Math.max(100, numeric(options.initialRepeatMs, 340));
    this.repeatMs = Math.max(50, numeric(options.repeatMs, 120));
    this.deadzone = Math.max(0.1, Math.min(0.8, numeric(options.deadzone, 0.18)));
    this.stickThreshold = Math.max(
      0.1,
      Math.min(0.95, numeric(options.stickThreshold, 0.62)),
    );
    this.bindings = {};
    this.previous = new Map();
    this.nextRepeat = new Map();
    this.pressedActions = new Map();
    this.previousRightStickDirection = "";
    this.nextRightStickRepeat = 0;
    this.previousLeftStickDirection = "";
    this.nextLeftStickRepeat = 0;
    this.lastSampleAt = 0;
    this.activeDeviceKey = null;
    this.activeContext = null;
    this.suppressUntilNeutral = true;
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
    this.pressedActions.clear();
    this.previousRightStickDirection = "";
    this.nextRightStickRepeat = 0;
    this.previousLeftStickDirection = "";
    this.nextLeftStickRepeat = 0;
    this.lastSampleAt = 0;
    this.activeDeviceKey = null;
    this.activeContext = null;
    this.suppressUntilNeutral = true;
  }

  reset() {
    this.previous.clear();
    this.nextRepeat.clear();
    this.pressedActions.clear();
    this.previousRightStickDirection = "";
    this.nextRightStickRepeat = 0;
    this.previousLeftStickDirection = "";
    this.nextLeftStickRepeat = 0;
    this.lastSampleAt = 0;
    this.activeDeviceKey = null;
    this.activeContext = null;
    this.suppressUntilNeutral = true;
  }

  contextFor(state) {
    if (state === "audio-menu-active") return "audio";
    if (state === "popup-active" || state === "text-selection-drag-capture")
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
      this.pressedActions.clear();
      this.previousRightStickDirection = "";
      this.nextRightStickRepeat = 0;
      this.previousLeftStickDirection = "";
      this.nextLeftStickRepeat = 0;
      this.lastSampleAt = 0;
      this.activeDeviceKey = deviceKey;
      this.suppressUntilNeutral = true;
    }
    const selectedContext = this.bindings[context] ? context : "noPopup";
    if (this.activeContext !== selectedContext) {
      // A button may remain physically held while a lookup opens or an audio
      // menu takes ownership. Do not let the old context's repeat deadline
      // dispatch the new context's action; retain `previous` and
      // `pressedActions` so a hold can still be released cleanly.
      this.nextRepeat.clear();
      this.previousRightStickDirection = "";
      this.nextRightStickRepeat = 0;
      this.previousLeftStickDirection = "";
      this.nextLeftStickRepeat = 0;
      this.lastSampleAt = 0;
      this.activeContext = selectedContext;
    }
    const binding = this.bindings[selectedContext];
    const axis = normalized.axes;
    const actions = [];
    const previousSampleAt = this.lastSampleAt;
    this.lastSampleAt = now;
    if (this.suppressUntilNeutral) {
      this.previous.clear();
      this.nextRepeat.clear();
      this.pressedActions.clear();
      for (const button of BUTTONS) {
        const index = STANDARD_BUTTON_INDEX[button];
        this.previous.set(button, normalizeButton(normalized.buttons[index]).pressed);
      }
      this.previousRightStickDirection = "";
      this.nextRightStickRepeat = 0;
      this.previousLeftStickDirection = "";
      this.nextLeftStickRepeat = 0;
      if (gamepadIsNeutral(normalized, this.deadzone)) {
        this.suppressUntilNeutral = false;
        this.lastSampleAt = 0;
      }
      return actions;
    }
    for (const button of BUTTONS) {
      const index = STANDARD_BUTTON_INDEX[button];
      const current = normalizeButton(normalized.buttons[index]);
      const wasPressed = this.previous.get(button) === true;
      const action = binding[button];
      if (current.pressed && !wasPressed) {
        this.nextRepeat.set(button, now + this.initialRepeatMs);
        this.pressedActions.set(button, action);
        if (action && action !== "none")
          actions.push({ action, button, phase: "press" });
      } else if (current.pressed && wasPressed) {
        const due = this.nextRepeat.get(button) || Number.POSITIVE_INFINITY;
        if (REPEATABLE_ACTIONS.has(action) && now >= due) {
          this.nextRepeat.set(button, now + this.repeatMs);
          actions.push({ action, button, phase: "repeat" });
        }
      } else if (!current.pressed) {
        const pressedAction = this.pressedActions.get(button) || action;
        if (wasPressed && HOLDABLE_ACTIONS.has(pressedAction))
          actions.push({
            action: "controller-hold-release",
            holdAction: pressedAction,
            button,
            phase: "release",
          });
        this.pressedActions.delete(button);
        this.nextRepeat.delete(button);
      }
      this.previous.set(button, current.pressed);
    }

    // Right-stick navigation is intentionally not configurable as a button
    // binding. It is the controller's cursor-free subtitle navigation path,
    // matching iinatan: the first direction opens a target immediately, and
    // holding the direction repeats at the same cadence as popup controls.
    const rightDirection =
      selectedContext === "audio"
        ? ""
        : stickDirection(axis[2], axis[3], this.stickThreshold);
    if (!rightDirection) {
      this.previousRightStickDirection = "";
      this.nextRightStickRepeat = 0;
    } else if (rightDirection !== this.previousRightStickDirection) {
      this.previousRightStickDirection = rightDirection;
      this.nextRightStickRepeat = now + this.initialRepeatMs;
      actions.push({
        action: RIGHT_STICK_ACTIONS[rightDirection],
        button: "rightStick",
        phase: "press",
      });
    } else if (now >= this.nextRightStickRepeat) {
      this.nextRightStickRepeat = now + this.repeatMs;
      actions.push({
        action: RIGHT_STICK_ACTIONS[rightDirection],
        button: "rightStick",
        phase: "repeat",
      });
    }

    // The left stick is a proportional popup/audio-list scroll control. Send
    // the sampled axis and elapsed time through the host instead of reducing
    // it to fixed notches; this preserves iinatan's smooth, magnitude-aware
    // scrolling for both browser and native-HID sources.
    const leftAxis =
      selectedContext === "popup" || selectedContext === "audio" ? numeric(axis[1]) : 0;
    if (Math.abs(leftAxis) < this.deadzone) {
      this.previousLeftStickDirection = "";
      this.nextLeftStickRepeat = 0;
    } else {
      const leftDirection = leftAxis < 0 ? "up" : "down";
      const deltaMs = previousSampleAt
        ? Math.min(50, Math.max(0, now - previousSampleAt))
        : 16;
      const phase =
        leftDirection === this.previousLeftStickDirection ? "repeat" : "press";
      this.previousLeftStickDirection = leftDirection;
      actions.push({
        action: STICK_SCROLL_AXIS_ACTION,
        button: "leftStick",
        phase,
        axis: leftAxis,
        deltaMs,
      });
    }
    return actions;
  }
}

module.exports = {
  ControllerRouter,
  REPEATABLE_ACTIONS,
  RIGHT_STICK_ACTIONS,
  STANDARD_BUTTON_INDEX,
  STICK_SCROLL_AXIS_ACTION,
  HOLDABLE_ACTIONS,
  BUTTON_PRESS_THRESHOLD,
  normalizeAxes,
  normalizeGamepad,
};
