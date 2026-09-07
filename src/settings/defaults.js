"use strict";

const { DEFAULTS, normalizeBindings } = require("../interaction/controller-bindings");

const DEFAULT_AUDIO_SOURCE_URL = "http://127.0.0.1:5050/?term={term}&reading={reading}";
const DEFAULT_AUDIO_SOURCES_JSON = JSON.stringify([{ url: DEFAULT_AUDIO_SOURCE_URL }]);
const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";

// Keep this list aligned with the reference iinatan settings surface. The count
// is asserted below because silently dropping a preference during a migration is
// worse than carrying an unused compatibility value forward.
const PROFILE_PREFERENCE_DEFAULTS = Object.freeze({
  enabledByDefault: true,
  hideNativeSubtitles: true,
  bitmapSubtitleOcrEnabled: true,
  bitmapSubtitleOcrPrefetchEnabled: false,
  bitmapSubtitleOcrScreenshotFallbackEnabled: false,
  experimentalNativeSubtitleHitLayer: true,
  experimentalNativeSubtitleLookupHighlight: true,
  experimentalNativeSubtitleHitBoxes: false,
  experimentalNativeSubtitleTextOpacity: 0,
  experimentalNativeSubtitleValidation: false,
  pauseWhilePopupVisible: true,
  audioAutoPlay: false,
  audioSourcesJson: DEFAULT_AUDIO_SOURCES_JSON,
  ankiEnabled: false,
  ankiConnectUrl: DEFAULT_ANKI_CONNECT_URL,
  ankiConnectTimeoutSeconds: 3,
  ankiDeckName: "",
  ankiModelName: "",
  ankiFieldTemplatesJson: "{}",
  ankiTags: "iinatan",
  ankiAudioFormat: "mp3",
  ankiAudioBitrateKbps: 96,
  ankiImageQuality: 85,
  ankiDuplicateCheck: true,
  ankiDuplicateMode: "prevent",
  ankiDuplicateScope: "deck",
  ankiSentenceAudioPaddingMs: 250,
  lookupLanguage: "ja",
  scanLength: 24,
  maxEntries: 3,
  maxGlossesPerEntry: 4,
  lookupTimeoutMs: 9000,
  fontScale: 1,
  popupScale: 0.92,
  popupMinWidth: 250,
  popupMaxWidth: 440,
  popupMaxHeightVh: 34,
  popupSubtitleGapPx: 34,
  subtitleLookupMode: "hover",
  nestedPopupMode: "off",
  nestedPopupMaxDepth: 3,
  flattenSubtitleLineBreaks: false,
  popupTheme: "inherit",
  subtitlePollMs: 120,
  etymologyCollapseDefault: "collapsed",
  wiktionaryEtymologyCollapseOverride: "collapsed",
  customPopupCss: "",
  hoverRequestTimeoutMs: 15000,
  backendTimeoutMs: 30000,
  debugLogEnabled: true,
  debugLogVerbose: false,
  directWorkerIpc: true,
  fallbackToClientExec: true,
  directIpcPollMs: 2,
  workerIdleSleepMs: 2,
  controllerEnabled: false,
  controllerNoPopupBindingsJson: JSON.stringify(DEFAULTS.noPopup),
  controllerPopupBindingsJson: JSON.stringify(DEFAULTS.popup),
  controllerAudioBindingsJson: JSON.stringify(DEFAULTS.audio),
});

const GLOBAL_SETTINGS_DEFAULTS = Object.freeze({
  lowRamImport: true,
  importTimeoutMs: 1800000,
});

const PROFILE_PREFERENCE_KEYS = Object.freeze(Object.keys(PROFILE_PREFERENCE_DEFAULTS));
const GLOBAL_SETTINGS_KEYS = Object.freeze(Object.keys(GLOBAL_SETTINGS_DEFAULTS));

if (PROFILE_PREFERENCE_KEYS.length !== 59)
  throw new Error("profile preference inventory must contain 59 keys");
if (GLOBAL_SETTINGS_KEYS.length !== 2)
  throw new Error("global settings inventory must contain 2 keys");

const LANGUAGES = Object.freeze([
  {
    id: "ja",
    label: "Japanese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
    experimental: false,
  },
  {
    id: "en",
    label: "English",
    lookupUnit: "word",
    wordMode: "latin-word",
    experimental: false,
  },
  {
    id: "de",
    label: "German",
    lookupUnit: "word",
    wordMode: "latin-word",
    experimental: false,
  },
  {
    id: "fr",
    label: "French",
    lookupUnit: "word",
    wordMode: "latin-word",
    experimental: false,
  },
  {
    id: "ko",
    label: "Korean",
    lookupUnit: "word",
    wordMode: "korean-word",
    experimental: true,
  },
  {
    id: "zh",
    label: "Chinese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
    experimental: false,
  },
]);

