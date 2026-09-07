"use strict";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function box(value) {
  const x = finite(value?.x);
  const y = finite(value?.y);
  const width = Math.max(0, finite(value?.width ?? value?.w));
  const height = Math.max(0, finite(value?.height ?? value?.h));
  return { x, y, width, height };
}

function area(value) {
  return value.width * value.height;
}

function intersection(left, right) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}

function iou(left, right) {
  const a = box(left);
  const b = box(right);
  const union = area(a) + area(b) - intersection(a, b);
  return union > 0 ? intersection(a, b) / union : 0;
}

function edgeError(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const a = box(left);
  const b = box(right);
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.x + a.width - (b.x + b.width)),
    Math.abs(a.y + a.height - (b.y + b.height)),
  );
}

function bestMatch(value, candidates) {
  let best = 0;
  for (const candidate of candidates) best = Math.max(best, iou(value, candidate));
  return best;
}

function compareGeometryCase(input, threshold = 0.98) {
  const predicted = Array.isArray(input?.predicted) ? input.predicted : [];
  const observed = Array.isArray(input?.observed) ? input.observed : [];
  const predictedScores = predicted.map((value) => bestMatch(value, observed));
  const observedScores = observed.map((value) => bestMatch(value, predicted));
  const scores = predictedScores.concat(observedScores);
  const minimum = scores.length ? Math.min(...scores) : 1;
  return {
    id: String(input?.id || "case"),
    predictedCount: predicted.length,
    observedCount: observed.length,
    predictedScores,
    observedScores,
    minimumScore: minimum,
    threshold: Number(threshold),
    pass: predicted.length === observed.length && minimum >= Number(threshold),
  };
}

function compareGeometryFixture(input) {
  const threshold = Number(input?.threshold ?? 0.98);
  if (!(threshold >= 0 && threshold <= 1))
    throw new RangeError("geometry oracle threshold must be between 0 and 1");
  const cases = (Array.isArray(input?.cases) ? input.cases : []).map((value) =>
    compareGeometryCase(value, threshold),
  );
  return { threshold, pass: cases.every((value) => value.pass), cases };
}

module.exports = {
  bestMatch,
  compareGeometryCase,
  compareGeometryFixture,
  edgeError,
  intersection,
  iou,
};
