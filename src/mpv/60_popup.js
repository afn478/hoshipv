IINATAN.pauseOwner = false;
IINATAN.popupStack = [];
IINATAN.lookupSerial = 0;
IINATAN.handleHover = function () {
  if (!IINATAN.state.lookupEnabled || IINATAN.state.settingsOpen) return;
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId];
  if (profile.subtitleLookupMode === "shift-hover" && !IINATAN.state.shiftDown)
    return;
  var mouse = IINATAN.state.mouse || {};
  if (!mouse.hover) {
    IINATAN.state.hoverUnit = null;
    return;
  }
  if (IINATAN.popupStack.length) {
    var current = IINATAN.popupStack[IINATAN.popupStack.length - 1],
      popupRect = current && current.rect;
    if (
      popupRect &&
      mouse.x >= popupRect.x &&
      mouse.x <= popupRect.x + popupRect.w &&
      mouse.y >= popupRect.y &&
      mouse.y <= popupRect.y + popupRect.h
    )
      return;
  }
  var units = IINATAN.state.subtitleUnits || [],
    found = null;
  for (var i = units.length - 1; i >= 0 && !found; i--)
    for (var j = (units[i].rects || []).length - 1; j >= 0; j--) {
      var r = units[i].rects[j];
      if (
        mouse.x >= r.x &&
        mouse.x <= r.x + r.w &&
        mouse.y >= r.y &&
        mouse.y <= r.y + r.h
      ) {
        found = units[i];
        break;
      }
    }
  if (!found) {
    IINATAN.state.hoverUnit = null;
    return;
  }
  var hoverKey = found.surface + ":" + found.position;
  if (hoverKey === IINATAN.state.hoverUnit) return;
  IINATAN.state.hoverUnit = hoverKey;
  IINATAN.state.subtitleRect = IINATAN.unionRects(found.rects || []);
  var scalar =
    IINATAN.unicodeMap(found.text || "").scalars[found.position] || {};
  IINATAN.openLookup(
    found.text,
    found.displayStartUtf16 !== undefined
      ? found.displayStartUtf16
      : scalar.utf16Start || 0,
    false,
  );
};
IINATAN.anchorRect = function () {
  var osd = IINATAN.state.osd || { w: 1280, h: 720 },
    mouse = IINATAN.state.mouse || {};
  if (mouse.hover && isFinite(Number(mouse.x)) && isFinite(Number(mouse.y)))
    return { x: Number(mouse.x) - 1, y: Number(mouse.y) - 1, w: 2, h: 2 };
  return (
    IINATAN.state.subtitleRect || {
      x: Math.max(0, Number(mouse.x || osd.w / 2) - 20),
      y: Math.max(0, Number(mouse.y || osd.h * 0.8) - 16),
      w: 40,
      h: 32,
    }
  );
};

