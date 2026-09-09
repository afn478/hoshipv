"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CACHE_MAX_BYTES = 512 * 1024 * 1024;
const CACHE_MAX_FILES = 4096;
const LOG_MAX_BYTES = 4 * 1024 * 1024;
const LOG_MAX_FILES = 5;
const COMPANION_COMMAND_MAX_BYTES = 64 * 1024;
const COMPANION_COMMAND_MAX_AGE_MS = 30 * 1000;
const LOCK_TIMEOUT_MS = 15000;
const LOCK_STALE_MS = 60000;

function absolutePath(value, label) {
  const result = path.resolve(String(value || ""));
  if (!path.isAbsolute(String(value || "")))
    throw new Error(`${label} must be an absolute path`);
  return result;
}

function storageLayout(dataRoot) {
  const root = absolutePath(dataRoot, "iinatan data root");
  const cache = path.join(root, "cache");
  return Object.freeze({
    root,
    configPath: path.join(root, "config.json"),
    dictionaries: path.join(root, "dictionaries"),
    backups: path.join(root, "backups"),
    cache,
    commands: path.join(cache, "commands"),
    logs: path.join(root, "logs"),
    sessions: path.join(cache, "sessions"),
    worker: path.join(cache, "hoshi-worker"),
    nativeGeometry: path.join(cache, "native-geometry"),
    bitmapOcr: path.join(cache, "bitmap-ocr"),
    runtimeLog: path.join(root, "logs", "iinatan.log"),
  });
}

function within(root, value) {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(directory, 0o700);
}

async function ensureStorageLayout(value) {
  const layout = value?.root ? value : storageLayout(value);
  await ensureDirectory(layout.root);
  for (const directory of [
    layout.dictionaries,
    layout.backups,
    layout.cache,
    layout.commands,
    layout.sessions,
    layout.logs,
  ])
    await ensureDirectory(directory);
  return layout;
}

async function atomicCopy(source, destination) {
  await ensureDirectory(path.dirname(destination));
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.next`;
  try {
    await fs.copyFile(source, temporary);
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function atomicWriteJson(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.next`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function requestCompanionCommand(layout, command, payload = {}) {
  if (!layout?.commands || !path.isAbsolute(layout.commands))
    throw new Error("companion command directory must be absolute");
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(String(command || "")))
    throw new Error("invalid companion command");
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("companion command payload must be an object");
  await ensureDirectory(layout.commands);
  const requestId = crypto.randomUUID();
  const destination = path.join(
    layout.commands,
    `${Date.now()}-${process.pid}-${requestId}.json`,
  );
  await atomicWriteJson(destination, {
    version: 1,
    command: String(command),
    requestedAt: Date.now(),
    payload,
  });
  return destination;
}

async function takeCompanionCommands(layout, now = Date.now()) {
  if (!layout?.commands || !path.isAbsolute(layout.commands)) return [];
  let entries;
  try {
    entries = await fs.readdir(layout.commands, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const commands = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(layout.commands, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > COMPANION_COMMAND_MAX_BYTES) {
        await fs.rm(filePath, { force: true });
        continue;
      }
      const record = JSON.parse(await fs.readFile(filePath, "utf8"));
      const age = now - Number(record?.requestedAt);
      if (
        record?.version === 1 &&
        typeof record.command === "string" &&
        /^[a-z][a-z0-9-]{0,63}$/u.test(record.command) &&
        Number.isFinite(age) &&
        age >= -COMPANION_COMMAND_MAX_AGE_MS &&
        age <= COMPANION_COMMAND_MAX_AGE_MS &&
        record.payload &&
        typeof record.payload === "object" &&
        !Array.isArray(record.payload)
      )
        commands.push(record);
    } catch (_) {
      // A partial or malformed command is disposable control state.
    } finally {
      await fs.rm(filePath, { force: true }).catch(() => {});
    }
  }
  return commands;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function lockOwnerIsAlive(lockPath) {
  try {
    const record = JSON.parse(await fs.readFile(lockPath, "utf8"));
    const pid = Number(record?.pid);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !["EINVAL", "ESRCH"].includes(error?.code);
    }
  } catch (_) {
    return false;
  }
}

async function acquireLock(lockPath, options = {}) {
  if (!path.isAbsolute(lockPath)) throw new Error("storage lock path must be absolute");
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || LOCK_TIMEOUT_MS);
  const staleMs = Math.max(1000, Number(options.staleMs) || LOCK_STALE_MS);
  await ensureDirectory(path.dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
      );
      await handle.close();
      return async () => fs.rm(lockPath, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs && !(await lockOwnerIsAlive(lockPath)))
          await fs.rm(lockPath, { force: true });
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await delay(25);
    }
  }
  throw new Error("timed out waiting for the storage file lock");
}

