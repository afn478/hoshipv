"use strict";

const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { normalizeSettingsDocument } = require("./defaults");
const { readFileBounded } = require("../services/bounded-file");
const { acquireLock, withLock } = require("../services/storage-layout");

const FORMAT = "iinatan-mp-settings";
const BACKUP_VERSION = 1;
const MAX_SETTINGS_BYTES = 8 * 1024 * 1024;

function isAbsolutePath(value) {
  return path.isAbsolute(String(value || ""));
}

function safeName(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function profileId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || id === "." || id === "..")
    throw new Error("profile id is invalid");
  return id;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFileBounded(filePath, MAX_SETTINGS_BYTES, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteJson(filePath, value, backupPath) {
  if (!isAbsolutePath(filePath)) throw new Error("settings path must be absolute");
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.next`;
  if (backupPath) {
    await fs.mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    try {
      await fs.copyFile(filePath, backupPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

class SettingsStore {
  constructor(filePath, options = {}) {
    if (!isAbsolutePath(filePath))
      throw new Error("SettingsStore requires an absolute path");
    this.filePath = filePath;
    this.backupPath = options.backupPath
      ? String(options.backupPath)
      : `${filePath}.backup`;
    if (!isAbsolutePath(this.backupPath))
      throw new Error("SettingsStore backup path must be absolute");
    this.lockPath = options.lockPath ? String(options.lockPath) : `${filePath}.lock`;
    if (!isAbsolutePath(this.lockPath))
      throw new Error("SettingsStore lock path must be absolute");
    this.lockOptions = {
      timeoutMs: options.lockTimeoutMs,
      staleMs: options.lockStaleMs,
    };
    this.data = null;
  }

  async load() {
    return withLock(
      this.lockPath,
      async () => {
        const primary = await readJson(this.filePath);
        const backup = primary ? null : await readJson(this.backupPath);
        this.data = normalizeSettingsDocument(primary || backup || {});
        if (!primary) await atomicWriteJson(this.filePath, this.data, this.backupPath);
        return this.data;
      },
      this.lockOptions,
    );
  }

  current() {
    if (!this.data) throw new Error("settings have not been loaded");
    return this.data;
  }

  async save(next) {
    const normalized = normalizeSettingsDocument(next || this.data || {});
    return withLock(
      this.lockPath,
      async () => {
        await atomicWriteJson(this.filePath, normalized, this.backupPath);
        const readBack = normalizeSettingsDocument(await readJson(this.filePath));
        if (readBack.schemaVersion !== normalized.schemaVersion)
          throw new Error("settings read-back verification failed");
        this.data = readBack;
        return this.data;
      },
      this.lockOptions,
    );
  }

  async update(mutator) {
    return withLock(
      this.lockPath,
      async () => {
        const primary = await readJson(this.filePath);
        const backup = primary ? null : await readJson(this.backupPath);
        const next = normalizeSettingsDocument(primary || backup || this.data || {});
        await mutator(next);
        await atomicWriteJson(this.filePath, next, this.backupPath);
        const readBack = normalizeSettingsDocument(await readJson(this.filePath));
        if (readBack.schemaVersion !== next.schemaVersion)
          throw new Error("settings read-back verification failed");
        this.data = readBack;
        return this.data;
      },
      this.lockOptions,
    );
  }

  async setActiveProfile(id) {
    const target = profileId(id);
    return this.update((value) => {
      if (!value.profiles[target]) throw new Error(`unknown profile: ${target}`);
      value.activeProfileId = target;
    });
  }

  async createProfile(id, name, sourceProfileId = null) {
    const target = profileId(id);
    return this.update((value) => {
      if (value.profiles[target]) throw new Error(`profile already exists: ${target}`);
      const sourceId = sourceProfileId
        ? profileId(sourceProfileId)
        : value.activeProfileId;
      const source = value.profiles[sourceId] || value.profiles.default;
      value.profiles[target] = {
        id: target,
        name:
          String(name || target)
            .trim()
            .slice(0, 120) || target,
        preferences: JSON.parse(JSON.stringify(source.preferences)),
        dictionaryOrder: [...source.dictionaryOrder],
        disabledDictionaries: [...source.disabledDictionaries],
      };
    });
  }

  async updateProfile(id, mutator) {
    const target = profileId(id);
    return this.update(async (value) => {
      if (!value.profiles[target]) throw new Error(`unknown profile: ${target}`);
      await mutator(value.profiles[target], value);
    });
  }

  async deleteProfile(id) {
    const target = profileId(id);
    if (target === "default") throw new Error("the default profile cannot be deleted");
    return this.update((value) => {
      if (!value.profiles[target]) throw new Error(`unknown profile: ${target}`);
      delete value.profiles[target];
      if (value.activeProfileId === target)
        value.activeProfileId = value.profiles.default
          ? "default"
          : Object.keys(value.profiles)[0];
    });
  }

  async exportBackup(destination) {
    if (!isAbsolutePath(destination))
      throw new Error("backup destination must be absolute");
    const source = this.data || (await this.load());
    const backup = {
      format: FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: source,
    };
    await atomicWriteJson(destination, backup);
    return destination;
  }

  async restoreBackup(sourcePath) {
    if (!isAbsolutePath(sourcePath)) throw new Error("backup source must be absolute");
    const backup = await readJson(sourcePath);
    if (
      !backup ||
      backup.format !== FORMAT ||
      backup.version !== BACKUP_VERSION ||
      !backup.settings
    )
      throw new Error("invalid iinatan-mp settings backup");
    return this.save(backup.settings);
  }

  static defaultPath(userDataPath) {
    if (!isAbsolutePath(userDataPath)) throw new Error("userDataPath must be absolute");
    return path.join(userDataPath, "settings.json");
  }

  static profileFileName(profileId) {
    return `${safeName(profileId) || "profile"}.json`;
  }
}

module.exports = {
  FORMAT,
  BACKUP_VERSION,
  SettingsStore,
  atomicWriteJson,
  acquireLock,
  readJson,
  profileId,
};
