"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const languages = ["ja", "en", "de", "fr", "ko", "zh"];
const textByLanguage = {
  ja: "日本語",
  en: "careful",
  de: "lesen",
  fr: "bonjour",
  ko: "한국어",
  zh: "中文",
};
const dictionaryByLanguage = {
  ja: "jitendex-ja-en",
  en: "wty-en-en",
  de: "wty-de-en",
  fr: "wty-fr-en",
  ko: "wty-ko-en",
  zh: "cc-cedict-zh-en",
};

function parseReport(stdout) {
  const start = String(stdout || "").indexOf("{");
  if (start < 0) throw new Error("desktop E2E returned no JSON report");
  return JSON.parse(String(stdout).slice(start));
}

function runLanguage(language, evidenceRoot, live) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env };
    for (const name of [
      "IINATAN_E2E_MEDIA_PATH",
      "IINATAN_E2E_SUBTITLE_ID",
      "IINATAN_E2E_SECONDARY_SUBTITLE_ID",
      "IINATAN_E2E_DICTIONARY_DOWNLOAD_ID",
      "IINATAN_E2E_DEMO_LANGUAGE",
      "IINATAN_E2E_FIXTURE_LANGUAGE",
      "IINATAN_E2E_FEATURE_PARITY",
      "IINATAN_E2E_NATIVE_LIFECYCLE_CYCLES",
      "IINATAN_E2E_RECORD_SCREEN",
      "IINATAN_E2E_SMOOTH_POPUP_APPROACH",
      "IINATAN_E2E_DEBUG",
    ])
      delete environment[name];
    Object.assign(environment, {
      IINATAN_E2E: "1",
      IINATAN_E2E_REQUIRE_STABLE_SIGNING: "1",
      IINATAN_E2E_NATIVE_INTERACTION: "1",
      IINATAN_E2E_LOOKUP_LANGUAGE: language,
      IINATAN_E2E_EVIDENCE_DIR: path.join(evidenceRoot, language),
      ...(live
        ? {
            IINATAN_E2E_FIXTURE_LANGUAGE: language,
            IINATAN_E2E_DICTIONARY_DOWNLOAD_ID: dictionaryByLanguage[language],
          }
        : { IINATAN_E2E_DEMO_LANGUAGE: language }),
    });
    const child = spawn(
      process.execPath,
      [path.join(root, "scripts", "e2e", "desktop-vertical-slice.js")],
      { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `${language} native language replay failed (${signal || `exit ${code}`}): ${stderr.slice(-4000)}\n${stdout.slice(-4000)}`,
          ),
        );
        return;
      }
      try {
        resolve(parseReport(stdout));
      } catch (error) {
        reject(
          new Error(
            `${language} native language replay returned invalid JSON: ${error.message}`,
          ),
        );
      }
    });
  });
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("SKIP: macOS native six-language matrix is macOS-only");
    return;
  }
  const evidenceRoot = path.resolve(
    process.env.IINATAN_E2E_LANGUAGE_EVIDENCE_DIR ||
      (process.argv.includes("--live")
        ? "/tmp/iinatan-e2e-macos-languages-live"
        : "/tmp/iinatan-e2e-macos-languages"),
  );
  const live = process.argv.includes("--live");
  await fs.mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const results = [];
  for (const language of languages) {
    process.stderr.write(`[iinatan-language-matrix] ${language}\n`);
    const report = await runLanguage(language, evidenceRoot, live);
    const expectedDictionaryMode = live ? "live-hoshi" : "demo";
    if (
      report.lookupLanguage !== language ||
      report.fixtureLanguage !== language ||
      (live ? report.demoLanguage !== null : report.demoLanguage !== language) ||
      report.dictionaryMode !== expectedDictionaryMode ||
      (live && report.dictionary?.id !== dictionaryByLanguage[language]) ||
      report.input?.capability?.nativeInputReady !== true
    )
      throw new Error(
        `${language} replay did not prove the expected language/native-input contract: ${JSON.stringify(
          {
            lookupLanguage: report.lookupLanguage,
            demoLanguage: report.demoLanguage,
            fixtureLanguage: report.fixtureLanguage,
            dictionaryMode: report.dictionaryMode,
            dictionary: report.dictionary,
            input: report.input?.capability,
          },
        )}`,
      );
    results.push({
      language,
      text: textByLanguage[language],
      lookupLanguage: report.lookupLanguage,
      dictionary: report.dictionary,
      nativeInput: report.input.capability,
      popup: {
        selection: report.nativeInteraction?.selection?.text || null,
        keyboard: report.nativeInteraction?.keyboard || null,
      },
      latency: report.latency || null,
      evidence: path.join(evidenceRoot, language),
    });
  }
  const summary = {
    ok: true,
    languages: results,
    evidenceRoot,
    mode: live
      ? "macos-native-live-six-language-dictionary-and-popup-matrix"
      : "macos-native-demo-six-language-routing-and-popup-matrix",
    boundary: live
      ? "This proves one real recommended HoshiDicts dictionary per language through the plugin download/import path, stock mpv, exact macOS geometry, Electron popup surfaces, and signed native input. It does not prove every available dictionary or every corpus entry."
      : "This proves six-language subtitle routing through real stock mpv, exact macOS geometry, Electron popup surfaces, and signed native input. It uses the deterministic demo dictionary and does not prove six live dictionary corpora.",
  };
  await fs.writeFile(
    path.join(evidenceRoot, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`NATIVE LANGUAGE MATRIX FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
