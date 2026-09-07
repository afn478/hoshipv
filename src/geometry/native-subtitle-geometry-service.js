"use strict";

const { stripAssTags } = require("./plain-subtitle");
const { SubtitleGeometryProvider } = require("./subtitle-geometry-provider");

const NATIVE_OVERRIDE_MODES = new Set(["no", "yes", "scale"]);
const OBSERVED_STRIP_SOURCE = "iinatan-observed-secondary-ass";
const OBSERVED_STRIP_STYLE = "IinatanSecondaryStrip";
const OBSERVED_SUBRIP_SOURCE = "iinatan-observed-subrip";
const SUBRIP_PLAY_RES_Y = 288;
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
    /^(?:xshad|yshad|fscx|fscy|fsp|bord|shad|frx|fry|frz|fax|fay|blur|fs|fr|be|b)(.+)$/iu.exec(
      token,
    );
  if (scalar && assDecimal(scalar[1])) return true;
  if (/^an[1-9]$/iu.test(token) || /^q[0-3]$/iu.test(token)) return true;
  if (/^fn\S(?:.*\S)?$/iu.test(token)) return true;
  if (/^r(?:[a-z0-9 _-]+)?$/iu.test(token)) return true;
  if (/^(?:k|kf|ko|kt)\d+$/iu.test(token)) return true;
  const clip = /^(?:i?clip)\(([^()]*)\)$/iu.exec(token);
  if (!clip) return false;
  const values = clip[1].split(",");
  return values.length === 4 && values.every(assDecimal);
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

function rendererForTrack(track, snapshotInput) {
  const renderer =
    track.renderer && typeof track.renderer === "object" ? track.renderer : {};
  return {
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
    assJustify: renderer.assJustify === true,
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

  return {
    requestId: requestIdFor(snapshotInput, track, serial),
    source: stripObservation?.source || subrip?.source || source,
    cue: requestCue,
    units,
    renderer: stripObservation?.renderer || subrip?.renderer || renderer,
  };
}

class NativeSubtitleGeometryService {
  constructor(options = {}) {
    if (!options.client || typeof options.client.measure !== "function")
      throw new TypeError("native geometry client is required");
    this.client = options.client;
    this.geometryProvider = options.geometryProvider || new SubtitleGeometryProvider();
    this.serial = 0;
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

    const responses = [];
    for (const request of requests) responses.push(await this.client.measure(request));
    const combined = {
      ok: true,
      protocol: 1,
      rendererWidth: snapshotInput.osd.width,
      rendererHeight: snapshotInput.osd.height,
      units: responses.flatMap((response) => response.units || []),
      diagnostics: {
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
  nativeDisplayIndex,
  nativeStrippedDisplayIndex,
  nativeRange,
  rendererForTrack,
  secondaryStripObservation,
  subripObservation,
  sourceForTrack,
  trackRequest,
};
