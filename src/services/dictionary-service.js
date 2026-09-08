"use strict";

const { EventEmitter } = require("node:events");

const MAX_LOOKUP_CANDIDATES = 64;
const MAX_LOOKUP_RESULTS = 64;
const MAX_LOOKUP_GLOSSARIES = 64;
const MAX_LOOKUP_SCAN_LENGTH = 128;

function abortError() {
  const error = new Error("lookup cancelled");
  error.name = "AbortError";
  error.code = "LOOKUP_CANCELLED";
  return error;
}

function timeoutError() {
  const error = new Error("dictionary lookup timed out");
  error.name = "TimeoutError";
  error.code = "DICTIONARY_LOOKUP_TIMEOUT";
  return error;
}

function timeoutFor(value, fallback) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? Math.max(250, timeout) : fallback;
}

function candidateList(request) {
  const source = Array.isArray(request?.candidates) ? request.candidates : [];
  const seen = new Set();
  const candidates = [];
  for (const value of source) {
    if (!value || typeof value !== "object") continue;
    const text = String(value.text || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({ ...value, text });
    if (candidates.length >= MAX_LOOKUP_CANDIDATES) break;
  }
  if (candidates.length) return candidates;
  const text = String(request?.text || "").trim();
  return text ? [{ text, source: "lookup-text" }] : [];
}

function entryKey(entry) {
  const value = entry && typeof entry === "object" ? entry : {};
  const term = value.term && typeof value.term === "object" ? value.term : {};
  return [
    value.matched,
    value.deinflected,
    term.expression,
    term.reading,
    term.rules,
    Array.isArray(term.glossaries)
      ? term.glossaries
          .map((glossary) =>
            [
              glossary?.dict,
              glossary?.dictionary,
              glossary?.definitionTags,
              glossary?.termTags,
              glossary?.glossary,
            ].join("\u0002"),
          )
          .join("\u0003")
      : "",
  ]
    .map((value) => String(value || ""))
    .join("\u0001");
}

function candidateRequestId(requestId, index) {
  const base = String(requestId || "lookup")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 140);
  return `${base}-c${index}`;
}

function glossaryTagsIndicateNonLemma(glossary) {
  const tags =
    String(glossary?.definitionTags || "") + " " + String(glossary?.termTags || "");
  return /\bnon[-\s]?lemma\b/i.test(tags);
}

function lookupResultIsOnlyNonLemma(response) {
  const results = Array.isArray(response?.results) ? response.results : [];
  if (!results.length) return false;
  let glossaryCount = 0;
  for (const result of results) {
    const glossaries = Array.isArray(result?.term?.glossaries)
      ? result.term.glossaries
      : [];
    if (!glossaries.length) return false;
    for (const glossary of glossaries) {
      glossaryCount++;
      if (!glossaryTagsIndicateNonLemma(glossary)) return false;
    }
  }
  return glossaryCount > 0;
}

function compactLookupText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLookupGlossaryJson(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || (text[0] !== "[" && text[0] !== "{")) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function nonLemmaLemmaCandidates(response, alreadyTried, limit) {
  const candidates = [];
  const seen = new Set();
  const max = Math.max(1, Number(limit) || 4);
  const results = Array.isArray(response?.results) ? response.results : [];
  for (const result of results) {
    if (candidates.length >= max) break;
    const glossaries = Array.isArray(result?.term?.glossaries)
      ? result.term.glossaries
      : [];
    for (const glossary of glossaries) {
      if (candidates.length >= max) break;
      if (!glossaryTagsIndicateNonLemma(glossary)) continue;
      const parsed = parseLookupGlossaryJson(glossary.glossary);
      if (!Array.isArray(parsed)) continue;
      for (const row of parsed) {
        if (candidates.length >= max) break;
        if (!Array.isArray(row) || row.length < 1) continue;
        const text = compactLookupText(row[0]);
        if (!text || seen.has(text) || alreadyTried.has(text)) continue;
        seen.add(text);
        candidates.push({
          text,
          source: "non-lemma-reference",
          reason: "form-of lemma",
          displayText: text,
        });
      }
    }
  }
  return candidates;
}

