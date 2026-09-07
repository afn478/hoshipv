"use strict";

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function rect(value, name = "rect") {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required`);
  const result = {
    x: finiteNumber(value.x, `${name}.x`),
    y: finiteNumber(value.y, `${name}.y`),
    width: positiveNumber(value.width, `${name}.width`),
    height: positiveNumber(value.height, `${name}.height`),
  };
  return Object.freeze(result);
}

function point(value, name = "point") {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required`);
  return Object.freeze({
    x: finiteNumber(value.x, `${name}.x`),
    y: finiteNumber(value.y, `${name}.y`),
  });
}

function translatePoint(value, dx, dy) {
  return { x: value.x + dx, y: value.y + dy };
}

function scalePoint(value, sx, sy) {
  return { x: value.x * sx, y: value.y * sy };
}

function roundNativeBounds(value) {
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.max(1, Math.round(value.width)),
    height: Math.max(1, Math.round(value.height)),
  };
}

class CoordinateMapper {
  constructor(snapshot) {
    if (!snapshot || !snapshot.content || !snapshot.osd)
      throw new TypeError("a geometry snapshot with content and osd is required");
    this.content = rect(snapshot.content, "content");
    this.osd = {
      width: positiveNumber(snapshot.osd.width, "osd.width"),
      height: positiveNumber(snapshot.osd.height, "osd.height"),
    };
    this.desktopScale = positiveNumber(snapshot.desktopScale || 1, "desktopScale");
    this.browserScale = positiveNumber(snapshot.browserScale || 1, "browserScale");
    this.osdToDesktopScale = Object.freeze({
      x: this.content.width / this.osd.width,
      y: this.content.height / this.osd.height,
    });
  }

  osdToDesktop(pointValue) {
    const value = point(pointValue, "osdPoint");
    const scaled = scalePoint(
      value,
      this.osdToDesktopScale.x,
      this.osdToDesktopScale.y,
    );
    return translatePoint(scaled, this.content.x, this.content.y);
  }

  desktopToOsd(pointValue) {
    const value = point(pointValue, "desktopPoint");
    return scalePoint(
      translatePoint(value, -this.content.x, -this.content.y),
      1 / this.osdToDesktopScale.x,
      1 / this.osdToDesktopScale.y,
    );
  }

  osdRectToDesktop(rectValue) {
    const value = rect(rectValue, "osdRect");
    const origin = this.osdToDesktop({ x: value.x, y: value.y });
    return {
      x: origin.x,
      y: origin.y,
      width: value.width * this.osdToDesktopScale.x,
      height: value.height * this.osdToDesktopScale.y,
    };
  }

  desktopRectToOsd(rectValue) {
    const value = rect(rectValue, "desktopRect");
    const origin = this.desktopToOsd({ x: value.x, y: value.y });
    return {
      x: origin.x,
      y: origin.y,
      width: value.width / this.osdToDesktopScale.x,
      height: value.height / this.osdToDesktopScale.y,
    };
  }

  desktopToPhysical(pointValue) {
    return scalePoint(
      point(pointValue, "desktopPoint"),
      this.desktopScale,
      this.desktopScale,
    );
  }

  physicalToDesktop(pointValue) {
    return scalePoint(
      point(pointValue, "physicalPoint"),
      1 / this.desktopScale,
      1 / this.desktopScale,
    );
  }

  desktopToBrowserCss(
    pointValue,
    surfaceOrigin = { x: this.content.x, y: this.content.y },
  ) {
    const value = point(pointValue, "desktopPoint");
    const origin = point(surfaceOrigin, "surfaceOrigin");
    return scalePoint(
      translatePoint(value, -origin.x, -origin.y),
      this.browserScale,
      this.browserScale,
    );
  }

  browserCssToDesktop(
    pointValue,
    surfaceOrigin = { x: this.content.x, y: this.content.y },
  ) {
    const value = point(pointValue, "browserPoint");
    const origin = point(surfaceOrigin, "surfaceOrigin");
    const unscaled = scalePoint(value, 1 / this.browserScale, 1 / this.browserScale);
    return translatePoint(unscaled, origin.x, origin.y);
  }

  browserCssRectToDesktop(rectValue, surfaceOrigin) {
    const value = rect(rectValue, "browserRect");
    const origin = this.browserCssToDesktop({ x: value.x, y: value.y }, surfaceOrigin);
    return {
      x: origin.x,
      y: origin.y,
      width: value.width / this.browserScale,
      height: value.height / this.browserScale,
    };
  }

  nativeBounds(rectValue) {
    return roundNativeBounds(rect(rectValue));
  }
}

module.exports = {
  CoordinateMapper,
  point,
  rect,
  roundNativeBounds,
};
