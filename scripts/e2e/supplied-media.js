"use strict";

const path = require("node:path");

const MACOS_SUPPLIED_MEDIA =
  "/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv";
const WINDOWS_SUPPLIED_MEDIA = String.raw`X:\anime\MARRIAGETOXIN\Season 01\MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.mkv`;

function defaultSuppliedMediaPath(platform = process.platform) {
  if (platform === "win32") return WINDOWS_SUPPLIED_MEDIA;
  if (platform === "darwin") return MACOS_SUPPLIED_MEDIA;
  return "";
}

function configuredSuppliedMediaPath(...environmentNames) {
  for (const name of ["IINATAN_TEST_MEDIA_PATH", ...environmentNames]) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return defaultSuppliedMediaPath();
}

function absoluteSuppliedMediaPath(...environmentNames) {
  const configured = configuredSuppliedMediaPath(...environmentNames);
  return configured ? path.resolve(configured) : "";
}

module.exports = {
  MACOS_SUPPLIED_MEDIA,
  WINDOWS_SUPPLIED_MEDIA,
  absoluteSuppliedMediaPath,
  configuredSuppliedMediaPath,
  defaultSuppliedMediaPath,
};
