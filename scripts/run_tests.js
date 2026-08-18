#!/usr/bin/env node

const { spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 180000;
const TESTS = [
  ["language", "tests/languages.test.js"],
  ["language", "tests/lookup_protocol_golden.test.js"],
  ["settings", "tests/mpv_config_v2.test.js"],
  ["mpv-ui", "tests/mpv_ass_toolkit.test.js"],
  ["mpv-ui", "tests/mpv_popup_interactions.test.js"],
  ["mpv-ui", "tests/mpv_dictionary_document.test.js"],
  ["mpv-worker", "tests/mpv_worker_scheduler.test.js"],
  ["mpv-anki", "tests/mpv_anki_end_to_end.test.js"],
  ["mpv-audio", "tests/mpv_sentence_audio.test.js"],
  ["mpv-ocr", "tests/mpv_ocr_controller.test.js"],
  ["native", "tests/native_ass_geometry.test.js"],
  ["native", "tests/native_text_layout_protocol.test.js"],
  ["native", "tests/native_config_transaction.test.js"],
  ["native", "tests/native_portable_smoke.test.js"],
  ["native", "tests/native_worker_lifecycle.test.js"],
  ["native", "tests/native_ocr_smoke.test.js"],
  ["mpv-runtime", "tests/mpv_041_runtime.test.js"],
  ["release", "tests/release_notes.test.js"],
  ["release", "tests/mpv_release_validation.test.js"],
  ["build", "tests/check_generated_syntax.js"],
];

function parseArguments(argv) {
  const options = { groups: [], excludedGroups: [], list: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--list") options.list = true;
    else if (argument === "--group" && argv[index + 1])
      options.groups.push(argv[++index]);
    else if (argument === "--exclude-group" && argv[index + 1])
      options.excludedGroups.push(argv[++index]);
    else throw new Error("Unknown test-runner argument: " + argument);
  }
  return options;
}

function runOne(entry) {
  const [group, file, args = [], executable = process.execPath] = entry;
  const startedAt = process.hrtime.bigint();
  return new Promise((resolve) => {
    const child = spawn(executable, [file, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    let timedOut = false;
    let forceKillTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
    }, DEFAULT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ group, file, ok: false, elapsedMs: 0, error });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      resolve({
        group,
        file,
        ok: code === 0 && !timedOut,
        elapsedMs,
        error: timedOut
          ? new Error("timed out")
          : code === 0
            ? null
            : new Error("exit " + String(code) + (signal ? "/" + signal : "")),
      });
    });
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const included = options.groups.length
    ? TESTS.filter(([group]) => options.groups.includes(group))
    : TESTS;
  const selected = included.filter(
    ([group]) => !options.excludedGroups.includes(group),
  );
  if (options.list) {
    selected.forEach(([group, file]) => console.log(group + "\t" + file));
    return;
  }
  if (!selected.length)
    throw new Error("No tests matched groups: " + options.groups.join(", "));

  const results = [];
  for (const entry of selected) {
    const result = await runOne(entry);
    results.push(result);
    console.log(
      "[" +
        (result.ok ? "pass" : "FAIL") +
        "] " +
        result.group +
        " " +
        result.file +
        " " +
        result.elapsedMs.toFixed(0) +
        "ms",
    );
  }

  const failures = results.filter((result) => !result.ok);
  const elapsedMs = results.reduce(
    (total, result) => total + result.elapsedMs,
    0,
  );
  console.log(
    "\n" +
      String(results.length - failures.length) +
      "/" +
      String(results.length) +
      " tests passed in " +
      (elapsedMs / 1000).toFixed(2) +
      "s",
  );
  if (failures.length) {
    failures.forEach((failure) => {
      console.error(
        "FAILED " +
          failure.group +
          " " +
          failure.file +
          ": " +
          failure.error.message,
      );
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
