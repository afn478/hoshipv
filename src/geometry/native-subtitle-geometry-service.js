"use strict";

const { stripAssTags } = require("./plain-subtitle");
const { SubtitleGeometryProvider } = require("./subtitle-geometry-provider");

const NATIVE_OVERRIDE_MODES = new Set(["no", "yes", "scale"]);
const OBSERVED_STRIP_SOURCE = "iinatan-observed-secondary-ass";
const OBSERVED_STRIP_STYLE = "IinatanSecondaryStrip";
const OBSERVED_SUBRIP_SOURCE = "iinatan-observed-subrip";
const SUBRIP_PLAY_RES_Y = 288;
const DEFAULT_FILTER_SDH_ENCLOSURES = Object.freeze(["()", "[]", "（）"]);
const VALIDATED_PLAYER_CAPABILITY = Object.freeze({
  mpvVersion: "0.41.0",
  libassVersion: "0.17.5",
  ffmpegVersion: "9.0.1",
});
const WINDOWS_LIBASS_0174_SUBRIP_PROFILE = Object.freeze({
  id: "windows-mpv-0.41.0-libass-0.17.4-external-subrip",
  playerCompatibility: Object.freeze({
    mpvVersion: "0.41.0",
    libassVersion: "0.17.4",
  }),
  inputScope: "external-subrip",
});
const WINDOWS_LIBASS_0174_EMBEDDED_ASS_PROFILE = Object.freeze({
  id: "windows-mpv-0.41.0-libass-0.17.4-embedded-ass",
  playerCompatibility: Object.freeze({
    mpvVersion: "0.41.0",
    libassVersion: "0.17.4",
  }),
  inputScope: "embedded-ass",
});
const DEFAULT_STRIP_RENDERER = Object.freeze({
  fontFamily: "sans-serif",
  fontSize: 38,
  outlineSize: 1.65,
  shadowOffset: 0,
  marginX: 19,
  marginY: 34,
  alignX: "center",
  alignY: "bottom",
  useMargins: true,
  bold: false,
  italic: false,
  spacing: 0,
  fontScale: 1,
  lineSpacing: 0,
  pixelAspect: 1,
  fontProvider: "auto",
  assJustify: false,
  hinting: "none",
  shaper: "complex",
  primaryColor: "#FFFFFFFF",
  borderColor: "#FF000000",
  shadowColor: "#AF000000",
});

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function assDecimal(value) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(String(value).trim());
}

function assVectorClip(value) {
  let body = String(value).trim();
  const comma = body.indexOf(",");
  if (comma >= 0) {
    if (!assDecimal(body.slice(0, comma))) return false;
    body = body.slice(comma + 1).trim();
  }
  if (!body || body.includes(",")) return false;

  let command = null;
  let arity = 0;
  let remaining = 0;
  let pointFound = false;
  for (const token of body.split(/\s+/u)) {
    const lower = token.toLowerCase();
    if (/^[mnlbspc]$/u.test(lower)) {
      if (remaining !== 0) return false;
      command = lower;
      arity = lower === "b" || lower === "s" ? 6 : lower === "p" ? 1 : 2;
      remaining = lower === "c" ? 0 : arity;
      if (lower === "c") command = null;
      continue;
    }
    if (!command || !assDecimal(token)) return false;
    if (remaining === 0) remaining = arity;
    remaining -= 1;
    pointFound = true;
  }
  return pointFound && remaining === 0;
}

function assPositionTag(token) {
  const match = /^pos\(\s*([^,]+?)\s*,\s*([^,)]+?)\s*\)$/iu.exec(token);
  return !!match && assDecimal(match[1]) && assDecimal(match[2]);
}

function assMoveTag(token) {
  const match = /^move\(([^()]*)\)$/iu.exec(token);
  if (!match) return false;
  const values = match[1].split(",");
  return (values.length === 4 || values.length === 6) && values.every(assDecimal);
}

function assStaticRendererTag(token) {
  const scalar =
    /^(?:xbord|ybord|xshad|yshad|fscx|fscy|fsp|bord|shad|frx|fry|frz|fax|fay|blur|fs|fr|be|b)(.*)$/iu.exec(
      token,
    );
  if (scalar && (!scalar[1] || assDecimal(scalar[1]))) return true;
  if (/^fsc$/iu.test(token)) return true;
  if (/^an[1-9]$/iu.test(token) || /^a(?:[1-9]|1[01])?$/iu.test(token)) return true;
  if (/^q[0-3]$/iu.test(token)) return true;
  if (/^fn(?:\S(?:.*\S)?)?$/iu.test(token)) return true;
  if (/^[isu][01]?$/iu.test(token)) return true;
  if (/^p0?$/iu.test(token)) return true;
  if (/^pbo(?:.*)$/iu.test(token)) {
    const value = token.slice(3);
    return !value || assDecimal(value);
  }
  if (/^fe(?:.*)$/iu.test(token)) {
    const value = token.slice(2);
    return !value || assDecimal(value);
  }
  const origin = /^org\(([^()]*)\)$/iu.exec(token);
  if (origin) {
    const values = origin[1].split(",");
    if (values.length === 2 && values.every(assDecimal)) return true;
  }
  const fade = /^(?:fad|fade)\(([^()]*)\)$/iu.exec(token);
  if (fade) {
    const values = fade[1].split(",");
    if ((values.length === 2 || values.length === 7) && values.every(assDecimal))
      return true;
  }
  if (/^r(?:[a-z0-9 _-]+)?$/iu.test(token)) return true;
  if (/^(?:k|kf|ko|kt)\d+$/iu.test(token)) return true;
  const clip = /^(?:i?clip)\(([^()]*)\)$/iu.exec(token);
  if (!clip) return false;
  const values = clip[1].split(",");
  return (values.length === 4 && values.every(assDecimal)) || assVectorClip(clip[1]);
}

