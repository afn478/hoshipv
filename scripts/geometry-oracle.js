#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { compareGeometryFixture } = require("../src/geometry/oracle");

const filePath = process.argv[2];
if (!filePath) {
  console.error("usage: node scripts/geometry-oracle.js FIXTURE.json");
  process.exitCode = 2;
} else {
  try {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
    const result = compareGeometryFixture(fixture);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.pass) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