const BOOLEAN_KEYS = new Set([
  "enabledByDefault",
  "hideNativeSubtitles",
  "bitmapSubtitleOcrEnabled",
  "bitmapSubtitleOcrPrefetchEnabled",
  "bitmapSubtitleOcrScreenshotFallbackEnabled",
  "experimentalNativeSubtitleHitLayer",
  "experimentalNativeSubtitleLookupHighlight",
  "experimentalNativeSubtitleHitBoxes",
  "experimentalNativeSubtitleValidation",
  "pauseWhilePopupVisible",
  "audioAutoPlay",
  "ankiEnabled",
  "ankiDuplicateCheck",
  "debugLogEnabled",
  "debugLogVerbose",
  "directWorkerIpc",
  "fallbackToClientExec",
  "controllerEnabled",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  return fallback;
}

function normalizeUrl(value, fallback) {
  const url = String(value || "").trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(url) ? url.replace(/\/+$/, "") : fallback;
}

function normalizeBindingsJson(value, context) {
  return JSON.stringify(normalizeBindings(value, context));
}

function normalizePreferences(input) {
  const source =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const result = clone(PROFILE_PREFERENCE_DEFAULTS);
  PROFILE_PREFERENCE_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  });
  BOOLEAN_KEYS.forEach((key) => {
    result[key] = bool(result[key], PROFILE_PREFERENCE_DEFAULTS[key]);
  });
  result.experimentalNativeSubtitleTextOpacity = clamp(
    result.experimentalNativeSubtitleTextOpacity,
    0,
    1,
    0,
  );
  result.lookupLanguage = LANGUAGES.some(
    (language) => language.id === result.lookupLanguage,
  )
    ? result.lookupLanguage
    : "ja";
  result.scanLength = Math.round(clamp(result.scanLength, 1, 128, 24));
  result.maxEntries = Math.round(clamp(result.maxEntries, 1, 20, 3));
  result.maxGlossesPerEntry = Math.round(clamp(result.maxGlossesPerEntry, 1, 40, 4));
  result.lookupTimeoutMs = Math.round(clamp(result.lookupTimeoutMs, 250, 120000, 9000));
  result.fontScale = clamp(result.fontScale, 0.5, 3, 1);
  result.popupScale = clamp(result.popupScale, 0.5, 2, 0.92);
  result.popupMinWidth = Math.round(clamp(result.popupMinWidth, 180, 1600, 250));
  result.popupMaxWidth = Math.max(
    result.popupMinWidth,
    Math.round(clamp(result.popupMaxWidth, result.popupMinWidth, 2200, 440)),
  );
  result.popupMaxHeightVh = clamp(result.popupMaxHeightVh, 15, 90, 34);
  result.popupSubtitleGapPx = Math.round(clamp(result.popupSubtitleGapPx, 0, 300, 34));
  result.subtitlePollMs = Math.round(clamp(result.subtitlePollMs, 30, 1000, 120));
  result.nestedPopupMaxDepth = Math.round(clamp(result.nestedPopupMaxDepth, 0, 8, 3));
  result.hoverRequestTimeoutMs = Math.round(
    clamp(result.hoverRequestTimeoutMs, 250, 120000, 15000),
  );
  result.backendTimeoutMs = Math.round(
    clamp(result.backendTimeoutMs, 1000, 300000, 30000),
  );
  result.directIpcPollMs = Math.round(clamp(result.directIpcPollMs, 1, 100, 2));
  result.workerIdleSleepMs = Math.round(clamp(result.workerIdleSleepMs, 1, 1000, 2));
  result.ankiConnectUrl = normalizeUrl(result.ankiConnectUrl, DEFAULT_ANKI_CONNECT_URL);
  result.ankiConnectTimeoutSeconds = Math.round(
    clamp(result.ankiConnectTimeoutSeconds, 1, 30, 3),
  );
  result.ankiAudioFormat = result.ankiAudioFormat === "opus" ? "opus" : "mp3";
  result.ankiAudioBitrateKbps = Math.round(
    clamp(result.ankiAudioBitrateKbps, 24, 320, 96),
  );
  result.ankiImageQuality = Math.round(clamp(result.ankiImageQuality, 1, 100, 85));
  result.ankiDuplicateMode = result.ankiDuplicateMode === "allow" ? "allow" : "prevent";
  result.ankiDuplicateScope =
    result.ankiDuplicateScope === "collection" ? "collection" : "deck";
  result.ankiSentenceAudioPaddingMs = Math.round(
    clamp(result.ankiSentenceAudioPaddingMs, 0, 2000, 250),
  );
  result.subtitleLookupMode = ["shift-hover", "modifier-hover"].includes(
    result.subtitleLookupMode,
  )
    ? "shift-hover"
    : "hover";
  result.nestedPopupMode = ["off", "click", "hover", "shift-hover"].includes(
    result.nestedPopupMode,
  )
    ? result.nestedPopupMode
    : "off";
  result.popupTheme = ["inherit", "dark", "light"].includes(result.popupTheme)
    ? result.popupTheme
    : "inherit";
  result.etymologyCollapseDefault =
    result.etymologyCollapseDefault === "expanded" ? "expanded" : "collapsed";
  result.wiktionaryEtymologyCollapseOverride = [
    "collapsed",
    "expanded",
    "inherit",
  ].includes(result.wiktionaryEtymologyCollapseOverride)
    ? result.wiktionaryEtymologyCollapseOverride
    : "collapsed";
  result.customPopupCss = String(result.customPopupCss || "").slice(0, 200000);
  result.audioSourcesJson = String(
    result.audioSourcesJson || DEFAULT_AUDIO_SOURCES_JSON,
  );
  result.ankiFieldTemplatesJson = String(result.ankiFieldTemplatesJson || "{}");
  result.controllerNoPopupBindingsJson = normalizeBindingsJson(
    result.controllerNoPopupBindingsJson,
    "noPopup",
  );
  result.controllerPopupBindingsJson = normalizeBindingsJson(
    result.controllerPopupBindingsJson,
    "popup",
  );
  result.controllerAudioBindingsJson = normalizeBindingsJson(
    result.controllerAudioBindingsJson,
    "audio",
  );
  return result;
}

