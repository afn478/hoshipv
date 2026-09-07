"use strict";

const path = require("node:path");
const { EventEmitter } = require("node:events");
const { MpvJsonIpc } = require("./mpv-ipc");
const { normalizeDescriptor } = require("./session-descriptor");

const OBSERVED_PROPERTIES = Object.freeze([
  "time-pos",
  "pause",
  "path",
  "media-title",
  "track-list",
  "sid",
  "secondary-sid",
  "sub-visibility",
  "secondary-sub-visibility",
  "osd-width",
  "osd-height",
  "osd-dimensions",
  "osd-par",
  "video-out-params",
  "sub-text/ass-full",
  "sub-text",
  "sub-ass-extradata",
  "secondary-sub-text/ass-full",
  "secondary-sub-text",
  "secondary-sub-ass-extradata",
  "sub-start",
  "sub-start/full",
  "sub-end",
  "sub-end/full",
  "secondary-sub-start",
  "secondary-sub-start/full",
  "secondary-sub-end",
  "secondary-sub-end/full",
  "sub-delay",
  "secondary-sub-delay",
  "sub-speed",
  "sub-scale",
  "sub-font",
  "sub-font-provider",
  "sub-font-size",
  "sub-color",
  "sub-border-color",
  "sub-shadow-color",
  "sub-border-style",
  "sub-outline-size",
  "sub-shadow-offset",
  "sub-bold",
  "sub-italic",
  "sub-spacing",
  "sub-line-spacing",
  "sub-margin-x",
  "sub-margin-y",
  "sub-align-x",
  "sub-align-y",
  "sub-justify",
  "sub-use-margins",
  "sub-scale-by-window",
  "sub-scale-with-window",
  "sub-pos",
  "secondary-sub-pos",
  "sub-ass-override",
  "secondary-sub-ass-override",
  "sub-ass-justify",
  "fullscreen",
  "window-minimized",
  "vo-configured",
]);

const ALLOWED_COMMANDS = Object.freeze({
  "toggle-pause": ["cycle", "pause"],
  "seek-backward": ["seek", -5, "relative", "exact"],
  "seek-forward": ["seek", 5, "relative", "exact"],
  "subtitle-previous": ["sub-seek", -1],
  "subtitle-next": ["sub-seek", 1],
  "frame-step-backward": ["frame-back-step"],
  "frame-step-forward": ["frame-step"],
  "volume-down": ["add", "volume", -5],
  "volume-up": ["add", "volume", 5],
  "speed-down": ["add", "speed", -0.1],
  "speed-up": ["add", "speed", 0.1],
});

const GEOMETRY_PROPERTIES = new Set([
  "path",
  "track-list",
  "sid",
  "secondary-sid",
  "sub-visibility",
  "secondary-sub-visibility",
  "sub-text/ass-full",
  "sub-text",
  "sub-ass-extradata",
  "secondary-sub-text/ass-full",
  "secondary-sub-text",
  "secondary-sub-ass-extradata",
  "sub-start",
  "sub-start/full",
  "sub-end",
  "sub-end/full",
  "secondary-sub-start",
  "secondary-sub-start/full",
  "secondary-sub-end",
  "secondary-sub-end/full",
  "sub-delay",
  "secondary-sub-delay",
  "sub-speed",
  "osd-dimensions",
  "osd-width",
  "osd-height",
  "osd-par",
  "video-out-params",
  "sub-scale",
  "sub-font",
  "sub-font-provider",
  "sub-font-size",
  "sub-color",
  "sub-border-color",
  "sub-shadow-color",
  "sub-border-style",
  "sub-outline-size",
  "sub-shadow-offset",
  "sub-bold",
  "sub-italic",
  "sub-spacing",
  "sub-line-spacing",
  "sub-margin-x",
  "sub-margin-y",
  "sub-align-x",
  "sub-align-y",
  "sub-justify",
  "sub-use-margins",
  "sub-scale-by-window",
  "sub-scale-with-window",
  "sub-pos",
  "secondary-sub-pos",
  "sub-ass-override",
  "secondary-sub-ass-override",
  "sub-ass-justify",
]);

