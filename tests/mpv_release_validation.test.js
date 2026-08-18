const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const validator = path.join(root, "scripts", "validate_mpv_release.py");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-release-"));

function archive(name, files) {
  const packageRoot = path.join(temporary, name);
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(packageRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  const output = path.join(temporary, `${name}.tar.gz`);
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import pathlib,sys,tarfile\nr=pathlib.Path(sys.argv[1])\nwith tarfile.open(sys.argv[2],'w:gz') as a:a.add(r,arcname=r.name)",
      packageRoot,
      output,
    ],
    { encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0, result.stderr);
  return output;
}

function reject(release, pattern) {
  const result = spawnSync(
    "python3",
    [validator, release, "--target", "linux-x86_64"],
    { encoding: "utf8" },
  );
  assert.notStrictEqual(result.status, 0, "invalid release was accepted");
  assert.match(result.stderr + result.stdout, pattern);
}

try {
  reject(archive("missing", {}), /SHA256SUMS/);
  reject(
    archive("wrong-target", {
      SHA256SUMS: "",
      "BUILD-INFO.json": JSON.stringify({
        target: "macos-aarch64",
        wrapperVersion: "3.0.0",
      }),
    }),
    /target metadata/,
  );
  reject(
    archive("stale", {
      SHA256SUMS: "",
      "BUILD-INFO.json": JSON.stringify({
        target: "linux-x86_64",
        wrapperVersion: "2.1.4",
      }),
    }),
    /version is stale/,
  );
  reject(
    archive("checksum", {
      SHA256SUMS: `${"0".repeat(64)}  BUILD-INFO.json\n`,
      "BUILD-INFO.json": JSON.stringify({
        target: "linux-x86_64",
        wrapperVersion: "3.0.0",
      }),
    }),
    /checksum failed/,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("release rejection tests passed");