function assOverrideTokens(content) {
  const tokens = [];
  let tokenStart = 0;
  let depth = 0;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === "\\" && depth === 0) {
      if (index === content.length - 1) return null;
      if (index > tokenStart) tokens.push(content.slice(tokenStart, index));
      tokenStart = index + 1;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
  }
  if (depth !== 0) return null;
  if (tokenStart < content.length) tokens.push(content.slice(tokenStart));
  return tokens.filter(Boolean);
}

function assTransformTag(token) {
  const match = /^t\((.*)\)$/iu.exec(token);
  if (!match) return false;
  const body = match[1];
  const modifierStart = body.indexOf("\\");
  if (modifierStart < 0) return false;
  const timing = body.slice(0, modifierStart).trim().replace(/,$/u, "").trim();
  if (timing) {
    const values = timing.split(",");
    if (values.length > 3 || !values.every(assDecimal)) return false;
  }
  const modifiers = assOverrideTokens(body.slice(modifierStart));
  return (
    !!modifiers?.length &&
    modifiers.every((modifier) => assSupportedToken(modifier, false))
  );
}

function assSupportedToken(token, allowTransform = true) {
  return (
    /^i[01]$/iu.test(token) ||
    /^(?:[1-4]?c|alpha|[1-4]a)(?:&H[0-9a-f]{1,8}&)?$/iu.test(token) ||
    assPositionTag(token) ||
    assMoveTag(token) ||
    assStaticRendererTag(token) ||
    (allowTransform && assTransformTag(token))
  );
}

function assOverrideTagLength(text, offset) {
  if (text[offset] !== "{") return 0;
  const close = text.indexOf("}", offset + 1);
  if (close <= offset + 1 || text[offset + 1] !== "\\") return 0;
  for (let index = offset + 1; index < close; index++) {
    if (text[index] === "{" || text[index] === "}" || /[\r\n]/u.test(text[index]))
      return 0;
  }
  const tokens = assOverrideTokens(text.slice(offset + 2, close));
  if (!tokens?.length || tokens.some((token) => !assSupportedToken(token))) return 0;
  return close - offset + 1;
}

function displayIndex(plain, supported) {
  return Object.freeze({
    plain,
    logicalLength: plain.length,
    plainToLogical: Array.from({ length: plain.length + 1 }, (_, index) => index),
    supported,
  });
}

/*
 * The native protocol uses UTF-16 boundaries in the decoded display text,
 * while the browser-facing snapshot uses UTF-16 ranges around grapheme
 * clusters. A grapheme may contain multiple UTF-16 code units, so preserve
 * those boundaries here and let the browser snapshot retain the grapheme
 * identity.
 */
function nativeDisplayIndex(rawText) {
  const raw = String(rawText || "");
  let plain = "";
  let offset = 0;
  let supported = true;

  while (offset < raw.length) {
    if (raw[offset] === "{") {
      const overrideLength = assOverrideTagLength(raw, offset);
      if (!overrideLength) {
        supported = false;
        plain += raw[offset];
        offset += 1;
      } else {
        offset += overrideLength;
        continue;
      }
    }

    if (
      raw[offset] === "\\" &&
      offset + 1 < raw.length &&
      (raw[offset + 1] === "N" || raw[offset + 1] === "n")
    ) {
      plain += "\n";
      offset += 2;
      continue;
    }

    if (raw[offset] === "\\") supported = false;
    const codePoint = raw.codePointAt(offset);
    const width = codePoint > 0xffff ? 2 : 1;
    plain += raw.slice(offset, offset + width);
    offset += width;
  }

  if (plain !== stripAssTags(raw)) supported = false;
  return displayIndex(plain, supported);
}

function nativeStrippedDisplayIndex(rawText) {
  const raw = String(rawText || "");
  let offset = 0;
  let supported = true;
  while (offset < raw.length) {
    if (raw[offset] !== "{") {
      offset++;
      continue;
    }
    const close = raw.indexOf("}", offset + 1);
    if (close < 0) {
      supported = false;
      break;
    }
    offset = close + 1;
  }
  const plain = stripAssTags(raw);
  if (plain.includes("\\")) supported = false;
  return displayIndex(plain, supported);
}

function nativeRange(index, unit) {
  const range = unit?.utf16Range;
  if (!index || !Array.isArray(range) || range.length !== 2) return null;
  const start = finiteInteger(range[0]);
  const end = finiteInteger(range[1]);
  if (
    start === null ||
    end === null ||
    start < 0 ||
    end <= start ||
    end >= index.plainToLogical.length
  )
    return null;
  const displayStartUtf16 = index.plainToLogical[start];
  const displayEndUtf16 = index.plainToLogical[end];
  if (
    !Number.isInteger(displayStartUtf16) ||
    !Number.isInteger(displayEndUtf16) ||
    displayEndUtf16 <= displayStartUtf16
  )
    return null;
  return { displayStartUtf16, displayEndUtf16 };
}