IINATAN.placePopup = function (anchor, size) {
  var osd = IINATAN.state.osd || {},
    w = Number(osd.w || 1280),
    h = Number(osd.h || 720),
    margins = IINATAN.state.properties["user-data/osc/margins"] || {};
  var safe = {
    x: Math.max(Number(osd.ml || 0), Number(margins.l || 0) * w) + 8,
    y: Math.max(Number(osd.mt || 0), Number(margins.t || 0) * h) + 8,
    w:
      w -
      Math.max(Number(osd.ml || 0), Number(margins.l || 0) * w) -
      Math.max(Number(osd.mr || 0), Number(margins.r || 0) * w) -
      16,
    h:
      h -
      Math.max(Number(osd.mt || 0), Number(margins.t || 0) * h) -
      Math.max(Number(osd.mb || 0), Number(margins.b || 0) * h) -
      16,
  };
  var popupWidth = Math.max(0, Math.min(Number(size.w || 0), safe.w)),
    popupHeight = Math.max(0, Math.min(Number(size.h || 0), safe.h));
  var xs = [
      anchor.x + anchor.w / 2 - popupWidth / 2,
      anchor.x,
      anchor.x + anchor.w - popupWidth,
    ],
    ys = [anchor.y - popupHeight - 12, anchor.y + anchor.h + 12];
  var candidates = [];
  ys.forEach(function (y, yIndex) {
    xs.forEach(function (x) {
      var cx = Math.max(safe.x, Math.min(safe.x + safe.w - popupWidth, x)),
        cy = Math.max(safe.y, Math.min(safe.y + safe.h - popupHeight, y));
      var overflow = Math.abs(cx - x) + Math.abs(cy - y);
      var overlap = IINATAN.rectOverlap(
        { x: cx, y: cy, w: popupWidth, h: popupHeight },
        anchor,
      );
      var nested = IINATAN.popupStack.reduce(function (sum, popup) {
        if (popup === IINATAN.popupStack[IINATAN.popupStack.length - 1])
          return sum;
        return (
          sum +
          IINATAN.rectOverlap(
            { x: cx, y: cy, w: popupWidth, h: popupHeight },
            popup.rect || {},
          )
        );
      }, 0);
      candidates.push({
        x: cx,
        y: cy,
        w: popupWidth,
        h: popupHeight,
        order: yIndex * xs.length + candidates.length,
        score: overflow * 10 + overlap * 4 + nested * 3 + Math.abs(cy - y),
      });
    });
  });
  candidates.sort(function (a, b) {
    return a.score - b.score || a.order - b.order;
  });
  return candidates[0];
};
IINATAN.rectOverlap = function (a, b) {
  var w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
    h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
};
IINATAN.clusterSelected = function (widgetId, index) {
  var selection = IINATAN.state.selection;
  return (
    !!selection &&
    selection.widgetId === widgetId &&
    index >= Math.min(selection.start, selection.end) &&
    index <= Math.max(selection.start, selection.end)
  );
};
IINATAN.beginSelection = function () {
  var mouse = IINATAN.state.mouse || {},
    cluster = IINATAN.scene.clusterAt(mouse.x, mouse.y);
  if (!cluster) return false;
  IINATAN.state.selection = {
    widgetId: cluster.widgetId,
    start: cluster.index,
    end: cluster.index,
    text: cluster.text,
  };
  return true;
};
IINATAN.updateSelection = function () {
  var selection = IINATAN.state.selection,
    mouse = IINATAN.state.mouse || {};
  if (!selection || !selection.dragging) return;
  var cluster = IINATAN.scene.clusterAt(mouse.x, mouse.y);
  if (
    cluster &&
    cluster.widgetId === selection.widgetId &&
    cluster.index !== selection.end
  ) {
    selection.end = cluster.index;
    IINATAN.invalidateScene("selection");
  }
};
IINATAN.finishSelection = function () {
  var selection = IINATAN.state.selection;
  if (!selection) return false;
  var clusters = IINATAN.scene.clusterRegions.filter(function (cluster) {
    return (
      cluster.widgetId === selection.widgetId &&
      cluster.index >= Math.min(selection.start, selection.end) &&
      cluster.index <= Math.max(selection.start, selection.end)
    );
  });
  if (clusters.length && IINATAN.popupStack.length) {
    var start = clusters.reduce(function (value, cluster) {
        return Math.min(value, cluster.range[0]);
      }, Infinity),
      end = clusters.reduce(function (value, cluster) {
        return Math.max(value, cluster.range[1]);
      }, 0);
    IINATAN.popupStack[IINATAN.popupStack.length - 1].selectedText =
      selection.text.substring(start, end);
  }
  var dragged = selection.start !== selection.end;
  delete IINATAN.state.selection;
  IINATAN.invalidateScene("selection-finish");
  return dragged;
};
IINATAN.nestedTextAction = function (widgetId, text) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId];
  if (profile.nestedPopupMode !== "click") return null;
  return function () {
    var mouse = IINATAN.state.mouse || {},
      cluster = IINATAN.scene.clusterAt(mouse.x, mouse.y);
    if (
      !cluster ||
      cluster.widgetId !== widgetId ||
      IINATAN.popupStack.length >= profile.nestedPopupMaxDepth
    )
      return;
    IINATAN.openLookup(text, cluster.range[0], true);
  };
};
IINATAN.handleNestedHover = function () {
  if (!IINATAN.popupStack.length || IINATAN.state.settingsOpen) return;
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    mode = profile.nestedPopupMode;
  if (mode !== "hover" && !(mode === "shift-hover" && IINATAN.state.shiftDown))
    return;
  if (IINATAN.popupStack.length >= profile.nestedPopupMaxDepth) return;
  var currentPopup = IINATAN.popupStack[IINATAN.popupStack.length - 1];
  if ((IINATAN.state.mouseSerial || 0) <= currentPopup.openedMouseSerial)
    return;
  var mouse = IINATAN.state.mouse || {},
    cluster = IINATAN.scene.clusterAt(mouse.x, mouse.y);
  if (!cluster) {
    IINATAN.state.nestedHoverKey = "";
    return;
  }
  var key = cluster.widgetId + ":" + cluster.index;
  if (key === IINATAN.state.nestedHoverKey) return;
  IINATAN.state.nestedHoverKey = key;
  IINATAN.openLookup(cluster.text, cluster.range[0], true);
};

IINATAN.openLookup = function (text, utf16Position, nested) {
  var lookupSerial = ++IINATAN.lookupSerial;
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId];
  var payload = IINATAN.lookupRequestFor(
    profile.lookupLanguage,
    text,
    utf16Position,
    profile,
  );
  if (!payload) return;
  var generation = IINATAN.generation;
  IINATAN.lookup(payload, function (error, result) {
    if (
      lookupSerial !== IINATAN.lookupSerial ||
      generation !== IINATAN.generation
    )
      return;
    if (error) {
      if (error.message !== "lookup superseded")
        IINATAN.showStatus(error.message, "error");
      return;
    }
    var document = new DictionaryDocument(
      result,
      IINATAN.captureCardMediaContext(),
    );
    if (!document.entries.length) {
      if (!nested) IINATAN.closeAllPopups();
      return;
    }
    if (!nested) IINATAN.popupStack = [];
    IINATAN.popupStack.push({
      document: document,
      rect: null,
      selectedText: "",
      openedMouseSerial: IINATAN.state.mouseSerial || 0,
    });
    if (
      profile.pauseWhilePopupVisible &&
      !mp.get_property_bool("pause", false)
    ) {
      mp.set_property_bool("pause", true);
      IINATAN.pauseOwner = true;
    }
    IINATAN.invalidateScene("lookup");
  });
};

