IINATAN.OBSERVED_PROPERTIES = [
  ["path", "string"],
  ["stream-open-filename", "string"],
  ["sub-text", "string"],
  ["sub-text/ass-full", "string"],
  ["sub-ass-extradata", "string"],
  ["sub-start", "number"],
  ["sub-end", "number"],
  ["secondary-sub-text", "string"],
  ["secondary-sub-text/ass-full", "string"],
  ["secondary-sub-ass-extradata", "string"],
  ["secondary-sub-start", "number"],
  ["secondary-sub-end", "number"],
  ["sid", "native"],
  ["secondary-sid", "native"],
  ["track-list", "native"],
  ["sub-delay", "number"],
  ["secondary-sub-delay", "number"],
  ["pause", "bool"],
  ["time-pos", "number"],
  ["osd-dimensions", "native"],
  ["video-out-params", "native"],
  ["mouse-pos", "native"],
  ["user-data/osc/margins", "native"],
  ["sub-font", "string"],
  ["sub-font-size", "number"],
  ["sub-bold", "bool"],
  ["sub-italic", "bool"],
  ["sub-spacing", "number"],
  ["sub-margin-x", "number"],
  ["sub-margin-y", "number"],
  ["sub-pos", "number"],
  ["sub-scale", "number"],
  ["sub-ass-override", "string"],
];

IINATAN.mediaGeneration = 0;
IINATAN.propertyChanged = function (name, value) {
  IINATAN.state.properties[name] = value;
  if (name === "mouse-pos") {
    IINATAN.state.mouseSerial = (IINATAN.state.mouseSerial || 0) + 1;
    IINATAN.updateSelection();
  }
  IINATAN.debounce("property-rebuild", IINATAN.rebuildFromProperties);
};

IINATAN.rebuildFromProperties = function () {
  if (!IINATAN.state.fileLoaded) return;
  var props = IINATAN.state.properties;
  var primary = {
    surface: "primary",
    text: String(props["sub-text"] || ""),
    ass: String(props["sub-text/ass-full"] || ""),
    extradata: String(props["sub-ass-extradata"] || ""),
    start: Number(props["sub-start"]),
    end: Number(props["sub-end"]),
    secondaryStart: Number(props["secondary-sub-start"]),
    secondaryEnd: Number(props["secondary-sub-end"]),
    delay: Number(props["sub-delay"] || 0),
  };
  IINATAN.state.subtitles = primary.text ? [primary] : [];
  if (props["secondary-sub-text"]) {
    var secondary = {
      surface: "secondary",
      text: String(props["secondary-sub-text"] || ""),
      ass: String(props["secondary-sub-text/ass-full"] || ""),
      extradata: String(
        props["secondary-sub-ass-extradata"] ||
          props["sub-ass-extradata"] ||
          "",
      ),
      start: Number(props["secondary-sub-start"]),
      end: Number(props["secondary-sub-end"]),
      delay: Number(props["secondary-sub-delay"] || 0),
    };
    IINATAN.state.subtitles.push(secondary);
  }
  IINATAN.state.subtitle = IINATAN.state.subtitles[0] || primary;
  IINATAN.state.osd = props["osd-dimensions"] || {
    w: 0,
    h: 0,
    ml: 0,
    mr: 0,
    mt: 0,
    mb: 0,
  };
  IINATAN.state.mouse = props["mouse-pos"] || { hover: false, x: 0, y: 0 };
  IINATAN.emit("state", IINATAN.state);
  IINATAN.rebuildScene();
  IINATAN.requestBitmapSubtitleOcr();
};

IINATAN.mediaSource = function () {
  var props = IINATAN.state.properties;
  var path = String(props.path || "");
  var effective = String(props["stream-open-filename"] || "");
  var primary = effective || path;
  var audio = primary;
  var tracks = Array.isArray(props["track-list"]) ? props["track-list"] : [];
  tracks.forEach(function (track) {
    if (
      track &&
      track.type === "audio" &&
      track.selected &&
      (track["external-filename"] || track.externalFilename)
    )
      audio = track["external-filename"] || track.externalFilename;
  });
  return {
    path: path,
    streamOpenFilename: effective,
    primary: primary,
    audio: audio,
    title: String(mp.get_property("media-title", "video")),
  };
};

IINATAN.captureCardMediaContext = function () {
  var sub = IINATAN.state.subtitle || {};
  return {
    generation: IINATAN.mediaGeneration,
    source: IINATAN.mediaSource(),
    subtitleStart: isFinite(sub.start) ? sub.start : null,
    subtitleEnd: isFinite(sub.end) ? sub.end : null,
    subtitleDelay: Number(sub.delay || 0),
    timeFallback: Number(IINATAN.state.properties["time-pos"] || 0),
    sentence: String(sub.text || ""),
  };
};

IINATAN.sentenceAudioWindow = function (context, paddingMs) {
  var padding = IINATAN.clamp(paddingMs, 0, 2000, 250) / 1000;
  var start = context.subtitleStart;
  var end = context.subtitleEnd;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !isFinite(start) ||
    !isFinite(end)
  ) {
    start = Math.max(0, context.timeFallback - 1.5);
    end = context.timeFallback + 1.5;
  } else {
    start = Math.max(0, start + context.subtitleDelay - padding);
    end = end + context.subtitleDelay + padding;
  }
  end = Math.max(start + 0.25, Math.min(start + 35, end));
  return { start: start, end: end, duration: end - start };
};
