"use strict";

const { readBoundedText } = require("./audio-service");

const ANKI_RESPONSE_LIMIT = 512 * 1024;

function safeAnkiUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_) {
    return "";
  }
  if (url.username || url.password || !url.hostname) return "";
  if (url.protocol === "https:") return url.href;
  if (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    return url.href;
  return "";
}

function normalizeNote(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Anki note must be an object");
  const fields =
    value.fields && typeof value.fields === "object" && !Array.isArray(value.fields)
      ? value.fields
      : {};
  const normalizedFields = {};
  for (const [name, field] of Object.entries(fields).slice(0, 64))
    normalizedFields[String(name).slice(0, 200)] = String(field ?? "").slice(0, 200000);
  const tags = Array.isArray(value.tags)
    ? value.tags
        .map((tag) => String(tag).slice(0, 120))
        .filter(Boolean)
        .slice(0, 64)
    : [];
  return {
    deckName: String(value.deckName || "").slice(0, 200),
    modelName: String(value.modelName || "").slice(0, 200),
    fields: normalizedFields,
    tags,
    options:
      value.options &&
      typeof value.options === "object" &&
      !Array.isArray(value.options)
        ? {
            allowDuplicate: !!value.options.allowDuplicate,
            duplicateScope: String(value.options.duplicateScope || ""),
          }
        : undefined,
    audio: Array.isArray(value.audio)
      ? value.audio
          .slice(0, 16)
          .map((item) => ({
            filename: String(item?.filename || "").slice(0, 240),
            fields: Array.isArray(item?.fields)
              ? item.fields.map(String).slice(0, 16)
              : [],
          }))
          .filter((item) => item.filename)
      : undefined,
  };
}

class AnkiConnectClient {
  constructor(options = {}) {
    this.url = safeAnkiUrl(options.url || "http://127.0.0.1:8765");
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(500, Number(options.timeoutMs) || 3000);
    this.version = Number(options.version) || 6;
    if (!this.url) throw new Error("AnkiConnect URL must be HTTPS or loopback HTTP");
    if (typeof this.fetch !== "function")
      throw new TypeError("AnkiConnectClient requires fetch");
  }

  async invoke(action, params = {}, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetch(this.url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: String(action || ""),
          version: this.version,
          params,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
      let body;
      if (typeof response.text === "function" || response.body?.getReader) {
        const text = await readBoundedText(response, ANKI_RESPONSE_LIMIT);
        if (text === null)
          throw new Error("AnkiConnect response exceeds the size limit");
        try {
          body = JSON.parse(text);
        } catch (_) {
          throw new Error("AnkiConnect returned invalid JSON");
        }
      } else {
        throw new Error("AnkiConnect response does not expose a bounded body reader");
      }
      if (!body || body.error)
        throw new Error(
          String(body?.error || "AnkiConnect returned an invalid response"),
        );
      return body.result;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError")
        throw Object.assign(new Error("AnkiConnect request cancelled or timed out"), {
          name: "AbortError",
        });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  versionInfo(signal) {
    return this.invoke("version", {}, signal);
  }
  deckNames(signal) {
    return this.invoke("deckNames", {}, signal);
  }
  modelNames(signal) {
    return this.invoke("modelNames", {}, signal);
  }
  modelFieldNames(modelName, signal) {
    return this.invoke(
      "modelFieldNames",
      { modelName: String(modelName || "") },
      signal,
    );
  }
  findNotes(query, signal) {
    return this.invoke("findNotes", { query: String(query || "") }, signal);
  }
  findCards(query, signal) {
    return this.invoke("findCards", { query: String(query || "") }, signal);
  }
  guiBrowse(query, signal) {
    return this.invoke("guiBrowse", { query: String(query || "") }, signal);
  }
  storeMediaFile(filename, data, options = {}, signal) {
    return this.invoke(
      "storeMediaFile",
      {
        filename: String(filename || ""),
        data: String(data || ""),
        overwrite: options.overwrite === true,
      },
      signal,
    );
  }
  addNote(note, signal) {
    return this.invoke("addNote", { note: normalizeNote(note) }, signal);
  }
}

module.exports = {
  ANKI_RESPONSE_LIMIT,
  AnkiConnectClient,
  normalizeNote,
  safeAnkiUrl,
};
