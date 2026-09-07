"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { downloadFile } = require("./dictionary-download");
const {
  recommendedDictionariesForLanguage,
  recommendedDictionaryById,
  recommendedDictionaryMatches,
} = require("./recommended-dictionaries");

function safeId(value) {
  const id = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!id || id === "." || id === "..") throw new Error("dictionary id is required");
  return id;
}

function absolute(value, name) {
  const raw = String(value || "");
  if (!path.isAbsolute(raw)) throw new Error(`${name} must be absolute`);
  return path.normalize(raw);
}

function within(root, value) {
  const relative = path.relative(root, value);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function normalizeDictionaryEntry(value, fallbackId) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = safeId(source.id || source.name || source.title || fallbackId);
  const dictionaryPath = source.path ? absolute(source.path, "dictionary path") : "";
  return {
    id,
    name: String(source.name || source.title || id)
      .trim()
      .slice(0, 240),
    title: String(source.title || source.name || id)
      .trim()
      .slice(0, 240),
    path: dictionaryPath,
    language: String(source.language || "")
      .trim()
      .slice(0, 32),
    revision: String(source.revision || "")
      .trim()
      .slice(0, 160),
    indexUrl: String(source.indexUrl || "")
      .trim()
      .slice(0, 2048),
    downloadUrl: String(source.downloadUrl || "")
      .trim()
      .slice(0, 2048),
    installedAt: String(source.installedAt || "")
      .trim()
      .slice(0, 64),
    enabled: source.enabled !== false,
    metadata:
      source.metadata && typeof source.metadata === "object"
        ? { ...source.metadata }
        : {},
  };
}

function normalizeIdList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function entryFromImportResponse(response, fallback) {
  const metadata =
    response && typeof response === "object"
      ? response.dictionary || response.manifest || response
      : {};
  return normalizeDictionaryEntry(
    {
      ...fallback,
      ...metadata,
      path: fallback.path,
      id: fallback.id,
      installedAt: new Date().toISOString(),
      enabled: true,
    },
    fallback.id,
  );
}

async function resolveImportedDictionaryPath(outputRoot) {
  const root = absolute(outputRoot, "dictionary output root");
  try {
    const directIndex = path.join(root, "index.json");
    await fs.access(directIndex);
    return root;
  } catch (_) {
    // HoshiDicts currently creates <outputRoot>/<title>/index.json.
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(root, entry.name));
  const indexed = [];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "index.json"));
      indexed.push(candidate);
    } catch (_) {}
  }
  if (indexed.length === 1) return indexed[0];
  if (candidates.length === 1) return candidates[0];
  return root;
}

async function pathExists(value) {
  try {
    await fs.access(value);
    return true;
  } catch (_) {
    return false;
  }
}

function managedRootForEntry(installRoot, entry) {
  const dictionaryPath = absolute(entry.path, "dictionary path");
  if (!within(installRoot, dictionaryPath))
    throw new Error("dictionary path is outside the managed install root");
  const relative = path.relative(installRoot, dictionaryPath);
  const first = relative.split(path.sep)[0];
  if (!first || first === "." || first === "..")
    throw new Error("dictionary path does not identify a managed directory");
  return path.join(installRoot, first);
}

async function validateDictionaryZip(filePath, options = {}) {
  const maximumBytes = Math.max(
    1,
    Number(options.maximumBytes) || 2 * 1024 * 1024 * 1024,
  );
  const maximumEntries = Math.max(1, Number(options.maximumEntries) || 100000);
  const maximumUncompressedBytes = Math.max(
    1,
    Number(options.maximumUncompressedBytes) || 8 * 1024 * 1024 * 1024,
  );
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > maximumBytes)
    throw new Error("dictionary ZIP is missing or exceeds the import size limit");
  const tailLength = Math.min(stat.size, 65557);
  const handle = await fs.open(filePath, "r");
  try {
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    const endOffset = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (endOffset < 0 || endOffset + 22 > tail.length)
      throw new Error("dictionary ZIP end record is missing");
    const entries = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    if (
      entries === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    )
      throw new Error("ZIP64 dictionary archives are not accepted by this importer");
    if (
      entries > maximumEntries ||
      centralSize > 32 * 1024 * 1024 ||
      centralOffset + centralSize > stat.size
    )
      throw new Error("dictionary ZIP central directory exceeds the import limit");
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    let offset = 0;
    let totalUncompressed = 0;
    const seenNames = new Set();
    for (let index = 0; index < entries; index++) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50)
        throw new Error("dictionary ZIP central directory is invalid");
      const flags = central.readUInt16LE(offset + 8);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (
        offset + recordLength > central.length ||
        nameLength > 4096 ||
        (flags & 1) !== 0
      )
        throw new Error("dictionary ZIP entry is encrypted or invalid");
      const name = central
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString("utf8");
      const normalized = path.posix.normalize(name.replaceAll("\\", "/"));
      if (
        !name ||
        name.startsWith("/") ||
        /^[A-Za-z]:/.test(name) ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized.includes("/../")
      )
        throw new Error("dictionary ZIP contains a traversal path");
      if (seenNames.has(normalized))
        throw new Error("dictionary ZIP contains duplicate entries");
      seenNames.add(normalized);
      const externalAttributes = central.readUInt32LE(offset + 38);
      const unixType = (externalAttributes >>> 16) & 0xffff & 0o170000;
      if (unixType && unixType !== 0o100000 && unixType !== 0o040000)
        throw new Error("dictionary ZIP contains an unsafe special entry");
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      if (localHeaderOffset >= stat.size)
        throw new Error("dictionary ZIP local entry offset is invalid");
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > maximumUncompressedBytes || compressedSize > maximumBytes)
        throw new Error("dictionary ZIP exceeds the decompression budget");
      offset += recordLength;
    }
    if (offset !== central.length)
      throw new Error("dictionary ZIP central directory has trailing data");
    return {
      entries,
      compressedBytes: stat.size,
      uncompressedBytes: totalUncompressed,
    };
  } finally {
    await handle.close();
  }
}

