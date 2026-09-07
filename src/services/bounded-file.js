"use strict";

const fs = require("node:fs/promises");

async function readFileBounded(filePath, maximumBytes, encoding = null) {
  const limit = Math.max(1, Number(maximumBytes) || 1);
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) {
      const error = new Error("file exceeds the size limit");
      error.code = "FILE_SIZE_LIMIT";
      throw error;
    }
    const body = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < body.length) {
      const result = await handle.read(body, offset, body.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const value = offset === body.length ? body : body.subarray(0, offset);
    return encoding ? value.toString(encoding) : value;
  } finally {
    await handle.close();
  }
}

module.exports = { readFileBounded };