async function withLock(lockPath, operation, options) {
  const release = await acquireLock(lockPath, options);
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function digest(filePath) {
  const hash = crypto.createHash("sha256");
  const body = await fs.readFile(filePath);
  hash.update(body);
  return hash.digest("hex");
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

function jsonEquivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function mergeTree(source, destination, relative, conflicts) {
  const sourceStat = await fs.lstat(source);
  const destinationExists = await exists(destination);
  if (sourceStat.isSymbolicLink()) {
    conflicts.push({
      kind: "symlink",
      item: relative || "legacy-root",
      action: "preserved-source",
    });
    return { copied: 0, unchanged: 0 };
  }

  if (sourceStat.isDirectory()) {
    if (destinationExists && !(await fs.lstat(destination)).isDirectory()) {
      conflicts.push({ kind: "type", item: relative, action: "preserved-destination" });
      return { copied: 0, unchanged: 0 };
    }
    await ensureDirectory(destination);
    let copied = 0;
    let unchanged = 0;
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      const child = await mergeTree(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        path.join(relative, entry.name),
        conflicts,
      );
      copied += child.copied;
      unchanged += child.unchanged;
    }
    return { copied, unchanged };
  }

  if (!sourceStat.isFile()) {
    conflicts.push({
      kind: "special-file",
      item: relative,
      action: "preserved-source",
    });
    return { copied: 0, unchanged: 0 };
  }
  if (!destinationExists) {
    await atomicCopy(source, destination);
    return { copied: 1, unchanged: 0 };
  }
  const destinationStat = await fs.lstat(destination);
  if (!destinationStat.isFile()) {
    conflicts.push({ kind: "type", item: relative, action: "preserved-destination" });
    return { copied: 0, unchanged: 0 };
  }
  if ((await digest(source)) === (await digest(destination)))
    return { copied: 0, unchanged: 1 };
  conflicts.push({ kind: "file", item: relative, action: "preserved-destination" });
  return { copied: 0, unchanged: 0 };
}

function rewriteDictionaryPaths(value, sourceRoot, destinationRoot) {
  let rewrites = 0;
  const document = JSON.parse(JSON.stringify(value));
  if (Array.isArray(document.dictionaries)) {
    for (const entry of document.dictionaries) {
      const rawPath = String(entry?.path || "");
      if (!path.isAbsolute(rawPath)) continue;
      const resolved = path.resolve(rawPath);
      if (!within(sourceRoot, resolved)) continue;
      entry.path = path.join(destinationRoot, path.relative(sourceRoot, resolved));
      rewrites++;
    }
  }
  return { document, rewrites };
}

async function migrateLegacyStorage({ dataRoot, legacyRoot } = {}) {
  const layout = await ensureStorageLayout(dataRoot);
  const sourceRoot = absolutePath(legacyRoot, "legacy data root");
  if (path.resolve(sourceRoot) === path.resolve(layout.root))
    return { migrated: false, conflicts: [], rewrites: 0, reportPath: null };

  return withLock(path.join(layout.root, "config.lock"), async () => {
    const legacySettings = path.join(sourceRoot, "settings.json");
    const legacyDictionaries = path.join(sourceRoot, "dictionaries");
    const migrationStatePath = path.join(layout.backups, "migration-state.json");
    const storedMigrationState = await readOptionalJson(migrationStatePath);
    const migrationState =
      storedMigrationState &&
      typeof storedMigrationState === "object" &&
      !Array.isArray(storedMigrationState)
        ? storedMigrationState
        : {
            version: 1,
            settings: null,
          };
    let migrationStateChanged = false;
    const report = {
      version: 1,
      migratedAt: new Date().toISOString(),
      migrated: { settings: false, dictionaryFiles: 0, unchangedDictionaryFiles: 0 },
      rewrites: 0,
      conflicts: [],
    };

    if (await exists(legacySettings)) {
      const sourceDigest = await digest(legacySettings);
      if (await exists(layout.configPath)) {
        const destinationDigest = await digest(layout.configPath);
        const alreadyMigrated =
          migrationState.settings?.sourceDigest === sourceDigest &&
          migrationState.settings?.destinationDigest === destinationDigest;
        if (!alreadyMigrated) {
          try {
            const raw = JSON.parse(await fs.readFile(legacySettings, "utf8"));
            const rewritten = rewriteDictionaryPaths(
              raw,
              legacyDictionaries,
              layout.dictionaries,
            );
            const destination = JSON.parse(
              await fs.readFile(layout.configPath, "utf8"),
            );
            if (!jsonEquivalent(rewritten.document, destination))
              report.conflicts.push({
                kind: "settings",
                item: "config.json",
                action: "preserved-destination",
              });
          } catch (error) {
            report.conflicts.push({
              kind: "settings",
              item: "settings.json",
              action: "preserved-source",
              reason: String(error?.message || "invalid-json").slice(0, 160),
            });
          }
        }
        migrationState.settings = { sourceDigest, destinationDigest };
        migrationStateChanged = true;
      } else {
        try {
          const raw = JSON.parse(await fs.readFile(legacySettings, "utf8"));
          const rewritten = rewriteDictionaryPaths(
            raw,
            legacyDictionaries,
            layout.dictionaries,
          );
          await atomicWriteJson(layout.configPath, rewritten.document);
          report.migrated.settings = true;
          report.rewrites = rewritten.rewrites;
          migrationState.settings = {
            sourceDigest,
            destinationDigest: await digest(layout.configPath),
          };
          migrationStateChanged = true;
        } catch (error) {
          report.conflicts.push({
            kind: "settings",
            item: "settings.json",
            action: "preserved-source",
            reason: String(error?.message || "invalid-json").slice(0, 160),
          });
        }
      }
    }

    if (await exists(legacyDictionaries)) {
      const merged = await mergeTree(
        legacyDictionaries,
        layout.dictionaries,
        "dictionaries",
        report.conflicts,
      );
      report.migrated.dictionaryFiles = merged.copied;
      report.migrated.unchangedDictionaryFiles = merged.unchanged;
    }

    const didWork =
      report.migrated.settings ||
      report.migrated.dictionaryFiles > 0 ||
      report.conflicts.length > 0;
    if (migrationStateChanged)
      await atomicWriteJson(migrationStatePath, migrationState);
    if (!didWork) return { migrated: false, ...report, reportPath: null };
    const reportPath = path.join(
      layout.backups,
      `migration-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`,
    );
    await atomicWriteJson(reportPath, report);
    return { migrated: true, ...report, reportPath };
  });
}

async function walkFiles(directory, result = []) {
  if (!(await exists(directory))) return result;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(filePath, result);
    else if (entry.isFile()) {
      const stat = await fs.stat(filePath);
      result.push({ path: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return result;
}

async function pruneFiles(directory, maximumBytes, maximumFiles) {
  const files = (await walkFiles(directory)).sort(
    (left, right) => left.mtimeMs - right.mtimeMs,
  );
  let total = files.reduce((sum, file) => sum + file.bytes, 0);
  let removed = 0;
  for (const file of files) {
    if (total <= maximumBytes && files.length - removed <= maximumFiles) break;
    await fs.rm(file.path, { force: true });
    total -= file.bytes;
    removed++;
  }
  return removed;
}

async function rotateBoundedLog(filePath, options = {}) {
  const maximumBytes = Math.max(1, Number(options.maximumBytes) || LOG_MAX_BYTES);
  const keep = Math.max(1, Math.floor(Number(options.keep) || LOG_MAX_FILES));
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.size <= maximumBytes) return false;
  for (let index = keep - 1; index >= 1; index--)
    await fs.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`).catch(() => {});
  await fs.rename(filePath, `${filePath}.1`);
  return true;
}

async function prepareStorageLayout(dataRoot, options = {}) {
  const layout = await ensureStorageLayout(dataRoot);
  const migration = options.legacyRoot
    ? await migrateLegacyStorage({
        dataRoot: layout.root,
        legacyRoot: options.legacyRoot,
      })
    : { migrated: false, conflicts: [], rewrites: 0, reportPath: null };
  await rotateBoundedLog(layout.runtimeLog);
  await pruneFiles(layout.cache, CACHE_MAX_BYTES, CACHE_MAX_FILES);
  await pruneFiles(layout.logs, LOG_MAX_BYTES * LOG_MAX_FILES, LOG_MAX_FILES);
  return { layout, migration };
}

module.exports = {
  CACHE_MAX_BYTES,
  CACHE_MAX_FILES,
  COMPANION_COMMAND_MAX_AGE_MS,
  COMPANION_COMMAND_MAX_BYTES,
  LOG_MAX_BYTES,
  LOG_MAX_FILES,
  acquireLock,
  absolutePath,
  ensureStorageLayout,
  migrateLegacyStorage,
  prepareStorageLayout,
  pruneFiles,
  requestCompanionCommand,
  rotateBoundedLog,
  storageLayout,
  takeCompanionCommands,
  withLock,
  within,
};
