"use strict";

const RECOMMENDED_DICTIONARIES = Object.freeze([
  {
    id: "jitendex-ja-en",
    language: "ja",
    title: "Jitendex",
    languageLabel: "Japanese",
    category: "Terms",
    description:
      "Japanese-English dictionary with structured JMdict data, examples, notes, and links.",
    homepage: "https://jitendex.org",
    downloadUrl:
      "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip",
    filename: "jitendex-yomitan.zip",
    titlePrefixes: ["Jitendex"],
  },
  {
    id: "jmnedict-ja",
    language: "ja",
    title: "JMnedict",
    languageLabel: "Japanese",
    category: "Terms",
    description:
      "Japanese proper names from the Electronic Dictionary Research and Development Group.",
    homepage: "https://github.com/yomidevs/jmdict-yomitan",
    downloadUrl:
      "https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMnedict.zip",
    filename: "JMnedict.zip",
    titlePrefixes: ["JMnedict"],
  },
  {
    id: "bccwj-suw-luw-combined",
    language: "ja",
    title: "BCCWJ SUW/LUW Combined",
    languageLabel: "Japanese",
    category: "Frequency",
    description:
      "Frequency ranks from the Balanced Corpus of Contemporary Written Japanese.",
    homepage: "https://github.com/Kuuuube/yomitan-dictionaries",
    downloadUrl:
      "https://github.com/Kuuuube/yomitan-dictionaries/releases/download/yomitan-permalink/BCCWJ_SUW_LUW_combined.zip",
    filename: "BCCWJ_SUW_LUW_combined.zip",
    titlePrefixes: ["BCCWJ"],
  },
  {
    id: "jpdb-v2-kana",
    language: "ja",
    title: "JPDB v2.2 Kana",
    languageLabel: "Japanese",
    category: "Frequency",
    description: "Kana-aware frequency ranks from the JPDB corpus.",
    homepage: "https://github.com/Kuuuube/yomitan-dictionaries",
    downloadUrl:
      "https://github.com/Kuuuube/yomitan-dictionaries/releases/download/yomitan-permalink/JPDB_v2.2_Frequency_Kana.zip",
    filename: "JPDB_v2.2_Frequency_Kana.zip",
    titlePrefixes: ["JPDBv2", "JPDB v2.2"],
  },
  {
    id: "jiten-global-frequency",
    language: "ja",
    title: "Jiten Global",
    languageLabel: "Japanese",
    category: "Frequency",
    description:
      "Global Yomitan frequency dictionary generated from the Jiten media database.",
    homepage: "https://jiten.moe/other",
    downloadUrl:
      "https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan",
    downloadUrlAliases: ["https://api.jiten.moe/api/frequency-list/download"],
    filename: "jiten-global-yomitan.zip",
    titlePrefixes: ["Jiten"],
  },
  {
    id: "wty-en-en",
    language: "en",
    title: "wty-en-en",
    languageLabel: "English",
    category: "Terms",
    description: "English dictionary created from Wiktionary data.",
    homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
    downloadUrl:
      "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/en/en/wty-en-en.zip",
    filename: "wty-en-en.zip",
    titlePrefixes: ["wty-en-en"],
  },
  {
    id: "wty-de-en",
    language: "de",
    title: "wty-de-en",
    languageLabel: "German",
    category: "Terms",
    description: "German to English dictionary created from Wiktionary data.",
    homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
    downloadUrl:
      "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/de/en/wty-de-en.zip",
    filename: "wty-de-en.zip",
    titlePrefixes: ["wty-de-en"],
  },
  {
    id: "wty-fr-en",
    language: "fr",
    title: "wty-fr-en",
    languageLabel: "French",
    category: "Terms",
    description: "French to English dictionary created from Wiktionary data.",
    homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
    downloadUrl:
      "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/fr/en/wty-fr-en.zip",
    filename: "wty-fr-en.zip",
    titlePrefixes: ["wty-fr-en"],
  },
  {
    id: "cc-cedict-zh-en",
    language: "zh",
    title: "CC-CEDICT",
    languageLabel: "Chinese",
    category: "Terms",
    description: "Chinese-English dictionary provided by the CC-CEDICT project.",
    homepage: "https://github.com/MarvNC/cc-cedict-yomitan",
    downloadUrl:
      "https://github.com/MarvNC/cc-cedict-yomitan/releases/latest/download/CC-CEDICT.zip",
    filename: "CC-CEDICT.zip",
    titlePrefixes: ["CC-CEDICT"],
  },
  {
    id: "wty-zh-en",
    language: "zh",
    title: "wty-zh-en",
    languageLabel: "Chinese",
    category: "Terms",
    description: "Chinese to English dictionary created from Wiktionary data.",
    homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
    downloadUrl:
      "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/zh/en/wty-zh-en.zip",
    filename: "wty-zh-en.zip",
    titlePrefixes: ["wty-zh-en"],
  },
  {
    id: "wty-ko-en",
    language: "ko",
    title: "wty-ko-en",
    languageLabel: "Korean",
    category: "Terms",
    description: "Korean to English dictionary created from Wiktionary data.",
    homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
    downloadUrl:
      "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/ko/en/wty-ko-en.zip",
    filename: "wty-ko-en.zip",
    titlePrefixes: ["wty-ko-en"],
  },
]);

function normalizeDownloadUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch (_) {
    return "";
  }
}

function titlePrefixMatches(value, prefixes) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return (Array.isArray(prefixes) ? prefixes : []).some((prefix) => {
    const needle = String(prefix || "")
      .trim()
      .toLowerCase();
    if (!text || !needle || !text.startsWith(needle)) return false;
    const next = text[needle.length];
    return !next || !/[a-z0-9]/.test(next);
  });
}

function recommendedDictionaryById(id) {
  return RECOMMENDED_DICTIONARIES.find((item) => item.id === String(id || "")) || null;
}

function recommendedDictionaryMatches(item, installed) {
  if (!item || !installed) return false;
  if (String(installed.id || "") === item.id) return true;
  if (
    normalizeDownloadUrl(installed.downloadUrl) &&
    normalizeDownloadUrl(installed.downloadUrl) ===
      normalizeDownloadUrl(item.downloadUrl)
  )
    return true;
  return titlePrefixMatches(installed.title || installed.name, item.titlePrefixes);
}

function recommendedDictionariesForLanguage(language, installed = []) {
  const key = String(language || "ja").toLowerCase();
  const entries = Array.isArray(installed) ? installed : [];
  return RECOMMENDED_DICTIONARIES.filter((item) => item.language === key).map(
    (item) => ({
      ...item,
      installed: entries.some((entry) => recommendedDictionaryMatches(item, entry)),
    }),
  );
}

module.exports = {
  RECOMMENDED_DICTIONARIES,
  normalizeDownloadUrl,
  recommendedDictionariesForLanguage,
  recommendedDictionaryById,
  recommendedDictionaryMatches,
};
