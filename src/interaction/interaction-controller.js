"use strict";

const STATES = Object.freeze({
  INACTIVE: "inactive",
  PLAYER_INTERACTION: "player-interaction",
  HOVER_CANDIDATE: "subtitle-hover-candidate",
  LOOKUP_PENDING: "lookup-pending",
  POPUP_ACTIVE: "popup-active",
  NESTED_POPUP_ACTIVE: "nested-popup-active",
  TEXT_SELECTION: "text-selection-drag-capture",
  AUDIO_MENU: "audio-menu-active",
  SETTINGS: "settings-dialog",
  SUSPENDED: "suspended",
});

const EVENTS = Object.freeze({
  ENABLE: "enable",
  DISABLE: "disable",
  SESSION_READY: "session-ready",
  SESSION_LOST: "session-lost",
  POINTER_TARGET: "pointer-target",
  POINTER_NONE: "pointer-none",
  LOOKUP_REQUESTED: "lookup-requested",
  LOOKUP_SUCCEEDED: "lookup-succeeded",
  LOOKUP_FAILED: "lookup-failed",
  POPUP_OPENED: "popup-opened",
  NESTED_OPENED: "nested-opened",
  POPUP_ACTION: "popup-action",
  AUDIO_OPENED: "audio-opened",
  CLOSE_TRANSIENT: "close-transient",
  CLOSE_POPUP: "close-popup",
  OUTSIDE_POINTER_DOWN: "outside-pointer-down",
  POINTER_DOWN: "pointer-down",
  POINTER_UP: "pointer-up",
  SELECTION_START: "selection-start",
  SELECTION_END: "selection-end",
  POINTER_CANCEL: "pointer-cancel",
  FOCUS_PLAYER: "focus-player",
  FOCUS_OVERLAY: "focus-overlay",
  GEOMETRY_INVALIDATED: "geometry-invalidated",
  ESCAPE: "escape",
  SHUTDOWN: "shutdown",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class InteractionController {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.state = this.enabled ? STATES.PLAYER_INTERACTION : STATES.INACTIVE;
    this.sessionId = null;
    this.geometryGeneration = null;
    this.popupDepth = 0;
    this.requestId = null;
    this.capture = null;
    this.transitionLog = [];
  }

  snapshot() {
    return Object.freeze({
      enabled: this.enabled,
      state: this.state,
      sessionId: this.sessionId,
      geometryGeneration: this.geometryGeneration,
      popupDepth: this.popupDepth,
      requestId: this.requestId,
      capture: this.capture ? { ...this.capture } : null,
    });
  }

  transition(nextState, event, effects = []) {
    const previous = this.state;
    this.state = nextState;
    this.transitionLog.push({
      from: previous,
      to: nextState,
      event,
      effects: clone(effects),
    });
    return effects;
  }

  dispatch(event, payload = {}) {
    const effects = [];
    switch (event) {
      case EVENTS.ENABLE:
        this.enabled = true;
        return this.transition(
          this.sessionId ? STATES.PLAYER_INTERACTION : STATES.SUSPENDED,
          event,
          effects,
        );
      case EVENTS.DISABLE:
        this.enabled = false;
        this.popupDepth = 0;
        this.requestId = null;
        this.capture = null;
        effects.push("hide-highlight", "dismiss-popup", "set-passive-input");
        return this.transition(STATES.INACTIVE, event, effects);
      case EVENTS.SESSION_READY:
        this.sessionId = String(payload.sessionId || "");
        this.geometryGeneration = Number(payload.geometryGeneration);
        if (!this.sessionId || !Number.isInteger(this.geometryGeneration))
          throw new TypeError(
            "session-ready requires sessionId and geometryGeneration",
          );
        return this.transition(
          this.enabled ? STATES.PLAYER_INTERACTION : STATES.INACTIVE,
          event,
          ["show-passive-surface"],
        );
      case EVENTS.SESSION_LOST:
      case EVENTS.SHUTDOWN:
        this.sessionId = null;
        this.geometryGeneration = null;
        this.popupDepth = 0;
        this.requestId = null;
        this.capture = null;
        effects.push("hide-highlight", "dismiss-popup", "set-passive-input");
        return this.transition(
          EVENTS.SHUTDOWN === event ? STATES.INACTIVE : STATES.SUSPENDED,
          event,
          effects,
        );
      case EVENTS.POINTER_TARGET:
        if (
          !this.enabled ||
          !this.sessionId ||
          this.state === STATES.INACTIVE ||
          this.state === STATES.SUSPENDED ||
          [
            STATES.POPUP_ACTIVE,
            STATES.NESTED_POPUP_ACTIVE,
            STATES.TEXT_SELECTION,
            STATES.AUDIO_MENU,
          ].includes(this.state)
        )
          return [];
        effects.push("highlight", payload.hit);
        return this.transition(STATES.HOVER_CANDIDATE, event, effects);
      case EVENTS.POINTER_NONE:
        if (
          this.state === STATES.POPUP_ACTIVE ||
          this.state === STATES.NESTED_POPUP_ACTIVE ||
          this.state === STATES.TEXT_SELECTION ||
          this.state === STATES.AUDIO_MENU
        )
          return [];
        effects.push("hide-highlight");
        return this.transition(STATES.PLAYER_INTERACTION, event, effects);
      case EVENTS.LOOKUP_REQUESTED:
        if (
          this.state !== STATES.HOVER_CANDIDATE &&
          this.state !== STATES.PLAYER_INTERACTION
        )
          return [];
        this.requestId = String(payload.requestId || "");
        if (!this.requestId) throw new TypeError("lookup-requested requires requestId");
        effects.push("request-lookup", payload);
        return this.transition(STATES.LOOKUP_PENDING, event, effects);
      case EVENTS.LOOKUP_SUCCEEDED:
        if (
          this.state !== STATES.LOOKUP_PENDING ||
          String(payload.requestId) !== this.requestId
        )
          return ["discard-stale-result"];
        effects.push(
          "render-popup",
          payload.result,
          "focus-popup",
          "set-interactive-input",
        );
        return this.transition(STATES.POPUP_ACTIVE, event, effects);
      case EVENTS.LOOKUP_FAILED:
        if (
          this.state !== STATES.LOOKUP_PENDING ||
          String(payload.requestId) !== this.requestId
        )
          return ["discard-stale-error"];
        this.requestId = null;
        effects.push("show-lookup-error", "set-passive-input");
        return this.transition(STATES.PLAYER_INTERACTION, event, effects);
      case EVENTS.POPUP_OPENED:
        if (this.state !== STATES.POPUP_ACTIVE) return [];
        return ["popup-opened"];
      case EVENTS.NESTED_OPENED:
        if (
          this.state !== STATES.POPUP_ACTIVE &&
          this.state !== STATES.NESTED_POPUP_ACTIVE
        )
          return [];
        this.popupDepth += 1;
        effects.push("render-nested-popup", payload, "focus-popup");
        return this.transition(STATES.NESTED_POPUP_ACTIVE, event, effects);
      case EVENTS.POPUP_ACTION:
        if (
          this.state !== STATES.POPUP_ACTIVE &&
          this.state !== STATES.NESTED_POPUP_ACTIVE &&
          this.state !== STATES.AUDIO_MENU
        )
          return ["consume-input"];
        effects.push("handle-popup-action", payload);
        return effects;
      case EVENTS.AUDIO_OPENED:
        if (
          this.state !== STATES.POPUP_ACTIVE &&
          this.state !== STATES.NESTED_POPUP_ACTIVE
        )
          return [];
        effects.push("render-audio-menu", payload, "focus-popup");
        return this.transition(STATES.AUDIO_MENU, event, effects);
      case EVENTS.CLOSE_TRANSIENT:
        if (this.state === STATES.AUDIO_MENU) {
          effects.push("close-audio-menu", "focus-popup");
          return this.transition(
            this.popupDepth ? STATES.NESTED_POPUP_ACTIVE : STATES.POPUP_ACTIVE,
            event,
            effects,
          );
        }
        return [];
      case EVENTS.CLOSE_POPUP:
        if (this.state === STATES.NESTED_POPUP_ACTIVE && this.popupDepth > 0) {
          this.popupDepth -= 1;
          this.capture = null;
          effects.push("close-deepest-popup", "focus-popup");
          return this.transition(
            this.popupDepth ? STATES.NESTED_POPUP_ACTIVE : STATES.POPUP_ACTIVE,
            event,
            effects,
          );
        }
        if (this.state === STATES.POPUP_ACTIVE) {
          this.popupDepth = 0;
          this.requestId = null;
          this.capture = null;
          effects.push("dismiss-popup", "focus-player", "set-passive-input");
          return this.transition(STATES.PLAYER_INTERACTION, event, effects);
        }
        return [];
      case EVENTS.OUTSIDE_POINTER_DOWN:
        if (
          this.state === STATES.POPUP_ACTIVE ||
          this.state === STATES.NESTED_POPUP_ACTIVE ||
          this.state === STATES.AUDIO_MENU
        ) {
          effects.push("dismiss-deepest-or-popup", "consume-input");
          return this.transition(STATES.PLAYER_INTERACTION, event, effects);
        }
        return [];
      case EVENTS.POINTER_DOWN:
        if (
          this.state === STATES.POPUP_ACTIVE ||
          this.state === STATES.NESTED_POPUP_ACTIVE ||
          this.state === STATES.TEXT_SELECTION ||
          this.state === STATES.AUDIO_MENU
        ) {
          this.capture = {
            button: payload.button || 0,
            startedAt: Number(payload.time) || Date.now(),
          };
          return ["consume-input", "capture-pointer"];
        }
        return ["pass-to-player"];
      case EVENTS.SELECTION_START:
        if (
          this.state !== STATES.POPUP_ACTIVE &&
          this.state !== STATES.NESTED_POPUP_ACTIVE
        )
          return ["consume-input"];
        this.capture = {
          kind: "text-selection",
          pointerId: Number.isInteger(payload.pointerId) ? payload.pointerId : null,
          button: payload.button || 0,
          startedAt: Number(payload.time) || Date.now(),
        };
        effects.push("consume-input", "capture-pointer");
        return this.transition(STATES.TEXT_SELECTION, event, effects);
      case EVENTS.SELECTION_END:
      case EVENTS.POINTER_CANCEL:
        if (this.state !== STATES.TEXT_SELECTION) return [];
        this.capture = null;
        effects.push("consume-input", "release-pointer");
        return this.transition(
          this.popupDepth ? STATES.NESTED_POPUP_ACTIVE : STATES.POPUP_ACTIVE,
          event,
          effects,
        );
      case EVENTS.POINTER_UP:
        if (this.capture) {
          if (this.capture.kind === "text-selection")
            return this.dispatch(EVENTS.SELECTION_END, payload);
          this.capture = null;
          return ["consume-input", "release-pointer"];
        }
        return ["pass-to-player"];
      case EVENTS.FOCUS_PLAYER:
        if (
          this.state === STATES.POPUP_ACTIVE ||
          this.state === STATES.NESTED_POPUP_ACTIVE ||
          this.state === STATES.TEXT_SELECTION ||
          this.state === STATES.AUDIO_MENU
        )
          return [];
        return ["focus-player"];
      case EVENTS.FOCUS_OVERLAY:
        if (
          this.state === STATES.POPUP_ACTIVE ||
          this.state === STATES.NESTED_POPUP_ACTIVE ||
          this.state === STATES.TEXT_SELECTION ||
          this.state === STATES.AUDIO_MENU
        )
          return ["keep-popup-focus"];
        return [];
      case EVENTS.GEOMETRY_INVALIDATED:
        this.geometryGeneration = Number(payload.geometryGeneration);
        if (!Number.isInteger(this.geometryGeneration))
          throw new TypeError("geometry generation must be an integer");
        this.requestId = null;
        this.capture = null;
        effects.push("hide-highlight", "cancel-lookup");
        if (this.state === STATES.LOOKUP_PENDING)
          return this.transition(STATES.PLAYER_INTERACTION, event, effects);
        return this.transition(this.state, event, effects);
      case EVENTS.ESCAPE:
        if (this.state === STATES.AUDIO_MENU)
          return this.dispatch(EVENTS.CLOSE_TRANSIENT, payload);
        if (this.state === STATES.NESTED_POPUP_ACTIVE)
          return this.dispatch(EVENTS.CLOSE_POPUP, payload);
        if (this.state === STATES.POPUP_ACTIVE)
          return this.dispatch(EVENTS.CLOSE_POPUP, payload);
        if (this.state === STATES.SETTINGS) return ["close-settings", "consume-input"];
        return ["pass-to-player"];
      default:
        throw new Error(`unknown interaction event: ${event}`);
    }
  }
}

module.exports = { EVENTS, InteractionController, STATES };
