"use strict";

function requestId(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(text))
    throw new Error("invalid native geometry request id");
  return text;
}

function geometryRequest(input) {
  const renderer = input.renderer || {};
  const cue = { ...input.cue };
  if (!cue.observedAss && !cue.observedPlain)
    throw new TypeError("native geometry cue observation is required");
  if (cue.observedAss && !cue.observedFormat) cue.observedFormat = "ass";
  if (cue.observedPlain && !cue.observedFormat) cue.observedFormat = "plain";
  if (cue.assFull !== undefined || cue.assExtradata !== undefined) {
    if (typeof cue.assFull !== "string" || typeof cue.assExtradata !== "string")
      throw new TypeError("native geometry ASS metadata must be paired");
  }
  const units = (Array.isArray(input.units) ? input.units : []).map((unit) => ({
    position: Number(unit.position),
    displayStartUtf16: Number(unit.displayStartUtf16 ?? unit.utf16Start),
    displayEndUtf16: Number(unit.displayEndUtf16 ?? unit.utf16End),
  }));
  if (
    !units.length ||
    units.some(
      (unit) =>
        !Number.isInteger(unit.position) ||
        !Number.isInteger(unit.displayStartUtf16) ||
        !Number.isInteger(unit.displayEndUtf16) ||
        unit.displayEndUtf16 <= unit.displayStartUtf16,
    )
  )
    throw new TypeError("native geometry units are invalid");
  return {
    type: "ass-geometry",
    protocol: 1,
    requestId: requestId(input.requestId),
    diagnostics: true,
    validateInstrumentation: true,
    requestAlphaMask: false,
    source: { ...input.source },
    cue,
    units,
    renderer: {
      storageWidth: Number(renderer.storageWidth || renderer.width),
      storageHeight: Number(renderer.storageHeight || renderer.height),
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      pixelAspect: 1,
      fontScale: 1,
      lineSpacing: 0,
      forceMargins: false,
      embeddedFonts: true,
      useStorageSize: false,
      overrideMode: "yes",
      defaultFamily: "sans-serif",
      fontProvider: "system",
      assJustify: false,
      ...renderer,
      width: Number(renderer.width),
      height: Number(renderer.height),
    },
  };
}

class NativeGeometryClient {
  constructor(worker) {
    if (!worker || typeof worker.lookup !== "function")
      throw new TypeError("native geometry worker is required");
    this.worker = worker;
    this.capabilities = null;
  }

  async negotiate() {
    if (typeof this.worker.version !== "function")
      throw new Error("native geometry helper does not support capability negotiation");
    const response = await this.worker.version();
    if (
      !response ||
      response.ok !== true ||
      response.assGeometry?.protocol !== 1 ||
      response.assGeometry?.available !== true
    ) {
      const error = new Error("native geometry capability negotiation failed");
      error.code = "NATIVE_GEOMETRY_CAPABILITY_MISMATCH";
      throw error;
    }
    this.capabilities = response;
    return response;
  }

  async measure(input) {
    if (!input || !input.source || !input.cue || !input.renderer)
      throw new TypeError("native geometry input is incomplete");
    const id = requestId(input.requestId);
    const response = await this.worker.lookup(
      geometryRequest({ ...input, requestId: id }),
    );
    if (!response || response.ok !== true || response.protocol !== 1) {
      const error = new Error(
        response?.error || response?.reason || "native subtitle geometry failed",
      );
      error.code = response?.reason || "NATIVE_GEOMETRY_FAILED";
      throw error;
    }
    return response;
  }
}

module.exports = { NativeGeometryClient, geometryRequest };
