"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const zlib = require("node:zlib");
const { trackRequest } = require("../../src/geometry/native-subtitle-geometry-service");
const { edgeError } = require("../../src/geometry/oracle");
const { NativeGeometryClient } = require("../../src/services/native-geometry-client");
const { NativeGeometryWorker } = require("../../src/services/native-geometry-worker");

const root = path.resolve(__dirname, "../..");
const PIXEL_CHANGE_THRESHOLD = 8;
const UNIT_IDENTITY_COLOR_COSINE = 0.985;
const cases = [
  {
    id: "simultaneous-primary-events",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-multiple-events-smoke.ass",
    ),
    text: "First line\\Nwrap\nSecond event",
    events: [
      {
        rawText: "First line\\Nwrap",
        startMs: 1000,
        endMs: 3000,
        layer: 0,
        drawing: false,
        units: [
          { position: 0, utf16Range: [0, 5], lookupable: true },
          { position: 6, utf16Range: [6, 10], lookupable: true },
          { position: 11, utf16Range: [11, 15], lookupable: true },
        ],
      },
      {
        rawText: "Second event",
        startMs: 1000,
        endMs: 3000,
        layer: 1,
        drawing: false,
        units: [
          { position: 15, utf16Range: [0, 6], lookupable: true },
          { position: 22, utf16Range: [7, 12], lookupable: true },
        ],
      },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "unit-identity-colors",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-unit-identity-smoke.ass",
    ),
    text: "Identity red\nIdentity blue",
    events: [
      {
        rawText: "Identity red",
        startMs: 1000,
        endMs: 3000,
        layer: 0,
        drawing: false,
        units: [
          { position: 0, utf16Range: [0, 8], lookupable: true },
          { position: 9, utf16Range: [9, 12], lookupable: true },
        ],
      },
      {
        rawText: "Identity blue",
        startMs: 1000,
        endMs: 3000,
        layer: 1,
        drawing: false,
        units: [
          { position: 12, utf16Range: [0, 8], lookupable: true },
          { position: 21, utf16Range: [9, 13], lookupable: true },
        ],
      },
    ],
    unitIdentity: [
      { position: 0, color: [255, 0, 0] },
      { position: 9, color: [255, 0, 0] },
      { position: 12, color: [0, 0, 255] },
      { position: 21, color: [0, 0, 255] },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "primary",
    fixture: path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass"),
    text: "A careful reader",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
      { position: 2, displayStartUtf16: 2, displayEndUtf16: 9 },
      { position: 10, displayStartUtf16: 10, displayEndUtf16: 16 },
    ],
    primaryAssOverride: "scale",
  },
  {
    id: "unit-identity-unique-colors",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-unit-identity-unique-smoke.ass",
    ),
    text: "First\nred\nSecond\nblue",
    events: [
      {
        rawText: "First",
        startMs: 1000,
        endMs: 3000,
        layer: 0,
        drawing: false,
        units: [{ position: 0, utf16Range: [0, 5], lookupable: true }],
      },
      {
        rawText: "red",
        startMs: 1000,
        endMs: 3000,
        layer: 1,
        drawing: false,
        units: [{ position: 6, utf16Range: [0, 3], lookupable: true }],
      },
      {
        rawText: "Second",
        startMs: 1000,
        endMs: 3000,
        layer: 2,
        drawing: false,
        units: [{ position: 10, utf16Range: [0, 6], lookupable: true }],
      },
      {
        rawText: "blue",
        startMs: 1000,
        endMs: 3000,
        layer: 3,
        drawing: false,
        units: [{ position: 17, utf16Range: [0, 4], lookupable: true }],
      },
    ],
    unitIdentity: [
      { position: 0, color: [255, 0, 0] },
      { position: 6, color: [255, 128, 0] },
      { position: 10, color: [0, 0, 255] },
      { position: 17, color: [0, 255, 255] },
    ],
    identityEdgeTolerance: 1,
    primaryAssOverride: "no",
  },
  {
    id: "unit-identity-inline-colors",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-unit-identity-inline-smoke.ass",
    ),
    text: "First\nred\nThird\nblue",
    events: [
      {
        rawText:
          "{\\c&H000000FF&}First\\N{\\c&H000080FF&}red\\N{\\c&H00FF0000&}Third\\N{\\c&H00FFFF00&}blue",
        startMs: 1000,
        endMs: 3000,
        layer: 0,
        drawing: false,
        units: [
          { position: 0, utf16Range: [0, 5], lookupable: true },
          { position: 6, utf16Range: [6, 9], lookupable: true },
          { position: 10, utf16Range: [10, 15], lookupable: true },
          { position: 16, utf16Range: [16, 20], lookupable: true },
        ],
      },
    ],
    unitIdentity: [
      { position: 0, color: [255, 0, 0] },
      { position: 6, color: [255, 128, 0] },
      { position: 10, color: [0, 0, 255] },
      { position: 16, color: [0, 255, 255] },
    ],
    identityEdgeTolerance: 1,
    primaryAssOverride: "no",
  },
  ...(process.env.IINATAN_STOCK_PIXEL_ORACLE_INCLUDE_PER_GLYPH === "1"
    ? [
        {
          id: "unit-identity-per-glyph-colors",
          isolatedGlyphOracle: true,
          fixture: path.join(
            root,
            "tests",
            "fixtures",
            "native-ass-geometry-per-glyph-colors-smoke.ass",
          ),
          text: "Careful",
          events: [
            {
              rawText:
                "{\\c&H000000FF&}C{\\c&H0000FF00&}a{\\c&H00FF0000&}r{\\c&H00FFFF00&}e{\\c&H00FF00FF&}f{\\c&H0000FFFF&}u{\\c&H000080FF&}l",
              startMs: 1000,
              endMs: 3000,
              layer: 0,
              drawing: false,
              units: [
                { position: 0, utf16Range: [0, 1], lookupable: true },
                { position: 1, utf16Range: [1, 2], lookupable: true },
                { position: 2, utf16Range: [2, 3], lookupable: true },
                { position: 3, utf16Range: [3, 4], lookupable: true },
                { position: 4, utf16Range: [4, 5], lookupable: true },
                { position: 5, utf16Range: [5, 6], lookupable: true },
                { position: 6, utf16Range: [6, 7], lookupable: true },
              ],
            },
          ],
          units: [
            { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
            { position: 1, displayStartUtf16: 1, displayEndUtf16: 2 },
            { position: 2, displayStartUtf16: 2, displayEndUtf16: 3 },
            { position: 3, displayStartUtf16: 3, displayEndUtf16: 4 },
            { position: 4, displayStartUtf16: 4, displayEndUtf16: 5 },
            { position: 5, displayStartUtf16: 5, displayEndUtf16: 6 },
            { position: 6, displayStartUtf16: 6, displayEndUtf16: 7 },
          ],
          unitIdentity: [
            { position: 0, color: [255, 0, 0] },
            { position: 1, color: [0, 255, 0] },
            { position: 2, color: [0, 0, 255] },
            { position: 3, color: [0, 255, 255] },
            { position: 4, color: [255, 0, 255] },
            { position: 5, color: [255, 255, 0] },
            { position: 6, color: [255, 128, 0] },
          ],
          primaryAssOverride: "no",
        },
      ]
    : []),
  {
    id: "subrip-primary",
    fixture: path.join(root, "tests", "fixtures", "stock-mpv-primary.srt"),
    subtitleFormat: "subrip",
    text: "Primary 日本語",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 7 },
      { position: 8, displayStartUtf16: 8, displayEndUtf16: 11 },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "unicode-primary",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-unicode-smoke.ass",
    ),
    text: "{\\i1}A😀é\\Nline",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
      { position: 1, displayStartUtf16: 1, displayEndUtf16: 3 },
      { position: 2, displayStartUtf16: 3, displayEndUtf16: 5 },
      { position: 4, displayStartUtf16: 6, displayEndUtf16: 10 },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "mixed-language-primary",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-mixed-languages-smoke.ass",
    ),
    text: "日本語 English Deutsch Français 한국어 中文",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 3 },
      { position: 4, displayStartUtf16: 4, displayEndUtf16: 11 },
      { position: 12, displayStartUtf16: 12, displayEndUtf16: 19 },
      { position: 20, displayStartUtf16: 20, displayEndUtf16: 28 },
      { position: 29, displayStartUtf16: 29, displayEndUtf16: 32 },
      { position: 33, displayStartUtf16: 33, displayEndUtf16: 35 },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "missing-font-fallback",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-missing-font-smoke.ass",
    ),
    text: "Fallback font",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 8 },
      { position: 9, displayStartUtf16: 9, displayEndUtf16: 13 },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "top-selected",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-secondary-smoke.ass",
    ),
    text: "Top 日本語",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 3 },
      { position: 4, displayStartUtf16: 4, displayEndUtf16: 7 },
    ],
    primaryAssOverride: "scale",
  },
  {
    id: "positioned-italic-style",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-positioned-smoke.ass",
    ),
    text: "Positioned italic",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 10 },
      { position: 11, displayStartUtf16: 11, displayEndUtf16: 17 },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "explicit-position",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-explicit-position-smoke.ass",
    ),
    text: "{\\pos(200,200)}Explicit position",
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 17 }],
    primaryAssOverride: "no",
  },
  {
    id: "explicit-movement",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-explicit-movement-smoke.ass",
    ),
    text: "{\\move(100,200,500,200)}Moving position",
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 15 }],
    primaryAssOverride: "no",
  },
  {
    id: "static-ass-tags",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-static-tags-smoke.ass",
    ),
    text: "{\\an8\\fs48\\fsp1\\bord2\\shad1\\frz12\\clip(0,0,1280,720)\\fnArial\\k20}Static ASS tags",
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 15 }],
    primaryAssOverride: "no",
  },
  {
    id: "vector-clip-ass-tag",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-vector-clip-smoke.ass",
    ),
    text: "{\\clip(m 400 500 l 900 500 l 900 720 l 400 720)}Vector clipped event",
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 20 }],
    primaryAssOverride: "no",
  },
  {
    id: "advanced-ass-tags",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-advanced-tags-smoke.ass",
    ),
    text: "{\\xbord2\\ybord1\\fsc\\fad(50,50)\\fade(0,0,0,0,50,1950,2000)\\org(640,360)\\a5\\u1\\s0\\p0\\pbo2\\fe1}Advanced tags",
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 13 }],
    primaryAssOverride: "no",
  },
  {
    id: "transform-ass-tags",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-transform-smoke.ass",
    ),
    text: "{\\t(0,500,\\fs48)}Transform ASS tags",
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 18 }],
    primaryAssOverride: "no",
  },
  {
    id: "karaoke-ass-tags",
    fixture: path.join(
      root,
      "tests",
      "fixtures",
      "native-ass-geometry-karaoke-smoke.ass",
    ),
    text: "{\\k20}Ka{\\k20}ra{\\k20}oke {\\kf20}test",
    units: [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 2 },
      { position: 2, displayStartUtf16: 2, displayEndUtf16: 4 },
      { position: 4, displayStartUtf16: 4, displayEndUtf16: 7 },
      { position: 8, displayStartUtf16: 8, displayEndUtf16: 12 },
    ],
    primaryAssOverride: "no",
  },
  {
    id: "simultaneous-primary-secondary",
    fixtures: [
      path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass"),
      path.join(root, "tests", "fixtures", "native-ass-geometry-secondary-smoke.ass"),
    ],
    tracks: [
      {
        id: "primary",
        fixture: path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass"),
        text: "A careful reader",
        units: [
          { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
          { position: 2, displayStartUtf16: 2, displayEndUtf16: 9 },
          { position: 10, displayStartUtf16: 10, displayEndUtf16: 16 },
        ],
      },
      {
        id: "secondary",
        fixture: path.join(
          root,
          "tests",
          "fixtures",
          "native-ass-geometry-secondary-smoke.ass",
        ),
        text: "Top 日本語",
        units: [
          { position: 0, displayStartUtf16: 0, displayEndUtf16: 3 },
          { position: 4, displayStartUtf16: 4, displayEndUtf16: 7 },
        ],
      },
    ],
    primaryAssOverride: "scale",
    secondaryAssOverride: "no",
  },
  {
    id: "simultaneous-default-secondary-strip",
    fixtures: [
      path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass"),
      path.join(root, "tests", "fixtures", "native-ass-geometry-secondary-smoke.ass"),
    ],
    tracks: [
      {
        id: "primary",
        fixture: path.join(root, "tests", "fixtures", "native-ass-geometry-smoke.ass"),
        text: "A careful reader",
        units: [
          { position: 0, displayStartUtf16: 0, displayEndUtf16: 1 },
          { position: 2, displayStartUtf16: 2, displayEndUtf16: 9 },
          { position: 10, displayStartUtf16: 10, displayEndUtf16: 16 },
        ],
      },
      {
        id: "secondary",
        fixture: path.join(
          root,
          "tests",
          "fixtures",
          "native-ass-geometry-secondary-strip-smoke.ass",
        ),
        text: "Top 日本語",
        units: [
          { position: 0, displayStartUtf16: 0, displayEndUtf16: 3 },
          { position: 4, displayStartUtf16: 4, displayEndUtf16: 7 },
        ],
      },
    ],
    primaryAssOverride: "scale",
  },
];

