"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const buildRoot = path.join(root, "build", "companion-launcher");
const source = path.join(root, "native", "companion_launcher.cpp");
const output = path.join(root, "dist", "mpv-plugin", "iinatan-companion.exe");

function diagnosticPath(filePath) {
  return filePath.replaceAll(root, "<repo>");
}

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.status}`,
    );
  }
}

function configuredTool(name, fallback) {
  return process.env[name] || fallback;
}

async function main() {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ ok: true, mode: "windows-companion-launcher-skip" }));
    return;
  }

  const portable = (await fs.readdir(path.join(root, "dist"), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        /^iinatan for mpv.*\.exe$/i.test(entry.name) &&
        !/setup/i.test(entry.name),
    )
    .map((entry) => path.join(root, "dist", entry.name))
    .sort()
    .at(-1);
  if (!portable) throw new Error("portable Electron companion was not built");

  await fs.mkdir(buildRoot, { recursive: true });
  const payloadHash = crypto
    .createHash("sha256")
    .update(await fs.readFile(portable))
    .digest("hex")
    .slice(0, 16);
  await fs.writeFile(
    path.join(buildRoot, "payload-tag.h"),
    `#define IINATAN_PAYLOAD_TAG L"${payloadHash}"\n`,
  );
  const resource = path.join(buildRoot, "companion-payload.rc");
  const resourceObject = path.join(buildRoot, "companion-payload.res.o");
  await fs.writeFile(
    resource,
    `1 RCDATA "${portable.replaceAll("\\", "/").replaceAll('"', '\\"')}"\n`,
  );

  const windres = configuredTool("IINATAN_WINDRES", "windres.exe");
  const compiler = configuredTool("IINATAN_CXX", "c++.exe");
  run(windres, [resource, "-O", "coff", "-o", resourceObject]);
  run(compiler, [
    "-std=c++17",
    "-O2",
    "-static",
    "-static-libgcc",
    "-static-libstdc++",
    "-mwindows",
    "-municode",
    "-I",
    buildRoot,
    source,
    resourceObject,
    "-lshell32",
    "-o",
    output,
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "windows-companion-launcher",
        payload: diagnosticPath(portable),
        output: diagnosticPath(output),
        payloadHash,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`WINDOWS COMPANION LAUNCHER FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
