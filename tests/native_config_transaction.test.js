const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend =
  process.env.IINATAN_BACKEND ||
  path.join(root, "build", "native", "release", "iinatan-backend");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-config-"));
try {
  const target = path.join(temporary, "config.json");
  const backup = `${target}.backup`;
  const next = `${target}.next`;
  fs.writeFileSync(target, "not-json\n");
  fs.writeFileSync(next, '{"schemaVersion":2,"profiles":{}}\n');
  execFileSync(backend, ["fs-commit", next, target, backup]);
  assert.strictEqual(JSON.parse(fs.readFileSync(target)).schemaVersion, 2);
  assert.ok(
    fs
      .readdirSync(temporary)
      .some((name) => name.startsWith("config.json.corrupt-")),
    "corrupt input must be preserved with a timestamp",
  );
  assert.strictEqual(JSON.parse(fs.readFileSync(backup)).schemaVersion, 2);

  fs.writeFileSync(next, '{"schemaVersion":1}\n');
  const invalid = spawnSync(backend, ["fs-commit", next, target, backup], {
    encoding: "utf8",
  });
  assert.notStrictEqual(invalid.status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(target)).schemaVersion, 2);

  const mediaRoot = path.join(temporary, "media");
  const first = path.join(temporary, "first.bin");
  const second = path.join(temporary, "second.bin");
  fs.writeFileSync(first, "identical");
  fs.writeFileSync(second, "identical");
  const firstResult = JSON.parse(
    execFileSync(
      backend,
      ["hash-media", first, mediaRoot, "Episode 1", "mp3"],
      { encoding: "utf8" },
    ),
  );
  const secondResult = JSON.parse(
    execFileSync(
      backend,
      ["hash-media", second, mediaRoot, "Episode 1", "mp3"],
      { encoding: "utf8" },
    ),
  );
  assert.strictEqual(firstResult.name, secondResult.name);
  assert.strictEqual(firstResult.sha256, secondResult.sha256);
  assert.strictEqual(firstResult.sha256.length, 64);
  fs.writeFileSync(firstResult.path, "different-content");
  const collisionInput = path.join(temporary, "collision.bin");
  fs.writeFileSync(collisionInput, "identical");
  const collision = JSON.parse(
    execFileSync(
      backend,
      ["hash-media", collisionInput, mediaRoot, "Episode 1", "mp3"],
      { encoding: "utf8" },
    ),
  );
  assert.match(collision.name, /-2\.mp3$/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log("native config transaction tests passed");
