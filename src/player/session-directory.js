"use strict";

const path = require("node:path");

function defaultSessionDirectory({ dataRoot } = {}) {
  const root = String(dataRoot || "");
  if (!path.isAbsolute(root)) throw new Error("dataRoot must be an absolute path");
  return path.join(root, "cache", "sessions");
}

module.exports = { defaultSessionDirectory };