function sampleResult(request) {
  const expression = String(request.text || "").trim();
  return {
    lookupString: expression,
    matched: expression,
    entries: [
      {
        id: "sample-entry-1",
        headword: expression,
        reading: request.language === "ja" ? "サンプル" : "",
        tags: ["sample", "demo"],
        frequency: ["demo"],
        pitch: [],
        glossaries: [
          {
            dictionary: "Demo dictionary",
            tags: ["noun"],
            content: [
              { type: "paragraph", text: "This is a deterministic demo entry." },
              {
                type: "example",
                text: "The popup is rendered by a normal transparent browser surface.",
              },
              {
                type: "note",
                text: "Production lookups are disabled until a HoshiDicts worker is configured.",
              },
              {
                type: "cross-reference",
                text: "related reference",
              },
            ],
          },
        ],
      },
    ],
  };
}

class DictionaryService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.handler = options.handler || null;
    this.demo = !!options.demo;
    this.timeoutMs = timeoutFor(options.timeoutMs, 30000);
    this.active = new Map();
  }

  async lookup(request, signal) {
    const requestId = String(request.requestId || "");
    if (!requestId) throw new TypeError("dictionary lookup requires requestId");
    if (signal && signal.aborted) throw abortError();
    const controller = new AbortController();
    let rejectCancellation;
    let timer;
    const onAbort = () => {
      controller.abort();
      rejectCancellation?.(abortError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const cancellation = new Promise((_, reject) => {
      rejectCancellation = reject;
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => {
          reject(timeoutError());
          controller.abort();
        },
        timeoutFor(request.lookupTimeoutMs, this.timeoutMs),
      );
    });
    const state = {
      controller,
      cancel: () => {
        controller.abort();
        rejectCancellation?.(abortError());
      },
    };
    this.active.set(requestId, state);
    try {
      if (signal && signal.aborted) {
        controller.abort();
        throw abortError();
      }
      const work = this.handler
        ? this.handler({ ...request, signal: controller.signal })
        : this.demo
          ? new Promise((resolve, reject) => {
              const demoTimer = setTimeout(resolve, 24, sampleResult(request));
              controller.signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(demoTimer);
                  reject(abortError());
                },
                { once: true },
              );
            })
          : Promise.reject(
              Object.assign(
                new Error("No dictionary worker is configured for this session"),
                { code: "DICTIONARY_BACKEND_UNAVAILABLE" },
              ),
            );
      return await Promise.race([work, cancellation, timeout]);
    } finally {
      clearTimeout(timer);
      this.active.delete(requestId);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  cancel(requestId) {
    const state = this.active.get(String(requestId));
    if (state) state.cancel();
  }

  cancelAll() {
    for (const state of this.active.values()) state.cancel();
    this.active.clear();
  }
}

class HoshiDictionaryService extends DictionaryService {
  constructor(options = {}) {
    super(options);
    if (!options.worker)
      throw new TypeError("HoshiDictionaryService requires a worker");
    this.worker = options.worker;
    this.maxResults = Math.min(
      MAX_LOOKUP_RESULTS,
      Math.max(1, Number(options.maxResults) || 8),
    );
    this.maxGlossaries = Math.min(
      MAX_LOOKUP_GLOSSARIES,
      Math.max(1, Number(options.maxGlossaries) || 4),
    );
    this.scanLength = Math.min(
      MAX_LOOKUP_SCAN_LENGTH,
      Math.max(1, Number(options.scanLength) || 24),
    );
    this.timeoutMs = timeoutFor(options.timeoutMs, 30000);
  }