function requestIdFor(snapshotInput, track, serial) {
  const value = `native-${snapshotInput.sessionId}-${snapshotInput.mediaGeneration}-${snapshotInput.geometryGeneration}-${track.id}-${serial}`;
  return value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160);
}

function trackCue(track, snapshotInput) {
  const events = track.events || [];
  const eventStarts = events
    .map((event) => Number(event.startMs))
    .filter(Number.isFinite);
  const eventEnds = events.map((event) => Number(event.endMs)).filter(Number.isFinite);
  const hasTrackStart =
    track.startMs !== null && Number.isFinite(Number(track.startMs));
  const hasTrackEnd = track.endMs !== null && Number.isFinite(Number(track.endMs));
  const start = hasTrackStart ? Number(track.startMs) : Math.min(...eventStarts);
  const end = hasTrackEnd ? Number(track.endMs) : Math.max(...eventEnds);
  const time = Number(snapshotInput.timeMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    timeMs: Number.isFinite(time) ? Math.max(0, Math.round(time)) : start,
    startMs: Math.round(start),
    endMs: Math.round(end),
  };
}

function sourceForTrack(track) {
  const source = track.source;
  if (!source || typeof source !== "object" || !String(source.path || "")) return null;
  const ffIndex = finiteInteger(source.ffIndex);
  if (ffIndex === null) return null;
  return {
    path: String(source.path),
    ffIndex,
    external: source.external === true,
    autoAssStream: source.autoAssStream === true,
    cacheExcerpt: source.cacheExcerpt === true,
  };
}

