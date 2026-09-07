"use strict";

const { rect } = require("./coordinate-mapper");

function right(value) {
  return value.x + value.width;
}

function bottom(value) {
  return value.y + value.height;
}

function intersectionArea(left, rightValue) {
  const width = Math.max(
    0,
    Math.min(right(left), right(rightValue)) - Math.max(left.x, rightValue.x),
  );
  const height = Math.max(
    0,
    Math.min(bottom(left), bottom(rightValue)) - Math.max(left.y, rightValue.y),
  );
  return width * height;
}

function containsRect(container, value) {
  return (
    value.x >= container.x &&
    value.y >= container.y &&
    right(value) <= right(container) &&
    bottom(value) <= bottom(container)
  );
}

function clampRect(value, bounds) {
  return {
    x: Math.max(bounds.x, Math.min(value.x, right(bounds) - value.width)),
    y: Math.max(bounds.y, Math.min(value.y, bottom(bounds) - value.height)),
    width: value.width,
    height: value.height,
  };
}

function corridorBetween(start, end, padding) {
  const x = Math.min(start.x, end.x) - padding;
  const y = Math.min(start.y, end.y) - padding;
  const endX = Math.max(start.x, end.x) + padding;
  const endY = Math.max(start.y, end.y) + padding;
  return { x, y, width: endX - x, height: endY - y };
}

function candidateRects(anchor, popupSize, gap) {
  const width = popupSize.width;
  const height = popupSize.height;
  return [
    { side: "below", x: anchor.x, y: bottom(anchor) + gap, width, height },
    { side: "above", x: anchor.x, y: anchor.y - gap - height, width, height },
    { side: "right", x: right(anchor) + gap, y: anchor.y, width, height },
    { side: "left", x: anchor.x - gap - width, y: anchor.y, width, height },
  ];
}

function scoreCandidate(
  candidate,
  bounds,
  obstacles,
  cursorCorridor,
  previous,
  preferredSide,
) {
  const overflow =
    Math.max(0, bounds.x - candidate.x) +
    Math.max(0, bounds.y - candidate.y) +
    Math.max(0, right(candidate) - right(bounds)) +
    Math.max(0, bottom(candidate) - bottom(bounds));
  const obstacleCost = obstacles.reduce(
    (total, obstacle) => total + intersectionArea(candidate, obstacle),
    0,
  );
  const corridorCost = cursorCorridor ? intersectionArea(candidate, cursorCorridor) : 0;
  const continuityCost = previous
    ? Math.hypot(candidate.x - previous.x, candidate.y - previous.y)
    : 0;
  const sideCost = preferredSide && candidate.side !== preferredSide ? 24 : 0;
  return (
    overflow * 100000 +
    obstacleCost * 100 +
    corridorCost * 3 +
    continuityCost +
    sideCost
  );
}

function placePopup(input) {
  if (!input || typeof input !== "object")
    throw new TypeError("placement input is required");
  const anchor = rect(input.anchor, "anchor");
  const popupSize = rect({ x: 0, y: 0, ...input.popupSize }, "popupSize");
  const bounds = rect(input.bounds, "bounds");
  const gap = Math.max(0, Number(input.gap) || 0);
  const obstacles = (Array.isArray(input.obstacles) ? input.obstacles : []).map(
    (value) => rect(value, "obstacle"),
  );
  const cursor = input.cursor
    ? { x: Number(input.cursor.x), y: Number(input.cursor.y) }
    : null;
  const corridorPadding = Math.max(0, Number(input.corridorPadding) || 0);
  const cursorCorridor = cursor
    ? corridorBetween(
        cursor,
        { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 },
        corridorPadding,
      )
    : null;
  const candidates = candidateRects(anchor, popupSize, gap).map((candidate) => {
    const clamped = clampRect(candidate, bounds);
    return {
      ...clamped,
      side: candidate.side,
      wasClamped: !containsRect(bounds, candidate),
    };
  });
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidate(
      candidate,
      bounds,
      obstacles,
      cursorCorridor,
      input.previous,
      input.preferredSide,
    ),
  }));
  scored.sort(
    (left, rightValue) =>
      left.score - rightValue.score ||
      left.candidate.side.localeCompare(rightValue.candidate.side),
  );
  let winner = scored[0];
  const previous = input.previous && rect(input.previous, "previous");
  const hysteresis = Math.max(0, Number(input.hysteresis) || 0);
  if (previous) {
    const previousCandidate = scored.find(
      (item) => item.candidate.side === input.previousSide,
    );
    if (previousCandidate && previousCandidate.score <= winner.score + hysteresis)
      winner = previousCandidate;
  }
  return Object.freeze({
    ...winner.candidate,
    score: winner.score,
    cursorCorridor,
    stable: !!previous && winner.candidate.side === input.previousSide,
  });
}

module.exports = {
  bottom,
  candidateRects,
  corridorBetween,
  containsRect,
  intersectionArea,
  placePopup,
  right,
};