function run(executable, args, description) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(new Error(`${description}: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${description} failed (${signal || `exit ${code}`}): ${stderr.trim()}`,
          ),
        );
    });
  });
}

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function readAssMetadata(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  const dialogueOffset = contents.indexOf("Dialogue:");
  const assFull = contents
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Dialogue:"))
    .join("\n");
  if (dialogueOffset < 0 || !assFull)
    throw new Error(`ASS fixture has no dialogue event: ${filePath}`);
  return {
    assExtradata: contents.slice(0, dialogueOffset),
    assFull,
  };
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature))
    throw new Error("PNG signature is invalid");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") imageData.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0)
    throw new Error("oracle supports only non-interlaced 8-bit RGB/RGBA PNGs");
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const filtered = zlib.inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = filtered[sourceOffset++];
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = filtered[sourceOffset++];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[rowOffset - stride + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[rowOffset - stride + x - bytesPerPixel]
          : 0;
      let value;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + above;
          break;
        case 3:
          value = raw + Math.floor((left + above) / 2);
          break;
        case 4:
          value = raw + paeth(left, above, upperLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter}`);
      }
      pixels[rowOffset + x] = value & 0xff;
    }
  }
  return { width, height, bytesPerPixel, stride, pixels };
}

function pixel(image, x, y) {
  const offset = y * image.stride + x * image.bytesPerPixel;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function colorDistance(left, right) {
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2]),
  );
}

function colorIdentityMatches(before, after, expected) {
  if (colorDistance(before, after) <= PIXEL_CHANGE_THRESHOLD) return false;
  // Compare the chroma direction after subtracting the controlled background.
  // This keeps antialiased primary-color pixels while rejecting neighboring
  // annotated colors whose brightest channel happens to be the same.
  const observed = after.map((value, index) => value - before[index]);
  const expectedDelta = expected.map((value, index) => value - before[index]);
  const dot = observed.reduce(
    (sum, value, index) => sum + value * expectedDelta[index],
    0,
  );
  const observedLength = Math.hypot(...observed);
  const expectedLength = Math.hypot(...expectedDelta);
  if (dot <= 0 || observedLength === 0 || expectedLength === 0) return false;
  return dot / (observedLength * expectedLength) >= UNIT_IDENTITY_COLOR_COSINE;
}

function colorIdentityBounds(baseline, withSubtitle, expected) {
  let minX = withSubtitle.width;
  let minY = withSubtitle.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < withSubtitle.height; y++) {
    for (let x = 0; x < withSubtitle.width; x++) {
      if (
        !colorIdentityMatches(
          pixel(baseline, x, y),
          pixel(withSubtitle, x, y),
          expected,
        )
      )
        continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function subtitleMask(baseline, withSubtitle, threshold = PIXEL_CHANGE_THRESHOLD) {
  if (baseline.width !== withSubtitle.width || baseline.height !== withSubtitle.height)
    throw new Error("stock mpv oracle frames have different dimensions");
  const mask = new Uint8Array(baseline.width * baseline.height);
  let pixels = 0;
  let minX = baseline.width;
  let minY = baseline.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < baseline.height; y++) {
    for (let x = 0; x < baseline.width; x++) {
      const before = pixel(baseline, x, y);
      const after = pixel(withSubtitle, x, y);
      const changed =
        Math.max(
          Math.abs(after[0] - before[0]),
          Math.abs(after[1] - before[1]),
          Math.abs(after[2] - before[2]),
        ) > threshold;
      if (!changed) continue;
      mask[y * baseline.width + x] = 1;
      pixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    mask,
    pixels,
    width: baseline.width,
    height: baseline.height,
    bounds:
      maxX < 0
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function subtitleColorMask(
  baseline,
  withSubtitle,
  expectedColor,
  threshold = PIXEL_CHANGE_THRESHOLD,
) {
  if (baseline.width !== withSubtitle.width || baseline.height !== withSubtitle.height)
    throw new Error("stock mpv oracle frames have different dimensions");
  if (
    !Array.isArray(expectedColor) ||
    expectedColor.length !== 3 ||
    expectedColor.some((value) => !Number.isFinite(Number(value)))
  )
    throw new TypeError("expected subtitle color must be an RGB triplet");
  const mask = new Uint8Array(baseline.width * baseline.height);
  let pixels = 0;
  let minX = baseline.width;
  let minY = baseline.height;
  let maxX = -1;
  let maxY = -1;
  const color = expectedColor.map((value) => Math.max(0, Math.min(255, Number(value))));
  const expectedLuma = color.reduce((sum, value) => sum + value, 0) / 3;
  for (let y = 0; y < baseline.height; y++) {
    for (let x = 0; x < baseline.width; x++) {
      const before = pixel(baseline, x, y);
      const after = pixel(withSubtitle, x, y);
      const changed = colorDistance(before, after) > threshold;
      const expectedLightFill =
        expectedLuma >= 200 &&
        Math.min(...after) >= 120 &&
        Math.max(...after) - Math.min(...after) <= 45;
      const movedTowardColor =
        colorDistance(after, color) < colorDistance(before, color);
      if (!changed || (!expectedLightFill && !movedTowardColor)) continue;
      const index = y * baseline.width + x;
      mask[index] = 1;
      pixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    mask,
    pixels,
    width: baseline.width,
    height: baseline.height,
    bounds:
      maxX < 0
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function rectBounds(units, field = "rects") {
  const rects = units.flatMap((unit) => unit[field] || []);
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function iou(left, right) {
  if (!left || !right) return 0;
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function boundedSecondaryStripRequest(testCase, track) {
  const request = trackRequest(
    {
      sessionId: `stock-pixel-${testCase.id}`,
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
    },
    {
      id: track.id,
      role: "secondary",
      selected: true,
      source: { path: track.fixture, ffIndex: 0, external: true },
      startMs: 1000,
      endMs: 3000,
      events: [
        {
          rawText: track.text,
          startMs: 1000,
          endMs: 3000,
          layer: 0,
          drawing: false,
          units: track.units.map((unit) => ({
            position: unit.position,
            utf16Range: [unit.displayStartUtf16, unit.displayEndUtf16],
            lookupable: true,
          })),
        },
      ],
      renderer: {
        width: 1280,
        height: 720,
        storageWidth: 1280,
        storageHeight: 720,
        pixelAspect: 1,
        fontScale: 1,
        lineSpacing: 0,
        forceMargins: false,
        embeddedFonts: true,
        useStorageSize: true,
        linePosition: 100,
        overrideMode: "strip",
        defaultFamily: "sans-serif",
        fontProvider: "auto",
        primaryColor: "#FFFFFFFF",
        borderColor: "#FF000000",
        shadowColor: "#AF000000",
        assJustify: false,
        hinting: "none",
        shaper: "complex",
        fontSize: 38,
        outlineSize: 1.65,
        shadowOffset: 0,
        marginX: 19,
        marginY: 34,
        alignX: "center",
        alignY: "bottom",
        useMargins: true,
        bold: false,
        italic: false,
        spacing: 0,
      },
    },
    1,
  );
  if (!request) throw new Error("bounded secondary strip request was rejected");
  return request;
}

async function captureFrame(
  executable,
  video,
  outputDirectory,
  subtitleFixtures,
  options = {},
) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const args = [
    "--no-config",
    "--vo=image",
    `--vo-image-outdir=${outputDirectory}`,
    "--vo-image-format=png",
    "--frames=1",
    `--start=${
      Number.isFinite(Number(options.startSeconds)) ? Number(options.startSeconds) : 2
    }`,
    "--pause=no",
    "--ao=null",
    "--no-terminal",
  ];
  if (options.forceRgb24) args.push("--vf=format=rgb24");
  const fixtures = Array.isArray(subtitleFixtures)
    ? subtitleFixtures.filter(Boolean)
    : subtitleFixtures
      ? [subtitleFixtures]
      : [];
  if (fixtures.length) {
    args.push(`--sub-ass-override=${options.primaryAssOverride || "no"}`);
    for (const fixture of fixtures) args.push(`--sub-file=${fixture}`);
    args.push("--sid=1");
    if (fixtures.length > 1) {
      args.push("--secondary-sid=2", "--secondary-sub-visibility=yes");
      if (options.secondaryAssOverride)
        args.push(`--secondary-sub-ass-override=${options.secondaryAssOverride}`);
    }
  }
  for (const argument of Array.isArray(options.extraArgs) ? options.extraArgs : [])
    args.push(String(argument));
  args.push(video);
  await run(
    executable,
    args,
    fixtures.length ? "stock mpv subtitle capture" : "stock mpv baseline capture",
  );
  const files = (await fs.readdir(outputDirectory))
    .filter((file) => file.endsWith(".png"))
    .sort();
  if (!files.length)
    throw new Error(`stock mpv wrote no PNG frame to ${outputDirectory}`);
  return decodePng(await fs.readFile(path.join(outputDirectory, files[0])));
}

function isolateAssGlyphText(rawText, targetPosition) {
  // The per-glyph fixture uses inline colour tags only to label identities.
  // Remove those tags and reset to the declared style so the isolation pass
  // changes visibility without changing the ASS shaping inputs.
  let result = "{\\r}";
  let index = 0;
  let displayPosition = 0;
  while (index < rawText.length) {
    if (rawText[index] === "{") {
      const end = rawText.indexOf("}", index + 1);
      if (end < 0) throw new Error("per-glyph ASS fixture contains an unclosed tag");
      index = end + 1;
      continue;
    }
    if (
      rawText[index] === "\\" &&
      (rawText[index + 1] === "N" || rawText[index + 1] === "n")
    ) {
      result += rawText.slice(index, index + 2);
      index += 2;
      displayPosition++;
      continue;
    }
    const codePoint = rawText.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    const alpha = displayPosition === targetPosition ? "00" : "FF";
    result += `{\\alpha&H${alpha}&}${character}`;
    displayPosition += character.length;
    index += character.length;
  }
  return result;
}

async function writeIsolatedAssFixture(
  sourceFixture,
  rawText,
  targetPosition,
  outputPath,
) {
  const contents = await fs.readFile(sourceFixture, "utf8");
  const occurrences = contents.split(rawText).length - 1;
  if (occurrences !== 1)
    throw new Error(
      `per-glyph ASS fixture text occurs ${occurrences} times instead of once`,
    );
  await fs.writeFile(
    outputPath,
    contents.replace(rawText, isolateAssGlyphText(rawText, targetPosition)),
    "utf8",
  );
}

async function isolatedGlyphCoverage(
  executable,
  video,
  baseline,
  temporaryRoot,
  testCase,
  track,
  response,
) {
  const event = track.events?.[0];
  if (!event || track.events.length !== 1)
    throw new Error(`${testCase.id} isolated glyph oracle requires one ASS event`);
  const result = [];
  for (const unit of response.units) {
    const fixture = path.join(
      temporaryRoot,
      `isolated-${testCase.id}-${unit.position}.ass`,
    );
    await writeIsolatedAssFixture(track.fixture, event.rawText, unit.position, fixture);
    const frame = await captureFrame(
      executable,
      video,
      path.join(temporaryRoot, `isolated-${testCase.id}-${unit.position}`),
      fixture,
      testCase,
    );
    const actual = subtitleMask(baseline, frame, PIXEL_CHANGE_THRESHOLD).bounds;
    const predicted = unit.rects[0] || null;
    const predictedBounds = predicted
      ? {
          x: predicted.x,
          y: predicted.y,
          width: predicted.w,
          height: predicted.h,
        }
      : null;
    result.push({
      track: track.id || "track",
      position: unit.position,
      actual,
      predicted,
      iou: iou(predictedBounds, actual),
      edgeError: edgeError(predicted, actual),
    });
  }
  return result;
}

function multiEventNativeRequest(testCase, track, metadata) {
  return trackRequest(
    {
      sessionId: "stock-pixel-" + testCase.id,
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs: 2000,
      osd: { width: 1280, height: 720 },
    },
    {
      id: track.id || testCase.id,
      role: track.role || "primary",
      selected: true,
      source: { path: track.fixture, ffIndex: 0, external: true },
      startMs: 1000,
      endMs: 3000,
      assFull: metadata.assFull,
      assExtradata: metadata.assExtradata,
      events: track.events,
      renderer: {
        storageWidth: 1280,
        storageHeight: 720,
        linePosition: 0,
        overrideMode: testCase.primaryAssOverride || "no",
        embeddedFonts: true,
        useStorageSize: true,
        fontProvider: "auto",
        hinting: "none",
        shaper: "complex",
      },
    },
    1,
  );
}

function subripNativeRequest(testCase, track) {
  const width = Number(testCase.width) || 1280;
  const height = Number(testCase.height) || 720;
  const timeMs = Number(testCase.timeMs) || 2000;
  return trackRequest(
    {
      sessionId: `stock-pixel-${testCase.id}`,
      mediaGeneration: 0,
      geometryGeneration: 0,
      timeMs,
      osd: { width, height },
    },
    {
      id: track.id || testCase.id,
      role: track.role || "primary",
      selected: true,
      source: { path: track.fixture, ffIndex: 0, external: true },
      startMs: Number(track.startMs) || 1000,
      endMs: Number(track.endMs) || 4000,
      assFull: "",
      assExtradata: "",
      events: [
        {
          rawText: track.text,
          startMs: Number(track.startMs) || 1000,
          endMs: Number(track.endMs) || 4000,
          layer: 0,
          drawing: false,
          units: track.units.map((unit) => ({
            position: unit.position,
            utf16Range: [unit.displayStartUtf16, unit.displayEndUtf16],
            lookupable: true,
          })),
        },
      ],
      renderer: {
        storageWidth: width,
        storageHeight: height,
        pixelAspect: 1,
        fontScale: 1,
        lineSpacing: 0,
        forceMargins: false,
        embeddedFonts: true,
        useStorageSize: true,
        linePosition: 0,
        overrideMode: testCase.primaryAssOverride || "no",
        defaultFamily: "sans-serif",
        fontProvider: "auto",
        primaryColor: "#FFFFFFFF",
        borderColor: "#FF000000",
        shadowColor: "#AF000000",
        assJustify: false,
        hinting: "none",
        shaper: "complex",
        fontSize: 38,
        outlineSize: 1.65,
        shadowOffset: 0,
        marginX: 19,
        marginY: 34,
        alignX: "center",
        alignY: "bottom",
        useMargins: true,
        bold: false,
        italic: false,
        spacing: 0,
      },
    },
    1,
  );
}

async function main() {
  const mpv = process.env.IINATAN_MPV || "mpv";
  const ffmpeg = process.env.IINATAN_FFMPEG || "ffmpeg";
  const helper = path.resolve(
    process.env.IINATAN_NATIVE_GEOMETRY ||
      path.join(
        root,
        "bin",
        process.platform === "win32" ? "iina-hoshi-dicts.exe" : "iina-hoshi-dicts",
      ),
  );
  const required = process.env.IINATAN_STOCK_PIXEL_ORACLE_REQUIRED === "1";
  const mpvVersion = spawnSync(mpv, ["--version"], { encoding: "utf8" });
  const ffmpegVersion = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
  if (
    mpvVersion.error ||
    mpvVersion.status !== 0 ||
    ffmpegVersion.error ||
    ffmpegVersion.status !== 0 ||
    !(await exists(helper))
  ) {
    if (required)
      throw new Error("mpv, ffmpeg, and the native geometry helper are required");
    console.log(
      "SKIP: stock-pixel oracle requires mpv, ffmpeg, and the native geometry helper",
    );
    return;
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "iinatan-stock-pixel-oracle-"),
  );
  try {
    const video = path.join(temporaryRoot, "background.mkv");
    await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x101820:s=1280x720:r=24:d=4",
        "-an",
        "-c:v",
        "ffv1",
        "-level",
        "3",
        "-pix_fmt",
        "yuv420p",
        "-y",
        video,
      ],
      "deterministic stock-pixel video generation",
    );
    const baseline = await captureFrame(
      mpv,
      video,
      path.join(temporaryRoot, "baseline"),
      null,
    );
    const geometryRoot = path.join(temporaryRoot, "geometry");
    const client = new NativeGeometryClient(
      new NativeGeometryWorker({
        executable: helper,
        root: geometryRoot,
        timeoutMs: 30000,
      }),
    );
    const observations = [];
    const assMetadata = new Map();
    for (const testCase of cases) {
      const tracks = testCase.tracks || [testCase];
      const fixtures = testCase.fixtures || tracks.map((track) => track.fixture);
      const withSubtitle = await captureFrame(
        mpv,
        video,
        path.join(temporaryRoot, `subtitle-${testCase.id}`),
        fixtures,
        testCase,
      );
      const mask = subtitleMask(baseline, withSubtitle);
      if (!mask.bounds)
        throw new Error(
          `stock mpv pixel capture contained no subtitle difference for ${testCase.id}`,
        );
      const responses = [];
      for (const track of tracks) {
        let metadata = null;
        if (testCase.subtitleFormat !== "subrip") {
          if (!assMetadata.has(track.fixture))
            assMetadata.set(track.fixture, await readAssMetadata(track.fixture));
          metadata = assMetadata.get(track.fixture);
        }
        const request =
          testCase.subtitleFormat === "subrip"
            ? subripNativeRequest(testCase, track)
            : track.events
              ? multiEventNativeRequest(testCase, track, metadata)
              : testCase.id === "simultaneous-default-secondary-strip" &&
                  track.id === "secondary"
                ? boundedSecondaryStripRequest(testCase, track)
                : {
                    requestId: `stock-pixel-geometry-${testCase.id}-${track.id || "track"}`,
                    source: { path: track.fixture, ffIndex: 0, external: true },
                    cue: {
                      timeMs: 2000,
                      startMs: 1000,
                      endMs: 3000,
                      observedAss: track.text,
                      observedFormat: "ass",
                      ...metadata,
                    },
                    units: track.units,
                    renderer: {
                      width: 1280,
                      height: 720,
                      storageWidth: 1280,
                      storageHeight: 720,
                      pixelAspect: 1,
                      fontScale: 1,
                      linePosition: 0,
                      defaultFamily: "Arial",
                      overrideMode:
                        track.id === "secondary"
                          ? testCase.secondaryAssOverride || "no"
                          : testCase.primaryAssOverride || "no",
                      embeddedFonts: true,
                      useStorageSize: true,
                      fontProvider: "auto",
                      hinting: "none",
                      shaper: "complex",
                    },
                  };
        if (!request)
          throw new Error("native geometry request was rejected for " + testCase.id);
        const response = await client.measure(request);
        responses.push({ track, response });
      }
      const units = responses.flatMap(({ response }) => response.units);
      const predictedBounds = rectBounds(units);
      const score = iou(predictedBounds, mask.bounds);
      const hasEnvelopeRects = units.every(
        (unit) => Array.isArray(unit.envelopeRects) && unit.envelopeRects.length > 0,
      );
      const predictedEnvelopeBounds = hasEnvelopeRects
        ? rectBounds(units, "envelopeRects")
        : null;
      const envelopeScore = predictedEnvelopeBounds
        ? iou(predictedEnvelopeBounds, mask.bounds)
        : null;
      const unitCoverage = responses.flatMap(({ track, response }) =>
        response.units.map((unit) => {
          const rect = unit.rects[0];
          let changed = 0;
          for (
            let y = Math.max(0, Math.floor(rect.y));
            y < Math.min(mask.height, Math.ceil(rect.y + rect.h));
            y++
          )
            for (
              let x = Math.max(0, Math.floor(rect.x));
              x < Math.min(mask.width, Math.ceil(rect.x + rect.w));
              x++
            )
              changed += mask.mask[y * mask.width + x];
          return {
            track: track.id || "track",
            position: unit.position,
            changedPixels: changed,
          };
        }),
      );
      const isolatedCoverage = [];
      if (testCase.isolatedGlyphOracle) {
        for (const { track, response } of responses)
          isolatedCoverage.push(
            ...(await isolatedGlyphCoverage(
              mpv,
              video,
              baseline,
              temporaryRoot,
              testCase,
              track,
              response,
            )),
          );
      }
      const identityGroups = new Map();
      for (const { track, response } of responses) {
        const identities = Array.isArray(track.unitIdentity) ? track.unitIdentity : [];
        for (const unit of response.units) {
          const identity = identities.find(
            (candidate) => candidate.position === unit.position,
          );
          if (!identity) continue;
          const key = `${track.id || "track"}:${identity.color.join(",")}`;
          const group = identityGroups.get(key) || {
            track: track.id || "track",
            color: identity.color,
            units: [],
          };
          group.units.push(unit);
          identityGroups.set(key, group);
        }
      }
      const identityGroupBounds = new Map();
      for (const [key, group] of identityGroups) {
        identityGroupBounds.set(key, {
          actual: colorIdentityBounds(baseline, withSubtitle, group.color),
          predicted: rectBounds(group.units),
        });
      }
      const identityCoverage = testCase.isolatedGlyphOracle
        ? []
        : responses.flatMap(({ track, response }) => {
            const identities = Array.isArray(track.unitIdentity)
              ? track.unitIdentity
              : [];
            return response.units.flatMap((unit) => {
              const identity = identities.find(
                (candidate) => candidate.position === unit.position,
              );
              if (!identity) return [];
              const rect = unit.rects[0];
              const key = `${track.id || "track"}:${identity.color.join(",")}`;
              const groupBounds = identityGroupBounds.get(key);
              let changedPixels = 0;
              let matchingPixels = 0;
              for (
                let y = Math.max(0, Math.floor(rect.y));
                y < Math.min(withSubtitle.height, Math.ceil(rect.y + rect.h));
                y++
              )
                for (
                  let x = Math.max(0, Math.floor(rect.x));
                  x < Math.min(withSubtitle.width, Math.ceil(rect.x + rect.w));
                  x++
                ) {
                  const before = pixel(baseline, x, y);
                  const after = pixel(withSubtitle, x, y);
                  if (colorDistance(before, after) <= PIXEL_CHANGE_THRESHOLD) continue;
                  changedPixels++;
                  if (colorIdentityMatches(before, after, identity.color))
                    matchingPixels++;
                }
              return [
                {
                  track: track.id || "track",
                  position: unit.position,
                  changedPixels,
                  matchingPixels,
                  identityGroupBounds: groupBounds?.actual || null,
                  identityPredictedBounds: groupBounds?.predicted || null,
                  identityGroupIou: groupBounds?.actual
                    ? iou(groupBounds.predicted, groupBounds.actual)
                    : 0,
                  identityEdgeError: groupBounds?.actual
                    ? edgeError(groupBounds.predicted, groupBounds.actual)
                    : Number.POSITIVE_INFINITY,
                },
              ];
            });
          });
      if (score < 0.8)
        throw new Error(
          `${testCase.id} stock pixel/native geometry IoU ${score.toFixed(4)} is below 0.8`,
        );
      if (envelopeScore !== null && envelopeScore < 0.8)
        throw new Error(
          `${testCase.id} stock visible-envelope/native geometry IoU ${envelopeScore.toFixed(4)} is below 0.8`,
        );
      if (unitCoverage.some((unit) => unit.changedPixels === 0))
        throw new Error(
          `${testCase.id} stock pixels did not overlap every predicted unit: ${JSON.stringify(
            {
              actualBounds: mask.bounds,
              predictedBounds,
              unitCoverage,
            },
          )}`,
        );
      if (
        isolatedCoverage.some(
          (unit) => !unit.actual || unit.iou < 0.999 || unit.edgeError > 0,
        )
      )
        throw new Error(
          `${testCase.id} isolated stock glyph bounds did not exactly match native geometry: ${JSON.stringify(
            isolatedCoverage,
          )}`,
        );
      if (identityCoverage.some((unit) => unit.matchingPixels === 0))
        throw new Error(
          `${testCase.id} stock pixels did not preserve every requested unit color: ${JSON.stringify(
            identityCoverage,
          )}`,
        );
      if (identityCoverage.some((unit) => unit.identityGroupIou < 0.65))
        throw new Error(
          `${testCase.id} stock pixels did not preserve every annotated identity-group bound: ${JSON.stringify(
            identityCoverage,
          )}`,
        );
      if (
        Number.isFinite(testCase.identityEdgeTolerance) &&
        identityCoverage.some(
          (unit) => unit.identityEdgeError > testCase.identityEdgeTolerance,
        )
      )
        throw new Error(
          `${testCase.id} annotated unit edge error exceeded ${testCase.identityEdgeTolerance}px: ${JSON.stringify(
            identityCoverage,
          )}`,
        );
      observations.push({
        id: testCase.id,
        fixtures,
        geometryFixtures: tracks.map((track) => track.fixture),
        rendererOptions: {
          primaryAssOverride: testCase.primaryAssOverride || "no",
          secondaryAssOverride: testCase.secondaryAssOverride || null,
        },
        nativePaths: tracks.map((track) => ({
          track: track.id || "track",
          mode:
            testCase.subtitleFormat === "subrip"
              ? "bounded-subrip-observation"
              : testCase.id === "simultaneous-default-secondary-strip" &&
                  track.id === "secondary"
                ? "bounded-secondary-strip-observation"
                : "direct-ass-fixture",
        })),
        actualBounds: mask.bounds,
        predictedBounds,
        iou: score,
        ...(predictedEnvelopeBounds
          ? {
              predictedEnvelopeBounds,
              envelopeIou: envelopeScore,
            }
          : {}),
        maskPixels: mask.pixels,
        unitCoverage,
        ...(isolatedCoverage.length ? { isolatedGlyphCoverage: isolatedCoverage } : {}),
        ...(identityCoverage.length ? { identityCoverage } : {}),
      });
    }

    console.log(
      JSON.stringify(
        {
          mpv: mpvVersion.stdout.split(/\r?\n/)[0],
          ffmpeg: ffmpegVersion.stdout.split(/\r?\n/)[0],
          frame: { width: baseline.width, height: baseline.height },
          observations,
          mode: "independent-stock-mpv-pixel-oracle-selected-and-simultaneous",
        },
        null,
        2,
      ),
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`STOCK MPV PIXEL ORACLE FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  captureFrame,
  decodePng,
  exists,
  iou,
  main,
  pixel,
  rectBounds,
  run,
  subripNativeRequest,
  subtitleColorMask,
  subtitleMask,
};
