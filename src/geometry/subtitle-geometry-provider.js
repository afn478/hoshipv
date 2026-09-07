"use strict";

const { createTextIndex } = require("./unicode-index");
const { buildPlainSubtitleGeometry, stripAssTags } = require("./plain-subtitle");

function parseAssTime(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{1,2}):(\d{1,2})[.](\d{1,2})$/);
  if (!match) return null;
  return (
    (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 +
    Number(match[4]) * 10
  );
}

function splitAssDialogue(line) {
  const raw = String(line || "");
  if (!/^\s*Dialogue\s*:/i.test(raw)) return null;
  const body = raw.replace(/^\s*Dialogue\s*:/i, "");
  const fields = body.split(",");
  if (fields.length < 10) return null;
  const text = fields.slice(9).join(",");
  return {
    layer: Number(fields[0]) || 0,
    startMs: parseAssTime(fields[1]),
    endMs: parseAssTime(fields[2]),
    style: fields[3] || "Default",
    text,
    rawText: text,
  };
}

function eventId(trackId, event, index) {
  return `${trackId}:event:${index}:${event.startMs ?? "na"}:${event.endMs ?? "na"}`;
}

function sourceEvents(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const events = lines.map(splitAssDialogue).filter(Boolean);
  if (events.length) return events;
  const rawText = String(raw || "");
  const text = stripAssTags(rawText);
  return text
    ? [
        {
          layer: 0,
          startMs: null,
          endMs: null,
          style: "Plain",
          text,
          rawText,
        },
      ]
    : [];
}

function isDrawingEvent(text) {
  return /\{[^}]*\\p[1-9]\d*[^}]*\}/i.test(String(text || ""));
}

function contentBoundsAreAuthoritative(windowGeometry) {
  if (windowGeometry?.contentExact !== undefined)
    return windowGeometry.contentExact === true;
  if (windowGeometry?.capability?.exactContent !== undefined)
    return windowGeometry.capability.exactContent === true;
  return true;
}

function makeEventGeometry(trackId, role, event, index, input, positionOffset = 0) {
  const text = stripAssTags(event.text);
  const approximation = buildPlainSubtitleGeometry({
    text,
    osdWidth: input.osd.width,
    osdHeight: input.osd.height,
    fontSize: input.fontSize,
    charWidth: input.charWidth,
    lineHeight: input.lineHeight,
    marginX: input.marginX,
    marginY: input.marginY,
    align: input.align,
    position: role === "secondary" ? "top" : "bottom",
    eventId: eventId(trackId, event, index),
  });
  const drawing = isDrawingEvent(event.rawText || event.text);
  return {
    id: eventId(trackId, event, index),
    sourceText: text,
    rawText: event.rawText || event.text,
    startMs: event.startMs,
    endMs: event.endMs,
    layer: event.layer,
    drawing,
    units: drawing
      ? []
      : approximation.units.map((unit) => ({
          ...unit,
          position: positionOffset + unit.position,
        })),
  };
}

class SubtitleGeometryProvider {
  constructor(options = {}) {
    this.options = {
      fontSize: 48,
      charWidth: 26,
      lineHeight: 58,
      marginX: 24,
      marginY: 32,
      align: "center",
      ...options,
    };
  }

