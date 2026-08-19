IINATAN.CONFIG_SCHEMA_VERSION = 2;
IINATAN.DEFAULT_CONFIG = {
  schemaVersion: 2,
  global: {
    backendPath: "~~/scripts/iinatan/bin/iinatan-backend",
    ffmpegPath: "~~/scripts/iinatan/bin/ffmpeg",
    logPath: "~~state/iinatan/iinatan.log",
    lowRamImport: true,
    recommendedDictionaries: [
      {
        title: "Jitendex (Japanese → English)",
        url: "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip",
      },
    ],
  },
  dictionaries: [],
  pendingDictionaries: [],
  activeProfileId: "default",
  profiles: {
    default: {
      name: "Default",
      enabled: true,
      dictionaries: [],
      lookupLanguage: "ja",
      scanLength: 24,
      maxEntries: 3,
      maxGlossesPerEntry: 4,
      lookupTimeoutMs: 9000,
      subtitleLookupMode: "hover",
      flattenSubtitleLineBreaks: false,
      pauseWhilePopupVisible: true,
      nestedPopupMode: "off",
      nestedPopupMaxDepth: 3,
      popupScale: 0.92,
      popupMinWidth: 700,
      popupMaxWidth: 770,
      popupMaxHeightVh: 34,
      popupSubtitleGapPx: 24,
      theme: {
        preset: "dark",
        background: "181a20",
        foreground: "f4f4f5",
        accent: "8ab4f8",
        muted: "a1a1aa",
        border: "3f3f46",
      },
      audio: {
        autoPlay: false,
        sources: [
          { url: "http://127.0.0.1:5050/?term={term}&reading={reading}" },
        ],
      },
      ocr: { enabled: true, prefetch: false, screenshotFallback: false },
      anki: {
        enabled: false,
        connectUrl: "http://127.0.0.1:8765",
        timeoutSeconds: 3,
        deck: "",
        model: "",
        fields: {},
        tags: ["iinatan"],
        duplicateMode: "prevent",
        duplicateScope: "deck",
        audioFormat: "mp3",
        audioBitrateKbps: 96,
        imageQuality: 85,
        sentenceAudioPaddingMs: 250,
      },
    },
  },
  migration: { archivedCustomCss: "" },
};