function numeric(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseDimensions(value, width, height, par) {
  if (value && typeof value === "object") {
    return {
      width: numeric(value.w || value.width, numeric(width, 0)),
      height: numeric(value.h || value.height, numeric(height, 0)),
      marginLeft: numeric(value.ml, 0),
      marginRight: numeric(value.mr, 0),
      marginTop: numeric(value.mt, 0),
      marginBottom: numeric(value.mb, 0),
      par: numeric(value.par, numeric(par, 1)),
    };
  }
  return {
    width: numeric(width, 0),
    height: numeric(height, 0),
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    marginBottom: 0,
    par: numeric(par, 1),
  };
}

function selectedSubtitleTrack(properties, role) {
  const selected = properties.get(role === "secondary" ? "secondary-sid" : "sid");
  const tracks = properties.get("track-list");
  if (!Array.isArray(tracks) || selected === null || selected === undefined)
    return null;
  return (
    tracks.find(
      (track) => track && track.type === "sub" && String(track.id) === String(selected),
    ) || null
  );
}

function numberProperty(properties, name, fallback) {
  return numeric(properties.get(name), fallback);
}

// mpv exposes subtitle cue times in seconds, while the `/full` variants are
// already milliseconds. The bridge contract is milliseconds so the geometry
// and media clocks use one unit even when a build exposes both forms.
function timeMilliseconds(properties, fullName, secondsName) {
  const fullMilliseconds = numeric(properties.get(fullName), null);
  const seconds = numeric(properties.get(secondsName), null);
  if (fullMilliseconds !== null) {
    // Some released mpv builds expose the `/full` property through JSON IPC
    // with the same seconds scalar as the non-full property. Prefer the
    // documented millisecond value when the two forms differ, but recognize
    // that legacy representation without making all callers guess units.
    if (seconds !== null && Math.abs(fullMilliseconds - seconds) <= 0.000001)
      return seconds * 1000;
    return fullMilliseconds;
  }
  return seconds === null ? NaN : seconds * 1000;
}

function booleanProperty(properties, name, fallback = false) {
  const value = properties.get(name);
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return /^(yes|true|1|on)$/i.test(value);
  return !!value;
}

class PlayerBridge extends EventEmitter {
  constructor(descriptor, options = {}) {
    super();
    this.descriptor = normalizeDescriptor(descriptor);
    this.ipc = options.ipc || new MpvJsonIpc(this.descriptor.ipcEndpoint, options);
    this.properties = new Map();
    this.connected = false;
    this.mediaGeneration = 0;
    this.geometryGeneration = 0;
    this.#bindIpc();
  }

  #bindIpc() {
    this.ipc.on("property-change", (name, value) => {
      const previous = this.properties.get(name);
      this.properties.set(name, value);
      const geometryChanged =
        GEOMETRY_PROPERTIES.has(name) &&
        JSON.stringify(previous) !== JSON.stringify(value);
      if (geometryChanged) this.geometryGeneration++;
      if (name === "path" && previous !== value) this.mediaGeneration++;
      this.emit("property", name, value, previous);
      if (geometryChanged)
        this.emit("geometry-invalidated", {
          name,
          value,
          mediaGeneration: this.mediaGeneration,
          geometryGeneration: this.geometryGeneration,
        });
    });
    this.ipc.on("closed", (error) => {
      this.connected = false;
      this.emit("disconnected", error);
    });
  }

  async connect() {
    await this.ipc.connect();
    try {
      const pid = numeric(await this.ipc.getProperty("pid"), this.descriptor.pid);
      if (pid !== this.descriptor.pid)
        throw new Error("mpv session identity changed while connecting");
      for (const property of OBSERVED_PROPERTIES) {
        try {
          await this.ipc.observeProperty(property);
          // Install the observer before reading the current value. A media
          // file can already be inside a subtitle event when the bridge
          // connects; observing first prevents that state from being missed
          // between the initial get_property and observe_property requests.
          this.properties.set(property, await this.ipc.getProperty(property));
        } catch (error) {
          if (error?.code === "MPV_IPC_TIMEOUT") {
            const timeout = new Error(`mpv property bridge timed out for ${property}`, {
              cause: error,
            });
            timeout.code = error.code;
            timeout.property = property;
            throw timeout;
          }
          this.emit("capability-missing", property, error);
        }
      }
    } catch (error) {
      this.ipc.close();
      throw error;
    }
    this.connected = true;
    this.emit("connected", this.identity());
    return this.identity();
  }

  identity() {
    return Object.freeze({
      ...this.descriptor,
      mediaGeneration: this.mediaGeneration,
      geometryGeneration: this.geometryGeneration,
    });
  }

  property(name, fallback = null) {
    return this.properties.has(name) ? this.properties.get(name) : fallback;
  }

  geometryInput() {
    const dimensions = parseDimensions(
      this.property("osd-dimensions"),
      this.property("osd-width"),
      this.property("osd-height"),
      this.property("osd-par"),
    );
    const pathValue = String(this.property("path", "") || "");
    const videoOut = this.property("video-out-params", {}) || {};
    const baseRenderer = {
      storageWidth: numeric(videoOut.w || videoOut.width, dimensions.width),
      storageHeight: numeric(videoOut.h || videoOut.height, dimensions.height),
      marginLeft: dimensions.marginLeft,
      marginRight: dimensions.marginRight,
      marginTop: dimensions.marginTop,
      marginBottom: dimensions.marginBottom,
      pixelAspect: dimensions.par,
      fontScale: numberProperty(this.properties, "sub-scale", 1),
      fontSize: numberProperty(this.properties, "sub-font-size", 38),
      outlineSize: numberProperty(this.properties, "sub-outline-size", 1.65),
      shadowOffset: numberProperty(this.properties, "sub-shadow-offset", 0),
      lineSpacing: numberProperty(this.properties, "sub-line-spacing", 0),
      marginX: numberProperty(this.properties, "sub-margin-x", 19),
      marginY: numberProperty(this.properties, "sub-margin-y", 34),
      alignX: String(this.property("sub-align-x", "center") || "center"),
      alignY: String(this.property("sub-align-y", "bottom") || "bottom"),
      useMargins: booleanProperty(this.properties, "sub-use-margins", true),
      bold: booleanProperty(this.properties, "sub-bold"),
      italic: booleanProperty(this.properties, "sub-italic"),
      spacing: numberProperty(this.properties, "sub-spacing", 0),
      forceMargins: false,
      embeddedFonts: true,
      useStorageSize: true,
      overrideMode: String(this.property("sub-ass-override", "yes") || "yes"),
      defaultFamily: String(this.property("sub-font", "sans-serif") || "sans-serif"),
      fontProvider: String(this.property("sub-font-provider", "auto") || "auto"),
      primaryColor: String(this.property("sub-color", "#FFFFFFFF") || "#FFFFFFFF"),
      borderColor: String(
        this.property("sub-border-color", "#FF000000") || "#FF000000",
      ),
      shadowColor: String(
        this.property("sub-shadow-color", "#AF000000") || "#AF000000",
      ),
      borderStyle: String(
        this.property("sub-border-style", "outline-and-shadow") || "outline-and-shadow",
      ),
      scaleWithWindow: booleanProperty(this.properties, "sub-scale-with-window", true),
      scaleByWindow: booleanProperty(this.properties, "sub-scale-by-window", true),
      assJustify: booleanProperty(this.properties, "sub-ass-justify"),
      hinting: "none",
      shaper: "complex",
    };
    const makeSubtitle = (
      role,
      textName,
      plainTextName,
      extraName,
      startName,
      endName,
      startFullName,
      endFullName,
    ) => {
      const track = selectedSubtitleTrack(this.properties, role);
      const externalPath = track?.["external-filename"] || track?.externalFilename;
      const ffIndex = numeric(track?.["ff-index"], -1);
      const hasFfIndex = Number.isInteger(ffIndex) && ffIndex >= 0;
      const sourcePath = externalPath || pathValue;
      const overrideName =
        role === "secondary" ? "secondary-sub-ass-override" : "sub-ass-override";
      const overrideFallback =
        role === "secondary" ? "strip" : baseRenderer.overrideMode;
      const visibilityName =
        role === "secondary" ? "secondary-sub-visibility" : "sub-visibility";
      const renderer = {
        ...baseRenderer,
        linePosition:
          100 -
          numberProperty(
            this.properties,
            role === "secondary" ? "secondary-sub-pos" : "sub-pos",
            100,
          ),
        overrideMode: String(
          this.property(overrideName, overrideFallback) || overrideFallback,
        ),
      };
      return {
        selected: !!track && booleanProperty(this.properties, visibilityName, true),
        assFull: String(this.property(textName, "") || ""),
        plainText: String(this.property(plainTextName, "") || ""),
        extradata: String(this.property(extraName, "") || ""),
        startMs: timeMilliseconds(this.properties, startFullName, startName),
        endMs: timeMilliseconds(this.properties, endFullName, endName),
        source: sourcePath
          ? {
              path: String(sourcePath),
              ffIndex,
              external: !!externalPath,
              autoAssStream: !hasFfIndex,
              cacheExcerpt: !externalPath && /^https?:\/\//i.test(sourcePath),
            }
          : null,
        renderer,
      };
    };
    return {
      sessionId: this.descriptor.sessionId,
      mediaGeneration: this.mediaGeneration,
      geometryGeneration: this.geometryGeneration,
      timeMs: numeric(this.property("time-pos"), 0) * 1000,
      osd: { width: dimensions.width, height: dimensions.height },
      osdProperties: dimensions,
      primary: {
        ...makeSubtitle(
          "primary",
          "sub-text/ass-full",
          "sub-text",
          "sub-ass-extradata",
          "sub-start",
          "sub-end",
          "sub-start/full",
          "sub-end/full",
        ),
      },
      secondary: {
        ...makeSubtitle(
          "secondary",
          "secondary-sub-text/ass-full",
          "secondary-sub-text",
          "secondary-sub-ass-extradata",
          "secondary-sub-start",
          "secondary-sub-end",
          "secondary-sub-start/full",
          "secondary-sub-end/full",
        ),
      },
    };
  }

  async command(name) {
    const command = ALLOWED_COMMANDS[name];
    if (!command) throw new Error(`player command is not allowed: ${name}`);
    return this.ipc.command(...command);
  }

  async setPause(value, source = "plugin") {
    if (source !== "plugin" && source !== "user")
      throw new Error("invalid pause source");
    return this.ipc.setProperty("pause", !!value);
  }

  async screenshotToFile(filePath, quality = 85) {
    const target = String(filePath || "");
    if (!path.isAbsolute(target)) throw new Error("screenshot path must be absolute");
    const jpegQuality = Math.max(1, Math.min(100, Math.round(Number(quality) || 85)));
    await this.ipc.setProperty("screenshot-jpeg-quality", jpegQuality).catch(() => {});
    return this.ipc.command("screenshot-to-file", target, "video");
  }

  close() {
    this.ipc.close();
  }
}

module.exports = {
  ALLOWED_COMMANDS,
  OBSERVED_PROPERTIES,
  PlayerBridge,
  parseDimensions,
};