  snapshotInput(bridgeInput, windowGeometry, options = {}) {
    const input = bridgeInput || {};
    const content = windowGeometry && windowGeometry.content;
    if (!content) throw new Error("window content geometry is required");
    const primary = input.primary || {};
    const secondary = input.secondary || {};
    const osd = input.osd || {};
    const layout = { ...this.options, ...(options.layout || {}) };
    const contentExact = contentBoundsAreAuthoritative(windowGeometry);
    let positionOffset = 0;
    const makeTrack = (id, role, raw) => {
      const events = sourceEvents(raw.assFull).map((event, index) => {
        const geometry = makeEventGeometry(
          id,
          role,
          event,
          index,
          { osd, ...layout },
          positionOffset,
        );
        positionOffset += geometry.units.length;
        return geometry;
      });
      return {
        id,
        role,
        selected: raw.selected !== false,
        source: raw.source || null,
        assFull: String(raw.assFull || ""),
        assExtradata: String(raw.extradata || ""),
        startMs: Number.isFinite(Number(raw.startMs)) ? Number(raw.startMs) : null,
        endMs: Number.isFinite(Number(raw.endMs)) ? Number(raw.endMs) : null,
        renderer: raw.renderer ? { ...raw.renderer } : null,
        events,
      };
    };
    const tracks = [
      makeTrack("primary", "primary", primary),
      makeTrack("secondary", "secondary", secondary),
    ].filter((track) => track.events.length);
    return {
      sessionId: input.sessionId,
      mediaGeneration: input.mediaGeneration,
      geometryGeneration: input.geometryGeneration,
      timeMs: input.timeMs,
      content,
      osd: { width: osd.width, height: osd.height },
      desktopScale: Number(windowGeometry.desktopScale || 1),
      browserScale: Number(windowGeometry.browserScale || 1),
      source: {
        mode: "plain-text-approximation",
        exact: false,
        contentExact,
        contentSource: String(windowGeometry.contentSource || "unknown"),
        reason:
          "stock mpv does not expose per-grapheme libass layout; native geometry provider has not supplied an oracle",
        foreground:
          windowGeometry.isForeground === false
            ? false
            : windowGeometry.isForeground === true
              ? true
              : null,
        ...(typeof windowGeometry.fullscreenObserved === "boolean"
          ? {
              fullscreenObserved: windowGeometry.fullscreenObserved,
              fullscreenEvidence: String(
                windowGeometry.fullscreenEvidence || "unknown",
              ),
            }
          : {}),
      },
      tracks,
    };
  }

  applyNativeResponse(snapshotInput, response) {
    if (
      !response ||
      response.ok !== true ||
      response.protocol !== 1 ||
      !Array.isArray(response.units)
    )
      return null;
    const expectedUnits = snapshotInput.tracks.flatMap((track) =>
      track.events.flatMap((event) => event.units),
    );
    const requiredUnits = expectedUnits.filter((unit) => unit.lookupable !== false);
    if (
      response.rendererWidth !== undefined &&
      Number(response.rendererWidth) !== Number(snapshotInput.osd.width)
    )
      return null;
    if (
      response.rendererHeight !== undefined &&
      Number(response.rendererHeight) !== Number(snapshotInput.osd.height)
    )
      return null;
    if (response.units.length !== requiredUnits.length) return null;
    const byPosition = new Map();
    for (const unit of response.units) {
      const position = Number(unit?.position);
      if (
        !Number.isInteger(position) ||
        byPosition.has(position) ||
        !Array.isArray(unit?.rects) ||
        unit.rects.length === 0
      )
        return null;
      const rects = unit.rects.map((value) => ({
        x: Number(value?.x),
        y: Number(value?.y),
        width: Number(value?.w ?? value?.width),
        height: Number(value?.h ?? value?.height),
      }));
      if (
        rects.some(
          (value) =>
            ![value.x, value.y, value.width, value.height].every(Number.isFinite) ||
            value.x < 0 ||
            value.y < 0 ||
            value.width <= 0 ||
            value.height <= 0 ||
            value.x + value.width > snapshotInput.osd.width ||
            value.y + value.height > snapshotInput.osd.height,
        )
      )
        return null;
      byPosition.set(position, rects);
    }
    if (
      response.units.some(
        (unit) =>
          !requiredUnits.some(
            (expected) => expected.position === Number(unit.position),
          ),
      )
    )
      return null;
    if (requiredUnits.some((unit) => !byPosition.has(unit.position))) return null;
    const tracks = snapshotInput.tracks.map((track) => ({
      ...track,
      events: track.events.map((event) => ({
        ...event,
        units: event.units.map((unit) => {
          const rects = byPosition.get(unit.position);
          return {
            ...unit,
            rects: rects || unit.rects,
            lookupable: unit.lookupable !== false,
          };
        }),
      })),
    }));
    const instrumentationValidated = response.diagnostics?.validationEnabled === true;
    const contentExact = snapshotInput.source?.contentExact === true;
    return {
      ...snapshotInput,
      source: {
        mode: "native-libass-instrumented",
        exact: instrumentationValidated && contentExact,
        instrumentationValidated,
        contentExact,
        contentSource: snapshotInput.source?.contentSource || "unknown",
        foreground: snapshotInput.source?.foreground ?? null,
        ...(instrumentationValidated && !contentExact
          ? {
              reason:
                "native subtitle geometry was validated, but player content bounds are not authoritative",
            }
          : {}),
        diagnostics: response.diagnostics || null,
      },
      tracks,
    };
  }
}

module.exports = {
  SubtitleGeometryProvider,
  parseAssTime,
  sourceEvents,
  splitAssDialogue,
};
