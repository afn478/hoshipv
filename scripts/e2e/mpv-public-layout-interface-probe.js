"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function luaString(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")}"`;
}

function mpvVersion(executable) {
  const result = spawnSync(executable, ["--version"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `mpv --version failed: ${result.error?.message || result.stderr || result.status}`,
    );
  return String(result.stdout || "")
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
}

async function waitForFile(filePath, child, stderr) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    if (child.exitCode !== null)
      throw new Error(
        `mpv exited before the public layout result was written: ${
          stderr().trim() || `exit ${child.exitCode}`
        }`,
      );
    await delay(50);
  }
  throw new Error(
    `timed out waiting for the public layout result${stderr().trim() ? `: ${stderr().trim()}` : ""}`,
  );
}

async function main() {
  if (process.env.IINATAN_PUBLIC_LAYOUT_REQUIRED !== "1") {
    console.log(
      "SKIP: public mpv layout-interface evidence requires IINATAN_PUBLIC_LAYOUT_REQUIRED=1 in a graphical session.",
    );
    return;
  }

  const executable = process.env.IINATAN_MPV || "mpv";
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "iinatan-mpv-public-layout-"),
  );
  const scriptPath = path.join(temporaryRoot, "probe.lua");
  const resultPath = path.join(temporaryRoot, "result.json");
  const logPath = path.join(temporaryRoot, "mpv.log");
  const glyphs = [..."Careful"];
  const luaGlyphs = glyphs
    .map(
      (glyph, index) =>
        `  report.units[${index + 1}] = measure(${index + 1}, ${luaString(`{\\an7}${glyph}`)})`,
    )
    .join("\n");
  fs.writeFileSync(
    scriptPath,
    [
      "local utils = require 'mp.utils'",
      "local function measure(id, data)",
      "  local overlay = mp.create_osd_overlay('ass-events')",
      "  overlay.id = id",
      "  overlay.res_x = 1280",
      "  overlay.res_y = 720",
      "  overlay.data = data",
      "  overlay.hidden = true",
      "  overlay.compute_bounds = true",
      "  local ok, result = pcall(function() return overlay:update() end)",
      "  overlay:remove()",
      "  return { ok = ok, result = result }",
      "end",
      "mp.add_timeout(0.5, function()",
      "  local report = {",
      `    whole = measure(100, ${luaString("{\\an7}Careful")}),`,
      "    units = {},",
      "  }",
      luaGlyphs.replaceAll("\n", "\n  "),
      `  local output = io.open(${luaString(resultPath)}, "w")`,
      "  output:write(utils.format_json(report))",
      "  output:close()",
      "  mp.command('quit')",
      "end)",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  let child = null;
  let stderr = "";
  try {
    child = spawn(
      executable,
      [
        "--no-config",
        "--idle=yes",
        "--force-window=immediate",
        "--no-terminal",
        "--vo=gpu-next",
        "--geometry=1280x720",
        `--script=${scriptPath}`,
        `--log-file=${logPath}`,
      ],
      {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await waitForFile(resultPath, child, () => {
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
      return `${stderr}\n${log.slice(-4000)}`;
    });
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (
      !result?.whole?.ok ||
      !result.whole.result ||
      !Array.isArray(result.units) ||
      result.units.length !== glyphs.length ||
      result.units.some((unit) => !unit?.ok || !unit.result)
    )
      throw new Error(
        `public layout probe returned incomplete bounds: ${JSON.stringify(result)}`,
      );

    console.log(
      JSON.stringify(
        {
          ok: true,
          mpv: mpvVersion(executable),
          interface: "mp.create_osd_overlay(ass-events)+compute_bounds",
          granularity: "one aggregate rectangle per submitted overlay",
          whole: result.whole.result,
          units: result.units.map((unit, index) => ({
            glyph: glyphs[index],
            bounds: unit.result,
          })),
          conclusion:
            "The supported API measures synthetic overlays only; it does not expose per-glyph layout for mpv's built-in subtitle event or its live style/collision state.",
          mode: "public-mpv-layout-interface-probe",
        },
        null,
        2,
      ),
    );
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `PUBLIC MPV LAYOUT INTERFACE PROBE FAILED: ${error.stack || error.message}`,
  );
  process.exitCode = 1;
});
