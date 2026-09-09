"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "docs", "iina-popup-parity.json");

async function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.match(
    String(manifest.sourceSnapshotCommit || ""),
    /^[0-9a-f]{40}$/u,
    "popup source snapshot commit is invalid",
  );
  for (const entry of manifest.presentationFiles || []) {
    const relative = String(entry.path || "");
    const filePath = path.resolve(root, relative);
    assert.equal(
      filePath.startsWith(`${root}${path.sep}`),
      true,
      `popup presentation path escapes the repository: ${relative}`,
    );
    assert.equal(
      await sha256(filePath),
      entry.sha256,
      `popup parity drift: ${relative}`,
    );
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "iina-popup-parity-manifest",
        sourceSnapshotCommit: manifest.sourceSnapshotCommit,
        files: manifest.presentationFiles.map((entry) => entry.path),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`IINA POPUP PARITY VALIDATION FAILED: ${error.message}`);
  process.exitCode = 1;
});
