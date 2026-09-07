"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { HoshiWorker } = require("../../src/services/hoshi-worker");

const root = path.resolve(__dirname, "../..");
const execFileAsync = promisify(execFile);
const HOSHIDICTS_REVISION = "a28d82eb0f169b8ceff79e8c99ffe0b96709ab27";

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value, 0);
  return output;
}

function u32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}

function createStoredZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value, "utf8");
    const checksum = crc32(data);
    const header = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    local.push(header);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(checksum),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += header.length;
  }
  const centralDirectory = Buffer.concat(central);
  return Buffer.concat([
    ...local,
    centralDirectory,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
}

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function executableCandidates() {
  if (process.env.IINATAN_PORTABLE_HOSHI)
    return [path.resolve(process.env.IINATAN_PORTABLE_HOSHI)];
  const extension = process.platform === "win32" ? ".exe" : "";
  return [
    path.join(root, "build", "native", `iina-hoshi-dicts${extension}`),
    path.join(root, "build", "native", "Release", `iina-hoshi-dicts${extension}`),
  ];
}

async function resolveExecutable() {
  for (const candidate of executableCandidates()) {
    if (await exists(candidate)) return candidate;
  }
  return executableCandidates()[0];
}

async function readVersion(executable) {
  const result = await execFileAsync(executable, ["version"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const lines = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const value = JSON.parse(lines.at(-1) || "{}");
  if (value.hoshidictsRevision !== HOSHIDICTS_REVISION)
    throw new Error(
      `portable helper HoshiDicts revision mismatch: ${value.hoshidictsRevision || "missing"}`,
    );
  if (value.backend !== "Manhhao/hoshidicts")
    throw new Error("portable helper reported an unexpected dictionary backend");
  if (value.assGeometry?.available !== false)
    throw new Error("portable helper advertised unsupported geometry");
  return value;
}

async function main() {
  const executable = await resolveExecutable();
  if (!(await exists(executable))) {
    if (process.env.IINATAN_PORTABLE_HOSHI_REQUIRED === "1")
      throw new Error(`portable HoshiDicts helper is unavailable: ${executable}`);
    console.log(
      `SKIP: build the portable HoshiDicts helper or set IINATAN_PORTABLE_HOSHI (${executable})`,
    );
    return;
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-portable-hoshi-smoke-"),
  );
  const zipPath = path.join(temporaryRoot, "fixture.zip");
  const dictionaryRoot = path.join(temporaryRoot, "dictionaries");
  const workerRoot = path.join(temporaryRoot, "worker");
  const dictionary = {
    title: "Portable fixture",
    revision: "1",
    format: 3,
    version: 3,
  };
  const terms = [["猫", "ねこ", "", "", 100, ["a cat"], 1, ""]];
  await fs.writeFile(
    zipPath,
    createStoredZip([
      ["index.json", JSON.stringify(dictionary)],
      ["term_bank_1.json", JSON.stringify(terms)],
    ]),
    { mode: 0o600 },
  );

  let worker = null;
  try {
    const version = await readVersion(executable);
    worker = new HoshiWorker({
      executable,
      root: workerRoot,
      timeoutMs: 30000,
      pollMs: 4,
    });
    const imported = await worker.importDictionary(zipPath, dictionaryRoot);
    const entries = await fs.readdir(dictionaryRoot, { withFileTypes: true });
    const dictionaryPath = path.join(
      dictionaryRoot,
      entries.find((entry) => entry.isDirectory())?.name || "",
    );
    if (!(await exists(dictionaryPath)))
      throw new Error(
        `portable import did not create a dictionary: ${JSON.stringify(imported)}`,
      );
    const ready = await worker.configure({
      language: "ja",
      dictionaries: [dictionaryPath],
      fingerprint: "portable-fixture",
    });
    const result = await worker.lookup({
      requestId: "portable-smoke-1",
      text: "猫を見る",
      maxResults: 3,
      maxGlossaries: 2,
      scanLength: 24,
      mode: "yomitan-japanese",
    });
    if (!result.ok || !result.results?.length)
      throw new Error("portable worker returned no lookup results");
    if (ready.hoshidictsRevision !== HOSHIDICTS_REVISION)
      throw new Error("portable worker readiness revision does not match its binary");
    if (ready.assGeometry?.available !== false)
      throw new Error("portable worker advertised unsupported geometry");
    console.log(
      JSON.stringify(
        {
          executable,
          imported: {
            ok: imported.ok,
            title: imported.title,
            termCount: imported.term_count,
          },
          ready: {
            ok: ready.ok,
            dictCount: ready.dictCount,
            hoshidictsRevision: ready.hoshidictsRevision,
            assGeometry: ready.assGeometry,
          },
          version: {
            wrapperVersion: version.wrapperVersion,
            hoshidictsRevision: version.hoshidictsRevision,
          },
          lookup: {
            resultCount: result.results.length,
            matched: result.results[0].matched,
            headword: result.results[0].term?.expression,
          },
          mode: "portable-hoshidicts-worker-smoke",
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
  console.error(`PORTABLE HOSHIDICTS SMOKE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