IINATAN.closePopup = function () {
  IINATAN.lookupSerial++;
  if (IINATAN.popupStack.length) IINATAN.popupStack.pop();
  IINATAN.cancelAudioPreview();
  if (!IINATAN.popupStack.length && IINATAN.pauseOwner) {
    mp.set_property_bool("pause", false);
    IINATAN.pauseOwner = false;
  }
  IINATAN.invalidateScene("close-popup");
};
IINATAN.closeAllPopups = function () {
  IINATAN.lookupSerial++;
  while (IINATAN.popupStack.length) IINATAN.popupStack.pop();
  IINATAN.cancelAudioPreview();
  if (IINATAN.pauseOwner) {
    mp.set_property_bool("pause", false);
    IINATAN.pauseOwner = false;
  }
  IINATAN.invalidateScene("close-all");
};

IINATAN.updateBindings = function () {
  var mouse = IINATAN.state.mouse || {},
    hit =
      mouse.hover && IINATAN.scene
        ? IINATAN.scene.index.hit(mouse.x, mouse.y)
        : null,
    active = !!hit;
  if (active === IINATAN.state.interactive) return;
  IINATAN.state.interactive = active;
  if (active) {
    mp.add_forced_key_binding(
      "MBTN_LEFT",
      "iinatan-click",
      function (event) {
        var kind = event && event.event ? event.event : "press";
        if (kind === "down") {
          if (IINATAN.beginSelection()) IINATAN.state.selection.dragging = true;
          return;
        }
        if (kind !== "up" && kind !== "press") return;
        if (IINATAN.finishSelection()) return;
        var current = IINATAN.scene.index.hit(
          IINATAN.state.mouse.x,
          IINATAN.state.mouse.y,
        );
        if (current && current.handler.click) current.handler.click();
      },
      { complex: true },
    );
    mp.add_forced_key_binding("WHEEL_UP", "iinatan-wheel-up", function () {
      var current = IINATAN.scene.index.hit(
        IINATAN.state.mouse.x,
        IINATAN.state.mouse.y,
        function (region) {
          return !!region.handler.wheel;
        },
      );
      if (current && current.handler.wheel) current.handler.wheel(1);
    });
    mp.add_forced_key_binding("WHEEL_DOWN", "iinatan-wheel-down", function () {
      var current = IINATAN.scene.index.hit(
        IINATAN.state.mouse.x,
        IINATAN.state.mouse.y,
        function (region) {
          return !!region.handler.wheel;
        },
      );
      if (current && current.handler.wheel) current.handler.wheel(-1);
    });
  } else {
    mp.remove_key_binding("iinatan-click");
    mp.remove_key_binding("iinatan-wheel-up");
    mp.remove_key_binding("iinatan-wheel-down");
  }
};

IINATAN.invalidateScene = function () {
  IINATAN.debounce("scene", IINATAN.rebuildScene);
};
IINATAN.rebuildScene = function () {
  if (!IINATAN.scene) return;
  if (IINATAN.state.settingsOpen) {
    IINATAN.renderSettings();
    IINATAN.updateBindings();
    return;
  }
  if (!IINATAN.popupStack.length) {
    IINATAN.scene.clear();
    IINATAN.updateBindings();
    return;
  }
  var current = IINATAN.popupStack[IINATAN.popupStack.length - 1],
    profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    osd = IINATAN.state.osd || { w: 1280, h: 720 };
  var content = IINATAN.documentWidget(current.document),
    scroller = new ScrollView("popup-scroll", content),
    surface = new PopupSurface("popup-surface", scroller, {
      fill: profile.theme.background,
    });
  var max = {
      w: Math.min(Math.max(profile.popupMaxWidth, 770), osd.w - 24),
      h: (osd.h * profile.popupMaxHeightVh) / 100,
    },
    ctx = IINATAN.scene.context(),
    measured = surface.measure(ctx, max),
    minWidth = Math.min(
      Math.max(profile.popupMaxWidth, 770),
      Math.max(profile.popupMinWidth, 440),
    ),
    placed = IINATAN.placePopup(IINATAN.anchorRect(), {
      w: Math.max(minWidth, measured.w),
      h: Math.min(max.h, measured.h),
    });
  current.rect = placed;
  IINATAN.scene.render(surface, placed);
  IINATAN.updateBindings();
  IINATAN.handleNestedHover();
};