IINATAN.clone = function (value) {
  return JSON.parse(JSON.stringify(value));
};
IINATAN.clamp = function (value, min, max, fallback) {
  var number = Number(value);
  return isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

IINATAN.normalizeConfig = function (input) {
  var out = IINATAN.clone(IINATAN.DEFAULT_CONFIG);
  var raw = input && typeof input === "object" ? input : {};
  if (raw.schemaVersion === 2) {
    Object.keys(raw).forEach(function (key) {
      out[key] = raw[key];
    });
  } else {
    var legacyProfiles =
      raw.profiles && typeof raw.profiles === "object" ? raw.profiles : {};
    out.activeProfileId = String(raw.activeProfileId || "default");
    Object.keys(legacyProfiles).forEach(function (id) {
      var old = legacyProfiles[id] || {};
      var profile = IINATAN.clone(out.profiles.default);
      Object.keys(old).forEach(function (key) {
        profile[key] = old[key];
      });
      profile.theme = IINATAN.clone(out.profiles.default.theme);
      profile.audio = {
        autoPlay: !!old.audioAutoPlay,
        sources: IINATAN.safeJsonArray(old.audioSourcesJson),
      };
      profile.ocr = {
        enabled: old.bitmapSubtitleOcrEnabled !== false,
        prefetch: !!old.bitmapSubtitleOcrPrefetchEnabled,
        screenshotFallback: !!old.bitmapSubtitleOcrScreenshotFallbackEnabled,
      };
      profile.anki = IINATAN.legacyAnki(old, out.profiles.default.anki);
      out.profiles[id] = profile;
      if (old.customPopupCss)
        out.migration.archivedCustomCss +=
          (out.migration.archivedCustomCss ? "\n\n" : "") +
          String(old.customPopupCss);
    });
  }
  if (!out.profiles || typeof out.profiles !== "object")
    out.profiles = {
      default: IINATAN.clone(IINATAN.DEFAULT_CONFIG.profiles.default),
    };
  if (!out.profiles[out.activeProfileId])
    out.activeProfileId = Object.keys(out.profiles)[0] || "default";
  if (!out.profiles[out.activeProfileId])
    out.profiles.default = IINATAN.clone(
      IINATAN.DEFAULT_CONFIG.profiles.default,
    );
  out.schemaVersion = 2;
  out.dictionaries = Array.isArray(out.dictionaries) ? out.dictionaries : [];
  out.pendingDictionaries = Array.isArray(out.pendingDictionaries)
    ? out.pendingDictionaries
    : [];
  Object.keys(out.profiles).forEach(function (id) {
    IINATAN.normalizeProfile(out.profiles[id]);
  });
  var installed = Object.create(null);
  out.dictionaries.forEach(function (dictionary) {
    if (dictionary && dictionary.id) installed[dictionary.id] = true;
  });
  out.pendingDictionaries = out.pendingDictionaries.filter(
    function (reference) {
      var id =
        typeof reference === "string" ? reference : reference && reference.id;
      if (!id || !installed[id]) return true;
      Object.keys(out.profiles).forEach(function (profileId) {
        var list = out.profiles[profileId].dictionaries;
        if (list.indexOf(id) < 0) list.push(id);
      });
      return false;
    },
  );
  return out;
};

IINATAN.safeJsonArray = function (value) {
  try {
    var parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};

IINATAN.legacyAnki = function (old, defaults) {
  var out = IINATAN.clone(defaults);
  out.enabled = !!old.ankiEnabled;
  out.connectUrl = String(old.ankiConnectUrl || out.connectUrl);
  out.timeoutSeconds = IINATAN.clamp(old.ankiConnectTimeoutSeconds, 1, 30, 3);
  out.deck = String(old.ankiDeckName || "");
  out.model = String(old.ankiModelName || "");
  try {
    out.fields = JSON.parse(old.ankiFieldTemplatesJson || "{}");
  } catch (_) {}
  out.tags = String(old.ankiTags || "iinatan")
    .split(/\s+/)
    .filter(Boolean);
  out.duplicateMode = old.ankiDuplicateMode === "allow" ? "allow" : "prevent";
  out.duplicateScope =
    old.ankiDuplicateScope === "collection" ? "collection" : "deck";
  out.audioFormat = old.ankiAudioFormat === "opus" ? "opus" : "mp3";
  out.audioBitrateKbps = IINATAN.clamp(old.ankiAudioBitrateKbps, 24, 320, 96);
  out.imageQuality = IINATAN.clamp(old.ankiImageQuality, 1, 100, 85);
  out.sentenceAudioPaddingMs = IINATAN.clamp(
    old.ankiSentenceAudioPaddingMs,
    0,
    2000,
    250,
  );
  return out;
};

IINATAN.normalizeProfile = function (profile) {
  var defaults = IINATAN.DEFAULT_CONFIG.profiles.default;
  Object.keys(defaults).forEach(function (key) {
    if (profile[key] === undefined) profile[key] = IINATAN.clone(defaults[key]);
  });
  profile.lookupLanguage = /^(ja|en|de|fr|ko|zh)$/.test(profile.lookupLanguage)
    ? profile.lookupLanguage
    : "ja";
  profile.scanLength = IINATAN.clamp(profile.scanLength, 1, 128, 24);
  profile.maxEntries = IINATAN.clamp(profile.maxEntries, 1, 20, 3);
  profile.maxGlossesPerEntry = IINATAN.clamp(
    profile.maxGlossesPerEntry,
    1,
    40,
    4,
  );
  profile.popupMinWidth = Math.max(
    700,
    IINATAN.clamp(profile.popupMinWidth, 440, 1200, 700),
  );
  profile.popupMaxWidth = Math.max(
    profile.popupMinWidth,
    770,
    IINATAN.clamp(profile.popupMaxWidth, 300, 1600, 770),
  );
  profile.popupMaxHeightVh = IINATAN.clamp(
    profile.popupMaxHeightVh,
    15,
    90,
    34,
  );
  profile.pauseWhilePopupVisible = profile.pauseWhilePopupVisible !== false;
  profile.theme = IINATAN.validateTheme(profile.theme);
  delete profile.customPopupCss;
  delete profile.hideNativeSubtitles;
  delete profile.experimentalNativeSubtitleHitLayer;
  delete profile.directWorkerIpc;
  delete profile.fallbackToClientExec;
  delete profile.subtitlePollMs;
};

IINATAN.validateTheme = function (theme) {
  var defaults = IINATAN.DEFAULT_CONFIG.profiles.default.theme;
  var input = theme && typeof theme === "object" ? theme : {};
  var out = {
    preset: /^(dark|light|high-contrast)$/.test(input.preset)
      ? input.preset
      : defaults.preset,
  };
  ["background", "foreground", "accent", "muted", "border"].forEach(
    function (key) {
      var value = String(input[key] || defaults[key]).replace(/^#/, "");
      out[key] = /^[0-9a-fA-F]{6}$/.test(value)
        ? value.toLowerCase()
        : defaults[key];
    },
  );
  return out;
};
IINATAN.THEME_PRESETS = {
  dark: {
    preset: "dark",
    background: "181a20",
    foreground: "f4f4f5",
    accent: "8ab4f8",
    muted: "a1a1aa",
    border: "3f3f46",
  },
  light: {
    preset: "light",
    background: "fafafa",
    foreground: "18181b",
    accent: "2563eb",
    muted: "52525b",
    border: "d4d4d8",
  },
  "high-contrast": {
    preset: "high-contrast",
    background: "000000",
    foreground: "ffffff",
    accent: "ffff00",
    muted: "d4d4d4",
    border: "ffffff",
  },
};

IINATAN.configPath = "~~home/iinatan/config.json";
IINATAN.configBackupPath = "~~home/iinatan/config.json.backup";
IINATAN.loadConfig = function () {
  var override = mp.get_opt("config");
  if (override) IINATAN.configPath = override;
  var expanded = IINATAN.path(IINATAN.configPath);
  if (!override && !/^([A-Za-z]:[\\/]|\/)/.test(expanded)) {
    IINATAN.state.configError =
      "mpv --no-config requires --script-opt=iinatan-config=/absolute/path/config.json";
    IINATAN.log("error", IINATAN.state.configError);
  }
  var raw = IINATAN.readJson(IINATAN.configPath, null);
  if (!raw) raw = IINATAN.readJson(IINATAN.configBackupPath, null);
  IINATAN.config = IINATAN.normalizeConfig(raw);
  return IINATAN.config;
};

IINATAN.saveConfig = function (callback) {
  var next = IINATAN.configPath + ".next";
  var body =
    JSON.stringify(IINATAN.normalizeConfig(IINATAN.config), null, 2) + "\n";
  if (IINATAN.state.configError) {
    callback(new Error(IINATAN.state.configError));
    return;
  }
  var expanded = IINATAN.path(IINATAN.configPath),
    separator = Math.max(expanded.lastIndexOf("/"), expanded.lastIndexOf("\\"));
  IINATAN.backendCommand(
    ["ensure-dir", expanded.substring(0, separator)],
    function (directoryError) {
      if (directoryError) {
        callback(directoryError);
        return;
      }
      try {
        IINATAN.writeText(next, body);
      } catch (error) {
        callback(error);
        return;
      }
      IINATAN.backendCommand(
        [
          "fs-commit",
          IINATAN.path(next),
          expanded,
          IINATAN.path(IINATAN.configBackupPath),
        ],
        function (error) {
          if (!error) {
            var verified = IINATAN.readJson(IINATAN.configPath, null);
            if (!verified || verified.schemaVersion !== 2)
              error = new Error("config read-back verification failed");
          }
          callback(error);
        },
      );
    },
  );
};
