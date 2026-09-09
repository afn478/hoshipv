"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SettingsStore } = require("../src/settings/settings-store");
const {
  acquireLock,
  prepareStorageLayout,
  requestCompanionCommand,
  rotateBoundedLog,
  storageLayout,
  takeCompanionCommands,
} = require("../src/services/storage-layout");

async function temporaryRoot(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), `iinatan-${label}-`));
}

test("fresh storage creates the complete mpv data layout under an absolute root", async () => {
  const root = await temporaryRoot("fresh-存储");
  const dataRoot = path.join(root, "mpv config", "iinatan");
  const prepared = await prepareStorageLayout(dataRoot);
  assert.equal(prepared.layout.configPath, path.join(dataRoot, "config.json"));
  for (const directory of [
    prepared.layout.dictionaries,
    prepared.layout.backups,
    prepared.layout.cache,
    prepared.layout.commands,
    prepared.layout.sessions,
    prepared.layout.logs,
  ])
    assert.equal((await fs.stat(directory)).isDirectory(), true);
});

test("first settings load writes the authoritative config in a custom Unicode root", async () => {
  const root = await temporaryRoot("custom root-設定");
  const dataRoot = path.join(root, "mpv config with spaces", "iinatan");
  const prepared = await prepareStorageLayout(dataRoot);
  const store = new SettingsStore(prepared.layout.configPath, {
    backupPath: path.join(prepared.layout.backups, "config.json"),
    lockPath: path.join(prepared.layout.root, "config.lock"),
  });
  const document = await store.load();
  assert.equal(document.schemaVersion > 0, true);
  assert.equal((await fs.stat(prepared.layout.configPath)).isFile(), true);
  assert.deepEqual(
    JSON.parse(await fs.readFile(prepared.layout.configPath, "utf8")),
    document,
  );
});

test("legacy settings and dictionaries migrate without deleting originals", async () => {
  const root = await temporaryRoot("migration-存储");
  const legacyRoot = path.join(root, "legacy settings");
  const dataRoot = path.join(root, "mpv config", "iinatan");
  const legacyDictionary = path.join(legacyRoot, "dictionaries", "日本語");
  await fs.mkdir(legacyDictionary, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(legacyDictionary, "index.json"), "{}\n", {
    mode: 0o600,
  });
  const legacySettings = {
    activeProfileId: "default",
    profiles: { default: { lookupLanguage: "ja" } },
    dictionaries: [{ id: "japanese", path: legacyDictionary, enabled: true }],
  };
  const legacySettingsPath = path.join(legacyRoot, "settings.json");
  await fs.mkdir(legacyRoot, { recursive: true, mode: 0o700 });
  await fs.writeFile(legacySettingsPath, `${JSON.stringify(legacySettings)}\n`, {
    mode: 0o600,
  });

  const result = await prepareStorageLayout(dataRoot, { legacyRoot });
  assert.equal(result.migration.migrated.settings, true);
  assert.equal(result.migration.conflicts.length, 0);
  assert.equal(
    (await fs.readFile(legacySettingsPath, "utf8")) ===
      `${JSON.stringify(legacySettings)}\n`,
    true,
  );
  assert.equal(
    (await fs.stat(path.join(legacyDictionary, "index.json"))).isFile(),
    true,
  );
  const migrated = JSON.parse(await fs.readFile(result.layout.configPath, "utf8"));
  assert.equal(
    migrated.dictionaries[0].path,
    path.join(result.layout.dictionaries, "日本語"),
  );
  assert.equal(
    (
      await fs.stat(path.join(result.layout.dictionaries, "日本語", "index.json"))
    ).isFile(),
    true,
  );
  assert.equal((await fs.readdir(result.layout.backups)).length, 2);
});

