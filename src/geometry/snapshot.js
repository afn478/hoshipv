"use strict";

const { CoordinateMapper, rect } = require("./coordinate-mapper");

function cloneAndFreeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach(cloneAndFreeze);
  } else {
    Object.keys(value).forEach((key) => cloneAndFreeze(value[key]));
  }
  return Object.freeze(value);
}

function normalizeRange(value, name) {
  if (!Array.isArray(value) || value.length !== 2)
    throw new TypeError(`${name} must be a two-item range`);
  const start = Number(value[0]);
  const end = Number(value[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start)
    throw new RangeError(`${name} must be an increasing integer range`);
  return [start, end];
}

function normalizeUnit(unit, trackId, eventId, index) {
  if (!unit || typeof unit !== "object")
    throw new TypeError("geometry unit must be an object");
  const id = String(unit.id || `${trackId}:${eventId}:unit:${index}`);
  if (!id || id.length > 200) throw new RangeError("geometry unit id is invalid");
  const rects = (Array.isArray(unit.rects) ? unit.rects : [unit.rect])
    .filter(Boolean)
    .map((item) => rect(item));
  if (!rects.length) throw new RangeError(`geometry unit ${id} has no rectangles`);
  const envelopeRects = (Array.isArray(unit.envelopeRects) ? unit.envelopeRects : [])
    .filter(Boolean)
    .map((item) => rect(item));
  return {
    id,
    trackId,
    eventId,
    text: String(unit.text || ""),
    sourceText: String(unit.sourceText || unit.text || ""),
    utf16Range: normalizeRange(unit.utf16Range || [0, 1], `${id}.utf16Range`),
    utf8Range: normalizeRange(unit.utf8Range || [0, 1], `${id}.utf8Range`),
    rects,
    ...(envelopeRects.length ? { envelopeRects } : {}),
    lookupable: unit.lookupable !== false && !/^\s*$/.test(String(unit.text || "")),
    clipped: !!unit.clipped,
    visualOrder: Number.isInteger(unit.visualOrder) ? unit.visualOrder : index,
    position: Number.isInteger(unit.position) ? unit.position : index,
  };
}

function normalizeTrack(track, trackIndex) {
  if (!track || typeof track !== "object")
    throw new TypeError("subtitle track must be an object");
  const id = String(track.id || `track:${trackIndex}`);
  const role = track.role === "secondary" ? "secondary" : "primary";
  const events = (Array.isArray(track.events) ? track.events : []).map(
    (event, eventIndex) => {
      if (!event || typeof event !== "object")
        throw new TypeError("subtitle event must be an object");
      const eventId = String(event.id || `${id}:event:${eventIndex}`);
      return {
        id: eventId,
        sourceText: String(event.sourceText || ""),
        startMs: Number.isFinite(Number(event.startMs)) ? Number(event.startMs) : null,
        endMs: Number.isFinite(Number(event.endMs)) ? Number(event.endMs) : null,
        layer: Number.isFinite(Number(event.layer)) ? Number(event.layer) : 0,
        units: (Array.isArray(event.units) ? event.units : []).map((unit, unitIndex) =>
          normalizeUnit(unit, id, eventId, unitIndex),
        ),
      };
    },
  );
  return {
    id,
    role,
    selected: track.selected !== false,
    track: track.track ? { ...track.track } : null,
    events,
  };
}

function createGeometrySnapshot(input) {
  if (!input || typeof input !== "object")
    throw new TypeError("geometry snapshot is required");
  const sessionId = String(input.sessionId || "");
  if (!sessionId) throw new TypeError("geometry snapshot sessionId is required");
  const mediaGeneration = Number(input.mediaGeneration);
  const geometryGeneration = Number(input.geometryGeneration);
  if (!Number.isInteger(mediaGeneration) || mediaGeneration < 0)
    throw new RangeError("mediaGeneration must be a non-negative integer");
  if (!Number.isInteger(geometryGeneration) || geometryGeneration < 0)
    throw new RangeError("geometryGeneration must be a non-negative integer");
  const snapshot = {
    sessionId,
    mediaGeneration,
    geometryGeneration,
    timeMs: Number.isFinite(Number(input.timeMs)) ? Number(input.timeMs) : null,
    content: rect(input.content, "content"),
    osd: {
      width: Number(input.osd && input.osd.width),
      height: Number(input.osd && input.osd.height),
    },
    desktopScale: Number(input.desktopScale || 1),
    browserScale: Number(input.browserScale || 1),
    source: input.source ? { ...input.source } : null,
    tracks: (Array.isArray(input.tracks) ? input.tracks : []).map(normalizeTrack),
  };
  new CoordinateMapper(snapshot);
  return cloneAndFreeze(snapshot);
}

function snapshotToken(snapshot) {
  return `${snapshot.sessionId}/${snapshot.mediaGeneration}/${snapshot.geometryGeneration}`;
}

function isSnapshotCurrent(snapshot, token) {
  if (!snapshot || !token) return false;
  return snapshotToken(snapshot) === snapshotToken(token);
}

function contains(point, value) {
  return (
    point.x >= value.x &&
    point.x <= value.x + value.width &&
    point.y >= value.y &&
    point.y <= value.y + value.height
  );
}

function area(value) {
  return value.width * value.height;
}

function hitTest(snapshot, desktopPoint) {
  const mapper = new CoordinateMapper(snapshot);
  const point = mapper.desktopToOsd(desktopPoint);
  const matches = [];
  snapshot.tracks.forEach((track, trackIndex) => {
    if (!track.selected) return;
    track.events.forEach((event, eventIndex) => {
      event.units.forEach((unit, unitIndex) => {
        if (!unit.lookupable) return;
        const hitRects = unit.rects.filter((value) => contains(point, value));
        if (!hitRects.length) return;
        matches.push({
          track,
          event,
          unit,
          rank: [
            Math.min(...hitRects.map(area)),
            -event.layer,
            track.role === "secondary" ? 1 : 0,
            trackIndex,
            eventIndex,
            unitIndex,
          ],
        });
      });
    });
  });
  matches.sort((left, right) => {
    for (let index = 0; index < left.rank.length; index++) {
      if (left.rank[index] !== right.rank[index])
        return left.rank[index] - right.rank[index];
    }
    return left.unit.id.localeCompare(right.unit.id);
  });
  return matches[0] || null;
}

function highlightForHit(snapshot, hit) {
  return highlightForUnits(snapshot, hit, hit?.unit ? [hit.unit] : []);
}

function highlightForUnits(snapshot, hit, units) {
  if (!hit || !Array.isArray(units) || !units.length) return [];
  const mapper = new CoordinateMapper(snapshot);
  return units.flatMap(
    (unit) =>
      (Array.isArray(unit?.envelopeRects) && unit.envelopeRects.length
        ? unit.envelopeRects
        : unit?.rects
      )?.map((value) => mapper.osdRectToDesktop(value)) || [],
  );
}

module.exports = {
  createGeometrySnapshot,
  highlightForHit,
  highlightForUnits,
  hitTest,
  isSnapshotCurrent,
  snapshotToken,
};
