"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { HoshiWorker } = require("../../src/services/hoshi-worker");

const root = path.resolve(__dirname, "../..");

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function firstImportedDirectory(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidate = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name))[0];
  return candidate ? path.join(directory, candidate.name) : null;
}

function skip(message) {
  console.log(`SKIP: ${message}`);
}

async function main() {
  const executable = path.resolve(
    process.env.IINATAN_HOSHI ||
      path.join(
        root,
        "bin",
        process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts",
      ),
  );
  const dictionaryPath = process.env.IINATAN_DICTIONARY_PATH
    ? path.resolve(process.env.IINATAN_DICTIONARY_PATH)
    : null;
  const dictionaryZip = process.env.IINATAN_DICTIONARY_ZIP
    ? path.resolve(process.env.IINATAN_DICTIONARY_ZIP)
    : null;
  const required = process.env.IINATAN_HOSHI_REQUIRED === "1";

  if (!(await exists(executable))) {
    if (required)
      throw new Error(`HoshiDicts executable is unavailable: ${executable}`);
    skip("set IINATAN_HOSHI to run the HoshiDicts worker smoke");
    return;
  }
  if (!dictionaryPath && !dictionaryZip) {
    if (required)
      throw new Error(
        "set IINATAN_DICTIONARY_PATH or IINATAN_DICTIONARY_ZIP for the HoshiDicts smoke",
      );
    skip(
      "set IINATAN_DICTIONARY_PATH or IINATAN_DICTIONARY_ZIP to exercise a real dictionary",
    );
    return;
  }

  const version = spawnSync(executable, ["version"], { encoding: "utf8" });
  if (version.error || version.status !== 0)
    throw new Error(
      `HoshiDicts version command failed: ${version.error?.message || version.stderr || "unknown error"}`,
    );

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-hoshi-worker-smoke-"),
  );
  const workerRoot = path.join(temporaryRoot, "worker");
  const importedRoot = path.join(temporaryRoot, "dictionaries");
  let worker = null;
  let activeDictionaryPath = dictionaryPath;
  const timings = {};
  try {
    if (dictionaryZip) {
      if (!(await exists(dictionaryZip)))
        throw new Error(`dictionary ZIP is unavailable: ${dictionaryZip}`);
      worker = new HoshiWorker({
        executable,
        root: workerRoot,
        timeoutMs: 1800000,
        pollMs: 4,
      });
      const importStarted = Date.now();
      const imported = await worker.importDictionary(dictionaryZip, importedRoot);
      timings.importMs = Date.now() - importStarted;
      activeDictionaryPath = await firstImportedDirectory(importedRoot);
      if (!activeDictionaryPath)
        throw new Error(
          `HoshiDicts import returned no dictionary directory: ${JSON.stringify(imported)}`,
        );
    }
    if (!activeDictionaryPath || !(await exists(activeDictionaryPath)))
      throw new Error(`dictionary directory is unavailable: ${activeDictionaryPath}`);

    worker ||= new HoshiWorker({
      executable,
      root: workerRoot,
      timeoutMs: 30000,
      pollMs: 4,
    });
    const readyStarted = Date.now();
    const ready = await worker.configure({
      language: process.env.IINATAN_HOSHI_LANGUAGE || "ja",
      dictionaries: [activeDictionaryPath],
      fingerprint: `smoke:${activeDictionaryPath}`,
    });
    timings.readyMs = Date.now() - readyStarted;
    const lookupStarted = Date.now();
    const lookupText = process.env.IINATAN_HOSHI_TEXT || "猫を見る";
    const result = await worker.lookup({
      requestId: "hoshi-smoke-1",
      text: lookupText,
      maxResults: 3,
      maxGlossaries: 2,
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
      JSON.stringify(
        {
          backend: JSON.parse(String(version.stdout).trim()),
          dictionaryPath: activeDictionaryPath,
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
          mode: "hoshidicts-worker-smoke",
        },
        null,
        2,
      ),
    );
  } finally {
    await worker?.stop().catch(() => {});
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`HOSHIDICTS WORKER SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
