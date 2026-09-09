"use strict";

(() => {
  const host = window.iinatanHost;
  const root = document.getElementById("root");
  const highlightLayer = document.getElementById("highlight-layer");
  const popup = document.getElementById("popup-panel");
  const content = document.getElementById("popup-content");
  const nestedPopupLayer = document.getElementById("nested-popup-layer");
  const headword = document.getElementById("popup-headword");
  const reading = document.getElementById("popup-reading");
  const popupHeader = document.getElementById("popup-header");
  const controllerHoldProgressEl = document.getElementById("controller-hold-progress");
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
  let audioSelectionRow = 0;
  let audioSelectionColumn = 0;
  let activeAudioRequestId = "";
  let selectionPointerId = null;
  let outsidePointerId = null;
  let hostCapabilities = null;
  let lastPopupSize = null;
  let lastPopupStyle = "";
  let controllerSelectedEntryIndex = -1;
  let nestedPopupMode = "off";
  let nestedPopupMaxDepth = 3;
  let nestedPopupSessionId = "";
  let nestedLookupSequence = 0;
  let nestedHoverTimer = null;
  let nestedHoverKey = "";
  const nestedPopups = [];
  const lastPopupRegions = new Map();
  let gamepadPollingStarted = false;
  let stopGamepadPolling = null;

  function isTextSelectionTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return !target.closest(
      'button, [data-href], input, select, textarea, summary, [data-action], .cross-reference, [contenteditable="true"]',
    );
  }

  function focusTarget(element) {
    if (!element || !isPopupTarget(element)) return "";
    if (element === popup) return "popup-panel";
    const nested = element.closest?.(".nested-popup");
    if (nested) return `nested-popup:${nested.dataset.nestedPopupId || "unknown"}`;
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

  function finishOutsidePointer(reason, pointerId) {
    const activePointerId = outsidePointerId;
    if (
      activePointerId === null ||
      (pointerId !== undefined && pointerId !== null && pointerId !== activePointerId)
    )
      return false;
    // Clear ownership before releasing capture: browsers may synchronously
    // deliver lostpointercapture while the capture is being released.
    outsidePointerId = null;
    releasePointerCapture(activePointerId);
    host.send("dismiss-popup", { reason });
    return true;
  }

  function cancelOutsidePointerCapture() {
    const activePointerId = outsidePointerId;
    if (activePointerId === null) return false;
    // A host-driven close owns the dismissal already. Release the renderer's
    // capture without sending a second dismiss request, and clear ownership
    // before release because lostpointercapture may be synchronous.
    outsidePointerId = null;
    releasePointerCapture(activePointerId);
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

  function updateControllerHoldProgress(progress, visible = true) {
    if (!controllerHoldProgressEl) return;
    controllerHoldProgressEl.classList.toggle("hidden", !visible);
    if (!visible) return;
    const fill = controllerHoldProgressEl.querySelector(".controller-hold-fill");
    if (fill)
      fill.style.strokeDashoffset = String(
        100.531 * (1 - Math.max(0, Math.min(1, Number(progress) || 0))),
      );
  }

  function startGamepadPolling() {
    if (
      gamepadPollingStarted ||
      surface !== "highlight" ||
      typeof navigator.getGamepads !== "function"
    )
      return;
    gamepadPollingStarted = true;
    let lastConnection = null;
    const publish = (gamepad, force = false) => {
      const connected = !!gamepad;
      if (!connected && lastConnection === false && !force) return;
      lastConnection = connected;
      host.send("controller-state", {
        source: "browser-gamepad",
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
    const publishNeutral = () => publish(null, true);
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
    const onBlur = () => publishNeutral();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") publishNeutral();
    };
    const onPageHide = () => {
      publishNeutral();
      stopGamepadPolling?.();
    };
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = setInterval(poll, 50);
    window.addEventListener("pagehide", onPageHide, { once: true });
    poll();
    stopGamepadPolling = () => {
      clearInterval(timer);
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
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
    const externalAnchor =
      tag === "a" && /^https:\/\/[^\s<>"']+$/i.test(String(value.href || ""));
    const plainTextAnchor = tag === "a" && !externalAnchor;
    const element = document.createElement(plainTextAnchor ? "span" : tag);
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
    if (externalAnchor) element.dataset.href = String(value.href);
    if (plainTextAnchor) element.dataset.nestedTextTarget = "1";
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
      const reference = document.createElement("span");
      reference.className = "cross-reference";
      reference.textContent = value.text || value.lookup || "reference";
      if (nestedPopupMode !== "off") {
        reference.dataset.action = "nested-lookup";
        reference.dataset.lookupText = String(
          value.lookup || value.text || "reference",
        ).slice(0, 4096);
        reference.setAttribute("role", "button");
        reference.setAttribute("tabindex", "0");
        reference.setAttribute("aria-label", `Look up ${reference.textContent}`);
      }
      return reference;
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

  function renderResultInto(result, targets = {}) {
    const safe = result && typeof result === "object" ? result : {};
    const entries = Array.isArray(safe.entries) ? safe.entries : [];
    const targetHeadword = targets.headword || headword;
    const targetReading = targets.reading || reading;
    const targetContent = targets.content || content;
    const includeActions = targets.includeActions !== false;
    targetHeadword.textContent =
      entries[0]?.headword || safe.matched || safe.lookupString || "Lookup";
    targetReading.textContent = entries[0]?.reading || "";
    targetContent.replaceChildren();
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
      if (includeActions) {
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
      }
      targetContent.append(block);
    });
  }

  function renderResult(result) {
    controllerSelectedEntryIndex = -1;
    renderResultInto(result);
  }

  const NESTED_HOVER_DELAY_MS = 180;
  const NESTED_LOOKUP_TIMEOUT_MS = 15000;
  const NESTED_BLOCK_SELECTORS = [
    ".paragraph",
    ".example",
    ".note",
    ".entry-heading",
    ".glossary-meta",
    ".grammar-body",
    ".nonlemma-row",
    ".details-body",
    "p",
    "li",
    "td",
  ].join(", ");
  const NESTED_IGNORED_SELECTOR =
    'button, [data-href], input, select, textarea, summary, [data-action], rt, svg, [contenteditable="true"]';

  function isPopupTarget(target) {
    return !!(
      target &&
      typeof target === "object" &&
      (popup.contains(target) || nestedPopupLayer.contains(target))
    );
  }

  function nestedPopupForElement(element) {
    const id = element?.closest?.(".nested-popup")?.dataset?.nestedPopupId;
    return id ? nestedPopups.find((value) => value.id === id) || null : null;
  }

  function nestedPopupOwner(element) {
    return nestedPopupForElement(element);
  }

  function nestedTextNodes(owner) {
    if (!owner) return [];
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (!current.nodeValue || current.parentElement?.closest(NESTED_IGNORED_SELECTOR))
        continue;
      nodes.push(current);
    }
    return nodes;
  }

  function nestedTextScope(target) {
    const owner = target?.closest?.(".nested-popup-content, #popup-content");
    if (!owner) return null;
    if (target.closest?.(NESTED_IGNORED_SELECTOR)) return null;
    const block = target.closest?.(NESTED_BLOCK_SELECTORS);
    return block && owner.contains(block) ? block : owner;
  }

  function nestedRangeAtPoint(event, owner, target) {
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    let range = null;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      try {
        if (typeof document.caretRangeFromPoint === "function")
          range = document.caretRangeFromPoint(x, y);
        else if (typeof document.caretPositionFromPoint === "function") {
          const position = document.caretPositionFromPoint(x, y);
          if (position) {
            range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
          }
        }
      } catch (_) {
        range = null;
      }
    }
    if (range && owner.contains(range.startContainer)) return range;
    const candidate =
      target?.nodeType === Node.TEXT_NODE
        ? target
        : nestedTextNodes(target)[0] ||
          nestedTextNodes(target?.closest?.(NESTED_BLOCK_SELECTORS) || owner)[0];
    if (!candidate) return null;
    range = document.createRange();
    range.setStart(candidate, 0);
    range.collapse(true);
    return range;
  }

  function nestedTextOffset(range, nodes, owner) {
    if (!range || !nodes.length) return 0;
    let offset = 0;
    for (const node of nodes) {
      if (node === range.startContainer)
        return offset + Math.max(0, Math.min(node.data.length, range.startOffset));
      offset += node.data.length;
    }
    try {
      const before = document.createRange();
      before.selectNodeContents(owner || nodes[0].parentElement || nodes[0]);
      before.setEnd(range.startContainer, range.startOffset);
      return Math.max(
        0,
        Math.min(
          nodes.reduce((sum, node) => sum + node.data.length, 0),
          before.toString().length,
        ),
      );
    } catch (_) {
      return 0;
    }
  }

  function nestedRectFromRange(range, fallback) {
    const rects = range ? [...range.getClientRects()] : [];
    const rect = rects[0] || range?.getBoundingClientRect?.() || fallback;
    if (!rect) return null;
    return {
      left: Number(rect.left) || 0,
      top: Number(rect.top) || 0,
      right: Number(rect.right) || Number(rect.left) || 0,
      bottom: Number(rect.bottom) || Number(rect.top) || 0,
      width: Math.max(0, Number(rect.width) || 0),
      height: Math.max(0, Number(rect.height) || 0),
    };
  }

  function nestedLookupSourceFromEvent(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return null;
    const plainTextTarget = target.closest('[data-nested-text-target="1"]');
    if (plainTextTarget) {
      const nodes = nestedTextNodes(plainTextTarget);
      const textValue = nodes
        .map((node) => node.data)
        .join("")
        .slice(0, 4096);
      const anchorRect = nestedTextTargetBounds(plainTextTarget);
      if (textValue.trim() && anchorRect) {
        const owner = nestedTextScope(plainTextTarget) || plainTextTarget;
        return {
          text: textValue,
          utf16Start: 0,
          anchorRect: nestedRectFromRange(null, anchorRect),
          explicit: false,
          target: plainTextTarget,
          owner,
          nodes,
          startNode: nodes[0],
          startOffset: 0,
          parent: nestedPopupOwner(plainTextTarget),
          key: `plain:${textValue}:${anchorRect.left}:${anchorRect.top}`,
        };
      }
    }
    const explicit = target.closest('[data-action="nested-lookup"]');
    if (explicit) {
      const rect = explicit.getBoundingClientRect();
      return {
        text: String(explicit.dataset.lookupText || explicit.textContent || "")
          .trim()
          .slice(0, 4096),
        utf16Start: 0,
        anchorRect: nestedRectFromRange(null, rect),
        explicit: true,
        target: explicit,
        owner: explicit.closest(".nested-popup-content, #popup-content"),
        key: `explicit:${explicit.dataset.lookupText || explicit.textContent}:${rect.left}:${rect.top}`,
      };
    }
    const owner = nestedTextScope(target);
    if (!owner) return null;
    const range = nestedRangeAtPoint(event, owner, target);
    const nodes = nestedTextNodes(owner);
    if (!range || !nodes.length) return null;
    const textValue = nodes
      .map((node) => node.data)
      .join("")
      .slice(0, 4096);
    if (!textValue.trim()) return null;
    const utf16Start = Math.max(
      0,
      Math.min(textValue.length, nestedTextOffset(range, nodes, owner)),
    );
    const fallback = target.getBoundingClientRect?.();
    const anchorRect = nestedRectFromRange(range, fallback);
    if (!anchorRect) return null;
    const parent = nestedPopupOwner(target);
    const startNode = nodes.includes(range.startContainer)
      ? range.startContainer
      : nodes.find((node) => range.startContainer.contains?.(node)) || nodes[0];
    return {
      text: textValue,
      utf16Start,
      anchorRect,
      explicit: false,
      target,
      owner,
      nodes,
      startNode,
      startOffset: startNode === range.startContainer ? range.startOffset : 0,
      parent,
      key: `${parent?.id || "root"}:${textValue}:${utf16Start}:${Math.round(anchorRect.left)}:${Math.round(anchorRect.top)}`,
    };
  }

  function nestedRangeForLength(source, length) {
    if (!source?.nodes?.length || !source.startNode || !Number.isFinite(length))
      return null;
    const startIndex = source.nodes.indexOf(source.startNode);
    if (startIndex < 0) return null;
    let remaining = Math.max(1, Math.min(4096, Math.round(length)));
    const range = document.createRange();
    range.setStart(
      source.startNode,
      Math.max(0, Math.min(source.startNode.data.length, source.startOffset)),
    );
    let node = source.startNode;
    let offset = Math.max(0, Math.min(node.data.length, source.startOffset));
    for (let index = startIndex; index < source.nodes.length; index++) {
      node = source.nodes[index];
      const available = Math.max(
        0,
        node.data.length - (index === startIndex ? offset : 0),
      );
      if (remaining <= available) {
        range.setEnd(node, (index === startIndex ? offset : 0) + remaining);
        return range;
      }
      remaining -= available;
    }
    const last = source.nodes.at(-1);
    range.setEnd(last, last.data.length);
    return range;
  }

  function removeNestedHighlight(record) {
    for (const element of record?.highlights || []) element.remove();
    if (record) record.highlights = [];
  }

  function renderNestedHighlight(record, result = null) {
    removeNestedHighlight(record);
    if (!record?.source) return;
    let range = null;
    if (!record.source.explicit) {
      const value = result?.lookupString || result?.matched || "";
      if (value) range = nestedRangeForLength(record.source, String(value).length);
    }
    const rects = range ? [...range.getClientRects()] : [record.source.anchorRect];
    record.highlights = rects
      .map((rect) => {
        if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
        const highlight = document.createElement("div");
        highlight.className = "nested-popup-highlight";
        highlight.style.left = `${Number(rect.left) || 0}px`;
        highlight.style.top = `${Number(rect.top) || 0}px`;
        highlight.style.width = `${Math.max(1, Number(rect.width) || 1)}px`;
        highlight.style.height = `${Math.max(1, Number(rect.height) || 1)}px`;
        nestedPopupLayer.append(highlight);
        return highlight;
      })
      .filter(Boolean);
  }

  function removeNestedPopup(record, sendCancel = true) {
    if (!record) return;
    clearTimeout(record.timer);
    record.timer = null;
    if (sendCancel && record.pending && record.requestId && record.popupSessionId)
      host.send("nested-lookup-cancel", {
        requestId: record.requestId,
        popupSessionId: record.popupSessionId,
        depth: record.depth,
      });
    if (record.popupSessionId)
      host.send("popup-action", {
        action: "nested-closed",
        depth: record.depth,
      });
    removeNestedHighlight(record);
    record.element.remove();
    const index = nestedPopups.indexOf(record);
    if (index >= 0) nestedPopups.splice(index, 1);
  }

  function clearNestedPopups(keepDepth = 0) {
    if (nestedHoverTimer) clearTimeout(nestedHoverTimer);
    nestedHoverTimer = null;
    nestedHoverKey = "";
    for (let index = nestedPopups.length - 1; index >= 0; index--) {
      if (nestedPopups[index].depth > keepDepth) removeNestedPopup(nestedPopups[index]);
    }
  }

  function nestedViewportBounds() {
    const bounds = root.getBoundingClientRect();
    return {
      left: Math.max(8, bounds.left),
      top: Math.max(8, bounds.top),
      right: Math.min(window.innerWidth - 8, bounds.right || window.innerWidth),
      bottom: Math.min(window.innerHeight - 8, bounds.bottom || window.innerHeight),
    };
  }

  function placeNestedPopup(record) {
    if (!record?.element || !record.source?.anchorRect) return;
    const element = record.element;
    const anchor = record.source.anchorRect;
    const viewport = nestedViewportBounds();
    element.style.visibility = "hidden";
    element.style.left = "0px";
    element.style.top = "0px";
    const measured = element.getBoundingClientRect();
    const width = Math.min(measured.width || 320, viewport.right - viewport.left);
    const height = Math.min(measured.height || 240, viewport.bottom - viewport.top);
    const gap = 10;
    const candidates = [
      { x: anchor.right + gap, y: anchor.top },
      { x: anchor.left - width - gap, y: anchor.top },
      { x: anchor.left, y: anchor.bottom + gap },
      { x: anchor.left, y: anchor.top - height - gap },
    ];
    const fits = candidates.find(
      (candidate) =>
        candidate.x >= viewport.left &&
        candidate.y >= viewport.top &&
        candidate.x + width <= viewport.right &&
        candidate.y + height <= viewport.bottom,
    );
    const chosen = fits || candidates[0];
    const x = Math.max(viewport.left, Math.min(viewport.right - width, chosen.x));
    const y = Math.max(viewport.top, Math.min(viewport.bottom - height, chosen.y));
    element.style.left = `${Math.round(x)}px`;
    element.style.top = `${Math.round(y)}px`;
    element.style.maxHeight = `${Math.max(120, Math.round(viewport.bottom - viewport.top))}px`;
    element.style.visibility = "visible";
  }

  function reflowNestedPopups() {
    for (const record of nestedPopups) {
      renderNestedHighlight(record, record.result);
      placeNestedPopup(record);
    }
  }

  function makeNestedPopup(record) {
    const element = document.createElement("article");
    element.className = "nested-popup lookup-pending";
    element.dataset.nestedPopupId = record.id;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", "Nested dictionary lookup");
    element.tabIndex = -1;
    const header = document.createElement("header");
    header.className = "nested-popup-header";
    const title = document.createElement("div");
    title.className = "nested-popup-headword";
    title.textContent = "Looking up…";
    const pronunciation = document.createElement("div");
    pronunciation.className = "nested-popup-reading";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "nested-popup-close";
    close.dataset.action = "nested-close";
    close.dataset.nestedPopupId = record.id;
    close.setAttribute("aria-label", "Close nested lookup");
    close.textContent = "×";
    header.append(title, pronunciation, close);
    const body = document.createElement("div");
    body.className = "nested-popup-content";
    body.textContent = "Looking up…";
    element.append(header, body);
    record.element = element;
    record.headword = title;
    record.reading = pronunciation;
    record.content = body;
    nestedPopupLayer.append(element);
  }

  function openNestedPopup(source) {
    if (nestedPopupMode === "off" || !nestedPopupSessionId || !source?.text)
      return false;
    const parent = source.parent || nestedPopupOwner(source.target);
    const parentDepth = parent?.depth || 0;
    const depth = parentDepth + 1;
    if (depth > nestedPopupMaxDepth) return false;
    clearNestedPopups(parentDepth);
    const sequence = ++nestedLookupSequence;
    const record = {
      id: `nested-popup-${nestedPopupSessionId}-${sequence}`.slice(0, 160),
      requestId: `nested-${nestedPopupSessionId}-${sequence}`.slice(0, 160),
      popupSessionId: nestedPopupSessionId,
      depth,
      parent,
      source,
      pending: true,
      result: null,
      timer: null,
      highlights: [],
      element: null,
    };
    nestedPopups.push(record);
    makeNestedPopup(record);
    renderNestedHighlight(record);
    placeNestedPopup(record);
    record.timer = setTimeout(() => {
      if (!record.pending || !nestedPopups.includes(record)) return;
      removeNestedPopup(record);
    }, NESTED_LOOKUP_TIMEOUT_MS);
    host.send("nested-lookup", {
      requestId: record.requestId,
      popupSessionId: nestedPopupSessionId,
      depth,
      text: source.text,
      utf16Start: Math.max(0, Math.min(4096, Number(source.utf16Start) || 0)),
    });
    return true;
  }

  function renderNestedResult(payload) {
    const requestId = String(payload.requestId || "");
    const record = nestedPopups.find(
      (value) =>
        value.requestId === requestId &&
        value.popupSessionId === nestedPopupSessionId &&
        value.depth === Number(payload.depth),
    );
    if (!record) return;
    clearTimeout(record.timer);
    record.timer = null;
    record.pending = false;
    record.element.classList.remove("lookup-pending");
    if (payload.ok === false) {
      record.headword.textContent = "Nested lookup failed";
      record.content.replaceChildren(text(payload.error || "Lookup failed"));
      renderNestedHighlight(record);
    } else {
      record.result = payload.result || {};
      renderResultInto(record.result, {
        headword: record.headword,
        reading: record.reading,
        content: record.content,
        includeActions: false,
      });
      renderNestedHighlight(record, record.result);
    }
    host.send("popup-action", {
      action: "nested-result",
      depth: record.depth,
      ok: payload.ok !== false,
      error:
        payload.ok === false
          ? String(payload.error || "Nested lookup failed").slice(0, 500)
          : "",
      text: String(record.source?.text || "").slice(0, 4096),
      explicit: record.source?.explicit === true,
      lookupString: String(
        record.result?.lookupString ||
          record.result?.matched ||
          record.headword.textContent ||
          "",
      ).slice(0, 4096),
    });
    placeNestedPopup(record);
    requestAnimationFrame(() => {
      reflowNestedPopups();
      updatePopupMetrics();
    });
  }

  function scheduleNestedHover(event) {
    if (!nestedPopupMode || nestedPopupMode === "off") return;
    if (nestedPopupMode === "shift-hover" && !event.shiftKey) {
      if (nestedHoverTimer) clearTimeout(nestedHoverTimer);
      nestedHoverTimer = null;
      nestedHoverKey = "";
      return;
    }
    const source = nestedLookupSourceFromEvent(event);
    if (!source?.text) {
      if (nestedHoverTimer) clearTimeout(nestedHoverTimer);
      nestedHoverTimer = null;
      nestedHoverKey = "";
      return;
    }
    if (source.key === nestedHoverKey) return;
    if (nestedHoverTimer) clearTimeout(nestedHoverTimer);
    nestedHoverKey = source.key;
    nestedHoverTimer = setTimeout(() => {
      nestedHoverTimer = null;
      if (nestedHoverKey !== source.key) return;
      openNestedPopup(source);
    }, NESTED_HOVER_DELAY_MS);
  }

  function controllerEntryElements() {
    return Array.from(content.querySelectorAll(".entry"));
  }

  function applyControllerEntrySelection(scrollIntoView = true) {
    const entries = controllerEntryElements();
    entries.forEach((entry) => entry.classList.remove("controller-selected-entry"));
    const index = controllerSelectedEntryIndex;
    if (index < 0 || index >= entries.length) return false;
    entries[index].classList.add("controller-selected-entry");
    if (scrollIntoView && typeof entries[index].scrollIntoView === "function")
      entries[index].scrollIntoView({ block: "nearest", inline: "nearest" });
    host.send("popup-action", {
      action: "controller-entry-selected",
      entryIndex: index,
    });
    return true;
  }

  function selectControllerEntry(index, scrollIntoView = true) {
    const entries = controllerEntryElements();
    if (!entries.length) {
      controllerSelectedEntryIndex = -1;
      return false;
    }
    controllerSelectedEntryIndex = Math.max(
      0,
      Math.min(entries.length - 1, Number(index) || 0),
    );
    return applyControllerEntrySelection(scrollIntoView);
  }

  function selectMostVisibleControllerEntry() {
    const entries = controllerEntryElements();
    if (!entries.length) return false;
    const viewport = popup.getBoundingClientRect();
    let bestIndex = 0;
    let bestArea = -1;
    entries.forEach((entry, index) => {
      const rect = entry.getBoundingClientRect();
      const width = Math.max(
        0,
        Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left),
      );
      const height = Math.max(
        0,
        Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top),
      );
      const area = width * height;
      if (area > bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    });
    return selectControllerEntry(bestIndex, false);
  }

  function moveControllerEntry(direction) {
    const entries = controllerEntryElements();
    if (!entries.length) return false;
    const current = Math.max(0, controllerSelectedEntryIndex);
    return selectControllerEntry(current + (direction === "left" ? -1 : 1));
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
    const contentBounds = content.getBoundingClientRect();
    const walker = document.createTreeWalker(content, 4);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const textValue = textNode.nodeValue || "";
      const start = textValue.search(/\S/);
      if (
        start < 0 ||
        textNode.parentElement?.closest(
          'button, [data-href], input, select, textarea, summary, [contenteditable="true"]',
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
        bounds.height > 0 &&
        bounds.bottom > contentBounds.top &&
        bounds.top < contentBounds.bottom
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

  function nestedTextTargetBounds(element) {
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (!textNode.nodeValue?.trim() || textNode.parentElement?.closest("rt"))
        continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const bounds = range.getClientRects()[0] || range.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) return bounds;
    }
    return element.getBoundingClientRect?.() || null;
  }

  function updatePopupRegions() {
    if (surface !== "popup" || popup.hidden) return;
    const rootPanelBounds = popup.getBoundingClientRect();
    const panelBounds = [
      rootPanelBounds,
      ...nestedPopups.map((record) => record.element?.getBoundingClientRect?.()),
    ]
      .filter(Boolean)
      .reduce((union, bounds) => {
        if (!union) return { ...bounds };
        const right = Math.max(union.right, bounds.right);
        const bottom = Math.max(union.bottom, bounds.bottom);
        return {
          left: Math.min(union.left, bounds.left),
          top: Math.min(union.top, bounds.top),
          right,
          bottom,
          width: right - Math.min(union.left, bounds.left),
          height: bottom - Math.min(union.top, bounds.top),
        };
      }, null);
    const headerBounds = popupHeader.getBoundingClientRect();
    const selectableBounds = selectableTextBounds();
    const actionElements = [
      ["action-audio-source", '[data-action="audio-source"]'],
      ["action-audio-close", '[data-action="audio-close"]'],
      ["action-anki-add", '[data-action="anki-add"]'],
      ["action-anki-open", '[data-action="anki-open"]'],
    ].flatMap(([name, selector, owner = content]) => {
      const element = owner.querySelector(selector);
      return element && !element.hidden && !element.disabled ? [[name, element]] : [];
    });
    const nestedRecord = nestedPopups.at(-1);
    const nestedReference = nestedRecord?.element?.querySelector(
      '.cross-reference[data-action="nested-lookup"]',
    );
    const nestedPlainTextTarget = nestedRecord?.element?.querySelector(
      '[data-nested-text-target="1"]',
    );
    if (nestedRecord?.element)
      actionElements.push(["nested-panel", nestedRecord.element]);
    const reference =
      nestedReference ||
      nestedPlainTextTarget ||
      content.querySelector('.cross-reference[data-action="nested-lookup"]') ||
      content.querySelector('[data-nested-text-target="1"]');
    if (reference) {
      const bounds = reference.dataset?.nestedTextTarget
        ? nestedTextTargetBounds(reference)
        : reference;
      if (bounds) actionElements.push(["nested-reference", bounds]);
    }
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
              left: rootPanelBounds.left,
              top: Math.max(rootPanelBounds.top, headerBounds.bottom),
              right: rootPanelBounds.right,
              bottom: rootPanelBounds.bottom,
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
    reflowNestedPopups();
    updatePopupRegions();
    updatePopupStyle();
  }

  function updatePopupStyle() {
    if (surface !== "popup" || popup.hidden) return;
    const computed = getComputedStyle(popup);
    const payload = {
      customCssApplied: !!customStyle,
      backgroundColor: String(computed.backgroundColor || "").slice(0, 160),
      borderTopColor: String(computed.borderTopColor || "").slice(0, 160),
      borderTopWidth: String(computed.borderTopWidth || "").slice(0, 160),
    };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint === lastPopupStyle) return;
    lastPopupStyle = fingerprint;
    host.send("popup-style", payload);
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

  function audioMenuRows() {
    const menu = document.querySelector(".audio-menu");
    return menu ? [...menu.querySelectorAll(".audio-source-row")] : [];
  }

  function audioRowControl(row, column) {
    if (!row) return null;
    return column > 0
      ? row.querySelector(".audio-anki")
      : row.querySelector(".audio-candidate");
  }

  function updateAudioSelection(scrollIntoView = true) {
    const rows = audioMenuRows();
    if (!rows.length) return;
    audioSelectionRow = Math.max(0, Math.min(audioSelectionRow, rows.length - 1));
    const row = rows[audioSelectionRow];
    audioSelectionColumn = row?.querySelector(".audio-anki")
      ? Math.max(0, Math.min(1, audioSelectionColumn))
      : 0;
    rows.forEach((candidateRow, rowIndex) => {
      const candidate = candidateRow.querySelector(".audio-candidate");
      const anki = candidateRow.querySelector(".audio-anki");
      const candidateSelected =
        rowIndex === audioSelectionRow && audioSelectionColumn === 0;
      const ankiSelected = rowIndex === audioSelectionRow && audioSelectionColumn === 1;
      candidate?.classList.toggle("selected", candidateSelected);
      candidate?.setAttribute("aria-selected", String(candidateSelected));
      anki?.classList.toggle("selected", ankiSelected);
      anki?.setAttribute("aria-pressed", String(ankiSelected));
    });
    const focused = audioRowControl(row, audioSelectionColumn);
    if (scrollIntoView && typeof focused?.scrollIntoView === "function")
      focused.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderAudioCandidates(candidates, options = {}) {
    document.querySelector(".audio-menu")?.remove();
    const values = Array.isArray(candidates)
      ? candidates.filter((value) => value?.url)
      : [];
    audioSelectionRow = 0;
    audioSelectionColumn = 0;
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
      const row = document.createElement("div");
      row.className = "audio-source-row";
      row.setAttribute("role", "presentation");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "audio-candidate";
      button.dataset.action = "audio-candidate";
      button.dataset.audioIndex = String(index);
      button.setAttribute("role", "option");
      button.textContent = candidate.name || `Source ${index + 1}`;
      row.append(button);
      if (ankiState.enabled && ankiState.configured) {
        const anki = document.createElement("button");
        anki.type = "button";
        anki.className = "audio-anki";
        anki.dataset.action = "audio-anki-selection";
        anki.dataset.audioIndex = String(index);
        anki.textContent = "＋ Anki";
        anki.title = "Use this audio for the Anki card";
        anki.setAttribute("aria-label", "Use this audio for the Anki card");
        anki.setAttribute("aria-pressed", "false");
        row.append(anki);
      }
      menu.append(row);
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
    if ((audioAutoPlay || options.autoPlay) && values.length && !options.loading)
      playAudioCandidate(values[0]);
  }

  function moveAudioSelection(rowDelta = 0, columnDelta = 0) {
    const rows = audioMenuRows();
    if (!rows.length) return;
    if (rowDelta) {
      audioSelectionRow = Math.max(
        0,
        Math.min(rows.length - 1, audioSelectionRow + Math.sign(rowDelta)),
      );
    }
    if (columnDelta) {
      audioSelectionColumn = Math.max(
        0,
        Math.min(1, audioSelectionColumn + Math.sign(columnDelta)),
      );
    }
    updateAudioSelection();
  }

  function activateAudioSelection() {
    const menu = document.querySelector(".audio-menu");
    const candidates = menu?._candidates || [];
    const row = audioMenuRows()[audioSelectionRow];
    const index = Number(row?.querySelector(".audio-candidate")?.dataset.audioIndex);
    if (!Number.isInteger(index) || !candidates[index]) return;
    if (audioSelectionColumn > 0) {
      host.send("audio-anki-selection", {
        url: candidates[index].url,
        name: candidates[index].name || `Source ${index + 1}`,
        candidateIndex: index,
      });
      updateAudioSelection();
      return;
    }
    playAudioCandidate(candidates[index]);
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
      if (payload.command === "hold-progress")
        updateControllerHoldProgress(payload.progress, payload.visible !== false);
      if (payload.command === "select-entry") selectMostVisibleControllerEntry();
      if (payload.command === "move-entry") moveControllerEntry(payload.direction);
      if (payload.command === "scroll-axis") {
        const axis = Math.max(-1, Math.min(1, Number(payload.axis) || 0));
        const magnitude = Math.abs(axis);
        const deadzone = 0.18;
        if (magnitude > deadzone) {
          const normalized =
            ((magnitude - deadzone) / (1 - deadzone)) * (axis < 0 ? -1 : 1);
          popup.scrollBy({
            top:
              normalized *
              680 *
              (Math.min(50, Math.max(0, Number(payload.deltaMs) || 0)) / 1000),
            left: 0,
            behavior: "auto",
          });
        }
      }
      if (payload.command === "scroll-up")
        popup.scrollBy({ top: -180, behavior: "smooth" });
      if (payload.command === "scroll-down")
        popup.scrollBy({ top: 180, behavior: "smooth" });
      if (payload.command === "audio-up") moveAudioSelection(-1, 0);
      if (payload.command === "audio-down") moveAudioSelection(1, 0);
      if (payload.command === "audio-left") moveAudioSelection(0, -1);
      if (payload.command === "audio-right") moveAudioSelection(0, 1);
      if (payload.command === "audio-activate") activateAudioSelection();
      if (payload.command === "close-audio-menu") {
        document.querySelector(".audio-menu")?.remove();
        stopAudioPlayback();
        activeAudioRequestId = "";
        requestAnimationFrame(updatePopupMetrics);
      }
      return;
    }
    if (message.type === "popup-state") {
      popupState = payload;
      currentResult = payload.result;
      nestedPopupMode = ["off", "click", "hover", "shift-hover"].includes(
        payload.nestedPopupMode,
      )
        ? payload.nestedPopupMode
        : "off";
      nestedPopupMaxDepth = Math.max(
        1,
        Math.min(8, Math.round(Number(payload.nestedPopupMaxDepth) || 3)),
      );
      nestedPopupSessionId = String(payload.popupSessionId || "").slice(0, 160);
      clearNestedPopups(0);
      stopAudioPlayback();
      activeAudioRequestId = "";
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
        cancelOutsidePointerCapture();
        audioSelectionRow = 0;
        audioSelectionColumn = 0;
        lastPopupSize = null;
        lastPopupStyle = "";
        lastPopupRegions.clear();
        nestedPopupSessionId = "";
        nestedPopupMode = "off";
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
      // Publish a first metric sample synchronously. Hidden Electron windows
      // can defer their first animation frame, which would otherwise leave
      // the host without popup bounds during the initial visible state.
      updatePopupMetrics();
      requestAnimationFrame(() => {
        updatePopupMetrics();
        // A second frame lets Chromium commit the DOM/style changes before
        // the native transparent window is revealed. This is a paint gate,
        // not a visual transition: the window remains fully opaque and is
        // shown once the first populated frame is ready.
        requestAnimationFrame(() => {
          if (popup.hidden) return;
          updatePopupMetrics();
          host.send("popup-painted");
        });
      });
      return;
    }
    if (message.type === "popup-layout") {
      applyPopupLayout(payload);
      requestAnimationFrame(updatePopupMetrics);
      return;
    }
    if (message.type === "popup-error") {
      clearNestedPopups(0);
      popup.hidden = false;
      content.replaceChildren(text(payload.message || "Lookup failed"));
      requestAnimationFrame(updatePopupMetrics);
      return;
    }
    if (message.type === "nested-lookup-result") {
      renderNestedResult(payload);
      return;
    }
    if (message.type === "audio-result") {
      if (
        message.requestId &&
        activeAudioRequestId &&
        message.requestId !== activeAudioRequestId
      )
        return;
      if (message.requestId) activeAudioRequestId = message.requestId;
      if (payload.showMenu === false) {
        if (!payload.loading && payload.autoPlay)
          playAudioCandidate(payload.candidates?.[0]);
        return;
      }
      renderAudioCandidates(payload.candidates, {
        loading: payload.loading === true,
        error: payload.error,
        autoPlay: payload.autoPlay === true,
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
      if (!isPopupTarget(event.target)) {
        // Keep the transparent popup surface alive until the native pointer
        // sequence has completed. Dismissing on pointerdown hides the
        // Electron window before macOS delivers pointerup, which can forward
        // that mouseup to mpv and toggle playback.
        event.stopPropagation();
        outsidePointerId = event.pointerId;
        // Keep the completed native gesture on the interactive surface even
        // when the pointer crosses the transparent panel boundary before
        // pointerup. The popup is dismissed only after that captured release.
        setPointerCapture(event.pointerId);
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
      if (
        outsidePointerId !== null &&
        (event.pointerId === undefined || event.pointerId === outsidePointerId)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (finishOutsidePointer("outside-pointer-up", event.pointerId)) return;
      }
      if (finishSelection("selection-end", event.pointerId)) return;
      if (isPopupTarget(event.target) || popupState?.visible) {
        host.send("popup-action", { action: "pointer-up", button: event.button });
      }
    });
    root.addEventListener("pointercancel", (event) => {
      if (
        outsidePointerId !== null &&
        (event.pointerId === undefined || event.pointerId === outsidePointerId)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (finishOutsidePointer("outside-pointer-cancel", event.pointerId)) return;
      }
      if (
        !finishSelection("selection-cancel", event.pointerId) &&
        popupState?.visible
      ) {
        host.send("popup-action", { action: "pointer-up", button: event.button });
      }
    });
    root.addEventListener("lostpointercapture", (event) => {
      if (finishOutsidePointer("outside-pointer-cancel", event.pointerId)) return;
      finishSelection("selection-cancel", event.pointerId);
    });
    window.addEventListener("blur", () => {
      finishOutsidePointer("outside-pointer-blur");
      finishSelection("selection-cancel");
    });
    root.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-action]");
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action.dataset.action === "nested-lookup") {
          openNestedPopup({
            ...nestedLookupSourceFromEvent(event),
            parent: nestedPopupOwner(action),
          });
          requestAnimationFrame(updatePopupMetrics);
          return;
        }
        if (action.dataset.action === "nested-close") {
          const record = nestedPopups.find(
            (value) => value.id === action.dataset.nestedPopupId,
          );
          if (record) removeNestedPopup(record);
          return;
        }
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
          audioSelectionRow = Number(action.dataset.audioIndex) || 0;
          audioSelectionColumn = 0;
          updateAudioSelection();
          playAudioCandidate(candidates[audioSelectionRow]);
          return;
        }
        if (action.dataset.action === "audio-anki-selection") {
          const candidates = action.closest(".audio-menu")?._candidates || [];
          const index = Number(action.dataset.audioIndex) || 0;
          const candidate = candidates[index];
          if (candidate?.url) {
            audioSelectionRow = index;
            audioSelectionColumn = 1;
            host.send("audio-anki-selection", {
              url: candidate.url,
              name: candidate.name || `Source ${index + 1}`,
              candidateIndex: index,
            });
            updateAudioSelection();
          }
          return;
        }
        if (action.dataset.action === "audio-close") {
          host.send("popup-action", { action: "close-audio-list" });
          stopAudioPlayback();
          activeAudioRequestId = "";
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
        host.send("popup-action", { action: action.dataset.action });
        return;
      }
      if (nestedPopupMode === "click" && event.button === 0) {
        const source = nestedLookupSourceFromEvent(event);
        if (source) {
          event.preventDefault();
          openNestedPopup(source);
          return;
        }
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
        if (nestedPopups.length) {
          removeNestedPopup(nestedPopups.at(-1));
          return;
        }
        host.send("popup-action", { action: "escape" });
      }
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target.closest?.('[data-action="nested-lookup"]')
      ) {
        event.preventDefault();
        event.stopPropagation();
        const source = nestedLookupSourceFromEvent({
          target: event.target,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        if (source) openNestedPopup(source);
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
      requestAnimationFrame(updatePopupMetrics);
    });
    root.addEventListener("pointermove", scheduleNestedHover);
    window.addEventListener("resize", () => requestAnimationFrame(updatePopupMetrics));
    nestedPopupLayer.addEventListener("scroll", () =>
      requestAnimationFrame(updatePopupMetrics),
    );
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