function isExternalSubripTrack(track) {
  const source = sourceForTrack(track);
  return (
    source?.external === true &&
    /\.(?:srt|subrip)$/iu.test(source.path.split(/[?#]/u, 1)[0]) &&
    !String(track.assExtradata || "")
  );
}

function isEmbeddedAssTrack(track) {
  const source = sourceForTrack(track);
  return (
    source?.external === false &&
    String(track.assFull || "").trim().length > 0 &&
    String(track.assExtradata || "").trim().length > 0
  );
}

function profileSupportsSnapshot(profile, snapshotInput) {
  const selectedTracks = (snapshotInput.tracks || []).filter(
    (track) => track.selected && track.events?.some((event) => event.units.length),
  );
  if (profile.inputScope === "external-subrip")
    return selectedTracks.length > 0 && selectedTracks.every(isExternalSubripTrack);
  if (profile.inputScope === "embedded-ass")
    return selectedTracks.length > 0 && selectedTracks.every(isEmbeddedAssTrack);
  return true;
}

function hasNonEmptyList(value) {
  if (Array.isArray(value))
    return value.some((item) => String(item ?? "").trim().length > 0);
  return String(value ?? "").trim().length > 0;
}

function stringList(value, fallback = []) {
  if (value === undefined || value === null) return [...fallback];
  if (Array.isArray(value)) return value.map((item) => String(item));
  const text = String(value).trim();
  return text ? text.split(",").map((item) => item.trim()) : [];
}

function sameStringList(left, right) {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function unsupportedRendererOptions(renderer) {
  const unsupported = [];
  if (!renderer.assEnabled) unsupported.push("sub-ass");
  if (renderer.assScaleWithWindow) unsupported.push("sub-ass-scale-with-window");
  if (renderer.assJustify) unsupported.push("sub-ass-justify");
  if (renderer.justify !== "auto") unsupported.push("sub-justify");
  if (renderer.fontProvider !== "auto" && renderer.fontProvider !== "autodetect")
    unsupported.push("sub-font-provider");
  if (hasNonEmptyList(renderer.styleOverrides))
    unsupported.push("sub-ass-style-overrides");
  if (renderer.stylesPath) unsupported.push("sub-ass-styles");
  if (renderer.fontsDirectory) unsupported.push("sub-fonts-dir");
  if (renderer.useVideoData !== "all") unsupported.push("sub-ass-use-video-data");
  if (renderer.videoAspectOverride !== 0)
    unsupported.push("sub-ass-video-aspect-override");
  if (renderer.vsfilterColorCompat !== "basic")
    unsupported.push("sub-ass-vsfilter-color-compat");
  if (renderer.vsfilterBidiCompat) unsupported.push("sub-vsfilter-bidi-compat");
  if (renderer.scaleSigns) unsupported.push("sub-scale-signs");
  if (renderer.blur !== 0) unsupported.push("sub-blur");
  if (renderer.gauss !== 0) unsupported.push("sub-gauss");
  if (renderer.gray) unsupported.push("sub-gray");
  if (renderer.glyphLimit !== 0) unsupported.push("sub-glyph-limit");
  if (renderer.hdrPeak !== "sdr") unsupported.push("sub-hdr-peak");
  if (renderer.pruneDelay !== -1) unsupported.push("sub-ass-prune-delay");
  if (renderer.fixTiming) unsupported.push("sub-fix-timing");
  if (renderer.fixTimingThreshold !== 210) unsupported.push("sub-fix-timing-threshold");
  if (renderer.fixTimingKeep !== 400) unsupported.push("sub-fix-timing-keep");
  if (renderer.fps !== 0) unsupported.push("sub-fps");
  if (renderer.stretchDurations) unsupported.push("sub-stretch-durations");
  if (renderer.clearOnSeek) unsupported.push("sub-clear-on-seek");
  if (renderer.pastVideoEnd) unsupported.push("sub-past-video-end");
  if (renderer.forcedEventsOnly) unsupported.push("sub-forced-events-only");
  if (!renderer.filterRegexEnable) unsupported.push("sub-filter-regex-enable");
  if (renderer.filterRegexPlain) unsupported.push("sub-filter-regex-plain");
  if (hasNonEmptyList(renderer.filterRegex)) unsupported.push("sub-filter-regex");
  if (hasNonEmptyList(renderer.filterJsre)) unsupported.push("sub-filter-jsre");
  if (renderer.filterSdh) unsupported.push("sub-filter-sdh");
  if (!sameStringList(renderer.filterSdhEnclosures, DEFAULT_FILTER_SDH_ENCLOSURES))
    unsupported.push("sub-filter-sdh-enclosures");
  if (renderer.filterSdhHarder) unsupported.push("sub-filter-sdh-harder");
  return unsupported;
}

function rendererForTrack(track, snapshotInput) {
  const renderer =
    track.renderer && typeof track.renderer === "object" ? track.renderer : {};
  const normalized = {
    width: Number(snapshotInput.osd.width),
    height: Number(snapshotInput.osd.height),
    storageWidth: Number(renderer.storageWidth || snapshotInput.osd.width),
    storageHeight: Number(renderer.storageHeight || snapshotInput.osd.height),
    marginLeft: Number(renderer.marginLeft || 0),
    marginRight: Number(renderer.marginRight || 0),
    marginTop: Number(renderer.marginTop || 0),
    marginBottom: Number(renderer.marginBottom || 0),
    pixelAspect: Number(renderer.pixelAspect || 1),
    fontScale: Number(renderer.fontScale || 1),
    lineSpacing: Number(renderer.lineSpacing || 0),
    forceMargins: renderer.forceMargins === true,
    embeddedFonts: renderer.embeddedFonts !== false,
    useStorageSize: renderer.useStorageSize !== false,
    linePosition: Number(renderer.linePosition ?? 100),
    overrideMode: String(renderer.overrideMode || "yes")
      .trim()
      .toLowerCase(),
    defaultFamily: String(renderer.defaultFamily || "sans-serif"),
    fontProvider: String(renderer.fontProvider || "auto"),
    primaryColor: String(renderer.primaryColor || "#FFFFFFFF").toUpperCase(),
    borderColor: String(renderer.borderColor || "#FF000000").toUpperCase(),
    shadowColor: String(renderer.shadowColor || "#AF000000").toUpperCase(),
    borderStyle: String(renderer.borderStyle || "outline-and-shadow")
      .trim()
      .toLowerCase(),
    scaleWithWindow: renderer.scaleWithWindow !== false,
    scaleByWindow: renderer.scaleByWindow !== false,
    assScaleWithWindow: renderer.assScaleWithWindow === true,
    assEnabled: renderer.assEnabled !== false,
    assJustify: renderer.assJustify === true,
    justify: String(renderer.justify || "auto")
      .trim()
      .toLowerCase(),
    styleOverrides: renderer.styleOverrides ?? [],
    stylesPath: String(renderer.stylesPath || ""),
    fontsDirectory: String(renderer.fontsDirectory || ""),
    useVideoData: String(renderer.useVideoData || "all")
      .trim()
      .toLowerCase(),
    videoAspectOverride: Number(renderer.videoAspectOverride || 0),
    vsfilterColorCompat: String(renderer.vsfilterColorCompat || "basic")
      .trim()
      .toLowerCase(),
    vsfilterBidiCompat: renderer.vsfilterBidiCompat === true,
    scaleSigns: renderer.scaleSigns === true,
    blur: Number(renderer.blur || 0),
    gauss: Number(renderer.gauss || 0),
    gray: renderer.gray === true,
    glyphLimit: Number(renderer.glyphLimit || 0),
    hdrPeak: String(renderer.hdrPeak || "sdr")
      .trim()
      .toLowerCase(),
    pruneDelay: Number(renderer.pruneDelay ?? -1),
    fixTiming: renderer.fixTiming === true,
    fixTimingThreshold: Number(renderer.fixTimingThreshold ?? 210),
    fixTimingKeep: Number(renderer.fixTimingKeep ?? 400),
    fps: Number(renderer.fps || 0),
    stretchDurations: renderer.stretchDurations === true,
    clearOnSeek: renderer.clearOnSeek === true,
    pastVideoEnd: renderer.pastVideoEnd === true,
    forcedEventsOnly: renderer.forcedEventsOnly === true,
    filterRegexEnable: renderer.filterRegexEnable !== false,
    filterRegexPlain: renderer.filterRegexPlain === true,
    filterRegex: stringList(renderer.filterRegex),
    filterJsre: stringList(renderer.filterJsre),
    filterSdh: renderer.filterSdh === true,
    filterSdhEnclosures: stringList(
      renderer.filterSdhEnclosures,
      DEFAULT_FILTER_SDH_ENCLOSURES,
    ),
    filterSdhHarder: renderer.filterSdhHarder === true,
    hinting: String(renderer.hinting || "none"),
    shaper: String(renderer.shaper || "complex"),
    fontSize: Number(renderer.fontSize || 38),
    outlineSize: Number(renderer.outlineSize ?? 1.65),
    shadowOffset: Number(renderer.shadowOffset ?? 0),
    marginX: Number(renderer.marginX ?? 19),
    marginY: Number(renderer.marginY ?? 34),
    alignX: String(renderer.alignX || "center")
      .trim()
      .toLowerCase(),
    alignY: String(renderer.alignY || "bottom")
      .trim()
      .toLowerCase(),
    useMargins: renderer.useMargins !== false,
    bold: renderer.bold === true,
    italic: renderer.italic === true,
    spacing: Number(renderer.spacing || 0),
  };
  return {
    ...normalized,
    unsupportedOptions: unsupportedRendererOptions(normalized),
  };
}

function assTimestamp(milliseconds) {
  const centiseconds = Math.max(0, Math.round(Number(milliseconds) / 10));
  const seconds = Math.floor(centiseconds / 100);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function assField(value, fallback) {
  const text = String(value ?? fallback);
  return /^[^,\r\n]+$/.test(text) ? text : null;
}

function strippedAssText(rawText) {
  const text = stripAssTags(rawText).replace(/\r/g, "");
  if (text.includes("\\")) return null;
  return text.replace(/\n/g, "\\N");
}

function assColor(value) {
  // mpv reports colors as #AARRGGBB; ASS stores the inverted alpha followed
  // by BGR in its textual &H... representation.
  const match = String(value || "").match(/^#([0-9A-F]{8})$/i);
  if (!match) return null;
  const [alpha, red, green, blue] = [
    (255 - parseInt(match[1].slice(0, 2), 16)).toString(16).padStart(2, "0"),
    match[1].slice(2, 4),
    match[1].slice(4, 6),
    match[1].slice(6, 8),
  ];
  return `&H${alpha}${blue}${green}${red}`.toUpperCase();
}

function assNumber(value) {
  return String(Number(Number(value).toFixed(6)));
}

function assAlignment(renderer) {
  const horizontal = { left: 1, center: 2, right: 3 }[renderer.alignX];
  const vertical = { bottom: 0, center: 1, top: 2 }[renderer.alignY];
  return horizontal && vertical !== undefined ? horizontal + vertical * 3 : null;
}

function subripObservation(source, track, cue, renderer) {
  // The native helper intentionally accepts only ASS/SSA codec-private data.
  // mpv's text-subtitle decoder already exposes the converted event text, so
  // mirror its bounded default style here instead of reading the SRT file in
  // a second renderer. The real subtitle remains rendered by stock mpv.
  if (
    !source.external ||
    !/\.(?:srt|subrip)$/i.test(source.path.split(/[?#]/, 1)[0]) ||
    String(track.assExtradata || "")
  )
    return null;
  if (renderer.fontProvider !== "auto" && renderer.fontProvider !== "autodetect")
    return null;
  if (renderer.borderStyle !== "outline-and-shadow") return null;
  if ((track.events || []).some((event) => /[{}]/u.test(String(event.rawText || ""))))
    return null;

  const font = assField(renderer.defaultFamily, "sans-serif");
  const colors = [
    assColor(renderer.primaryColor),
    assColor(renderer.borderColor),
    assColor(renderer.shadowColor),
  ];
  const alignment = assAlignment(renderer);
  const numericValues = [
    renderer.width,
    renderer.height,
    renderer.storageWidth,
    renderer.storageHeight,
    renderer.pixelAspect,
    renderer.fontScale,
    renderer.lineSpacing,
    renderer.fontSize,
    renderer.outlineSize,
    renderer.shadowOffset,
    renderer.marginX,
    renderer.marginY,
    renderer.spacing,
    renderer.marginLeft,
    renderer.marginRight,
    renderer.marginTop,
    renderer.marginBottom,
  ];
  if (
    !font ||
    !alignment ||
    colors.some((color) => !color) ||
    numericValues.some((value) => !Number.isFinite(value)) ||
    renderer.width <= 0 ||
    renderer.height <= 0 ||
    renderer.storageWidth <= 0 ||
    renderer.storageHeight <= 0 ||
    renderer.pixelAspect <= 0 ||
    renderer.fontScale <= 0 ||
    renderer.fontSize <= 0 ||
    renderer.outlineSize < 0 ||
    renderer.shadowOffset < 0 ||
    renderer.marginX < 0 ||
    renderer.marginY < 0
  )
    return null;

  const videoWidth = renderer.width - renderer.marginLeft - renderer.marginRight;
  const videoHeight = renderer.height - renderer.marginTop - renderer.marginBottom;
  if (videoWidth <= 0 || videoHeight <= 0) return null;
  const playResX = Math.trunc(
    (SUBRIP_PLAY_RES_Y * videoWidth) / Math.max(videoHeight, 1),
  );
  if (playResX <= 0) return null;

  let fontScale = renderer.fontScale;
  if (renderer.scaleWithWindow) {
    const scaleHeight = renderer.useMargins
      ? Math.min(renderer.height, (renderer.width / videoWidth) * videoHeight)
      : videoHeight;
    fontScale *= renderer.height / Math.max(scaleHeight, 1);
  }
  if (!renderer.scaleByWindow) {
    const windowScale = renderer.height / 720;
    if (windowScale !== 0) fontScale /= windowScale;
  }
  if (!Number.isFinite(fontScale) || fontScale <= 0) return null;

  const styleScale = SUBRIP_PLAY_RES_Y / 720;
  const marginScale = playResX / 384;
  const marginX = Math.trunc(renderer.marginX * styleScale);
  const marginY = Math.trunc(renderer.marginY * styleScale);
  const style = [
    "Default",
    font,
    assNumber(renderer.fontSize * styleScale),
    colors[0],
    colors[0],
    colors[1],
    colors[2],
    renderer.bold ? -1 : 0,
    renderer.italic ? -1 : 0,
    0,
    0,
    100,
    100,
    assNumber(renderer.spacing * styleScale),
    0,
    1,
    assNumber(renderer.outlineSize * styleScale),
    assNumber(renderer.shadowOffset * styleScale),
    alignment,
    Math.round(marginX * marginScale),
    Math.round(marginX * marginScale),
    Math.round(marginY * fontScale),
    1,
  ].join(",");
  const extradata = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${SUBRIP_PLAY_RES_Y}`,
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: None",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${style}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const lines = [];
  const observedTexts = [];
  for (const [index, event] of (track.events || []).entries()) {
    const text = strippedAssText(event.rawText);
    const start = Number.isFinite(Number(event.startMs))
      ? Number(event.startMs)
      : cue.startMs;
    const end = Number.isFinite(Number(event.endMs)) ? Number(event.endMs) : cue.endMs;
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return null;
    observedTexts.push(text);
    lines.push(
      `Dialogue: ${Number.isInteger(event.layer) ? event.layer : index},${assTimestamp(start)},${assTimestamp(end)},Default,,0,0,0,,${text}`,
    );
  }
  if (!lines.length) return null;
  return {
    source: {
      path: OBSERVED_SUBRIP_SOURCE,
      ffIndex: 0,
      external: true,
      autoAssStream: false,
      cacheExcerpt: false,
    },
    cue: {
      observedAss: observedTexts.join("\n"),
      observedFormat: "ass",
      assFull: lines.join("\n"),
      assExtradata: extradata,
    },
    renderer: {
      ...renderer,
      fontScale,
      forceMargins: renderer.useMargins,
      useStorageSize: false,
    },
  };
}

function secondaryStripObservation(track, cue, renderer) {
  if (
    track.role !== "secondary" ||
    renderer.linePosition !== 100 ||
    renderer.alignX !== "center"
  )
    return null;
  if (
    renderer.defaultFamily !== DEFAULT_STRIP_RENDERER.fontFamily ||
    renderer.fontSize !== DEFAULT_STRIP_RENDERER.fontSize ||
    renderer.outlineSize !== DEFAULT_STRIP_RENDERER.outlineSize ||
    renderer.shadowOffset !== DEFAULT_STRIP_RENDERER.shadowOffset ||
    renderer.marginX !== DEFAULT_STRIP_RENDERER.marginX ||
    renderer.marginY !== DEFAULT_STRIP_RENDERER.marginY ||
    renderer.alignY !== DEFAULT_STRIP_RENDERER.alignY ||
    renderer.useMargins !== DEFAULT_STRIP_RENDERER.useMargins ||
    renderer.bold !== DEFAULT_STRIP_RENDERER.bold ||
    renderer.italic !== DEFAULT_STRIP_RENDERER.italic ||
    renderer.spacing !== DEFAULT_STRIP_RENDERER.spacing ||
    renderer.fontScale !== DEFAULT_STRIP_RENDERER.fontScale ||
    renderer.lineSpacing !== DEFAULT_STRIP_RENDERER.lineSpacing ||
    renderer.pixelAspect !== DEFAULT_STRIP_RENDERER.pixelAspect ||
    renderer.fontProvider !== DEFAULT_STRIP_RENDERER.fontProvider ||
    renderer.assJustify !== DEFAULT_STRIP_RENDERER.assJustify ||
    renderer.hinting !== DEFAULT_STRIP_RENDERER.hinting ||
    renderer.shaper !== DEFAULT_STRIP_RENDERER.shaper ||
    renderer.primaryColor !== DEFAULT_STRIP_RENDERER.primaryColor ||
    renderer.borderColor !== DEFAULT_STRIP_RENDERER.borderColor ||
    renderer.shadowColor !== DEFAULT_STRIP_RENDERER.shadowColor
  )
    return null;
  if (
    /\[(?:Fonts|Graphics)\]|^\s*(?:fontname|filename):/im.test(track.assExtradata || "")
  )
    return null;
  const font = assField(renderer.defaultFamily, "sans-serif");
  if (
    !font ||
    !Number.isInteger(renderer.storageWidth) ||
    !Number.isInteger(renderer.storageHeight) ||
    renderer.storageWidth <= 0 ||
    renderer.storageHeight <= 0 ||
    !Number.isFinite(renderer.fontSize) ||
    renderer.fontSize <= 0
  )
    return null;
  if (
    !Number.isFinite(renderer.outlineSize) ||
    renderer.outlineSize < 0 ||
    !Number.isFinite(renderer.shadowOffset) ||
    renderer.shadowOffset < 0 ||
    !Number.isFinite(renderer.spacing) ||
    !Number.isFinite(renderer.marginX) ||
    renderer.marginX < 0
  )
    return null;
  const style = [
    OBSERVED_STRIP_STYLE,
    font,
    renderer.fontSize,
    "&H00FFFFFF",
    "&H00FFFFFF",
    "&H00000000",
    "&HAF000000",
    renderer.bold ? -1 : 0,
    renderer.italic ? -1 : 0,
    0,
    0,
    100,
    100,
    renderer.spacing,
    0,
    1,
    renderer.outlineSize,
    renderer.shadowOffset,
    8,
    renderer.useMargins ? renderer.marginX : 0,
    renderer.useMargins ? renderer.marginX : 0,
    0,
    1,
  ].join(",");
  const extradata = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${renderer.storageWidth}`,
    `PlayResY: ${renderer.storageHeight}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${style}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
  const lines = [];
  const observedTexts = [];
  for (const [index, event] of (track.events || []).entries()) {
    const text = strippedAssText(event.rawText);
    if (!text) return null;
    const start = Number.isFinite(Number(event.startMs)) ? event.startMs : cue.startMs;
    const end = Number.isFinite(Number(event.endMs)) ? event.endMs : cue.endMs;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    observedTexts.push(text);
    lines.push(
      `Dialogue: ${Number.isInteger(event.layer) ? event.layer : index},${assTimestamp(start)},${assTimestamp(end)},${OBSERVED_STRIP_STYLE},,0,0,0,,${text}`,
    );
  }
  if (!lines.length) return null;
  return {
    source: {
      path: OBSERVED_STRIP_SOURCE,
      ffIndex: 0,
      external: false,
      autoAssStream: false,
      cacheExcerpt: false,
    },
    cue: {
      observedAss: observedTexts.join("\n"),
      observedFormat: "ass",
      assFull: lines.join("\n"),
      assExtradata: extradata,
    },
    renderer: { ...renderer, overrideMode: "no" },
  };
}

function trackRequest(snapshotInput, track, serial) {
  const source = sourceForTrack(track);
  const cue = trackCue(track, snapshotInput);
  if (!source || !cue) return null;
  const events = track.events || [];
  if (events.some((event) => event.drawing)) return null;
  const renderer = rendererForTrack(track, snapshotInput);
  if (renderer.unsupportedOptions.length) return null;
  if (
    !NATIVE_OVERRIDE_MODES.has(renderer.overrideMode) &&
    renderer.overrideMode !== "strip"
  )
    return null;
  const stripObservation =
    renderer.overrideMode === "strip"
      ? secondaryStripObservation(track, cue, renderer)
      : null;
  if (renderer.overrideMode === "strip" && !stripObservation) return null;
  const eventIndexes = events.map((event) =>
    stripObservation
      ? nativeStrippedDisplayIndex(event.rawText)
      : nativeDisplayIndex(event.rawText),
  );
  if (eventIndexes.some((index) => !index.supported)) return null;

  let displayOffset = 0;
  const units = [];
  let invalidUnit = false;
  events.forEach((event, eventIndex) => {
    const index = eventIndexes[eventIndex];
    for (const unit of event.units || []) {
      if (unit.lookupable === false) continue;
      const range = nativeRange(index, unit);
      if (!range) {
        invalidUnit = true;
        return;
      }
      units.push({
        position: unit.position,
        displayStartUtf16: displayOffset + range.displayStartUtf16,
        displayEndUtf16: displayOffset + range.displayEndUtf16,
      });
    }
    displayOffset += index.logicalLength;
    if (eventIndex + 1 < events.length) displayOffset += 1;
  });
  if (invalidUnit || !units.length) return null;
  const subrip = stripObservation
    ? null
    : subripObservation(source, track, cue, renderer);
  if (
    !stripObservation &&
    !subrip &&
    !track.assFull &&
    source.external &&
    /\.(?:srt|subrip)$/iu.test(source.path.split(/[?#]/u, 1)[0])
  )
    return null;
  const requestCue = stripObservation
    ? { ...cue, ...stripObservation.cue }
    : subrip
      ? { ...cue, ...subrip.cue }
      : {
          ...cue,
          observedAss: events.map((event) => event.rawText).join("\n"),
          observedFormat: "ass",
          ...(track.assFull
            ? {
                assFull: String(track.assFull),
                assExtradata: String(track.assExtradata || ""),
              }
            : {}),
        };

  const requestRenderer = stripObservation?.renderer || subrip?.renderer || renderer;
  const {
    unsupportedOptions: _unsupportedOptions,
    assEnabled: _assEnabled,
    assScaleWithWindow: _assScaleWithWindow,
    justify: _justify,
    fixTimingThreshold: _fixTimingThreshold,
    fixTimingKeep: _fixTimingKeep,
    fps: _fps,
    stretchDurations: _stretchDurations,
    clearOnSeek: _clearOnSeek,
    pastVideoEnd: _pastVideoEnd,
    filterRegex: _filterRegex,
    filterJsre: _filterJsre,
    filterSdhEnclosures: _filterSdhEnclosures,
    ...nativeRenderer
  } = requestRenderer;

  return {
    requestId: requestIdFor(snapshotInput, track, serial),
    source: stripObservation?.source || subrip?.source || source,
    cue: requestCue,
    units,
    renderer: nativeRenderer,
  };
}

class NativeSubtitleGeometryService {
  constructor(options = {}) {
    const profiles = Array.isArray(options.profiles) ? options.profiles : [];
    if (
      (!options.client || typeof options.client.measure !== "function") &&
      !profiles.length
    )
      throw new TypeError("native geometry client is required");
    if (
      profiles.some(
        (profile) => !profile?.client || typeof profile.client.measure !== "function",
      )
    )
      throw new TypeError("native geometry profile client is required");
    this.client = options.client || profiles[0].client;
    this.geometryProvider = options.geometryProvider || new SubtitleGeometryProvider();
    this.playerCompatibility = options.playerCompatibility
      ? Object.freeze({ ...options.playerCompatibility })
      : null;
    this.profiles = Object.freeze(
      profiles.length
        ? profiles.map((profile) =>
            Object.freeze({
              id: String(profile.id || "native-geometry"),
              client: profile.client,
              playerCompatibility: Object.freeze({
                ...(profile.playerCompatibility || {}),
              }),
              inputScope: profile.inputScope || "all-supported",
            }),
          )
        : [
            Object.freeze({
              id: "native-geometry",
              client: this.client,
              playerCompatibility: this.playerCompatibility || {},
              inputScope: "all-supported",
            }),
          ],
    );
    this.serial = 0;
  }

  #compatibilityMismatches(snapshotInput, profile) {
    const player = snapshotInput.player;
    return Object.entries(profile.playerCompatibility)
      .filter(
        ([, expected]) =>
          expected !== null && expected !== undefined && expected !== "",
      )
      .filter(([name, expected]) => String(player?.[name] || "") !== String(expected))
      .map(([name, expected]) => ({
        name,
        expected: String(expected),
        observed: String(player?.[name] || "unobserved"),
      }));
  }

  #selectProfile(snapshotInput) {
    const player = snapshotInput.player;
    const playerMatches = [];
    for (const profile of this.profiles) {
      const mismatches = this.#compatibilityMismatches(snapshotInput, profile);
      if (!mismatches.length) {
        playerMatches.push(profile);
        if (profileSupportsSnapshot(profile, snapshotInput)) return profile;
      }
    }
    if (playerMatches.length) {
      const error = new Error(
        "native subtitle geometry input is outside the validated helper profile",
      );
      error.code = "NATIVE_GEOMETRY_PROFILE_INPUT_UNSUPPORTED";
      error.expected = playerMatches.map((profile) => ({
        id: profile.id,
        inputScope: profile.inputScope,
        playerCompatibility: { ...profile.playerCompatibility },
      }));
      error.observed = snapshotInput.player ? { ...snapshotInput.player } : null;
      throw error;
    }
    const fallback = this.profiles[0];
    const mismatches = this.#compatibilityMismatches(snapshotInput, fallback);
    const error = new Error(
      "native subtitle geometry requires the validated stock-mpv renderer tuple",
    );
    error.code = "NATIVE_GEOMETRY_PLAYER_INCOMPATIBLE";
    error.expected = this.profiles.map((profile) => ({
      id: profile.id,
      playerCompatibility: { ...profile.playerCompatibility },
    }));
    error.observed = player ? { ...player } : null;
    error.mismatches = mismatches;
    throw error;
  }

  async apply(snapshotInput) {
    if (!snapshotInput || !Array.isArray(snapshotInput.tracks))
      throw new TypeError("subtitle geometry snapshot input is required");
    const requests = [];
    for (const track of snapshotInput.tracks) {
      if (!track.selected || !track.events.some((event) => event.units.length))
        continue;
      const request = trackRequest(snapshotInput, track, ++this.serial);
      if (!request) {
        const error = new Error(`native geometry input is unsupported for ${track.id}`);
        error.code = "NATIVE_GEOMETRY_INPUT_UNSUPPORTED";
        throw error;
      }
      requests.push(request);
    }
    if (!requests.length) return null;
    const profile = this.#selectProfile(snapshotInput);

    const responses = [];
    for (const request of requests)
      responses.push(await profile.client.measure(request));
    const combined = {
      ok: true,
      protocol: 1,
      rendererWidth: snapshotInput.osd.width,
      rendererHeight: snapshotInput.osd.height,
      units: responses.flatMap((response) => response.units || []),
      diagnostics: {
        profile: profile.id,
        validationEnabled: responses.every(
          (response) => response.diagnostics?.validationEnabled === true,
        ),
        tracks: responses.map((response) => response.diagnostics || null),
      },
    };
    if (!this.geometryProvider?.applyNativeResponse)
      throw new TypeError("native geometry provider is required");
    const result = this.geometryProvider.applyNativeResponse(snapshotInput, combined);
    if (!result) {
      const error = new Error("native geometry response failed validation");
      error.code = "NATIVE_GEOMETRY_RESPONSE_INVALID";
      throw error;
    }
    return result;
  }
}

module.exports = {
  NativeSubtitleGeometryService,
  VALIDATED_PLAYER_CAPABILITY,
  WINDOWS_LIBASS_0174_EMBEDDED_ASS_PROFILE,
  WINDOWS_LIBASS_0174_SUBRIP_PROFILE,
  isExternalSubripTrack,
  nativeDisplayIndex,
  nativeStrippedDisplayIndex,
  nativeRange,
  rendererForTrack,
  secondaryStripObservation,
  subripObservation,
  sourceForTrack,
  trackRequest,
};
