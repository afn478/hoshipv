"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DictionaryCatalog } = require("../../src/services/dictionary-catalog");
const {
  recommendedDictionaryById,
} = require("../../src/services/recommended-dictionaries");
const { SettingsStore } = require("../../src/settings/settings-store");
const { HoshiWorker } = require("../../src/services/hoshi-worker");

const root = path.resolve(__dirname, "../..");

function publicDiagnostic(value) {
  const text = String(value);
  const escapedRoot = root.replaceAll("\\", "\\\\");
  const escapedHome = os.homedir().replaceAll("\\", "\\\\");
  return text
    .replaceAll(root, "<repo>")
    .replaceAll(escapedRoot, "<repo>")
    .replaceAll(os.homedir(), "<home>")
    .replaceAll(escapedHome, "<home>");
}

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function skip(message) {
  console.log(`SKIP: ${message}`);
}

async function main() {
  const required = process.env.IINATAN_DICTIONARY_DOWNLOAD_REQUIRED === "1";
  if (!required) {
    skip(
      "set IINATAN_DICTIONARY_DOWNLOAD_REQUIRED=1 to exercise the live recommended-dictionary download",
    );
    return;
  }

  const executable = path.resolve(
    process.env.IINATAN_HOSHI ||
      path.join(
        root,
        "bin",
        process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts",
      ),
  );
  if (!(await exists(executable)))
    throw new Error(`HoshiDicts executable is unavailable: ${executable}`);

  const dictionaryId = process.env.IINATAN_DICTIONARY_DOWNLOAD_ID || "jitendex-ja-en";
  const recommended = recommendedDictionaryById(dictionaryId);
  if (!recommended) throw new Error(`unknown recommended dictionary: ${dictionaryId}`);

  const version = spawnSync(executable, ["version"], { encoding: "utf8" });
  if (version.error || version.status !== 0)
    throw new Error(
      `HoshiDicts version command failed: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-recommended-dictionary-smoke-"),
  );
  const settingsStore = new SettingsStore(path.join(temporaryRoot, "settings.json"));
  const worker = new HoshiWorker({
    executable,
    root: path.join(temporaryRoot, "worker"),
    timeoutMs: numberFromEnvironment("IINATAN_HOSHI_READY_TIMEOUT_MS", 1800000),
    pollMs: 4,
  });
  const catalog = new DictionaryCatalog({
    settingsStore,
    installRoot: path.join(temporaryRoot, "dictionaries"),
    worker,
  });
  const timings = {};
  let lastProgressAt = 0;
  let lastProgressBytes = 0;

  try {
    await catalog.load();
    const downloadStarted = Date.now();
    const entry = await catalog.downloadRecommended(dictionaryId, {
      downloadTimeoutMs: numberFromEnvironment(
        "IINATAN_DICTIONARY_DOWNLOAD_TIMEOUT_MS",
        900000,
      ),
      importTimeoutMs: numberFromEnvironment(
        "IINATAN_DICTIONARY_IMPORT_TIMEOUT_MS",
        1800000,
      ),
      lowRam: true,
      onProgress(progress) {
        const now = Date.now();
        const bytes = Number(progress.bytes) || 0;
        if (now - lastProgressAt < 1000 && bytes - lastProgressBytes < 1024 * 1024)
          return;
        lastProgressAt = now;
        lastProgressBytes = bytes;
        const total = progress.totalBytes
          ? ` / ${formatBytes(progress.totalBytes)}`
          : "";
        console.log(`download: ${formatBytes(bytes)}${total}`);
      },
    });
    timings.downloadAndImportMs = Date.now() - downloadStarted;

    const installed = catalog
      .list({ includeDisabled: true })
      .find((value) => value.id === dictionaryId);
    if (!installed || installed.path !== entry.path)
      throw new Error(
        "recommended dictionary was not registered at its managed install path",
      );

    const readyStarted = Date.now();
    const ready = await worker.configure({
      language: recommended.language,
      dictionaries: catalog.activePaths(),
      fingerprint: `recommended-download-smoke:${dictionaryId}:${entry.path}`,
    });
    timings.readyMs = Date.now() - readyStarted;

    const lookupText = process.env.IINATAN_HOSHI_TEXT || "猫を見る";
    const lookupStarted = Date.now();
    const result = await worker.lookup({
      requestId: "recommended-dictionary-download-smoke-1",
      text: lookupText,
      maxResults: 5,
      maxGlossaries: 3,
      scanLength: 24,
      mode: process.env.IINATAN_HOSHI_MODE || "yomitan-japanese",
    });
    timings.lookupMs = Date.now() - lookupStarted;
    if (!result || result.ok !== true || !Array.isArray(result.results))
      throw new Error("HoshiDicts lookup returned an invalid response");
    if (!result.results.length)
      throw new Error(
        `HoshiDicts lookup returned no results for ${JSON.stringify(lookupText)}`,
      );

    console.log(
      publicDiagnostic(
        JSON.stringify(
          {
            backend: JSON.parse(String(version.stdout).trim()),
            recommended: {
              id: recommended.id,
              title: recommended.title,
              language: recommended.language,
              downloadUrl: recommended.downloadUrl,
            },
            installed: {
              id: entry.id,
              path: entry.path,
              title: entry.title,
              language: entry.language,
              enabled: installed.enabled,
            },
            ready: {
              ok: ready.ok,
              dictCount: ready.dictCount,
              assGeometry: ready.assGeometry || null,
            },
            lookup: {
              text: lookupText,
              resultCount: result.results.length,
              first: {
                matched: result.results[0].matched || null,
                deinflected: result.results[0].deinflected || null,
                headword: result.results[0].term?.expression || null,
              },
            },
            timings,
            mode: "recommended-dictionary-download-smoke",
          },
          null,
          2,
        ),
      ),
    );
  } finally {
    await worker.stop().catch(() => {});
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `RECOMMENDED DICTIONARY DOWNLOAD SMOKE FAILED: ${publicDiagnostic(error.stack || error.message)}`,
  );
  process.exitCode = 1;
});
