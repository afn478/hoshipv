"use strict";

const AUDIO_RESPONSE_LIMIT = 512 * 1024;

function declaredContentLength(response) {
  const raw = response.headers?.get?.("content-length");
  if (raw === null || raw === undefined || String(raw).trim() === "") return NaN;
  const length = Number(raw);
  return Number.isFinite(length) && length >= 0 ? length : NaN;
}

async function readBoundedText(response, maximumBytes) {
  const limit = Math.max(1, Number(maximumBytes) || AUDIO_RESPONSE_LIMIT);
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
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      reader.releaseLock?.();
    }
  }
  if (!Number.isFinite(length)) return null;
  const body = await response.text();
  return Buffer.byteLength(body, "utf8") <= limit ? body : null;
}

function safeAudioUrl(value, base = "") {
  let url;
  try {
    url = new URL(String(value || ""), base || undefined);
  } catch (_) {
    return "";
  }
  if (url.username || url.password || !url.hostname) return "";
  if (url.protocol === "https:") return url.href;
  if (url.protocol !== "http:") return "";
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ? url.href : "";
}

function expandTemplate(value, request) {
  const term = encodeURIComponent(String(request.term || ""));
  const reading = encodeURIComponent(String(request.reading || ""));
  return String(value || "")
    .replaceAll("{term}", term)
    .replaceAll("{reading}", reading)
    .replaceAll("{expression}", term);
}

function parseSources(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCandidates(value, base) {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((item) => {
      const url = safeAudioUrl(typeof item === "string" ? item : item?.url, base);
      return url
        ? {
            url,
            type: String(item?.type || "audio").slice(0, 64),
            name: String(item?.name || "").slice(0, 200),
          }
        : null;
    })
    .filter(Boolean)
    .slice(0, 32);
}

class AudioSourceService {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(500, Number(options.timeoutMs) || 10000);
    if (typeof this.fetch !== "function")
      throw new TypeError("AudioSourceService requires fetch");
  }

  async resolve(request = {}, signal) {
    const candidates = [];
    for (const source of parseSources(request.sources || request.sourcesJson)) {
      const template = typeof source === "string" ? source : source?.url;
      if (!template) continue;
      const url = safeAudioUrl(expandTemplate(template, request));
      if (!url) continue;
      if (/\.(?:mp3|m4a|ogg|opus|wav)(?:$|[?#])/i.test(url)) {
        candidates.push({
          url,
          type: "audio",
          name: typeof source === "object" ? String(source.name || "") : "",
        });
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await this.fetch(url, {
          redirect: "error",
          signal: controller.signal,
          headers: { accept: "application/json, text/plain" },
        });
        if (!response.ok) continue;
        const body = await readBoundedText(response, AUDIO_RESPONSE_LIMIT);
        if (body === null) continue;
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch (_) {
          parsed = { audioSources: [body.trim()] };
        }
        candidates.push(
          ...normalizeCandidates(
            parsed?.audioSources || parsed?.sources || parsed,
            url,
          ),
        );
      } catch (error) {
        if (signal?.aborted)
          throw Object.assign(new Error("audio lookup cancelled"), {
            name: "AbortError",
          });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    const seen = new Set();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    });
  }
}

module.exports = {
  AudioSourceService,
  declaredContentLength,
  expandTemplate,
  normalizeCandidates,
  parseSources,
  readBoundedText,
  safeAudioUrl,
};