function normalizeGlobalSettings(input) {
  const source =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    lowRamImport: bool(source.lowRamImport, GLOBAL_SETTINGS_DEFAULTS.lowRamImport),
    importTimeoutMs: Math.round(
      clamp(
        source.importTimeoutMs,
        60000,
        7200000,
        GLOBAL_SETTINGS_DEFAULTS.importTimeoutMs,
      ),
    ),
  };
}

function normalizeSettingsDocument(input) {
  const source =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawProfiles =
    source.profiles &&
    typeof source.profiles === "object" &&
    !Array.isArray(source.profiles)
      ? source.profiles
      : {};
  const profiles = {};
  Object.keys(rawProfiles).forEach((id) => {
    const raw =
      rawProfiles[id] && typeof rawProfiles[id] === "object" ? rawProfiles[id] : {};
    profiles[String(id)] = {
      id: String(raw.id || id),
      name: String(raw.name || id || "Default").slice(0, 120),
      preferences: normalizePreferences(raw.preferences || raw),
      dictionaryOrder: Array.isArray(raw.dictionaryOrder || raw.dictionaries)
        ? (raw.dictionaryOrder || raw.dictionaries).map(String).filter(Boolean)
        : [],
      disabledDictionaries: Array.isArray(raw.disabledDictionaries)
        ? raw.disabledDictionaries.map(String).filter(Boolean)
        : [],
    };
  });
  if (!Object.keys(profiles).length) {
    profiles.default = {
      id: "default",
      name: "Default",
      preferences: normalizePreferences({}),
      dictionaryOrder: [],
      disabledDictionaries: [],
    };
  }
  const activeProfileId = profiles[source.activeProfileId]
    ? String(source.activeProfileId)
    : Object.keys(profiles)[0];
  return {
    schemaVersion: 1,
    activeProfileId,
    global: normalizeGlobalSettings(source.global),
    profiles,
    dictionaries: Array.isArray(source.dictionaries) ? clone(source.dictionaries) : [],
    pendingDictionaryReferences: Array.isArray(source.pendingDictionaryReferences)
      ? clone(source.pendingDictionaryReferences)
      : [],
    migration:
      source.migration && typeof source.migration === "object"
        ? clone(source.migration)
        : {},
  };
}

module.exports = {
  DEFAULT_AUDIO_SOURCE_URL,
  DEFAULT_AUDIO_SOURCES_JSON,
  DEFAULT_ANKI_CONNECT_URL,
  GLOBAL_SETTINGS_DEFAULTS,
  GLOBAL_SETTINGS_KEYS,
  LANGUAGES,
  PROFILE_PREFERENCE_DEFAULTS,
  PROFILE_PREFERENCE_KEYS,
  normalizeGlobalSettings,
  normalizePreferences,
  normalizeSettingsDocument,
};
