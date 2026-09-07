"use strict";

const { buildPlainSubtitleGeometry, stripAssTags } = require("./plain-subtitle");
const { segmentText } = require("./unicode-index");

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

function bitmapRectKey(rects) {
  return rects
    .map((rect) =>
      [rect.x, rect.y, rect.width, rect.height]
        .map((value) => Number(value).toFixed(4))
        .join(","),
    )
    .join(";");
}

function distributeBitmapWordRects(units) {
  const next = units.map((unit) => ({
    ...unit,
    rects: unit.rects.map((rect) => ({ ...rect })),
  }));
  for (let start = 0; start < next.length;) {
    const key = bitmapRectKey(next[start].rects);
    let end = start + 1;
    while (end < next.length && bitmapRectKey(next[end].rects) === key) end++;
    const group = next.slice(start, end);
    const baseRects = group[0].rects;
    if (group.length > 1 && baseRects.length === 1) {
      const clusterCounts = group.map((unit) =>
        Math.max(1, segmentText(unit.text).length),
      );
      const totalClusters = clusterCounts.reduce((total, count) => total + count, 0);
      let clusterOffset = 0;
      group.forEach((unit, index) => {
        const base = baseRects[0];
        const left = base.x + (base.width * clusterOffset) / totalClusters;
        const right =
          base.x +
          (base.width * (clusterOffset + clusterCounts[index])) / totalClusters;
        unit.rects = [
          {
            x: left,
            y: base.y,
            width: Math.max(0.5, right - left),
            height: base.height,
          },
        ];
        clusterOffset += clusterCounts[index];
      });
    }
    start = end;
  }
  return next;
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
      // Some released mpv versions expose the rendered plain subtitle text
      // before (or instead of) sub-text/ass-full. Keep the exact ASS payload
      // intact when present, but retain a conservative event target so the
      // bridge can fail over to approximate geometry rather than dropping the
      // active subtitle entirely.
      const observedText = raw.assFull || raw.plainText;
      const events = sourceEvents(observedText).map((event, index) => {
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
        track: raw.track ? { ...raw.track } : null,
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

  applyBitmapOcrResponse(snapshotInput, response, role, raw = {}, positionOffset = 0) {
    if (
      !snapshotInput ||
      !response ||
      response.ok !== true ||
      response.protocol !== 1 ||
      typeof response.text !== "string" ||
      !response.text ||
      !Array.isArray(response.units) ||
      !response.units.length ||
      Number(response.rendererWidth) !== Number(snapshotInput.osd.width) ||
      Number(response.rendererHeight) !== Number(snapshotInput.osd.height)
    )
      return null;
    const surface = role === "secondary" ? "secondary" : "primary";
    const text = response.text;
    const units = [];
    for (const [unitIndex, value] of response.units.entries()) {
      const start = Number(value?.displayStartUtf16);
      const end = Number(value?.displayEndUtf16);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end <= start ||
        end > text.length ||
        !Array.isArray(value?.rects) ||
        !value.rects.length ||
        value.rects.length > 8
      )
        continue;
      const rects = value.rects
        .map((item) => ({
          x: Number(item?.x),
          y: Number(item?.y),
          width: Number(item?.w ?? item?.width),
          height: Number(item?.h ?? item?.height),
        }))
        .filter(
          (item) =>
            [item.x, item.y, item.width, item.height].every(Number.isFinite) &&
            item.x >= 0 &&
            item.y >= 0 &&
            item.width > 0 &&
            item.height > 0 &&
            item.x + item.width <= Number(snapshotInput.osd.width) + 0.5 &&
            item.y + item.height <= Number(snapshotInput.osd.height) + 0.5,
        );
      if (!rects.length) continue;
      const unitText = text.slice(start, end);
      const utf8Start = Buffer.byteLength(text.slice(0, start), "utf8");
      units.push({
        id: `${surface}:bitmap-ocr:unit:${unitIndex}`,
        position: positionOffset + unitIndex,
        text: unitText,
        sourceText: text,
        utf16Range: [start, end],
        utf8Range: [utf8Start, utf8Start + Buffer.byteLength(unitText, "utf8")],
        rects,
        lookupable: !/^\s*$/.test(unitText),
      });
    }
    if (!units.some((unit) => unit.lookupable)) return null;
    const positionedUnits = distributeBitmapWordRects(units);
    const startMs = Number.isFinite(Number(response.cueStartMs))
      ? Number(response.cueStartMs)
      : Number.isFinite(Number(raw.startMs))
        ? Number(raw.startMs)
        : null;
    const endMs = Number.isFinite(Number(response.cueEndMs))
      ? Number(response.cueEndMs)
      : Number.isFinite(Number(raw.endMs))
        ? Number(raw.endMs)
        : null;
    const track = {
      id: surface,
      role: surface,
      selected: raw.selected !== false,
      track: raw.track ? { ...raw.track } : null,
      source: raw.source || null,
      assFull: "",
      assExtradata: "",
      startMs,
      endMs,
      renderer: raw.renderer ? { ...raw.renderer } : null,
      events: [
        {
          id: `${surface}:bitmap-ocr:${startMs ?? "na"}:${endMs ?? "na"}`,
          sourceText: text,
          rawText: text,
          startMs,
          endMs,
          layer: 0,
          drawing: false,
          units: positionedUnits,
        },
      ],
    };
    const tracks = [
      ...snapshotInput.tracks.filter((value) => value.role !== surface),
      track,
    ].sort((left, right) =>
      left.role === "primary" ? -1 : right.role === "primary" ? 1 : 0,
    );
    return {
      ...snapshotInput,
      source: {
        ...snapshotInput.source,
        mode: "bitmap-ocr",
        exact: false,
        lookupAllowed: true,
        bitmapOcr: true,
        contentExact: snapshotInput.source?.contentExact === true,
        recognitionConfidence: Number(response.confidence) || 0,
        recognitionMode: String(response.mode || ""),
        reason:
          "Apple Vision OCR geometry is approximate and remains separate from exact stock glyph geometry",
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