test("migration preserves a destination conflict and reports it without overwriting either side", async () => {
  const root = await temporaryRoot("migration-conflict");
  const legacyRoot = path.join(root, "legacy");
  const dataRoot = path.join(root, "target");
  await fs.mkdir(legacyRoot, { recursive: true, mode: 0o700 });
  await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const source = `${JSON.stringify({ profiles: { default: { lookupLanguage: "ja" } } })}\n`;
  const destination = `${JSON.stringify({ profiles: { default: { lookupLanguage: "de" } } })}\n`;
  await fs.writeFile(path.join(legacyRoot, "settings.json"), source);
  await fs.writeFile(path.join(dataRoot, "config.json"), destination);
  const result = await prepareStorageLayout(dataRoot, { legacyRoot });
  assert.equal(result.migration.conflicts[0].action, "preserved-destination");
  assert.equal(
    await fs.readFile(path.join(dataRoot, "config.json"), "utf8"),
    destination,
  );
  assert.equal(
    await fs.readFile(path.join(legacyRoot, "settings.json"), "utf8"),
    source,
  );
});

test("simultaneous settings updates serialize through the shared lock", async () => {
  const root = await temporaryRoot("settings-lock");
  const filePath = path.join(root, "iinatan", "config.json");
  const options = {
    backupPath: path.join(root, "iinatan", "backups", "config.json"),
    lockPath: path.join(root, "iinatan", "config.lock"),
  };
  const first = new SettingsStore(filePath, options);
  const second = new SettingsStore(filePath, options);
  await Promise.all([first.load(), second.load()]);
  await Promise.all([
    first.update((document) => {
      document.profiles.default.preferences.lookupLanguage = "de";
    }),
    second.update((document) => {
      document.global.importTimeoutMs = 120000;
    }),
  ]);
  const final = new SettingsStore(filePath, options);
  await final.load();
  assert.equal(final.current().profiles.default.preferences.lookupLanguage, "de");
  assert.equal(final.current().global.importTimeoutMs, 120000);
});

test("a load observes settings written while it waits for the shared lock", async () => {
  const root = await temporaryRoot("settings-load-race");
  const filePath = path.join(root, "iinatan", "config.json");
  const options = {
    backupPath: path.join(root, "iinatan", "backups", "config.json"),
    lockPath: path.join(root, "iinatan", "config.lock"),
  };
  const release = await acquireLock(options.lockPath);
  try {
    const store = new SettingsStore(filePath, options);
    const pendingLoad = store.load();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await fs.writeFile(
      filePath,
      `${JSON.stringify({ profiles: { default: { preferences: { lookupLanguage: "de" } } } })}\n`,
      { mode: 0o600 },
    );
    await release();
    assert.equal((await pendingLoad).profiles.default.preferences.lookupLanguage, "de");
  } finally {
    await fs.rm(options.lockPath, { force: true });
  }
});

test("a second companion owner cannot enter the same data root concurrently", async () => {
  const root = await temporaryRoot("companion-lock");
  const lockPath = path.join(root, "iinatan", "companion.lock");
  const release = await acquireLock(lockPath);
  try {
    await assert.rejects(
      acquireLock(lockPath, { timeoutMs: 100 }),
      /timed out waiting for the storage file lock/,
    );
  } finally {
    await release();
  }
  const secondRelease = await acquireLock(lockPath, { timeoutMs: 100 });
  await secondRelease();
});

test("companion settings requests use disposable atomic command files", async () => {
  const root = await temporaryRoot("companion-command");
  const prepared = await prepareStorageLayout(path.join(root, "iinatan"));
  const requestPath = await requestCompanionCommand(prepared.layout, "open-settings");
  assert.equal((await fs.stat(requestPath)).isFile(), true);
  const commands = await takeCompanionCommands(prepared.layout);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].version, 1);
  assert.equal(commands[0].command, "open-settings");
  assert.equal(typeof commands[0].requestedAt, "number");
  assert.deepEqual(commands[0].payload, {});
  assert.deepEqual(await fs.readdir(prepared.layout.commands), []);
});

test("oversized logs rotate and keep their bounded history", async () => {
  const root = await temporaryRoot("log-rotation");
  const filePath = path.join(root, "logs", "iinatan.log");
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, "x".repeat(20));
  assert.equal(await rotateBoundedLog(filePath, { maximumBytes: 10, keep: 2 }), true);
  assert.equal((await fs.stat(`${filePath}.1`)).isFile(), true);
  assert.equal(await rotateBoundedLog(filePath, { maximumBytes: 10, keep: 2 }), false);
  assert.deepEqual(
    storageLayout(path.join(root, "data")).root,
    path.join(root, "data"),
  );
});
