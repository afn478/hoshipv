"use strict";

const path = require("node:path");

function requestedMediaPath(argv = process.argv) {
  if (!Array.isArray(argv)) return null;
  for (let index = 0; index < argv.length; index++) {
    const argument = String(argv[index] || "");
    if (argument.startsWith("--open-media=")) {
      const value = argument.slice("--open-media=".length).trim();
      return value ? path.resolve(value) : null;
    }
    if (argument === "--open-media") {
      const value = String(argv[index + 1] || "").trim();
      if (!value || value.startsWith("--")) return null;
      return path.resolve(value);
    }
  }
  return null;
}

module.exports = { requestedMediaPath };
