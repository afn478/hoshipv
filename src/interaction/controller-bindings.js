"use strict";

const BUTTONS = Object.freeze([
  "primary",
  "back",
  "square",
  "audio",
  "leftShoulder",
  "rightShoulder",
  "leftTrigger",
  "rightTrigger",
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
]);

const ACTIONS = Object.freeze({
  noPopup: Object.freeze([
    "none",
    "lookup",
    "toggle-pause",
    "resume-playback",
    "subtitle-previous",
    "subtitle-next",
    "seek-backward",
    "seek-forward",
    "seek-backward-long",
    "seek-forward-long",
    "frame-step-backward",
    "frame-step-forward",
    "volume-down",
    "volume-up",
    "speed-down",
    "speed-up",
    "audio-menu",
    "anki-primary",
    "anki-force-add",
  ]),
  popup: Object.freeze([
    "none",
    "lookup",
    "toggle-pause",
    "close-popup",
    "subtitle-previous",
    "subtitle-next",
    "popup-up",
    "popup-down",
    "popup-left",
    "popup-right",
    "popup-scroll-up",
    "popup-scroll-down",
    "play-audio",
    "audio-menu",
    "anki-primary",
    "anki-force-add",
  ]),
  audio: Object.freeze([
    "none",
    "close-audio-list",
    "audio-up",
    "audio-down",
    "audio-left",
    "audio-right",
    "audio-activate",
  ]),
});

const DEFAULTS = Object.freeze({
  noPopup: Object.freeze({
    primary: "lookup",
    back: "resume-playback",
    square: "toggle-pause",
    audio: "audio-menu",
    leftShoulder: "subtitle-previous",
    rightShoulder: "subtitle-next",
    leftTrigger: "anki-force-add",
    rightTrigger: "anki-primary",
    // Match iinatan's checked-in profile defaults for the no-popup context.
    // Long seeking remains available as an explicit binding choice.
    dpadUp: "volume-up",
    dpadDown: "volume-down",
    dpadLeft: "seek-backward",
    dpadRight: "seek-forward",
  }),
  popup: Object.freeze({
    primary: "lookup",
    back: "close-popup",
    square: "toggle-pause",
    audio: "audio-menu",
    leftShoulder: "subtitle-previous",
    rightShoulder: "subtitle-next",
    leftTrigger: "anki-force-add",
    rightTrigger: "anki-primary",
    dpadUp: "popup-scroll-up",
    dpadDown: "popup-scroll-down",
    dpadLeft: "popup-left",
    dpadRight: "popup-right",
  }),
  audio: Object.freeze({
    primary: "audio-activate",
    back: "close-audio-list",
    square: "none",
    audio: "none",
    leftShoulder: "none",
    rightShoulder: "none",
    leftTrigger: "none",
    rightTrigger: "none",
    dpadUp: "audio-up",
    dpadDown: "audio-down",
    dpadLeft: "audio-left",
    dpadRight: "audio-right",
  }),
});

function normalizeBindings(value, context) {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch (_) {
            return {};
          }
        })()
      : value;
  const source =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const allowed = new Set(ACTIONS[context] || ACTIONS.noPopup);
  const result = {};
  BUTTONS.forEach((button) => {
    const action =
      source[button] === undefined ? DEFAULTS[context][button] : String(source[button]);
    result[button] = allowed.has(action) ? action : "none";
  });
  return Object.freeze(result);
}

module.exports = { ACTIONS, BUTTONS, DEFAULTS, normalizeBindings };