  async lookup(request, signal) {
    const controller = new AbortController();
    const requestIds = new Set();
    let rejectCancellation;
    let timer;
    const abort = () => {
      controller.abort();
      for (const requestId of requestIds) this.worker.cancel(requestId).catch(() => {});
    };
    if (signal?.aborted) {
      abort();
      throw abortError();
    }
    const cancellation = new Promise((_, reject) => {
      rejectCancellation = reject;
    });
    const onAbort = () => {
      abort();
      rejectCancellation?.(abortError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => {
          reject(timeoutError());
          abort();
        },
        timeoutFor(request.lookupTimeoutMs, this.timeoutMs),
      );
    });
    try {
      return await Promise.race([
        this.#lookupCandidates(request, controller, requestIds),
        cancellation,
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      for (const requestId of requestIds) this.worker.cancel(requestId).catch(() => {});
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  async #lookupCandidates(request, controller, requestIds) {
    const candidates = candidateList(request);
    if (!candidates.length) return { ok: true, results: [] };
    const maxResults = Math.min(
      MAX_LOOKUP_RESULTS,
      Math.max(1, Number(request.maxResults) || this.maxResults),
    );
    const maxGlossaries = Math.min(
      MAX_LOOKUP_GLOSSARIES,
      Math.max(1, Number(request.maxGlossaries) || this.maxGlossaries),
    );
    const allCandidates = [...candidates];
    const triedTexts = new Set();
    const results = [];
    const seen = new Set();
    let firstResponse = null;
    let selectedResponse = null;
    let fallbackResponse = null;
    let fallbackCandidate = null;
    let candidateUsed = null;
    let candidateIndex = 0;

    const lookupCandidate = async (candidate) => {
      if (controller.signal.aborted) throw abortError();
      const childRequestId =
        request.mode === "exact"
          ? candidateRequestId(request.requestId, candidateIndex++)
          : String(request.requestId);
      requestIds.add(childRequestId);
      try {
        return await this.worker.lookup({
          requestId: childRequestId,
          text: candidate.text,
          maxResults,
          maxGlossaries,
          scanLength: Math.min(
            MAX_LOOKUP_SCAN_LENGTH,
            Math.max(
              1,
              Number(request.scanLength) ||
                Number(candidate.scanLength) ||
                Array.from(candidate.text).length ||
                this.scanLength,
            ),
          ),
          mode: request.mode || "yomitan-japanese",
        });
      } finally {
        requestIds.delete(childRequestId);
      }
    };

    const appendRegularResults = (response, candidate) => {
      const candidateResults = Array.isArray(response?.results) ? response.results : [];
      if (!candidateResults.length || lookupResultIsOnlyNonLemma(response))
        return false;
      if (!candidateUsed) {
        candidateUsed = candidate;
        selectedResponse = response;
      }
      for (const entry of candidateResults) {
        const key = entryKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(entry);
        if (results.length >= maxResults) break;
      }
      return true;
    };

    const followNonLemmaReferences = async (response) => {
      const references = nonLemmaLemmaCandidates(response, triedTexts, maxResults);
      for (const candidate of references) {
        if (results.length >= maxResults) break;
        triedTexts.add(candidate.text);
        allCandidates.push(candidate);
        const candidateResponse = await lookupCandidate(candidate);
        if (!firstResponse) firstResponse = candidateResponse;
        if (!appendRegularResults(candidateResponse, candidate)) continue;
        if (results.length >= maxResults) break;
      }
    };

    for (const candidate of candidates) {
      if (triedTexts.has(candidate.text)) continue;
      triedTexts.add(candidate.text);
      const response = await lookupCandidate(candidate);
      if (!firstResponse) firstResponse = response;
      const candidateResults = Array.isArray(response?.results) ? response.results : [];
      if (candidateResults.length && lookupResultIsOnlyNonLemma(response)) {
        if (!fallbackResponse) {
          fallbackResponse = response;
          fallbackCandidate = candidate;
        }
        await followNonLemmaReferences(response);
      } else {
        appendRegularResults(response, candidate);
      }
      if (results.length >= maxResults) break;
      if (request.mode !== "exact") break;
    }

    if (!candidateUsed && fallbackResponse) candidateUsed = fallbackCandidate;

    const baseResponse = selectedResponse || fallbackResponse || firstResponse || {};
    const returnedResults = candidateUsed
      ? selectedResponse
        ? results
        : Array.isArray(fallbackResponse?.results)
          ? fallbackResponse.results.slice(0, maxResults)
          : []
      : [];
    return {
      ...(baseResponse && typeof baseResponse === "object" ? baseResponse : {}),
      ok: true,
      lookupString: String(request.text || baseResponse.lookupString || ""),
      matched: String(
        returnedResults[0]?.matched || baseResponse.matched || request.text || "",
      ),
      resultCount: returnedResults.length,
      results: returnedResults,
      lookupCandidates: allCandidates,
      candidateUsed,
    };
  }

  cancel(requestId) {
    return this.worker.cancel(requestId);
  }

  cancelAll() {
    for (const requestId of this.worker.active.keys())
      this.worker.cancel(requestId).catch(() => {});
  }
}

module.exports = {
  DictionaryService,
  HoshiDictionaryService,
  abortError,
  timeoutError,
  sampleResult,
};
