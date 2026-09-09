"use strict";

(() => {
  const host = window.iinatanHost;
  const iina = window.__IINATAN_IINA_ADAPTER__;
  const reference = window.__IINATAN_REFERENCE_POPUP__;
  if (!host || !iina || !reference) return;

  const { state, elements } = reference;
  const { root, popup, nestedPopupLayer } = elements;
  root.dataset.surface = "popup";
  let selectionPointerId = null;
  let outsidePointerId = null;
  let metricsScheduled = false;
  let paintedSequence = 0;
  let nestedPopupWasOpen = false;

  function safeSend(type, payload = {}) {
    try {
      host.send(type, payload);
      return true;
    } catch (_) {
      return false;
    }
  }

  function setPointerCapture(pointerId) {
    try {
      root.setPointerCapture?.(pointerId);
    } catch (_) {}
  }

  function releasePointerCapture(pointerId) {
    try {
      root.releasePointerCapture?.(pointerId);
    } catch (_) {}
  }

  function insidePopup(target) {
    return !!target && (target === popup || popup.contains(target));
  }

  function pointInsideRect(rect, x, y) {
    return (
      !!rect &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.right) &&
      Number.isFinite(rect.bottom) &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }

  function eventPointInsidePopup(event) {
    return pointInsideRect(
      popup.getBoundingClientRect(),
      Number(event?.clientX),
      Number(event?.clientY),
    );
  }

  function eventInsidePopup(event) {
    return insidePopup(event?.target) || eventPointInsidePopup(event);
  }

  function interactiveTarget(target) {
    if (!target || !insidePopup(target)) return null;
    return target.closest?.(
      'button, a, input, select, textarea, summary, [role="button"], [role="menuitem"]',
    );
  }

  function interactiveTargetAtPoint(event) {
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const direct = interactiveTarget(document.elementFromPoint?.(x, y));
    if (direct) return direct;
    const candidates = Array.from(
      popup.querySelectorAll(
        'button, a, input, select, textarea, summary, [role="button"], [role="menuitem"]',
      ),
    );
    return (
      candidates
        .filter((candidate) => pointInsideRect(candidate.getBoundingClientRect(), x, y))
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
        })[0] || null
    );
  }

  function dispatchFallbackMouseEvent(type, event, target) {
    if (!target) return false;
    const dispatched = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      detail: type === "click" ? 1 : 0,
      clientX: Number(event?.clientX) || 0,
      clientY: Number(event?.clientY) || 0,
      button: Number(event?.button) || 0,
    });
    target.dispatchEvent(dispatched);
    return true;
  }

  function selectableTarget(target) {
    if (!insidePopup(target)) return false;
    return !target.closest(
      'button, a, input, select, textarea, summary, [contenteditable="true"]',
    );
  }

  function finishSelection(action, pointerId) {
    if (
      selectionPointerId === null ||
      (pointerId !== undefined &&
        pointerId !== null &&
        pointerId !== selectionPointerId)
    )
      return false;
    const active = selectionPointerId;
    selectionPointerId = null;
    releasePointerCapture(active);
    safeSend("popup-action", { action, pointerId: active });
    return true;
  }

  function finishOutside(reason, pointerId) {
    if (
      outsidePointerId === null ||
      (pointerId !== undefined && pointerId !== null && pointerId !== outsidePointerId)
    )
      return false;
    const active = outsidePointerId;
    outsidePointerId = null;
    releasePointerCapture(active);
    safeSend("dismiss-popup", { reason });
    return true;
  }

  function focusTarget(target) {
    if (!target) return "";
    if (target === popup) return "popup-panel";
    const nested = target.closest?.(".nested-popup");
    if (nested)
      return `nested-popup:${nested.dataset.nestedPopupId || nested.dataset.popupId || "unknown"}`;
    const action =
      target.dataset?.ankiAction || target.dataset?.action || target.id || "focusable";
    return `${String(target.tagName || "element").toLowerCase()}:${String(action).slice(0, 120)}`;
  }

  function normalizedRect(element) {
    if (!element || element.classList?.contains("hidden")) return null;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (normalizedRect(element)) return element;
    }
    return null;
  }

  function textSelectionRegion() {
    const body = popup.querySelector(".body");
    if (!body) return null;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        !node.nodeValue?.trim() ||
        node.parentElement?.closest("button, a, rt, summary")
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      if (rect && rect.width > 12 && rect.height > 0) return rect;
    }
    return normalizedRect(body);
  }

  function nestedLookupRegion() {
    const body = popup.querySelector(".body");
    if (!body) return null;
    const language = state.config.language || {};
    const languageId = String(language.id || state.config.lookupLanguage || "ja");
    const policyName =
      languageId === "ja"
        ? "japanese"
        : languageId === "ko"
          ? "korean"
          : languageId === "en" || languageId === "de" || languageId === "fr"
            ? "latin"
            : languageId;
    const policy =
      language.lookupCharacterPolicy ||
      window.IINATAN_LOOKUP_CHARACTER_POLICY?.policies?.[policyName];
    const matches = (value) => {
      if (window.IINATAN_LOOKUP_CHARACTER_POLICY?.matches)
        return window.IINATAN_LOOKUP_CHARACTER_POLICY.matches(policy, value);
      return /[\\p{L}\\p{N}]/u.test(String(value || ""));
    };
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      const value = String(node.nodeValue || "");
      if (
        !value.trim() ||
        parent?.closest("button, a, rt, summary, svg, path, .scan-disable")
      )
        continue;
      const chars = Array.from(value);
      const index = chars.findIndex(matches);
      if (index < 0) continue;
      const start = chars.slice(0, index).join("").length;
      const end = start + chars[index].length;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    return null;
  }

  function sendRegion(name, value) {
    if (!value) return;
    let rect =
      typeof value.getBoundingClientRect === "function"
        ? value.getBoundingClientRect()
        : value;
    if (name === "content" || name === "selection") {
      const viewport = popup.getBoundingClientRect();
      const left = Math.max(rect.left, viewport.left);
      const top = Math.max(rect.top, viewport.top);
      const right = Math.min(rect.right ?? rect.left + rect.width, viewport.right);
      const bottom = Math.min(rect.bottom ?? rect.top + rect.height, viewport.bottom);
      rect = { left, top, width: right - left, height: bottom - top };
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    safeSend("popup-region", {
      name,
      x: Number(rect.left) || 0,
      y: Number(rect.top) || 0,
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
    });
  }

  function popupTransformScale(styles) {
    const transform = String(styles?.transform || "");
    const matrix = transform.match(/^matrix\(([^)]+)\)$/);
    if (matrix) {
      const scale = Number(matrix[1].split(",")[0]);
      if (Number.isFinite(scale) && scale > 0) return Math.abs(scale);
    }
    const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
    if (matrix3d) {
      const scale = Number(matrix3d[1].split(",")[0]);
      if (Number.isFinite(scale) && scale > 0) return Math.abs(scale);
    }
    return Math.max(0.1, Number(state.config.popupScale) || 1);
  }

  function publishMetrics() {
    metricsScheduled = false;
    if (popup.classList.contains("hidden")) return;
    if (nestedPopupWasOpen && state.nestedPopups.length === 0) {
      nestedPopupWasOpen = false;
      safeSend("popup-action", { action: "nested-closed" });
    }
    const bounds = popup.getBoundingClientRect();
    const styles = getComputedStyle(popup);
    const scale = popupTransformScale(styles);
    const borderWidthX =
      (Number.parseFloat(styles.borderLeftWidth) || 0) +
      (Number.parseFloat(styles.borderRightWidth) || 0);
    const borderWidthY =
      (Number.parseFloat(styles.borderTopWidth) || 0) +
      (Number.parseFloat(styles.borderBottomWidth) || 0);
    safeSend("popup-size", {
      // getBoundingClientRect() is the transformed border box. Placement sends
      // max-height and width back as CSS content-box values, so remove the
      // transformed border before reporting the measured content dimensions.
      width: Math.max(1, bounds.width - borderWidthX * scale),
      height: Math.max(1, bounds.height - borderWidthY * scale),
      scrollable: popup.scrollHeight > popup.clientHeight + 1,
    });
    sendRegion("panel", popup);
    sendRegion("content", popup.querySelector(".body"));
    sendRegion("headword", firstVisible([".head-title .term", ".head-title", ".head"]));
    sendRegion("selection", textSelectionRegion());
    sendRegion(
      "nested-reference",
      firstVisible([
        ".body .xref-link:not(.external-source-link)",
        ".body [data-lookup]",
        ".body .dict-inline-audio",
      ]) || nestedLookupRegion(),
    );
    sendRegion("nested-panel", firstVisible([".nested-popup"]));
    sendRegion("action-audio-source", firstVisible([".audio-button"]));
    sendRegion("action-audio-close", firstVisible([".audio-source-menu"]));
    sendRegion("action-anki-add", firstVisible([".anki-primary-button"]));
    safeSend("popup-style", {
      customCssApplied: !!document.getElementById("iinatan-custom-popup-css")
        ?.textContent,
      backgroundColor: styles.backgroundColor,
      borderTopColor: styles.borderTopColor,
      borderTopWidth: styles.borderTopWidth,
    });
  }

  function scheduleMetrics() {
    if (metricsScheduled) return;
    metricsScheduled = true;
    requestAnimationFrame(publishMetrics);
  }

  function applyLayout(payload) {
    const position =
      payload.position && typeof payload.position === "object" ? payload.position : {};
    if (Number.isFinite(Number(position.x)))
      popup.style.left = `${Number(position.x)}px`;
    if (Number.isFinite(Number(position.y)))
      popup.style.top = `${Number(position.y)}px`;
    if (Number.isFinite(Number(payload.width)) && Number(payload.width) > 0)
      popup.style.width = `${Number(payload.width)}px`;
    if (Number.isFinite(Number(payload.maxHeight)) && Number(payload.maxHeight) > 0)
      popup.style.maxHeight = `${Number(payload.maxHeight)}px`;
    if (Number.isFinite(Number(payload.maxHeight)) && Number(payload.maxHeight) > 0)
      document.documentElement.style.setProperty(
        "--popup-max-height",
        `${Number(payload.maxHeight)}px`,
      );
    scheduleMetrics();
  }

  function revealPopup(payload) {
    state.popupSessionId = String(payload.popupSessionId || state.popupSessionId);
    state.lineId = Number(payload.lineId || payload.geometryGeneration || Date.now());
    state.text = String(payload.result?.lookupString || "");
    state.chars = Array.from(state.text);
    state.currentPos = null;
    state.currentAnchor = null;
    state.enabled = true;
    reference.applyConfig({
      popupScale: payload.popupScale,
      popupMinWidth: payload.popupMinWidth,
      popupMaxWidth: payload.popupMaxWidth,
      popupMaxHeightVh: 100,
      customPopupCss: payload.customCss,
      audioSources: payload.audioSources,
      audioAutoPlay: payload.audioAutoPlay === true,
      anki: payload.anki,
      nestedPopupMode: payload.nestedPopupMode,
      nestedPopupMaxDepth: payload.nestedPopupMaxDepth,
      lookupLanguage: payload.lookupLanguage || "ja",
      language: {
        id: payload.lookupLanguage || "ja",
        lookupUnit: payload.lookupUnit || "character",
        wordMode: payload.wordMode || "rightward-prefix",
      },
      experimentalNativeSubtitleHitLayer: false,
      experimentalNativeSubtitleLookupHighlight: false,
      controllerEnabled: false,
    });
    reference.clearNestedPopups(0);
    popup.innerHTML = '<div class="head"></div><div class="body"></div>';
    popup.classList.remove("lookup-pending", "hidden");
    applyLayout(payload);
    reference.setLookupPopupVisibility(true);
    reference.renderStoredLookupInto(
      popup,
      {
        ok: payload.result?.ok !== false,
        position: null,
        result: payload.result || {},
      },
      true,
    );
    popup.focus?.({ preventScroll: true });
    safeSend("popup-action", { action: "focus-changed", target: "popup-panel" });
    publishMetrics();
    scheduleMetrics();
    const sequence = ++paintedSequence;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (sequence !== paintedSequence || popup.classList.contains("hidden")) return;
        scheduleMetrics();
        safeSend("popup-painted", {});
      }),
    );
  }

  function closePopup() {
    paintedSequence += 1;
    finishOutside("outside-pointer-cancel");
    finishSelection("selection-cancel");
    reference.hidePopup();
  }

  iina.onMessage("popup-state", (payload) => {
    if (payload?.visible === false) closePopup();
    else revealPopup(payload || {});
  });
  iina.onMessage("nested-lookup-result", (payload) => {
    const result = payload?.result || {};
    nestedPopupWasOpen = state.nestedPopups.length > 0;
    safeSend("popup-action", {
      action: "nested-result",
      depth: Number(payload?.depth) || 0,
      ok: payload?.ok === true,
      lookupString: String(result.lookupString || result.lookupText || ""),
      text: String(payload?.text || result.text || ""),
      error: String(payload?.error || ""),
    });
    scheduleMetrics();
  });
  iina.onMessage("popup-layout", applyLayout);
  iina.onMessage("capabilities", (payload) => {
    root.dataset.inputMode = String(payload?.inputMode || "unknown");
  });
  iina.onMessage("mpv-popup-error", (payload) => {
    state.enabled = true;
    state.lookupPopupVisible = true;
    popup.classList.remove("hidden");
    popup.innerHTML = '<div class="head"></div><div class="body"></div>';
    reference.setPopupBodyFor(
      popup,
      `<div class="error">${String(payload?.message || "Lookup failed")}</div>`,
    );
    scheduleMetrics();
  });
  iina.onMessage("controller-command", (payload) => {
    const command = String(payload?.command || "");
    const handled = reference.handleHostControllerCommand?.(command, payload) === true;
    if (!handled && command === "scroll-up")
      popup.scrollBy({ top: -180, behavior: "auto" });
    else if (!handled && command === "scroll-down")
      popup.scrollBy({ top: 180, behavior: "auto" });
    else if (!handled && command === "scroll-axis")
      popup.scrollTop += (Number(payload.axis) || 0) * 20;
    else if (!handled && command === "close-audio-menu")
      reference.hideAudioSourceMenu();
    else if (!handled && command === "close-popup") closePopup();
    scheduleMetrics();
  });

  root.addEventListener("focusin", (event) => {
    const target = focusTarget(event.target);
    if (target) safeSend("popup-action", { action: "focus-changed", target });
  });
  root.addEventListener("pointerdown", (event) => {
    const pointTarget = interactiveTargetAtPoint(event);
    if (!eventInsidePopup(event)) {
      event.stopPropagation();
      outsidePointerId = event.pointerId;
      setPointerCapture(event.pointerId);
      return;
    }
    const resolvedTarget = insidePopup(event.target) ? event.target : pointTarget;
    if (!insidePopup(event.target) && event.button === 0 && resolvedTarget) {
      event.preventDefault();
      event.stopPropagation();
      dispatchFallbackMouseEvent("click", event, resolvedTarget);
      return;
    }
    if (event.button === 0 && selectableTarget(resolvedTarget || event.target)) {
      selectionPointerId = event.pointerId;
      safeSend("popup-action", {
        action: "selection-start",
        button: event.button,
        pointerId: event.pointerId,
      });
      return;
    }
    safeSend("popup-action", { action: "pointer-down", button: event.button });
  });
  root.addEventListener("pointerup", (event) => {
    if (finishOutside("outside-pointer-up", event.pointerId)) return;
    if (finishSelection("selection-end", event.pointerId)) return;
    if (eventInsidePopup(event)) {
      // A transparent companion can receive a native click on #root even when
      // the point is over selectable popup text. Re-enter the reference
      // renderer with the original client coordinates so its caret lookup can
      // resolve ordinary body text. Native DOM targets and text selection have
      // already taken their normal paths above.
      if (
        event.button === 0 &&
        !insidePopup(event.target) &&
        !popupSelectionIsActive()
      ) {
        dispatchFallbackMouseEvent("click", event, popup);
        return;
      }
      safeSend("popup-action", { action: "pointer-up", button: event.button });
    }
  });
  root.addEventListener("pointercancel", (event) => {
    if (finishOutside("outside-pointer-cancel", event.pointerId)) return;
    finishSelection("selection-cancel", event.pointerId);
  });
  root.addEventListener("lostpointercapture", (event) => {
    finishOutside("outside-pointer-cancel", event.pointerId);
    finishSelection("selection-cancel", event.pointerId);
  });
  root.addEventListener(
    "contextmenu",
    (event) => {
      if (eventInsidePopup(event) && !insidePopup(event.target)) {
        const target = interactiveTargetAtPoint(event);
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          dispatchFallbackMouseEvent("contextmenu", event, target);
        }
      }
      scheduleMetrics();
    },
    true,
  );
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.nestedPopups.length) {
      setTimeout(scheduleMetrics, 0);
      return;
    }
    if (state.audioSourceMenu) {
      event.preventDefault();
      reference.hideAudioSourceMenu();
      scheduleMetrics();
      safeSend("popup-action", { action: "close-audio-list" });
      return;
    }
    event.preventDefault();
    safeSend("popup-action", { action: "escape" });
  });
  popup.addEventListener("scroll", () => {
    safeSend("popup-scroll", { left: popup.scrollLeft, top: popup.scrollTop });
    scheduleMetrics();
  });
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection?.();
    safeSend("popup-action", {
      action: "selection-changed",
      text: String(selection?.toString?.() || "").slice(0, 20000),
    });
  });
  nestedPopupLayer.addEventListener("scroll", scheduleMetrics);
  window.addEventListener("resize", scheduleMetrics);
  window.addEventListener("blur", () => {
    finishOutside("outside-focus-loss");
    finishSelection("selection-cancel");
  });
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(scheduleMetrics);
    observer.observe(popup);
    observer.observe(nestedPopupLayer);
  }
  safeSend("ready", { surface: "popup" });
})();
