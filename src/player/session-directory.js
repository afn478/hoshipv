"use strict";

const os = require("node:os");
const path = require("node:path");

function defaultSessionDirectory({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const homeDirectory = String(home || os.homedir());
  if (platform === "darwin")
    return path.join(
      homeDirectory,
      "Library",
      "Application Support",
      "iinatan for mpv",
      "sessions",
    );
  if (platform === "win32")
    return path.join(
      String(env.APPDATA || path.join(homeDirectory, "AppData", "Roaming")),
      "iinatan for mpv",
      "sessions",
    );
  return path.join(
    String(env.XDG_CONFIG_HOME || path.join(homeDirectory, ".config")),
    "iinatan for mpv",
    "sessions",
  );
}

module.exports = { defaultSessionDirectory };
