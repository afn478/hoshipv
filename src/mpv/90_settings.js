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
      IINATAN.commitImportedDictionary(result);
    },
    { playbackOnly: false, captureSize: 4 * 1024 * 1024 },
  );
};
IINATAN.commitImportedDictionary = function (result) {
  var imported;
  try {
    imported = JSON.parse(result.stdout);
  } catch (_) {
    IINATAN.showStatus("Dictionary import returned invalid data", "error");
    return;
  }
  if (!imported.ok || !imported.dictionary) {
    IINATAN.showStatus(imported.error || "Dictionary import failed", "error");
    return;
  }
  var dictionary = imported.dictionary,
    profile = IINATAN.activeProfile();
  IINATAN.config.dictionaries.push(dictionary);
  profile.dictionaries.push(dictionary.id);
  IINATAN.saveConfig(function (saveError) {
    if (saveError) {
      IINATAN.config.dictionaries = IINATAN.config.dictionaries.filter(
        function (item) {
          return item.id !== dictionary.id;
        },
      );
      profile.dictionaries = profile.dictionaries.filter(function (id) {
        return id !== dictionary.id;
      });
      IINATAN.backendCommand(
        [
          "remove-dictionary",
          IINATAN.path("~~state/iinatan/dictionaries"),
          dictionary.path,
        ],
        function () {},
      );
      IINATAN.showStatus(saveError.message, "error");
      return;
    }
    IINATAN.worker.generation++;
    IINATAN.stopWorker();
    IINATAN.showStatus("Imported " + dictionary.title, "info");
    IINATAN.invalidateScene("import");
  });
};
IINATAN.promptImport = function () {
  mp.input.get({
    prompt: "Absolute Yomitan dictionary ZIP path",
    submit: IINATAN.importDictionary,
  });
};
IINATAN.manageDictionaries = function () {
  var profile = IINATAN.activeProfile(),
    registry = Object.create(null);
  IINATAN.config.dictionaries.forEach(function (dictionary) {
    registry[dictionary.id] = dictionary;
  });
  var ids = profile.dictionaries.slice(),
    items = ids.map(function (id, index) {
      var dictionary = registry[id] || { title: id, enabled: false };
      return (
        index +
        1 +
        ". " +
        dictionary.title +
        (dictionary.enabled === false ? " (disabled)" : "")
      );
    });
  if (!items.length) {
    IINATAN.showStatus("No dictionaries are registered", "info");
    return;
  }
  mp.input.select({
    prompt: "Manage dictionary",
    items: items,
    submit: function (index) {
      if (index === undefined) return;
      var id = ids[index],
        dictionary = registry[id];
      mp.input.select({
        prompt: dictionary.title,
        items: [
          dictionary.enabled === false ? "Enable" : "Disable",
          "Move up",
          "Move down",
          "Remove",
        ],
        submit: function (action) {
          if (action === undefined) return;
          if (action === 0) dictionary.enabled = dictionary.enabled === false;
          else if (action === 1 && index > 0) {
            profile.dictionaries.splice(index, 1);
            profile.dictionaries.splice(index - 1, 0, id);
          } else if (action === 2 && index + 1 < profile.dictionaries.length) {
            profile.dictionaries.splice(index, 1);
            profile.dictionaries.splice(index + 1, 0, id);
          } else if (action === 3) {
            var previousProfile = profile.dictionaries.slice(),
              previousRegistry = IINATAN.config.dictionaries.slice();
            profile.dictionaries = profile.dictionaries.filter(
              function (value) {
                return value !== id;
              },
            );
            IINATAN.config.dictionaries = IINATAN.config.dictionaries.filter(
              function (value) {
                return value.id !== id;
              },
            );
            IINATAN.saveConfig(function (saveError) {
              if (saveError) {
                profile.dictionaries = previousProfile;
                IINATAN.config.dictionaries = previousRegistry;
                IINATAN.showStatus(saveError.message, "error");
                return;
              }
              IINATAN.backendCommand(
                [
                  "remove-dictionary",
                  IINATAN.path("~~state/iinatan/dictionaries"),
                  dictionary.path,
                ],
                function (removeError) {
                  if (removeError) {
                    profile.dictionaries = previousProfile;
                    IINATAN.config.dictionaries = previousRegistry;
                    IINATAN.saveConfig(function () {});
                    IINATAN.showStatus(removeError.message, "error");
                    return;
                  }
                  IINATAN.worker.generation++;
                  IINATAN.stopWorker();
                  IINATAN.invalidateScene("dictionary-remove");
                },
              );
            });
            return;
          }
          IINATAN.worker.generation++;
          IINATAN.stopWorker();
          IINATAN.saveConfig(function (error) {
            if (error) IINATAN.showStatus(error.message, "error");
            IINATAN.invalidateScene("dictionaries");
          });
        },
      });
    },
  });
};
IINATAN.configurePopupSize = function () {
  mp.input.get({
    prompt: "Popup max width in OSD pixels",
    default_text: String(IINATAN.activeProfile().popupMaxWidth),
    submit: function (value) {
      IINATAN.activeProfile().popupMaxWidth = IINATAN.clamp(
        value,
        IINATAN.activeProfile().popupMinWidth,
        1600,
        440,
      );
      IINATAN.saveConfig(function () {});
      IINATAN.invalidateScene("popup-size");
    },
  });
};
IINATAN.configureSubtitleMode = function () {
  var values = ["hover", "shift-hover"];
  mp.input.select({
    prompt: "Subtitle lookup trigger",
    items: values,
    submit: function (index) {
      if (index === undefined) return;
      IINATAN.activeProfile().subtitleLookupMode = values[index];
      IINATAN.saveConfig(function () {});
      IINATAN.invalidateScene("subtitle-mode");
    },
  });
};
IINATAN.configureAudioSources = function () {
  mp.input.get({
    prompt: "Audio sources JSON",
    default_text: JSON.stringify(IINATAN.activeProfile().audio.sources),
    submit: function (value) {
      try {
        var sources = JSON.parse(value);
        if (!Array.isArray(sources)) throw new Error("expected an array");
        sources.forEach(function (source) {
          if (!source || !IINATAN.safeExternalUrl(source.url))
            throw new Error("invalid audio source URL");
        });
        IINATAN.activeProfile().audio.sources = sources;
        IINATAN.saveConfig(function () {});
      } catch (error) {
        IINATAN.showStatus("Audio source JSON: " + error.message, "error");
      }
    },
  });
};
IINATAN.configureAnki = function () {
  var options = IINATAN.activeProfile().anki;
  IINATAN.ankiDiscover(function (error, discovery) {
    if (error) {
      IINATAN.showStatus("Anki discovery failed: " + error.message, "error");
      return;
    }
    mp.input.select({
      prompt: "Anki deck",
      items: discovery.decks,
      submit: function (deckIndex) {
        if (deckIndex === undefined) return;
        options.deck = discovery.decks[deckIndex];
        mp.input.select({
          prompt: "Anki model",
          items: discovery.models,
          submit: function (modelIndex) {
            if (modelIndex === undefined) return;
            options.model = discovery.models[modelIndex];
            IINATAN.ankiInvoke(
              "modelFieldNames",
              { modelName: options.model },
              function (fieldError, fields) {
                if (fieldError) {
                  IINATAN.showStatus(fieldError.message, "error");
                  return;
                }
                if (!Object.keys(options.fields || {}).length) {
                  options.fields = {};
                  (fields || []).forEach(function (field, index) {
                    options.fields[field] =
                      index === 0
                        ? "{expression}"
                        : index === 1
                          ? "{reading}"
                          : index === 2
                            ? "{glossary-html}"
                            : "";
                  });
                }
                IINATAN.saveConfig(function (saveError) {
                  IINATAN.showStatus(
                    saveError ? saveError.message : "Anki deck/model saved",
                    saveError ? "error" : "info",
                  );
                  IINATAN.invalidateScene("anki-config");
                });
              },
            );
          },
        });
      },
    });
  });
};
IINATAN.downloadRecommended = function () {
  var recommendations = IINATAN.config.global.recommendedDictionaries || [];
  if (!recommendations.length) {
    IINATAN.showStatus("No recommended dictionaries are configured", "error");
    return;
  }
  mp.input.select({
    prompt: "Download recommended dictionary",
    items: recommendations.map(function (item) {
      return item.title;
    }),
    submit: function (index) {
      if (index === undefined) return;
      var url = recommendations[index] && recommendations[index].url;
      if (!/^https:\/\//i.test(String(url || ""))) {
        IINATAN.showStatus("Dictionary URL must use HTTPS", "error");
        return;
      }
      IINATAN.backendCommand(
        [
          "download-import",
          url,
          IINATAN.path("~~cache/iinatan/downloads"),
          IINATAN.path("~~state/iinatan/dictionaries"),
        ],
        function (error, result) {
          if (error) IINATAN.showStatus(error.message, "error");
          else IINATAN.commitImportedDictionary(result);
        },
        { playbackOnly: false, captureSize: 8 * 1024 * 1024 },
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
    IINATAN.settingsButton(
      "manage-dictionaries",
      "Enable / order / remove dictionaries…",
      IINATAN.manageDictionaries,
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
      "subtitle-mode",
      "Subtitle trigger: " + profile.subtitleLookupMode,
      IINATAN.configureSubtitleMode,
    ),
  );
  root.add(
    IINATAN.settingsButton(
      "popup-size",
      "Popup max width: " + profile.popupMaxWidth,
      IINATAN.configurePopupSize,
    ),
  );
  root.add(
    IINATAN.settingsButton(
      "audio-sources",
      "Audio sources…",
      IINATAN.configureAudioSources,
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
      profile.theme = IINATAN.clone(
        IINATAN.THEME_PRESETS[
          values[(values.indexOf(profile.theme.preset) + 1) % values.length]
        ],
      );
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
    IINATAN.settingsButton(
      "anki-config",
      "Configure Anki deck/model…",
      IINATAN.configureAnki,
    ),
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
