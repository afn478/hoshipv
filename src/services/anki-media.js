"use strict";

const crypto = require("node:crypto");
const { declaredContentLength, safeAudioUrl } = require("./audio-service");

const MEDIA_LIMIT_BYTES = 8 * 1024 * 1024;

async function readBoundedBytes(response, maximumBytes = MEDIA_LIMIT_BYTES) {
  const limit = Math.max(1, Number(maximumBytes) || MEDIA_LIMIT_BYTES);
  const length = declaredContentLength(response);
  if (Number.isFinite(length) && length > limit) return null;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        total += chunk.length;
        if (total > limit) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally {
      reader.releaseLock?.();
    }
  }
  if (typeof response.arrayBuffer !== "function") return null;
  if (!Number.isFinite(length)) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return body.length <= limit ? body : null;
}

function mediaRequirements(templates) {
  const markers = new Set();
  Object.values(templates && typeof templates === "object" ? templates : {}).forEach(
    (value) => {
      String(value || "").replace(/\{([^{}]+)\}/g, (_match, marker) => {
        markers.add(String(marker).trim().toLowerCase());
        return "";
      });
    },
  );
  return {
    screenshot: markers.has("screenshot") || markers.has("image"),
    sentenceAudio: markers.has("sentence-audio") || markers.has("subtitle-audio"),
    wordAudio: markers.has("audio"),
  };
}

function extensionFor(url, contentType = "") {
  const match = String(url || "").match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  const fromUrl = match?.[1]?.toLowerCase();
  if (
    fromUrl &&
    /^(mp3|m4a|aac|ogg|oga|opus|wav|webm|jpg|jpeg|png|webp)$/.test(fromUrl)
  )
    return fromUrl === "jpeg" ? "jpg" : fromUrl;
  const type = String(contentType || "").toLowerCase();
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  if (type.includes("webm")) return "webm";
  if (type.includes("png")) return "png";
  return type.includes("jpeg") ? "jpg" : "m4a";
}

function mediaFilename(prefix, url, extension) {
  const digest = crypto
    .createHash("sha256")
    .update(String(url || ""))
    .digest("hex");
  const safePrefix =
    String(prefix || "iinatan")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "iinatan";
  return `${safePrefix}-${digest.slice(0, 20)}.${extension}`;
}

async function fetchMedia(url, options = {}) {
  const safeUrl = safeAudioUrl(url);
  if (!safeUrl) throw new Error("Anki media URL is not allowed");
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw new TypeError("media fetch is unavailable");
  const response = await fetchImpl(safeUrl, {
    redirect: "error",
    signal: options.signal,
    headers: { accept: "audio/*, image/*, application/octet-stream" },
  });
  if (!response.ok) throw new Error(`Anki media HTTP ${response.status}`);
  const length = declaredContentLength(response);
  if (Number.isFinite(length) && length > (options.maxBytes || MEDIA_LIMIT_BYTES))
    throw new Error("Anki media exceeds the size limit");
  const body = await readBoundedBytes(response, options.maxBytes || MEDIA_LIMIT_BYTES);
  if (!body) throw new Error("Anki media exceeds the size limit");
  return {
    url: safeUrl,
    filename: mediaFilename(
      options.prefix,
      safeUrl,
      extensionFor(safeUrl, response.headers?.get?.("content-type")),
    ),
    data: body.toString("base64"),
  };
}

async function storeRemoteMedia(client, url, options = {}) {
  if (!client || typeof client.storeMediaFile !== "function")
    throw new TypeError("Anki media storage is unavailable");
  const media = await fetchMedia(url, options);
  await client.storeMediaFile(
    media.filename,
    media.data,
    { overwrite: false },
    options.signal,
  );
  return media.filename;
}

module.exports = {
  MEDIA_LIMIT_BYTES,
  extensionFor,
  fetchMedia,
  mediaFilename,
  mediaRequirements,
  readBoundedBytes,
  storeRemoteMedia,
};
