const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const request = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/protocol/lookup-request.json"),
  ),
);
const result = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/protocol/lookup-result.json"),
  ),
);
const requestKeys = [
  "requestId",
  "text",
  "scanLength",
  "maxResults",
  "maxGlossaries",
  "mode",
];
const resultKeys = [
  "ok",
  "lookupString",
  "scanLength",
  "resultCount",
  "results",
];

function assert(value, message) {
  if (!value) throw new Error(message);
}
assert(
  JSON.stringify(Object.keys(request)) === JSON.stringify(requestKeys),
  "lookup request field order/shape changed",
);
assert(
  JSON.stringify(Object.keys(result)) === JSON.stringify(resultKeys),
  "lookup result envelope changed",
);
assert(
  ["yomitan-japanese", "exact", "prefix"].includes(request.mode),
  "lookup mode is invalid",
);
const term = result.results[0].term;
assert(
  [
    "expression",
    "reading",
    "rules",
    "glossaries",
    "frequencies",
    "pitches",
  ].every((key) => key in term),
  "term metadata contract is incomplete",
);
console.log("lookup protocol golden tests passed");
