IINATAN.toggleSettings = function () {
  IINATAN.state.settingsOpen = !IINATAN.state.settingsOpen;
  if (IINATAN.state.settingsOpen) IINATAN.closeAllPopups();
  IINATAN.invalidateScene("settings");
};
IINATAN.activeProfile = function () {
  return IINATAN.config.profiles[IINATAN.config.activeProfileId];
};
IINATAN.settingsButton = function (id, label, action) {
  return new Button("settings:" + id, label, action);
};

IINATAN.selectProfile = function () {
  var ids = Object.keys(IINATAN.config.profiles),
    items = ids.map(function (id) {
      return (
        IINATAN.config.profiles[id].name +
        (id === IINATAN.config.activeProfileId ? " ✓" : "")
      );
    });
  mp.input.select({
    prompt: "iinatan profile",
    items: items,
    submit: function (index) {
      if (index === undefined) return;
      IINATAN.config.activeProfileId = ids[index];
      IINATAN.worker.generation++;
      IINATAN.stopWorker();
      IINATAN.saveConfig(function (error) {
        if (error) IINATAN.showStatus(error.message, "error");
        IINATAN.invalidateScene("profile");
      });
    },
  });
};
IINATAN.createProfile = function () {
  mp.input.get({
    prompt: "New profile name",
    submit: function (name) {
      name = String(name || "").trim();
      if (!name) return;
      var id =
        name
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "profile";
      var base = id,
        suffix = 2;
      while (IINATAN.config.profiles[id]) id = base + "-" + suffix++;
      var profile = IINATAN.clone(IINATAN.activeProfile());
      profile.name = name;
      IINATAN.config.profiles[id] = profile;
      IINATAN.config.activeProfileId = id;
      IINATAN.saveConfig(function (error) {
        if (error) IINATAN.showStatus(error.message, "error");
        IINATAN.invalidateScene("profile-create");
      });
    },
  });
};
IINATAN.renameProfile = function () {
  mp.input.get({
    prompt: "Rename profile",
    default_text: IINATAN.activeProfile().name,
    submit: function (name) {
      if (String(name || "").trim())
        IINATAN.activeProfile().name = String(name).trim();
      IINATAN.saveConfig(function (error) {
        if (error) IINATAN.showStatus(error.message, "error");
        IINATAN.invalidateScene("profile-rename");
      });
    },
  });
};
IINATAN.deleteProfile = function () {
  var id = IINATAN.config.activeProfileId;
  if (Object.keys(IINATAN.config.profiles).length <= 1) {
    IINATAN.showStatus("At least one profile is required", "error");
    return;
  }
  delete IINATAN.config.profiles[id];
  IINATAN.config.activeProfileId = Object.keys(IINATAN.config.profiles)[0];
  IINATAN.saveConfig(function (error) {
    if (error) IINATAN.showStatus(error.message, "error");
    IINATAN.invalidateScene("profile-delete");
  });
};
IINATAN.selectLanguage = function () {
  var ids = ["ja", "en", "de", "fr", "ko", "zh"],
    labels = ids.map(function (id) {
      return IINATAN_LANGUAGE_REGISTRY.get(id).label;
    });
  mp.input.select({
    prompt: "Target language",
    items: labels,
    submit: function (index) {
      if (index === undefined) return;
      IINATAN.activeProfile().lookupLanguage = ids[index];
      IINATAN.worker.generation++;
      IINATAN.stopWorker();
      IINATAN.saveConfig(function (error) {
        if (error) IINATAN.showStatus(error.message, "error");
        IINATAN.invalidateScene("language");
      });
    },
  });
};

IINATAN.importDictionary = function (zipPath) {
  var path = String(zipPath || "").trim();
  if (!/^([A-Za-z]:[\\/]|\/)/.test(path) || !/\.zip$/i.test(path)) {
    IINATAN.showStatus(
      "Dictionary import requires an absolute .zip path",
      "error",
    );
    return;
  }
  IINATAN.backendCommand(
    [
      "import-transaction",
      path,
      IINATAN.path("~~state/iinatan/dictionaries"),
      IINATAN.path(IINATAN.configPath),
    ],
    function (error, result) {
      if (error) {
        IINATAN.showStatus(
          "Dictionary import failed: " + error.message,
          "error",
        );
        return;
      }
      var imported;
      try {
        imported = JSON.parse(result.stdout);
      } catch (_) {
        IINATAN.showStatus("Dictionary import returned invalid data", "error");
        return;
      }
      if (!imported.ok || !imported.dictionary) {
        IINATAN.showStatus(
          imported.error || "Dictionary import failed",
          "error",
        );
        return;
      }
      IINATAN.config.dictionaries.push(imported.dictionary);
      IINATAN.activeProfile().dictionaries.push(imported.dictionary.id);
      IINATAN.worker.generation++;
      IINATAN.stopWorker();
      IINATAN.saveConfig(function (saveError) {
        IINATAN.showStatus(
          saveError
            ? saveError.message
            : "Imported " + imported.dictionary.title,
          saveError ? "error" : "info",
        );
        IINATAN.invalidateScene("import");
      });
    },
    { playbackOnly: false, captureSize: 4 * 1024 * 1024 },
  );
};
IINATAN.promptImport = function () {
  mp.input.get({
    prompt: "Absolute Yomitan dictionary ZIP path",
    submit: IINATAN.importDictionary,
  });
};
IINATAN.downloadRecommended = function () {
  mp.input.get({
    prompt: "Recommended dictionary HTTPS URL",
    submit: function (url) {
      if (!/^https:\/\//i.test(String(url || ""))) {
        IINATAN.showStatus("Download URL must use HTTPS", "error");
        return;
      }
      IINATAN.backendCommand(
        [
          "download-import",
          url,
          IINATAN.path("~~cache/iinatan/downloads"),
          IINATAN.path("~~state/iinatan/dictionaries"),
        ],
        function (error) {
          IINATAN.showStatus(
            error ? error.message : "Dictionary downloaded and imported",
            error ? "error" : "info",
          );
        },
        { playbackOnly: false },
      );
    },
  });
};