class DictionaryCatalog extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.settingsStore)
      throw new TypeError("DictionaryCatalog requires a settings store");
    if (!options.installRoot)
      throw new TypeError("DictionaryCatalog requires an install root");
    this.settingsStore = options.settingsStore;
    this.installRoot = absolute(options.installRoot, "dictionary install root");
    this.worker = options.worker || null;
    this.document = null;
    this.recommendedDownloadQueue = Promise.resolve();
  }

  async load() {
    this.document = await this.settingsStore.load();
    return this.list({ includeDisabled: true });
  }

  #currentDocument() {
    if (!this.document) throw new Error("dictionary catalog has not been loaded");
    return this.document;
  }

  #activeProfile(document = this.#currentDocument()) {
    const profile = document.profiles[document.activeProfileId];
    if (!profile) throw new Error("active settings profile is missing");
    return profile;
  }

  setWorker(worker) {
    if (worker !== null && typeof worker !== "object")
      throw new TypeError("dictionary catalog worker must be an object or null");
    this.worker = worker;
    return this;
  }

  list(options = {}) {
    const document = this.#currentDocument();
    const includeDisabled = options.includeDisabled === true;
    const profile = this.#activeProfile(document);
    const entries = new Map();
    for (const [index, value] of document.dictionaries.entries()) {
      const entry = normalizeDictionaryEntry(value, `dictionary-${index + 1}`);
      entries.set(entry.id, entry);
    }
    const order = normalizeIdList(profile.dictionaryOrder);
    const disabled = new Set(normalizeIdList(profile.disabledDictionaries));
    const ordered = [];
    for (const id of order) {
      if (!entries.has(id)) continue;
      ordered.push(entries.get(id));
      entries.delete(id);
    }
    ordered.push(...entries.values());
    const withProfileState = ordered.map((entry) => ({
      ...entry,
      enabled: entry.enabled && !disabled.has(entry.id),
    }));
    return withProfileState.filter((entry) => includeDisabled || entry.enabled);
  }

  async #save(document) {
    this.document = await this.settingsStore.save(document);
    this.emit("changed", this.list({ includeDisabled: true }));
    return this.document;
  }

  async register(entry) {
    const normalized = normalizeDictionaryEntry(entry);
    const document = this.#currentDocument();
    const profile = this.#activeProfile(document);
    const dictionaries = document.dictionaries.map((value, index) =>
      normalizeDictionaryEntry(value, `dictionary-${index + 1}`),
    );
    const existing = dictionaries.findIndex((value) => value.id === normalized.id);
    if (existing >= 0) dictionaries[existing] = normalized;
    else dictionaries.push(normalized);
    profile.dictionaryOrder = normalizeIdList([
      ...profile.dictionaryOrder,
      normalized.id,
    ]);
    profile.disabledDictionaries = normalizeIdList(profile.disabledDictionaries).filter(
      (id) => id !== normalized.id,
    );
    document.dictionaries = dictionaries;
    return this.#save(document);
  }

  async import(zipPath, options = {}) {
    if (!this.worker || typeof this.worker.importDictionary !== "function")
      throw new Error("HoshiDicts import worker is not configured");
    const source = absolute(zipPath, "dictionary ZIP");
    if (!source.toLowerCase().endsWith(".zip"))
      throw new Error("dictionary import requires a .zip file");
    await validateDictionaryZip(source, options.zipLimits);
    const id = safeId(options.id || path.basename(source, path.extname(source)));
    const target = path.join(this.installRoot, id);
    if (!within(this.installRoot, target))
      throw new Error("dictionary import target escaped the install root");
    await fs.mkdir(this.installRoot, { recursive: true, mode: 0o700 });
    const response = await this.worker.importDictionary(source, target, options);
    const importedPath = await resolveImportedDictionaryPath(target);
    const entry = entryFromImportResponse(response, {
      id,
      path: importedPath,
      title: options.title || id,
      language: options.language || "",
    });
    await this.register(entry);
    return entry;
  }

  recommended(language) {
    return recommendedDictionariesForLanguage(
      language,
      this.list({ includeDisabled: true }),
    );
  }

  async #replaceRecommendedImport(stagingEntry, existingEntry, item) {
    const document = this.#currentDocument();
    const profile = this.#activeProfile(document);
    const stagingRoot = path.join(this.installRoot, stagingEntry.id);
    const finalId = safeId(item.id);
    const finalRoot = path.join(this.installRoot, finalId);
    const stagingPath = absolute(stagingEntry.path, "staged dictionary path");
    if (!within(stagingRoot, stagingPath) || !(await pathExists(stagingRoot)))
      throw new Error("staged dictionary escaped its managed directory");

    let existingRoot = null;
    if (existingEntry)
      existingRoot = managedRootForEntry(this.installRoot, existingEntry);
    if (!existingEntry && (await pathExists(finalRoot)))
      throw new Error("recommended dictionary install directory already exists");
    if (existingEntry && existingRoot !== finalRoot && (await pathExists(finalRoot)))
      throw new Error("recommended dictionary replacement directory already exists");

    const backupRoot = path.join(
      this.installRoot,
      `.backup-${finalId}-${crypto.randomBytes(8).toString("hex")}`,
    );
    const previousDictionaries = document.dictionaries;
    const previousOrder = profile.dictionaryOrder;
    const previousDisabled = profile.disabledDictionaries;
    let oldMoved = false;
    let stagedMoved = false;
    let replacement;
    try {
      if (existingRoot && (await pathExists(existingRoot))) {
        await fs.rename(existingRoot, backupRoot);
        oldMoved = true;
      }
      await fs.rename(stagingRoot, finalRoot);
      stagedMoved = true;
      const relativeImportedPath = path.relative(stagingRoot, stagingPath);
      const finalPath = path.join(finalRoot, relativeImportedPath);
      const previousEnabled = existingEntry ? existingEntry.enabled !== false : true;
      replacement = normalizeDictionaryEntry(
        {
          ...stagingEntry,
          ...item,
          id: finalId,
          path: finalPath,
          enabled: previousEnabled,
          installedAt: stagingEntry.installedAt,
        },
        finalId,
      );
      const dictionaries = document.dictionaries
        .map((value, index) =>
          normalizeDictionaryEntry(value, `dictionary-${index + 1}`),
        )
        .filter(
          (entry) => entry.id !== stagingEntry.id && entry.id !== existingEntry?.id,
        );
      dictionaries.push(replacement);
      document.dictionaries = dictionaries;
      const previousOrder = normalizeIdList(profile.dictionaryOrder);
      const order = [];
      let replacedOrderEntry = false;
      for (const id of previousOrder) {
        if (id === stagingEntry.id || id === existingEntry?.id) {
          if (!replacedOrderEntry) {
            order.push(finalId);
            replacedOrderEntry = true;
          }
        } else order.push(id);
      }
      if (!replacedOrderEntry) order.push(finalId);
      profile.dictionaryOrder = normalizeIdList(order);
      const disabled = normalizeIdList(profile.disabledDictionaries).filter(
        (id) => id !== stagingEntry.id && id !== existingEntry?.id,
      );
      if (!previousEnabled) disabled.push(finalId);
      profile.disabledDictionaries = normalizeIdList(disabled);
      await this.#save(document);
    } catch (error) {
      document.dictionaries = previousDictionaries;
      profile.dictionaryOrder = previousOrder;
      profile.disabledDictionaries = previousDisabled;
      if (stagedMoved) await fs.rm(finalRoot, { recursive: true, force: true });
      if (oldMoved) await fs.rename(backupRoot, existingRoot).catch(() => {});
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    if (oldMoved)
      await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => {});
    return replacement;
  }

  async #downloadRecommended(id, options = {}) {
    if (!this.worker || typeof this.worker.importDictionary !== "function")
      throw new Error("HoshiDicts import worker is not configured");
    const item = recommendedDictionaryById(id);
    if (!item) throw new Error(`unknown recommended dictionary: ${String(id || "")}`);
    const existing = this.list({ includeDisabled: true }).find((entry) =>
      recommendedDictionaryMatches(item, entry),
    );
    if (existing && options.update !== true)
      throw new Error(
        `${item.title} is already installed; choose update to refresh it`,
      );

    const downloadRoot = path.join(this.installRoot, ".downloads");
    const archivePath = path.join(
      downloadRoot,
      `${item.id}-${process.pid}-${Date.now()}.zip`,
    );
    const stagingId = safeId(
      `${item.id}.incoming-${crypto.randomBytes(8).toString("hex")}`,
    );
    try {
      await downloadFile(item.downloadUrl, archivePath, {
        fetch: options.fetch,
        signal: options.signal,
        timeoutMs: options.downloadTimeoutMs,
        maximumBytes: options.maximumBytes,
        onProgress: options.onProgress,
      });
      let stagingEntry;
      try {
        stagingEntry = await this.import(archivePath, {
          id: stagingId,
          title: item.title,
          language: item.language,
          downloadUrl: item.downloadUrl,
          timeoutMs: options.importTimeoutMs,
          lowRam: options.lowRam,
          zipLimits: options.zipLimits,
        });
      } catch (error) {
        await fs
          .rm(path.join(this.installRoot, stagingId), {
            recursive: true,
            force: true,
          })
          .catch(() => {});
        throw error;
      }
      try {
        return await this.#replaceRecommendedImport(stagingEntry, existing, item);
      } catch (error) {
        await this.remove(stagingEntry.id, { deleteFiles: true }).catch(() => {});
        throw error;
      }
    } finally {
      await fs.rm(archivePath, { force: true }).catch(() => {});
      await fs.rm(downloadRoot, { recursive: false, force: true }).catch(() => {});
    }
  }

  downloadRecommended(id, options = {}) {
    const operation = this.recommendedDownloadQueue.then(() =>
      this.#downloadRecommended(id, options),
    );
    this.recommendedDownloadQueue = operation.catch(() => {});
    return operation;
  }

  async setEnabled(id, enabled) {
    const target = safeId(id);
    const document = this.#currentDocument();
    const dictionaries = document.dictionaries.map((value, index) =>
      normalizeDictionaryEntry(value, `dictionary-${index + 1}`),
    );
    const entry = dictionaries.find((value) => value.id === target);
    if (!entry) throw new Error(`unknown dictionary: ${target}`);
    entry.enabled = !!enabled;
    const profile = this.#activeProfile(document);
    profile.disabledDictionaries = normalizeIdList(profile.disabledDictionaries).filter(
      (value) => value !== target,
    );
    if (!enabled) profile.disabledDictionaries.push(target);
    document.dictionaries = dictionaries;
    return this.#save(document);
  }

  async reorder(ids) {
    const document = this.#currentDocument();
    const known = new Set(
      document.dictionaries.map(
        (value, index) => normalizeDictionaryEntry(value, `dictionary-${index + 1}`).id,
      ),
    );
    const profile = this.#activeProfile(document);
    profile.dictionaryOrder = normalizeIdList(ids).filter((id) => known.has(id));
    return this.#save(document);
  }

  async remove(id, options = {}) {
    const target = safeId(id);
    const document = this.#currentDocument();
    const dictionaries = document.dictionaries.map((value, index) =>
      normalizeDictionaryEntry(value, `dictionary-${index + 1}`),
    );
    const entry = dictionaries.find((value) => value.id === target);
    if (!entry) return false;
    if (options.deleteFiles === true && entry.path) {
      const managedRoot = managedRootForEntry(this.installRoot, entry);
      await fs.rm(managedRoot, { recursive: true, force: true });
    }
    document.dictionaries = dictionaries.filter((value) => value.id !== target);
    const profile = this.#activeProfile(document);
    profile.dictionaryOrder = normalizeIdList(profile.dictionaryOrder).filter(
      (value) => value !== target,
    );
    profile.disabledDictionaries = normalizeIdList(profile.disabledDictionaries).filter(
      (value) => value !== target,
    );
    await this.#save(document);
    return true;
  }

  activePaths() {
    return this.list()
      .map((entry) => entry.path)
      .filter(Boolean);
  }
}

module.exports = {
  DictionaryCatalog,
  entryFromImportResponse,
  managedRootForEntry,
  normalizeDictionaryEntry,
  normalizeIdList,
  resolveImportedDictionaryPath,
  safeId,
  validateDictionaryZip,
  within,
};
