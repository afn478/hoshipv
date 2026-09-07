"use strict";

(() => {
  const host = window.iinatanHost;
  const root = document.getElementById("root");
  const highlightLayer = document.getElementById("highlight-layer");
  const popup = document.getElementById("popup-panel");
  const content = document.getElementById("popup-content");
  const headword = document.getElementById("popup-headword");
  const reading = document.getElementById("popup-reading");
  const popupHeader = document.getElementById("popup-header");
  const popupBack = document.getElementById("popup-back");
  const surface =
    new URLSearchParams(window.location.search).get("surface") || "highlight";
  root.dataset.surface = surface;
  let generation = 0;
  let popupState = null;
  let currentResult = null;
  let ankiState = { enabled: false, configured: false };
  let customStyle = null;
  let audioElement = null;
  let audioSources = [];
  let audioAutoPlay = false;
  let audioSelectionIndex = 0;
  let activeAudioRequestId = "";
  let nestedPopupMode = "off";
  let nestedDepth = 0;
  let nestedHoverTimer = null;
  let nestedHoverKey = "";
  let selectionPointerId = null;
  let hostCapabilities = null;
  let lastPopupSize = null;
  const lastPopupRegions = new Map();
  let gamepadPollingStarted = false;
  let stopGamepadPolling = null;

  function isTextSelectionTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return !target.closest(
      'button, a, input, select, textarea, summary, [contenteditable="true"]',
    );
  }

  function focusTarget(element) {
    if (!element || !popup.contains(element)) return "";
    if (element === popup) return "popup-panel";
    const tag = String(element.tagName || "element").toLowerCase();
    const action = element.dataset?.action || element.id || "focusable";
    return `${tag}:${String(action).slice(0, 120)}`;
  }

  function reportFocus() {
    const target = focusTarget(document.activeElement);
    if (target) host.send("popup-action", { action: "focus-changed", target });
  }

  function setPointerCapture(pointerId) {
    try {
      popup.setPointerCapture?.(pointerId);
    } catch (_) {
      // Synthetic browser tests can dispatch a pointer without an active OS
      // pointer. Native pointer events still take the normal capture path.
    }
  }

  function releasePointerCapture(pointerId) {
    try {
      popup.releasePointerCapture?.(pointerId);
    } catch (_) {
      // Release is best effort for the same synthetic-event case.
    }
  }

  function finishSelection(action, pointerId) {
    const activePointerId = selectionPointerId;
    if (
      activePointerId === null ||
      (pointerId !== undefined && pointerId !== null && pointerId !== activePointerId)
    )
      return false;
    releasePointerCapture(activePointerId);
    host.send("popup-action", { action, pointerId: activePointerId });
    selectionPointerId = null;
    return true;
  }

  function stopAudioPlayback() {
    const active = audioElement;
    audioElement = null;
    if (!active) return;
    active.pause?.();
    active.removeAttribute?.("src");
    active.load?.();
  }

  function clearNestedHoverTimer() {
    if (nestedHoverTimer) clearTimeout(nestedHoverTimer);
    nestedHoverTimer = null;
    nestedHoverKey = "";
  }

  function updateNestedNavigation() {
    const visible = nestedDepth > 0;
    popupBack.hidden = !visible;
    popupBack.setAttribute("aria-hidden", String(!visible));
    popupBack.disabled = !visible;
    popup.setAttribute("data-nested-depth", String(nestedDepth));
    popup.setAttribute("data-nested-mode", nestedPopupMode);
  }

  function scheduleNestedHover(target, event) {
    const mode = nestedPopupMode;
    if (mode !== "hover" && mode !== "shift-hover") {
      clearNestedHoverTimer();
      return;
    }
    if (mode === "shift-hover" && event.shiftKey !== true) {
      clearNestedHoverTimer();
      return;
    }
    const link = target?.closest?.('.nested-link[data-action="nested-lookup"]');
    if (!link || !popup.contains(link) || !link.dataset.term) {
      clearNestedHoverTimer();
      return;
    }
    const key = `${nestedDepth}:${link.dataset.term}`;
    if (key === nestedHoverKey) return;
    clearNestedHoverTimer();
    nestedHoverKey = key;
    nestedHoverTimer = setTimeout(() => {
      nestedHoverTimer = null;
      if (
        popupState?.visible &&
        nestedHoverKey === key &&
        (nestedPopupMode === "hover" ||
          (nestedPopupMode === "shift-hover" && event.shiftKey === true))
      )
        host.send("nested-lookup", { term: link.dataset.term });
    }, 180);
  }

  function startGamepadPolling() {
    if (
      gamepadPollingStarted ||
      surface !== "highlight" ||
      typeof navigator.getGamepads !== "function" ||
      hostCapabilities?.controller?.source === "native-hid"
    )
      return;
    gamepadPollingStarted = true;
    let lastConnection = null;
    const publish = (gamepad) => {
      const connected = !!gamepad;
      if (!connected && lastConnection === false) return;
      lastConnection = connected;
      host.send("controller-state", {
        connected,
        id: gamepad?.id || "",
        index: Number.isInteger(gamepad?.index) ? gamepad.index : 0,
        buttons: gamepad
          ? gamepad.buttons.slice(0, 32).map((button) => ({
              pressed: !!button.pressed,
              value: Number(button.value) || 0,
            }))
          : [],
        axes: gamepad ? gamepad.axes.slice(0, 8).map((axis) => Number(axis) || 0) : [],
      });
    };
    const poll = () => {
      let pads = [];
      try {
        pads = [...(navigator.getGamepads() || [])].filter(Boolean);
      } catch (_) {
        publish(null);
        return;
      }
      publish(pads.find((value) => value.connected) || null);
    };
    const onConnected = (event) =>
      publish(event.gamepad?.connected ? event.gamepad : null);
    const onDisconnected = () => publish(null);
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);
    const timer = setInterval(poll, 50);
    window.addEventListener(
      "pagehide",
      () => {
        stopGamepadPolling?.();
      },
      { once: true },
    );
    poll();
    stopGamepadPolling = () => {
      clearInterval(timer);
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      gamepadPollingStarted = false;
      stopGamepadPolling = null;
    };
  }

  function safeCss(value) {
    const css = String(value || "").trim();
    if (
      css.length > 200000 ||
      /@import\b|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:/i.test(
        css,
      )
    )
      return "";
    if (!css) return "";
    // Preserve the reference application's selector-based custom CSS while
    // retaining compatibility with the original declaration-only setting.
    // The popup document is a dedicated surface, so a full stylesheet cannot
    // reach the player; remap the reference selector to this document's id.
    if (/[{}]/u.test(css))
      return css.replace(/#popup(?![-_a-zA-Z0-9])/gu, "#popup-panel");
    return `#popup-panel { ${css} }`;
  }

  function text(value) {
    return document.createTextNode(String(value ?? ""));
  }

  const structuredTags = new Set([
    "a",
    "br",
    "details",
    "div",
    "img",
    "li",
    "ol",
    "p",
    "rp",
    "rt",
    "ruby",
    "span",
    "strong",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
  ]);
  const structuredStyleProperties = new Set([
    "background",
    "backgroundColor",
    "borderColor",
    "borderRadius",
    "borderStyle",
    "borderWidth",
    "color",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "margin",
    "marginBottom",
    "marginLeft",
    "marginRight",
    "marginTop",
    "padding",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "textAlign",
    "textDecorationColor",
    "textDecorationLine",
    "textDecorationStyle",
    "textEmphasis",
    "textShadow",
    "verticalAlign",
    "whiteSpace",
    "wordBreak",
  ]);

  function appendStructuredContent(element, children) {
    for (const child of Array.isArray(children) ? children : []) {
      const rendered = node(child);
      if (rendered) element.append(rendered);
    }
  }

  function structuredText(value, depth = 0) {
    if (depth > 24 || value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value))
      return value.map((item) => structuredText(item, depth + 1)).join(" ");
    if (typeof value !== "object") return "";
    if (value.type === "text") return String(value.text || "");
    if (value.type === "structured-content" || value.type === "structured-element")
      return structuredText(value.content, depth + 1);
    return String(value.text || "");
  }

  function structuredDetailsSummary(value) {
    const summary = (Array.isArray(value.content) ? value.content : []).find(
      (item) => item && item.type === "structured-element" && item.tag === "summary",
    );
    return structuredText(summary?.content).replace(/\s+/g, " ").trim();
  }

  function isGrammarDetails(value) {
    if (!value || value.tag !== "details") return false;
    const marker = Object.values(value.data || {}).join(" ");
    return (
      /details-entry-grammar/i.test(marker) ||
      /^grammar\b/i.test(structuredDetailsSummary(value))
    );
  }

  function structuredDetailsBody(value) {
    return (Array.isArray(value.content) ? value.content : []).filter(
      (item) => !(item && item.type === "structured-element" && item.tag === "summary"),
    );
  }

  function structuredElement(value) {
    if (value.type === "structured-content") {
      const rootElement = document.createElement("div");
      rootElement.className = "structured-content";
      appendStructuredContent(rootElement, value.content);
      return rootElement;
    }
    const tag = String(value.tag || "").toLowerCase();
    if (!structuredTags.has(tag)) return text("");
    if (isGrammarDetails(value)) {
      const row = document.createElement("div");
      row.className = "grammar-row";
      const label = document.createElement("strong");
      label.textContent = "Grammar";
      const body = document.createElement("span");
      body.className = "grammar-body";
      appendStructuredContent(body, structuredDetailsBody(value));
      row.append(label, text(": "), body);
      return row;
    }
    const element = document.createElement(tag);
    if (tag === "details") element.open = value.open === true;
    if (value.className) element.className = String(value.className);
    if (value.title) element.title = String(value.title);
    for (const [key, raw] of Object.entries(value.data || {})) {
      if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key))
        element.setAttribute(`data-${key}`, String(raw).slice(0, 2000));
    }
    for (const [property, raw] of Object.entries(value.style || {})) {
      if (!structuredStyleProperties.has(property)) continue;
      const styleValue = String(raw || "").slice(0, 500);
      if (
        !styleValue ||
        /[<>"']|url\s*\(|expression\s*\(|javascript\s*:/i.test(styleValue)
      )
        continue;
      element.style[property] = styleValue;
    }
    if (tag === "a" && /^https:\/\/[^\s<>"']+$/i.test(String(value.href || "")))
      element.dataset.href = String(value.href);
    if (tag === "img") {
      if (/^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(String(value.src || "")))
        element.src = String(value.src);
      element.alt = String(value.alt || "");
      return element;
    }
    if (tag !== "br") appendStructuredContent(element, value.content);
    return element;
  }

  function node(value) {
    if (typeof value === "string" || typeof value === "number") return text(value);
    if (!value || typeof value !== "object") return document.createTextNode("");
    const type = String(value.type || "paragraph");
    if (
      type === "text" ||
      type === "structured-content" ||
      type === "structured-element"
    )
      return type === "text" ? text(value.text) : structuredElement(value);
    if (type === "link") {
      const link = document.createElement("a");
      link.className = "source-link";
      link.textContent = value.text || value.href || "source";
      link.dataset.href = /^https:\/\/[^\s<>"']+$/i.test(String(value.href || ""))
        ? value.href
        : "";
      return link;
    }
    if (type === "cross-reference") {
      const lookup = document.createElement("button");
      lookup.type = "button";
      lookup.className = "nested-link";
      lookup.textContent = value.text || value.lookup || "lookup";
      lookup.dataset.action = "nested-lookup";
      lookup.dataset.term = String(value.lookup || value.text || "");
      return lookup;
    }
    if (type === "audio") {
      const audio = document.createElement("button");
      audio.type = "button";
      audio.className = "dictionary-audio";
      audio.textContent = value.name || value.text || "▶ audio";
      audio.dataset.action = "dictionary-audio";
      audio.dataset.audioUrl = String(value.url || "");
      return audio;
    }
    if (type === "non-lemma-list") {
      const list = document.createElement("div");
      list.className = "nonlemma-list";
      for (const rowValue of Array.isArray(value.rows) ? value.rows : []) {
        const row = document.createElement("div");
        row.className = "nonlemma-row";
        const label = document.createElement("strong");
        label.textContent = String(rowValue?.label || "Definition");
        row.append(label, text(": "));
        if (rowValue?.lemma) {
          const lemma = document.createElement("span");
          lemma.className = "nonlemma-lemma";
          lemma.textContent = String(rowValue.lemma);
          row.append(lemma, text(" — "));
        }
        const description = document.createElement("span");
        description.className = "nonlemma-description";
        description.textContent = String(rowValue?.text || "");
        row.append(description);
        list.append(row);
      }
      return list;
    }
    if (type === "section") {
      const details = document.createElement("details");
      details.className = "details";
      details.open = value.collapsed !== true;
      const summary = document.createElement("summary");
      summary.textContent = value.title || "Details";
      const body = document.createElement("div");
      body.className = "details-body";
      for (const child of Array.isArray(value.content) ? value.content : [])
        body.append(node(child));
      details.append(summary, body);
      return details;
    }
    if (type === "furigana") {
      const ruby = document.createElement("ruby");
      ruby.append(text(value.text || ""));
      if (value.reading) {
        const annotation = document.createElement("rt");
        annotation.append(text(value.reading));
        ruby.append(annotation);
      }
      return ruby;
    }
    if (type === "table") {
      const table = document.createElement("table");
      table.className = "glossary-table";
      for (const row of Array.isArray(value.rows) ? value.rows : []) {
        const tr = document.createElement("tr");
        for (const cell of Array.isArray(row) ? row : [row]) {
          const td = document.createElement("td");
          td.append(text(cell));
          tr.append(td);
        }
        table.append(tr);
      }
      return table;
    }
    if (type === "list") {
      const list = document.createElement("ul");
      list.className = "glossary-list";
      for (const row of Array.isArray(value.rows) ? value.rows : []) {
        const item = document.createElement("li");
        item.textContent = Array.isArray(row) ? row.join(" · ") : row;
        list.append(item);
      }
      return list;
    }
    const element = document.createElement("div");
    element.className = type;
    element.append(text(value.text || ""));
    return element;
  }

  function pitchLabels(entry) {
    const rows = Array.isArray(entry?.pitches)
      ? entry.pitches
      : Array.isArray(entry?.pitch)
        ? entry.pitch
        : [];
    return rows
      .map((row) => {
        if (Array.isArray(row)) return row.map(String).join(", ");
        if (!row || typeof row !== "object") return String(row || "");
        const dictionary = String(
          row.dictionary || row.dict || row.dictName || "",
        ).trim();
        const positions = Array.isArray(row.positions)
          ? row.positions
          : Array.isArray(row.pitchPositions)
            ? row.pitchPositions
            : row.position === undefined
              ? []
              : [row.position];
        const transcriptions = Array.isArray(row.transcriptions)
          ? row.transcriptions
          : [];
        const pattern = String(
          row.pattern || row.displayValue || row.label || "",
        ).trim();
        return [
          dictionary,
          positions.length ? `positions ${positions.map(String).join(", ")}` : "",
          ...transcriptions.map(String),
          pattern,
        ]
          .map((value) => value.trim())
          .filter(Boolean)
          .join(" · ");
      })
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 64);
  }

  function renderResult(result) {
    const safe = result && typeof result === "object" ? result : {};
    const entries = Array.isArray(safe.entries) ? safe.entries : [];
    headword.textContent =
      entries[0]?.headword || safe.matched || safe.lookupString || "Lookup";
    reading.textContent = entries[0]?.reading || "";
    content.replaceChildren();
    entries.forEach((entry) => {
      const block = document.createElement("article");
      block.className = "entry";
      block.dataset.entryId = String(entry.id || "");
      if (entry.headword || entry.reading || entry.partOfSpeech) {
        const term = document.createElement("div");
        term.className = "entry-heading";
        if (entry.headword) {
          const entryHeadword = document.createElement("strong");
          entryHeadword.className = "entry-headword";
          entryHeadword.textContent = String(entry.headword);
          term.append(entryHeadword);
        }
        if (entry.reading) {
          const entryReading = document.createElement("span");
          entryReading.className = "entry-reading";
          entryReading.textContent = String(entry.reading);
          term.append(entryReading);
        }
        if (entry.partOfSpeech) {
          const entryPartOfSpeech = document.createElement("span");
          entryPartOfSpeech.className = "entry-part-of-speech";
          entryPartOfSpeech.textContent = String(entry.partOfSpeech);
          term.append(entryPartOfSpeech);
        }
        block.append(term);
      }
      const meta = document.createElement("div");
      meta.className = "entry-meta";
      for (const tag of [...(entry.tags || []), ...(entry.frequency || [])]) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = tag;
        meta.append(chip);
      }
      block.append(meta);
      const pitchValues = pitchLabels(entry);
      if (pitchValues.length) {
        const pitch = document.createElement("div");
        pitch.className = "entry-pitch";
        const label = document.createElement("span");
        label.className = "entry-pitch-label";
        label.textContent = "Pitch";
        pitch.append(label);
        for (const value of pitchValues) {
          const chip = document.createElement("span");
          chip.className = "chip pitch-chip";
          chip.textContent = value;
          pitch.append(chip);
        }
        block.append(pitch);
      }
      for (const glossary of entry.glossaries || []) {
        const section = document.createElement("section");
        section.className = "glossary";
        section.dataset.dictionary = String(glossary.dictionary || "").slice(0, 300);
        section.dataset.dictionaryType = String(glossary.sourceKind || "generic").slice(
          0,
          64,
        );
        const glossaryMeta = document.createElement("div");
        glossaryMeta.className = "glossary-meta";
        glossaryMeta.textContent = [glossary.dictionary, ...(glossary.tags || [])]
          .filter(Boolean)
          .join(" · ");
        section.append(glossaryMeta);
        for (const item of glossary.content || []) section.append(node(item));
        block.append(section);
      }
      const audio = document.createElement("button");
      audio.type = "button";
      audio.className = "audio-button";
      audio.textContent = "▶ audio";
      audio.dataset.action = "audio-source";
      audio.dataset.term = String(entry.headword || "");
      audio.dataset.reading = String(entry.reading || "");
      if (ankiState.enabled) {
        const anki = document.createElement("button");
        anki.type = "button";
        anki.className = "anki-button";
        anki.textContent = ankiState.configured ? "＋ Anki" : "Anki setup";
        anki.disabled = !ankiState.configured;
        anki.title = ankiState.configured
          ? "Add this entry to Anki"
          : "Configure Anki in settings";
        anki.dataset.action = "anki-add";
        anki.dataset.entryId = String(entry.id || "");
        const openAnki = document.createElement("button");
        openAnki.type = "button";
        openAnki.className = "anki-button anki-open";
        openAnki.textContent = "Open existing";
        openAnki.hidden = true;
        openAnki.dataset.action = "anki-open";
        openAnki.dataset.entryId = String(entry.id || "");
        const actions = document.createElement("span");
        actions.className = "entry-actions";
        actions.append(audio, anki, openAnki);
        block.prepend(actions);
        const status = document.createElement("span");
        status.className = "anki-status";
        status.dataset.entryId = String(entry.id || "");
        status.setAttribute("aria-live", "polite");
        block.append(status);
      } else {
        block.prepend(audio);
      }
      content.append(block);
    });
  }

  function renderHighlights(rects) {
    highlightLayer.replaceChildren();
    for (const value of Array.isArray(rects) ? rects : []) {
      const highlight = document.createElement("div");
      highlight.className = "highlight";
      highlight.style.left = `${Number(value.x) || 0}px`;
      highlight.style.top = `${Number(value.y) || 0}px`;
      highlight.style.width = `${Math.max(1, Number(value.width) || 1)}px`;
      highlight.style.height = `${Math.max(1, Number(value.height) || 1)}px`;
      highlightLayer.append(highlight);
    }
  }

  function updatePopupSize() {
    if (surface !== "popup" || popup.hidden) return;
    const bounds = popup.getBoundingClientRect();
    const scrollable = popup.scrollHeight > popup.clientHeight + 1;
    if (
      lastPopupSize &&
      Math.abs(lastPopupSize.width - bounds.width) <= 0.5 &&
      Math.abs(lastPopupSize.height - bounds.height) <= 0.5 &&
      lastPopupSize.scrollable === scrollable
    )
      return;
    lastPopupSize = { width: bounds.width, height: bounds.height, scrollable };
    host.send("popup-size", { width: bounds.width, height: bounds.height, scrollable });
  }

  function selectableTextBounds() {
    const walker = document.createTreeWalker(content, 4);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const textValue = textNode.nodeValue || "";
      const start = textValue.search(/\S/);
      if (
        start < 0 ||
        textNode.parentElement?.closest(
          'button, a, input, select, textarea, summary, [contenteditable="true"]',
        )
      )
        continue;
      const end = Math.min(textValue.length, start + 12);
      if (end <= start) continue;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const bounds = range.getClientRects()[0] || range.getBoundingClientRect();
      if (
        textValue.slice(start).trim().length >= 3 &&
        bounds.width >= 24 &&
        bounds.height > 0
      )
        return bounds;
    }
    for (const element of content.querySelectorAll(
      ".glossary-meta, .entry-meta, .entry-heading, .glossary",
    )) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 8 && bounds.height > 0) return bounds;
    }
    return null;
  }

  function updatePopupRegions() {
    if (surface !== "popup" || popup.hidden) return;
    const panelBounds = popup.getBoundingClientRect();
    const headerBounds = popupHeader.getBoundingClientRect();
    const selectableBounds = selectableTextBounds();
    const actionElements = [
      ["action-audio-source", '[data-action="audio-source"]'],
      ["action-audio-close", '[data-action="audio-close"]'],
      ["action-anki-add", '[data-action="anki-add"]'],
      ["action-anki-open", '[data-action="anki-open"]'],
    ].flatMap(([name, selector]) => {
      const element = content.querySelector(selector);
      return element && !element.hidden && !element.disabled ? [[name, element]] : [];
    });
    const elements = [
      ["panel", popup],
      ["headword", headword],
      ["content", content],
      ...(selectableBounds ? [["selection", selectableBounds]] : []),
      ...actionElements,
    ];
    for (const [name, element] of elements) {
      const bounds =
        typeof element.getBoundingClientRect === "function"
          ? element.getBoundingClientRect()
          : element;
      const clip =
        name === "content" || name === "selection" || name.startsWith("action-")
          ? {
              left: panelBounds.left,
              top: Math.max(panelBounds.top, headerBounds.bottom),
              right: panelBounds.right,
              bottom: panelBounds.bottom,
            }
          : null;
      const left = clip ? Math.max(bounds.left, clip.left) : bounds.left;
      const top = clip ? Math.max(bounds.top, clip.top) : bounds.top;
      const right = clip ? Math.min(bounds.right, clip.right) : bounds.right;
      const bottom = clip ? Math.min(bounds.bottom, clip.bottom) : bounds.bottom;
      if (right <= left || bottom <= top) continue;
      const next = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
      const previous = lastPopupRegions.get(name);
      if (
        previous &&
        ["x", "y", "width", "height"].every(
          (key) => Math.abs(previous[key] - next[key]) <= 0.5,
        )
      )
        continue;
      lastPopupRegions.set(name, next);
      host.send("popup-region", { name, ...next });
    }
  }

  function updatePopupMetrics() {
    updatePopupSize();
    updatePopupRegions();
  }

  function applyPopupLayout(payload) {
    if (!payload || popup.hidden) return;
    popup.style.left = `${Number(payload.position?.x) || 0}px`;
    popup.style.top = `${Number(payload.position?.y) || 0}px`;
    popup.style.width = payload.width ? `${Number(payload.width)}px` : "";
    popup.style.maxHeight = payload.maxHeight ? `${Number(payload.maxHeight)}px` : "";
  }

  function playAudioCandidate(candidate) {
    const url = String(candidate?.url || "");
    if (
      !/^https:\/\/[^\s<>"']+$/i.test(url) &&
      !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(url)
    )
      return;
    stopAudioPlayback();
    audioElement = new Audio(url);
    audioElement.play().catch(() => {});
  }

  function updateAudioSelection() {
    const buttons = [...document.querySelectorAll(".audio-candidate")];
    if (!buttons.length) return;
    audioSelectionIndex = Math.max(
      0,
      Math.min(audioSelectionIndex, buttons.length - 1),
    );
    buttons.forEach((button, index) => {
      const selected = index === audioSelectionIndex;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
  }

  function renderAudioCandidates(candidates, options = {}) {
    document.querySelector(".audio-menu")?.remove();
    const values = Array.isArray(candidates)
      ? candidates.filter((value) => value?.url)
      : [];
    audioSelectionIndex = 0;
    const menu = document.createElement("div");
    menu.className = "audio-menu";
    const label = document.createElement("span");
    label.textContent = options.loading
      ? "Resolving audio…"
      : values.length > 1
        ? "Audio sources"
        : "Audio";
    menu.append(label);
    if (options.error || !values.length) {
      const message = document.createElement("span");
      message.className = "audio-status";
      message.textContent = options.error || (options.loading ? "" : "No source found");
      menu.append(message);
    }
    values.forEach((candidate, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "audio-candidate";
      button.dataset.action = "audio-candidate";
      button.dataset.audioIndex = String(index);
      button.setAttribute("role", "option");
      button.textContent = candidate.name || `Source ${index + 1}`;
      menu.append(button);
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "audio-close";
    close.dataset.action = "audio-close";
    close.textContent = "×";
    close.title = "Close audio sources";
    menu.append(close);
    menu._candidates = values;
    content.prepend(menu);
    updateAudioSelection();
    requestAnimationFrame(updatePopupRegions);
    if (audioAutoPlay && values.length && !options.loading)
      playAudioCandidate(values[0]);
  }

  function moveAudioSelection(delta) {
    const menu = document.querySelector(".audio-menu");
    const candidates = menu?._candidates || [];
    if (!candidates.length) return;
    audioSelectionIndex =
      (audioSelectionIndex + delta + candidates.length) % candidates.length;
    updateAudioSelection();
  }

  function activateAudioSelection() {
    const menu = document.querySelector(".audio-menu");
    const candidates = menu?._candidates || [];
    if (candidates.length) playAudioCandidate(candidates[audioSelectionIndex]);
  }

  function applyTheme(value) {
    document.body.classList.toggle("custom-light", value === "light");
  }

  function applyCustomCss(value) {
    if (customStyle) customStyle.remove();
    const css = safeCss(value);
    if (!css) return;
    customStyle = document.createElement("style");
    customStyle.dataset.source = "user-custom-css";
    customStyle.textContent = css;
    document.head.append(customStyle);
  }

  host.onEvent((message) => {
    if (!message || message.protocol !== 1) return;
    if (
      message.geometryGeneration !== undefined &&
      message.geometryGeneration < generation
    )
      return;
    if (message.geometryGeneration !== undefined)
      generation = message.geometryGeneration;
    const payload = message.payload || {};
    if (message.type === "capabilities") {
      hostCapabilities = payload;
      root.dataset.inputMode = String(payload.inputMode || "unknown");
      if (payload.controller?.source === "native-hid") stopGamepadPolling?.();
      else startGamepadPolling();
      return;
    }
    if (surface === "highlight" && message.type === "geometry") {
      renderHighlights(payload.rects);
      return;
    }
    if (surface !== "popup") return;
    if (message.type === "controller-command") {
      if (payload.command === "scroll-up")
        popup.scrollBy({ top: -180, behavior: "smooth" });
      if (payload.command === "scroll-down")
        popup.scrollBy({ top: 180, behavior: "smooth" });
      if (payload.command === "audio-up" || payload.command === "audio-left")
        moveAudioSelection(-1);
      if (payload.command === "audio-down" || payload.command === "audio-right")
        moveAudioSelection(1);
      if (payload.command === "audio-activate") activateAudioSelection();
      if (payload.command === "close-audio-menu") {
        document.querySelector(".audio-menu")?.remove();
        stopAudioPlayback();
        activeAudioRequestId = "";
      }
      return;
    }
    if (message.type === "popup-state") {
      popupState = payload;
      currentResult = payload.result;
      clearNestedHoverTimer();
      stopAudioPlayback();
      activeAudioRequestId = "";
      nestedDepth = Math.max(0, Number(payload.nestedDepth) || 0);
      nestedPopupMode = ["click", "hover", "shift-hover"].includes(
        payload.nestedPopupMode,
      )
        ? payload.nestedPopupMode
        : "off";
      updateNestedNavigation();
      ankiState =
        payload.anki && typeof payload.anki === "object"
          ? {
              enabled: !!payload.anki.enabled,
              configured: !!payload.anki.configured,
            }
          : { enabled: false, configured: false };
      audioSources =
        Array.isArray(payload.audioSources) || typeof payload.audioSources === "string"
          ? payload.audioSources
          : [];
      audioAutoPlay = payload.audioAutoPlay === true;
      if (!payload.visible) finishSelection("selection-cancel");
      popup.hidden = !payload.visible;
      if (!payload.visible) {
        lastPopupSize = null;
        lastPopupRegions.clear();
        return;
      }
      lastPopupSize = null;
      lastPopupRegions.clear();
      popup.scrollTop = 0;
      popup.scrollLeft = 0;
      applyPopupLayout(payload);
      popup.style.setProperty(
        "--popup-min-width",
        `${Math.max(0, Number(payload.popupMinWidth) || 250)}px`,
      );
      popup.style.setProperty(
        "--popup-max-width",
        `${Math.max(0, Number(payload.popupMaxWidth) || 440)}px`,
      );
      popup.style.setProperty("--popup-scale", String(Number(payload.popupScale) || 1));
      popup.style.setProperty("--font-scale", String(Number(payload.fontScale) || 1));
      applyTheme(payload.theme);
      applyCustomCss(payload.customCss);
      renderResult(currentResult);
      popup.focus({ preventScroll: true });
      reportFocus();
      requestAnimationFrame(updatePopupMetrics);
      return;
    }
    if (message.type === "popup-layout") {
      applyPopupLayout(payload);
      requestAnimationFrame(updatePopupMetrics);
      return;
    }
    if (message.type === "popup-error") {
      popup.hidden = false;
      content.replaceChildren(text(payload.message || "Lookup failed"));
      requestAnimationFrame(updatePopupMetrics);
      return;
    }
    if (message.type === "audio-result") {
      if (message.requestId && message.requestId !== activeAudioRequestId) return;
      renderAudioCandidates(payload.candidates, {
        loading: payload.loading === true,
        error: payload.error,
      });
      return;
    }
    if (message.type === "anki-result") {
      const entryId = String(payload.entryId || "");
      const status = [...content.querySelectorAll(".anki-status")].find(
        (value) => value.dataset.entryId === entryId,
      );
      const button = [...content.querySelectorAll(".anki-button")].find(
        (value) =>
          value.dataset.entryId === entryId && value.dataset.action !== "anki-open",
      );
      const openButton = [...content.querySelectorAll(".anki-open")].find(
        (value) => value.dataset.entryId === entryId,
      );
      if (!status || !button) return;
      if (payload.state === "duplicate") {
        status.textContent = payload.message || "Already in Anki.";
        button.disabled = false;
        button.textContent = "Add anyway";
        button.dataset.action = "anki-add-anyway";
        if (openButton) openButton.hidden = false;
      } else if (payload.state === "opened") {
        status.textContent = "Opened in Anki.";
      } else if (payload.ok) {
        status.textContent = payload.warnings?.length
          ? `Added to Anki. ${payload.warnings.join(" ")}`
          : "Added to Anki.";
        button.disabled = true;
        button.textContent = "✓ Added";
        button.dataset.action = "anki-added";
        if (openButton) openButton.hidden = true;
      } else {
        status.textContent = payload.error || "Anki add failed.";
        button.disabled = false;
        button.textContent = "＋ Anki";
        button.dataset.action = "anki-add";
        if (openButton) openButton.hidden = true;
      }
    }
  });

  if (surface === "popup") {
    root.addEventListener("focusin", (event) => {
      const target = focusTarget(event.target);
      if (target) host.send("popup-action", { action: "focus-changed", target });
    });
    root.addEventListener("pointerdown", (event) => {
      if (!popup.contains(event.target)) {
        event.preventDefault();
        host.send("dismiss-popup", { reason: "outside-pointer-down" });
        return;
      }
      if (event.button === 0 && isTextSelectionTarget(event.target)) {
        popup.focus({ preventScroll: true });
        reportFocus();
        selectionPointerId = event.pointerId;
        setPointerCapture(event.pointerId);
        host.send("popup-action", {
          action: "selection-start",
          button: event.button,
          pointerId: event.pointerId,
        });
        return;
      }
      host.send("popup-action", { action: "pointer-down", button: event.button });
    });
    root.addEventListener("pointerup", (event) => {
      if (finishSelection("selection-end", event.pointerId)) return;
      if (popup.contains(event.target) || popupState?.visible) {
        host.send("popup-action", { action: "pointer-up", button: event.button });
      }
    });
    root.addEventListener("pointercancel", (event) => {
      if (
        !finishSelection("selection-cancel", event.pointerId) &&
        popupState?.visible
      ) {
        host.send("popup-action", { action: "pointer-up", button: event.button });
      }
    });
    root.addEventListener("lostpointercapture", (event) => {
      finishSelection("selection-cancel", event.pointerId);
    });
    root.addEventListener("pointermove", (event) => {
      scheduleNestedHover(event.target, event);
    });
    root.addEventListener("pointerleave", () => clearNestedHoverTimer());
    window.addEventListener("blur", () => finishSelection("selection-cancel"));
    root.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-action]");
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action.dataset.action === "audio-source") {
          activeAudioRequestId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          host.send("audio-source", {
            requestId: activeAudioRequestId,
            term: action.dataset.term || "",
            reading: action.dataset.reading || "",
            sources: audioSources,
          });
          return;
        }
        if (action.dataset.action === "dictionary-audio") {
          playAudioCandidate({ url: action.dataset.audioUrl || "" });
          return;
        }
        if (action.dataset.action === "audio-candidate") {
          const candidates = action.closest(".audio-menu")?._candidates || [];
          audioSelectionIndex = Number(action.dataset.audioIndex) || 0;
          updateAudioSelection();
          playAudioCandidate(candidates[audioSelectionIndex]);
          return;
        }
        if (action.dataset.action === "audio-close") {
          host.send("popup-action", { action: "close-audio-list" });
          stopAudioPlayback();
          activeAudioRequestId = "";
          return;
        }
        if (action.dataset.action === "back-nested") {
          host.send("dismiss-popup", { reason: "nested-back" });
          return;
        }
        if (
          action.dataset.action === "anki-add" ||
          action.dataset.action === "anki-add-anyway"
        ) {
          host.send("anki-action", {
            action:
              action.dataset.action === "anki-add-anyway" ? "add-anyway" : "add-note",
            entryId: action.dataset.entryId || "",
          });
          action.disabled = true;
          const status = [...content.querySelectorAll(".anki-status")].find(
            (value) => value.dataset.entryId === action.dataset.entryId,
          );
          if (status) status.textContent = "Checking Anki…";
          return;
        }
        if (action.dataset.action === "anki-open") {
          host.send("anki-action", {
            action: "open",
            entryId: action.dataset.entryId || "",
          });
          action.disabled = true;
          return;
        }
        if (action.dataset.action === "nested-lookup") {
          host.send("nested-lookup", { term: action.dataset.term || "" });
          return;
        }
        host.send("popup-action", { action: action.dataset.action });
        return;
      }
      const link = event.target.closest?.("[data-href]");
      if (link && link.dataset.href) {
        event.preventDefault();
        host.send("external-link", { url: link.dataset.href });
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        host.send("popup-action", { action: "escape" });
      }
    });
    document.addEventListener("selectionchange", () => {
      const selection = window.getSelection()?.toString() || "";
      host.send("popup-action", {
        action: "selection-changed",
        text: selection.slice(0, 20000),
      });
    });
    popup.addEventListener("scroll", () => {
      host.send("popup-scroll", {
        left: popup.scrollLeft,
        top: popup.scrollTop,
      });
      requestAnimationFrame(updatePopupRegions);
    });
    host.send("ready", { surface });
  } else {
    host.send("ready", { surface });
  }

  if (surface === "popup" && typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => updatePopupMetrics());
    observer.observe(popup);
  }

  if (surface === "highlight") {
    window.addEventListener("pointermove", (event) => {
      host.send("pointer-move", {
        altKey: !!event.altKey,
        ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey,
        shiftKey: !!event.shiftKey,
      });
    });
  }
  // The host sends capabilities immediately after the ready message. Keep a
  // bounded fallback for test hosts that do not negotiate capabilities.
  setTimeout(() => {
    if (!hostCapabilities) startGamepadPolling();
  }, 250);
})();