IINATAN.renderSettings = function () {
  var profile = IINATAN.activeProfile(),
    osd = IINATAN.state.osd || { w: 1280, h: 720 },
    root = new VStack("settings-root", 8);
  root.add(
    new TextRun(
      "settings-title",
      "iinatan settings",
      IINATAN.scene.context().styles.headword,
    ),
  );
  root.add(
    new TextRun(
      "settings-path",
      "Advanced JSON: " + IINATAN.path(IINATAN.configPath),
      IINATAN.scene.context().styles.tag,
    ),
  );
  root.add(
    IINATAN.settingsButton(
      "profile",
      "Profile: " + profile.name,
      IINATAN.selectProfile,
    ),
  );
  var profiles = new HStack("settings-profile-actions", 6);
  profiles
    .add(
      IINATAN.settingsButton("create-profile", "Create", IINATAN.createProfile),
    )
    .add(
      IINATAN.settingsButton("rename-profile", "Rename", IINATAN.renameProfile),
    )
    .add(
      IINATAN.settingsButton("delete-profile", "Delete", IINATAN.deleteProfile),
    );
  root.add(profiles);
  root.add(
    IINATAN.settingsButton(
      "language",
      "Target language: " + profile.lookupLanguage,
      IINATAN.selectLanguage,
    ),
  );
  root.add(
    IINATAN.settingsButton(
      "import",
      "Import dictionary ZIP…",
      IINATAN.promptImport,
    ),
  );
  root.add(
    IINATAN.settingsButton(
      "download",
      "Download recommended…",
      IINATAN.downloadRecommended,
    ),
  );
  root.add(
    new TextRun(
      "settings-dicts",
      "Dictionaries: " +
        (profile.dictionaries.length
          ? profile.dictionaries.join(", ")
          : "none"),
      IINATAN.scene.context().styles.body,
    ),
  );
  root.add(
    new Toggle(
      "settings-pause",
      "Pause while popup visible",
      profile.pauseWhilePopupVisible,
      function () {
        profile.pauseWhilePopupVisible = !profile.pauseWhilePopupVisible;
        IINATAN.saveConfig(function () {});
        IINATAN.invalidateScene("setting");
      },
    ),
  );
  root.add(
    new Button("settings-theme", "Theme: " + profile.theme.preset, function () {
      var values = ["dark", "light", "high-contrast"];
      profile.theme.preset =
        values[(values.indexOf(profile.theme.preset) + 1) % values.length];
      IINATAN.saveConfig(function () {});
      IINATAN.invalidateScene("theme");
    }),
  );
  root.add(
    new Toggle("settings-anki", "Anki", profile.anki.enabled, function () {
      profile.anki.enabled = !profile.anki.enabled;
      IINATAN.saveConfig(function () {});
      IINATAN.invalidateScene("anki-setting");
    }),
  );
  root.add(
    new Button("settings-reload", "Validate / reload JSON", function () {
      var raw = IINATAN.readJson(IINATAN.configPath, null);
      if (!raw) IINATAN.showStatus("Config JSON is invalid", "error");
      else {
        IINATAN.config = IINATAN.normalizeConfig(raw);
        IINATAN.showStatus("Configuration reloaded", "info");
        IINATAN.invalidateScene("reload");
      }
    }),
  );
  root.add(
    new Button("settings-restore", "Restore backup", function () {
      var backup = IINATAN.readJson(IINATAN.configBackupPath, null);
      if (!backup) IINATAN.showStatus("No valid backup exists", "error");
      else {
        IINATAN.config = IINATAN.normalizeConfig(backup);
        IINATAN.saveConfig(function (error) {
          IINATAN.showStatus(
            error ? error.message : "Backup restored",
            error ? "error" : "info",
          );
        });
      }
    }),
  );
  root.add(new Button("settings-close", "Close", IINATAN.toggleSettings));
  var scroll = new ScrollView("settings-scroll", root),
    surface = new Modal("settings-modal", scroll, {
      fill: profile.theme.background,
    });
  IINATAN.scene.render(surface, {
    x: Math.max(12, (osd.w - Math.min(620, osd.w - 24)) / 2),
    y: 20,
    w: Math.min(620, osd.w - 24),
    h: Math.max(120, osd.h - 40),
  });
};
