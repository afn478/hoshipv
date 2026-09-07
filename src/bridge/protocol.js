"use strict";

const PROTOCOL_VERSION = 1;

const HOST_REQUEST_TYPES = new Set([
  "ready",
  "pointer-move",
  "lookup",
  "nested-lookup",
  "popup-action",
  "popup-region",
  "popup-scroll",
  "popup-size",
  "dismiss-popup",
  "player-command",
  "external-link",
  "audio-source",
  "anki-action",
  "controller-state",
  "settings-open",
  "diagnostic",
]);

const HOST_EVENT_TYPES = new Set([
  "hello",
  "session-state",
  "geometry",
  "lookup-result",
  "lookup-error",
  "popup-state",
  "popup-layout",
  "popup-error",
  "audio-result",
  "anki-result",
  "controller-command",
  "capabilities",
  "diagnostic",
  "shutdown",
]);

const PLAYER_COMMANDS = new Set([
  "toggle-pause",
  "seek-backward",
  "seek-forward",
  "subtitle-previous",
  "subtitle-next",
]);

const POPUP_REGION_NAMES = new Set([
  "panel",
  "headword",
  "content",
  "selection",
  "action-audio-source",
  "action-audio-close",
  "action-anki-add",
  "action-anki-open",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value, maxLength = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isGeneration(value) {
  return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isRequestId(value) {
  return isNonEmptyString(value, 160) && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isSessionId(value) {
  return isNonEmptyString(value, 160) && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function makeEnvelope(type, payload = {}, context = {}) {
  if (!isNonEmptyString(type, 64)) throw new TypeError("message type is required");
  if (!isPlainObject(payload)) throw new TypeError("message payload must be an object");

  const envelope = {
    protocol: PROTOCOL_VERSION,
    type,
    payload: cloneJson(payload),
  };
  if (context.requestId !== undefined) envelope.requestId = context.requestId;
  if (context.sessionId !== undefined) envelope.sessionId = context.sessionId;
  if (context.geometryGeneration !== undefined)
    envelope.geometryGeneration = context.geometryGeneration;
  return envelope;
}

function validationError(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.code = "INVALID_PROTOCOL_MESSAGE";
  error.path = path;
  return error;
}

function validateEnvelope(message, kind = "any") {
  if (!isPlainObject(message)) throw validationError("message", "must be an object");
  if (message.protocol !== PROTOCOL_VERSION)
    throw validationError("protocol", `must be ${PROTOCOL_VERSION}`);
  if (!isNonEmptyString(message.type, 64))
    throw validationError("type", "must be a non-empty string");
  if (!isPlainObject(message.payload))
    throw validationError("payload", "must be an object");
  if (message.requestId !== undefined && !isRequestId(message.requestId))
    throw validationError("requestId", "has an invalid format");
  if (message.sessionId !== undefined && !isSessionId(message.sessionId))
    throw validationError("sessionId", "has an invalid format");
  if (
    message.geometryGeneration !== undefined &&
    !isGeneration(message.geometryGeneration)
  )
    throw validationError("geometryGeneration", "must be a non-negative integer");

  if (kind === "host-request" && !HOST_REQUEST_TYPES.has(message.type))
    throw validationError("type", `unknown host request ${message.type}`);
  if (kind === "host-event" && !HOST_EVENT_TYPES.has(message.type))
    throw validationError("type", `unknown host event ${message.type}`);
  return message;
}

function validatePlayerCommand(command) {
  if (!PLAYER_COMMANDS.has(command))
    throw validationError("payload.command", "player command is not allowed");
  return command;
}

function validateHostRequest(message) {
  validateEnvelope(message, "host-request");
  if (
    [
      "pointer-move",
      "lookup",
      "nested-lookup",
      "popup-action",
      "popup-region",
      "popup-scroll",
    ].includes(message.type) &&
    !message.sessionId
  )
    throw validationError("sessionId", "is required for this request");
  if (message.type === "lookup") {
    if (!isRequestId(message.requestId))
      throw validationError("requestId", "is required for lookup");
    if (!isNonEmptyString(message.payload.text, 4096))
      throw validationError("payload.text", "must be a non-empty string");
    if (!Number.isInteger(message.payload.utf16Start) || message.payload.utf16Start < 0)
      throw validationError("payload.utf16Start", "must be a non-negative integer");
  }
  if (message.type === "nested-lookup" && !isNonEmptyString(message.payload.term, 4096))
    throw validationError("payload.term", "must be a non-empty string");
  if (message.type === "player-command") validatePlayerCommand(message.payload.command);
  if (message.type === "external-link") {
    if (!isNonEmptyString(message.payload.url, 4096))
      throw validationError("payload.url", "must be a non-empty string");
    if (!/^https:\/\/[^\s<>"']+$/i.test(message.payload.url))
      throw validationError("payload.url", "must be an HTTPS URL");
  }
  if (message.type === "audio-source") {
    if (message.requestId === undefined && !isRequestId(message.payload.requestId))
      throw validationError("requestId", "is required for audio-source");
    if (
      message.payload.requestId !== undefined &&
      !isRequestId(message.payload.requestId)
    )
      throw validationError("payload.requestId", "has an invalid format");
    if (!isNonEmptyString(message.payload.term, 4096))
      throw validationError("payload.term", "must be a non-empty string");
  }
  if (message.type === "anki-action" && !isNonEmptyString(message.payload.action, 80))
    throw validationError("payload.action", "must be a non-empty string");
  if (message.type === "popup-action") {
    if (!isNonEmptyString(message.payload.action, 80))
      throw validationError("payload.action", "must be a non-empty string");
    if (
      message.payload.action === "focus-changed" &&
      !isNonEmptyString(message.payload.target, 160)
    )
      throw validationError("payload.target", "must be a non-empty string");
    if (
      message.payload.action === "selection-changed" &&
      typeof message.payload.text !== "string"
    )
      throw validationError("payload.text", "must be a string");
    if (typeof message.payload.text === "string" && message.payload.text.length > 20000)
      throw validationError("payload.text", "is too long");
  }
  if (message.type === "popup-size") {
    for (const key of ["width", "height"])
      if (!isFiniteNumber(message.payload[key]) || message.payload[key] <= 0)
        throw validationError(`payload.${key}`, "must be a positive finite number");
  }
  if (message.type === "popup-region") {
    if (!isNonEmptyString(message.payload.name, 80))
      throw validationError("payload.name", "must be a non-empty string");
    if (!POPUP_REGION_NAMES.has(message.payload.name))
      throw validationError("payload.name", "is not an allowed popup region");
    for (const key of ["x", "y"])
      if (!isFiniteNumber(message.payload[key]))
        throw validationError(`payload.${key}`, "must be finite");
    for (const key of ["width", "height"])
      if (!isFiniteNumber(message.payload[key]) || message.payload[key] <= 0)
        throw validationError(`payload.${key}`, "must be a positive finite number");
  }
  if (message.type === "popup-scroll") {
    for (const key of ["left", "top"])
      if (!isFiniteNumber(message.payload[key]) || message.payload[key] < 0)
        throw validationError(`payload.${key}`, "must be a non-negative finite number");
  }
  if (message.type === "controller-state") {
    if (typeof message.payload.connected !== "boolean")
      throw validationError("payload.connected", "must be a boolean");
    if (!Array.isArray(message.payload.buttons) || message.payload.buttons.length > 32)
      throw validationError(
        "payload.buttons",
        "must be an array of at most 32 buttons",
      );
    if (!Array.isArray(message.payload.axes) || message.payload.axes.length > 8)
      throw validationError("payload.axes", "must be an array of at most 8 axes");
  }
  if (message.type === "pointer-move") {
    for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey"])
      if (
        message.payload[key] !== undefined &&
        typeof message.payload[key] !== "boolean"
      )
        throw validationError(`payload.${key}`, "must be a boolean");
  }
  return message;
}

function validateHostEvent(message) {
  validateEnvelope(message, "host-event");
  if (message.type === "capabilities") {
    if (!isNonEmptyString(message.payload.surface, 32))
      throw validationError("payload.surface", "must be a non-empty string");
    if (
      message.payload.features !== undefined &&
      !isPlainObject(message.payload.features)
    )
      throw validationError("payload.features", "must be an object when provided");
  }
  if (message.type === "popup-layout") {
    if (!isPlainObject(message.payload.position))
      throw validationError("payload.position", "must be an object");
    if (!isFiniteNumber(message.payload.position.x))
      throw validationError("payload.position.x", "must be finite");
    if (!isFiniteNumber(message.payload.position.y))
      throw validationError("payload.position.y", "must be finite");
    for (const key of ["width", "maxHeight"])
      if (!isFiniteNumber(message.payload[key]) || message.payload[key] <= 0)
        throw validationError(`payload.${key}`, "must be a positive finite number");
  }
  if (message.type !== "hello" && message.type !== "capabilities" && !message.sessionId)
    throw validationError("sessionId", "is required for this event");
  return message;
}

module.exports = {
  HOST_EVENT_TYPES,
  HOST_REQUEST_TYPES,
  PLAYER_COMMANDS,
  PROTOCOL_VERSION,
  cloneJson,
  isGeneration,
  isPlainObject,
  isRequestId,
  isSessionId,
  makeEnvelope,
  validateEnvelope,
  validateHostEvent,
  validateHostRequest,
  validatePlayerCommand,
};
