"use strict";

const path = require("node:path");

const LANGUAGE_IDS = Object.freeze({
  ja: ["ja-JP"],
  en: ["en-US"],
  de: ["de-DE"],
  fr: ["fr-FR"],
  ko: ["ko-KR"],
  zh: ["zh-Hans", "zh-Hant"],
});

function requestId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id))
    throw new Error("invalid bitmap OCR request id");
  return id;
}

function absolutePath(value, name) {
  const result = String(value || "");
  if (!path.isAbsolute(result)) throw new TypeError(`${name} must be absolute`);
  return result;
}

function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0)
    throw new TypeError(`${name} must be a positive integer`);
  return result;
}

function nonNegativeInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0)
    throw new TypeError(`${name} must be a non-negative integer`);
  return result;
}

function bitmapOcrLanguages(language) {
  return [...(LANGUAGE_IDS[String(language || "ja")] || [])];
}

function bitmapOcrRequest(input = {}) {
  const renderer = input.renderer || {};
  const width = positiveInteger(renderer.width, "renderer.width");
  const height = positiveInteger(renderer.height, "renderer.height");
  const languages = Array.isArray(input.languages)
    ? input.languages.map(String).filter(Boolean).slice(0, 8)
    : [];
  if (!languages.length) throw new TypeError("bitmap OCR languages are required");
  const mode = String(input.mode || "decoded-subtitle");
  if (!new Set(["decoded-subtitle", "screenshot-diff"]).has(mode))
    throw new TypeError("unsupported bitmap OCR mode");
  const request = {
    type: "bitmap-subtitle-ocr",
    protocol: 1,
    requestId: requestId(input.requestId),
    mode,
    languages,
    renderer: {
      width,
      height,
      storageWidth: positiveInteger(
        renderer.storageWidth || width,
        "renderer.storageWidth",
      ),
      storageHeight: positiveInteger(
        renderer.storageHeight || height,
        "renderer.storageHeight",
      ),
      marginLeft: nonNegativeInteger(renderer.marginLeft || 0, "renderer.marginLeft"),
      marginRight: nonNegativeInteger(
        renderer.marginRight || 0,
        "renderer.marginRight",
      ),
      marginTop: nonNegativeInteger(renderer.marginTop || 0, "renderer.marginTop"),
      marginBottom: nonNegativeInteger(
        renderer.marginBottom || 0,
        "renderer.marginBottom",
      ),
    },
  };
  if (mode === "decoded-subtitle") {
    const source = input.source || {};
    request.source = {
      path: absolutePath(source.path, "source.path"),
      ffIndex:
        Number.isInteger(Number(source.ffIndex)) && Number(source.ffIndex) >= 0
          ? Number(source.ffIndex)
          : -1,
      external: source.external === true,
      autoBitmapStream: source.autoBitmapStream === true,
      cacheExcerpt: source.cacheExcerpt === true,
    };
    request.timeMs = nonNegativeInteger(input.timeMs, "timeMs");
    request.cueStartMs = nonNegativeInteger(input.cueStartMs, "cueStartMs");
    request.cueEndMs = positiveInteger(input.cueEndMs, "cueEndMs");
    if (request.cueEndMs <= request.cueStartMs)
      throw new TypeError("cueEndMs must be after cueStartMs");
  } else {
    const images = input.images || {};
    request.images = {
      video: absolutePath(images.video, "images.video"),
      subtitles: absolutePath(images.subtitles, "images.subtitles"),
    };
  }
  return request;
}

function normalizeBitmapOcrResponse(response, request) {
  if (
    !response ||
    response.ok !== true ||
    response.protocol !== 1 ||
    typeof response.text !== "string" ||
    !response.text ||
    response.text.length > 64 * 1024 ||
    !Array.isArray(response.units) ||
    response.units.length === 0 ||
    response.units.length > 2048 ||
    Number(response.rendererWidth) !== request.renderer.width ||
    Number(response.rendererHeight) !== request.renderer.height
  ) {
    const error = new Error(
      response?.error || response?.reason || "invalid bitmap OCR response",
    );
    error.code = response?.reason || "BITMAP_OCR_INVALID_RESPONSE";
    throw error;
  }
  return response;
}

class NativeBitmapOcrClient {
  constructor(worker) {
    if (!worker || typeof worker.lookup !== "function")
      throw new TypeError("bitmap OCR worker is required");
    this.worker = worker;
  }

  async recognize(input, options = {}) {
    const request = bitmapOcrRequest(input);
    return normalizeBitmapOcrResponse(
      await this.worker.lookup(request, options),
      request,
    );
  }
}

function isBitmapSubtitleCodec(codec) {
  return /pgs|hdmv|dvd|vobsub|dvb|bitmap/i.test(String(codec || ""));
}

module.exports = {
  LANGUAGE_IDS,
  NativeBitmapOcrClient,
  bitmapOcrLanguages,
  bitmapOcrRequest,
  isBitmapSubtitleCodec,
  normalizeBitmapOcrResponse,
};
