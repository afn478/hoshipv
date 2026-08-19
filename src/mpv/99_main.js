IINATAN.detectPlatform = function () {
  var path = String(mp.utils.getenv("OS") || "").toLowerCase();
  if (path.indexOf("windows") >= 0) return "windows";
  if (mp.utils.file_info("/System/Library/CoreServices")) return "macos";
  return "linux";
};
IINATAN.initialize = function () {
  IINATAN.validateRuntimeCompatibility();
  IINATAN.platform = IINATAN.detectPlatform();
  IINATAN.loadConfig();
  IINATAN.overlay = mp.create_osd_overlay("ass-events");
  IINATAN.scene = new Scene(IINATAN.overlay);
  IINATAN.OBSERVED_PROPERTIES.forEach(function (spec) {
    mp.observe_property(spec[0], spec[1], IINATAN.propertyChanged);
  });
  IINATAN.on("state", function () {
    IINATAN.updateSubtitleGeometry();
    IINATAN.handleHover();
  });
  mp.register_event("file-loaded", function () {
    IINATAN.mediaGeneration++;
    IINATAN.generation++;
    IINATAN.state.fileLoaded = true;
    IINATAN.state.hoverUnit = null;
    IINATAN.closeAllPopups();
    IINATAN.rebuildFromProperties();
  });
  mp.register_event("end-file", function () {
    IINATAN.mediaGeneration++;
    IINATAN.generation++;
    IINATAN.state.fileLoaded = false;
    IINATAN.worker.generation++;
    IINATAN.closeAllPopups();
    IINATAN.abortProcesses(true);
  });
  mp.register_event("shutdown", function () {
    IINATAN.state.shuttingDown = true;
    IINATAN.generation++;
    Object.keys(IINATAN.timers).forEach(function (name) {
      clearTimeout(IINATAN.timers[name]);
    });
    IINATAN.stopWorker(function () {
      IINATAN.abortProcesses(false);
    });
    if (IINATAN.overlay) IINATAN.overlay.remove();
  });
  mp.add_key_binding("Ctrl+d", "iinatan-settings", IINATAN.toggleSettings);
  mp.add_key_binding("Ctrl+Shift+d", "iinatan-toggle", function () {
    IINATAN.state.lookupEnabled = !IINATAN.state.lookupEnabled;
    if (!IINATAN.state.lookupEnabled) IINATAN.closeAllPopups();
    IINATAN.showStatus(
      IINATAN.state.lookupEnabled ? "lookup enabled" : "lookup disabled",
      "info",
    );
  });
  mp.add_key_binding("ESC", "iinatan-escape", function () {
    if (IINATAN.popupStack.length) IINATAN.closePopup();
    else if (IINATAN.state.settingsOpen) IINATAN.toggleSettings();
  });
  mp.register_script_message("iinatan-settings", IINATAN.toggleSettings);
  mp.register_script_message("iinatan-import", IINATAN.importDictionary);
  mp.register_script_message("iinatan-lookup", function (text, position) {
    IINATAN.openLookup(String(text || ""), Number(position || 0), false);
  });
  mp.register_script_message("iinatan-add-anyway", function () {
    var pending = IINATAN.state.pendingDuplicate;
    if (pending) IINATAN.addEntryToAnki(pending.entry, pending.document, true);
  });
  mp.register_script_message("iinatan-open-last-note", function () {
    if (IINATAN.state.lastNoteId)
      IINATAN.openAnkiNote(IINATAN.state.lastNoteId);
  });
  IINATAN.log(
    "info",
    "native mpv runtime ready; version=" +
      IINATAN.version +
      " platform=" +
      IINATAN.platform,
  );
};

IINATAN.initialize();
