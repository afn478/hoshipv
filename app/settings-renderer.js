"use strict";

(() => {
  const api = window.iinatanSettings;
  const status = document.getElementById("status");
  const activeProfile = document.getElementById("active-profile");
  const advanced = document.getElementById("advanced-preferences");
  const globalSettings = document.getElementById("global-settings");
  const profileName = document.getElementById("profile-name");
  const dictionaryList = document.getElementById("dictionary-list");
  const recommendedList = document.getElementById("recommended-list");
  const ankiStatus = document.getElementById("anki-status");
  const ankiFieldEditor = document.getElementById("anki-field-editor");
  const diagnosticsList = document.getElementById("diagnostics-list");
  const diagnosticsSessions = document.getElementById("diagnostics-sessions");
  const diagnosticsNote = document.getElementById("diagnostics-note");
  const controllerBindingsEditor = document.getElementById(
    "controller-bindings-editor",
  );
  let ankiFields = [];
  let state = null;

  const controllerContextLabels = Object.freeze({
    noPopup: "No popup",
    popup: "With popup",
    audio: "Audio menu",
  });
  const controllerButtonLabels = Object.freeze({
    primary: "Cross",
    back: "Circle",
    square: "Square",
    audio: "Triangle",
    leftShoulder: "L1",
    rightShoulder: "R1",
    leftTrigger: "L2",
    rightTrigger: "R2",
    dpadUp: "D-pad up",
    dpadDown: "D-pad down",
    dpadLeft: "D-pad left",
    dpadRight: "D-pad right",
  });
  const controllerActionLabels = Object.freeze({
    none: "None",
    lookup: "Open lookup",
    "toggle-pause": "Toggle pause",
    "resume-playback": "Resume playback",
    "close-popup": "Close popup",
    "close-audio-list": "Close audio menu",
    "subtitle-previous": "Previous subtitle",
    "subtitle-next": "Next subtitle",
    "seek-backward": "Seek backward 5 seconds",
    "seek-forward": "Seek forward 5 seconds",
    "seek-backward-long": "Seek backward 60 seconds",
    "seek-forward-long": "Seek forward 60 seconds",
    "frame-step-backward": "Step backward one frame",
    "frame-step-forward": "Step forward one frame",
    "volume-down": "Volume down",
    "volume-up": "Volume up",
    "speed-down": "Speed down",
    "speed-up": "Speed up",
    "audio-menu": "Open audio menu",
    "audio-activate": "Play/select audio",
    "play-audio": "Play selected audio",
    "popup-up": "Popup up",
    "popup-down": "Popup down",
    "popup-left": "Previous dictionary entry",
    "popup-right": "Next dictionary entry",
    "popup-scroll-up": "Scroll popup up",
    "popup-scroll-down": "Scroll popup down",
    "audio-up": "Previous audio source",
    "audio-down": "Next audio source",
    "audio-left": "Previous audio control",
    "audio-right": "Next audio control",
    "anki-primary": "Add to Anki",
    "anki-force-add": "Add to Anki anyway",
  });
  const controllerPreferenceKeys = Object.freeze({
    noPopup: "controllerNoPopupBindingsJson",
    popup: "controllerPopupBindingsJson",
    audio: "controllerAudioBindingsJson",
  });

  const ankiMarkers = [
    "{expression}",
    "{word}",
    "{reading}",
    "{furigana}",
    "{furigana-plain}",
    "{popup-selection-text}",
    "{sentence}",
    "{cloze-prefix}",
    "{cloze-body}",
    "{cloze-suffix}",
    "{glossary-first}",
    "{selected-glossary}",
    "{glossary}",
    "{glossary-plain}",
    "{dictionary}",
    "{part-of-speech}",
    "{tags}",
    "{frequencies}",
    "{frequency-harmonic-rank}",
    "{phonetic-transcriptions}",
    "{pitch-accent-positions}",
    "{pitch-accent-categories}",
    "{document-title}",
    "{source-path}",
    "{timestamp}",
    "{screenshot}",
    "{image}",
    "{sentence-audio}",
    "{subtitle-audio}",
    "{audio}",
  ];

  function showStatus(message, error = false) {
    status.textContent = message || "";
    status.classList.toggle("error", error);
  }

  function activeProfileData() {
    return (
      state?.profiles?.find((profile) => profile.id === state.activeProfileId) || null
    );
  }

  function preferenceControls() {
    return [...document.querySelectorAll("[data-pref]")];
  }

  function controllerMetadata() {
    const metadata = state?.controllerBindings;
    if (!metadata?.buttons || !metadata?.actions || !metadata?.defaults) return null;
    return metadata;
  }

  function controllerBindingsFor(context) {
    const key = controllerPreferenceKeys[context];
    const raw = document.querySelector(`[data-pref="${key}"]`)?.value || "{}";
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      return {};
    }
  }

  function writeControllerBindings(context, bindings) {
    const key = controllerPreferenceKeys[context];
    const input = document.querySelector(`[data-pref="${key}"]`);
    if (input) input.value = JSON.stringify(bindings, null, 2);
  }

  function renderControllerBindings() {
    if (!controllerBindingsEditor) return;
    controllerBindingsEditor.replaceChildren();
    const metadata = controllerMetadata();
    if (!metadata) {
      const unavailable = document.createElement("p");
      unavailable.className = "hint";
      unavailable.textContent = "Controller binding metadata is unavailable.";
      controllerBindingsEditor.append(unavailable);
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "controller-bindings-editor";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Choose actions independently for each context. Changes are saved with the active profile.";
    wrapper.append(hint);

    for (const context of Object.keys(controllerContextLabels)) {
      const card = document.createElement("section");
      card.className = "controller-context";
      const header = document.createElement("div");
      header.className = "controller-context-header";
      const title = document.createElement("h3");
      title.textContent = controllerContextLabels[context];
      const description = document.createElement("span");
      description.className = "hint";
      description.textContent =
        context === "noPopup"
          ? "Actions while no lookup popup is open."
          : context === "popup"
            ? "Actions while the dictionary popup is open."
            : "Actions while choosing an audio source.";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "secondary";
      reset.dataset.controllerReset = context;
      reset.textContent = "Reset context";
      reset.addEventListener("click", () => {
        writeControllerBindings(context, metadata.defaults[context]);
        renderControllerBindings();
        showStatus(`${controllerContextLabels[context]} bindings reset.`);
      });
      header.append(title, description, reset);
      card.append(header);

      const table = document.createElement("table");
      table.className = "controller-binding-table";
      const head = document.createElement("thead");
      head.innerHTML =
        '<tr><th scope="col">Control</th><th scope="col">Action</th></tr>';
      table.append(head);
      const body = document.createElement("tbody");
      const bindings = controllerBindingsFor(context);
      const actions = Array.isArray(metadata.actions[context])
        ? metadata.actions[context]
        : [];
      for (const button of metadata.buttons) {
        const row = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = controllerButtonLabels[button] || button;
        const value = document.createElement("td");
        const select = document.createElement("select");
        select.dataset.controllerContext = context;
        select.dataset.controllerButton = button;
        select.setAttribute(
          "aria-label",
          `${controllerContextLabels[context]} ${name.textContent} action`,
        );
        for (const action of actions) {
          const option = document.createElement("option");
          option.value = action;
          option.textContent = controllerActionLabels[action] || action;
          select.append(option);
        }
        select.value = actions.includes(bindings[button]) ? bindings[button] : "none";
        select.addEventListener("change", () => {
          const next = controllerBindingsFor(context);
          next[button] = select.value;
          writeControllerBindings(context, next);
        });
        value.append(select);
        row.append(name, value);
        body.append(row);
      }
      table.append(body);
      card.append(table);
      wrapper.append(card);
    }
    controllerBindingsEditor.append(wrapper);
  }

  function renderProfileSelector() {
    activeProfile.replaceChildren();
    for (const profile of state?.profiles || []) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name
        ? `${profile.name} (${profile.id})`
        : profile.id;
      activeProfile.append(option);
    }
    activeProfile.value = state?.activeProfileId || "";
    profileName.value = activeProfileData()?.name || "";
  }

  function renderPreferences() {
    const profile = activeProfileData();
    const preferences = profile?.preferences || {};
    for (const control of preferenceControls()) {
      const value = preferences[control.dataset.pref];
      if (control.type === "checkbox") control.checked = !!value;
      else control.value = value ?? "";
    }
    advanced.value = JSON.stringify(preferences, null, 2);
    globalSettings.value = JSON.stringify(state?.global || {}, null, 2);
    renderAnkiFieldEditor();
    renderControllerBindings();
  }

  function readAnkiTemplates() {
    try {
      const value = JSON.parse(
        document.querySelector('[data-pref="ankiFieldTemplatesJson"]').value || "{}",
      );
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  }

  function writeAnkiTemplates(templates) {
    document.querySelector('[data-pref="ankiFieldTemplatesJson"]').value =
      JSON.stringify(templates, null, 2);
  }

  function insertMarker(input, marker) {
    const value = input.value || "";
    const start = Number.isInteger(input.selectionStart)
      ? input.selectionStart
      : value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${value.slice(0, start)}${marker}${value.slice(end)}`;
    input.focus();
    input.setSelectionRange(start + marker.length, start + marker.length);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderAnkiFieldEditor() {
    ankiFieldEditor.replaceChildren();
    if (!ankiFields.length) {
      const hint = document.createElement("small");
      hint.textContent =
        "Test AnkiConnect or load fields to edit templates with marker buttons.";
      ankiFieldEditor.append(hint);
      return;
    }
    const templates = readAnkiTemplates();
    ankiFields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "anki-field-row";
      const name = document.createElement("strong");
      name.textContent = field;
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(templates[field] || "");
      input.placeholder = "{expression}";
      input.addEventListener("change", () => {
        templates[field] = input.value;
        writeAnkiTemplates(templates);
      });
      const markers = document.createElement("div");
      markers.className = "anki-markers";
      ankiMarkers.forEach((marker) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary anki-marker";
        button.textContent = marker;
        button.addEventListener("click", () => insertMarker(input, marker));
        markers.append(button);
      });
      row.append(name, input, markers);
      ankiFieldEditor.append(row);
    });
  }

  function renderDictionaries() {
    dictionaryList.replaceChildren();
    const entries = Array.isArray(state?.dictionaries) ? state.dictionaries : [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No dictionaries are installed in this profile.";
      dictionaryList.append(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "dictionary-row";
      const marker = document.createElement("span");
      marker.className = "state";
      marker.textContent = entry.enabled === false ? "disabled" : "enabled";
      const description = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = entry.title || entry.name || entry.id;
      const path = document.createElement("small");
      path.textContent = entry.path || "path unavailable";
      description.append(title, path);
      const actions = document.createElement("div");
      actions.className = "button-row";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "secondary";
      toggle.textContent = entry.enabled === false ? "Enable" : "Disable";
      toggle.addEventListener("click", async () => {
        try {
          const response = await request("set-dictionary-enabled", {
            id: entry.id,
            enabled: entry.enabled === false,
          });
          state = response.state;
          renderDictionaries();
          showStatus("Dictionary selection updated.");
        } catch (_) {}
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (
          !window.confirm(`Remove ${entry.title || entry.id} and its installed files?`)
        )
          return;
        try {
          const response = await request("remove-dictionary", { id: entry.id });
          state = response.state;
          renderDictionaries();
          showStatus("Dictionary removed.");
        } catch (_) {}
      });
      const moveUp = document.createElement("button");
      moveUp.type = "button";
      moveUp.className = "secondary";
      moveUp.textContent = "↑";
      moveUp.title = "Move dictionary earlier";
      moveUp.disabled = entries.indexOf(entry) === 0;
      moveUp.addEventListener("click", () => reorderDictionary(entry.id, -1));
      const moveDown = document.createElement("button");
      moveDown.type = "button";
      moveDown.className = "secondary";
      moveDown.textContent = "↓";
      moveDown.title = "Move dictionary later";
      moveDown.disabled = entries.indexOf(entry) === entries.length - 1;
      moveDown.addEventListener("click", () => reorderDictionary(entry.id, 1));
      actions.append(moveUp, moveDown, toggle, remove);
      row.append(marker, description, actions);
      dictionaryList.append(row);
    }
  }

  async function reorderDictionary(id, delta) {
    const ids = (state?.dictionaries || []).map((entry) => entry.id);
    const index = ids.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    try {
      const response = await request("reorder-dictionaries", { ids });
      state = response.state;
      renderDictionaries();
      showStatus("Dictionary order updated.");
    } catch (_) {}
  }

  function renderRecommendedDictionaries() {
    recommendedList.replaceChildren();
    const entries = Array.isArray(state?.recommendedDictionaries)
      ? state.recommendedDictionaries
      : [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No recommended dictionary is configured for this language.";
      recommendedList.append(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "dictionary-row recommended-row";
      row.dataset.dictionaryId = entry.id || "";
      const description = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = entry.title || entry.id;
      const detail = document.createElement("small");
      detail.textContent = `${entry.category || "Dictionary"} · ${entry.description || ""}`;
      description.append(title, detail);
      const action = document.createElement("button");
      action.type = "button";
      action.dataset.dictionaryId = entry.id || "";
      action.className = entry.installed ? "secondary" : "primary";
      action.textContent = entry.installed ? "Update" : "Download";
      action.addEventListener("click", async () => {
        action.disabled = true;
        showStatus(`${entry.installed ? "Updating" : "Downloading"} ${entry.title}…`);
        try {
          const response = await request("download-recommended", {
            id: entry.id,
            update: entry.installed,
          });
          state = response.state;
          renderDictionaries();
          renderRecommendedDictionaries();
          showStatus(`${entry.title} is ready for lookup.`);
        } catch (_) {
          action.disabled = false;
        }
      });
      row.append(description, action);
      recommendedList.append(row);
    }
  }

  function appendDiagnosticRow(label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    diagnosticsList.append(term, description);
  }

  function renderDiagnostics() {
    diagnosticsList.replaceChildren();
    diagnosticsSessions.replaceChildren();
    const diagnostics = state?.diagnostics;
    if (!diagnostics) {
      appendDiagnosticRow("Status", "Diagnostics unavailable.");
      diagnosticsNote.textContent = "Reload settings to request a fresh host snapshot.";
      return;
    }

    const runtime = diagnostics.runtime || {};
    const player = diagnostics.player || {};
    const dictionary = diagnostics.dictionary || {};
    const windowState = diagnostics.window || {};
    const subtitleGeometry = diagnostics.subtitleGeometry || {};
    appendDiagnosticRow(
      "Runtime",
      `${runtime.platform || "unknown"} ${runtime.architecture || "unknown"} · Electron ${runtime.electron || "unknown"}`,
    );
    appendDiagnosticRow("Display session", runtime.displaySession || "unknown");
    appendDiagnosticRow("Player bridge", player.backend || "unavailable");
    appendDiagnosticRow("Native subtitles", player.nativeSubtitles || "unknown");
    appendDiagnosticRow(
      "Dictionary backend",
      `${dictionary.backend || "unavailable"} · ${dictionary.enabled ?? 0}/${dictionary.installed ?? 0} enabled`,
    );
    appendDiagnosticRow(
      "Window capability",
      `${windowState.backend || "unknown"}${
        windowState.supported === false
          ? ` · unsupported${windowState.reason ? `: ${windowState.reason}` : ""}`
          : windowState.exactContentCapability
            ? " · exact content capable"
            : windowState.needsPlayerShim
              ? " · player shim required"
              : ""
      }`,
    );
    appendDiagnosticRow(
      "Native subtitle geometry",
      subtitleGeometry.nativeHelper || "unavailable",
    );
    if (subtitleGeometry.source) {
      const source = subtitleGeometry.source;
      appendDiagnosticRow(
        "Subtitle geometry source",
        `${source.mode || "unknown"} · ${source.exact ? "exact" : "not exact"}`,
      );
      if (source.reason) appendDiagnosticRow("Geometry reason", source.reason);
    }
    appendDiagnosticRow(
      "Exact active sessions",
      `${subtitleGeometry.exactSessionCount ?? 0}/${player.activeSessions ?? 0}`,
    );

    const sessions = Array.isArray(diagnostics.sessions) ? diagnostics.sessions : [];
    const heading = document.createElement("h3");
    heading.textContent = "Current sessions";
    diagnosticsSessions.append(heading);
    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No player session is attached.";
      diagnosticsSessions.append(empty);
    } else {
      const list = document.createElement("ul");
      for (const session of sessions) {
        const item = document.createElement("li");
        const geometry = session.geometry || {};
        item.textContent = [
          session.sessionId || "unknown session",
          session.foreground === null
            ? "foreground unknown"
            : session.foreground
              ? "foreground"
              : "background",
          geometry.available ? "geometry available" : "geometry unavailable",
          geometry.nativeSubtitleGeometry
            ? geometry.contentExact
              ? "native exact bounds"
              : "native bounds not exact"
            : "reconstructed geometry",
          geometry.subtitleSource?.mode
            ? `subtitle source ${geometry.subtitleSource.mode}`
            : null,
          geometry.subtitleSource?.reason
            ? `geometry reason: ${geometry.subtitleSource.reason}`
            : null,
          geometry.nativeGeometryError
            ? [
                "native geometry " +
                  (geometry.nativeGeometryError.code || "unavailable"),
                geometry.nativeGeometryError.message
                  ? ": " + geometry.nativeGeometryError.message
                  : "",
              ].join("")
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        list.append(item);
      }
      diagnosticsSessions.append(list);
    }
    diagnosticsNote.textContent = subtitleGeometry.evidenceBoundary || "";
  }

  function render() {
    renderProfileSelector();
    renderPreferences();
    renderDictionaries();
    renderRecommendedDictionaries();
    renderDiagnostics();
  }

  async function request(type, payload = {}) {
    try {
      return await api.request(type, payload);
    } catch (error) {
      showStatus(error.message || "Settings request failed", true);
      throw error;
    }
  }

  async function load() {
    const response = await request("get-state");
    state = response.state;
    render();
    showStatus(`Editing ${activeProfileData()?.name || state.activeProfileId}.`);
  }

  function collectPreferences() {
    const profile = activeProfileData();
    const raw = JSON.parse(advanced.value || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Advanced preferences must be a JSON object");
    const next = { ...(profile?.preferences || {}), ...raw };
    for (const control of preferenceControls()) {
      next[control.dataset.pref] =
        control.type === "checkbox" ? control.checked : control.value;
    }
    return next;
  }

  async function save() {
    try {
      const preferences = collectPreferences();
      const global = JSON.parse(globalSettings.value || "{}");
      if (!global || typeof global !== "object" || Array.isArray(global))
        throw new Error("Global settings must be a JSON object");
      const response = await request("save-profile", {
        profileId: state.activeProfileId,
        name: profileName.value,
        preferences,
        global,
      });
      state = response.state;
      render();
      showStatus("Saved. Changes apply to the next lookup or session refresh.");
    } catch (error) {
      showStatus(error.message || "Could not save profile", true);
    }
  }

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panel === tab);
      });
    });
  });

  activeProfile.addEventListener("change", async () => {
    try {
      const response = await request("set-active-profile", {
        profileId: activeProfile.value,
      });
      state = response.state;
      render();
      showStatus(
        `Active profile is now ${activeProfileData()?.name || state.activeProfileId}.`,
      );
    } catch (_) {
      renderProfileSelector();
    }
  });

  document.getElementById("save").addEventListener("click", save);
  document
    .getElementById("reload")
    .addEventListener("click", () => load().catch(() => {}));
  document.getElementById("create-profile").addEventListener("click", async () => {
    const id = document.getElementById("new-profile-id").value.trim();
    const name = document.getElementById("new-profile-name").value.trim();
    try {
      const response = await request("create-profile", { id, name });
      state = response.state;
      render();
      showStatus(`Created ${name || id}.`);
    } catch (_) {}
  });
  document.getElementById("delete-profile").addEventListener("click", async () => {
    if (state.activeProfileId === "default") {
      showStatus("The default profile cannot be deleted.", true);
      return;
    }
    try {
      const response = await request("delete-profile", {
        profileId: state.activeProfileId,
      });
      state = response.state;
      render();
      showStatus("Profile deleted.");
    } catch (_) {}
  });
  document.getElementById("reset-profile").addEventListener("click", async () => {
    try {
      const response = await request("reset-profile", {
        profileId: state.activeProfileId,
      });
      state = response.state;
      render();
      showStatus("Profile reset to defaults.");
    } catch (_) {}
  });
  document.getElementById("anki-test").addEventListener("click", async () => {
    ankiStatus.textContent = "Testing…";
    ankiStatus.classList.remove("error");
    try {
      const response = await request("anki-inspect", {
        url: document.querySelector('[data-pref="ankiConnectUrl"]').value,
        timeoutSeconds: document.querySelector(
          '[data-pref="ankiConnectTimeoutSeconds"]',
        ).value,
        modelName: document.querySelector('[data-pref="ankiModelName"]').value,
      });
      ankiFields = Array.isArray(response.fields) ? response.fields : [];
      renderAnkiFieldEditor();
      ankiStatus.textContent = `Connected (AnkiConnect ${response.version}; ${response.deckNames.length} decks, ${response.modelNames.length} note types).`;
    } catch (error) {
      ankiStatus.textContent = error.message || "AnkiConnect unavailable.";
      ankiStatus.classList.add("error");
    }
  });
  document.getElementById("anki-load-fields").addEventListener("click", () => {
    document.getElementById("anki-test").click();
  });
  document.getElementById("import-dictionary").addEventListener("click", async () => {
    try {
      const response = await request("import-dictionary");
      if (response.cancelled) return;
      state = response.state;
      renderDictionaries();
      showStatus("Dictionary imported and activated for this profile.");
    } catch (_) {}
  });
  document.getElementById("export-backup").addEventListener("click", async () => {
    try {
      const response = await request("export-backup");
      if (!response.cancelled) showStatus(`Backup exported to ${response.path}.`);
    } catch (_) {}
  });
  document.getElementById("restore-backup").addEventListener("click", async () => {
    if (!window.confirm("Restore this backup and replace all current profiles?"))
      return;
    try {
      const response = await request("restore-backup");
      if (response.cancelled) return;
      state = response.state;
      render();
      showStatus("Backup restored.");
    } catch (_) {}
  });

  Object.values(controllerPreferenceKeys).forEach((key) => {
    document
      .querySelector(`[data-pref="${key}"]`)
      ?.addEventListener("change", renderControllerBindings);
  });

  load().catch((error) => showStatus(error.message || "Could not load settings", true));
})();
