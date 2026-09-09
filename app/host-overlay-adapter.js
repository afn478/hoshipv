"use strict";

(() => {
  window.IINATAN_LOOKUP_CHARACTER_POLICY ||= {
    policies: {
      japanese: {
        kind: "japanese",
        pattern: /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005]/,
      },
      latin: { kind: "latin", pattern: /[A-Za-z0-9'\u2019\u2032\u2018\u201b\u2013-]/ },
      korean: { kind: "korean", pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/ },
    },
    matches(policy, value) {
      if (!value) return false;
      if (policy?.pattern instanceof RegExp) return policy.pattern.test(String(value));
      return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005A-Za-z0-9]/.test(
        String(value),
      );
    },
  };
  const host = window.iinatanHost;
  const handlers = new Map();
  const ankiRequests = new Map();
  const nestedRequests = new Map();
  let latestGeometryGeneration = -1;

  function onMessage(type, listener) {
    const key = String(type || "");
    if (!handlers.has(key)) handlers.set(key, new Set());
    handlers.get(key).add(listener);
    return () => handlers.get(key)?.delete(listener);
  }

  function dispatch(type, payload) {
    for (const listener of handlers.get(String(type || "")) || []) {
      try {
        listener(payload);
      } catch (error) {
        console.error("[iinatan popup] message handler failed", error);
      }
    }
  }

  function send(type, payload) {
    try {
      host.send(type, payload && typeof payload === "object" ? payload : {});
      return true;
    } catch (error) {
      console.error("[iinatan popup] host request failed", type, error);
      return false;
    }
  }

  function textNode(value) {
    return String(value ?? "");
  }

  function referenceNode(value, depth = 0) {
    if (depth > 24 || value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number") return textNode(value);
    if (Array.isArray(value))
      return value.map((item) => referenceNode(item, depth + 1)).filter(Boolean);
    if (typeof value !== "object") return null;
    if (value.type === "text") return String(value.text || "");

    if (value.type === "structured-content" || value.type === "structured-element")
      return {
        ...value,
        content: referenceNode(value.content, depth + 1),
      };

    const content = [textNode(value.text || "")];
    switch (String(value.type || "paragraph")) {
      case "link":
        return {
          type: "structured-element",
          tag: "a",
          ...(value.href ? { href: String(value.href) } : {}),
          className: "xref-link",
          content,
        };
      case "cross-reference":
        return {
          type: "structured-element",
          tag: "a",
          className: "xref-link",
          data: { lookup: String(value.lookup || value.text || "") },
          content,
        };
      case "furigana":
        return {
          type: "structured-element",
          tag: "ruby",
          content: [
            textNode(value.text || ""),
            ...(value.reading
              ? [
                  {
                    type: "structured-element",
                    tag: "rt",
                    content: [textNode(value.reading)],
                  },
                ]
              : []),
          ],
        };
      case "section":
        return {
          type: "structured-element",
          tag: "details",
          open: value.collapsed !== true,
          content: [
            {
              type: "structured-element",
              tag: "summary",
              content: [textNode(value.title || "Details")],
            },
            ...referenceNode(value.content, depth + 1),
          ],
        };
      case "table":
        return {
          type: "structured-element",
          tag: "table",
          content: (Array.isArray(value.rows) ? value.rows : []).map((row) => ({
            type: "structured-element",
            tag: "tr",
            content: (Array.isArray(row) ? row : [row]).map((cell) => ({
              type: "structured-element",
              tag: "td",
              content: [textNode(cell)],
            })),
          })),
        };
      case "list":
        return {
          type: "structured-element",
          tag: "ul",
          content: (Array.isArray(value.rows) ? value.rows : []).map((row) => ({
            type: "structured-element",
            tag: "li",
            content: [textNode(Array.isArray(row) ? row.join(" · ") : row)],
          })),
        };
      case "non-lemma-list":
        return {
          type: "structured-element",
          tag: "ul",
          data: { content: "glossary" },
          content: (Array.isArray(value.rows) ? value.rows : []).map((row) => ({
            type: "structured-element",
            tag: "li",
            content: [
              textNode(
                `${row?.label || "Definition"}: ${row?.lemma ? `${row.lemma} — ` : ""}${row?.text || ""}`,
              ),
            ],
          })),
        };
      case "example":
        return {
          type: "structured-element",
          tag: "div",
          data: { content: "example-sentence" },
          content: [
            {
              type: "structured-element",
              tag: "span",
              data: { content: "example-sentence-a" },
              content,
            },
          ],
        };
      case "note":
        return {
          type: "structured-element",
          tag: "div",
          className: "extra-box",
          data: { content: "sense-note" },
          content: [
            {
              type: "structured-element",
              tag: "span",
              data: { content: "sense-note-label" },
              content: [textNode("Note")],
            },
            {
              type: "structured-element",
              tag: "span",
              data: { content: "sense-note-content" },
              content,
            },
          ],
        };
      case "audio":
        return {
          type: "structured-element",
          tag: "span",
          className: "dict-inline-audio",
          data: { content: "audio", url: String(value.url || "") },
          content: [textNode(value.name || value.text || "Audio")],
        };
      default:
        return {
          type: "structured-element",
          tag: "div",
          content,
        };
    }
  }

  function referencePitch(value) {
    if (!value || typeof value !== "object") return value;
    return {
      ...value,
      dict: String(value.dict || value.dictionary || value.dictName || ""),
    };
  }

  function referenceResult(result, language) {
    const source = result && typeof result === "object" ? result : {};
    const entries = Array.isArray(source.results)
      ? source.results
      : Array.isArray(source.entries)
        ? source.entries
        : [];
    return {
      ...source,
      language: String(source.language || language || "ja"),
      text: String(source.text || source.lookupString || ""),
      lookupText: String(source.lookupText || source.lookupString || ""),
      results: entries.map((entry, index) => {
        const value = entry && typeof entry === "object" ? entry : {};
        const sourceTerm =
          value.term && typeof value.term === "object" ? value.term : {};
        const expression = String(
          value.headword ||
            value.expression ||
            sourceTerm.expression ||
            value.matched ||
            "",
        );
        const reading = String(value.reading || sourceTerm.reading || "");
        const glossaries = Array.isArray(value.glossaries)
          ? value.glossaries
          : Array.isArray(sourceTerm.glossaries)
            ? sourceTerm.glossaries
            : [];
        const frequencies = Array.isArray(value.frequencies || sourceTerm.frequencies)
          ? (value.frequencies || sourceTerm.frequencies).map((row) => ({
              ...row,
              dict: String(row?.dict || row?.dictionary || row?.dictName || ""),
              frequencies: Array.isArray(row?.frequencies) ? row.frequencies : [row],
            }))
          : [];
        return {
          ...value,
          id: String(value.id || `entry-${index}`),
          matched: String(value.matched || expression),
          deinflected: String(value.deinflected || ""),
          term: {
            ...sourceTerm,
            expression,
            reading,
            frequencies,
            pitches: (value.pitches || value.pitch || sourceTerm.pitches || []).map(
              referencePitch,
            ),
            glossaries: glossaries.map((glossary) => ({
              ...glossary,
              dict: String(glossary?.dict || glossary?.dictionary || ""),
              glossary: JSON.stringify(
                referenceNode(glossary?.content ?? glossary?.glossary ?? ""),
              ),
            })),
          },
        };
      }),
    };
  }

  function postMessage(typeOrName, rawPayload) {
    const type =
      typeof typeOrName === "string" ? typeOrName : String(typeOrName?.type || "");
    const payload =
      rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
        ? rawPayload
        : typeof typeOrName === "object" && typeOrName
          ? typeOrName
          : {};
    if (!type) return false;

    if (type === "ready") return send("ready", { surface: "popup" });
    if (type === "nested-lookup") {
      const lookupText = String(payload.text || "");
      const position = Math.max(0, Number(payload.position) || 0);
      const hostPayload = {
        ...payload,
        utf16Start:
          Number.isInteger(payload.utf16Start) && payload.utf16Start >= 0
            ? payload.utf16Start
            : Array.from(lookupText).slice(0, position).join("").length,
      };
      nestedRequests.set(String(hostPayload.requestId || ""), {
        lineId: Number(hostPayload.lineId || 0),
        position,
      });
      return send(type, hostPayload);
    }
    if (type === "nested-lookup-cancel") {
      nestedRequests.delete(String(payload.requestId || ""));
      return send(type, payload);
    }
    if (type === "audio-source") return send("audio-source", payload);
    if (type === "open-url" || type === "open-external-url")
      return send("external-link", { url: payload.url || "" });
    if (type === "audio-anki-selection") return send(type, payload);
    if (type === "popup-action") return send(type, payload);

    if (type === "anki-card-status") {
      queueMicrotask(() =>
        dispatch("anki-card-state", {
          requestId: payload.requestId,
          popupSessionId: payload.popupSessionId,
          ack: true,
        }),
      );
      setTimeout(
        () =>
          dispatch("anki-card-state", {
            requestId: payload.requestId,
            popupSessionId: payload.popupSessionId,
            ok: true,
            state: "ready",
          }),
        0,
      );
      return true;
    }
    if (type === "anki-card-add" || type === "anki-card-open") {
      const entryId = String(payload.context?.entry?.id || "");
      if (!entryId) return false;
      ankiRequests.set(String(payload.requestId || ""), entryId);
      const selection = payload.context?.wordAudioSelection;
      if (selection?.sourceUrl) {
        send("audio-anki-selection", {
          url: selection.sourceUrl,
          name: selection.sourceUrl,
          candidateIndex: selection.candidateIndex,
        });
      }
      return send("anki-action", {
        action:
          type === "anki-card-open"
            ? "open"
            : payload.forceDuplicate
              ? "add-anyway"
              : "add-note",
        entryId,
      });
    }

    if (type === "controller-toggle-pause")
      return send("player-command", { command: "toggle-pause" });
    if (type === "controller-resume-playback")
      return send("player-command", { command: "resume-playback" });
    if (type === "controller-video-seek")
      return send("player-command", {
        command: "seek",
        args: [String(payload.seconds || 0)],
      });
    if (type === "controller-mpv-command")
      return send("player-command", {
        command: String(payload.command || ""),
        args: Array.isArray(payload.args) ? payload.args : [],
      });
    if (type === "controller-subtitle-seek")
      return send("player-command", {
        command: Number(payload.direction) < 0 ? "subtitle-prev" : "subtitle-next",
      });

    // The mpv controller owns root lookup and popup visibility. These messages
    // are acknowledged so the copied renderer does not retry the IINA path.
    if (
      type === "popup" ||
      type === "lookup-popup-visibility" ||
      type === "lookup-popup-visible" ||
      type === "lookup" ||
      type === "line-lookup" ||
      type === "overlay-log" ||
      type === "native-layout-diagnostic" ||
      type === "native-layout-performance" ||
      type === "native-layout-invalidated" ||
      type === "controller-status" ||
      type === "controller-input"
    )
      return true;
    return false;
  }

  const adapter = Object.freeze({ onMessage, postMessage, dispatch });
  window.__IINATAN_IINA_ADAPTER__ = adapter;
  window.iina = adapter;

  host.onEvent((message) => {
    if (!message || message.protocol !== 1) return;
    if (Number.isInteger(message.geometryGeneration)) {
      if (message.geometryGeneration < latestGeometryGeneration) return;
      latestGeometryGeneration = message.geometryGeneration;
    }
    const payload =
      message.payload && typeof message.payload === "object" ? message.payload : {};
    if (message.type === "popup-state") {
      dispatch("popup-state", {
        ...payload,
        result: referenceResult(payload.result, payload.lookupLanguage),
      });
      return;
    }
    if (message.type === "nested-lookup-result") {
      const requestId = String(payload.requestId || "");
      const request = nestedRequests.get(requestId);
      nestedRequests.delete(requestId);
      dispatch("nested-lookup-result", {
        ...payload,
        lineId: request?.lineId || payload.lineId || 0,
        position: payload.position ?? request?.position,
        result: referenceResult(payload.result, payload.lookupLanguage),
      });
      return;
    }
    if (message.type === "audio-result") {
      dispatch("audio-source-result", {
        ...payload,
        requestId: payload.requestId || message.requestId,
        ok: payload.error ? false : true,
        candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
      });
      return;
    }
    if (message.type === "anki-result") {
      const entryId = String(payload.entryId || "");
      const matching = [...ankiRequests.entries()].filter(
        ([, value]) => value === entryId,
      );
      matching.forEach(([requestId]) => {
        ankiRequests.delete(requestId);
        dispatch("anki-card-state", {
          ...payload,
          requestId,
          duplicate: payload.state === "duplicate",
          message: payload.message || payload.error || "",
        });
      });
      return;
    }
    if (message.type === "popup-error") {
      dispatch("mpv-popup-error", payload);
      return;
    }
    dispatch(message.type, payload);
  });
})();
