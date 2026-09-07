"use strict";

class PauseOwnership {
  constructor() {
    this.reset();
  }

  reset() {
    this.pluginPaused = false;
    this.wasPaused = null;
    this.userPauseSeen = false;
    this.generation = null;
    this.expectedPause = null;
  }

  open({ wasPaused, generation }) {
    this.wasPaused = !!wasPaused;
    this.generation = generation;
    this.userPauseSeen = false;
    this.expectedPause = null;
    this.pluginPaused = !this.wasPaused;
    return this.pluginPaused ? ["pause"] : [];
  }

  notePluginPause(paused, generation = this.generation) {
    if (!this.pluginPaused || this.generation !== generation) return;
    this.expectedPause = !!paused;
  }

  observePauseChange({ paused, source, generation }) {
    if (this.generation !== generation) return [];
    if (!this.pluginPaused) return [];
    const value = !!paused;
    if (this.expectedPause !== null && this.expectedPause === value) {
      this.expectedPause = null;
      return [];
    }
    if (source !== "plugin") this.userPauseSeen = true;
    return [];
  }

  close({ generation, reason = "dismissed" }) {
    if (this.generation !== generation) return [];
    const shouldResume =
      this.pluginPaused && !this.userPauseSeen && reason !== "shutdown";
    this.reset();
    return shouldResume ? ["resume"] : [];
  }

  cancel(generation) {
    return this.close({ generation, reason: "cancelled" });
  }
}

module.exports = { PauseOwnership };
